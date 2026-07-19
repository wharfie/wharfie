import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  validateActivityProtocolComponentFrame,
} from './activity-protocol.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import {
  AttemptStatus,
  EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS,
  EffectStatus,
  InvocationStatus,
  RunStatus,
} from '../lib/db/tables/execution-ledger.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';

const DEFAULT_ACTOR = Object.freeze({
  kind: 'runtime',
  id: 'managed-effect',
});

const UNCERTAINTY_REASON = Object.freeze({
  kind: 'managed-effect-outcome-unknown',
  phase: 'after-durable-start',
  message:
    'The adapter may have begun, but no verifier-backed destination outcome was durably committed.',
});

const RECOVERY_UNCERTAINTY_REASON = Object.freeze({
  kind: 'managed-effect-recovery-outcome-unknown',
  phase: 'after-runner-exclusion',
  message:
    'The retained effect was started, but its destination exposed no permanent verifier-backed outcome receipt.',
});

const RECOVERY_CANCELLATION_REASON = Object.freeze({
  kind: 'managed-effect-cancelled-before-start',
  phase: 'before-durable-effect-start',
  message:
    'The retained request never crossed the durable adapter-dispatch boundary before runner exclusion.',
});

const STOPPED_ATTEMPT_RECOVERY_REASON = Object.freeze({
  kind: 'operator-recovery-after-start',
  phase: 'after-runner-exclusion',
  message:
    'The prior runner stopped after durable attempt start; its physical activity outcome is unknown.',
});

export const ManagedEffectRecoveryAction = Object.freeze({
  SETTLED_MANAGED_EFFECT_SET: 'settled-managed-effect-set',
  CANCELLED_BEFORE_START: 'cancelled-before-start',
  OUTCOME_RECOVERED: 'outcome-recovered',
  OUTCOME_UNCERTAIN: 'outcome-uncertain',
});

/**
 * A call reached a retained STARTED effect without winning authorization to
 * perform its one physical adapter delivery. A caller may observe or recover
 * that retained work, but must never execute it again from this response.
 */
export class ManagedEffectDispatchNotAuthorizedError extends Error {
  /**
   * @param {string} effectId - Invocation-scoped effect identity.
   */
  constructor(effectId) {
    super(
      `Managed effect dispatch is not authorized by this transition: ${effectId}`,
    );
    this.name = 'ManagedEffectDispatchNotAuthorizedError';
    this.effectId = effectId;
  }
}

/**
 * A begun adapter delivery has no verifier-backed durable outcome. The error
 * carries the verified blocked aggregate so callers cannot mistake it for an
 * ordinary destination failure.
 */
export class ManagedEffectUncertainError extends Error {
  /**
   * @param {string} effectId - Invocation-scoped effect identity.
   * @param {Record<string, any>} durableState - Verified blocked state.
   * @param {unknown} cause - Local adapter or commit failure.
   */
  constructor(effectId, durableState, cause) {
    super(`Managed effect outcome is uncertain: ${effectId}`);
    this.name = 'ManagedEffectUncertainError';
    this.effectId = effectId;
    this.durableState = durableState;
    this.cause = cause;
  }
}

/**
 * @param {unknown} value - Candidate external cancellation signal.
 * @returns {void}
 */
function assertOptionalAbortSignal(value) {
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
        'function' ||
      typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
        'function')
  ) {
    throw new TypeError(
      'executeManagedEffect.signal must be an AbortSignal when provided.',
    );
  }
}

/**
 * @param {any} value - Independently cloned JSON value.
 * @returns {any} - Recursively frozen JSON value.
 */
function deepFreezeJson(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreezeJson(child);
  return Object.freeze(value);
}

/**
 * Snapshot audit identity before the first await so one managed delivery
 * cannot change actors between its durable phases.
 * @param {unknown} value - Candidate actor.
 * @param {string} [label] - Boundary label.
 * @returns {{kind: string, id: string}} - Immutable actor snapshot.
 */
function normalizeManagedEffectActor(
  value,
  label = 'executeManagedEffect.actor',
) {
  const actor = cloneJsonObject(
    value === undefined ? DEFAULT_ACTOR : value,
    label,
  );
  if (
    Object.keys(actor).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(actor, 'kind') ||
    !Object.prototype.hasOwnProperty.call(actor, 'id')
  ) {
    throw new TypeError(`${label} requires kind and id.`);
  }
  return Object.freeze({
    kind: assertLedgerOpaqueId(actor.kind, `${label}.kind`),
    id: assertLedgerOpaqueId(actor.id, `${label}.id`),
  });
}

