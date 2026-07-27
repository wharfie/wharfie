import {
  AttemptStatus,
  EffectStatus,
  ExecutionLedgerConflictError,
  InvocationStatus,
  RunStatus,
} from '../../lib/db/tables/execution-ledger.js';
import {
  WorkflowCursorDisposition,
  createWorkflowRunId,
} from '../../lib/ledger/workflow-execution-contract.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { resolveManifestActivityExecutionBinding } from '../app-runs.js';
import { assertArtifactId } from '../artifact-record.js';
import {
  assertApplicationStateStoreIsolation,
  resolveApplicationStateStoreConfiguration,
  validateApplicationStateStoreConfiguration,
  withApplicationStateDB,
} from '../application-state-store.js';
import {
  runPersistedDurableManifestActivity,
  submitDurableManifestActivity,
} from '../durable-activity-host.js';
import {
  resolveManifestWorkflowActivityBinding,
  resolveManifestWorkflowStartBinding,
  runPersistedDurableManifestWorkflowActivity,
  startDurableManifestWorkflow,
} from '../durable-workflow-host.js';
import { createBuiltinManagedEffectRecoveryCatalog } from '../effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
  recoverManualLedgerActivity,
} from '../manual-ledger-run.js';
import {
  recoverWorkflowLedgerActivity,
  requestWorkflowLedgerRunCancellation,
} from '../workflow-ledger-run.js';
import {
  deliverWorkflowLedgerSignal,
  fireWorkflowLedgerTimer,
} from '../workflow-ledger-continuation.js';
import {
  EXECUTION_LEDGER_CANCEL_OWNER_COMMAND,
  recoverStoppedManagedEffectsAtOperatorBoundary,
} from '../operator/execution-ledger-operator.js';
import {
  resolveExecutionLedgerStoreConfiguration,
  withExecutionLedger,
  withLocalLedgerServiceMutationOwnership,
} from '../operator/execution-ledger-store.js';
import {
  LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
  LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
  createLocalOwnerCommandServer,
  sendLocalOwnerCommand,
} from '../operator/local-owner-command.js';
import { cloneJsonObject } from '../json-value.js';
import { createLedgerService } from './ledger-service.js';
import { runResidentScheduleObserver } from './resident-schedule-observer.js';

export const RESIDENT_ACTIVITY_SUBMIT_COMMAND = 'execution-ledger-submit';
export const RESIDENT_WORKFLOW_START_COMMAND =
  'execution-ledger-workflow-start';
export const RESIDENT_WORKFLOW_SIGNAL_COMMAND =
  'execution-ledger-workflow-signal';
export const RESIDENT_ACTIVITY_DEFAULT_POLL_INTERVAL_MS = 1_000;
export const RESIDENT_ACTIVITY_DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
export const RESIDENT_ACTIVITY_READY_WORK_LIMIT = 50;

/** @typedef {{kind: 'manual', runId: string} | {kind: 'workflow', runId: string, workflowId: string, planId: string, invocationId: string, activityId: string, generation: number, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}} | {kind: 'timer', runId: string, workflowId: string, planId: string, timerId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}}} ResidentRunnableWork */

/**
 * @param {unknown} value - Candidate abort signal.
 * @returns {AbortSignal | undefined} - Validated optional signal.
 */
function resolveOptionalAbortSignal(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (/** @type {AbortSignal} */ (value).addEventListener) !==
      'function' ||
    typeof (/** @type {AbortSignal} */ (value).removeEventListener) !==
      'function'
  ) {
    throw new TypeError(
      'Resident activity worker signal must be an AbortSignal when provided.',
    );
  }
  return /** @type {AbortSignal} */ (value);
}

/**
 * @param {unknown} value - Candidate poll interval.
 * @returns {number} - Bounded poll interval.
 */
function resolvePollInterval(value) {
  if (value === undefined) return RESIDENT_ACTIVITY_DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(
      'Resident activity worker pollIntervalMs must be a positive safe integer.',
    );
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate graceful drain allowance.
 * @returns {number} - Bounded milliseconds before physical drain enforcement.
 */
function resolveDrainTimeout(value) {
  if (value === undefined) return RESIDENT_ACTIVITY_DEFAULT_DRAIN_TIMEOUT_MS;
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(
      'Resident activity worker drainTimeoutMs must be a positive safe integer.',
    );
  }
  return Number(value);
}

/**
 * Wait for initial schedule reconciliation or abort, whichever occurs first.
 * @param {Promise<boolean>} readiness - Observer readiness handshake.
 * @param {AbortSignal} signal - Combined worker cancellation.
 * @returns {Promise<boolean>} Whether schedules became ready first.
 */
async function waitForScheduleReadiness(readiness, signal) {
  if (signal.aborted) return false;
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (/** @type {boolean} */ ready) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      resolve(ready);
    };
    const aborted = () => finish(false);
    signal.addEventListener('abort', aborted, { once: true });
    readiness.then((ready) => finish(ready));
    if (signal.aborted) aborted();
  });
}

/**
 * Bound observer cleanup so an unresponsive store or injected observer cannot
 * retain the resident owner forever. Any later write remains fenced by the
 * released exact owner and application activation.
 * @param {Promise<unknown>} pending - Observer completion.
 * @param {number} timeoutMs - Bounded cleanup allowance.
 * @returns {Promise<boolean>} Whether the observer settled in time.
 */
async function waitForScheduleObserverDrain(pending, timeoutMs) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const settled = pending.then(
    () => true,
    () => true,
  );
  const expired = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([settled, expired]);
  if (timer) clearTimeout(timer);
  return Boolean(result);
}

/**
 * @param {number} drainTimeoutMs - Bounded observer cleanup allowance.
 * @returns {Error & {name: string, code: string, details: Readonly<{drainTimeoutMs: number}>}} Typed drain failure.
 */
function createScheduleObserverDrainExpiredError(drainTimeoutMs) {
  return Object.assign(
    new Error(
      `Resident schedule observer did not stop within ${drainTimeoutMs}ms.`,
    ),
    {
      name: 'ResidentScheduleObserverDrainExpired',
      code: 'resident-schedule-observer-drain-expired',
      details: Object.freeze({ drainTimeoutMs }),
    },
  );
}

/**
 * @param {Readonly<Record<string, any>> | null} observed - Current durable owner.
 * @param {Readonly<Record<string, any>>} held - Exact held owner.
 * @returns {boolean} - Whether the durable owner fence remains exact.
 */
function isCurrentOwner(observed, held) {
  return Boolean(
    observed &&
    observed.serviceId === held.serviceId &&
    observed.appId === held.appId &&
    observed.scopeId === held.scopeId &&
    observed.principalId === held.principalId &&
    observed.sessionId === held.sessionId &&
    observed.ownerKind === held.ownerKind &&
    observed.generation === held.generation,
  );
}

/**
 * @param {unknown} value - Authenticated submit payload.
 * @returns {{appId: string, revisionId: string, activityName: string, idempotencyKey: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}}} - Exact supported durable request.
 */
function normalizeSubmitRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Resident activity submission must be an object.');
  }
  const request = /** @type {Record<string, any>} */ (value);
  const supported = new Set([
    'appId',
    'revisionId',
    'activityName',
    'idempotencyKey',
    'input',
    'callerMetadata',
    'actor',
  ]);
  for (const key of Object.keys(request)) {
    if (!supported.has(key)) {
      throw new TypeError(
        `Resident activity submission.${key} is unsupported.`,
      );
    }
  }
  if (
    typeof request.appId !== 'string' ||
    !request.appId ||
    typeof request.revisionId !== 'string' ||
    !request.revisionId ||
    !Object.prototype.hasOwnProperty.call(request, 'activityName') ||
    typeof request.activityName !== 'string' ||
    !request.activityName ||
    !Object.prototype.hasOwnProperty.call(request, 'idempotencyKey') ||
    typeof request.idempotencyKey !== 'string' ||
    !request.idempotencyKey
  ) {
    throw new TypeError(
      'Resident activity submission requires appId, revisionId, activityName, and idempotencyKey.',
    );
  }
  return {
    appId: request.appId,
    revisionId: request.revisionId,
    activityName: request.activityName,
    idempotencyKey: request.idempotencyKey,
    ...(Object.prototype.hasOwnProperty.call(request, 'input')
      ? { input: request.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'callerMetadata')
      ? { callerMetadata: request.callerMetadata }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'actor')
      ? { actor: request.actor }
      : {}),
  };
}

