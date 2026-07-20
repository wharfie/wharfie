import {
  assertApplicationStateStoreIsolation,
  openApplicationStateDB,
  resolveApplicationStateStoreConfiguration,
  validateApplicationStateStoreConfiguration,
} from './application-state-store.js';
import {
  createBuiltinManagedEffectCatalog,
  createBuiltinManagedEffectHandler,
} from './effects/builtin-catalog.js';
import {
  getManifestActivityNames,
  invokeManifestActivityAttemptWithStart,
  resolveManifestActivityExecutionBinding,
} from './app-runs.js';
import {
  MANUAL_LEDGER_INVOCATION_ID,
  createManualLedgerRunId,
  runManualLedgerActivity,
  submitManualLedgerActivity,
} from './manual-ledger-run.js';
import { createLedgerServiceOwnership } from '../lib/db/tables/ledger-service-lifecycle.js';
import { hasSameCanonicalJson } from '../lib/ledger/execution-ledger-contract.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { EXECUTION_LEDGER_CANCEL_OWNER_COMMAND } from './operator/execution-ledger-operator.js';
import {
  resolveExecutionLedgerStoreConfiguration,
  withExecutionLedger,
  withLocalLedgerServiceMutationOwnership,
} from './operator/execution-ledger-store.js';
import { createLocalOwnerCommandServer } from './operator/local-owner-command.js';

/**
 * @typedef {{kind: 'prepared-source', prepared: import('../../cli/app/compile-application-revision.js').PreparedApplicationRevision} | {kind: 'embedded', manifest: any, embeddedRevision: import('../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair}} ManifestActivityExecution
 */

/**
 * @typedef DurableManifestActivityRequest
 * @property {ManifestActivityExecution} execution - Exact prepared-source or embedded execution identity.
 * @property {string} activityName - Declared activity ID.
 * @property {string} idempotencyKey - Stable app-scoped manual request identity.
 * @property {any} [input] - JSON activity input.
 * @property {Record<string, any>} [callerMetadata] - JSON caller metadata.
 * @property {{kind: string, id: string}} [actor] - Durable transition actor.
 * @property {AbortSignal} [signal] - Foreground cancellation signal.
 */

/**
 * @typedef ResolvedDurableManifestActivityRequest
 * @property {ManifestActivityExecution} execution - Validated execution descriptor.
 * @property {Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>} identity - Identity derived from the execution descriptor.
 * @property {string} activityName - Declared activity ID.
 * @property {string} idempotencyKey - Stable app-scoped manual request identity.
 * @property {string} runId - Derived durable run identity.
 * @property {any} [input] - JSON activity input.
 * @property {Record<string, any>} [callerMetadata] - JSON caller metadata.
 * @property {{kind: string, id: string}} [actor] - Durable transition actor.
 * @property {AbortSignal} [signal] - Foreground cancellation signal.
 */

/**
 * @typedef ResolvedPersistedDurableManifestActivityRequest
 * @property {ManifestActivityExecution} execution - Validated execution descriptor.
 * @property {Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>} identity - Identity derived from the execution descriptor.
 * @property {string} activityName - Declared activity ID.
 * @property {string} runId - Persisted durable run identity.
 * @property {any} [input] - Stored JSON activity input.
 * @property {Record<string, any>} [callerMetadata] - Stored JSON caller metadata.
 * @property {{kind: string, id: string}} actor - Original durable creation actor.
 * @property {AbortSignal} [signal] - Foreground cancellation signal.
 */

/**
 * @param {Readonly<Record<string, any>> | null} observed - Fresh durable owner record.
 * @param {Readonly<Record<string, any>>} held - Owner record held by this runner.
 * @returns {boolean} - Whether the durable record still names this exact owner generation.
 */
