import { randomUUID } from 'node:crypto';

import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
} from '../lib/db/tables/execution-ledger.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
import { assertLogicalId } from './logical-id.js';
import { serializeActivityAttemptError } from './activity-attempt.js';

export const MANUAL_LEDGER_INVOCATION_ID = 'manual';

export const ManualLedgerRecoveryAction = Object.freeze({
  NONE: 'none',
  RELEASED_UNSTARTED_CLAIM: 'released-unstarted-claim',
  MARKED_STARTED_UNCERTAIN: 'marked-started-uncertain',
});

/**
 * Version of the deliberately narrow process-local active-owner cancellation
 * port. A host registers this port only for the exact durable STARTED attempt
 * it currently owns; it must discard the port when its registrar disposer is
 * called. The port does not expose a raw AbortController.
 */
export const MANUAL_LEDGER_ACTIVE_ATTEMPT_CANCELLATION_PORT_VERSION = 1;

/**
 * @typedef {{requestId: string}} ManualLedgerActiveAttemptCancellationRequest
 */

/**
 * @typedef {{outcome: 'cancellation-requested'|'terminal-authoritative'|'outcome-uncertain', applied: boolean, signalDelivered: boolean, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} ManualLedgerActiveAttemptCancellationResult
 */

/**
 * A bounded local capability for the exact active manual attempt. `requestId`
 * is a stable opaque request identity supplied by the authenticated owner
 * command path. Its durable transition receipt is independently
 * domain-separated, so peer-controlled request text cannot collide with
 * internal create/claim/start/terminal receipt identities. Actor and reason
 * are deliberately not port inputs: they are fixed at runner setup through
 * `ownerCancellation`, so peer-provided socket data can never become durable
 * cancellation authority metadata.
 * @typedef {{version: number, runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, requestCancellation: (request: ManualLedgerActiveAttemptCancellationRequest) => Promise<ManualLedgerActiveAttemptCancellationResult>}} ManualLedgerActiveAttemptCancellationPort
 */

/**
 * @callback ManualLedgerActiveAttemptCancellationPortRegistrar
 * @param {ManualLedgerActiveAttemptCancellationPort} port - Exact live-attempt cancellation capability.
 * @returns {void|(() => void)} - Optional unregister callback, invoked when ownership ends.
 */

/**
 * @typedef {{code: string, name: string, message: string, details: Record<string, any>}} ManualLedgerOwnerCancellationReason
 */

/**
 * Fixed durable authority for every port request registered by one runner.
 * `reason` is the Activity Protocol structured-error shape; it is normalized
 * again before persistence. Omit this whole descriptor to use the fixed
 * local-owner command reason and the runner's actor.
 * @typedef {{actor?: {kind: string, id: string}, reason?: ManualLedgerOwnerCancellationReason}} ManualLedgerOwnerCancellation
 */

/**
 * @typedef {'none'|'released-unstarted-claim'|'marked-started-uncertain'} ManualLedgerRecoveryActionValue
 */

/**
 * @typedef {{found: boolean, mayExecute: boolean, action: ManualLedgerRecoveryActionValue, changed: boolean, outcome?: ReturnType<typeof outcomeFromState>}} ManualLedgerRecoveryResult
 */

const DEFAULT_ACTOR = Object.freeze({ kind: 'local', id: 'cli' });

const DEFAULT_OWNER_CANCELLATION_REASON = Object.freeze({
  code: 'operator-cancel-requested',
  name: 'CancellationRequested',
  message: 'The active local owner accepted a cancellation command.',
  details: Object.freeze({}),
});

/**
 * Create the durable identity behind a user-facing manual idempotency key. The
 * app ID is part of the semantic input, so two apps can safely use the same
 * operator-provided key in one shared control table.
 * @param {{appId: string, idempotencyKey: string}} options - Manual identity inputs.
 * @returns {string} - Stable opaque ledger run ID.
 */
export function createManualLedgerRunId(options) {
  assertLogicalId(options?.appId, 'appId');
  const idempotencyKey = assertLedgerOpaqueId(
    options?.idempotencyKey,
    'idempotencyKey',
  );
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:manual-ledger-run:v5',
    prefix: 'wlm',
    value: { appId: options.appId, idempotencyKey },
    valuePath: 'manual ledger run identity',
  });
}

/**
 * Derive the internal idempotency receipt for one active-owner cancellation
 * request. The user-visible request ID remains on the cancellation record and
 * is what callers reuse after a lost response; it must not share the internal
 * transition namespace with runner receipts such as `create` or `claim:*`.
 * @param {{runId: string, attemptId: string, requestId: string}} options - Exact active-attempt request identity.
 * @returns {string} - Stable domain-separated transition receipt ID.
 */
function createActiveOwnerCancellationTransitionId(options) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:manual-active-owner-cancellation-transition:v1',
    prefix: 'wlc',
    value: {
      runId: options.runId,
      attemptId: options.attemptId,
      requestId: options.requestId,
    },
    valuePath: 'active owner cancellation transition identity',
  });
}

/**
 * @param {Record<string, any>} run - Durable run projection.
 * @returns {'completed'|'failed'|'blocked'|'in-progress'} - User-visible outcome class.
 */
