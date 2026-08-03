import { randomUUID } from 'node:crypto';

import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
} from '../lib/db/tables/execution-ledger.js';
import { hasSameCanonicalJson } from '../lib/ledger/execution-ledger-contract.js';
import {
  WorkflowCursorDisposition,
  assertWorkflowPlanId,
  assertWorkflowRunId,
} from '../lib/ledger/workflow-execution-contract.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { serializeActivityAttemptError } from './activity-attempt.js';
import { createDurableActivityLogSink } from './activity-log-sink.js';
import { assertApplicationRevisionId } from './application-revision.js';
import { createCanonicalJsonSha256Id } from './content-id.js';
import { assertLogicalId } from './logical-id.js';

const DEFAULT_ACTOR_KIND = 'resident-workflow';
const DEFAULT_CANCELLATION_ACTOR_KIND = 'local-owner-command';
const SUPPORTED_TERMINALS = new Set([
  'completed',
  'failed',
  'cancelled',
  'protocol-failed',
]);

const DEFAULT_OWNER_CANCELLATION_REASON = Object.freeze({
  code: 'operator-cancel-requested',
  name: 'CancellationRequested',
  message: 'The active local owner accepted a workflow cancellation command.',
  details: Object.freeze({}),
});

/**
 * Version of the process-local run-cancellation capability registered for one
 * exact durable STARTED workflow attempt. The port never exposes its internal
 * AbortController and accepts only a stable request identity.
 */
export const WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION = 1;

/**
 * @typedef {{requestId: string}} WorkflowLedgerActiveCancellationRequest
 */

/**
 * @typedef {{applied: boolean, outcome: 'cancellation-requested'|'terminal-authoritative'|'owner-not-ready', cancellationDeliveryRequired: boolean, signalDelivered: boolean, run: Record<string, any>, workflowCursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>, receipt?: Record<string, any>}} WorkflowLedgerCancellationResult
 */

/**
 * @typedef {{version: number, runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, attemptId: string, fencingToken: string, generation: number, coordinatorEpoch: number, requestCancellation: (request: WorkflowLedgerActiveCancellationRequest) => Promise<WorkflowLedgerCancellationResult>}} WorkflowLedgerActiveCancellationPort
 */

/**
 * @callback WorkflowLedgerActiveCancellationPortRegistrar
 * @param {WorkflowLedgerActiveCancellationPort} port - Exact live workflow-attempt cancellation capability.
 * @returns {void|(() => void)} - Optional unregister callback.
 */

/**
 * @typedef {{actor?: {kind: string, id: string}, reason?: {code: string, name: string, message: string, details: Record<string, any>}}} WorkflowLedgerOwnerCancellation
 */

export const WorkflowLedgerRecoveryAction = Object.freeze({
  NONE: 'none',
  RELEASED_UNSTARTED_CLAIM: 'released-unstarted-claim',
  MARKED_STARTED_UNCERTAIN: 'marked-started-uncertain',
});

/**
 * @param {unknown} value - Candidate abort signal.
 * @param {string} label - Human-readable option name.
 * @returns {AbortSignal | undefined} - Validated optional signal.
 */
function resolveOptionalAbortSignal(value, label) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
      'function' ||
    typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
      'function'
  ) {
    throw new TypeError(`${label} must be an AbortSignal when provided.`);
  }
  return /** @type {AbortSignal} */ (value);
}

/**
 * @param {unknown} value - Candidate durable transition actor.
 * @param {string} appId - Fallback actor identity.
 * @returns {{kind: string, id: string}} - Exact actor.
 */
function resolveActor(value, appId) {
  if (value === undefined) return { kind: DEFAULT_ACTOR_KIND, id: appId };
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Workflow activity actor must be an object.');
  }
  const actor = /** @type {Record<string, unknown>} */ (value);
  if (
    Object.keys(actor).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(actor, 'kind') ||
    !Object.prototype.hasOwnProperty.call(actor, 'id')
  ) {
    throw new TypeError(
      'Workflow activity actor must contain exactly kind and id.',
    );
  }
  return {
    kind: assertLedgerOpaqueId(actor.kind, 'workflow activity actor.kind'),
    id: assertLedgerOpaqueId(actor.id, 'workflow activity actor.id'),
  };
}

/**
 * Normalize fixed cancellation authority before a request can reach the
 * ledger or physical attempt. Active ports accept only request IDs, so command
 * payloads cannot choose actor or reason fields after registration.
 * @param {unknown} value - Candidate owner cancellation descriptor.
 * @param {{kind: string, id: string}} fallbackActor - Bound local actor.
 * @param {string} label - Human-readable boundary label.
 * @returns {{actor: {kind: string, id: string}, reason: Record<string, any>}} - Strict durable authority.
 */
function normalizeOwnerCancellation(value, fallbackActor, label) {
  if (
    value !== undefined &&
    (!value || typeof value !== 'object' || Array.isArray(value))
  ) {
    throw new TypeError(`${label} must be an object when provided.`);
  }
  const descriptor = /** @type {Record<string, unknown> | undefined} */ (value);
  if (descriptor) {
    for (const key of Reflect.ownKeys(descriptor)) {
      if (key !== 'actor' && key !== 'reason') {
        throw new TypeError(`${label} accepts only actor and reason.`);
      }
    }
  }
  const actor = resolveActor(
    descriptor?.actor ?? fallbackActor,
    fallbackActor.id,
  );
  return {
    actor,
    reason: serializeActivityAttemptError(
      descriptor?.reason ?? DEFAULT_OWNER_CANCELLATION_REASON,
      'cancel-requested',
    ),
  };
}

/**
 * @param {unknown} value - Candidate bounded active-port request.
 * @returns {WorkflowLedgerActiveCancellationRequest} - Exact request identity.
 */
function normalizeActiveCancellationRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Active workflow cancellation requests must contain requestId.',
    );
  }
  const request = /** @type {Record<string, unknown>} */ (value);
  const keys = Reflect.ownKeys(request);
  if (keys.length !== 1 || keys[0] !== 'requestId') {
    throw new TypeError(
      'Active workflow cancellation requests accept only requestId.',
    );
  }
  return {
    requestId: assertLedgerOpaqueId(
      request.requestId,
      'active workflow cancellation requestId',
    ),
  };
}

/**
 * Derive one collision-resistant receipt identity from the semantic run-level
 * cancellation identity. It deliberately excludes the current cursor so a
 * terminal race can rebase the same request onto a successor activation.
 * @param {{runId: string, requestId: string}} options - Run cancellation identity.
 * @returns {string} - Domain-separated ledger transition ID.
 */
function createWorkflowCancellationTransitionId(options) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:workflow-run-cancellation-transition:v1',
    prefix: 'wcx',
    value: {
      runId: options.runId,
      requestId: options.requestId,
    },
    valuePath: 'workflow run cancellation transition identity',
  });
}

/**
 * @param {unknown} value - Candidate active workflow cancellation port.
 * @returns {WorkflowLedgerActiveCancellationPort | undefined} - Valid optional port.
 */