function isCurrentManualOwner(observed, held) {
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
 * @param {unknown} value - Authenticated but still command-specific request payload.
 * @param {string} runId - Exact active durable run.
 * @returns {boolean} - Whether this command names only the runner's exact run.
 */
function isExactOwnerCancelRequest(value, runId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(request).length === 1 && request.runId === runId;
}

/**
 * @param {Record<string, any>} result - Active-port cancellation result.
 * @returns {{outcome: string, delivery: 'started'|'not-delivered'|'not-required', runStatus: string, invocationStatus: string}} - Redacted owner response.
 */
function formatOwnerCancellationResponse(result) {
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

/**
 * @param {unknown} value - Candidate host cancellation signal.
 * @returns {AbortSignal | undefined} - Snapshotted optional signal.
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
      'Durable manifest activity signal must be an AbortSignal when provided.',
    );
  }
  return /** @type {AbortSignal} */ (value);
}

/**
 * @param {unknown} value - Candidate durable transition actor.
 * @returns {Readonly<{kind: string, id: string}> | undefined} - Exact actor snapshot.
 */
function resolveOptionalActor(value) {
  if (value === undefined) return undefined;
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'kind') ||
    !Object.prototype.hasOwnProperty.call(value, 'id')
  ) {
    throw new TypeError(
      'Durable manifest activity actor requires exactly kind and id.',
    );
  }
  const actor = /** @type {{kind: unknown, id: unknown}} */ (value);
  return Object.freeze({
    kind: assertLedgerOpaqueId(actor.kind, 'durable activity actor kind'),
    id: assertLedgerOpaqueId(actor.id, 'durable activity actor id'),
  });
}

/**
 * Bind a manual request to the app and revision selected by its immutable
 * execution descriptor. Source bytes are checked before any durable state is
 * opened; the physical source executor repeats that check around dispatch.
 * @param {DurableManifestActivityRequest} options - Candidate durable request.
 * @returns {Promise<Readonly<ResolvedDurableManifestActivityRequest>>} - Exact request identity.
 */