function dispositionForRun(run) {
  if (run.status === RunStatus.COMPLETED) return 'completed';
  if (run.status === RunStatus.FAILED || run.status === RunStatus.CANCELLED) {
    return 'failed';
  }
  if (run.status === RunStatus.BLOCKED) return 'blocked';
  return 'in-progress';
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {string} invocationId - Durable invocation identity.
 * @returns {Record<string, any>} - Current invocation projection.
 */
function getInvocation(view, invocationId) {
  const invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocationId,
  );
  if (!invocation) {
    throw new Error(
      `Execution ledger run ${view.run.runId} has no invocation ${invocationId}.`,
    );
  }
  return invocation;
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @returns {Record<string, any>} - Current generation's physical attempt.
 */
function getCurrentAttempt(view, invocation) {
  const attempt = view.attempts.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocation.invocationId &&
      candidate.generation === invocation.generation,
  );
  if (!attempt) {
    throw new Error(
      `Execution ledger run ${view.run.runId} has no attempt for invocation generation ${invocation.generation}.`,
    );
  }
  return attempt;
}

/**
 * @param {import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger - Ledger store.
 * @param {string} runId - Durable run identity.
 * @param {string} invocationId - Durable invocation identity.
 * @returns {Promise<{view: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>}>} - Verified current state.
 */
async function readCurrent(ledger, runId, invocationId) {
  const view = await ledger.rebuildRun(runId);
  if (!view) throw new Error(`Execution ledger run disappeared: ${runId}`);
  return { view, run: view.run, invocation: getInvocation(view, invocationId) };
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {string} invocationId - Durable invocation identity.
 * @param {boolean} [reused] - Whether the result came from retained state.
 * @returns {ReturnType<typeof outcomeFromState>} - Current public outcome.
 */
function outcomeFromView(view, invocationId, reused = true) {
  const invocation = getInvocation(view, invocationId);
  const attempt =
    invocation.generation === 0
      ? undefined
      : getCurrentAttempt(view, invocation);
  return outcomeFromState({ run: view.run, invocation, attempt, reused });
}

/**
 * @param {Record<string, any>} run - Current run projection.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @returns {boolean} - Whether state is runnable without asserting ownership.
 */
function mayExecuteFromState(run, invocation) {
  return (
    run.status === RunStatus.RUNNING &&
    invocation.status === InvocationStatus.RUNNABLE
  );
}

/**
 * @param {Record<string, any> | undefined} left - First attempt identity.
 * @param {Record<string, any>} right - Expected attempt identity.
 * @returns {boolean} - Whether both records name the same physical attempt.
 */
function isSameAttempt(left, right) {
  return (
    left?.attemptId === right.attemptId &&
    left?.fencingToken === right.fencingToken &&
    left?.generation === right.generation
  );
}

/**
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, reused?: boolean}} state - Durable state to expose.
 * @returns {{disposition: 'completed'|'failed'|'blocked'|'in-progress', reused: boolean, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, terminalSummary?: Record<string, any>, evidenceRef?: Record<string, any>}} - Public run outcome.
 */
function outcomeFromState({ run, invocation, attempt, reused = false }) {
  /** @type {{disposition: 'completed'|'failed'|'blocked'|'in-progress', reused: boolean, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, terminalSummary?: Record<string, any>, evidenceRef?: Record<string, any>}} */
  const result = {
    disposition: dispositionForRun(run),
    reused,
    run,
    invocation,
  };
  if (attempt) {
    result.attempt = attempt;
    if (attempt.terminal) result.terminalSummary = attempt.terminal;
    if (attempt.evidenceRef) result.evidenceRef = attempt.evidenceRef;
  }
  return result;
}

/**
 * Keep an uncertainty reason well within the first ledger slice's inline
 * payload cap even if a hostile local exception carries enormous metadata.
 * @param {string} phase - Failed lifecycle phase.
 * @param {unknown} error - Local error or rejection.
 * @returns {Record<string, any>} - Compact durable uncertainty reason.
 */
function uncertainReason(phase, error) {
  const serialized = serializeActivityAttemptError(
    error,
    'attempt-outcome-unknown',
  );
  return {
    kind: 'local-attempt-uncertain',
    phase,
    error: {
      code: serialized.code,
      name: serialized.name,
      message: serialized.message.slice(0, 4096),
    },
  };
}

/**
 * @param {string} attemptId - Physical attempt identity.
 * @returns {Record<string, any>} - Static reason for an operator-confirmed recovery.
 */
function preStartRecoveryReason(attemptId) {
  return {
    kind: 'operator-recovery-before-start',
    attemptId,
    message:
      'The operator confirmed the prior local runner stopped before dispatching this attempt.',
  };
}

/**
 * @param {string} attemptId - Physical attempt identity.
 * @returns {Record<string, any>} - Static reason for an operator-confirmed ambiguity decision.
 */
function startedRecoveryReason(attemptId) {
  return {
    kind: 'operator-recovery-after-start',
    attemptId,
    message:
      'The operator confirmed the prior local runner stopped after durable start; the physical outcome is unknown.',
  };
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
      'runManualLedgerActivity.signal must be an AbortSignal when provided.',
    );
  }
}

/**
 * @param {unknown} value - Candidate active-owner port registrar.
 * @returns {void}
 */
function assertOptionalActiveAttemptCancellationPortRegistrar(value) {
  if (value !== undefined && typeof value !== 'function') {
    throw new TypeError(
      'runManualLedgerActivity.registerActiveAttemptCancellationPort must be a function when provided.',
    );
  }
}

