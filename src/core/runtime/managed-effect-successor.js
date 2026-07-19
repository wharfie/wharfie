import { randomUUID } from 'node:crypto';

import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  validateActivityProtocolComponentFrame,
} from './activity-protocol.js';
import { cloneJsonObject } from './json-value.js';
import { hasSameCanonicalJson } from '../lib/ledger/execution-ledger-contract.js';
import {
  MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID,
  createManagedEffectSuccessorRequestDigest,
  normalizeManagedEffectSuccessorAuthorization,
} from '../lib/ledger/managed-effect-successor-contract.js';

const DEFAULT_ACTOR = Object.freeze({
  kind: 'runtime',
  id: 'managed-effect-successor',
});

const SUCCESSOR_UNCERTAINTY_REASON = Object.freeze({
  kind: 'managed-effect-successor-outcome-unknown',
  phase: 'after-durable-successor-start',
  message:
    'The successor adapter may have begun, but no verifier-backed outcome was durably committed.',
});

/**
 * @param {unknown} value - Candidate ledger API.
 * @returns {import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} - Dedicated successor-capable ledger.
 */
function requireSuccessorLedger(value) {
  const ledger = /** @type {Record<string, any>} */ (value);
  if (
    !ledger ||
    typeof ledger !== 'object' ||
    typeof ledger.rebuildRun !== 'function' ||
    typeof ledger.readManagedEffectDelivery !== 'function' ||
    typeof ledger.startManagedEffectSuccessor !== 'function' ||
    typeof ledger.commitManagedEffectSuccessorOutcome !== 'function' ||
    typeof ledger.interruptManagedEffectSuccessor !== 'function'
  ) {
    throw new TypeError(
      'Managed-effect successor execution requires the dedicated V10 ledger lifecycle.',
    );
  }
  return /** @type {import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */ (
    value
  );
}

/**
 * @param {Record<string, any>} authorization - Exact successor authority.
 * @param {Record<string, any>} request - Retained logical request.
 * @param {string} attemptId - Physical attempt identity.
 * @param {string} effectId - Logical target effect identity.
 * @param {string} label - Validation label.
 * @returns {Readonly<Record<string, any>>} - Complete component effect-request frame.
 */
function createSuccessorEffectRequestFrame(
  authorization,
  request,
  attemptId,
  effectId,
  label,
) {
  const logicalRequest = cloneJsonObject(request, `${label} request`);
  return validateActivityProtocolComponentFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'effect-request',
      attemptId,
      sequence: 1,
      effectId,
      capability: logicalRequest.capability,
      operation: logicalRequest.operation,
      input: logicalRequest.input,
      requestedReplayProperties: logicalRequest.requestedReplayProperties,
    },
    label,
  );
}

/**
 * Resolve the current finite catalog without executing it and prove it remains
 * byte-for-byte the contract pinned by the durable successor trigger.
 * @param {Record<string, any>} authorization - Exact immutable successor authority.
 * @param {Record<string, any>} request - Exact immutable logical request.
 * @param {Record<string, any> | undefined} catalog - Open finite managed-effect catalog.
 * @returns {Record<string, any>} - Verified physical adapter.
 */
function resolvePinnedAdapter(authorization, request, catalog) {
  if (
    !catalog ||
    typeof catalog.resolve !== 'function' ||
    !catalog.destination
  ) {
    throw new TypeError(
      'Managed-effect successor execution requires an executable finite catalog.',
    );
  }
  const preflight = createSuccessorEffectRequestFrame(
    authorization,
    request,
    'successor-contract-preflight',
    authorization.target.effectId,
    'managed effect successor catalog preflight',
  );
  const adapter = catalog.resolve(preflight);
  if (
    !adapter ||
    typeof adapter !== 'object' ||
    typeof adapter.execute !== 'function' ||
    !hasSameCanonicalJson(adapter.descriptor, authorization.contract.adapter) ||
    !hasSameCanonicalJson(
      adapter.destination,
      authorization.contract.destination,
    ) ||
    !hasSameCanonicalJson(adapter.verifier, authorization.contract.verifier) ||
    !hasSameCanonicalJson(
      adapter.substantiatedReplayProperties,
      authorization.contract.substantiatedReplayProperties,
    ) ||
    !hasSameCanonicalJson(
      catalog.destination,
      authorization.contract.destination,
    )
  ) {
    throw new Error(
      'The current managed-effect catalog does not match the successor authorization.',
    );
  }
  return adapter;
}