/**
 * @param {unknown} value - Authenticated workflow-start payload.
 * @returns {{appId: string, revisionId: string, workflowId: string, idempotencyKey: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}}} - Exact supported durable request.
 */
function normalizeWorkflowStartRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Resident workflow start must be an object.');
  }
  const request = /** @type {Record<string, any>} */ (value);
  const supported = new Set([
    'appId',
    'revisionId',
    'workflowId',
    'idempotencyKey',
    'input',
    'callerMetadata',
    'actor',
  ]);
  for (const key of Object.keys(request)) {
    if (!supported.has(key)) {
      throw new TypeError(`Resident workflow start.${key} is unsupported.`);
    }
  }
  if (
    typeof request.appId !== 'string' ||
    !request.appId ||
    typeof request.revisionId !== 'string' ||
    !request.revisionId ||
    typeof request.workflowId !== 'string' ||
    !request.workflowId ||
    typeof request.idempotencyKey !== 'string' ||
    !request.idempotencyKey
  ) {
    throw new TypeError(
      'Resident workflow start requires appId, revisionId, workflowId, and idempotencyKey.',
    );
  }
  return {
    appId: request.appId,
    revisionId: request.revisionId,
    workflowId: request.workflowId,
    idempotencyKey: request.idempotencyKey,
    ...(Object.prototype.hasOwnProperty.call(request, 'input')
      ? { input: request.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'callerMetadata')
      ? { callerMetadata: request.callerMetadata }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'actor')
      ? { actor: request.actor }
      : {}),
  };
}

/**
 * @param {unknown} value - Authenticated workflow-signal payload.
 * @returns {{appId: string, runId: string, signalId: string, deliveryId: string, payload: any}} - Exact supported delivery request.
 */
function normalizeWorkflowSignalRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Resident workflow signal must be an object.');
  }
  const request = /** @type {Record<string, any>} */ (value);
  const supported = new Set([
    'appId',
    'runId',
    'signalId',
    'deliveryId',
    'payload',
  ]);
  for (const key of Reflect.ownKeys(request)) {
    if (typeof key !== 'string' || !supported.has(key)) {
      throw new TypeError(
        `Resident workflow signal.${String(key)} is unsupported.`,
      );
    }
  }
  if (
    typeof request.appId !== 'string' ||
    !request.appId ||
    typeof request.runId !== 'string' ||
    !request.runId ||
    typeof request.signalId !== 'string' ||
    !request.signalId ||
    typeof request.deliveryId !== 'string' ||
    !request.deliveryId ||
    !Object.prototype.hasOwnProperty.call(request, 'payload')
  ) {
    throw new TypeError(
      'Resident workflow signal requires appId, runId, signalId, deliveryId, and payload.',
    );
  }
  return {
    appId: request.appId,
    runId: request.runId,
    signalId: request.signalId,
    deliveryId: request.deliveryId,
    payload: request.payload,
  };
}

/**
 * Wait until a submit wakes the worker, its poll interval elapses, or shutdown
 * begins. Active-attempt drain signaling is owned by the dispatch loop.
 * @param {{signal?: AbortSignal, pollIntervalMs: number, subscribeWake: (listener: () => void) => () => void}} options - Wait controls.
 * @returns {Promise<void>} - Next ready-work poll boundary.
 */
async function waitForNextReadyWorkPoll(options) {
  if (options.signal?.aborted) return;
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      options.signal?.removeEventListener('abort', finish);
      resolve(undefined);
    };
    const timer = setTimeout(finish, options.pollIntervalMs);
    const unsubscribe = options.subscribeWake(finish);
    options.signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Return the complete unresolved managed-effect set owned by one exact
 * physical attempt. Terminal siblings do not participate in stopped-runner
 * recovery, while every PENDING or STARTED sibling must settle atomically.
 * @param {Record<string, any>} view - Verified durable run.
 * @param {Record<string, any>} invocation - Current manual invocation.
 * @param {Record<string, any>} attempt - Current physical attempt.
 * @returns {Record<string, any>[]} - Exact unresolved sibling set.
 */
function getUnresolvedAttemptEffects(view, invocation, attempt) {
  return (view.effects || []).filter(
    (/** @type {Record<string, any>} */ effect) =>
      effect.invocationId === invocation.invocationId &&
      effect.requestedBy?.attemptId === attempt.attemptId &&
      [EffectStatus.PENDING, EffectStatus.STARTED].includes(effect.status),
  );
}

/**
 * Converge one valid but stale locator toward the authoritative event fold.
 * A concurrent lifecycle transition wins through the run-head CAS and has
 * already maintained its own locator, so that specific repair conflict is a
 * successful liveness race rather than a worker failure.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, revisionId: string, row: Record<string, any>}} options - Exact stale locator.
 * @returns {Promise<void>} - Resolves after repair or a winning transition.
 */
async function repairStaleReadyWorkLocator(options) {
  if (typeof options.ledger.repairReadyWork !== 'function') return;
  try {
    await options.ledger.repairReadyWork({
      appId: options.appId,
      revisionId: options.revisionId,
      runId: options.row.runId,
      observed: options.row,
    });
  } catch (error) {
    if (!(error instanceof ExecutionLedgerConflictError)) throw error;
  }
}

/**
 * Recover a stale STARTED attempt with unresolved managed effects under the
 * already-held resident owner. PENDING effects are cancelled without touching
 * a destination. STARTED built-in application-state effects are probed through
 * the recovery-only catalog before the whole sibling set is settled in one
 * ledger event; normal adapter execution is never available on this path.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, runId: string, invocationId: string, attemptId: string, attempt: Record<string, any>, effects: Record<string, any>[], actor: {kind: string, id: string}, controlContext: {adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string}, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>}} options - Exact stopped-attempt recovery inputs.
 * @returns {Promise<Readonly<Record<string, any>>>} - Redacted atomic recovery result.
 */
export async function recoverResidentManagedEffects(options) {
  const hasStarted = options.effects.some(
    (effect) => effect.status === EffectStatus.STARTED,
  );
  if (!hasStarted) {
    return await recoverStoppedManagedEffectsAtOperatorBoundary({
      ledger: options.ledger,
      runId: options.runId,
      target: {
        invocationId: options.invocationId,
        attemptId: options.attemptId,
        attempt: options.attempt,
        effects: options.effects,
      },
      actor: options.actor,
    });
  }

  const applicationStateConfiguration =
    options.applicationStateConfiguration === undefined
      ? resolveApplicationStateStoreConfiguration()
      : validateApplicationStateStoreConfiguration(
          options.applicationStateConfiguration,
        );
  if (applicationStateConfiguration.adapterName !== 'lmdb') {
    throw new Error(
      'Resident recovery of STARTED application-state effects requires the LMDB application-state adapter.',
    );
  }
  assertApplicationStateStoreIsolation(
    applicationStateConfiguration,
    options.controlContext,
  );

  return await withApplicationStateDB(
    async (db, context) => {
      assertApplicationStateStoreIsolation(context, options.controlContext);
      const catalog = await createBuiltinManagedEffectRecoveryCatalog({
        db,
        appId: options.appId,
        adapterName: context.adapterName,
        tableName: context.tableName,
      });
      return await recoverStoppedManagedEffectsAtOperatorBoundary({
        ledger: options.ledger,
        runId: options.runId,
        target: {
          invocationId: options.invocationId,
          attemptId: options.attemptId,
          attempt: options.attempt,
          effects: options.effects,
        },
        recoverOutcome: catalog.recoverOutcome,
        actor: options.actor,
      });
    },
    { configuration: applicationStateConfiguration, readOnly: true },
  );
}

/**
 * @param {Record<string, any>} view - Verified current workflow.
 * @param {Record<string, any>} invocation - Cursor-bound invocation.
 * @returns {ResidentRunnableWork} - Exact workflow dispatch descriptor.
 */