/**
 * Normalize the process-local cancellation authority fixed at runner setup.
 * The narrow port intentionally accepts only request IDs, so a peer cannot
 * choose durable actor/reason fields by sending arbitrary command payloads.
 * @param {unknown} value - Candidate fixed owner cancellation descriptor.
 * @param {{kind: string, id: string}} fallbackActor - Actor of the bound local runner.
 * @returns {{actor: {kind: string, id: string}, reason: Record<string, any>}} - Fixed durable cancellation authority.
 */
function normalizeOwnerCancellation(value, fallbackActor) {
  if (
    value !== undefined &&
    (!value || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new TypeError(
      'runManualLedgerActivity.ownerCancellation must be an object when provided.',
    );
  }
  const descriptor = /** @type {Record<string, unknown> | undefined} */ (value);
  if (descriptor) {
    for (const key of Object.keys(descriptor)) {
      if (key !== 'actor' && key !== 'reason') {
        throw new TypeError(
          'runManualLedgerActivity.ownerCancellation accepts only actor and reason.',
        );
      }
    }
  }
  const actor = descriptor?.actor ?? fallbackActor;
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw new TypeError(
      'runManualLedgerActivity.ownerCancellation.actor must be an actor object when provided.',
    );
  }
  const actorRecord = /** @type {Record<string, unknown>} */ (actor);
  const actorKeys = Object.keys(actorRecord);
  if (
    actorKeys.length !== 2 ||
    !Object.prototype.hasOwnProperty.call(actorRecord, 'kind') ||
    !Object.prototype.hasOwnProperty.call(actorRecord, 'id')
  ) {
    throw new TypeError(
      'runManualLedgerActivity.ownerCancellation.actor must contain exactly kind and id.',
    );
  }
  const reason = serializeActivityAttemptError(
    descriptor?.reason ?? DEFAULT_OWNER_CANCELLATION_REASON,
    'cancel-requested',
  );
  return {
    actor: {
      kind: assertLedgerOpaqueId(
        actorRecord.kind,
        'runManualLedgerActivity.ownerCancellation.actor.kind',
      ),
      id: assertLedgerOpaqueId(
        actorRecord.id,
        'runManualLedgerActivity.ownerCancellation.actor.id',
      ),
    },
    reason,
  };
}

/**
 * @param {unknown} value - Candidate bounded port request.
 * @returns {ManualLedgerActiveAttemptCancellationRequest} - Valid request identity.
 */
function normalizeActiveAttemptCancellationPortRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Active attempt cancellation requests must be objects containing requestId.',
    );
  }
  const request = /** @type {Record<string, unknown>} */ (value);
  const keys = Object.keys(request);
  if (keys.length !== 1 || keys[0] !== 'requestId') {
    throw new TypeError(
      'Active attempt cancellation requests accept only requestId.',
    );
  }
  return {
    requestId: assertLedgerOpaqueId(
      request.requestId,
      'active attempt cancellation requestId',
    ),
  };
}

/**
 * @param {Record<string, any>} view - Verified rebuilt ledger view.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @returns {Record<string, any> | undefined} - Current generation attempt.
 */
function maybeCurrentAttempt(view, invocation) {
  return invocation.generation === 0
    ? undefined
    : getCurrentAttempt(view, invocation);
}

/**
 * @param {Record<string, any>} result - Cancellation transition or no-mutation result.
 * @param {boolean} [reused] - Whether the original run already existed.
 * @returns {ReturnType<typeof outcomeFromState>} - Current public outcome.
 */
function outcomeFromCancellationResult(result, reused = false) {
  return outcomeFromState({
    run: result.run,
    invocation: result.invocation,
    ...(result.attempt ? { attempt: result.attempt } : {}),
    reused,
  });
}

/**
 * Persist one active-owner cancellation request against an exact fresh
 * projection. A claim/start transition can win while the signal is arriving,
 * so bounded retries rebind the same stable request ID to the new state. No
 * retry sends a physical signal; the caller does that only after this function
 * returns a durably verified request.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, transitionId: string, requestId: string, actor: Record<string, any>, reason: Record<string, any>}} options - Durable cancellation inputs.
 * @returns {Promise<Record<string, any>>} - Accepted request or authoritative current state.
 */