/**
 * @param {Record<string, any>} view - Verified rebuilt target view.
 * @param {Record<string, any>} authorization - Expected immutable target authority.
 * @returns {{view: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}} - Exact target state.
 */
function normalizeTargetState(view, authorization) {
  const invocation = view?.invocations?.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === authorization.target.invocationId,
  );
  if (
    !view ||
    !view.run ||
    view.run.runId !== authorization.target.runId ||
    view.run.revisionId !== authorization.target.revisionId ||
    !hasSameCanonicalJson(view.run.trigger, authorization) ||
    !invocation ||
    invocation.runId !== authorization.target.runId ||
    invocation.activityId !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID
  ) {
    throw new Error('Managed-effect successor target is unavailable.');
  }
  const effect = view.effects.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocation.invocationId &&
      candidate.effectId === authorization.target.effectId,
  );
  const attempt = effect
    ? view.attempts.find(
        (/** @type {Record<string, any>} */ candidate) =>
          candidate.invocationId === invocation.invocationId &&
          candidate.attemptId === effect.requestedBy?.attemptId,
      )
    : undefined;
  if (effect && !attempt) {
    throw new Error(
      'Managed-effect successor target effect lacks its retained physical attempt.',
    );
  }
  return {
    view,
    invocation,
    ...(attempt ? { attempt } : {}),
    ...(effect ? { effect } : {}),
  };
}

/**
 * @param {import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger - Durable ledger.
 * @param {Record<string, any>} authorization - Expected target authority.
 * @returns {Promise<ReturnType<typeof normalizeTargetState>>} - Fresh verified target state.
 */
async function readTargetState(ledger, authorization) {
  const view = await ledger.rebuildRun(authorization.target.runId);
  if (!view) throw new Error('Managed-effect successor target is unavailable.');
  return normalizeTargetState(view, authorization);
}

/**
 * @param {ReturnType<typeof normalizeTargetState>} state - Current target state.
 * @returns {boolean} - Whether this is the sole state that may attempt dispatch.
 */
function isRunnableTarget(state) {
  return (
    state.view.run.status === 'RUNNING' &&
    state.invocation.status === 'RUNNABLE' &&
    state.invocation.generation === 0 &&
    !state.attempt &&
    !state.effect
  );
}

/**
 * @param {ReturnType<typeof normalizeTargetState>} state - Current target state.
 * @returns {boolean} - Whether one exact durable successor delivery is started.
 */
function isStartedTarget(state) {
  return (
    state.view.run.status === 'RUNNING' &&
    state.invocation.status === 'RUNNING' &&
    state.attempt?.status === 'STARTED' &&
    state.effect?.status === 'STARTED' &&
    state.effect.requestedBy?.attemptId === state.attempt.attemptId &&
    state.effect.startedBy?.attemptId === state.attempt.attemptId
  );
}

/**
 * @param {ReturnType<typeof normalizeTargetState>} state - Current target state.
 * @param {boolean} reused - Whether this caller only observed durable work.
 * @returns {Record<string, any>} - Durable successor outcome.
 */
function retainedSuccessorOutcome(state, reused) {
  const disposition =
    state.view.run.status === 'COMPLETED'
      ? 'completed'
      : state.view.run.status === 'FAILED' ||
          state.view.run.status === 'CANCELLED'
        ? 'failed'
        : state.view.run.status === 'BLOCKED'
          ? 'blocked'
          : 'in-progress';
  /** @type {Record<string, any>} */
  const outcome = {
    disposition,
    reused,
    run: state.view.run,
    invocation: state.invocation,
  };
  if (state.attempt) {
    outcome.attempt = state.attempt;
    if (state.attempt.terminal)
      outcome.terminalSummary = state.attempt.terminal;
    if (state.attempt.evidenceRef)
      outcome.evidenceRef = state.attempt.evidenceRef;
  }
  if (state.effect) outcome.effect = state.effect;
  return outcome;
}

/**
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, effect: Record<string, any>, request: Record<string, any>}} delivery - Rehashed retained delivery.
 * @param {Record<string, any>} authorization - Expected target authority.
 * @param {Record<string, any>} request - Expected logical request.
 * @returns {Readonly<Record<string, any>>} - Exact delivery frame for the adapter.
 */