function createWorkflowWork(view, invocation) {
  const cursor = view.workflowCursor;
  return {
    kind: 'workflow',
    runId: view.run.runId,
    workflowId: cursor.workflowId,
    planId: cursor.planId,
    invocationId: invocation.invocationId,
    activityId: invocation.activityId,
    generation: invocation.generation,
    cursor: {
      version: cursor.version,
      continuationId: cursor.continuationId,
      stepId: cursor.stepId,
      stepIndex: cursor.stepIndex,
    },
  };
}

/**
 * @param {Record<string, any>} view - Verified current workflow.
 * @param {Record<string, any>} timer - Cursor-bound framework timer.
 * @returns {ResidentRunnableWork} - Exact timer decision descriptor.
 */
function createWorkflowTimerWork(view, timer) {
  const cursor = view.workflowCursor;
  return {
    kind: 'timer',
    runId: view.run.runId,
    workflowId: cursor.workflowId,
    planId: cursor.planId,
    timerId: timer.timerId,
    cursor: {
      version: cursor.version,
      continuationId: cursor.continuationId,
      stepId: cursor.stepId,
      stepIndex: cursor.stepIndex,
    },
  };
}

/**
 * @param {Record<string, any>} row - Candidate workflow ready row.
 * @param {Record<string, any>} cursor - Verified current cursor.
 * @returns {boolean} - Whether every cursor coordinate is exact.
 */
function isExactWorkflowReadyCursor(row, cursor) {
  return (
    row.cursorVersion === cursor.version &&
    row.continuationId === cursor.continuationId &&
    row.stepId === cursor.stepId &&
    row.stepIndex === cursor.stepIndex
  );
}

/**
 * Verify the complete rebuilt workflow/cursor/invocation binding before a
 * ready row or recovery result can become a dispatch candidate.
 * @param {Record<string, any>} view - Rebuilt workflow authority.
 * @param {Record<string, any>} invocation - Candidate cursor invocation.
 * @returns {boolean} - Whether every durable identity agrees.
 */
function isExactWorkflowInvocation(view, invocation) {
  const cursor = view.workflowCursor;
  return Boolean(
    view.run.trigger?.kind === 'workflow' &&
    cursor &&
    cursor.runId === view.run.runId &&
    cursor.appId === view.run.appId &&
    cursor.revisionId === view.run.revisionId &&
    cursor.workflowId === view.run.trigger.workflowId &&
    cursor.planId === view.run.trigger.planId &&
    cursor.invocationId === invocation?.invocationId &&
    invocation.runId === view.run.runId &&
    invocation.appId === view.run.appId &&
    invocation.revisionId === view.run.revisionId &&
    invocation.workflow?.workflowId === cursor.workflowId &&
    invocation.workflow?.planId === cursor.planId &&
    invocation.workflow?.continuationId === cursor.continuationId &&
    invocation.workflow?.stepId === cursor.stepId &&
    invocation.workflow?.stepIndex === cursor.stepIndex,
  );
}

/**
 * Treat a workflow activation which is valid in the ledger but unavailable in
 * this exact embedded revision as parked work. One incompatible run must not
 * terminate the resident or prevent it from serving later ready rows.
 * @param {{identity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, workflowId: string, planId: string, activityId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}}} options - Exact persisted and manifest identities.
 * @returns {boolean} - Whether this resident can safely dispatch the activity.
 */
function canDispatchManifestWorkflowActivity(options) {
  try {
    resolveManifestWorkflowActivityBinding(options);
    return true;
  } catch {
    return false;
  }
}

/**
 * Cross-check a persisted timer against the exact manifest plan pinned to the
 * resident revision. A timer is framework work, but a different revision or
 * plan must remain parked rather than being reinterpreted.
 * @param {{identity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, workflowId: string, planId: string, cursor: {stepId: string, stepIndex: number}}} options - Persisted timer binding.
 * @returns {boolean} - Whether the resident may attempt the timer CAS.
 */
function canFireManifestWorkflowTimer(options) {
  try {
    const binding = resolveManifestWorkflowStartBinding({
      identity: options.identity,
      workflowId: options.workflowId,
    });
    const step = binding.planPayload.definition.steps[options.cursor.stepIndex];
    return (
      binding.planId === options.planId &&
      step?.kind === 'timer' &&
      step.id === options.cursor.stepId
    );
  } catch {
    return false;
  }
}

/**
 * Rebuild a ready-work locator and return only exact manual or workflow work.
 * A retained attempt is first recovered under the successor resident owner;
 * STARTED becomes blocked uncertainty and is never returned for redispatch.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, revisionId: string, manifestIdentity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, row: Record<string, any>, recoverActivity: typeof recoverManualLedgerActivity, recoverWorkflowActivity: typeof recoverWorkflowLedgerActivity, recoverManagedEffects: typeof recoverResidentManagedEffects, controlContext: {adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string}, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, signal?: AbortSignal}} options - Candidate and recovery authority.
 * @returns {Promise<ResidentRunnableWork | null>} - Exact runnable work.
 */
