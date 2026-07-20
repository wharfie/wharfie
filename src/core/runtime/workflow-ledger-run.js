import { randomUUID } from 'node:crypto';

import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
} from '../lib/db/tables/execution-ledger.js';
import {
  WorkflowCursorDisposition,
  assertWorkflowPlanId,
  assertWorkflowRunId,
} from '../lib/ledger/workflow-execution-contract.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { serializeActivityAttemptError } from './activity-attempt.js';
import { assertApplicationRevisionId } from './application-revision.js';
import { assertLogicalId } from './logical-id.js';

const DEFAULT_ACTOR_KIND = 'resident-workflow';
const SUPPORTED_TERMINALS = new Set(['completed', 'failed', 'protocol-failed']);

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
 * @returns {Promise<{view: Record<string, any>, run: Record<string, any>, cursor: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>} | null>} - Verified current workflow activation.
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

/**
 * @param {{run: Record<string, any>, cursor: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} current - Verified current state.
 * @param {{reused?: boolean, dispatched?: boolean}} [options] - Result flags.
 * @returns {Record<string, any>} - Compact runner outcome.
 */
function outcomeFromCurrent(current, options = {}) {
  const disposition =
    current.run.status === RunStatus.COMPLETED
      ? 'completed'
      : current.run.status === RunStatus.FAILED
        ? 'failed'
        : current.run.status === RunStatus.BLOCKED
          ? 'blocked'
          : current.cursor.disposition ===
              WorkflowCursorDisposition.ACTIVITY_RUNNABLE
            ? 'runnable'
            : 'in-progress';
  return {
    disposition,
    reused: options.reused ?? false,
    dispatched: options.dispatched ?? false,
    run: current.run,
    workflowCursor: current.cursor,
    invocation: current.invocation,
    ...(current.attempt ? { attempt: current.attempt } : {}),
  };
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
  for (let retry = 0; retry < 3; retry += 1) {
    const current = await readCurrentWorkflow(options.ledger, options.runId);
    if (!current) return null;
    if (
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
  if (!current || current.invocation.invocationId !== invocationId) {
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
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, runId: string, appId: string, revisionId: string, workflowId: string, planId: string, invocationId: string, activityId: string, generation: number, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, actor?: {kind: string, id: string}, admissionSignal?: AbortSignal, signal?: AbortSignal, createFencingToken?: () => string, executeAttempt: (startFrame: Readonly<Record<string, any>>, options: {signal: AbortSignal}) => Promise<Readonly<Record<string, any>>>}} options - Exact resident workflow activation.
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
    current.invocation.invocationId === invocationId &&
    current.invocation.activityId === options.activityId &&
    current.invocation.generation === options.generation &&
    isSameCursorGuard(current.cursor, expectedCursor);
  if (!exactActivation) {
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
  const claimRequest = {
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
  for (let retry = 0; retry < 2 && !claim; retry += 1) {
    if (admissionSignal?.aborted) {
      return outcomeFromCurrent(current, { reused: true });
    }
    try {
      claim = await options.ledger.claimWorkflowActivity(claimRequest);
    } catch (error) {
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
        current.invocation.invocationId !== invocationId ||
        !isSameCursorGuard(current.cursor, expectedCursor) ||
        current.invocation.status !== InvocationStatus.RUNNABLE
      ) {
        return outcomeFromCurrent(current, { reused: true });
      }
    }
  }
  if (!claim) {
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

  const startRequest = {
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
  const abortPhysicalAttempt = () => {
    if (!attemptController.signal.aborted) {
      attemptController.abort(physicalSignal?.reason);
    }
  };
  physicalSignal?.addEventListener('abort', abortPhysicalAttempt, {
    once: true,
  });
  if (physicalSignal?.aborted) abortPhysicalAttempt();

  /** @type {Readonly<Record<string, any>> | undefined} */
  let evidence;
  /** @type {unknown} */
  let executionError;
  try {
    evidence = await options.executeAttempt(started.startFrame, {
      signal: attemptController.signal,
    });
  } catch (error) {
    executionError = error;
  } finally {
    physicalSignal?.removeEventListener('abort', abortPhysicalAttempt);
  }
  if (executionError !== undefined) {
    const settled = await settleRetainedAttempt({
      ledger: options.ledger,
      runId,
      attempt,
      actor,
      phase: 'physical-dispatch',
      error: executionError,
      dispatched: true,
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

  const terminalRequest = {
    runId,
    invocationId,
    cursor: cursorGuard(started.workflowCursor),
    attemptId: attempt.attemptId,
    fencingToken,
    generation: attempt.generation,
    expectedVersion: started.run.version,
    transitionId: `workflow-terminal:${attempt.attemptId}`,
    evidence,
    actor,
    coordinatorEpoch: attempt.coordinatorEpoch,
  };
  /** @type {unknown[]} */
  const terminalErrors = [];
  for (let retry = 0; retry < 2; retry += 1) {
    try {
      await options.ledger.commitVerifiedWorkflowActivityTerminal(
        terminalRequest,
      );
      current = await readCurrentWorkflow(options.ledger, runId);
      if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
      return outcomeFromCurrent(current, { dispatched: true });
    } catch (error) {
      terminalErrors.push(error);
      current = await readCurrentWorkflow(options.ledger, runId);
      if (!current) throw new Error(`Workflow run disappeared: ${runId}`);
      if (
        !current.attempt ||
        !isSameAttempt(current.attempt, attempt) ||
        current.attempt.status !== AttemptStatus.STARTED ||
        current.invocation.status !== InvocationStatus.RUNNING
      ) {
        return outcomeFromCurrent(current, {
          reused: true,
          dispatched: true,
        });
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
}

export default {
  WorkflowLedgerRecoveryAction,
  recoverWorkflowLedgerActivity,
  runWorkflowLedgerActivity,
};