/**
 * Keep adapter executable code outside durable JSON while requiring all
 * semantic descriptors to be explicit and versioned before any transition.
 * The ledger remains the strict authority for descriptor and replay-property
 * schemas.
 * @param {unknown} value - Candidate managed-effect adapter.
 * @returns {{descriptor: {id: string, version: number}, destination: {kind: string, version: number, bindingId: string, configuration: Record<string, any>}, verifier: {kind: string, version: number}, substantiatedReplayProperties: string[], execute: (input: Record<string, any>) => Promise<unknown>|unknown}} - Adapter contract.
 */
function normalizeManagedEffectAdapter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('executeManagedEffect.adapter must be an object.');
  }
  const adapter = /** @type {Record<string, any>} */ (value);
  const keys = Object.keys(adapter);
  const expected = [
    'descriptor',
    'destination',
    'verifier',
    'substantiatedReplayProperties',
    'execute',
  ];
  const properties = new Map(
    expected.map((key) => [key, Object.getOwnPropertyDescriptor(adapter, key)]),
  );
  if (
    keys.length !== expected.length ||
    expected.some((key) => {
      const property = properties.get(key);
      return !property?.enumerable || !('value' in property);
    }) ||
    typeof properties.get('execute')?.value !== 'function'
  ) {
    throw new TypeError(
      'executeManagedEffect.adapter requires exactly descriptor, destination, verifier, substantiatedReplayProperties, and execute.',
    );
  }
  const replayProperties = deepFreezeJson(
    cloneJsonValue(
      properties.get('substantiatedReplayProperties')?.value,
      'executeManagedEffect.adapter.substantiatedReplayProperties',
    ),
  );
  if (!Array.isArray(replayProperties)) {
    throw new TypeError(
      'executeManagedEffect.adapter.substantiatedReplayProperties must be an array.',
    );
  }
  return Object.freeze({
    descriptor: deepFreezeJson(
      cloneJsonObject(
        properties.get('descriptor')?.value,
        'executeManagedEffect.adapter.descriptor',
      ),
    ),
    destination: deepFreezeJson(
      cloneJsonObject(
        properties.get('destination')?.value,
        'executeManagedEffect.adapter.destination',
      ),
    ),
    verifier: deepFreezeJson(
      cloneJsonObject(
        properties.get('verifier')?.value,
        'executeManagedEffect.adapter.verifier',
      ),
    ),
    substantiatedReplayProperties: replayProperties,
    execute: properties.get('execute')?.value,
  });
}

/**
 * @param {'request'|'start'|'outcome'|'uncertain'} phase - Transition phase.
 * @param {{runId: string, invocationId: string, attemptId: string, effectId: string}} identity - Stable effect identity.
 * @returns {string} - Stable response-loss retry identity.
 */
function createManagedEffectTransitionId(phase, identity) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-transition:v1',
    prefix: 'wmt',
    value: { schemaVersion: 1, phase, ...identity },
    valuePath: 'managed effect transition identity',
  });
}

/**
 * Keep stopped-runner recovery receipts distinct from live-driver
 * transitions. The complete frozen recovery plan participates so one ID can
 * never be replayed against a changed sibling set, actor, or receipt result.
 * @param {Record<string, any>} plan - Exact retained recovery plan.
 * @returns {string} - Stable response-loss retry identity.
 */
function createManagedEffectRecoveryTransitionId(plan) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-set-recovery-transition:v2',
    prefix: 'wmr',
    value: { schemaVersion: 2, ...plan },
    valuePath: 'managed effect set recovery transition identity',
  });
}

/**
 * @param {unknown} left - First strict JSON value.
 * @param {unknown} right - Second strict JSON value.
 * @returns {boolean} - Canonical JSON equality.
 */
function hasSameCanonicalJson(left, right) {
  const digest = (/** @type {unknown} */ value) =>
    createCanonicalJsonSha256Id({
      domain: 'wharfie:managed-effect-comparison:v1',
      prefix: 'wmc',
      value,
      valuePath: 'managed effect comparison',
    });
  return digest(left) === digest(right);
}

/**
 * Refuse to resume or redeliver an effect when the new component frame or
 * adapter contract differs from the immutable retained request.
 * @param {Record<string, any>} delivery - Verified resumable ledger state.
 * @param {{runId: string, invocationId: string, attemptId: string, effectId: string}} identity - Exact requested identity.
 * @param {Readonly<Record<string, any>>} request - Validated component frame.
 * @param {ReturnType<typeof normalizeManagedEffectAdapter>} adapter - Current adapter implementation.
 * @returns {void}
 */