async function resolveRunnableLocator(options) {
  if (options.signal?.aborted) return null;
  if (
    !['ACTIVITY', 'RECOVERY', 'TIMER'].includes(options.row.kind) ||
    options.row.appId !== options.appId ||
    options.row.revisionId !== options.revisionId
  ) {
    return null;
  }
  let view = await options.ledger.rebuildRun(options.row.runId);
  if (options.signal?.aborted) return null;
  if (
    !view ||
    view.run.runId !== options.row.runId ||
    view.run.appId !== options.appId ||
    view.run.revisionId !== options.revisionId
  ) {
    return null;
  }
  if (
    view.run.status !== RunStatus.RUNNING ||
    view.run.version !== options.row.runVersion ||
    view.run.lastSequence !== options.row.lastSequence
  ) {
    await repairStaleReadyWorkLocator(options);
    return null;
  }

  if (view.run.trigger?.kind === 'manual') {
    if (
      options.row.kind === 'TIMER' ||
      options.row.invocationId !== MANUAL_LEDGER_INVOCATION_ID ||
      Object.prototype.hasOwnProperty.call(options.row, 'cursorVersion')
    ) {
      await repairStaleReadyWorkLocator(options);
      return null;
    }
    let invocation = view.invocations.find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.invocationId === MANUAL_LEDGER_INVOCATION_ID,
    );
    if (
      !invocation ||
      invocation.revisionId !== options.revisionId ||
      invocation.generation !== options.row.generation
    ) {
      await repairStaleReadyWorkLocator(options);
      return null;
    }
    if (options.row.kind === 'ACTIVITY') {
      if (
        invocation.status === InvocationStatus.RUNNABLE &&
        invocation.updatedAt === options.row.availableAt
      ) {
        return { kind: 'manual', runId: view.run.runId };
      }
      await repairStaleReadyWorkLocator(options);
      return null;
    }
    if (invocation.status !== InvocationStatus.RUNNING) {
      await repairStaleReadyWorkLocator(options);
      return null;
    }
    const attempts = view.attempts.filter(
      (/** @type {Record<string, any>} */ attempt) =>
        attempt.invocationId === invocation.invocationId &&
        attempt.generation === invocation.generation,
    );
    if (
      attempts.length !== 1 ||
      attempts[0].attemptId !== options.row.attemptId ||
      attempts[0].updatedAt !== options.row.availableAt ||
      ![AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
        attempts[0].status,
      )
    ) {
      await repairStaleReadyWorkLocator(options);
      return null;
    }
    if (options.signal?.aborted) return null;
    const attempt = attempts[0];
    const recoveringManual = {
      runId: view.run.runId,
      appId: view.run.appId,
      revisionId: view.run.revisionId,
      invocationId: invocation.invocationId,
      activityId: invocation.activityId,
      generation: invocation.generation,
    };
    const actor = { kind: 'resident-recovery', id: options.appId };
    const unresolvedEffects = getUnresolvedAttemptEffects(
      view,
      invocation,
      attempt,
    );
    if (
      attempt.status === AttemptStatus.STARTED &&
      unresolvedEffects.length > 0
    ) {
      await options.recoverManagedEffects({
        ledger: options.ledger,
        appId: options.appId,
        runId: view.run.runId,
        invocationId: invocation.invocationId,
        attemptId: attempt.attemptId,
        attempt,
        effects: unresolvedEffects,
        actor,
        controlContext: options.controlContext,
        ...(options.applicationStateConfiguration === undefined
          ? {}
          : {
              applicationStateConfiguration:
                options.applicationStateConfiguration,
            }),
      });
    } else {
      await options.recoverActivity({
        ledger: options.ledger,
        runId: view.run.runId,
        invocationId: invocation.invocationId,
        actor,
      });
    }
    view = await options.ledger.rebuildRun(view.run.runId);
    if (options.signal?.aborted || !view) return null;
    invocation = view.invocations.find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.invocationId === recoveringManual.invocationId,
    );
    return view.run.runId === recoveringManual.runId &&
      view.run.appId === recoveringManual.appId &&
      view.run.revisionId === recoveringManual.revisionId &&
      view.run.trigger?.kind === 'manual' &&
      view.run.status === RunStatus.RUNNING &&
      invocation?.runId === recoveringManual.runId &&
      invocation.appId === recoveringManual.appId &&
      invocation.revisionId === recoveringManual.revisionId &&
      invocation.activityId === recoveringManual.activityId &&
      invocation.generation === recoveringManual.generation &&
      invocation.status === InvocationStatus.RUNNABLE
      ? { kind: 'manual', runId: view.run.runId }
      : null;
  }

  if (view.run.trigger?.kind !== 'workflow' || !view.workflowCursor) {
    await repairStaleReadyWorkLocator(options);
    return null;
  }
  let cursor = view.workflowCursor;
  if (options.row.kind === 'TIMER') {
    const timer = (view.timers || []).find(
      (/** @type {Record<string, any>} */ candidate) =>
        candidate.timerId === options.row.timerId,
    );
    if (
      cursor.disposition !== WorkflowCursorDisposition.TIMER_WAITING ||
      cursor.timerId !== options.row.timerId ||
      !isExactWorkflowReadyCursor(options.row, cursor) ||
      !timer ||
      timer.runId !== view.run.runId ||
      timer.appId !== view.run.appId ||
      timer.revisionId !== view.run.revisionId ||
      timer.workflowId !== cursor.workflowId ||
      timer.planId !== cursor.planId ||
      timer.continuationId !== cursor.continuationId ||
      timer.stepId !== cursor.stepId ||
      timer.stepIndex !== cursor.stepIndex ||
      timer.status !== 'WAITING' ||
      timer.dueAt !== options.row.availableAt ||
      !canFireManifestWorkflowTimer({
        identity: options.manifestIdentity,
        workflowId: cursor.workflowId,
        planId: cursor.planId,
        cursor: {
          stepId: cursor.stepId,
          stepIndex: cursor.stepIndex,
        },
      })
    ) {
      await repairStaleReadyWorkLocator(options);
      return null;
    }
    return createWorkflowTimerWork(view, timer);
  }
  let invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === options.row.invocationId,
  );
  if (
    !invocation ||
    !isExactWorkflowInvocation(view, invocation) ||
    !isExactWorkflowReadyCursor(options.row, cursor) ||
    invocation.generation !== options.row.generation
  ) {
    await repairStaleReadyWorkLocator(options);
    return null;
  }
  if (options.row.kind === 'ACTIVITY') {
    const manifestDispatchSupported = canDispatchManifestWorkflowActivity({
      identity: options.manifestIdentity,
      workflowId: cursor.workflowId,
      planId: cursor.planId,
      activityId: invocation.activityId,
      cursor: {
        version: cursor.version,
        continuationId: cursor.continuationId,
        stepId: cursor.stepId,
        stepIndex: cursor.stepIndex,
      },
    });
    if (!manifestDispatchSupported) return null;
    if (
      cursor.disposition === WorkflowCursorDisposition.ACTIVITY_RUNNABLE &&
      invocation.status === InvocationStatus.RUNNABLE &&
      invocation.updatedAt === options.row.availableAt
    ) {
      return createWorkflowWork(view, invocation);
    }
    await repairStaleReadyWorkLocator(options);
    return null;
  }

  if (
    cursor.disposition !== WorkflowCursorDisposition.ACTIVITY_RUNNING ||
    invocation.status !== InvocationStatus.RUNNING
  ) {
    await repairStaleReadyWorkLocator(options);
    return null;
  }
  const attempts = view.attempts.filter(
    (/** @type {Record<string, any>} */ attempt) =>
      attempt.invocationId === invocation.invocationId &&
      attempt.generation === invocation.generation,
  );
  if (
    attempts.length !== 1 ||
    attempts[0].attemptId !== options.row.attemptId ||
    attempts[0].updatedAt !== options.row.availableAt ||
    ![AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(attempts[0].status)
  ) {
    await repairStaleReadyWorkLocator(options);
    return null;
  }
  if (options.signal?.aborted) return null;
  const recovering = {
    runId: view.run.runId,
    workflowId: cursor.workflowId,
    planId: cursor.planId,
    invocationId: invocation.invocationId,
    activityId: invocation.activityId,
    generation: invocation.generation,
    cursorVersion: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
  await options.recoverWorkflowActivity({
    ledger: options.ledger,
    runId: view.run.runId,
    invocationId: invocation.invocationId,
    actor: { kind: 'resident-workflow-recovery', id: options.appId },
  });
  view = await options.ledger.rebuildRun(view.run.runId);
  if (options.signal?.aborted || !view || !view.workflowCursor) return null;
  cursor = view.workflowCursor;
  invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === cursor.invocationId,
  );
  if (
    view.run.runId !== recovering.runId ||
    view.run.appId !== options.appId ||
    view.run.revisionId !== options.revisionId ||
    view.run.trigger?.kind !== 'workflow' ||
    view.run.status !== RunStatus.RUNNING ||
    cursor.disposition !== WorkflowCursorDisposition.ACTIVITY_RUNNABLE ||
    !invocation ||
    !isExactWorkflowInvocation(view, invocation) ||
    cursor.workflowId !== recovering.workflowId ||
    cursor.planId !== recovering.planId ||
    cursor.version !== recovering.cursorVersion + 1 ||
    cursor.continuationId !== recovering.continuationId ||
    cursor.stepId !== recovering.stepId ||
    cursor.stepIndex !== recovering.stepIndex ||
    invocation.invocationId !== recovering.invocationId ||
    invocation.activityId !== recovering.activityId ||
    invocation.status !== InvocationStatus.RUNNABLE ||
    invocation.generation !== recovering.generation
  ) {
    return null;
  }
  const recoveredDispatchSupported = canDispatchManifestWorkflowActivity({
    identity: options.manifestIdentity,
    workflowId: cursor.workflowId,
    planId: cursor.planId,
    activityId: invocation.activityId,
    cursor: {
      version: cursor.version,
      continuationId: cursor.continuationId,
      stepId: cursor.stepId,
      stepIndex: cursor.stepIndex,
    },
  });
  return recoveredDispatchSupported
    ? createWorkflowWork(view, invocation)
    : null;
}

/**
 * Find the first exact runnable request. Ready work is only a bounded locator;
 * every candidate is rebuilt and all execution authority comes from the
 * ordinary cursor-guarded claim inside its dedicated runner.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, revisionId: string, manifestIdentity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, recoverActivity: typeof recoverManualLedgerActivity, recoverWorkflowActivity: typeof recoverWorkflowLedgerActivity, recoverManagedEffects: typeof recoverResidentManagedEffects, controlContext: {adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string}, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, signal?: AbortSignal}} options - Ready-work inputs.
 * @returns {Promise<ResidentRunnableWork | null>} - Next runnable activation.
 */