async function requestActiveOwnerCancellation(options) {
  /**
   * Recover an authoritative result after an optimistic conflict or a lost
   * write response. The verified projection is sufficient here: cancellation
   * is first-wins, and the physical signal still remains gated below on the
   * exact retained STARTED attempt.
   * @param {{view: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>}} current - Fresh verified state.
   * @returns {Record<string, any> | null} - Authoritative synthetic result, if any.
   */
  const authoritativeResult = (current) => {
    const attempt = maybeCurrentAttempt(current.view, current.invocation);
    const result = {
      applied: false,
      run: current.run,
      invocation: current.invocation,
      ...(attempt ? { attempt } : {}),
    };
    if (current.run.cancellationRequest) {
      return { ...result, outcome: 'cancellation-requested' };
    }
    if (
      [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED].includes(
        current.run.status,
      )
    ) {
      return { ...result, outcome: 'terminal-authoritative' };
    }
    if (
      current.run.status === RunStatus.BLOCKED &&
      current.invocation.status === InvocationStatus.UNCERTAIN &&
      attempt?.status === AttemptStatus.ABANDONED
    ) {
      return { ...result, outcome: 'outcome-uncertain' };
    }
    return null;
  };

  /** @type {unknown} */
  let lastConflict;
  for (let retry = 0; retry < 4; retry += 1) {
    const current = await readCurrent(
      options.ledger,
      options.runId,
      options.invocationId,
    );
    const attempt = maybeCurrentAttempt(current.view, current.invocation);
    try {
      return await options.ledger.requestManualRunCancellation({
        runId: options.runId,
        invocationId: options.invocationId,
        expectedVersion: current.run.version,
        expectedGeneration: current.invocation.generation,
        transitionId: options.transitionId,
        requestId: options.requestId,
        reason: options.reason,
        actor: options.actor,
        coordinatorEpoch: attempt?.coordinatorEpoch ?? 0,
        ...(attempt
          ? {
              attemptId: attempt.attemptId,
              fencingToken: attempt.fencingToken,
            }
          : {}),
      });
    } catch (error) {
      // A same-ID/different-payload request is an immutable transition
      // conflict, not a lost response. Never turn it into a successful
      // cancellation merely because some retained request happens to exist.
      if (error instanceof ExecutionLedgerTransitionConflictError) {
        throw error;
      }
      let durable;
      try {
        durable = await readCurrent(
          options.ledger,
          options.runId,
          options.invocationId,
        );
      } catch (verificationError) {
        if (error instanceof ExecutionLedgerConflictError) {
          lastConflict = error;
          continue;
        }
        throw new AggregateError(
          [error, verificationError],
          `Could not verify whether cancellation was persisted for ${options.runId}.`,
        );
      }
      const authoritative = authoritativeResult(durable);
      if (authoritative) return authoritative;
      if (!(error instanceof ExecutionLedgerConflictError)) throw error;
      lastConflict = error;
    }
  }
  throw lastConflict;
}

/**
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, attempt: Record<string, any>, expectedVersion: number, transitionId: string, actor: Record<string, any>, reason: Record<string, any>}} options - Uncertainty transition options.
 * @returns {Promise<{outcome: ReturnType<typeof outcomeFromState>, changed: boolean}>} - Blocked or already terminal outcome with transition ownership.
 */
async function markUncertainOrReadTerminalResult(options) {
  const {
    ledger,
    runId,
    invocationId,
    attempt,
    expectedVersion,
    transitionId,
    actor,
    reason,
  } = options;
  try {
    const result = await ledger.markAttemptUncertain({
      runId,
      invocationId,
      attemptId: attempt.attemptId,
      fencingToken: attempt.fencingToken,
      generation: attempt.generation,
      expectedVersion,
      transitionId,
      actor,
      coordinatorEpoch: 0,
      reason,
    });
    return {
      outcome: outcomeFromState({
        run: result.run,
        invocation: result.invocation,
        attempt: result.attempt,
      }),
      changed: result.applied,
    };
  } catch (markError) {
    const current = await readCurrent(ledger, runId, invocationId);
    const currentAttempt = getCurrentAttempt(current.view, current.invocation);
    if (
      current.run.status !== RunStatus.RUNNING ||
      current.invocation.status !== InvocationStatus.RUNNING ||
      currentAttempt.status !== AttemptStatus.STARTED
    ) {
      return {
        outcome: outcomeFromState({
          run: current.run,
          invocation: current.invocation,
          attempt: currentAttempt,
        }),
        changed: false,
      };
    }
    throw new AggregateError(
      [markError],
      `Could not durably record uncertainty for started attempt ${attempt.attemptId}.`,
    );
  }
}

/**
 * @param {Parameters<typeof markUncertainOrReadTerminalResult>[0]} options - Uncertainty transition options.
 * @returns {Promise<ReturnType<typeof outcomeFromState>>} - Blocked or already terminal outcome.
 */
async function markUncertainOrReadTerminal(options) {
  return (await markUncertainOrReadTerminalResult(options)).outcome;
}

/**
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, expectedAttempt: Record<string, any>, transitionId: string, actor: Record<string, any>, phase: string, error: unknown}} options - Failed local-dispatch state.
 * @returns {Promise<ReturnType<typeof outcomeFromState> | never>} - Blocked/terminal outcome, or rethrows a safely pre-start failure.
 */
async function settleDispatchFailure(options) {
  const {
    ledger,
    runId,
    invocationId,
    expectedAttempt,
    transitionId,
    actor,
    phase,
    error,
  } = options;
  const current = await readCurrent(ledger, runId, invocationId);
  const currentAttempt = getCurrentAttempt(current.view, current.invocation);

  // A stale worker must never repair whichever generation happens to be
  // current. If explicit recovery released this worker's unstarted claim and
  // another owner has already claimed a later generation, that later attempt
  // belongs to the new owner alone.
  if (
    currentAttempt.attemptId !== expectedAttempt.attemptId ||
    currentAttempt.fencingToken !== expectedAttempt.fencingToken ||
    currentAttempt.generation !== expectedAttempt.generation
  ) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: currentAttempt,
    });
  }

  if (currentAttempt.status === AttemptStatus.CLAIMED) {
    await ledger.abandonUnstartedAttempt({
      runId,
      invocationId,
      attemptId: currentAttempt.attemptId,
      fencingToken: currentAttempt.fencingToken,
      generation: currentAttempt.generation,
      expectedVersion: current.run.version,
      transitionId: `abandon:${currentAttempt.attemptId}`,
      actor,
      coordinatorEpoch: 0,
      reason: {
        kind: 'local-pre-start-failure',
        phase,
        message:
          'The local runtime did not receive this claimed attempt start frame.',
      },
    });
    throw error;
  }

  if (currentAttempt.status === AttemptStatus.STARTED) {
    return await markUncertainOrReadTerminal({
      ledger,
      runId,
      invocationId,
      attempt: currentAttempt,
      expectedVersion: current.run.version,
      transitionId,
      actor,
      reason: uncertainReason(phase, error),
    });
  }

  return outcomeFromState({
    run: current.run,
    invocation: current.invocation,
    attempt: currentAttempt,
  });
}

