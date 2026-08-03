import { randomUUID } from 'node:crypto';

import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
} from '../lib/db/tables/execution-ledger.js';
import {
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES,
  assertLedgerOpaqueId,
} from '../lib/ledger/record-key.js';
import { assertApplicationRevisionId } from './application-revision.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
import { assertLogicalId } from './logical-id.js';
import { serializeActivityAttemptError } from './activity-attempt.js';
import { createDurableActivityLogSink } from './activity-log-sink.js';

export const MANUAL_LEDGER_INVOCATION_ID = 'manual';

/**
 * @typedef {{accepted: true, reused: boolean, runId: string, appId: string, revisionId: string, invocationId: string, activityId: string, runStatus: string, invocationStatus: string}} ManualLedgerSubmissionResult
 */

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
 * @typedef {{outcome: 'cancellation-requested'|'terminal-authoritative'|'outcome-uncertain'|'attempt-not-current', applied: boolean, signalDelivered: boolean, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} ManualLedgerActiveAttemptCancellationResult
 */

/**
 * @typedef {{attemptId: string, fencingToken: string, generation: number, coordinatorEpoch: number, status: 'CLAIMED'|'STARTED'}} ManualLedgerCancellationAttemptFence
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
 * Stable identity available after this process has durably claimed a fresh
 * physical attempt but before it crosses the durable STARTED boundary.
 * @typedef {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number}} ManualLedgerAttemptDispatchContext
 */

/**
 * Resources acquired specifically for one fresh physical dispatch. `release`
 * is awaited only after durable outcome selection and local cancellation
 * cleanup have both settled.
 * @typedef {{executeAttempt: (startFrame: Readonly<Record<string, any>>, options: {signal: AbortSignal, onComponentFrame: (frame: Readonly<Record<string, any>>) => Promise<void>}) => Promise<Readonly<Record<string, any>>>, release: () => void|Promise<void>}} ManualLedgerPreparedAttemptDispatch
 */

/**
 * @typedef {'none'|'released-unstarted-claim'|'marked-started-uncertain'} ManualLedgerRecoveryActionValue
 */

/**
 * @typedef {{found: boolean, mayExecute: boolean, action: ManualLedgerRecoveryActionValue, changed: boolean, outcome?: ReturnType<typeof outcomeFromState>}} ManualLedgerRecoveryResult
 */

/**
 * @typedef {{found: boolean, changed: boolean, reconciliationId?: string, outcome?: ReturnType<typeof outcomeFromState>, view?: Record<string, any>}} ManualLedgerReconciliationResult
 */

const DEFAULT_ACTOR = Object.freeze({ kind: 'local', id: 'cli' });

const MANUAL_RECONCILIATION_TRANSITION_PREFIX = 'reconcile:';

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
    domain: 'wharfie:manual-ledger-run:v10',
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
 * A reconciliation ID is public retry identity. Its durable receipt uses the
 * simple, inspectable `reconcile:` namespace rather than a generated ID so a
 * response-loss retry reaches exactly the original transition. Reserve room
 * for that namespace before accepting the caller's opaque identity.
 * @param {unknown} value - Candidate stable reconciliation identity.
 * @returns {{reconciliationId: string, transitionId: string}} - Caller and receipt identities.
 */
function resolveManualReconciliationIdentity(value) {
  const reconciliationId = assertLedgerOpaqueId(value, 'reconciliationId');
  const transitionId = `${MANUAL_RECONCILIATION_TRANSITION_PREFIX}${reconciliationId}`;
  if (
    Buffer.byteLength(transitionId, 'utf8') >
    MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES
  ) {
    throw new RangeError(
      `reconciliationId must leave room for the ${MANUAL_RECONCILIATION_TRANSITION_PREFIX} transition namespace.`,
    );
  }
  return { reconciliationId, transitionId };
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
 * @param {string} [label] - Human-readable option name.
 * @returns {void}
 */
function assertOptionalAbortSignal(
  value,
  label = 'runManualLedgerActivity.signal',
) {
  if (
    value !== undefined &&
    (!value ||
      typeof value !== 'object' ||
      typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
        'function' ||
      typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
        'function')
  ) {
    throw new TypeError(`${label} must be an AbortSignal when provided.`);
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
 * Require the acquisition hook to return one unambiguous executor/resource
 * pair. Reflective own-key validation also rejects hidden and symbol fields,
 * keeping the host-side capability surface deliberately closed.
 * @param {unknown} value - Candidate prepared dispatch resources.
 * @returns {ManualLedgerPreparedAttemptDispatch} - Exact executor and disposer pair.
 */
function normalizePreparedAttemptDispatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'runManualLedgerActivity.prepareAttemptDispatch must return an object containing exactly executeAttempt and release.',
    );
  }
  const prepared = /** @type {Record<string, unknown>} */ (value);
  const keys = Reflect.ownKeys(prepared);
  if (
    keys.length !== 2 ||
    !keys.includes('executeAttempt') ||
    !keys.includes('release')
  ) {
    throw new TypeError(
      'runManualLedgerActivity.prepareAttemptDispatch must return exactly executeAttempt and release.',
    );
  }
  if (typeof prepared.executeAttempt !== 'function') {
    throw new TypeError(
      'runManualLedgerActivity.prepareAttemptDispatch.executeAttempt must be a function.',
    );
  }
  if (typeof prepared.release !== 'function') {
    throw new TypeError(
      'runManualLedgerActivity.prepareAttemptDispatch.release must be a function.',
    );
  }
  return /** @type {ManualLedgerPreparedAttemptDispatch} */ ({
    executeAttempt: prepared.executeAttempt,
    release: prepared.release,
  });
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
 * Snapshot the exact physical attempt a cancellation caller is authorized to
 * affect. Active status is part of the fence because operator recovery can
 * revoke ownership by retaining the same identity as an ABANDONED attempt.
 * @param {unknown} value - Candidate exact attempt fence.
 * @returns {Readonly<ManualLedgerCancellationAttemptFence> | undefined} - Valid immutable fence.
 */
function normalizeCancellationAttemptFence(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Cancellation expectedAttempt must be an object.');
  }
  const candidate = /** @type {Record<string, unknown>} */ (value);
  const keys = Reflect.ownKeys(candidate);
  const expectedKeys = [
    'attemptId',
    'fencingToken',
    'generation',
    'coordinatorEpoch',
    'status',
  ];
  if (
    keys.length !== expectedKeys.length ||
    expectedKeys.some((key) => !keys.includes(key))
  ) {
    throw new TypeError(
      'Cancellation expectedAttempt must contain exactly attemptId, fencingToken, generation, coordinatorEpoch, and status.',
    );
  }
  if (
    !Number.isSafeInteger(candidate.generation) ||
    Number(candidate.generation) < 1
  ) {
    throw new TypeError(
      'Cancellation expectedAttempt.generation must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(candidate.coordinatorEpoch) ||
    Number(candidate.coordinatorEpoch) < 0
  ) {
    throw new TypeError(
      'Cancellation expectedAttempt.coordinatorEpoch must be a non-negative safe integer.',
    );
  }
  if (
    candidate.status !== AttemptStatus.CLAIMED &&
    candidate.status !== AttemptStatus.STARTED
  ) {
    throw new TypeError(
      'Cancellation expectedAttempt.status must be CLAIMED or STARTED.',
    );
  }
  return Object.freeze({
    attemptId: assertLedgerOpaqueId(
      candidate.attemptId,
      'cancellation expectedAttempt.attemptId',
    ),
    fencingToken: assertLedgerOpaqueId(
      candidate.fencingToken,
      'cancellation expectedAttempt.fencingToken',
    ),
    generation: Number(candidate.generation),
    coordinatorEpoch: Number(candidate.coordinatorEpoch),
    status: candidate.status,
  });
}

/**
 * @param {Record<string, any>} attempt - Durable attempt projection.
 * @returns {Readonly<ManualLedgerCancellationAttemptFence>} - Exact retry fence.
 */
function cancellationAttemptFence(attempt) {
  return /** @type {Readonly<ManualLedgerCancellationAttemptFence>} */ (
    normalizeCancellationAttemptFence({
      attemptId: attempt.attemptId,
      fencingToken: attempt.fencingToken,
      generation: attempt.generation,
      coordinatorEpoch: attempt.coordinatorEpoch,
      status: attempt.status,
    })
  );
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
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, transitionId: string, requestId: string, actor: Record<string, any>, reason: Record<string, any>, expectedAttempt?: ManualLedgerCancellationAttemptFence}} options - Durable cancellation inputs.
 * @returns {Promise<Record<string, any>>} - Accepted request or authoritative current state.
 */
async function requestActiveOwnerCancellation(options) {
  const expectedAttempt = normalizeCancellationAttemptFence(
    options.expectedAttempt,
  );
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

  /**
   * Return the current projection without allowing a stale caller to rebind its
   * cancellation identity to a successor generation.
   * @param {{view: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>}} current - Fresh verified state.
   * @returns {Record<string, any> | null} - Non-mutating stale result when fenced ownership was lost.
   */
  const staleAttemptResult = (current) => {
    if (!expectedAttempt) return null;
    const attempt = maybeCurrentAttempt(current.view, current.invocation);
    if (
      attempt &&
      isSameAttempt(attempt, expectedAttempt) &&
      attempt.coordinatorEpoch === expectedAttempt.coordinatorEpoch &&
      attempt.status === expectedAttempt.status
    ) {
      return null;
    }
    return (
      authoritativeResult(current) || {
        outcome: 'attempt-not-current',
        applied: false,
        run: current.run,
        invocation: current.invocation,
        ...(attempt ? { attempt } : {}),
      }
    );
  };

  /** @type {unknown} */
  let lastConflict;
  for (let retry = 0; retry < 4; retry += 1) {
    const current = await readCurrent(
      options.ledger,
      options.runId,
      options.invocationId,
    );
    const staleCurrent = staleAttemptResult(current);
    if (staleCurrent) return staleCurrent;
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
      // A same-ID/different-payload request remains an immutable transition
      // conflict while this caller still owns the expected active state. If
      // recovery or a successor won concurrently, return that authoritative
      // state without letting the stale caller affect it.
      if (error instanceof ExecutionLedgerTransitionConflictError) {
        if (expectedAttempt) {
          let durable;
          try {
            durable = await readCurrent(
              options.ledger,
              options.runId,
              options.invocationId,
            );
          } catch (verificationError) {
            throw new AggregateError(
              [error, verificationError],
              `Could not verify whether cancellation ownership was retained for ${options.runId}.`,
            );
          }
          const staleDurable = staleAttemptResult(durable);
          if (staleDurable) return staleDurable;
        }
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
      const staleDurable = staleAttemptResult(durable);
      if (staleDurable) return staleDurable;
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
 * Locate the immutable uncertainty transition which created the current
 * abandoned physical attempt. The attempt deliberately remains unchanged by
 * reconciliation, so its `lastSequence` keeps naming this exact event even
 * after a terminal reconciliation is appended. That also lets a same-ID
 * response-loss retry supply the original expected version and target.
 * @param {Record<string, any>} view - Verified run history.
 * @param {Record<string, any>} invocation - Current manual invocation.
 * @param {Record<string, any>} attempt - Retained physical attempt.
 * @returns {Record<string, any>} - Exact prior uncertainty event.
 */
function getRetainedUncertaintyEvent(view, invocation, attempt) {
  const event = view.events.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.type === 'attempt-became-uncertain' &&
      candidate.sequence === attempt.lastSequence &&
      candidate.fence?.coordinatorEpoch === attempt.coordinatorEpoch &&
      candidate.fence?.invocationGeneration === attempt.generation &&
      candidate.payload?.attempt?.invocationId === invocation.invocationId &&
      candidate.payload?.attempt?.attemptId === attempt.attemptId &&
      candidate.payload?.attempt?.generation === attempt.generation &&
      candidate.payload?.attempt?.fencingToken === attempt.fencingToken &&
      candidate.payload?.attempt?.status === AttemptStatus.ABANDONED,
  );
  if (!event) {
    throw new ExecutionLedgerConflictError(
      view.run.runId,
      'manual attempt has no retained uncertainty transition',
    );
  }
  return event;
}

/**
 * Reconcile a retained uncertain manual attempt with host transcript evidence
 * only. This helper neither loads application source nor retries/rebases a
 * race: the core transition owns the exact original uncertainty fence and
 * its stable receipt identity. A live LMDB runner must be excluded by the
 * caller's local ownership fence before this helper is entered.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId?: string, reconciliationId: string, evidence: Record<string, any>, reason?: Record<string, any>, actor?: {kind: string, id: string}}} options - Exact source-independent reconciliation request.
 * @returns {Promise<ManualLedgerReconciliationResult>} - Reconciliation result and verified readback.
 */
export async function reconcileManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('reconcileManualLedgerActivity requires options.');
  }
  if (!options.ledger) {
    throw new TypeError('reconcileManualLedgerActivity requires ledger.');
  }
  if (
    !options.evidence ||
    typeof options.evidence !== 'object' ||
    Array.isArray(options.evidence)
  ) {
    throw new TypeError(
      'reconcileManualLedgerActivity.evidence must be a JSON object.',
    );
  }
  if (
    options.reason !== undefined &&
    (!options.reason ||
      typeof options.reason !== 'object' ||
      Array.isArray(options.reason))
  ) {
    throw new TypeError(
      'reconcileManualLedgerActivity.reason must be an object when provided.',
    );
  }

  const ledger = options.ledger;
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  const invocationId =
    options.invocationId === undefined
      ? MANUAL_LEDGER_INVOCATION_ID
      : assertLedgerOpaqueId(options.invocationId, 'invocationId');
  const { reconciliationId, transitionId } =
    resolveManualReconciliationIdentity(options.reconciliationId);
  const actor = options.actor || DEFAULT_ACTOR;
  const reason =
    options.reason ||
    Object.freeze({
      kind: 'operator-evidence-reconciliation',
      reconciliationId,
    });
  const view = await ledger.rebuildRun(runId);
  if (!view) {
    return { found: false, changed: false };
  }

  const invocation = getInvocation(view, invocationId);
  if (invocation.generation === 0) {
    throw new ExecutionLedgerConflictError(
      runId,
      'manual invocation has no retained uncertain attempt',
    );
  }
  const attempt = getCurrentAttempt(view, invocation);
  if (attempt.status !== AttemptStatus.ABANDONED) {
    throw new ExecutionLedgerConflictError(
      runId,
      'manual invocation has no retained uncertain attempt',
    );
  }
  const uncertaintyEvent = getRetainedUncertaintyEvent(
    view,
    invocation,
    attempt,
  );
  const retainedReconciliationEvent = view.events.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.transition_id === transitionId,
  );
  const expectedVersion = retainedReconciliationEvent
    ? retainedReconciliationEvent.payload?.run?.version - 1
    : view.run.version;
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new ExecutionLedgerConflictError(
      runId,
      'retained reconciliation boundary has no valid run version',
    );
  }

  const result = await ledger.reconcileUncertainManualAttempt({
    runId,
    invocationId: invocation.invocationId,
    attemptId: attempt.attemptId,
    fencingToken: attempt.fencingToken,
    generation: attempt.generation,
    coordinatorEpoch: attempt.coordinatorEpoch,
    expectedVersion,
    uncertaintyEventId: uncertaintyEvent.event_id,
    uncertaintySequence: uncertaintyEvent.sequence,
    transitionId,
    reconciliationId,
    actor,
    reason,
    evidence: options.evidence,
  });
  const current = await ledger.rebuildRun(runId);
  if (!current) {
    throw new Error(`Execution ledger run disappeared: ${runId}`);
  }
  return {
    found: true,
    changed: result.applied,
    reconciliationId,
    outcome: outcomeFromView(current, invocation.invocationId, !result.applied),
    view: current,
  };
}