function assertMatchingRetainedDelivery(delivery, identity, request, adapter) {
  const logicalRequest = {
    capability: request.capability,
    operation: request.operation,
    input: request.input,
    requestedReplayProperties: request.requestedReplayProperties,
  };
  if (
    delivery.run.runId !== identity.runId ||
    delivery.invocation.invocationId !== identity.invocationId ||
    delivery.attempt.attemptId !== identity.attemptId ||
    delivery.effect.effectId !== identity.effectId ||
    delivery.effect.requestedBy.attemptId !== identity.attemptId ||
    delivery.effect.requestedBy.protocolSequence !== request.sequence ||
    !hasSameCanonicalJson(delivery.request, logicalRequest) ||
    !hasSameCanonicalJson(delivery.effect.adapter, adapter.descriptor) ||
    !hasSameCanonicalJson(delivery.effect.destination, adapter.destination) ||
    !hasSameCanonicalJson(delivery.effect.verifier, adapter.verifier) ||
    !hasSameCanonicalJson(
      delivery.effect.substantiatedReplayProperties,
      adapter.substantiatedReplayProperties,
    )
  ) {
    throw new TypeError(
      `Managed effect retry conflicts with retained request: ${identity.effectId}`,
    );
  }
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger state.
 * @param {string} invocationId - Exact logical invocation.
 * @param {string} attemptId - Exact physical attempt.
 * @param {string} effectId - Invocation-scoped effect identity.
 * @returns {{invocation: Record<string, any>, attempt: Record<string, any>}} - Current invocation and attempt.
 */
function getCurrentAttempt(view, invocationId, attemptId, effectId) {
  const invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocationId,
  );
  const attempt = view.attempts.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocationId &&
      candidate.attemptId === attemptId,
  );
  if (!invocation || !attempt || invocation.generation !== attempt.generation) {
    throw new ManagedEffectDispatchNotAuthorizedError(effectId);
  }
  return { invocation, attempt };
}

/**
 * Convert a post-start local failure into the only conservative durable state.
 * If the uncertainty write loses its response, a second verified read accepts
 * the retained blocked state rather than inventing another adapter delivery.
 * If the outcome write actually committed before losing its response, the
 * rehashed and reverified terminal frame is authoritative and is redelivered.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, attemptId: string, effectId: string, transitionId: string, actor: Record<string, any>, cause: unknown}} options - Ambiguous begun delivery.
 * @returns {Promise<Readonly<Record<string, any>>>} - Authoritative terminal redelivery, or throws after blocking.
 */
async function blockUncertainManagedEffect(options) {
  let current;
  try {
    current = await options.ledger.readManagedEffectDelivery(
      options.runId,
      options.invocationId,
      options.effectId,
    );
  } catch (readError) {
    throw new AggregateError(
      [options.cause, readError],
      `Could not verify managed effect state after failure: ${options.effectId}`,
    );
  }
  if (!current) {
    throw new AggregateError(
      [options.cause],
      `Managed effect run disappeared after durable start: ${options.runId}`,
    );
  }
  if (current.resultFrame) return current.resultFrame;
  if (
    current.effect.status === EffectStatus.UNCERTAIN &&
    current.run.status === RunStatus.BLOCKED
  ) {
    throw new ManagedEffectUncertainError(
      options.effectId,
      current,
      options.cause,
    );
  }
  if (current.effect.status !== EffectStatus.STARTED) {
    throw new AggregateError(
      [options.cause],
      `Managed effect no longer has an outcome that this call can settle: ${options.effectId}`,
    );
  }
  const { invocation, attempt, effect } = current;
  if (
    current.run.status !== RunStatus.RUNNING ||
    invocation.status !== InvocationStatus.RUNNING ||
    attempt.status !== AttemptStatus.STARTED
  ) {
    throw new AggregateError(
      [options.cause],
      `Managed effect aggregate changed before uncertainty could be recorded: ${options.effectId}`,
    );
  }

  try {
    const blocked = await options.ledger.markManagedEffectUncertain({
      runId: options.runId,
      invocationId: options.invocationId,
      attemptId: options.attemptId,
      effectId: options.effectId,
      fencingToken: attempt.fencingToken,
      generation: attempt.generation,
      expectedVersion: current.run.version,
      expectedEffectVersion: effect.version,
      transitionId: options.transitionId,
      reason: UNCERTAINTY_REASON,
      actor: options.actor,
      coordinatorEpoch: attempt.coordinatorEpoch,
    });
    throw new ManagedEffectUncertainError(
      options.effectId,
      {
        run: blocked.run,
        invocations: [blocked.invocation],
        attempts: blocked.attempt ? [blocked.attempt] : [],
        effects: blocked.effect ? [blocked.effect] : [],
      },
      options.cause,
    );
  } catch (markError) {
    if (markError instanceof ManagedEffectUncertainError) throw markError;
    let after;
    try {
      after = await options.ledger.readManagedEffectDelivery(
        options.runId,
        options.invocationId,
        options.effectId,
      );
    } catch (readError) {
      throw new AggregateError(
        [options.cause, markError, readError],
        `Could not durably record or verify managed effect uncertainty: ${options.effectId}`,
      );
    }
    if (after?.resultFrame) return after.resultFrame;
    if (
      after &&
      after.effect.status === EffectStatus.UNCERTAIN &&
      after.run.status === RunStatus.BLOCKED
    ) {
      throw new ManagedEffectUncertainError(
        options.effectId,
        after,
        new AggregateError([options.cause, markError]),
      );
    }
    throw new AggregateError(
      [options.cause, markError],
      `Could not durably record managed effect uncertainty: ${options.effectId}`,
    );
  }
}