async function findRunnableWork(options) {
  /** @type {string | undefined} */
  let cursor;
  do {
    if (options.signal?.aborted) return null;
    const ready = await options.ledger.listReadyWork({
      appId: options.appId,
      revisionId: options.revisionId,
      limit: RESIDENT_ACTIVITY_READY_WORK_LIMIT,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (options.signal?.aborted) return null;
    for (const row of ready.items) {
      if (options.signal?.aborted) return null;
      // Deliberately serial: one held local owner performs at most one physical
      // attempt at a time in this first persistent-worker vertical.
      // eslint-disable-next-line no-await-in-loop
      const work = await resolveRunnableLocator({ ...options, row });
      if (work) return work;
    }
    cursor = ready.nextCursor;
  } while (cursor !== undefined);
  return null;
}

/**
 * Run the first persistent single-node activity worker under an already-held
 * resident owner. It hosts the authenticated submission/cancellation endpoint,
 * consumes exact ready work serially, and drains an active attempt during
 * graceful shutdown.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: import('../durable-activity-host.js').ManifestActivityExecution, controlContext: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string}, owner: Record<string, any>, signal?: AbortSignal, pollIntervalMs?: number, drainTimeoutMs?: number, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, runActivity?: typeof runPersistedDurableManifestActivity, runWorkflowActivity?: typeof runPersistedDurableManifestWorkflowActivity, fireTimer?: typeof fireWorkflowLedgerTimer, submitActivity?: typeof submitDurableManifestActivity, startWorkflow?: typeof startDurableManifestWorkflow, deliverSignal?: typeof deliverWorkflowLedgerSignal, recoverActivity?: typeof recoverManualLedgerActivity, recoverWorkflowActivity?: typeof recoverWorkflowLedgerActivity, requestWorkflowCancellation?: typeof requestWorkflowLedgerRunCancellation, recoverManagedEffects?: typeof recoverResidentManagedEffects, createCommandServer?: typeof createLocalOwnerCommandServer, runScheduleObserver?: typeof runResidentScheduleObserver, onReady?: () => void | Promise<void>, onStopping?: () => void | Promise<void>}} options - Held service dependencies.
 * @returns {Promise<Readonly<{processed: number}>>} - Graceful drain summary.
 */
export async function runResidentActivityWorker(options) {
  if (
    !options?.ledger ||
    typeof options.ledger.listReadyWork !== 'function' ||
    typeof options.ledger.rebuildRun !== 'function' ||
    typeof options.ledger.createWorkflowRun !== 'function'
  ) {
    throw new TypeError(
      'runResidentActivityWorker requires a workflow ledger with listReadyWork, rebuildRun, and createWorkflowRun.',
    );
  }
  if (!options.controlContext?.db) {
    throw new TypeError(
      'runResidentActivityWorker requires an open controlContext.',
    );
  }
  if (
    !options.owner?.commandSession ||
    options.owner.ownership?.ownerKind !== LedgerServiceOwnerKind.RESIDENT
  ) {
    throw new TypeError(
      'runResidentActivityWorker requires the held resident local owner.',
    );
  }
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  if (
    options.owner.ownership.appId !== binding.identity.appId ||
    options.owner.ownership.serviceId !== options.owner.serviceId
  ) {
    throw new Error(
      'Resident activity worker owner does not match its embedded application.',
    );
  }
  const externalSignal = resolveOptionalAbortSignal(options.signal);
  const workerCancellation = new AbortController();
  const signal = externalSignal
    ? AbortSignal.any([externalSignal, workerCancellation.signal])
    : workerCancellation.signal;
  if (options.onReady !== undefined && typeof options.onReady !== 'function') {
    throw new TypeError(
      'Resident activity worker onReady must be a function when provided.',
    );
  }
  if (
    options.onStopping !== undefined &&
    typeof options.onStopping !== 'function'
  ) {
    throw new TypeError(
      'Resident activity worker onStopping must be a function when provided.',
    );
  }
  const pollIntervalMs = resolvePollInterval(options.pollIntervalMs);
  const drainTimeoutMs = resolveDrainTimeout(options.drainTimeoutMs);
  const runActivity =
    options.runActivity || runPersistedDurableManifestActivity;
  const runWorkflowActivity =
    options.runWorkflowActivity || runPersistedDurableManifestWorkflowActivity;
  const fireTimer = options.fireTimer || fireWorkflowLedgerTimer;
  const submitActivity =
    options.submitActivity || submitDurableManifestActivity;
  const startWorkflow = options.startWorkflow || startDurableManifestWorkflow;
  const deliverSignal = options.deliverSignal || deliverWorkflowLedgerSignal;
  const recoverActivity =
    options.recoverActivity || recoverManualLedgerActivity;
  const recoverWorkflowActivity =
    options.recoverWorkflowActivity || recoverWorkflowLedgerActivity;
  const requestWorkflowCancellation =
    options.requestWorkflowCancellation || requestWorkflowLedgerRunCancellation;
  const recoverManagedEffects =
    options.recoverManagedEffects || recoverResidentManagedEffects;
  const createCommandServer =
    options.createCommandServer || createLocalOwnerCommandServer;
  const runScheduleObserver =
    options.runScheduleObserver || runResidentScheduleObserver;
  const ownershipStore = createLedgerServiceOwnership({
    db: options.controlContext.db,
    tableName: options.controlContext.tableName,
  });

  /** @type {import('../manual-ledger-run.js').ManualLedgerActiveAttemptCancellationPort | undefined} */
  let activeManualCancellationPort;
  /** @type {import('../workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
  let activeWorkflowCancellationPort;
  /** @type {string | undefined} */
  let activeRunId;
  /** @type {'manual'|'workflow'|'timer'|undefined} */
  let activeWorkKind;
  /** @type {Set<() => void>} */
  const wakeListeners = new Set();
  let wakePending = true;
  let processed = 0;
  const wake = () => {
    wakePending = true;
    for (const listener of [...wakeListeners]) listener();
  };
  const subscribeWake = (/** @type {() => void} */ listener) => {
    wakeListeners.add(listener);
    return () => wakeListeners.delete(listener);
  };
  let stoppingNotificationStarted = false;
  /** @type {Promise<void> | undefined} */
  let stoppingNotification;
  /** @type {unknown} */
  let stoppingNotificationError;
  const notifyStopping = () => {
    if (stoppingNotificationStarted) return;
    stoppingNotificationStarted = true;
    stoppingNotification = (async () => {
      await options.onStopping?.();
    })().catch((error) => {
      stoppingNotificationError = error;
    });
  };
  signal.addEventListener('abort', notifyStopping, { once: true });
  if (signal.aborted) notifyStopping();
  let acceptingCommands = false;
  /** @type {Set<Promise<unknown>>} */
  const inFlightCommands = new Set();
  /** @type {(ready: boolean) => void} */
  let resolveScheduleReady;
  const scheduleReady = new Promise((resolve) => {
    resolveScheduleReady = resolve;
  });
  let scheduleReadySettled = false;
  const settleScheduleReady = (/** @type {boolean} */ ready) => {
    if (scheduleReadySettled) return;
    scheduleReadySettled = true;
    resolveScheduleReady(ready);
  };
  /** @type {unknown} */
  let scheduleObserverError;
  const scheduleObserverDone = Promise.resolve()
    .then(
      async () =>
        await runScheduleObserver({
          ledger: options.ledger,
          execution: binding.execution,
          controlContext: options.controlContext,
          ownership: options.owner.ownership,
          signal,
          onWorkflowReady: wake,
          onReady: () => settleScheduleReady(true),
        }),
    )
    .then(
      (result) => {
        settleScheduleReady(false);
        if (!signal.aborted) {
          const error = new Error(
            'Resident schedule observer stopped without a shutdown request.',
          );
          scheduleObserverError = error;
          workerCancellation.abort(error);
          wake();
        }
        return result;
      },
      (error) => {
        settleScheduleReady(false);
        scheduleObserverError = error;
        if (!workerCancellation.signal.aborted) {
          workerCancellation.abort(error);
        }
        wake();
        return undefined;
      },
    );

  /**
   * @param {Record<string, any>} command - Authenticated owner command.
   * @returns {Promise<Record<string, any>>} - Redacted command response.
   */
  const handleOwnerCommand = async (command) => {
    if (command.command === RESIDENT_ACTIVITY_SUBMIT_COMMAND) {
      const request = normalizeSubmitRequest(command.request);
      if (
        request.appId !== binding.identity.appId ||
        request.revisionId !== binding.identity.revisionId
      ) {
        throw new Error(
          'Resident activity submission does not match the owned application revision.',
        );
      }
      const {
        appId: _appId,
        revisionId: _revisionId,
        ...activityRequest
      } = request;
      const result = await submitActivity({
        ledger: options.ledger,
        execution: binding.execution,
        ...activityRequest,
      });
      wake();
      return result;
    }
    if (command.command === RESIDENT_WORKFLOW_START_COMMAND) {
      const request = normalizeWorkflowStartRequest(command.request);
      if (
        request.appId !== binding.identity.appId ||
        request.revisionId !== binding.identity.revisionId
      ) {
        throw new Error(
          'Resident workflow start does not match the owned application revision.',
        );
      }
      const {
        appId: _appId,
        revisionId: _revisionId,
        ...workflowRequest
      } = request;
      const result = await startWorkflow({
        ledger: options.ledger,
        execution: binding.execution,
        ...workflowRequest,
      });
      wake();
      return result;
    }
    if (command.command === RESIDENT_WORKFLOW_SIGNAL_COMMAND) {
      const request = normalizeWorkflowSignalRequest(command.request);
      if (request.appId !== binding.identity.appId) {
        throw new Error(
          'Resident workflow signal does not match the owned application.',
        );
      }
      if (command.requestId !== request.deliveryId) {
        throw new Error(
          'Resident workflow signal request identity does not match its delivery ID.',
        );
      }
      const result = await deliverSignal({
        ledger: options.ledger,
        ...request,
      });
      if (result.outcome === 'accepted') wake();
      return result;
    }
    if (command.command === EXECUTION_LEDGER_CANCEL_OWNER_COMMAND) {
      const request = command.request;
      if (
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        Object.keys(request).length !== 1 ||
        typeof request.runId !== 'string'
      ) {
        return {
          outcome: 'request-unavailable',
          delivery: 'not-delivered',
        };
      }
      const requestId = assertLedgerOpaqueId(
        command.requestId,
        'resident cancellation requestId',
      );
      if (request.runId === activeRunId && activeWorkKind === 'manual') {
        if (!activeManualCancellationPort) {
          return { outcome: 'owner-not-ready', delivery: 'not-delivered' };
        }
        const result = await activeManualCancellationPort.requestCancellation({
          requestId,
        });
        return {
          outcome: result.outcome,
          delivery:
            result.outcome === 'cancellation-requested'
              ? result.signalDelivered
                ? 'started'
                : 'not-delivered'
              : 'not-required',
          runStatus: result.run.status,
          invocationStatus: result.invocation.status,
        };
      }

      const view = await options.ledger.rebuildRun(request.runId);
      if (
        !view ||
        view.run?.appId !== binding.identity.appId ||
        view.run?.trigger?.kind !== 'workflow'
      ) {
        return {
          outcome: 'request-unavailable',
          delivery: 'not-delivered',
        };
      }
      const result = await requestWorkflowCancellation({
        ledger: options.ledger,
        runId: request.runId,
        requestId,
        actor: {
          kind: 'local-owner-command',
          id: binding.identity.appId,
        },
        ...(request.runId === activeRunId &&
        activeWorkKind === 'workflow' &&
        activeWorkflowCancellationPort
          ? { activeCancellationPort: activeWorkflowCancellationPort }
          : {}),
      });
      wake();
      const activation = result.timer
        ? { kind: 'timer', status: result.timer.status }
        : result.signalWait
          ? { kind: 'signal', status: result.signalWait.status }
          : undefined;
      return {
        outcome: result.outcome,
        delivery:
          result.outcome === 'cancellation-requested'
            ? result.signalDelivered
              ? 'started'
              : result.cancellationDeliveryRequired
                ? 'not-delivered'
                : 'not-required'
            : result.outcome === 'owner-not-ready'
              ? 'not-delivered'
              : 'not-required',
        runStatus: result.run.status,
        ...(result.invocation
          ? { invocationStatus: result.invocation.status }
          : {}),
        ...(activation
          ? {
              activationKind: activation.kind,
              activationStatus: activation.status,
            }
          : {}),
      };
    }
    return { outcome: 'request-unavailable', delivery: 'not-delivered' };
  };

  const stopAcceptingCommands = () => {
    acceptingCommands = false;
    wake();
  };
  /**
   * @template T
   * @param {Promise<T>} pending - Admitted owner callback.
   * @returns {Promise<T>} - The same tracked callback.
   */
  const trackOwnerCallback = (pending) => {
    inFlightCommands.add(pending);
    pending.then(
      () => inFlightCommands.delete(pending),
      () => inFlightCommands.delete(pending),
    );
    return pending;
  };
  signal?.addEventListener('abort', stopAcceptingCommands, { once: true });
  if (signal?.aborted) stopAcceptingCommands();

  /** @type {{close: () => Promise<void>} | undefined} */
  let commandServer;
  /** @type {unknown} */
  let workerError;
  try {
    if (!signal?.aborted) {
      commandServer = await createCommandServer({
        session: options.owner.commandSession,
        timeoutMs: LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
        maxRequestBytes: LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
        isCurrentOwner: () => {
          if (!acceptingCommands) return Promise.resolve(false);
          return trackOwnerCallback(
            ownershipStore
              .getOwnership({
                serviceId: options.owner.ownership.serviceId,
              })
              .then((observed) =>
                isCurrentOwner(observed, options.owner.ownership),
              ),
          );
        },
        handleCommand: (command) => {
          if (!acceptingCommands) {
            return Promise.resolve({
              outcome: 'request-unavailable',
              delivery: 'not-delivered',
            });
          }
          return trackOwnerCallback(handleOwnerCommand(command));
        },
      });
      const schedulesReady = await waitForScheduleReadiness(
        scheduleReady,
        signal,
      );
      if (!signal.aborted && schedulesReady) {
        await options.onReady?.();
        if (!signal.aborted) acceptingCommands = true;
      }
    }
    while (!signal.aborted) {
      wakePending = false;
      const work = await findRunnableWork({
        ledger: options.ledger,
        appId: binding.identity.appId,
        revisionId: binding.identity.revisionId,
        manifestIdentity: binding.identity,
        recoverActivity,
        recoverWorkflowActivity,
        recoverManagedEffects,
        controlContext: options.controlContext,
        ...(options.applicationStateConfiguration === undefined
          ? {}
          : {
              applicationStateConfiguration:
                options.applicationStateConfiguration,
            }),
        ...(signal === undefined ? {} : { signal }),
      });
      if (signal?.aborted) break;
      if (work) {
        const { runId } = work;
        activeRunId = runId;
        activeWorkKind = work.kind;
        if (work.kind === 'timer') {
          try {
            try {
              const result = await fireTimer({
                ledger: options.ledger,
                runId,
                timerId: work.timerId,
                actor: {
                  kind: 'resident-workflow-timer',
                  id: binding.identity.appId,
                },
              });
              if (result.outcome === 'fired') processed += 1;
            } catch (error) {
              // A signal audit decision, cancellation, or another terminal may
              // win after locator verification. Reload on the next loop; only
              // this ordinary authority conflict is a benign scheduling race.
              if (!(error instanceof ExecutionLedgerConflictError)) throw error;
            }
          } finally {
            activeRunId = undefined;
            activeWorkKind = undefined;
          }
          continue;
        }
        const attemptCancellation = new AbortController();
        /** @type {ReturnType<typeof setTimeout> | undefined} */
        let drainTimer;
        const requestBoundedDrain = () => {
          if (drainTimer || attemptCancellation.signal.aborted) return;
          drainTimer = setTimeout(() => {
            attemptCancellation.abort(
              Object.assign(
                new Error(
                  `Resident shutdown drain expired for durable run ${runId}.`,
                ),
                {
                  name: 'ResidentWorkerDrainExpired',
                  code: 'resident-worker-drain-expired',
                  details: { runId, drainTimeoutMs },
                },
              ),
            );
          }, drainTimeoutMs);
        };
        signal?.addEventListener('abort', requestBoundedDrain, { once: true });
        if (signal?.aborted) requestBoundedDrain();
        try {
          if (work.kind === 'manual') {
            await runActivity({
              ledger: options.ledger,
              controlContext: options.controlContext,
              execution: binding.execution,
              runId,
              ...(signal === undefined ? {} : { admissionSignal: signal }),
              signal: attemptCancellation.signal,
              ...(options.applicationStateConfiguration === undefined
                ? {}
                : {
                    applicationStateConfiguration:
                      options.applicationStateConfiguration,
                  }),
              ownerCancellation: {
                actor: {
                  kind: 'local-owner-command',
                  id: binding.identity.appId,
                },
              },
              registerActiveAttemptCancellationPort: (port) => {
                activeManualCancellationPort = port;
                return () => {
                  if (activeManualCancellationPort === port) {
                    activeManualCancellationPort = undefined;
                  }
                };
              },
            });
            processed += 1;
          } else {
            await runWorkflowActivity({
              ledger: options.ledger,
              execution: binding.execution,
              runId,
              workflowId: work.workflowId,
              planId: work.planId,
              invocationId: work.invocationId,
              activityId: work.activityId,
              generation: work.generation,
              cursor: work.cursor,
              actor: {
                kind: 'resident-workflow',
                id: binding.identity.appId,
              },
              ...(signal === undefined ? {} : { admissionSignal: signal }),
              signal: attemptCancellation.signal,
              ownerCancellation: {
                actor: {
                  kind: 'local-owner-command',
                  id: binding.identity.appId,
                },
              },
              registerActiveWorkflowCancellationPort: (port) => {
                activeWorkflowCancellationPort = port;
                return () => {
                  if (activeWorkflowCancellationPort === port) {
                    activeWorkflowCancellationPort = undefined;
                  }
                };
              },
            });
            processed += 1;
          }
        } finally {
          signal?.removeEventListener('abort', requestBoundedDrain);
          if (drainTimer) clearTimeout(drainTimer);
          activeManualCancellationPort = undefined;
          activeWorkflowCancellationPort = undefined;
          activeRunId = undefined;
          activeWorkKind = undefined;
        }
        continue;
      }
      if (wakePending) continue;
      await waitForNextReadyWorkPoll({
        signal,
        pollIntervalMs,
        subscribeWake,
      });
    }
  } catch (error) {
    workerError = error;
    if (!workerCancellation.signal.aborted) {
      workerCancellation.abort(error);
    }
    wake();
  }

  /** @type {unknown} */
  let closeError;
  try {
    stopAcceptingCommands();
    if (!workerCancellation.signal.aborted) workerCancellation.abort();
    await stoppingNotification;
    const scheduleObserverSettled = await waitForScheduleObserverDrain(
      scheduleObserverDone,
      drainTimeoutMs,
    );
    if (!scheduleObserverSettled && scheduleObserverError === undefined) {
      scheduleObserverError =
        createScheduleObserverDrainExpiredError(drainTimeoutMs);
    }
    await Promise.allSettled([...inFlightCommands]);
    await commandServer?.close();
  } catch (error) {
    closeError = error;
  }
  signal.removeEventListener('abort', notifyStopping);
  signal?.removeEventListener('abort', stopAcceptingCommands);
  const errors = [
    ...new Set(
      [
        workerError,
        scheduleObserverError,
        stoppingNotificationError,
        closeError,
      ].filter((error) => error !== undefined),
    ),
  ];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Resident activity worker, schedule observer, stopping callback, or cleanup failed.',
    );
  }
  if (errors.length === 1) throw errors[0];
  return Object.freeze({ processed });
}