function normalizeOptionalActiveCancellationPort(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation.activeCancellationPort must be an object when provided.',
    );
  }
  const port = /** @type {Record<string, unknown>} */ (value);
  const keys = Reflect.ownKeys(port);
  const expected = [
    'version',
    'runId',
    'invocationId',
    'cursor',
    'attemptId',
    'fencingToken',
    'generation',
    'coordinatorEpoch',
    'requestCancellation',
  ];
  if (
    keys.length !== expected.length ||
    expected.some((key) => !keys.includes(key))
  ) {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation.activeCancellationPort has an unsupported shape.',
    );
  }
  if (port.version !== WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION) {
    throw new TypeError(
      `requestWorkflowLedgerRunCancellation.activeCancellationPort.version must be ${WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION}.`,
    );
  }
  if (typeof port.requestCancellation !== 'function') {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation.activeCancellationPort.requestCancellation must be a function.',
    );
  }
  normalizeCursorGuard(
    port.cursor,
    'requestWorkflowLedgerRunCancellation.activeCancellationPort.cursor',
  );
  assertWorkflowRunId(
    port.runId,
    'requestWorkflowLedgerRunCancellation.activeCancellationPort.runId',
  );
  assertLedgerOpaqueId(
    port.invocationId,
    'requestWorkflowLedgerRunCancellation.activeCancellationPort.invocationId',
  );
  assertLedgerOpaqueId(
    port.attemptId,
    'requestWorkflowLedgerRunCancellation.activeCancellationPort.attemptId',
  );
  assertLedgerOpaqueId(
    port.fencingToken,
    'requestWorkflowLedgerRunCancellation.activeCancellationPort.fencingToken',
  );
  if (!Number.isSafeInteger(port.generation) || Number(port.generation) < 1) {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation.activeCancellationPort.generation must be a positive safe integer.',
    );
  }
  if (
    !Number.isSafeInteger(port.coordinatorEpoch) ||
    Number(port.coordinatorEpoch) < 0
  ) {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation.activeCancellationPort.coordinatorEpoch must be a non-negative safe integer.',
    );
  }
  return /** @type {WorkflowLedgerActiveCancellationPort} */ (value);
}

/**
 * @param {unknown} value - Candidate cursor guard.
 * @param {string} label - Human-readable option name.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} - Exact cursor guard.
 */
function normalizeCursorGuard(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const cursor = /** @type {Record<string, unknown>} */ (value);
  const expected = ['version', 'continuationId', 'stepId', 'stepIndex'];
  if (
    Object.keys(cursor).length !== expected.length ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(cursor, key))
  ) {
    throw new TypeError(
      `${label} must contain exactly ${expected.join(', ')}.`,
    );
  }
  if (!Number.isSafeInteger(cursor.version) || Number(cursor.version) < 1) {
    throw new TypeError(`${label}.version must be a positive safe integer.`);
  }
  if (!Number.isSafeInteger(cursor.stepIndex) || Number(cursor.stepIndex) < 0) {
    throw new TypeError(
      `${label}.stepIndex must be a non-negative safe integer.`,
    );
  }
  return {
    version: Number(cursor.version),
    continuationId: assertLedgerOpaqueId(
      cursor.continuationId,
      `${label}.continuationId`,
    ),
    stepId: assertLedgerOpaqueId(cursor.stepId, `${label}.stepId`),
    stepIndex: Number(cursor.stepIndex),
  };
}

/**
 * @param {Record<string, any>} cursor - Verified workflow cursor.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} - Mutation guard.
 */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/**
 * @param {Record<string, any>} cursor - Current verified cursor.
 * @param {{version: number, continuationId: string, stepId: string, stepIndex: number}} expected - Expected activation.
 * @returns {boolean} - Whether the cursor guard is exact.
 */
function isSameCursorGuard(cursor, expected) {
  return (
    cursor.version === expected.version &&
    cursor.continuationId === expected.continuationId &&
    cursor.stepId === expected.stepId &&
    cursor.stepIndex === expected.stepIndex
  );
}

/**
 * @param {Record<string, any>} cursor - Current cursor.
 * @param {Record<string, any>} expected - Retained activation identity.
 * @returns {boolean} - Whether both cursors name the same logical activation.
 */
function isSameCursorActivation(cursor, expected) {
  return (
    cursor.continuationId === expected.continuationId &&
    cursor.stepId === expected.stepId &&
    cursor.stepIndex === expected.stepIndex
  );
}

/**
 * @param {Record<string, any>} attempt - Current physical attempt.
 * @param {Record<string, any>} expected - Retained attempt identity.
 * @returns {boolean} - Whether the same physical generation is retained.
 */
function isSameAttempt(attempt, expected) {
  return (
    attempt.attemptId === expected.attemptId &&
    attempt.fencingToken === expected.fencingToken &&
    attempt.generation === expected.generation &&
    attempt.coordinatorEpoch === expected.coordinatorEpoch
  );
}

/**
 * @param {WorkflowLedgerActiveCancellationPort | undefined} port - Candidate live port.
 * @param {{run: Record<string, any>, cursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>}} current - Current workflow activation.
 * @returns {boolean} - Whether the port still owns this exact STARTED attempt.
 */
function isExactActiveCancellationPort(port, current) {
  return Boolean(
    port &&
    current.invocation &&
    current.attempt &&
    current.attempt.status === AttemptStatus.STARTED &&
    port.runId === current.run.runId &&
    port.invocationId === current.invocation.invocationId &&
    isSameCursorActivation(current.cursor, port.cursor) &&
    port.attemptId === current.attempt.attemptId &&
    port.fencingToken === current.attempt.fencingToken &&
    port.generation === current.attempt.generation &&
    port.coordinatorEpoch === current.attempt.coordinatorEpoch,
  );
}

/**
 * @param {Record<string, any>} view - Verified rebuilt workflow.
 * @param {Record<string, any>} invocation - Current cursor invocation.
 * @returns {Record<string, any> | undefined} - Current generation attempt.
 */
function getCurrentAttempt(view, invocation) {
  if (invocation.generation === 0) return undefined;
  const attempts = view.attempts.filter(
    (/** @type {Record<string, any>} */ attempt) =>
      attempt.invocationId === invocation.invocationId &&
      attempt.generation === invocation.generation,
  );
  if (attempts.length !== 1) {
    throw new Error(
      `Workflow ${view.run.runId} does not retain exactly one attempt for ${invocation.invocationId} generation ${invocation.generation}.`,
    );
  }
  return attempts[0];
}

/**
 * @param {import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ledger - Ledger store.
 * @param {string} runId - Workflow run identity.
 * @returns {Promise<{view: Record<string, any>, run: Record<string, any>, cursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>} | null>} - Verified current workflow activation.
 */