/**
 * Reconcile one existing local manual run without reading, compiling, or
 * dispatching its application source. This exists so an operator can make a
 * begun attempt visibly uncertain even after the current source revision has
 * changed or no longer builds.
 *
 * `mayExecute` means only that no pre-existing started attempt blocks a later
 * execution decision. It is not a coordinator lease and never authorizes a
 * caller to dispatch a changed revision.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId?: string, actor?: {kind: string, id: string}}} options - Existing run recovery request.
 * @returns {Promise<ManualLedgerRecoveryResult>} - Recovered durable state.
 */
export async function recoverManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('recoverManualLedgerActivity requires options.');
  }
  if (!options.ledger) {
    throw new TypeError('recoverManualLedgerActivity requires ledger.');
  }
  const ledger = options.ledger;
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  const invocationId =
    options.invocationId === undefined
      ? MANUAL_LEDGER_INVOCATION_ID
      : assertLedgerOpaqueId(options.invocationId, 'invocationId');
  const actor = options.actor || DEFAULT_ACTOR;
  const view = await ledger.rebuildRun(runId);
  if (!view) {
    return {
      found: false,
      mayExecute: false,
      action: ManualLedgerRecoveryAction.NONE,
      changed: false,
    };
  }

  const invocation = getInvocation(view, invocationId);
  if (invocation.status === InvocationStatus.RUNNABLE) {
    return {
      found: true,
      mayExecute: mayExecuteFromState(view.run, invocation),
      action: ManualLedgerRecoveryAction.NONE,
      changed: false,
      outcome: outcomeFromView(view, invocationId),
    };
  }
  if (invocation.status === InvocationStatus.RUNNING) {
    const attempt = getCurrentAttempt(view, invocation);
    if (attempt.status === AttemptStatus.CLAIMED) {
      try {
        const released = await ledger.abandonUnstartedAttempt({
          runId,
          invocationId,
          attemptId: attempt.attemptId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
          expectedVersion: view.run.version,
          transitionId: `recover-abandon:${attempt.attemptId}`,
          actor,
          coordinatorEpoch: 0,
          reason: preStartRecoveryReason(attempt.attemptId),
        });
        const current = await readCurrent(ledger, runId, invocationId);
        return {
          found: true,
          mayExecute: mayExecuteFromState(current.run, current.invocation),
          action: released.applied
            ? ManualLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM
            : ManualLedgerRecoveryAction.NONE,
          changed: released.applied,
          outcome: outcomeFromView(current.view, invocationId),
        };
      } catch (error) {
        // If a concurrent actor moved the original claim, do not turn a
        // recoverer into a stale owner. A confirmed recovery must still mark
        // that same physical attempt uncertain if it crossed the durable
        // STARTED boundary; it must never touch a newer generation.
        const current = await readCurrent(ledger, runId, invocationId);
        const currentAttempt =
          current.invocation.generation === 0
            ? undefined
            : getCurrentAttempt(current.view, current.invocation);
        if (
          current.run.status === RunStatus.RUNNING &&
          current.invocation.status === InvocationStatus.RUNNING &&
          currentAttempt?.status === AttemptStatus.CLAIMED &&
          isSameAttempt(currentAttempt, attempt)
        ) {
          throw error;
        }
        if (
          current.run.status === RunStatus.RUNNING &&
          current.invocation.status === InvocationStatus.RUNNING &&
          currentAttempt?.status === AttemptStatus.STARTED &&
          isSameAttempt(currentAttempt, attempt)
        ) {
          const recovered = await markUncertainOrReadTerminalResult({
            ledger,
            runId,
            invocationId,
            attempt: currentAttempt,
            expectedVersion: current.run.version,
            transitionId: `recover-uncertain:${currentAttempt.attemptId}`,
            actor,
            reason: startedRecoveryReason(currentAttempt.attemptId),
          });
          return {
            found: true,
            mayExecute: false,
            action: recovered.changed
              ? ManualLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN
              : ManualLedgerRecoveryAction.NONE,
            changed: recovered.changed,
            outcome: recovered.outcome,
          };
        }
        return {
          found: true,
          mayExecute: mayExecuteFromState(current.run, current.invocation),
          action: ManualLedgerRecoveryAction.NONE,
          changed: false,
          outcome: outcomeFromView(current.view, invocationId),
        };
      }
    }
    if (attempt.status === AttemptStatus.STARTED) {
      const recovered = await markUncertainOrReadTerminalResult({
        ledger,
        runId,
        invocationId,
        attempt,
        expectedVersion: view.run.version,
        transitionId: `recover-uncertain:${attempt.attemptId}`,
        actor,
        reason: startedRecoveryReason(attempt.attemptId),
      });
      return {
        found: true,
        mayExecute: false,
        action: recovered.changed
          ? ManualLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN
          : ManualLedgerRecoveryAction.NONE,
        changed: recovered.changed,
        outcome: recovered.outcome,
      };
    }
    return {
      found: true,
      mayExecute: false,
      action: ManualLedgerRecoveryAction.NONE,
      changed: false,
      outcome: outcomeFromView(view, invocationId),
    };
  }

  return {
    found: true,
    mayExecute: false,
    action: ManualLedgerRecoveryAction.NONE,
    changed: false,
    outcome: outcomeFromView(view, invocationId),
  };
}