const TERMINAL_EFFECT_STATUSES = new Set([
  EffectStatus.COMPLETED,
  EffectStatus.FAILED,
  EffectStatus.CANCELLED,
  EffectStatus.NOT_APPLIED,
]);

/**
 * Select the complete unresolved set for one exact current begun attempt.
 * @param {Record<string, any>} view - Verified run projection.
 * @param {string} invocationId - Invocation identity.
 * @returns {{invocation: Record<string, any>, attempt: Record<string, any>, effects: Record<string, any>[]}} - Canonically sorted set.
 */
function selectStoppedManagedEffectSet(view, invocationId) {
  const invocation = view?.invocations?.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocationId,
  );
  const attempt = view?.attempts?.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocationId &&
      candidate.generation === invocation?.generation,
  );
  if (
    view?.run?.status !== RunStatus.RUNNING ||
    invocation?.status !== InvocationStatus.RUNNING ||
    attempt?.status !== AttemptStatus.STARTED ||
    invocation.generation !== attempt.generation
  ) {
    throw new Error(
      `Managed-effect set recovery requires the exact current STARTED attempt for invocation ${invocationId}.`,
    );
  }
  const effects = (view.effects || [])
    .filter(
      (/** @type {Record<string, any>} */ effect) =>
        effect.invocationId === invocationId &&
        effect.requestedBy?.attemptId === attempt.attemptId &&
        !TERMINAL_EFFECT_STATUSES.has(effect.status),
    )
    .sort(
      (
        /** @type {Record<string, any>} */ left,
        /** @type {Record<string, any>} */ right,
      ) =>
        left.effectId < right.effectId
          ? -1
          : left.effectId > right.effectId
            ? 1
            : 0,
    );
  if (effects.length === 0) {
    throw new Error(
      `Managed-effect set recovery found no unresolved work for attempt ${attempt.attemptId}.`,
    );
  }
  if (effects.length > EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS) {
    throw new RangeError(
      `Managed-effect set recovery supports at most ${EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS} unresolved effects; found ${effects.length}.`,
    );
  }
  for (const effect of effects) {
    const requestedBy = effect.requestedBy;
    const exactRequestFence =
      requestedBy?.attemptId === attempt.attemptId &&
      requestedBy?.generation === attempt.generation &&
      requestedBy?.coordinatorEpoch === attempt.coordinatorEpoch &&
      requestedBy?.fencingToken === attempt.fencingToken;
    const exactStartFence =
      effect.status !== EffectStatus.STARTED ||
      (effect.startedBy?.attemptId === attempt.attemptId &&
        effect.startedBy?.generation === attempt.generation &&
        effect.startedBy?.coordinatorEpoch === attempt.coordinatorEpoch &&
        effect.startedBy?.fencingToken === attempt.fencingToken);
    if (
      (effect.status !== EffectStatus.PENDING &&
        effect.status !== EffectStatus.STARTED) ||
      !exactRequestFence ||
      !exactStartFence
    ) {
      throw new ManagedEffectDispatchNotAuthorizedError(effect.effectId);
    }
  }
  return { invocation, attempt, effects };
}

/**
 * Reconstruct the exact component request retained across physical transport.
 * @param {Record<string, any>} delivery - Verified delivery.
 * @returns {Readonly<Record<string, any>>} - Exact component frame.
 */
function reconstructManagedEffectRecoveryRequest(delivery) {
  return validateActivityProtocolComponentFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'effect-request',
      attemptId: delivery.effect.requestedBy.attemptId,
      sequence: delivery.effect.requestedBy.protocolSequence,
      effectId: delivery.effect.effectId,
      capability: delivery.request.capability,
      operation: delivery.request.operation,
      input: delivery.request.input,
      requestedReplayProperties: delivery.request.requestedReplayProperties,
    },
    'recoverStoppedManagedEffects retained request',
  );
}

/**
 * Read one coherent complete recovery set, including referenced requests.
 * Repeated delivery folds are compared with the first fold so a concurrent
 * change can never produce a mixed snapshot.
 * @param {Record<string, any>} ledger - Execution ledger.
 * @param {string} runId - Run identity.
 * @param {string} invocationId - Invocation identity.
 * @returns {Promise<{view: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, deliveries: Record<string, any>[], contract: Readonly<Record<string, any>>}>} - Exact frozen set.
 */