/**
 * Open one local control volume, acquire its resident lifecycle/ownership
 * generation, run the serial worker, and persist a graceful stop before the
 * control handle closes. An abort signal stops new claims and lets the active
 * attempt drain. After the bounded grace period, manual work uses its durable
 * cancellation path while workflow work is physically interrupted and then
 * settles conservatively without inventing cancellation authority.
 * @param {{execution: import('../durable-activity-host.js').ManifestActivityExecution, artifactId?: string, signal?: AbortSignal, pollIntervalMs?: number, drainTimeoutMs?: number, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>}} options - Local resident service request.
 * @returns {Promise<Readonly<{processed: number}>>} - Worker drain summary.
 */
export async function runLocalResidentActivityService(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('runLocalResidentActivityService requires options.');
  }
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  if (options.artifactId !== undefined) {
    assertArtifactId(
      options.artifactId,
      'resident activity service artifactId',
    );
  }
  const artifactId = options.artifactId;
  const signal = resolveOptionalAbortSignal(options.signal);
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (configuration.adapterName !== 'lmdb') {
    throw new Error(
      'The local resident activity service requires the LMDB control adapter.',
    );
  }
  const applicationStateConfiguration =
    options.applicationStateConfiguration === undefined
      ? resolveApplicationStateStoreConfiguration()
      : validateApplicationStateStoreConfiguration(
          options.applicationStateConfiguration,
        );
  if (applicationStateConfiguration.adapterName !== 'lmdb') {
    throw new Error(
      'The local resident activity service requires the LMDB application-state adapter.',
    );
  }
  assertApplicationStateStoreIsolation(
    applicationStateConfiguration,
    configuration,
  );

  return await withExecutionLedger(
    async (ledger, controlContext) => {
      const lifecycle = createLedgerServiceLifecycle({
        db: controlContext.db,
        tableName: controlContext.tableName,
      });
      const ownership = createLedgerServiceOwnership({
        db: controlContext.db,
        tableName: controlContext.tableName,
      });
      const service = createLedgerService({
        appId: binding.identity.appId,
        revisionId: binding.identity.revisionId,
        ...(artifactId === undefined ? {} : { artifactId }),
        lifecycle,
        ownership,
        sessionRoot: controlContext.sessionPath,
      });
      let started = false;
      /** @type {Readonly<{processed: number}> | undefined} */
      let result;
      /** @type {unknown} */
      let workerError;
      try {
        await service.start({ deferReady: true });
        started = true;
        const owner = service.getLocalOwner();
        if (!owner) {
          throw new Error(
            'Resident activity service became ready without its local owner.',
          );
        }
        result = await runResidentActivityWorker({
          ledger,
          execution: binding.execution,
          controlContext,
          owner,
          ...(signal === undefined ? {} : { signal }),
          ...(options.pollIntervalMs === undefined
            ? {}
            : { pollIntervalMs: options.pollIntervalMs }),
          ...(options.drainTimeoutMs === undefined
            ? {}
            : { drainTimeoutMs: options.drainTimeoutMs }),
          applicationStateConfiguration,
          onReady: async () => {
            if (!signal?.aborted) await service.markReady();
          },
          onStopping: async () => {
            await service.beginStopping();
          },
        });
        if (!signal?.aborted) {
          throw new Error(
            'Resident activity worker stopped without a shutdown request.',
          );
        }
      } catch (error) {
        workerError = error;
      }

      /** @type {unknown} */
      let stopError;
      if (started) {
        try {
          await service.stop();
        } catch (error) {
          stopError = error;
        }
      }
      const errors = [
        ...new Set(
          [workerError, stopError].filter((error) => error !== undefined),
        ),
      ];
      if (errors.length > 1) {
        throw new AggregateError(
          errors,
          'Resident activity worker and graceful service shutdown both failed.',
        );
      }
      if (errors.length === 1) throw errors[0];
      return /** @type {Readonly<{processed: number}>} */ (result);
    },
    { configuration },
  );
}