function validateStartedDelivery(delivery, authorization, request) {
  if (
    delivery.run.status !== 'RUNNING' ||
    delivery.invocation.status !== 'RUNNING' ||
    delivery.attempt.status !== 'STARTED' ||
    delivery.effect.status !== 'STARTED' ||
    delivery.invocation.invocationId !== authorization.target.invocationId ||
    delivery.effect.effectId !== authorization.target.effectId ||
    delivery.effect.destinationEffectId !==
      authorization.target.destinationEffectId ||
    delivery.effect.requestedBy?.attemptId !== delivery.attempt.attemptId ||
    delivery.effect.startedBy?.attemptId !== delivery.attempt.attemptId ||
    !hasSameCanonicalJson(delivery.run.trigger, authorization) ||
    !hasSameCanonicalJson(delivery.request, request) ||
    !hasSameCanonicalJson(
      delivery.effect.adapter,
      authorization.contract.adapter,
    ) ||
    !hasSameCanonicalJson(
      delivery.effect.destination,
      authorization.contract.destination,
    ) ||
    !hasSameCanonicalJson(
      delivery.effect.verifier,
      authorization.contract.verifier,
    )
  ) {
    throw new Error(
      'Managed-effect successor durable start does not match its retained authority.',
    );
  }
  return createSuccessorEffectRequestFrame(
    authorization,
    delivery.request,
    delivery.attempt.attemptId,
    delivery.effect.effectId,
    'managed effect successor delivery',
  );
}

/**
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, authorization: Record<string, any>, actor: {kind: string, id: string}}} options - Target-only interruption inputs.
 * @returns {Promise<Record<string, any>>} - Verified retained outcome after an interruption decision.
 */
async function interruptStartedSuccessor(options) {
  const current = await readTargetState(options.ledger, options.authorization);
  if (!isStartedTarget(current)) {
    return retainedSuccessorOutcome(current, true);
  }
  const attempt = /** @type {Record<string, any>} */ (current.attempt);
  const effect = /** @type {Record<string, any>} */ (current.effect);
  try {
    await options.ledger.interruptManagedEffectSuccessor({
      runId: options.authorization.target.runId,
      fencingToken: attempt.fencingToken,
      generation: attempt.generation,
      expectedVersion: current.view.run.version,
      expectedEffectVersion: effect.version,
      transitionId: 'successor-interrupted',
      reason: SUCCESSOR_UNCERTAINTY_REASON,
      actor: options.actor,
      coordinatorEpoch: attempt.coordinatorEpoch,
    });
  } catch (interruptError) {
    let after;
    try {
      after = await readTargetState(options.ledger, options.authorization);
    } catch (readError) {
      throw new AggregateError(
        [interruptError, readError],
        'Could not durably interrupt the managed-effect successor.',
      );
    }
    if (isStartedTarget(after)) {
      throw new AggregateError(
        [interruptError],
        'Could not durably interrupt the managed-effect successor.',
      );
    }
    return retainedSuccessorOutcome(after, true);
  }
  return retainedSuccessorOutcome(
    await readTargetState(options.ledger, options.authorization),
    false,
  );
}

/**
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, authorization: Record<string, any>, actor: {kind: string, id: string}, outcome: Record<string, any>}} options - Target-only terminal commit inputs.
 * @returns {Promise<Record<string, any>>} - Verified terminal or blocked outcome.
 */