async function readCurrentWorkflow(ledger, runId) {
  const view = await ledger.rebuildRun(runId);
  if (!view) return null;
  const cursor = view.workflowCursor;
  if (
    view.run.runId !== runId ||
    view.run.trigger?.kind !== 'workflow' ||
    !cursor ||
    cursor.runId !== runId ||
    cursor.appId !== view.run.appId ||
    cursor.revisionId !== view.run.revisionId ||
    cursor.workflowId !== view.run.trigger.workflowId ||
    cursor.planId !== view.run.trigger.planId
  ) {
    throw new Error(`Workflow run ${runId} has inconsistent cursor authority.`);
  }
  if (Object.prototype.hasOwnProperty.call(cursor, 'invocationId')) {
    const invocation = view.invocations.find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.invocationId === cursor.invocationId,
    );
    if (
      !invocation ||
      invocation.runId !== runId ||
      invocation.appId !== view.run.appId ||
      invocation.revisionId !== view.run.revisionId ||
      invocation.workflow?.workflowId !== cursor.workflowId ||
      invocation.workflow?.planId !== cursor.planId ||
      invocation.workflow?.continuationId !== cursor.continuationId ||
      invocation.workflow?.stepId !== cursor.stepId ||
      invocation.workflow?.stepIndex !== cursor.stepIndex
    ) {
      throw new Error(
        `Workflow run ${runId} has no exact invocation for its current cursor.`,
      );
    }
    const attempt = getCurrentAttempt(view, invocation);
    return {
      view,
      run: view.run,
      cursor,
      invocation,
      ...(attempt ? { attempt } : {}),
    };
  }

  if (Object.prototype.hasOwnProperty.call(cursor, 'timerId')) {
    const timer = (view.timers || []).find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.timerId === cursor.timerId,
    );
    if (
      !timer ||
      timer.runId !== runId ||
      timer.appId !== view.run.appId ||
      timer.revisionId !== view.run.revisionId ||
      timer.workflowId !== cursor.workflowId ||
      timer.planId !== cursor.planId ||
      timer.continuationId !== cursor.continuationId ||
      timer.stepId !== cursor.stepId ||
      timer.stepIndex !== cursor.stepIndex
    ) {
      throw new Error(
        `Workflow run ${runId} has no exact timer for its current cursor.`,
      );
    }
    return { view, run: view.run, cursor, timer };
  }

  if (Object.prototype.hasOwnProperty.call(cursor, 'signalWaitId')) {
    const signalWait = (view.signalWaits || []).find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.signalWaitId === cursor.signalWaitId,
    );
    if (
      !signalWait ||
      signalWait.runId !== runId ||
      signalWait.appId !== view.run.appId ||
      signalWait.revisionId !== view.run.revisionId ||
      signalWait.workflowId !== cursor.workflowId ||
      signalWait.planId !== cursor.planId ||
      signalWait.continuationId !== cursor.continuationId ||
      signalWait.stepId !== cursor.stepId ||
      signalWait.stepIndex !== cursor.stepIndex
    ) {
      throw new Error(
        `Workflow run ${runId} has no exact signal wait for its current cursor.`,
      );
    }
    return { view, run: view.run, cursor, signalWait };
  }

  throw new Error(`Workflow run ${runId} has no current activation identity.`);
}

/**
 * Add the exact current activation projection without inventing a common
 * activity-shaped field for timer or signal waits.
 * @param {Record<string, any>} target - Result under construction.
 * @param {{invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>}} current - Current activation.
 * @returns {Record<string, any>} - Activation-aware result.
 */
function withCurrentActivation(target, current) {
  return {
    ...target,
    ...(current.invocation ? { invocation: current.invocation } : {}),
    ...(current.timer ? { timer: current.timer } : {}),
    ...(current.signalWait ? { signalWait: current.signalWait } : {}),
    ...(current.attempt ? { attempt: current.attempt } : {}),
  };
}

/**
 * @param {{run: Record<string, any>, cursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>}} current - Verified workflow state.
 * @param {'terminal-authoritative'|'owner-not-ready'} outcome - Non-mutating result class.
 * @returns {WorkflowLedgerCancellationResult} - Public cancellation result.
 */
function nonAppliedCancellationResult(current, outcome) {
  return /** @type {WorkflowLedgerCancellationResult} */ (
    withCurrentActivation(
      {
        applied: false,
        outcome,
        cancellationDeliveryRequired: false,
        signalDelivered: false,
        run: current.run,
        workflowCursor: current.cursor,
      },
      current,
    )
  );
}

/**
 * Return a current first-wins request after a lost response without replaying
 * it against a newer cursor guard. Reusing the same public request identity
 * with changed authority remains an immutable transition conflict.
 * @param {{run: Record<string, any>, cursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>}} current - Verified workflow state.
 * @param {{requestId: string, transitionId: string, actor: Record<string, any>, reason: Record<string, any>}} request - Stable caller request.
 * @returns {WorkflowLedgerCancellationResult} - Retained first-wins result.
 */
function retainedCancellationResult(current, request) {
  const retained = current.run.cancellationRequest;
  if (!retained) {
    throw new Error(
      `Workflow ${current.run.runId} has no retained cancellation request.`,
    );
  }
  if (
    retained.requestId === request.requestId &&
    (retained.transitionId !== request.transitionId ||
      !hasSameCanonicalJson(retained.actor, request.actor) ||
      !hasSameCanonicalJson(retained.reason, request.reason))
  ) {
    throw new ExecutionLedgerTransitionConflictError(
      current.run.runId,
      request.transitionId,
    );
  }
  return /** @type {WorkflowLedgerCancellationResult} */ (
    withCurrentActivation(
      {
        applied: false,
        outcome: 'cancellation-requested',
        cancellationDeliveryRequired: false,
        signalDelivered: false,
        run: current.run,
        workflowCursor: current.cursor,
      },
      current,
    )
  );
}

/**
 * @param {{run: Record<string, any>, cursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>}} current - Verified workflow state.
 * @returns {boolean} - Whether the current aggregate is terminal without a retained cancellation request to replay.
 */
function isTerminalWorkflowWithoutCancellationRequest(current) {
  return (
    !current.run.cancellationRequest &&
    [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED].includes(
      current.run.status,
    )
  );
}

/**
 * Persist one stable run-level workflow cancellation request, rebasing it
 * across cursor races. A fresh STARTED attempt is writable only when the
 * caller presents the exact process-local port identity which owns it.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, requestId: string, transitionId: string, actor: {kind: string, id: string}, reason: Record<string, any>, authorizedPort?: WorkflowLedgerActiveCancellationPort}} options - Durable cancellation request.
 * @returns {Promise<WorkflowLedgerCancellationResult>} - Durable or authoritative result.
 */