async function resolveDurableManifestActivityRequest(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Durable manifest activity execution requires options.',
    );
  }
  // Snapshot every caller-controlled field before the first asynchronous
  // boundary. The binding replaces the raw execution descriptor with a
  // validated immutable source/embedded executor input.
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  const activityName =
    typeof options.activityName === 'string' ? options.activityName : '';
  if (!activityName) {
    throw new Error('Durable activity execution requires activityName.');
  }
  const availableActivities = getManifestActivityNames(
    binding.identity.manifest,
  );
  if (!availableActivities.includes(activityName)) {
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${
        availableActivities.join(', ') || '(none)'
      }`,
    );
  }
  const idempotencyKey = assertLedgerOpaqueId(
    options.idempotencyKey,
    'idempotencyKey',
  );
  const runId = createManualLedgerRunId({
    appId: binding.identity.appId,
    idempotencyKey,
  });
  const hasInput = Object.prototype.hasOwnProperty.call(options, 'input');
  const input = hasInput
    ? cloneJsonValue(options.input, 'Durable activity input')
    : undefined;
  const hasCallerMetadata = Object.prototype.hasOwnProperty.call(
    options,
    'callerMetadata',
  );
  const callerMetadata = hasCallerMetadata
    ? cloneJsonObject(
        options.callerMetadata,
        'Durable activity caller metadata',
      )
    : undefined;
  const actor = resolveOptionalActor(options.actor);
  const signal = resolveOptionalAbortSignal(options.signal);

  if (binding.execution.kind === 'prepared-source') {
    await binding.execution.prepared.verifyRuntime();
  }
  return Object.freeze({
    execution: binding.execution,
    identity: binding.identity,
    activityName,
    idempotencyKey,
    runId,
    ...(hasInput ? { input } : {}),
    ...(hasCallerMetadata ? { callerMetadata } : {}),
    ...(actor === undefined ? {} : { actor }),
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Execute one already-bound durable request through an already-open ledger.
 * Ownership is deliberately outside this kernel so a future resident worker
 * can call it while holding its long-lived app-scoped owner generation.
 * @param {ResolvedDurableManifestActivityRequest | ResolvedPersistedDurableManifestActivityRequest} request - Exact submitted or persisted durable request.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, controlContext: {db: import('../lib/db/base.js').DBClient, adapterName: import('../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string}, applicationStateConfiguration: ReturnType<typeof resolveApplicationStateStoreConfiguration>, admissionSignal?: AbortSignal, ownerCancellation?: import('./manual-ledger-run.js').ManualLedgerOwnerCancellation, registerActiveAttemptCancellationPort?: import('./manual-ledger-run.js').ManualLedgerActiveAttemptCancellationPortRegistrar}} options - Owned host capabilities.
 * @returns {Promise<{appId: string, revisionId: string, activityName: string, idempotencyKey?: string, runId: string, outcome: Record<string, any>}>} - Durable run result.
 */
async function runResolvedDurableManifestActivity(request, options) {
  const { appId, revisionId } = request.identity;
  const prepareAttemptDispatch = async () => {
    if (options.applicationStateConfiguration.adapterName !== 'lmdb') {
      throw new Error(
        'Durable activity execution requires the LMDB application-state adapter.',
      );
    }
    assertApplicationStateStoreIsolation(
      options.applicationStateConfiguration,
      options.controlContext,
    );
    const applicationState = await openApplicationStateDB({
      configuration: options.applicationStateConfiguration,
    });
    try {
      // Recheck after opening so a prospective path that became an alias
      // between configuration and acquisition cannot cross durable STARTED.
      assertApplicationStateStoreIsolation(
        applicationState.context,
        options.controlContext,
      );
      return {
        executeAttempt: async (
          /** @type {Readonly<Record<string, any>>} */ startFrame,
          /** @type {{signal: AbortSignal}} */ { signal },
        ) => {
          // Store identity is application data. Initialize the catalog only
          // after this exact attempt wins durable dispatch authorization.
          const catalog = await createBuiltinManagedEffectCatalog({
            db: applicationState.db,
            appId,
            adapterName: applicationState.context.adapterName,
            tableName: applicationState.context.tableName,
          });
          return await invokeManifestActivityAttemptWithStart({
            activityName: request.activityName,
            startFrame,
            signal,
            handleEffect: createBuiltinManagedEffectHandler({
              ledger: options.ledger,
              runId: request.runId,
              invocationId: startFrame.invocationId,
              catalog,
            }),
            execution: request.execution,
          });
        },
        release: applicationState.close,
      };
    } catch (error) {
      try {
        await applicationState.close();
      } catch (closeError) {
        throw new AggregateError(
          [error, closeError],
          'Application-state dispatch preparation and cleanup both failed.',
        );
      }
      throw error;
    }
  };

  const outcome = await runManualLedgerActivity({
    ledger: options.ledger,
    runId: request.runId,
    appId,
    revisionId,
    activityId: request.activityName,
    ...(Object.prototype.hasOwnProperty.call(request, 'input')
      ? { input: request.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'callerMetadata')
      ? { callerMetadata: request.callerMetadata }
      : {}),
    ...(request.actor === undefined ? {} : { actor: request.actor }),
    ...(request.signal === undefined ? {} : { signal: request.signal }),
    ...(options.admissionSignal === undefined
      ? {}
      : { admissionSignal: options.admissionSignal }),
    ...(options.ownerCancellation === undefined
      ? {}
      : { ownerCancellation: options.ownerCancellation }),
    ...(options.registerActiveAttemptCancellationPort === undefined
      ? {}
      : {
          registerActiveAttemptCancellationPort:
            options.registerActiveAttemptCancellationPort,
        }),
    prepareAttemptDispatch,
  });
  return {
    appId,
    revisionId,
    activityName: request.activityName,
    ...(!('idempotencyKey' in request) || request.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: request.idempotencyKey }),
    runId: request.runId,
    outcome,
  };
}

/**
 * Persist one immutable manual activity request without claiming or executing
 * it. This is the authority-neutral ingress seam used both by a future CLI
 * router and by the authenticated command endpoint of a resident worker.
 * @param {DurableManifestActivityRequest & {ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore}} options - Bound submission and already-open ledger.
 * @returns {Promise<Readonly<Record<string, any>>>} - Compact durable acceptance receipt.
 */
export async function submitDurableManifestActivity(options) {
  if (!options?.ledger) {
    throw new TypeError('submitDurableManifestActivity requires ledger.');
  }
  const request = await resolveDurableManifestActivityRequest(options);
  const submitted = await submitManualLedgerActivity({
    ledger: options.ledger,
    runId: request.runId,
    appId: request.identity.appId,
    revisionId: request.identity.revisionId,
    activityId: request.activityName,
    ...(Object.prototype.hasOwnProperty.call(request, 'input')
      ? { input: request.input }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(request, 'callerMetadata')
      ? { callerMetadata: request.callerMetadata }
      : {}),
    ...(request.actor === undefined ? {} : { actor: request.actor }),
  });
  return Object.freeze({
    ...submitted,
    idempotencyKey: request.idempotencyKey,
  });
}

/**
 * Re-read and bind one persisted manual request to an immutable execution
 * descriptor. The creation actor is retained exactly so the ordinary manual
 * runner can replay its `create` transition before claiming work without
 * changing durable authorship.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, execution: ManifestActivityExecution, runId: string, signal?: AbortSignal}} options - Persisted execution inputs.
 * @returns {Promise<Readonly<ResolvedPersistedDurableManifestActivityRequest>>} - Exact stored request bound to executable revision bytes.
 */
async function resolvePersistedDurableManifestActivityRequest(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Persisted durable manifest activity execution requires options.',
    );
  }
  if (
    !options.ledger ||
    typeof options.ledger.readManualRunRequest !== 'function'
  ) {
    throw new TypeError(
      'Persisted durable manifest activity execution requires ledger.readManualRunRequest.',
    );
  }
  const binding = resolveManifestActivityExecutionBinding(options.execution);
  const runId = assertLedgerOpaqueId(options.runId, 'runId');
  const stored = await options.ledger.readManualRunRequest(
    runId,
    MANUAL_LEDGER_INVOCATION_ID,
  );
  if (!stored) {
    throw new Error(
      `Persisted manual activity request was not found: ${runId}`,
    );
  }
  const run = cloneJsonObject(stored.run, 'Persisted durable activity run');
  const invocation = cloneJsonObject(
    stored.invocation,
    'Persisted durable activity invocation',
  );
  const request = cloneJsonObject(
    stored.request,
    'Persisted durable activity request',
  );
  const actor = resolveOptionalActor(stored.actor);
  if (!actor) {
    throw new Error(
      `Persisted manual activity request has no creation actor: ${runId}`,
    );
  }
  if (
    run.runId !== runId ||
    run.appId !== binding.identity.appId ||
    run.revisionId !== binding.identity.revisionId ||
    run.trigger?.kind !== 'manual' ||
    invocation.runId !== runId ||
    invocation.invocationId !== MANUAL_LEDGER_INVOCATION_ID ||
    invocation.appId !== binding.identity.appId ||
    invocation.revisionId !== binding.identity.revisionId ||
    run.requestRef === undefined ||
    invocation.requestRef === undefined ||
    !hasSameCanonicalJson(run.requestRef, invocation.requestRef)
  ) {
    throw new Error(
      `Persisted manual activity request does not match its embedded application revision: ${runId}`,
    );
  }
  const activityName =
    typeof invocation.activityId === 'string' ? invocation.activityId : '';
  if (
    !activityName ||
    !getManifestActivityNames(binding.identity.manifest).includes(activityName)
  ) {
    throw new Error(
      `Persisted manual activity '${activityName || '(missing)'}' is unavailable in revision ${binding.identity.revisionId}.`,
    );
  }
  if (binding.execution.kind === 'prepared-source') {
    await binding.execution.prepared.verifyRuntime();
  }
  const signal = resolveOptionalAbortSignal(options.signal);
  return Object.freeze({
    execution: binding.execution,
    identity: binding.identity,
    activityName,
    runId,
    input: cloneJsonValue(request.input, 'Persisted durable activity input'),
    callerMetadata: cloneJsonObject(
      request.callerMetadata,
      'Persisted durable activity caller metadata',
    ),
    actor,
    ...(signal === undefined ? {} : { signal }),
  });
}

/**
 * Execute one already-persisted request through an already-open control
 * ledger. Callers must hold the application mutation owner for the complete
 * call; this function never acquires or releases local ownership.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, controlContext: {db: import('../lib/db/base.js').DBClient, adapterName: import('../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string}, execution: ManifestActivityExecution, runId: string, admissionSignal?: AbortSignal, signal?: AbortSignal, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, ownerCancellation?: import('./manual-ledger-run.js').ManualLedgerOwnerCancellation, registerActiveAttemptCancellationPort?: import('./manual-ledger-run.js').ManualLedgerActiveAttemptCancellationPortRegistrar}} options - Owned persisted execution request.
 * @returns {ReturnType<typeof runResolvedDurableManifestActivity>} - Durable activity result.
 */
export async function runPersistedDurableManifestActivity(options) {
  if (!options?.ledger) {
    throw new TypeError('runPersistedDurableManifestActivity requires ledger.');
  }
  if (!options.controlContext) {
    throw new TypeError(
      'runPersistedDurableManifestActivity requires controlContext.',
    );
  }
  const controlContext = Object.freeze({
    db: options.controlContext.db,
    adapterName: options.controlContext.adapterName,
    controlPath: options.controlContext.controlPath,
    tableName: options.controlContext.tableName,
  });
  const applicationStateConfiguration = Object.prototype.hasOwnProperty.call(
    options,
    'applicationStateConfiguration',
  )
    ? validateApplicationStateStoreConfiguration(
        options.applicationStateConfiguration,
      )
    : resolveApplicationStateStoreConfiguration();
  if (applicationStateConfiguration.adapterName !== 'lmdb') {
    throw new Error(
      'Durable activity execution requires the LMDB application-state adapter.',
    );
  }
  assertApplicationStateStoreIsolation(
    applicationStateConfiguration,
    controlContext,
  );
  const request = await resolvePersistedDurableManifestActivityRequest(options);
  const admissionSignal = resolveOptionalAbortSignal(options.admissionSignal);
  return await runResolvedDurableManifestActivity(request, {
    ledger: options.ledger,
    controlContext,
    applicationStateConfiguration,
    ...(admissionSignal === undefined ? {} : { admissionSignal }),
    ...(options.ownerCancellation === undefined
      ? {}
      : { ownerCancellation: options.ownerCancellation }),
    ...(options.registerActiveAttemptCancellationPort === undefined
      ? {}
      : {
          registerActiveAttemptCancellationPort:
            options.registerActiveAttemptCancellationPort,
        }),
  });
}

/**
 * Run one durable manifest activity through an already-open control ledger.
 * This is the authority-neutral resident integration seam; callers remain
 * responsible for holding the app's mutation ownership capability.
 * @param {DurableManifestActivityRequest & {ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, controlContext: {db: import('../lib/db/base.js').DBClient, adapterName: import('../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string}, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, ownerCancellation?: import('./manual-ledger-run.js').ManualLedgerOwnerCancellation, registerActiveAttemptCancellationPort?: import('./manual-ledger-run.js').ManualLedgerActiveAttemptCancellationPortRegistrar}} options - Owned durable host request.
 * @returns {Promise<{appId: string, revisionId: string, activityName: string, idempotencyKey: string, runId: string, outcome: Record<string, any>}>} - Durable run result.
 */
export async function runDurableManifestActivity(options) {
  const ledger = options?.ledger;
  if (!ledger) {
    throw new TypeError('runDurableManifestActivity requires ledger.');
  }
  const candidateControlContext = options.controlContext;
  if (!candidateControlContext) {
    throw new TypeError('runDurableManifestActivity requires controlContext.');
  }
  const controlContext = Object.freeze({
    db: candidateControlContext.db,
    adapterName: candidateControlContext.adapterName,
    controlPath: candidateControlContext.controlPath,
    tableName: candidateControlContext.tableName,
  });
  const applicationStateConfiguration = Object.prototype.hasOwnProperty.call(
    options,
    'applicationStateConfiguration',
  )
    ? validateApplicationStateStoreConfiguration(
        options.applicationStateConfiguration,
      )
    : resolveApplicationStateStoreConfiguration();
  const request = await resolveDurableManifestActivityRequest(options);
  if (applicationStateConfiguration.adapterName !== 'lmdb') {
    throw new Error(
      'Durable activity execution requires the LMDB application-state adapter.',
    );
  }
  assertApplicationStateStoreIsolation(
    applicationStateConfiguration,
    controlContext,
  );
  const result = await runResolvedDurableManifestActivity(request, {
    ledger,
    controlContext,
    applicationStateConfiguration,
    ...(options.ownerCancellation === undefined
      ? {}
      : { ownerCancellation: options.ownerCancellation }),
    ...(options.registerActiveAttemptCancellationPort === undefined
      ? {}
      : {
          registerActiveAttemptCancellationPort:
            options.registerActiveAttemptCancellationPort,
        }),
  });
  return { ...result, idempotencyKey: request.idempotencyKey };
}

/**
 * Acquire one short-lived local mutation owner, host its authenticated exact-
 * run cancellation endpoint, and delegate to the authority-neutral durable
 * activity kernel. Source and packaged foreground commands share this path.
 * @param {DurableManifestActivityRequest} options - Local foreground request.
 * @returns {ReturnType<typeof runResolvedDurableManifestActivity>} - Durable run result.
 */
export async function runLocalDurableManifestActivity(options) {
  const request = await resolveDurableManifestActivityRequest(options);
  const configuration = resolveExecutionLedgerStoreConfiguration();
  const applicationStateConfiguration =
    resolveApplicationStateStoreConfiguration();
  if (applicationStateConfiguration.adapterName !== 'lmdb') {
    throw new Error(
      'Durable activity execution requires the LMDB application-state adapter.',
    );
  }
  assertApplicationStateStoreIsolation(
    applicationStateConfiguration,
    configuration,
  );

  return await withExecutionLedger(
    async (ledger, controlContext) =>
      await withLocalLedgerServiceMutationOwnership({
        appId: request.identity.appId,
        context: controlContext,
        handler: async (localOwner) => {
          if (!localOwner) {
            return await runResolvedDurableManifestActivity(request, {
              ledger,
              controlContext,
              applicationStateConfiguration,
            });
          }

          const ownership = createLedgerServiceOwnership({
            db: controlContext.db,
            tableName: controlContext.tableName,
          });
          /** @type {{requestCancellation: (request: {requestId: string}) => Promise<Record<string, any>>} | undefined} */
          let activeCancellationPort;
          const commandServer = await createLocalOwnerCommandServer({
            session: localOwner.commandSession,
            isCurrentOwner: async () =>
              isCurrentManualOwner(
                await ownership.getOwnership({
                  serviceId: localOwner.ownership.serviceId,
                }),
                localOwner.ownership,
              ),
            handleCommand: async (command) => {
              if (
                command.command !== EXECUTION_LEDGER_CANCEL_OWNER_COMMAND ||
                !isExactOwnerCancelRequest(command.request, request.runId)
              ) {
                return {
                  outcome: 'request-unavailable',
                  delivery: 'not-delivered',
                };
              }
              if (!activeCancellationPort) {
                return {
                  outcome: 'owner-not-ready',
                  delivery: 'not-delivered',
                };
              }
              return formatOwnerCancellationResponse(
                await activeCancellationPort.requestCancellation({
                  requestId: command.requestId,
                }),
              );
            },
          });
          /** @type {{appId: string, revisionId: string, activityName: string, idempotencyKey?: string, runId: string, outcome: Record<string, any>} | undefined} */
          let result;
          /** @type {unknown} */
          let runnerError;
          let runnerFailed = false;
          try {
            result = await runResolvedDurableManifestActivity(request, {
              ledger,
              controlContext,
              applicationStateConfiguration,
              ownerCancellation: {
                actor: {
                  kind: 'local-owner-command',
                  id: request.identity.appId,
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
          } catch (error) {
            runnerFailed = true;
            runnerError = error;
          }

          /** @type {unknown} */
          let closeError;
          let closeFailed = false;
          try {
            // The endpoint disappears before owner release, so a request can
            // never reach an old server after its generation ceased to exist.
            await commandServer.close();
          } catch (error) {
            closeFailed = true;
            closeError = error;
          }
          if (runnerFailed && closeFailed) {
            throw new AggregateError(
              [runnerError, closeError],
              'Durable activity execution and owner-command cleanup both failed.',
            );
          }
          if (runnerFailed) throw runnerError;
          if (closeFailed) throw closeError;
          return {
            .../** @type {{appId: string, revisionId: string, activityName: string, runId: string, outcome: Record<string, any>}} */ (
              result
            ),
            idempotencyKey: request.idempotencyKey,
          };
        },
      }),
    { configuration },
  );
}

export default runLocalDurableManifestActivity;