async function readStoppedManagedEffectSet(ledger, runId, invocationId) {
  const view = await ledger.rebuildRun(runId);
  if (!view) {
    throw new Error(`Managed-effect recovery run was not found: ${runId}`);
  }
  const selected = selectStoppedManagedEffectSet(view, invocationId);
  const deliveries = [];
  for (const selectedEffect of selected.effects) {
    const delivery = await ledger.readManagedEffectDelivery(
      runId,
      invocationId,
      selectedEffect.effectId,
    );
    if (
      !delivery ||
      !hasSameCanonicalJson(delivery.run, view.run) ||
      !hasSameCanonicalJson(delivery.invocation, selected.invocation) ||
      !hasSameCanonicalJson(delivery.attempt, selected.attempt) ||
      !hasSameCanonicalJson(delivery.effect, selectedEffect)
    ) {
      throw new ManagedEffectDispatchNotAuthorizedError(
        selectedEffect.effectId,
      );
    }
    reconstructManagedEffectRecoveryRequest(delivery);
    deliveries.push(delivery);
  }
  const contract = deepFreezeJson({
    run: cloneJsonObject(view.run, 'managed-effect recovery run'),
    invocation: cloneJsonObject(
      selected.invocation,
      'managed-effect recovery invocation',
    ),
    attempt: cloneJsonObject(
      selected.attempt,
      'managed-effect recovery attempt',
    ),
    effects: deliveries.map((delivery) => ({
      effect: cloneJsonObject(
        delivery.effect,
        'managed-effect recovery effect',
      ),
      request: cloneJsonObject(
        delivery.request,
        'managed-effect recovery request',
      ),
    })),
  });
  return {
    view,
    invocation: selected.invocation,
    attempt: selected.attempt,
    deliveries,
    contract,
  };
}

/**
 * Return a compact plural result without destination or receipt material.
 * @param {boolean} changed - Whether this logical call appended the batch.
 * @param {Array<{effectId: string, action: string, status: string}>} managedEffects - Canonical public rows.
 * @returns {Readonly<{action: string, changed: boolean, managedEffects: Readonly<Readonly<{effectId: string, action: string, status: string}>[]>}>} - Redacted result.
 */
function stoppedManagedEffectRecoveryResult(changed, managedEffects) {
  return Object.freeze({
    action: ManagedEffectRecoveryAction.SETTLED_MANAGED_EFFECT_SET,
    changed,
    managedEffects: Object.freeze(
      managedEffects.map((effect) => Object.freeze({ ...effect })),
    ),
  });
}

/**
 * Prove that a thrown settlement retained this exact logical batch. The event
 * stream was fully verified by the ledger before this comparison.
 * @param {Record<string, any>[]} events - Verified event stream.
 * @param {{transitionId: string, actor: Record<string, any>, attemptId: string, managedEffects: Array<{effectId: string, action: string, status: string}>}} expected - Exact public batch.
 * @returns {boolean} - Whether this call's event is retained.
 */
function hasMatchingStoppedManagedEffectRecoveryEvent(events, expected) {
  return events.some((event) => {
    const effects = event?.payload?.effects;
    return (
      event?.transition_id === expected.transitionId &&
      event.type === 'attempt-became-uncertain' &&
      hasSameCanonicalJson(event.actor, expected.actor) &&
      event.payload?.attempt?.attemptId === expected.attemptId &&
      event.payload?.attempt?.status === AttemptStatus.ABANDONED &&
      event.payload?.invocation?.status === InvocationStatus.UNCERTAIN &&
      event.payload?.run?.status === RunStatus.BLOCKED &&
      Array.isArray(effects) &&
      hasSameCanonicalJson(
        effects.map((effect) => ({
          effectId: effect.effectId,
          status: effect.status,
        })),
        expected.managedEffects.map((effect) => ({
          effectId: effect.effectId,
          status: effect.status,
        })),
      )
    );
  });
}

/**
 * Recover the complete bounded unresolved effect set after the caller has
 * excluded the prior runner. PENDING work is cancelled from ledger authority
 * without destination access. Every STARTED effect is probed read-only before
 * one atomic attempt-level settlement. Adapter execution is never accepted.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, recoverOutcome?: (input: Readonly<{destinationEffectId: string, destination: Record<string, any>, identity: {runId: string, invocationId: string, effectId: string}, request: Record<string, any>}>) => Promise<unknown>|unknown, actor?: {kind: string, id: string}}} options - Stopped-runner recovery inputs.
 * @returns {Promise<ReturnType<typeof stoppedManagedEffectRecoveryResult>>} - Redacted atomic result.
 */