/**
 * Persist one manual activity request without claiming or dispatching it. The
 * retained creation receipt is the durable submission boundary: an identical
 * retry returns `reused: true`, while changed work under the same run identity
 * remains a visible ledger conflict.
 *
 * This deliberately returns only stable identity and lifecycle fields. Input,
 * caller metadata, payload references, event actors, and fencing material stay
 * behind the verified ledger read boundary.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, appId: string, revisionId: string, activityId: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}}} options - Bound manual activity submission.
 * @returns {Promise<ManualLedgerSubmissionResult>} - Compact durable acceptance result.
 */
export async function submitManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('submitManualLedgerActivity requires options.');
  }
  const allowedKeys = new Set([
    'ledger',
    'runId',
    'appId',
    'revisionId',
    'activityId',
    'input',
    'callerMetadata',
    'actor',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(
        `submitManualLedgerActivity.${key} is not supported.`,
      );
    }
  }
  if (!options.ledger) {
    throw new TypeError('submitManualLedgerActivity requires ledger.');
  }
  const ledger = options.ledger;
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  assertLogicalId(options.appId, 'appId');
  const appId = options.appId;
  assertApplicationRevisionId(options.revisionId, 'revisionId');
  const revisionId = options.revisionId;
  assertLogicalId(options.activityId, 'activityId');
  const activityId = options.activityId;

  const created = await ledger.createManualRun({
    runId,
    appId,
    revisionId,
    invocationId: MANUAL_LEDGER_INVOCATION_ID,
    activityId,
    ...(Object.prototype.hasOwnProperty.call(options, 'input')
      ? { input: options.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
      ? { callerMetadata: options.callerMetadata }
      : {}),
    transitionId: 'create',
    ...(Object.prototype.hasOwnProperty.call(options, 'actor')
      ? { actor: options.actor }
      : {}),
    coordinatorEpoch: 0,
  });

  if (
    created.run.runId !== runId ||
    created.run.appId !== appId ||
    created.run.revisionId !== revisionId ||
    created.invocation.runId !== runId ||
    created.invocation.invocationId !== MANUAL_LEDGER_INVOCATION_ID ||
    created.invocation.appId !== appId ||
    created.invocation.revisionId !== revisionId ||
    created.invocation.activityId !== activityId
  ) {
    throw new Error(
      'submitManualLedgerActivity existing run does not match its requested execution identity.',
    );
  }

  const view = await ledger.rebuildRun(runId);
  if (!view) {
    throw new Error(`Submitted execution ledger run disappeared: ${runId}`);
  }
  const invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID,
  );
  if (
    view.run.runId !== runId ||
    view.run.appId !== appId ||
    view.run.revisionId !== revisionId ||
    !invocation ||
    invocation.runId !== runId ||
    invocation.appId !== appId ||
    invocation.revisionId !== revisionId ||
    invocation.activityId !== activityId
  ) {
    throw new Error(
      'submitManualLedgerActivity verified readback does not match its requested execution identity.',
    );
  }

  return {
    accepted: true,
    reused: !created.applied,
    runId,
    appId,
    revisionId,
    invocationId: invocation.invocationId,
    activityId,
    runStatus: view.run.status,
    invocationStatus: invocation.status,
  };
}