/**
 * Route one app-scoped durable mutation to the current resident, or acquire a
 * short-lived local owner and apply it directly. A failed socket response is
 * never treated as non-application; the stable request is retried only after
 * the ownership fence permits it.
 * @param {{appId: string, requestId: string, command: string, request: Record<string, any>, configuration: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, mutateDirect: (ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore) => Promise<Readonly<Record<string, any>>>, failureMessage: string}} options - Exact local mutation request.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable mutation response.
 */
export async function routeLocalResidentMutation(options) {
  const serviceId = createLedgerServiceId({ appId: options.appId });
  return await withExecutionLedger(
    async (ledger, controlContext) => {
      const ownershipStore = createLedgerServiceOwnership({
        db: controlContext.db,
        tableName: controlContext.tableName,
      });

      /** @returns {Promise<Readonly<Record<string, any>>>} - Direct durable mutation. */
      const mutateDirect = async () =>
        await withLocalLedgerServiceMutationOwnership({
          appId: options.appId,
          context: controlContext,
          handler: async () => await options.mutateDirect(ledger),
        });

      /**
       * @param {Readonly<Record<string, any>>} owner - Resident owner snapshot.
       * @returns {Promise<Readonly<Record<string, any>>>} - Authenticated resident response.
       */
      const mutateThroughResident = async (owner) =>
        /** @type {Promise<Readonly<Record<string, any>>>} */ (
          sendLocalOwnerCommand({
            serviceId,
            sessionId: owner.sessionId,
            sessionRoot: controlContext.sessionPath,
            requestId: options.requestId,
            command: options.command,
            request: options.request,
            timeoutMs: LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
            maxRequestBytes: LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
          })
        );

      let observed = await ownershipStore.getOwnership({ serviceId });
      /** @type {unknown} */
      let routeError;
      if (observed?.ownerKind === LedgerServiceOwnerKind.RESIDENT) {
        try {
          return await mutateThroughResident(observed);
        } catch (error) {
          routeError = error;
        }
      }

      try {
        return await mutateDirect();
      } catch (directError) {
        // Cover the opposite race: a resident may acquire ownership after the
        // first read but before the short-lived manual claim.
        observed = await ownershipStore.getOwnership({ serviceId });
        if (observed?.ownerKind === LedgerServiceOwnerKind.RESIDENT) {
          try {
            return await mutateThroughResident(observed);
          } catch (retryRouteError) {
            throw new AggregateError(
              [
                ...(routeError === undefined ? [] : [routeError]),
                directError,
                retryRouteError,
              ],
              options.failureMessage,
            );
          }
        }
        if (routeError !== undefined) {
          throw new AggregateError(
            [routeError, directError],
            options.failureMessage,
          );
        }
        throw directError;
      }
    },
    { configuration: options.configuration },
  );
}

