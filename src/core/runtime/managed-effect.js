import { validateActivityProtocolComponentFrame } from './activity-protocol.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import {
  AttemptStatus,
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
 * @returns {{kind: string, id: string}} - Immutable actor snapshot.
 */
function normalizeManagedEffectActor(value) {
  const actor = cloneJsonObject(
    value === undefined ? DEFAULT_ACTOR : value,
    'executeManagedEffect.actor',
  );
  if (
    Object.keys(actor).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(actor, 'kind') ||
    !Object.prototype.hasOwnProperty.call(actor, 'id')
  ) {
    throw new TypeError('executeManagedEffect.actor requires kind and id.');
  }
  return Object.freeze({
    kind: assertLedgerOpaqueId(actor.kind, 'executeManagedEffect.actor.kind'),
    id: assertLedgerOpaqueId(actor.id, 'executeManagedEffect.actor.id'),
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

/**
 * Execute one Activity Protocol effect request through a durable managed
 * adapter. The adapter is invoked only after this call wins the exact STARTED
 * transition, and its result is returned to the component only after a
 * registered verifier accepts and the outcome transition is durably rebuilt.
 *
 * This is deliberately an internal runtime primitive; public Function/worker
 * paths are not wired to it until their complete transcript lifecycle can use
 * the same ledger aggregate.
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