/**
 * Create, claim, and execute exactly one manual activity through the
 * append-only ledger. A normal repeat never steals a RUNNING attempt because
 * coordinator leases do not exist yet; recovery is a separate operator action
 * that never accepts or compiles current application source.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, appId: string, revisionId: string, activityId: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}, admissionSignal?: AbortSignal, signal?: AbortSignal, ownerCancellation?: ManualLedgerOwnerCancellation, registerActiveAttemptCancellationPort?: ManualLedgerActiveAttemptCancellationPortRegistrar, createFencingToken?: () => string, executeAttempt?: (startFrame: Readonly<Record<string, any>>, options: {signal: AbortSignal, onComponentFrame: (frame: Readonly<Record<string, any>>) => Promise<void>}) => Promise<Readonly<Record<string, any>>>, prepareAttemptDispatch?: (context: Readonly<ManualLedgerAttemptDispatchContext>) => ManualLedgerPreparedAttemptDispatch|Promise<ManualLedgerPreparedAttemptDispatch>}} options - Bound authored activity execution. Exactly one dispatch option is required.
 * @returns {Promise<ReturnType<typeof outcomeFromState>>} - Durable terminal, blocked, or in-progress result.
 */
export async function runManualLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('runManualLedgerActivity requires options.');
  }
  if (!options.ledger) {
    throw new TypeError('runManualLedgerActivity requires ledger.');
  }
  const executeAttemptProvided = options.executeAttempt !== undefined;
  const prepareAttemptDispatchProvided =
    options.prepareAttemptDispatch !== undefined;
  if (executeAttemptProvided === prepareAttemptDispatchProvided) {
    throw new TypeError(
      'runManualLedgerActivity requires exactly one of executeAttempt or prepareAttemptDispatch.',
    );
  }
  if (executeAttemptProvided && typeof options.executeAttempt !== 'function') {
    throw new TypeError(
      'runManualLedgerActivity.executeAttempt must be a function when provided.',
    );
  }
  if (
    prepareAttemptDispatchProvided &&
    typeof options.prepareAttemptDispatch !== 'function'
  ) {
    throw new TypeError(
      'runManualLedgerActivity.prepareAttemptDispatch must be a function when provided.',
    );
  }
  if (Object.prototype.hasOwnProperty.call(options, 'recover')) {
    throw new TypeError(
      'runManualLedgerActivity.recover is not supported; use recoverManualLedgerActivity before a separate execution decision.',
    );
  }
  if (Object.prototype.hasOwnProperty.call(options, 'existingSuccessor')) {
    throw new TypeError(
      'runManualLedgerActivity cannot execute a managed-effect successor; use the dedicated successor executor.',
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
  assertOptionalAbortSignal(
    options.admissionSignal,
    'runManualLedgerActivity.admissionSignal',
  );
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

  if (
    created.run.runId !== runId ||
    created.run.appId !== options.appId ||
    created.run.revisionId !== options.revisionId ||
    created.invocation.runId !== runId ||
    created.invocation.invocationId !== invocationId ||
    created.invocation.activityId !== options.activityId
  ) {
    throw new Error(
      'runManualLedgerActivity existing run does not match its requested execution identity.',
    );
  }

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

  if (options.admissionSignal?.aborted) {
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
  const claimedCancellationFence = cancellationAttemptFence(attempt);
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

  /**
   * Stop admitting this exact claim without turning resident shutdown into a
   * logical manual cancellation. CLAIMED is safely released; a concurrently
   * committed STARTED boundary becomes honest uncertainty.
   * @returns {Promise<ReturnType<typeof outcomeFromState>>} - Current durable outcome.
   */
  const stopBeforePhysicalDispatch = async () => {
    const recovery = await recoverManualLedgerActivity({
      ledger,
      runId,
      invocationId,
      actor,
    });
    if (recovery.outcome) return recovery.outcome;
    const durable = await readCurrent(ledger, runId, invocationId);
    return outcomeFromView(durable.view, invocationId);
  };

  if (options.admissionSignal?.aborted) {
    return await stopBeforePhysicalDispatch();
  }

  if (options.signal?.aborted) {
    const cancellation = await requestActiveOwnerCancellation({
      ledger,
      runId,
      invocationId,
      transitionId: `cancel:${runId}`,
      requestId: `cancel:${runId}`,
      actor,
      expectedAttempt: claimedCancellationFence,
      reason: serializeActivityAttemptError(
        options.signal.reason,
        'cancel-requested',
      ),
    });
    return outcomeFromCancellationResult(cancellation, !created.applied);
  }

  /** @type {any} */
  let started;
  /** @type {ManualLedgerPreparedAttemptDispatch['executeAttempt'] | undefined} */
  let executeAttempt = options.executeAttempt;
  /** @type {ManualLedgerPreparedAttemptDispatch['release'] | null} */
  let releaseAttemptDispatch = null;
  let dispatchFailurePhase = 'start-dispatch';
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
  /** @type {unknown} */
  let runnerError;
  let runnerFailed = false;

  /**
   * Finish every cleanup phase before reporting any of their failures. Keeping
   * this outside the lifecycle `finally` also lets lint verify that the
   * durable runner has no direct control-flow override there.
   * @returns {Promise<void>} - Resolves when every cleanup succeeds.
   */
  const cleanupAttemptDispatch = async () => {
    /** @type {unknown[]} */
    const cleanupErrors = [];
    activeAttemptCancellationPort = false;
    const removeListener = /** @type {unknown} */ (removeCancellationListener);
    try {
      if (typeof removeListener === 'function') removeListener();
    } catch (error) {
      cleanupErrors.push(error);
    }
    const unregisterPort = /** @type {unknown} */ (
      unregisterActiveAttemptCancellationPort
    );
    try {
      if (typeof unregisterPort === 'function') unregisterPort();
    } catch (error) {
      // Marking the port inactive before calling its disposer keeps retained
      // callbacks fail-closed even when host cleanup itself fails.
      cleanupErrors.push(error);
    }
    if (cancellationPromises.size > 0) {
      try {
        await Promise.allSettled([...cancellationPromises.values()]);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    const releaseDispatch = /** @type {unknown} */ (releaseAttemptDispatch);
    if (typeof releaseDispatch === 'function') {
      try {
        await releaseDispatch();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (cleanupErrors.length === 0) return;
    if (runnerFailed) {
      throw new AggregateError(
        [runnerError, ...cleanupErrors],
        'The manual activity runner and dispatch cleanup both failed.',
      );
    }
    if (cleanupErrors.length === 1) throw cleanupErrors[0];
    throw new AggregateError(
      cleanupErrors,
      'Multiple manual activity dispatch cleanup operations failed.',
    );
  };

  try {
    if (options.prepareAttemptDispatch) {
      dispatchFailurePhase = 'prepare-dispatch';
      const candidate = await options.prepareAttemptDispatch(
        Object.freeze({
          runId,
          invocationId,
          attemptId: attempt.attemptId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
        }),
      );
      // If acquisition returned a usable disposer alongside a malformed
      // capability surface, still release what it acquired after the
      // normal pre-start failure settlement.
      if (
        candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        typeof (/** @type {Record<string, unknown>} */ (candidate).release) ===
          'function'
      ) {
        releaseAttemptDispatch = /** @type {() => void|Promise<void>} */ (
          /** @type {Record<string, unknown>} */ (candidate).release
        );
      }
      const prepared = normalizePreparedAttemptDispatch(candidate);
      executeAttempt = prepared.executeAttempt;
      releaseAttemptDispatch = prepared.release;
      dispatchFailurePhase = 'start-dispatch';
    }
    if (!executeAttempt) {
      throw new Error(
        'runManualLedgerActivity has no executor after dispatch preparation.',
      );
    }

    if (options.admissionSignal?.aborted) {
      return await stopBeforePhysicalDispatch();
    }

    // Preparation can perform asynchronous I/O. Honour a foreground abort
    // which arrived while those resources were opening without crossing
    // the durable STARTED boundary or invoking the physical executor.
    if (options.signal?.aborted) {
      const cancellation = await requestActiveOwnerCancellation({
        ledger,
        runId,
        invocationId,
        transitionId: `cancel:${runId}`,
        requestId: `cancel:${runId}`,
        actor,
        expectedAttempt: claimedCancellationFence,
        reason: serializeActivityAttemptError(
          options.signal.reason,
          'cancel-requested',
        ),
      });
      return outcomeFromCancellationResult(cancellation, !created.applied);
    }

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
    if (options.admissionSignal?.aborted) {
      return await stopBeforePhysicalDispatch();
    }
    const startedCancellationFence = cancellationAttemptFence(started.attempt);

    dispatchFailurePhase = 'runtime-dispatch';

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
            expectedAttempt: startedCancellationFence,
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
      options.signal.addEventListener('abort', onCancellation, {
        once: true,
      });
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
      evidence = await executeAttempt(started.startFrame, {
        signal: attemptController.signal,
        onComponentFrame: createDurableActivityLogSink({
          ledger,
          attempt: started.attempt,
        }),
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
    let dispatchError = error;
    if (
      started === undefined &&
      dispatchFailurePhase === 'prepare-dispatch' &&
      options.signal?.aborted
    ) {
      try {
        const cancellation = await requestActiveOwnerCancellation({
          ledger,
          runId,
          invocationId,
          transitionId: `cancel:${runId}`,
          requestId: `cancel:${runId}`,
          actor,
          expectedAttempt: claimedCancellationFence,
          reason: serializeActivityAttemptError(
            options.signal.reason,
            'cancel-requested',
          ),
        });
        return outcomeFromCancellationResult(cancellation, !created.applied);
      } catch (cancellationError) {
        dispatchError = new AggregateError(
          [error, cancellationError],
          'Attempt preparation and durable foreground cancellation both failed.',
        );
      }
    }
    try {
      return await settleDispatchFailure({
        ledger,
        runId,
        invocationId,
        expectedAttempt: attempt,
        transitionId: `uncertain:${attempt.attemptId}`,
        actor,
        phase: dispatchFailurePhase,
        error: dispatchError,
      });
    } catch (settlementError) {
      runnerFailed = true;
      runnerError = settlementError;
    }
  } finally {
    await cleanupAttemptDispatch();
  }
  if (runnerFailed) throw runnerError;
  throw new Error('The manual activity runner produced no durable outcome.');
}

export default {
  MANUAL_LEDGER_INVOCATION_ID,
  ManualLedgerRecoveryAction,
  createManualLedgerRunId,
  recoverManualLedgerActivity,
  runManualLedgerActivity,
  submitManualLedgerActivity,
};