async function commitStartedSuccessorOutcome(options) {
  /**
   * @param {ReturnType<typeof normalizeTargetState>} state - Exact current started state.
   * @returns {Promise<Record<string, any>>} - Atomic terminal result.
   */
  const commit = async (state) =>
    await options.ledger.commitManagedEffectSuccessorOutcome(
      (() => {
        const attempt = /** @type {Record<string, any>} */ (state.attempt);
        const effect = /** @type {Record<string, any>} */ (state.effect);
        return {
          runId: options.authorization.target.runId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
          expectedVersion: state.view.run.version,
          expectedEffectVersion: effect.version,
          transitionId: 'successor-terminal',
          outcome: options.outcome,
          actor: options.actor,
          coordinatorEpoch: attempt.coordinatorEpoch,
        };
      })(),
    );

  const initial = await readTargetState(options.ledger, options.authorization);
  if (!isStartedTarget(initial)) {
    return retainedSuccessorOutcome(initial, true);
  }
  try {
    await commit(initial);
  } catch (firstCommitError) {
    let afterFirst;
    try {
      afterFirst = await readTargetState(options.ledger, options.authorization);
    } catch (readError) {
      throw new AggregateError(
        [firstCommitError, readError],
        'Could not verify the managed-effect successor terminal response.',
      );
    }
    if (!isStartedTarget(afterFirst)) {
      return retainedSuccessorOutcome(afterFirst, true);
    }
    try {
      await commit(afterFirst);
    } catch (secondCommitError) {
      let afterSecond;
      try {
        afterSecond = await readTargetState(
          options.ledger,
          options.authorization,
        );
      } catch (readError) {
        throw new AggregateError(
          [firstCommitError, secondCommitError, readError],
          'Could not verify or close the managed-effect successor terminal response.',
        );
      }
      if (!isStartedTarget(afterSecond)) {
        return retainedSuccessorOutcome(afterSecond, true);
      }
      try {
        return await interruptStartedSuccessor({
          ledger: options.ledger,
          authorization: options.authorization,
          actor: options.actor,
        });
      } catch (interruptError) {
        throw new AggregateError(
          [firstCommitError, secondCommitError, interruptError],
          'Could not settle or conservatively interrupt the managed-effect successor.',
        );
      }
    }
  }
  return retainedSuccessorOutcome(
    await readTargetState(options.ledger, options.authorization),
    false,
  );
}

/**
 * @param {unknown} value - Candidate target-only executor inputs.
 * @returns {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, authorization: Record<string, any>, request: Record<string, any>, catalog?: Record<string, any>, actor: {kind: string, id: string}, createFencingToken: () => string}} - Validated executor inputs.
 */
function normalizeExecutorOptions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('executeManagedEffectSuccessorRun requires options.');
  }
  if (Object.prototype.hasOwnProperty.call(value, 'signal')) {
    throw new TypeError(
      'Managed-effect successor execution does not support cancellation.',
    );
  }
  const options = /** @type {Record<string, any>} */ (value);
  const ledger = requireSuccessorLedger(options.ledger);
  const authorization = normalizeManagedEffectSuccessorAuthorization(
    options.authorization,
  );
  const request = cloneJsonObject(
    options.request,
    'managed effect successor request',
  );
  if (
    createManagedEffectSuccessorRequestDigest(request) !==
    authorization.target.requestDigest
  ) {
    throw new Error(
      'Managed-effect successor request does not match its durable authorization.',
    );
  }
  if (
    options.createFencingToken !== undefined &&
    typeof options.createFencingToken !== 'function'
  ) {
    throw new TypeError(
      'executeManagedEffectSuccessorRun.createFencingToken must be a function when provided.',
    );
  }
  return {
    ledger,
    authorization,
    request,
    ...(options.catalog ? { catalog: options.catalog } : {}),
    actor: options.actor || DEFAULT_ACTOR,
    createFencingToken:
      options.createFencingToken || (() => `local-${randomUUID()}`),
  };
}

/**
 * Execute one effect-only successor without loading or replaying its source
 * application activity. The only adapter entry is immediately after the
 * dedicated atomic start transition creates both STARTED attempt and effect.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, authorization: Record<string, any>, request: Record<string, any>, catalog?: Record<string, any>, actor?: {kind: string, id: string}, createFencingToken?: () => string}} options - Target-only execution authority.
 * @returns {Promise<{authorization: Record<string, any>, outcome: Record<string, any>}>} - Durable target outcome.
 */