async function persistWorkflowLedgerRunCancellation(options) {
  /** @type {unknown} */
  let lastConflict;
  for (let retry = 0; retry < 6; retry += 1) {
    const current = await readCurrentWorkflow(options.ledger, options.runId);
    if (!current) {
      throw new Error(`Workflow run disappeared: ${options.runId}`);
    }
    if (current.run.cancellationRequest) {
      return retainedCancellationResult(current, options);
    }
    if (isTerminalWorkflowWithoutCancellationRequest(current)) {
      return nonAppliedCancellationResult(current, 'terminal-authoritative');
    }
    const freshStartedAttempt =
      current.run.status === RunStatus.RUNNING &&
      current.cursor.disposition ===
        WorkflowCursorDisposition.ACTIVITY_RUNNING &&
      current.invocation?.status === InvocationStatus.RUNNING &&
      current.attempt?.status === AttemptStatus.STARTED &&
      !current.run.cancellationRequest;
    if (
      freshStartedAttempt &&
      !isExactActiveCancellationPort(options.authorizedPort, current)
    ) {
      return nonAppliedCancellationResult(current, 'owner-not-ready');
    }

    const attempt = current.attempt;
    const invocation = current.invocation;
    try {
      const result = await options.ledger.requestWorkflowRunCancellation({
        runId: options.runId,
        cursor: cursorGuard(current.cursor),
        expectedVersion: current.run.version,
        transitionId: options.transitionId,
        requestId: options.requestId,
        reason: options.reason,
        actor: options.actor,
        ...(invocation
          ? {
              invocationId: invocation.invocationId,
              expectedGeneration: invocation.generation,
              coordinatorEpoch: attempt?.coordinatorEpoch ?? 0,
              ...(attempt
                ? {
                    attemptId: attempt.attemptId,
                    fencingToken: attempt.fencingToken,
                  }
                : {}),
            }
          : {}),
      });
      return /** @type {WorkflowLedgerCancellationResult} */ ({
        ...result,
        signalDelivered: false,
      });
    } catch (error) {
      let durable;
      try {
        durable = await readCurrentWorkflow(options.ledger, options.runId);
      } catch (verificationError) {
        throw new AggregateError(
          [error, verificationError],
          `Could not verify whether workflow cancellation was retained for ${options.runId}.`,
        );
      }
      if (!durable) {
        throw new AggregateError(
          [error],
          `Workflow run disappeared while cancellation was being persisted: ${options.runId}.`,
        );
      }
      if (
        error instanceof ExecutionLedgerConflictError ||
        durable.run.version !== current.run.version
      ) {
        if (durable.run.cancellationRequest) {
          return retainedCancellationResult(durable, options);
        }
        lastConflict = error;
        continue;
      }
      throw error;
    }
  }
  throw (
    lastConflict ||
    new Error(
      `Could not persist workflow cancellation after bounded rebasing: ${options.runId}.`,
    )
  );
}

/**
 * Request durable run-level workflow cancellation. RUNNABLE, CLAIMED, and
 * uncertain work can be changed without a live physical owner. A fresh
 * STARTED attempt requires its exact active port, which persists the request
 * before delivering the retained reason to the one-shot worker.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, requestId: string, activeCancellationPort?: WorkflowLedgerActiveCancellationPort, actor?: {kind: string, id: string}, reason?: {code: string, name: string, message: string, details: Record<string, any>}}} options - Run-level cancellation command.
 * @returns {Promise<WorkflowLedgerCancellationResult>} - Durable request, terminal state, or unavailable-owner result.
 */
export async function requestWorkflowLedgerRunCancellation(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation requires options.',
    );
  }
  const allowed = new Set([
    'ledger',
    'runId',
    'requestId',
    'activeCancellationPort',
    'actor',
    'reason',
  ]);
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(
        `requestWorkflowLedgerRunCancellation.${String(key)} is not supported.`,
      );
    }
  }
  if (
    !options.ledger ||
    typeof options.ledger.requestWorkflowRunCancellation !== 'function'
  ) {
    throw new TypeError(
      'requestWorkflowLedgerRunCancellation requires a workflow cancellation ledger.',
    );
  }
  assertWorkflowRunId(
    options.runId,
    'requestWorkflowLedgerRunCancellation.runId',
  );
  const runId = options.runId;
  const requestId = assertLedgerOpaqueId(
    options.requestId,
    'requestWorkflowLedgerRunCancellation.requestId',
  );
  const activeCancellationPort = normalizeOptionalActiveCancellationPort(
    options.activeCancellationPort,
  );
  const current = await readCurrentWorkflow(options.ledger, runId);
  if (!current) throw new Error(`Workflow run disappeared: ${runId}`);

  if (
    current.attempt?.status === AttemptStatus.STARTED &&
    current.invocation?.status === InvocationStatus.RUNNING &&
    current.cursor.disposition === WorkflowCursorDisposition.ACTIVITY_RUNNING &&
    isExactActiveCancellationPort(activeCancellationPort, current)
  ) {
    return await /** @type {WorkflowLedgerActiveCancellationPort} */ (
      activeCancellationPort
    ).requestCancellation({ requestId });
  }

  const cancellation = normalizeOwnerCancellation(
    {
      ...(options.actor === undefined ? {} : { actor: options.actor }),
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    },
    { kind: DEFAULT_CANCELLATION_ACTOR_KIND, id: current.run.appId },
    'requestWorkflowLedgerRunCancellation cancellation authority',
  );
  return await persistWorkflowLedgerRunCancellation({
    ledger: options.ledger,
    runId,
    requestId,
    transitionId: createWorkflowCancellationTransitionId({ runId, requestId }),
    actor: cancellation.actor,
    reason: cancellation.reason,
  });
}

/**
 * @param {{run: Record<string, any>, cursor: Record<string, any>, invocation?: Record<string, any>, timer?: Record<string, any>, signalWait?: Record<string, any>, attempt?: Record<string, any>}} current - Verified current state.
 * @param {{reused?: boolean, dispatched?: boolean}} [options] - Result flags.
 * @returns {Record<string, any>} - Compact runner outcome.
 */
function outcomeFromCurrent(current, options = {}) {
  const disposition =
    current.run.status === RunStatus.COMPLETED
      ? 'completed'
      : current.run.status === RunStatus.FAILED
        ? 'failed'
        : current.run.status === RunStatus.CANCELLED
          ? 'cancelled'
          : current.run.status === RunStatus.BLOCKED
            ? 'blocked'
            : current.cursor.disposition ===
                WorkflowCursorDisposition.ACTIVITY_RUNNABLE
              ? 'runnable'
              : current.cursor.disposition ===
                  WorkflowCursorDisposition.TIMER_WAITING
                ? 'timer-waiting'
                : current.cursor.disposition ===
                    WorkflowCursorDisposition.SIGNAL_WAITING
                  ? 'signal-waiting'
                  : 'in-progress';
  return withCurrentActivation(
    {
      disposition,
      reused: options.reused ?? false,
      dispatched: options.dispatched ?? false,
      run: current.run,
      workflowCursor: current.cursor,
    },
    current,
  );
}

/**
 * @param {unknown} error - Local failure.
 * @param {string} phase - Lifecycle phase.
 * @param {string} attemptId - Physical attempt identity.
 * @returns {Record<string, any>} - Bounded durable uncertainty reason.
 */
function uncertaintyReason(error, phase, attemptId) {
  const serialized = serializeActivityAttemptError(
    error,
    'workflow-attempt-outcome-unknown',
  );
  return {
    kind: 'resident-workflow-attempt-uncertain',
    phase,
    attemptId,
    error: {
      code: serialized.code,
      name: serialized.name,
      message: serialized.message.slice(0, 4096),
    },
  };
}

/**
 * @param {string} attemptId - Physical attempt identity.
 * @param {string} phase - Pre-dispatch phase.
 * @returns {Record<string, any>} - Durable safe-release reason.
 */