export async function recoverStoppedManagedEffects(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'recoverStoppedManagedEffects options must be an object.',
    );
  }
  const ledger = options.ledger;
  if (
    !ledger ||
    typeof ledger.rebuildRun !== 'function' ||
    typeof ledger.readManagedEffectDelivery !== 'function' ||
    typeof ledger.settleStoppedAttemptManagedEffects !== 'function' ||
    typeof ledger.getEvents !== 'function'
  ) {
    throw new TypeError(
      'recoverStoppedManagedEffects requires an execution ledger.',
    );
  }
  const runId = assertLedgerOpaqueId(
    options.runId,
    'recoverStoppedManagedEffects.runId',
  );
  const invocationId = assertLedgerOpaqueId(
    options.invocationId,
    'recoverStoppedManagedEffects.invocationId',
  );
  const actor = normalizeManagedEffectActor(
    options.actor,
    'recoverStoppedManagedEffects.actor',
  );
  const retained = await readStoppedManagedEffectSet(
    ledger,
    runId,
    invocationId,
  );
  const hasStarted = retained.deliveries.some(
    (delivery) => delivery.effect.status === EffectStatus.STARTED,
  );
  const recoverOutcome = options.recoverOutcome;
  if (hasStarted && typeof recoverOutcome !== 'function') {
    throw new TypeError(
      'recoverStoppedManagedEffects.recoverOutcome is required for STARTED effects.',
    );
  }

  /** @type {Record<string, any>[]} */
  const decisions = [];
  /** @type {Array<{effectId: string, action: string, status: string}>} */
  const managedEffects = [];
  for (const delivery of retained.deliveries) {
    const effectId = delivery.effect.effectId;
    if (delivery.effect.status === EffectStatus.PENDING) {
      decisions.push({
        effectId,
        expectedEffectVersion: delivery.effect.version,
        disposition: ManagedEffectRecoveryAction.CANCELLED_BEFORE_START,
        reason: RECOVERY_CANCELLATION_REASON,
      });
      managedEffects.push({
        effectId,
        action: ManagedEffectRecoveryAction.CANCELLED_BEFORE_START,
        status: EffectStatus.CANCELLED,
      });
      continue;
    }
    const request = reconstructManagedEffectRecoveryRequest(delivery);
    const callbackInput = deepFreezeJson({
      destinationEffectId: delivery.effect.destinationEffectId,
      destination: cloneJsonObject(
        delivery.effect.destination,
        'recoverStoppedManagedEffects destination',
      ),
      identity: { runId, invocationId, effectId },
      request,
    });
    const rawOutcome = await /** @type {Function} */ (recoverOutcome)(
      callbackInput,
    );
    const outcome =
      rawOutcome === null
        ? null
        : deepFreezeJson(
            cloneJsonObject(
              rawOutcome,
              'recoverStoppedManagedEffects recovered outcome',
            ),
          );
    if (outcome === null) {
      decisions.push({
        effectId,
        expectedEffectVersion: delivery.effect.version,
        disposition: ManagedEffectRecoveryAction.OUTCOME_UNCERTAIN,
        reason: RECOVERY_UNCERTAINTY_REASON,
      });
      managedEffects.push({
        effectId,
        action: ManagedEffectRecoveryAction.OUTCOME_UNCERTAIN,
        status: EffectStatus.UNCERTAIN,
      });
    } else {
      decisions.push({
        effectId,
        expectedEffectVersion: delivery.effect.version,
        disposition: ManagedEffectRecoveryAction.OUTCOME_RECOVERED,
        outcome,
      });
      managedEffects.push({
        effectId,
        action: ManagedEffectRecoveryAction.OUTCOME_RECOVERED,
        status:
          outcome.ok === true ? EffectStatus.COMPLETED : EffectStatus.FAILED,
      });
    }
  }

  // Close the probe TOCTOU window over the complete sibling set.
  const current = await readStoppedManagedEffectSet(
    ledger,
    runId,
    invocationId,
  );
  if (!hasSameCanonicalJson(retained.contract, current.contract)) {
    throw new ManagedEffectDispatchNotAuthorizedError(
      retained.deliveries[0].effect.effectId,
    );
  }
  const transitionId = createManagedEffectRecoveryTransitionId({
    runId,
    invocationId,
    attemptId: current.attempt.attemptId,
    actor,
    contract: retained.contract,
    decisions,
  });
  let settlement;
  try {
    settlement = await ledger.settleStoppedAttemptManagedEffects({
      runId,
      invocationId,
      attemptId: current.attempt.attemptId,
      fencingToken: current.attempt.fencingToken,
      generation: current.attempt.generation,
      expectedVersion: current.view.run.version,
      transitionId,
      decisions,
      reason: STOPPED_ATTEMPT_RECOVERY_REASON,
      actor,
      coordinatorEpoch: current.attempt.coordinatorEpoch,
    });
  } catch (settlementError) {
    let retainedOwnEvent = false;
    try {
      retainedOwnEvent = hasMatchingStoppedManagedEffectRecoveryEvent(
        await ledger.getEvents(runId),
        {
          transitionId,
          actor,
          attemptId: current.attempt.attemptId,
          managedEffects,
        },
      );
    } catch (readError) {
      throw new AggregateError(
        [settlementError, readError],
        `Could not settle or verify stopped managed effects for run ${runId}.`,
      );
    }
    if (!retainedOwnEvent) throw settlementError;
    return stoppedManagedEffectRecoveryResult(true, managedEffects);
  }

  if (
    !Array.isArray(settlement.effects) ||
    !hasSameCanonicalJson(
      settlement.effects.map((/** @type {Record<string, any>} */ effect) => ({
        effectId: effect.effectId,
        status: effect.status,
      })),
      managedEffects.map((effect) => ({
        effectId: effect.effectId,
        status: effect.status,
      })),
    )
  ) {
    throw new Error(
      `Stopped managed-effect settlement returned an unexpected effect set for run ${runId}.`,
    );
  }
  return stoppedManagedEffectRecoveryResult(
    settlement.applied === true,
    managedEffects,
  );
}

