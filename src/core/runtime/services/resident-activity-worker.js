import {
  AttemptStatus,
  EffectStatus,
  ExecutionLedgerConflictError,
  InvocationStatus,
  RunStatus,
} from '../../lib/db/tables/execution-ledger.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { resolveManifestActivityExecutionBinding } from '../app-runs.js';
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
import { createBuiltinManagedEffectRecoveryCatalog } from '../effects/builtin-catalog.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
  recoverManualLedgerActivity,
} from '../manual-ledger-run.js';
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
import { createLedgerService } from './ledger-service.js';

export const RESIDENT_ACTIVITY_SUBMIT_COMMAND = 'execution-ledger-submit';
export const RESIDENT_ACTIVITY_DEFAULT_POLL_INTERVAL_MS = 1_000;
export const RESIDENT_ACTIVITY_DEFAULT_DRAIN_TIMEOUT_MS = 30_000;
export const RESIDENT_ACTIVITY_READY_WORK_LIMIT = 50;

/** @typedef {{requestCancellation: (request: {requestId: string}) => Promise<Record<string, any>>}} ActiveCancellationPort */

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
 * @returns {number} - Bounded milliseconds before cooperative cancellation.
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
 * Wait until a submit wakes the worker, its poll interval elapses, or shutdown
 * begins. An active attempt receives its own cooperative cancellation only if
 * the bounded natural-drain allowance expires.
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
 * Rebuild a ready-work locator and return only an exact runnable manual
 * request. A retained CLAIMED or STARTED attempt is first recovered under the
 * successor resident owner; STARTED becomes blocked uncertainty and is never
 * returned for dispatch.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, revisionId: string, row: Record<string, any>, recoverActivity: typeof recoverManualLedgerActivity, recoverManagedEffects: typeof recoverResidentManagedEffects, controlContext: {adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string}, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, signal?: AbortSignal}} options - Candidate and recovery authority.
 * @returns {Promise<string | null>} - Runnable run ID, if still authoritative.
 */
async function resolveRunnableLocator(options) {
  if (options.signal?.aborted) return null;
  if (
    !['ACTIVITY', 'RECOVERY'].includes(options.row.kind) ||
    options.row.appId !== options.appId ||
    options.row.revisionId !== options.revisionId ||
    options.row.invocationId !== MANUAL_LEDGER_INVOCATION_ID
  ) {
    return null;
  }
  let view = await options.ledger.rebuildRun(options.row.runId);
  if (options.signal?.aborted) return null;
  if (
    !view ||
    view.run.runId !== options.row.runId ||
    view.run.appId !== options.appId ||
    view.run.revisionId !== options.revisionId ||
    view.run.trigger?.kind !== 'manual'
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
      return view.run.runId;
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
    ![AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(attempts[0].status)
  ) {
    await repairStaleReadyWorkLocator(options);
    return null;
  }
  if (options.signal?.aborted) return null;
  const attempt = attempts[0];
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
  if (options.signal?.aborted) return null;
  if (!view) return null;
  invocation = view.invocations.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === options.row.invocationId,
  );

  return view.run.runId === options.row.runId &&
    view.run.appId === options.appId &&
    view.run.revisionId === options.revisionId &&
    view.run.trigger?.kind === 'manual' &&
    view.run.status === RunStatus.RUNNING &&
    invocation?.revisionId === options.revisionId &&
    invocation.status === InvocationStatus.RUNNABLE
    ? view.run.runId
    : null;
}

/**
 * Find the first exact runnable request. Ready work is only a bounded locator;
 * every candidate is rebuilt and all execution authority comes from the
 * ordinary ledger claim inside the persisted activity runner.
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, revisionId: string, recoverActivity: typeof recoverManualLedgerActivity, recoverManagedEffects: typeof recoverResidentManagedEffects, controlContext: {adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string}, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, signal?: AbortSignal}} options - Ready-work inputs.
 * @returns {Promise<string | null>} - Next runnable run ID.
 */
async function findRunnableRun(options) {
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
      const runId = await resolveRunnableLocator({ ...options, row });
      if (runId) return runId;
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
 * @param {{ledger: import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: import('../durable-activity-host.js').ManifestActivityExecution, controlContext: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string}, owner: Record<string, any>, signal?: AbortSignal, pollIntervalMs?: number, drainTimeoutMs?: number, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, runActivity?: typeof runPersistedDurableManifestActivity, submitActivity?: typeof submitDurableManifestActivity, recoverActivity?: typeof recoverManualLedgerActivity, recoverManagedEffects?: typeof recoverResidentManagedEffects, createCommandServer?: typeof createLocalOwnerCommandServer, onReady?: () => void | Promise<void>}} options - Held service dependencies.
 * @returns {Promise<Readonly<{processed: number}>>} - Graceful drain summary.
 */