/**
 * Persist a durable activity locally. When a resident generation owns the
 * app, route the request through its authenticated command socket; otherwise
 * acquire a short-lived manual owner and append directly. A route failure is
 * followed by one fenced direct attempt, which can take over only after the
 * resident endpoint is proven absent. Stable run identity makes response-loss
 * retries idempotent.
 * @param {import('../durable-activity-host.js').DurableManifestActivityRequest & {configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Local durable submission.
 * @returns {Promise<Readonly<Record<string, any>>>} - Compact durable acceptance receipt.
 */
export async function submitLocalDurableManifestActivity(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('submitLocalDurableManifestActivity requires options.');
  }
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (configuration.adapterName !== 'lmdb') {
    throw new Error(
      'Local resident submission requires the LMDB control adapter.',
    );
  }
  const commandRequest = normalizeSubmitRequest(
    cloneJsonObject(
      {
        appId: binding.identity.appId,
        revisionId: binding.identity.revisionId,
        activityName: options.activityName,
        idempotencyKey: options.idempotencyKey,
        ...(Object.prototype.hasOwnProperty.call(options, 'input')
          ? { input: options.input }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
          ? { callerMetadata: options.callerMetadata }
          : {}),
        ...(options.actor === undefined ? {} : { actor: options.actor }),
      },
      'Local durable activity submission',
    ),
  );
  const runId = createManualLedgerRunId({
    appId: binding.identity.appId,
    idempotencyKey: commandRequest.idempotencyKey,
  });
  return await routeLocalResidentMutation({
    appId: binding.identity.appId,
    requestId: runId,
    command: RESIDENT_ACTIVITY_SUBMIT_COMMAND,
    request: commandRequest,
    configuration,
    mutateDirect: async (ledger) =>
      await submitDurableManifestActivity({
        ledger,
        execution: binding.execution,
        ...commandRequest,
      }),
    failureMessage:
      'Could not route or directly persist the resident activity submission.',
  });
}

/**
 * Persist one exact manifest workflow locally using the same authenticated
 * resident-or-short-lived-owner fence as manual activity submission.
 * @param {{execution: import('../durable-activity-host.js').ManifestActivityExecution, workflowId: string, idempotencyKey: string, input?: any, callerMetadata?: Record<string, any>, actor?: {kind: string, id: string}, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Local durable workflow start.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable workflow start result.
 */
export async function startLocalDurableManifestWorkflow(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('startLocalDurableManifestWorkflow requires options.');
  }
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (configuration.adapterName !== 'lmdb') {
    throw new Error('Local workflow start requires the LMDB control adapter.');
  }
  const commandRequest = normalizeWorkflowStartRequest(
    cloneJsonObject(
      {
        appId: binding.identity.appId,
        revisionId: binding.identity.revisionId,
        workflowId: options.workflowId,
        idempotencyKey: options.idempotencyKey,
        ...(Object.prototype.hasOwnProperty.call(options, 'input')
          ? { input: options.input }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
          ? { callerMetadata: options.callerMetadata }
          : {}),
        ...(options.actor === undefined ? {} : { actor: options.actor }),
      },
      'Local durable workflow start',
    ),
  );
  const runId = createWorkflowRunId({
    appId: binding.identity.appId,
    idempotencyKey: commandRequest.idempotencyKey,
  });
  return await routeLocalResidentMutation({
    appId: binding.identity.appId,
    requestId: runId,
    command: RESIDENT_WORKFLOW_START_COMMAND,
    request: commandRequest,
    configuration,
    mutateDirect: async (ledger) =>
      await startDurableManifestWorkflow({
        ledger,
        execution: binding.execution,
        workflowId: commandRequest.workflowId,
        idempotencyKey: commandRequest.idempotencyKey,
        ...(Object.prototype.hasOwnProperty.call(commandRequest, 'input')
          ? { input: commandRequest.input }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(
          commandRequest,
          'callerMetadata',
        )
          ? { callerMetadata: commandRequest.callerMetadata }
          : {}),
        ...(commandRequest.actor === undefined
          ? {}
          : { actor: commandRequest.actor }),
      }),
    failureMessage:
      'Could not route or directly persist the resident workflow start.',
  });
}

/**
 * Deliver one stable workflow signal through the app's authenticated resident
 * owner, or under a short-lived app owner when no resident is active. The
 * socket is only a route; the ledger decision remains the durable authority.
 * @param {{appId: string, runId: string, signalId: string, deliveryId: string, payload: any, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Exact signal delivery.
 * @returns {Promise<Readonly<Record<string, any>>>} - Durable accept/reject decision.
 */
export async function signalLocalDurableWorkflow(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('signalLocalDurableWorkflow requires options.');
  }
  const allowed = new Set([
    'appId',
    'runId',
    'signalId',
    'deliveryId',
    'payload',
    'configuration',
  ]);
  for (const key of Reflect.ownKeys(options)) {
    if (typeof key !== 'string' || !allowed.has(key)) {
      throw new TypeError(
        `signalLocalDurableWorkflow.${String(key)} is not supported.`,
      );
    }
  }
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (configuration.adapterName !== 'lmdb') {
    throw new Error('Local workflow signal requires the LMDB control adapter.');
  }
  const commandRequest = normalizeWorkflowSignalRequest(
    cloneJsonObject(
      {
        appId: options.appId,
        runId: options.runId,
        signalId: options.signalId,
        deliveryId: options.deliveryId,
        ...(Object.prototype.hasOwnProperty.call(options, 'payload')
          ? { payload: options.payload }
          : {}),
      },
      'Local workflow signal',
    ),
  );
  return await routeLocalResidentMutation({
    appId: commandRequest.appId,
    requestId: commandRequest.deliveryId,
    command: RESIDENT_WORKFLOW_SIGNAL_COMMAND,
    request: commandRequest,
    configuration,
    mutateDirect: async (ledger) =>
      await deliverWorkflowLedgerSignal({
        ledger,
        ...commandRequest,
      }),
    failureMessage:
      'Could not route or directly persist the workflow signal delivery.',
  });
}

export default runResidentActivityWorker;