/**
 * Execute one Activity Protocol effect request through a durable managed
 * adapter. The adapter is invoked only after this call wins the exact STARTED
 * transition, and its result is returned to the component only after a
 * registered verifier accepts and the outcome transition is durably rebuilt.
 *
 * This remains an internal runtime primitive. Public source and SEA workers
 * reach it only through the finite host catalog and their complete framed
 * attempt transcript lifecycle.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, request: Record<string, any>, adapter: {descriptor: {id: string, version: number}, destination: {kind: string, version: number, bindingId: string, configuration: Record<string, any>}, verifier: {kind: string, version: number}, substantiatedReplayProperties: string[], execute: (input: {destinationEffectId: string, destination: Readonly<Record<string, any>>, identity: Readonly<Record<string, any>>, request: Readonly<Record<string, any>>, signal?: AbortSignal}) => Promise<unknown>|unknown}, actor?: {kind: string, id: string}, signal?: AbortSignal}} options - Managed delivery inputs.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable verifier-backed effect-result host frame.
 */
export async function executeManagedEffect(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('executeManagedEffect options must be an object.');
  }
  const ledger = options.ledger;
  if (
    !ledger ||
    typeof ledger.rebuildRun !== 'function' ||
    typeof ledger.readManagedEffectDelivery !== 'function'
  ) {
    throw new TypeError('executeManagedEffect requires an execution ledger.');
  }
  const runId = assertLedgerOpaqueId(
    options.runId,
    'executeManagedEffect.runId',
  );
  const invocationId = assertLedgerOpaqueId(
    options.invocationId,
    'executeManagedEffect.invocationId',
  );
  const request = validateActivityProtocolComponentFrame(
    options.request,
    'executeManagedEffect.request',
  );
  if (request.type !== 'effect-request') {
    throw new TypeError(
      'executeManagedEffect.request must be an effect-request frame.',
    );
  }
  const effectId = assertLedgerOpaqueId(
    request.effectId,
    'executeManagedEffect.request.effectId',
  );
  const adapter = normalizeManagedEffectAdapter(options.adapter);
  const signal = options.signal;
  assertOptionalAbortSignal(signal);
  const actor = normalizeManagedEffectActor(options.actor);
  const identity = Object.freeze({
    runId,
    invocationId,
    attemptId: request.attemptId,
    effectId,
  });
  const transition = (
    /** @type {'request'|'start'|'outcome'|'uncertain'} */ phase,
  ) => createManagedEffectTransitionId(phase, identity);

  const readDelivery = async () => {
    const delivery = await ledger.readManagedEffectDelivery(
      runId,
      invocationId,
      effectId,
    );
    if (delivery) {
      assertMatchingRetainedDelivery(delivery, identity, request, adapter);
    }
    return delivery;
  };

  let delivery = await readDelivery();
  if (delivery?.resultFrame) return delivery.resultFrame;
  if (delivery?.effect.status === EffectStatus.UNCERTAIN) {
    throw new ManagedEffectUncertainError(effectId, delivery, undefined);
  }
  if (delivery?.effect.status === EffectStatus.STARTED) {
    throw new ManagedEffectDispatchNotAuthorizedError(effectId);
  }

  if (!delivery) {
    const initial = await ledger.rebuildRun(runId);
    if (!initial) {
      throw new Error(`Execution ledger run was not found: ${runId}`);
    }
    const { invocation, attempt } = getCurrentAttempt(
      initial,
      invocationId,
      request.attemptId,
      effectId,
    );
    if (
      initial.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED
    ) {
      throw new ManagedEffectDispatchNotAuthorizedError(effectId);
    }
    try {
      await ledger.recordManagedEffectRequest({
        runId,
        invocationId,
        attemptId: attempt.attemptId,
        fencingToken: attempt.fencingToken,
        generation: attempt.generation,
        expectedVersion: initial.run.version,
        transitionId: transition('request'),
        request,
        adapter: adapter.descriptor,
        destination: adapter.destination,
        verifier: adapter.verifier,
        substantiatedReplayProperties: adapter.substantiatedReplayProperties,
        actor,
        coordinatorEpoch: attempt.coordinatorEpoch,
      });
    } catch (requestError) {
      try {
        delivery = await readDelivery();
      } catch (readError) {
        throw new AggregateError(
          [requestError, readError],
          `Could not verify managed effect request persistence: ${effectId}`,
        );
      }
      if (!delivery) throw requestError;
    }
    delivery = delivery ?? (await readDelivery());
  }

  if (!delivery) {
    throw new Error(`Managed effect request disappeared: ${effectId}`);
  }
  if (delivery.resultFrame) return delivery.resultFrame;
  if (delivery.effect.status === EffectStatus.UNCERTAIN) {
    throw new ManagedEffectUncertainError(effectId, delivery, undefined);
  }
  if (delivery.effect.status === EffectStatus.STARTED) {
    throw new ManagedEffectDispatchNotAuthorizedError(effectId);
  }
  if (
    delivery.effect.status !== EffectStatus.PENDING ||
    delivery.run.status !== RunStatus.RUNNING ||
    delivery.invocation.status !== InvocationStatus.RUNNING ||
    delivery.attempt.status !== AttemptStatus.STARTED
  ) {
    throw new ManagedEffectDispatchNotAuthorizedError(effectId);
  }

  let started;
  try {
    started = await ledger.markManagedEffectStarted({
      runId,
      invocationId,
      attemptId: delivery.attempt.attemptId,
      effectId,
      fencingToken: delivery.attempt.fencingToken,
      generation: delivery.attempt.generation,
      expectedVersion: delivery.run.version,
      expectedEffectVersion: delivery.effect.version,
      transitionId: transition('start'),
      actor,
      coordinatorEpoch: delivery.attempt.coordinatorEpoch,
    });
  } catch (startError) {
    let afterStart;
    try {
      afterStart = await readDelivery();
    } catch (readError) {
      throw new AggregateError(
        [startError, readError],
        `Could not verify managed effect start persistence: ${effectId}`,
      );
    }
    if (afterStart?.resultFrame) return afterStart.resultFrame;
    if (afterStart?.effect.status === EffectStatus.UNCERTAIN) {
      throw new ManagedEffectUncertainError(effectId, afterStart, startError);
    }
    if (afterStart?.effect.status === EffectStatus.STARTED) {
      throw new ManagedEffectDispatchNotAuthorizedError(effectId);
    }
    throw startError;
  }
  if (
    !started.applied ||
    !started.effect ||
    started.effect.status !== EffectStatus.STARTED ||
    started.attempt?.status !== AttemptStatus.STARTED
  ) {
    const afterStart = await readDelivery();
    if (afterStart?.resultFrame) return afterStart.resultFrame;
    if (afterStart?.effect.status === EffectStatus.UNCERTAIN) {
      throw new ManagedEffectUncertainError(effectId, afterStart, undefined);
    }
    throw new ManagedEffectDispatchNotAuthorizedError(effectId);
  }

  let outcome;
  try {
    outcome = await adapter.execute({
      destinationEffectId: started.effect.destinationEffectId,
      destination: adapter.destination,
      identity,
      request,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    return await blockUncertainManagedEffect({
      ledger,
      runId,
      invocationId,
      attemptId: started.attempt.attemptId,
      effectId,
      transitionId: transition('uncertain'),
      actor,
      cause: error,
    });
  }

  const commitAndRead = async () => {
    await ledger.commitManagedEffectOutcome({
      runId,
      invocationId,
      attemptId: started.attempt.attemptId,
      effectId,
      fencingToken: started.attempt.fencingToken,
      generation: started.attempt.generation,
      expectedVersion: started.run.version,
      expectedEffectVersion: started.effect.version,
      transitionId: transition('outcome'),
      outcome,
      actor,
      coordinatorEpoch: started.attempt.coordinatorEpoch,
    });
    const terminal = await readDelivery();
    if (!terminal?.resultFrame) {
      throw new Error(
        `Managed effect outcome was not durably readable: ${effectId}`,
      );
    }
    return terminal.resultFrame;
  };

  try {
    return await commitAndRead();
  } catch (firstError) {
    try {
      return await commitAndRead();
    } catch (secondError) {
      return await blockUncertainManagedEffect({
        ledger,
        runId,
        invocationId,
        attemptId: started.attempt.attemptId,
        effectId,
        transitionId: transition('uncertain'),
        actor,
        cause: new AggregateError([firstError, secondError]),
      });
    }
  }
}

export default executeManagedEffect;