export async function executeManagedEffectSuccessorRun(options) {
  const normalized = normalizeExecutorOptions(options);
  const current = await readTargetState(
    normalized.ledger,
    normalized.authorization,
  );
  if (!isRunnableTarget(current)) {
    return {
      authorization: normalized.authorization,
      outcome: retainedSuccessorOutcome(current, true),
    };
  }

  // Catalog drift must fail before the target crosses its irreversible
  // STARTED boundary. It is required only for a still-runnable target.
  const adapter = resolvePinnedAdapter(
    normalized.authorization,
    normalized.request,
    normalized.catalog,
  );
  const fencingToken = normalized.createFencingToken();
  if (typeof fencingToken !== 'string') {
    throw new TypeError(
      'executeManagedEffectSuccessorRun.createFencingToken must return a string.',
    );
  }

  let started;
  try {
    started = await normalized.ledger.startManagedEffectSuccessor({
      runId: normalized.authorization.target.runId,
      fencingToken,
      expectedVersion: current.view.run.version,
      transitionId: 'successor-start',
      actor: normalized.actor,
      coordinatorEpoch: 0,
    });
  } catch (startError) {
    let afterStart;
    try {
      afterStart = await readTargetState(
        normalized.ledger,
        normalized.authorization,
      );
    } catch (readError) {
      throw new AggregateError(
        [startError, readError],
        'Could not verify the managed-effect successor start response.',
      );
    }
    if (!isRunnableTarget(afterStart)) {
      return {
        authorization: normalized.authorization,
        outcome: retainedSuccessorOutcome(afterStart, true),
      };
    }
    throw startError;
  }
  if (!started.dispatchAuthorized) {
    return {
      authorization: normalized.authorization,
      outcome: retainedSuccessorOutcome(
        await readTargetState(normalized.ledger, normalized.authorization),
        true,
      ),
    };
  }

  // Rehash the actual request/effect immediately before adapter entry. A
  // failed read is conservatively converted to destination uncertainty rather
  // than reopening generic execution or attempting a second dispatch.
  let delivery;
  let requestFrame;
  try {
    delivery = await normalized.ledger.readManagedEffectDelivery(
      normalized.authorization.target.runId,
      normalized.authorization.target.invocationId,
      normalized.authorization.target.effectId,
    );
    if (!delivery) {
      throw new Error('Managed-effect successor delivery disappeared.');
    }
    requestFrame = validateStartedDelivery(
      /** @type {{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, effect: Record<string, any>, request: Record<string, any>}} */ (
        delivery
      ),
      normalized.authorization,
      normalized.request,
    );
  } catch (deliveryError) {
    try {
      return {
        authorization: normalized.authorization,
        outcome: await interruptStartedSuccessor({
          ledger: normalized.ledger,
          authorization: normalized.authorization,
          actor: normalized.actor,
        }),
      };
    } catch (interruptError) {
      throw new AggregateError(
        [deliveryError, interruptError],
        'Could not verify or conservatively interrupt the managed-effect successor delivery.',
      );
    }
  }

  /** @type {Record<string, any>} */
  let adapterOutcome;
  try {
    adapterOutcome = await adapter.execute({
      destinationEffectId: delivery.effect.destinationEffectId,
      destination: adapter.destination,
      identity: {
        runId: delivery.run.runId,
        invocationId: delivery.invocation.invocationId,
        attemptId: delivery.attempt.attemptId,
        effectId: delivery.effect.effectId,
      },
      request: requestFrame,
    });
  } catch (adapterError) {
    try {
      return {
        authorization: normalized.authorization,
        outcome: await interruptStartedSuccessor({
          ledger: normalized.ledger,
          authorization: normalized.authorization,
          actor: normalized.actor,
        }),
      };
    } catch (interruptError) {
      throw new AggregateError(
        [adapterError, interruptError],
        'The successor adapter failed and its durable uncertainty boundary could not be verified.',
      );
    }
  }

  return {
    authorization: normalized.authorization,
    outcome: await commitStartedSuccessorOutcome({
      ledger: normalized.ledger,
      authorization: normalized.authorization,
      actor: normalized.actor,
      outcome: adapterOutcome,
    }),
  };
}

/**
 * Conservatively stop a retained target after an owner has confirmed the
 * prior successor process is gone. This routine deliberately never invokes
 * the adapter; reconciliation from destination truth is a later operation.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, actor?: {kind: string, id: string}}} options - Source-free retained target recovery inputs.
 * @returns {Promise<{authorization: Record<string, any>, outcome: Record<string, any>} | null>} - Verified target recovery state.
 */
export async function recoverManagedEffectSuccessorRun(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('recoverManagedEffectSuccessorRun requires options.');
  }
  const ledger = requireSuccessorLedger(options.ledger);
  const view = await ledger.rebuildRun(options.runId);
  if (!view) return null;
  const authorization = normalizeManagedEffectSuccessorAuthorization(
    view.run.trigger,
  );
  const state = normalizeTargetState(view, authorization);
  return {
    authorization,
    outcome: isStartedTarget(state)
      ? await interruptStartedSuccessor({
          ledger,
          authorization,
          actor: options.actor || DEFAULT_ACTOR,
        })
      : retainedSuccessorOutcome(state, true),
  };
}