export async function runResidentActivityWorker(options) {
  if (
    !options?.ledger ||
    typeof options.ledger.listReadyWork !== 'function' ||
    typeof options.ledger.rebuildRun !== 'function'
  ) {
    throw new TypeError(
      'runResidentActivityWorker requires a ledger with listReadyWork and rebuildRun.',
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
  const signal = resolveOptionalAbortSignal(options.signal);
  if (options.onReady !== undefined && typeof options.onReady !== 'function') {
    throw new TypeError(
      'Resident activity worker onReady must be a function when provided.',
    );
  }
  const pollIntervalMs = resolvePollInterval(options.pollIntervalMs);
  const drainTimeoutMs = resolveDrainTimeout(options.drainTimeoutMs);
  const runActivity =
    options.runActivity || runPersistedDurableManifestActivity;
  const submitActivity =
    options.submitActivity || submitDurableManifestActivity;
  const recoverActivity =
    options.recoverActivity || recoverManualLedgerActivity;
  const recoverManagedEffects =
    options.recoverManagedEffects || recoverResidentManagedEffects;
  const createCommandServer =
    options.createCommandServer || createLocalOwnerCommandServer;
  const ownershipStore = createLedgerServiceOwnership({
    db: options.controlContext.db,
    tableName: options.controlContext.tableName,
  });

  /** @type {ActiveCancellationPort | undefined} */
  let activeCancellationPort;
  /** @type {string | undefined} */
  let activeRunId;
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
  let acceptingCommands = true;
  /** @type {Set<Promise<unknown>>} */
  const inFlightCommands = new Set();

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
    if (command.command === EXECUTION_LEDGER_CANCEL_OWNER_COMMAND) {
      const request = command.request;
      if (
        !request ||
        typeof request !== 'object' ||
        Array.isArray(request) ||
        Object.keys(request).length !== 1 ||
        typeof request.runId !== 'string' ||
        request.runId !== activeRunId
      ) {
        return {
          outcome: 'request-unavailable',
          delivery: 'not-delivered',
        };
      }
      if (!activeCancellationPort) {
        return { outcome: 'owner-not-ready', delivery: 'not-delivered' };
      }
      const result = await activeCancellationPort.requestCancellation({
        requestId: assertLedgerOpaqueId(
          command.requestId,
          'resident cancellation requestId',
        ),
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
      if (!signal?.aborted) await options.onReady?.();
    }
    while (!signal?.aborted) {
      wakePending = false;
      const runId = await findRunnableRun({
        ledger: options.ledger,
        appId: binding.identity.appId,
        revisionId: binding.identity.revisionId,
        recoverActivity,
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
      if (runId) {
        activeRunId = runId;
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
          await runActivity({
            ledger: options.ledger,
            controlContext: options.controlContext,
            execution: binding.execution,
            runId,
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
              activeCancellationPort = port;
              return () => {
                if (activeCancellationPort === port) {
                  activeCancellationPort = undefined;
                }
              };
            },
          });
          processed += 1;
        } finally {
          signal?.removeEventListener('abort', requestBoundedDrain);
          if (drainTimer) clearTimeout(drainTimer);
          activeCancellationPort = undefined;
          activeRunId = undefined;
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
  }

  /** @type {unknown} */
  let closeError;
  try {
    stopAcceptingCommands();
    await Promise.allSettled([...inFlightCommands]);
    await commandServer?.close();
  } catch (error) {
    closeError = error;
  }
  signal?.removeEventListener('abort', stopAcceptingCommands);
  if (workerError && closeError) {
    throw new AggregateError(
      [workerError, closeError],
      'Resident activity worker and command-server cleanup both failed.',
    );
  }
  if (workerError) throw workerError;
  if (closeError) throw closeError;
  return Object.freeze({ processed });
}

/**
 * Open one local control volume, acquire its resident lifecycle/ownership
 * generation, run the serial worker, and persist a graceful stop before the
 * control handle closes. An abort signal stops new claims and lets the active
 * attempt drain. After the bounded grace period, the worker converts it into
 * the existing durable cooperative-cancellation path.
 * @param {{execution: import('../durable-activity-host.js').ManifestActivityExecution, signal?: AbortSignal, pollIntervalMs?: number, drainTimeoutMs?: number, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>}} options - Local resident service request.
 * @returns {Promise<Readonly<{processed: number}>>} - Worker drain summary.
 */
export async function runLocalResidentActivityService(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('runLocalResidentActivityService requires options.');
  }
  const binding = resolveManifestActivityExecutionBinding(options.execution);
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
        lifecycle,
        ownership,
        sessionRoot: controlContext.sessionPath,
      });
      let started = false;
      /** @type {Readonly<{processed: number}> | undefined} */
      let result;
      /** @type {unknown} */
      let workerError;
      /** @type {Promise<void> | undefined} */
      let beginStoppingRequest;
      /** @type {unknown} */
      let beginStoppingError;
      const requestLifecycleStopping = () => {
        if (beginStoppingRequest) return;
        beginStoppingRequest = service.beginStopping().then(
          () => undefined,
          (error) => {
            beginStoppingError = error;
          },
        );
      };
      try {
        await service.start({ deferReady: true });
        started = true;
        signal?.addEventListener('abort', requestLifecycleStopping, {
          once: true,
        });
        if (signal?.aborted) requestLifecycleStopping();
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
        });
        if (!signal?.aborted) {
          throw new Error(
            'Resident activity worker stopped without a shutdown request.',
          );
        }
      } catch (error) {
        workerError = error;
      }
      signal?.removeEventListener('abort', requestLifecycleStopping);
      await beginStoppingRequest;
      if (beginStoppingError !== undefined) {
        workerError =
          workerError === undefined
            ? beginStoppingError
            : new AggregateError(
                [workerError, beginStoppingError],
                'Resident activity work and STOPPING transition both failed.',
              );
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
      if (workerError && stopError) {
        throw new AggregateError(
          [workerError, stopError],
          'Resident activity worker and graceful service shutdown both failed.',
        );
      }
      if (workerError) throw workerError;
      if (stopError) throw stopError;
      return /** @type {Readonly<{processed: number}>} */ (result);
    },
    { configuration },
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
  const runId = createManualLedgerRunId({
    appId: binding.identity.appId,
    idempotencyKey: options.idempotencyKey,
  });
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (configuration.adapterName !== 'lmdb') {
    throw new Error(
      'Local resident submission requires the LMDB control adapter.',
    );
  }
  const commandRequest = {
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
  };
  const serviceId = createLedgerServiceId({ appId: binding.identity.appId });

  return await withExecutionLedger(
    async (ledger, controlContext) => {
      const ownershipStore = createLedgerServiceOwnership({
        db: controlContext.db,
        tableName: controlContext.tableName,
      });

      /** @returns {Promise<Readonly<Record<string, any>>>} - Direct durable append. */
      const submitDirect = async () =>
        await withLocalLedgerServiceMutationOwnership({
          appId: binding.identity.appId,
          context: controlContext,
          handler: async () =>
            await submitDurableManifestActivity({
              ledger,
              execution: binding.execution,
              ...commandRequest,
            }),
        });

      /**
       * @param {Readonly<Record<string, any>>} owner - Resident owner snapshot.
       * @returns {Promise<Readonly<Record<string, any>>>} - Authenticated resident response.
       */
      const submitToResident = async (owner) =>
        /** @type {Promise<Readonly<Record<string, any>>>} */ (
          sendLocalOwnerCommand({
            serviceId,
            sessionId: owner.sessionId,
            sessionRoot: controlContext.sessionPath,
            requestId: runId,
            command: RESIDENT_ACTIVITY_SUBMIT_COMMAND,
            request: commandRequest,
            timeoutMs: LOCAL_OWNER_COMMAND_MAX_TIMEOUT_MS,
            maxRequestBytes: LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
          })
        );

      let observed = await ownershipStore.getOwnership({ serviceId });
      /** @type {unknown} */
      let routeError;
      if (observed?.ownerKind === LedgerServiceOwnerKind.RESIDENT) {
        try {
          return await submitToResident(observed);
        } catch (error) {
          routeError = error;
        }
      }

      try {
        return await submitDirect();
      } catch (directError) {
        // Cover the opposite race: a resident may have acquired ownership
        // after our first read but before the short-lived manual claim.
        observed = await ownershipStore.getOwnership({ serviceId });
        if (observed?.ownerKind === LedgerServiceOwnerKind.RESIDENT) {
          try {
            return await submitToResident(observed);
          } catch (retryRouteError) {
            throw new AggregateError(
              [
                ...(routeError === undefined ? [] : [routeError]),
                directError,
                retryRouteError,
              ],
              'Could not route or directly persist the resident activity submission.',
            );
          }
        }
        if (routeError !== undefined) {
          throw new AggregateError(
            [routeError, directError],
            'Could not route or directly persist the resident activity submission.',
          );
        }
        throw directError;
      }
    },
    { configuration },
  );
}

export default runResidentActivityWorker;