function releaseReason(attemptId, phase) {
  return {
    kind: 'resident-workflow-recovery-before-start',
    phase,
    attemptId,
    message:
      'The resident confirmed this claim did not cross its physical dispatch boundary.',
  };
}

/**
 * Settle an exact retained CLAIMED or STARTED attempt after this runner loses
 * the right to dispatch it. CLAIMED can be released; STARTED is conservatively
 * made uncertain. Every failed response is followed by a verified reread.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, attempt: Record<string, any>, actor: {kind: string, id: string}, phase: string, error: unknown, dispatched?: boolean}} options - Exact settlement request.
 * @returns {Promise<{action: string, changed: boolean, outcome: Record<string, any>} | null>} - Authoritative settlement, or null when the run disappeared.
 */
async function settleRetainedAttempt(options) {
  /** @type {unknown[]} */
  const errors = [];
  let failuresAtSameHead = 0;
  let failedHeadVersion;
  while (failuresAtSameHead < 3) {
    const current = await readCurrentWorkflow(options.ledger, options.runId);
    if (!current) return null;
    if (
      !current.invocation ||
      current.invocation.invocationId !== options.attempt.invocationId ||
      !current.attempt ||
      !isSameAttempt(current.attempt, options.attempt) ||
      current.invocation.status !== InvocationStatus.RUNNING ||
      current.cursor.disposition !== WorkflowCursorDisposition.ACTIVITY_RUNNING
    ) {
      return {
        action: WorkflowLedgerRecoveryAction.NONE,
        changed: false,
        outcome: outcomeFromCurrent(current, {
          reused: true,
          dispatched: options.dispatched,
        }),
      };
    }

    const isClaimed = current.attempt.status === AttemptStatus.CLAIMED;
    const isStarted = current.attempt.status === AttemptStatus.STARTED;
    if (!isClaimed && !isStarted) {
      return {
        action: WorkflowLedgerRecoveryAction.NONE,
        changed: false,
        outcome: outcomeFromCurrent(current, {
          reused: true,
          dispatched: options.dispatched,
        }),
      };
    }
    const action = isClaimed
      ? WorkflowLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM
      : WorkflowLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN;
    try {
      if (isClaimed) {
        await options.ledger.abandonUnstartedWorkflowActivityAttempt({
          runId: options.runId,
          invocationId: current.invocation.invocationId,
          cursor: cursorGuard(current.cursor),
          attemptId: current.attempt.attemptId,
          fencingToken: current.attempt.fencingToken,
          generation: current.attempt.generation,
          expectedVersion: current.run.version,
          transitionId: `workflow-release:${current.attempt.attemptId}`,
          reason: releaseReason(current.attempt.attemptId, options.phase),
          actor: options.actor,
          coordinatorEpoch: current.attempt.coordinatorEpoch,
        });
      } else {
        await options.ledger.markWorkflowActivityAttemptUncertain({
          runId: options.runId,
          invocationId: current.invocation.invocationId,
          cursor: cursorGuard(current.cursor),
          attemptId: current.attempt.attemptId,
          fencingToken: current.attempt.fencingToken,
          generation: current.attempt.generation,
          expectedVersion: current.run.version,
          transitionId: `workflow-uncertain:${current.attempt.attemptId}`,
          reason: uncertaintyReason(
            options.error,
            options.phase,
            current.attempt.attemptId,
          ),
          actor: options.actor,
          coordinatorEpoch: current.attempt.coordinatorEpoch,
        });
      }
      const settled = await readCurrentWorkflow(options.ledger, options.runId);
      if (!settled) return null;
      return {
        action,
        changed: true,
        outcome: outcomeFromCurrent(settled, {
          dispatched: options.dispatched,
        }),
      };
    } catch (error) {
      errors.push(error);
      const durable = await readCurrentWorkflow(options.ledger, options.runId);
      if (!durable) return null;
      if (
        durable.invocation &&
        durable.invocation.invocationId === options.attempt.invocationId &&
        durable.attempt &&
        isSameAttempt(durable.attempt, options.attempt) &&
        durable.invocation.status === InvocationStatus.RUNNING &&
        durable.cursor.disposition ===
          WorkflowCursorDisposition.ACTIVITY_RUNNING &&
        durable.run.version !== current.run.version
      ) {
        // A durable audit-only decision (for example, a rejected signal)
        // advanced the run head without changing this physical attempt. It is
        // safe to rebase and must not spend the bounded storage-failure budget.
        continue;
      }
      if (failedHeadVersion === current.run.version) {
        failuresAtSameHead += 1;
      } else {
        failedHeadVersion = current.run.version;
        failuresAtSameHead = 1;
      }
    }
  }

  const current = await readCurrentWorkflow(options.ledger, options.runId);
  if (
    current &&
    current.attempt &&
    isSameAttempt(current.attempt, options.attempt) &&
    [AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
      current.attempt.status,
    )
  ) {
    throw new AggregateError(
      errors,
      `Could not settle retained workflow attempt ${options.attempt.attemptId}.`,
    );
  }
  return current
    ? {
        action: WorkflowLedgerRecoveryAction.NONE,
        changed: false,
        outcome: outcomeFromCurrent(current, {
          reused: true,
          dispatched: options.dispatched,
        }),
      }
    : null;
}

/**
 * Recover one workflow ready row after its prior trusted resident reporter is
 * known to have stopped. This function never dispatches user code.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, invocationId: string, actor?: {kind: string, id: string}}} options - Exact stopped-runner recovery request.
 * @returns {Promise<{found: boolean, mayExecute: boolean, action: string, changed: boolean, outcome?: Record<string, any>}>} - Recovery decision.
 */
export async function recoverWorkflowLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('recoverWorkflowLedgerActivity requires options.');
  }
  for (const key of Object.keys(options)) {
    if (!['ledger', 'runId', 'invocationId', 'actor'].includes(key)) {
      throw new TypeError(
        `recoverWorkflowLedgerActivity.${key} is not supported.`,
      );
    }
  }
  if (!options.ledger) {
    throw new TypeError('recoverWorkflowLedgerActivity requires ledger.');
  }
  assertWorkflowRunId(options.runId, 'recoverWorkflowLedgerActivity.runId');
  const runId = options.runId;
  const invocationId = assertLedgerOpaqueId(
    options.invocationId,
    'recoverWorkflowLedgerActivity.invocationId',
  );
  const current = await readCurrentWorkflow(options.ledger, runId);
  if (
    !current ||
    !current.invocation ||
    current.invocation.invocationId !== invocationId
  ) {
    return {
      found: false,
      mayExecute: false,
      action: WorkflowLedgerRecoveryAction.NONE,
      changed: false,
    };
  }
  const actor = resolveActor(options.actor, current.run.appId);
  const mayExecute =
    current.run.status === RunStatus.RUNNING &&
    current.cursor.disposition ===
      WorkflowCursorDisposition.ACTIVITY_RUNNABLE &&
    current.invocation.status === InvocationStatus.RUNNABLE;
  if (
    !current.attempt ||
    current.invocation.status !== InvocationStatus.RUNNING
  ) {
    return {
      found: true,
      mayExecute,
      action: WorkflowLedgerRecoveryAction.NONE,
      changed: false,
      outcome: outcomeFromCurrent(current, { reused: true }),
    };
  }
  const settled = await settleRetainedAttempt({
    ledger: options.ledger,
    runId,
    attempt: current.attempt,
    actor,
    phase:
      current.attempt.status === AttemptStatus.CLAIMED
        ? 'resident-restart-before-start'
        : 'resident-restart-after-start',
    error: new Error(
      current.attempt.status === AttemptStatus.CLAIMED
        ? 'The prior resident stopped before durable activity start.'
        : 'The prior resident stopped after durable activity start; its physical outcome is unknown.',
    ),
  });
  if (!settled) {
    return {
      found: false,
      mayExecute: false,
      action: WorkflowLedgerRecoveryAction.NONE,
      changed: false,
    };
  }
  return {
    found: true,
    mayExecute: settled.outcome.disposition === 'runnable',
    action: settled.action,
    changed: settled.changed,
    outcome: settled.outcome,
  };
}