/**
 * Create, claim, and execute exactly one manual activity through the
 * append-only ledger. A normal repeat never steals a RUNNING attempt because
 * coordinator leases do not exist yet; recovery is a separate operator action
 * that never accepts or compiles current application source.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, appId: string, revisionId: string, activityId: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}, signal?: AbortSignal, ownerCancellation?: ManualLedgerOwnerCancellation, registerActiveAttemptCancellationPort?: ManualLedgerActiveAttemptCancellationPortRegistrar, createFencingToken?: () => string, executeAttempt: (startFrame: Readonly<Record<string, any>>, options: {signal: AbortSignal}) => Promise<Readonly<Record<string, any>>>}} options - Bound manual activity execution.
 * @returns {Promise<ReturnType<typeof outcomeFromState>>} - Durable terminal, blocked, or in-progress result.
 */
export async function runManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('runManualLedgerActivity requires options.');
  }
  if (!options.ledger) {
    throw new TypeError('runManualLedgerActivity requires ledger.');
  }
  if (typeof options.executeAttempt !== 'function') {
    throw new TypeError('runManualLedgerActivity requires executeAttempt.');
  }
  if (Object.prototype.hasOwnProperty.call(options, 'recover')) {
    throw new TypeError(
      'runManualLedgerActivity.recover is not supported; use recoverManualLedgerActivity before a separate execution decision.',
    );
  }
  if (
    options.createFencingToken !== undefined &&
    typeof options.createFencingToken !== 'function'
  ) {
    throw new TypeError(
      'runManualLedgerActivity.createFencingToken must be a function when provided.',
    );
  }
  assertOptionalAbortSignal(options.signal);
  assertOptionalActiveAttemptCancellationPortRegistrar(
    options.registerActiveAttemptCancellationPort,
  );

  const ledger = options.ledger;
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  assertLogicalId(options.appId, 'appId');
  assertLogicalId(options.activityId, 'activityId');
  const invocationId = MANUAL_LEDGER_INVOCATION_ID;
  const actor = options.actor || DEFAULT_ACTOR;
  const ownerCancellation = normalizeOwnerCancellation(
    options.ownerCancellation,
    actor,
  );
  const createFencingToken =
    options.createFencingToken || (() => `local-${randomUUID()}`);

  const created = await ledger.createManualRun({
    runId,
    appId: options.appId,
    revisionId: options.revisionId,
    invocationId,
    activityId: options.activityId,
    ...(Object.prototype.hasOwnProperty.call(options, 'input')
      ? { input: options.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
      ? { callerMetadata: options.callerMetadata }
      : {}),
    transitionId: 'create',
    actor,
    coordinatorEpoch: 0,
  });

  const current = await readCurrent(ledger, runId, invocationId);
  if (current.invocation.status === InvocationStatus.UNCERTAIN) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: !created.applied,
    });
  }
  if (
    current.invocation.status === InvocationStatus.COMPLETED ||
    current.invocation.status === InvocationStatus.FAILED ||
    current.invocation.status === InvocationStatus.CANCELLED
  ) {
    return outcomeFromView(current.view, invocationId, true);
  }

  if (current.invocation.status === InvocationStatus.RUNNING) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: !created.applied,
    });
  }

  if (current.invocation.status !== InvocationStatus.RUNNABLE) {
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      reused: !created.applied,
    });
  }

  if (options.signal?.aborted) {
    const cancellation = await requestActiveOwnerCancellation({
      ledger,
      runId,
      invocationId,
      transitionId: `cancel:${runId}`,
      requestId: `cancel:${runId}`,
      actor,
      reason: serializeActivityAttemptError(
        options.signal.reason,
        'cancel-requested',
      ),
    });
    return outcomeFromCancellationResult(cancellation, !created.applied);
  }

  const fencingToken = assertLedgerOpaqueId(
    createFencingToken(),
    'local fencing token',
  );
  const claim = await ledger.claimInvocation({
    runId,
    invocationId,
    fencingToken,
    expectedGeneration: current.invocation.generation,
    expectedVersion: current.run.version,
    transitionId: `claim:${current.invocation.generation + 1}`,
    actor,
    coordinatorEpoch: 0,
  });
  if (!claim.attempt) {
    throw new Error(`Execution ledger claim has no attempt: ${runId}`);
  }
  const attempt = claim.attempt;
  // Claim receipts are idempotency evidence, not a delivery lease. A replayed
  // claim may belong to a different process, and the post-write read may have
  // already observed recovery or a newer generation. Only the caller that
  // actually appended a still-live CLAIMED transition can advance it to
  // STARTED.
  if (
    !claim.applied ||
    claim.run.status !== RunStatus.RUNNING ||
    claim.invocation.status !== InvocationStatus.RUNNING ||
    attempt.status !== AttemptStatus.CLAIMED
  ) {
    const current = await readCurrent(ledger, runId, invocationId);
    return outcomeFromState({
      run: current.run,
      invocation: current.invocation,
      attempt: getCurrentAttempt(current.view, current.invocation),
      reused: true,
    });
  }

  if (options.signal?.aborted) {
    const cancellation = await requestActiveOwnerCancellation({
      ledger,
      runId,
      invocationId,
      transitionId: `cancel:${runId}`,
      requestId: `cancel:${runId}`,
      actor,
      reason: serializeActivityAttemptError(
        options.signal.reason,
        'cancel-requested',
      ),
    });
    return outcomeFromCancellationResult(cancellation, !created.applied);
  }

  /** @type {any} */
  let started;
  /** @type {Map<string, Promise<ManualLedgerActiveAttemptCancellationResult>>} */
  const cancellationPromises = new Map();
  const deliveredCancellationRequestIds = new Set();
  /** @type {Promise<ManualLedgerActiveAttemptCancellationResult> | null} */
  let foregroundCancellationPromise = null;
  const attemptController = new AbortController();
  /** @type {(() => void) | null} */
  let removeCancellationListener = null;
  /** @type {(() => void) | null} */
  let unregisterActiveAttemptCancellationPort = null;
  let activeAttemptCancellationPort = false;
  try {
    started = await ledger.markAttemptStarted({
      runId,
      invocationId,
      attemptId: attempt.attemptId,
      fencingToken,
      generation: attempt.generation,
      expectedVersion: claim.run.version,
      transitionId: `start:${attempt.attemptId}`,
      actor,
      coordinatorEpoch: 0,
    });
    if (!started.dispatchAuthorized) {
      return await settleDispatchFailure({
        ledger,
        runId,
        invocationId,
        expectedAttempt: attempt,
        transitionId: `uncertain:${attempt.attemptId}`,
        actor,
        phase: 'start-replay',
        error: new Error(
          'The durable attempt-start receipt was replayed; physical dispatch cannot be confirmed.',
        ),
      });
    }

    /**
     * Persist/re-read a single stable request before touching the physical
     * attempt. A port request only signals work when its own request ID is the
     * retained first-wins authority and the rebuilt view still names this
     * exact STARTED attempt. The map makes same-ID deliveries idempotent while
     * still allowing competing IDs to learn which durable request won.
     * @param {string} requestId - Stable caller-facing cancellation identity.
     * @param {{actor: {kind: string, id: string}, reason: Record<string, any>}} cancellation - Fixed authority metadata.
     * @returns {Promise<ManualLedgerActiveAttemptCancellationResult>} - Durable result and local delivery state.
     */
    const beginCancellation = (requestId, cancellation) => {
      const existing = cancellationPromises.get(requestId);
      if (existing) return existing;
      const promise =
        /** @type {Promise<ManualLedgerActiveAttemptCancellationResult>} */ (
          requestActiveOwnerCancellation({
            ledger,
            runId,
            invocationId,
            transitionId: createActiveOwnerCancellationTransitionId({
              runId,
              attemptId: attempt.attemptId,
              requestId,
            }),
            requestId,
            actor: cancellation.actor,
            reason: cancellation.reason,
          }).then((result) => {
            let signalDelivered = false;
            if (
              result.outcome === 'cancellation-requested' &&
              result.run.status === RunStatus.RUNNING &&
              result.invocation.status === InvocationStatus.RUNNING &&
              result.attempt?.status === AttemptStatus.STARTED &&
              isSameAttempt(result.attempt, attempt) &&
              result.run.cancellationRequest?.requestId === requestId
            ) {
              if (!deliveredCancellationRequestIds.has(requestId)) {
                attemptController.abort(result.run.cancellationRequest.reason);
                deliveredCancellationRequestIds.add(requestId);
              }
              signalDelivered = true;
            }
            return /** @type {ManualLedgerActiveAttemptCancellationResult} */ ({
              ...result,
              signalDelivered,
            });
          })
        );
      cancellationPromises.set(requestId, promise);
      // Event listeners and hosts are allowed to fire-and-forget a request.
      // Keep its rejection observed while the runner path later decides
      // whether an execution error makes the outcome uncertain. A failed
      // request must remain retryable with its same stable ID; only a verified
      // retained result stays memoized.
      promise.catch(() => {
        if (cancellationPromises.get(requestId) === promise) {
          cancellationPromises.delete(requestId);
        }
      });
      return promise;
    };

    if (options.registerActiveAttemptCancellationPort) {
      activeAttemptCancellationPort = true;
      /** @type {ManualLedgerActiveAttemptCancellationPort} */
      const port = Object.freeze({
        version: MANUAL_LEDGER_ACTIVE_ATTEMPT_CANCELLATION_PORT_VERSION,
        runId,
        invocationId,
        attemptId: attempt.attemptId,
        fencingToken: attempt.fencingToken,
        generation: attempt.generation,
        requestCancellation: (
          /** @type {ManualLedgerActiveAttemptCancellationRequest} */ request,
        ) => {
          if (!activeAttemptCancellationPort) {
            return Promise.reject(
              new Error(
                `Active attempt cancellation port is no longer live: ${runId}#${attempt.attemptId}.`,
              ),
            );
          }
          let normalized;
          try {
            normalized = normalizeActiveAttemptCancellationPortRequest(request);
          } catch (error) {
            return Promise.reject(error);
          }
          return beginCancellation(normalized.requestId, ownerCancellation);
        },
      });
      const unregister = options.registerActiveAttemptCancellationPort(port);
      if (unregister !== undefined && typeof unregister !== 'function') {
        throw new TypeError(
          'runManualLedgerActivity.registerActiveAttemptCancellationPort must return a function or undefined.',
        );
      }
      unregisterActiveAttemptCancellationPort = unregister || null;
    }

    if (options.signal) {
      const beginForegroundCancellation = () => {
        const reason = serializeActivityAttemptError(
          options.signal?.reason,
          'cancel-requested',
        );
        const promise = beginCancellation(`cancel:${runId}`, {
          actor,
          reason,
        });
        foregroundCancellationPromise = promise;
        return promise;
      };
      const onCancellation = () => {
        beginForegroundCancellation();
      };
      options.signal.addEventListener('abort', onCancellation, { once: true });
      removeCancellationListener = () => {
        options.signal?.removeEventListener('abort', onCancellation);
      };
      if (options.signal.aborted) {
        const cancellation = await beginForegroundCancellation();
        if (
          cancellation.run.status !== RunStatus.RUNNING ||
          cancellation.invocation.status !== InvocationStatus.RUNNING ||
          cancellation.attempt?.status !== AttemptStatus.STARTED ||
          !isSameAttempt(cancellation.attempt, attempt)
        ) {
          return outcomeFromCancellationResult(cancellation, !created.applied);
        }
      }
    }

    let evidence;
    try {
      evidence = await options.executeAttempt(started.startFrame, {
        signal: attemptController.signal,
      });
    } catch (executionError) {
      if (foregroundCancellationPromise) {
        try {
          await foregroundCancellationPromise;
        } catch (cancellationError) {
          throw new AggregateError(
            [executionError, cancellationError],
            'The activity attempt failed while its durable cancellation request was also unavailable.',
          );
        }
      }
      throw executionError;
    }

    // If cancellation was requested while the activity was running, let the
    // durable append settle before choosing the terminal CAS version. A failed
    // append never aborted the internal signal, so complete physical evidence
    // may still win normally.
    await Promise.allSettled([...cancellationPromises.values()]);

    /** @type {unknown[]} */
    const commitErrors = [];
    let expectedVersion = started.run.version;
    for (let commitAttempt = 0; commitAttempt < 2; commitAttempt += 1) {
      try {
        const terminal = await ledger.commitVerifiedAttemptTerminal({
          runId,
          invocationId,
          attemptId: attempt.attemptId,
          fencingToken,
          generation: attempt.generation,
          expectedVersion,
          transitionId: `terminal:${attempt.attemptId}`,
          evidence,
          actor,
          coordinatorEpoch: attempt.coordinatorEpoch,
        });
        return outcomeFromState({
          run: terminal.run,
          invocation: terminal.invocation,
          attempt: terminal.attempt,
          reused: !created.applied,
        });
      } catch (commitError) {
        commitErrors.push(commitError);
        const durable = await readCurrent(ledger, runId, invocationId);
        const durableAttempt = maybeCurrentAttempt(
          durable.view,
          durable.invocation,
        );
        if (!durableAttempt || !isSameAttempt(durableAttempt, attempt)) {
          return outcomeFromState({
            run: durable.run,
            invocation: durable.invocation,
            ...(durableAttempt ? { attempt: durableAttempt } : {}),
            reused: !created.applied,
          });
        }
        if (
          durable.run.status !== RunStatus.RUNNING ||
          durable.invocation.status !== InvocationStatus.RUNNING ||
          durableAttempt.status !== AttemptStatus.STARTED
        ) {
          return outcomeFromState({
            run: durable.run,
            invocation: durable.invocation,
            attempt: durableAttempt,
            reused: !created.applied,
          });
        }
        expectedVersion = durable.run.version;
      }
    }

    return await settleDispatchFailure({
      ledger,
      runId,
      invocationId,
      expectedAttempt: attempt,
      transitionId: `uncertain:${attempt.attemptId}`,
      actor,
      phase: 'terminal-commit',
      error: new AggregateError(
        commitErrors,
        'Could not confirm the durable activity terminal.',
      ),
    });
  } catch (error) {
    return await settleDispatchFailure({
      ledger,
      runId,
      invocationId,
      expectedAttempt: attempt,
      transitionId: `uncertain:${attempt.attemptId}`,
      actor,
      phase: started ? 'runtime-dispatch' : 'start-dispatch',
      error,
    });
  } finally {
    activeAttemptCancellationPort = false;
    removeCancellationListener?.();
    try {
      unregisterActiveAttemptCancellationPort?.();
    } catch {
      // A host disposer cannot change a durable terminal/uncertain outcome.
      // Marking the port inactive before calling it keeps retained callbacks
      // fail-closed even if host cleanup itself throws.
    }
    if (cancellationPromises.size > 0) {
      try {
        await Promise.allSettled([...cancellationPromises.values()]);
      } catch {}
    }
  }
}

export default {
  MANUAL_LEDGER_INVOCATION_ID,
  ManualLedgerRecoveryAction,
  createManualLedgerRunId,
  recoverManualLedgerActivity,
  runManualLedgerActivity,
};