/**
 * Execute one exact persisted workflow activity activation. The caller must
 * already hold the application mutation owner and must have cross-checked the
 * persisted plan against the exact executing revision.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, appId: string, revisionId: string, workflowId: string, planId: string, invocationId: string, activityId: string, generation: number, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, actor?: {kind: string, id: string}, admissionSignal?: AbortSignal, signal?: AbortSignal, ownerCancellation?: WorkflowLedgerOwnerCancellation, registerActiveWorkflowCancellationPort?: WorkflowLedgerActiveCancellationPortRegistrar, createFencingToken?: () => string, executeAttempt: (startFrame: Readonly<Record<string, any>>, options: {signal: AbortSignal, onComponentFrame: (frame: Readonly<Record<string, any>>) => Promise<void>}) => Promise<Readonly<Record<string, any>>>}} options - Exact resident workflow activation.
 * @returns {Promise<Record<string, any>>} - Durable current workflow outcome.
 */
export async function runWorkflowLedgerActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('runWorkflowLedgerActivity requires options.');
  }
  const allowed = new Set([
    'ledger',
    'runId',
    'appId',
    'revisionId',
    'workflowId',
    'planId',
    'invocationId',
    'activityId',
    'generation',
    'cursor',
    'actor',
    'admissionSignal',
    'signal',
    'ownerCancellation',
    'registerActiveWorkflowCancellationPort',
    'createFencingToken',
    'executeAttempt',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(`runWorkflowLedgerActivity.${key} is not supported.`);
    }
  }
  if (!options.ledger) {
    throw new TypeError('runWorkflowLedgerActivity requires ledger.');
  }
  if (typeof options.executeAttempt !== 'function') {
    throw new TypeError(
      'runWorkflowLedgerActivity.executeAttempt must be a function.',
    );
  }
  if (
    options.createFencingToken !== undefined &&
    typeof options.createFencingToken !== 'function'
  ) {
    throw new TypeError(
      'runWorkflowLedgerActivity.createFencingToken must be a function when provided.',
    );
  }
  if (
    options.registerActiveWorkflowCancellationPort !== undefined &&
    typeof options.registerActiveWorkflowCancellationPort !== 'function'
  ) {
    throw new TypeError(
      'runWorkflowLedgerActivity.registerActiveWorkflowCancellationPort must be a function when provided.',
    );
  }
  assertWorkflowRunId(options.runId, 'workflow runId');
  const runId = options.runId;
  assertLogicalId(options.appId, 'workflow appId');
  assertApplicationRevisionId(options.revisionId, 'workflow revisionId');
  assertLogicalId(options.workflowId, 'workflow workflowId');
  assertWorkflowPlanId(options.planId, 'workflow planId');
  const invocationId = assertLedgerOpaqueId(
    options.invocationId,
    'workflow invocationId',
  );
  assertLogicalId(options.activityId, 'workflow activityId');
  if (!Number.isSafeInteger(options.generation) || options.generation < 0) {
    throw new TypeError(
      'runWorkflowLedgerActivity.generation must be a non-negative safe integer.',
    );
  }
  const expectedCursor = normalizeCursorGuard(
    options.cursor,
    'runWorkflowLedgerActivity.cursor',
  );
  const actor = resolveActor(options.actor, options.appId);
  const ownerCancellation = normalizeOwnerCancellation(
    options.ownerCancellation,
    actor,
    'runWorkflowLedgerActivity.ownerCancellation',
  );
  const admissionSignal = resolveOptionalAbortSignal(
    options.admissionSignal,
    'runWorkflowLedgerActivity.admissionSignal',
  );
  const physicalSignal = resolveOptionalAbortSignal(
    options.signal,
    'runWorkflowLedgerActivity.signal',
  );
  const createFencingToken =
    options.createFencingToken || (() => `workflow-local-${randomUUID()}`);

  let current = await readCurrentWorkflow(options.ledger, runId);
  if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
  if (
    current.run.appId !== options.appId ||
    current.run.revisionId !== options.revisionId ||
    current.run.trigger.workflowId !== options.workflowId ||
    current.run.trigger.planId !== options.planId
  ) {
    throw new Error(
      `Workflow run ${runId} does not match its resident application revision and plan.`,
    );
  }
  const exactActivation =
    current.invocation?.invocationId === invocationId &&
    current.invocation.activityId === options.activityId &&
    current.invocation.generation === options.generation &&
    isSameCursorGuard(current.cursor, expectedCursor);
  if (!exactActivation || !current.invocation) {
    return outcomeFromCurrent(current, { reused: true });
  }
  if (
    current.run.status !== RunStatus.RUNNING ||
    current.cursor.disposition !==
      WorkflowCursorDisposition.ACTIVITY_RUNNABLE ||
    current.invocation.status !== InvocationStatus.RUNNABLE ||
    admissionSignal?.aborted
  ) {
    return outcomeFromCurrent(current, { reused: true });
  }

  const fencingToken = assertLedgerOpaqueId(
    createFencingToken(),
    'workflow fencing token',
  );
  let claimRequest = {
    runId,
    invocationId,
    cursor: expectedCursor,
    fencingToken,
    expectedGeneration: options.generation,
    expectedVersion: current.run.version,
    transitionId: `workflow-claim:${invocationId}:${options.generation + 1}`,
    actor,
    coordinatorEpoch: 0,
  };
  /** @type {Record<string, any> | undefined} */
  let claim;
  /** @type {unknown[]} */
  const claimErrors = [];
  let finalClaimFailureFollowedHeadAdvance = false;
  for (let retry = 0; retry < 2 && !claim; retry += 1) {
    if (admissionSignal?.aborted) {
      return outcomeFromCurrent(current, { reused: true });
    }
    try {
      claim = await options.ledger.claimWorkflowActivity(claimRequest);
    } catch (error) {
      const attemptedExpectedVersion = claimRequest.expectedVersion;
      claimErrors.push(error);
      current = await readCurrentWorkflow(options.ledger, runId);
      if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
      if (
        current.attempt?.fencingToken === fencingToken &&
        current.attempt.generation === options.generation + 1
      ) {
        // An ambiguous claim receipt is not a delivery lease. The RECOVERY row
        // stays authoritative for a later resident generation.
        return outcomeFromCurrent(current, { reused: true });
      }
      if (
        !current.invocation ||
        current.invocation.invocationId !== invocationId ||
        current.invocation.activityId !== options.activityId ||
        current.invocation.generation !== options.generation ||
        !isSameCursorGuard(current.cursor, expectedCursor) ||
        current.invocation.status !== InvocationStatus.RUNNABLE ||
        current.run.status !== RunStatus.RUNNING ||
        current.cursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNABLE
      ) {
        return outcomeFromCurrent(current, { reused: true });
      }
      // A rejected signal is a durable audit decision that advances only the
      // run head. Retain the exact cursor/invocation/fence authority while
      // rebasing the bounded claim retry onto that newly verified head.
      finalClaimFailureFollowedHeadAdvance =
        error instanceof ExecutionLedgerConflictError &&
        current.run.version > attemptedExpectedVersion;
      claimRequest = {
        ...claimRequest,
        expectedVersion: current.run.version,
      };
    }
  }
  if (!claim) {
    if (finalClaimFailureFollowedHeadAdvance) {
      // Sustained audit-only churn must not kill the resident once the bounded
      // in-call retry is spent. Return the exact current activation so the
      // worker can reload its transactionally refreshed locator.
      return outcomeFromCurrent(current, { reused: true });
    }
    throw new AggregateError(
      claimErrors,
      `Could not claim workflow activity ${runId}#${invocationId}.`,
    );
  }
  if (
    !claim.applied ||
    claim.run.status !== RunStatus.RUNNING ||
    claim.workflowCursor.disposition !==
      WorkflowCursorDisposition.ACTIVITY_RUNNING ||
    claim.invocation.status !== InvocationStatus.RUNNING ||
    claim.attempt.status !== AttemptStatus.CLAIMED
  ) {
    current = await readCurrentWorkflow(options.ledger, runId);
    if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
    return outcomeFromCurrent(current, { reused: true });
  }
  const attempt = claim.attempt;

  if (admissionSignal?.aborted) {
    const settled = await settleRetainedAttempt({
      ledger: options.ledger,
      runId,
      attempt,
      actor,
      phase: 'shutdown-after-claim',
      error: admissionSignal.reason,
    });
    if (!settled) throw new Error(`Workflow run disappeared: ${runId}`);
    return settled.outcome;
  }

  let startRequest = {
    runId,
    invocationId,
    cursor: cursorGuard(claim.workflowCursor),
    attemptId: attempt.attemptId,
    fencingToken,
    generation: attempt.generation,
    expectedVersion: claim.run.version,
    transitionId: `workflow-start:${attempt.attemptId}`,
    actor,
    coordinatorEpoch: attempt.coordinatorEpoch,
  };
  /** @type {Record<string, any> | undefined} */
  let started;
  /** @type {unknown[]} */
  const startErrors = [];
  for (let retry = 0; retry < 2 && !started; retry += 1) {
    if (admissionSignal?.aborted) break;
    try {
      started = await options.ledger.markWorkflowActivityStarted(startRequest);
    } catch (error) {
      const attemptedExpectedVersion = startRequest.expectedVersion;
      startErrors.push(error);
      current = await readCurrentWorkflow(options.ledger, runId);
      if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
      if (!current.attempt || !isSameAttempt(current.attempt, attempt)) {
        return outcomeFromCurrent(current, { reused: true });
      }
      if (current.attempt.status === AttemptStatus.STARTED) break;
      if (current.attempt.status !== AttemptStatus.CLAIMED) {
        return outcomeFromCurrent(current, { reused: true });
      }
      if (
        !current.invocation ||
        current.invocation.invocationId !== invocationId ||
        current.invocation.activityId !== options.activityId ||
        current.invocation.status !== InvocationStatus.RUNNING ||
        current.run.status !== RunStatus.RUNNING ||
        current.cursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNING ||
        !isSameCursorGuard(current.cursor, startRequest.cursor)
      ) {
        return outcomeFromCurrent(current, { reused: true });
      }
      if (current.run.version > attemptedExpectedVersion) {
        // Rejected signals advance only the run head. The exact retained
        // CLAIMED attempt, cursor, and fence remain authoritative, so rebase
        // the bounded start retry instead of repeating a known-stale request.
        startRequest = {
          ...startRequest,
          expectedVersion: current.run.version,
        };
      }
    }
  }
  if (!started || !started.dispatchAuthorized || admissionSignal?.aborted) {
    const cause = admissionSignal?.aborted
      ? admissionSignal.reason
      : startErrors.length > 0
        ? new AggregateError(startErrors, 'Workflow start was not confirmed.')
        : new Error(
            'The durable workflow start receipt was replayed and cannot authorize physical dispatch.',
          );
    const settled = await settleRetainedAttempt({
      ledger: options.ledger,
      runId,
      attempt,
      actor,
      phase:
        started?.dispatchAuthorized === false
          ? 'start-replay'
          : admissionSignal?.aborted
            ? 'shutdown-before-dispatch'
            : 'start-transition',
      error: cause,
    });
    if (!settled) throw new Error(`Workflow run disappeared: ${runId}`);
    return settled.outcome;
  }

  const attemptController = new AbortController();
  /** @type {Map<string, Promise<WorkflowLedgerCancellationResult>>} */
  const cancellationPromises = new Map();
  /** @type {WorkflowLedgerActiveCancellationPort | undefined} */
  let activeCancellationPort;
  /** @type {(() => void) | null} */
  let unregisterCancellationPort = null;
  let cancellationPortLive = false;
  const abortPhysicalAttempt = () => {
    if (!attemptController.signal.aborted) {
      attemptController.abort(physicalSignal?.reason);
    }
  };

  /**
   * Persist exactly one request identity and deliver its retained reason only
   * when this append owns the newly accepted STARTED cancellation decision.
   * @param {string} requestId - Stable caller-facing request identity.
   * @returns {Promise<WorkflowLedgerCancellationResult>} - Durable result.
   */
  const beginCancellation = (requestId) => {
    const existing = cancellationPromises.get(requestId);
    if (existing) return existing;
    const transitionId = createWorkflowCancellationTransitionId({
      runId,
      requestId,
    });
    const promise = persistWorkflowLedgerRunCancellation({
      ledger: options.ledger,
      runId,
      requestId,
      transitionId,
      actor: ownerCancellation.actor,
      reason: ownerCancellation.reason,
      authorizedPort: activeCancellationPort,
    }).then((result) => {
      let signalDelivered = false;
      if (
        cancellationPortLive &&
        result.cancellationDeliveryRequired &&
        result.outcome === 'cancellation-requested' &&
        result.run.status === RunStatus.RUNNING &&
        result.invocation?.status === InvocationStatus.RUNNING &&
        result.attempt?.status === AttemptStatus.STARTED &&
        isSameAttempt(result.attempt, attempt) &&
        result.run.cancellationRequest?.requestId === requestId &&
        !attemptController.signal.aborted
      ) {
        attemptController.abort(result.run.cancellationRequest.reason);
        signalDelivered = true;
      }
      return /** @type {WorkflowLedgerCancellationResult} */ ({
        ...result,
        signalDelivered,
      });
    });
    cancellationPromises.set(requestId, promise);
    // Fire-and-forget owner endpoints must not create an unhandled rejection.
    // A failed or response-lost call remains retryable with the same ID; the
    // ledger replay then reports delivery not required and cannot signal twice.
    promise.catch(() => {
      if (cancellationPromises.get(requestId) === promise) {
        cancellationPromises.delete(requestId);
      }
    });
    return promise;
  };

  /** @type {Readonly<Record<string, any>> | undefined} */
  let evidence;
  /** @type {unknown} */
  let executionError;
  let executionErrorPhase = 'physical-dispatch';
  try {
    try {
      if (options.registerActiveWorkflowCancellationPort) {
        cancellationPortLive = true;
        activeCancellationPort = Object.freeze({
          version: WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION,
          runId,
          invocationId,
          cursor: Object.freeze(cursorGuard(started.workflowCursor)),
          attemptId: attempt.attemptId,
          fencingToken: attempt.fencingToken,
          generation: attempt.generation,
          coordinatorEpoch: attempt.coordinatorEpoch,
          requestCancellation: (request) => {
            if (!cancellationPortLive) {
              return Promise.reject(
                new Error(
                  `Active workflow cancellation port is no longer live: ${runId}#${attempt.attemptId}.`,
                ),
              );
            }
            let normalized;
            try {
              normalized = normalizeActiveCancellationRequest(request);
            } catch (error) {
              return Promise.reject(error);
            }
            return beginCancellation(normalized.requestId);
          },
        });
        const unregister = options.registerActiveWorkflowCancellationPort(
          activeCancellationPort,
        );
        if (unregister !== undefined && typeof unregister !== 'function') {
          throw new TypeError(
            'runWorkflowLedgerActivity.registerActiveWorkflowCancellationPort must return a function or undefined.',
          );
        }
        unregisterCancellationPort = unregister || null;
      }
    } catch (error) {
      executionError = error;
      executionErrorPhase = 'cancellation-port-registration';
    }

    if (executionError === undefined) {
      physicalSignal?.addEventListener('abort', abortPhysicalAttempt, {
        once: true,
      });
      if (physicalSignal?.aborted) abortPhysicalAttempt();

      try {
        evidence = await options.executeAttempt(started.startFrame, {
          signal: attemptController.signal,
          onComponentFrame: createDurableActivityLogSink({
            ledger: options.ledger,
            attempt: started.attempt,
          }),
        });
      } catch (error) {
        executionError = error;
      }
    }

    // Bind terminal CAS to every cancellation append which began while the
    // physical attempt was live. Response-loss failures are observed, but do
    // not prevent a complete terminal transcript from competing normally.
    await Promise.allSettled([...cancellationPromises.values()]);

    if (executionError !== undefined) {
      const settled = await settleRetainedAttempt({
        ledger: options.ledger,
        runId,
        attempt,
        actor,
        phase: executionErrorPhase,
        error: executionError,
        dispatched: executionErrorPhase === 'physical-dispatch',
      });
      if (!settled) throw new Error(`Workflow run disappeared: ${runId}`);
      return settled.outcome;
    }
    if (
      !evidence ||
      typeof evidence !== 'object' ||
      !SUPPORTED_TERMINALS.has(
        /** @type {Record<string, any>} */ (evidence).status,
      )
    ) {
      const terminalType =
        evidence && typeof evidence === 'object'
          ? /** @type {Record<string, any>} */ (evidence).status
          : undefined;
      const settled = await settleRetainedAttempt({
        ledger: options.ledger,
        runId,
        attempt,
        actor,
        phase: 'unsupported-terminal',
        error: new Error(
          `Workflow activity produced unsupported terminal '${String(terminalType)}'.`,
        ),
        dispatched: true,
      });
      if (!settled) throw new Error(`Workflow run disappeared: ${runId}`);
      return settled.outcome;
    }

    let terminalCursor = cursorGuard(started.workflowCursor);
    let terminalExpectedVersion = started.run.version;
    /** @type {unknown[]} */
    const terminalErrors = [];
    let terminalFailuresAtSameHead = 0;
    /** @type {number | undefined} */
    let terminalFailedHeadVersion;
    while (terminalFailuresAtSameHead < 3) {
      try {
        await options.ledger.commitVerifiedWorkflowActivityTerminal({
          runId,
          invocationId,
          cursor: terminalCursor,
          attemptId: attempt.attemptId,
          fencingToken,
          generation: attempt.generation,
          expectedVersion: terminalExpectedVersion,
          transitionId: `workflow-terminal:${attempt.attemptId}`,
          evidence,
          actor,
          coordinatorEpoch: attempt.coordinatorEpoch,
        });
        current = await readCurrentWorkflow(options.ledger, runId);
        if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
        return outcomeFromCurrent(current, { dispatched: true });
      } catch (error) {
        terminalErrors.push(error);
        current = await readCurrentWorkflow(options.ledger, runId);
        if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
        if (
          !current.attempt ||
          !current.invocation ||
          !isSameAttempt(current.attempt, attempt) ||
          current.attempt.status !== AttemptStatus.STARTED ||
          current.invocation.status !== InvocationStatus.RUNNING ||
          current.cursor.disposition !==
            WorkflowCursorDisposition.ACTIVITY_RUNNING ||
          !isSameCursorActivation(current.cursor, started.workflowCursor)
        ) {
          return outcomeFromCurrent(current, {
            reused: true,
            dispatched: true,
          });
        }
        const headAdvanced = current.run.version !== terminalExpectedVersion;
        // Cancellation and audit-only rejected-signal events both advance the
        // run and cursor while retaining the exact physical activity. Rebase
        // the same terminal evidence without spending the storage-failure
        // budget; otherwise sustained unrelated rejections could manufacture
        // false activity uncertainty.
        terminalCursor = cursorGuard(current.cursor);
        terminalExpectedVersion = current.run.version;
        if (headAdvanced) continue;
        if (terminalFailedHeadVersion === current.run.version) {
          terminalFailuresAtSameHead += 1;
        } else {
          terminalFailedHeadVersion = current.run.version;
          terminalFailuresAtSameHead = 1;
        }
      }
    }

    const settled = await settleRetainedAttempt({
      ledger: options.ledger,
      runId,
      attempt,
      actor,
      phase: 'terminal-commit',
      error: new AggregateError(
        terminalErrors,
        'Could not confirm the durable workflow activity terminal.',
      ),
      dispatched: true,
    });
    if (!settled) throw new Error(`Workflow run disappeared: ${runId}`);
    return settled.outcome;
  } finally {
    cancellationPortLive = false;
    physicalSignal?.removeEventListener('abort', abortPhysicalAttempt);
    if (unregisterCancellationPort) unregisterCancellationPort();
    await Promise.allSettled([...cancellationPromises.values()]);
  }
}

export default {
  WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION,
  WorkflowLedgerRecoveryAction,
  recoverWorkflowLedgerActivity,
  requestWorkflowLedgerRunCancellation,
  runWorkflowLedgerActivity,
};
