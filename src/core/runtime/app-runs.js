import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import Action, { Status as ActionStatus } from '../lib/graph/action.js';
import Operation, {
  Status as OperationStatus,
  Type as OperationType,
} from '../lib/graph/operation.js';
import { runOperation } from '../lib/graph/runner.js';
import WharfieFunction from '../resources/builds/function.js';
import FunctionResource from '../resources/builds/function-resource.js';
import { validateAppManifest } from './app-manifest.js';
import { getBuildTargetId, validateBuildTarget } from './build-target.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertApplicationRevisionId,
  validateApplicationRevision,
  validateDependencyLockInput,
} from './application-revision.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { createActorSystemResources } from './resources.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} left - First canonical JSON value.
 * @param {unknown} right - Second canonical JSON value.
 * @returns {boolean} - Whether both values have identical canonical JSON.
 */
function hasSameCanonicalJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * Derive the exact target executing a source activity. Linux source execution
 * must positively identify glibc because labelling an unknown or musl host as
 * glibc could select incompatible native packages from the frozen closure.
 * Optional overrides exist only to make the platform boundary deterministic in
 * tests; production callers pass no argument.
 * @param {{ nodeVersion?: string, platform?: string, architecture?: string, glibcVersionRuntime?: string | undefined }} [overrides] - Host observations.
 * @returns {{ nodeVersion: string, platform: 'darwin'|'linux'|'win32', architecture: 'arm64'|'x64', libc?: 'glibc' }} - Exact canonical host target.
 */
export function getHostSourceBuildTarget(overrides = {}) {
  const nodeVersion = overrides.nodeVersion ?? process.versions.node;
  const platform = overrides.platform ?? process.platform;
  const architecture = overrides.architecture ?? process.arch;
  let glibcVersionRuntime;

  if (platform === 'linux') {
    if (
      Object.prototype.hasOwnProperty.call(overrides, 'glibcVersionRuntime')
    ) {
      glibcVersionRuntime = overrides.glibcVersionRuntime;
    } else {
      try {
        const report = /** @type {any} */ (process.report?.getReport?.());
        glibcVersionRuntime = report?.header?.glibcVersionRuntime;
      } catch {
        glibcVersionRuntime = undefined;
      }
    }
    if (
      typeof glibcVersionRuntime !== 'string' ||
      !glibcVersionRuntime.trim()
    ) {
      throw new Error(
        'Source external execution on Linux requires a positively identified glibc host; musl and unknown libc hosts are not supported.',
      );
    }
  }

  return validateBuildTarget(
    {
      nodeVersion,
      platform,
      architecture,
      ...(platform === 'linux' ? { libc: 'glibc' } : {}),
    },
    'source host target',
  );
}

/**
 * Validate that a sealed lock handle and manifest belong to one complete
 * immutable revision before any activity resource or package operation starts.
 * @param {{ manifest: unknown, appDir: string, sourceRevision: unknown }} options - Source identity inputs.
 * @returns {{ manifest: Record<string, any>, revision: import('./application-revision.js').ApplicationRevision, dependencyLock: { path: string, input: import('./application-revision.js').LockedInputDescriptor } }} - Validated source identity.
 */
function validateSourceRevisionContext(options) {
  if (!isObjectRecord(options.sourceRevision)) {
    throw new TypeError(
      'Source activity execution requires sourceRevision with an immutable revision and sealed dependency lock.',
    );
  }
  for (const key of Object.keys(options.sourceRevision)) {
    if (key !== 'revision' && key !== 'dependencyLock') {
      throw new TypeError(`sourceRevision.${key} is not supported.`);
    }
  }

  const revision = validateApplicationRevision(
    options.sourceRevision.revision,
    'sourceRevision.revision',
  );
  const manifest = validateAppManifest(options.manifest, 'source manifest');
  const targetFreeManifest = { ...manifest };
  delete targetFreeManifest.targets;
  if (!hasSameCanonicalJson(targetFreeManifest, revision.contract)) {
    throw new Error(
      'Source manifest does not match the immutable application revision contract.',
    );
  }

  const dependencyLock = options.sourceRevision.dependencyLock;
  if (!isObjectRecord(dependencyLock)) {
    throw new TypeError(
      'sourceRevision.dependencyLock must be a sealed lock handle.',
    );
  }
  for (const key of Object.keys(dependencyLock)) {
    if (key !== 'path' && key !== 'input') {
      throw new TypeError(
        `sourceRevision.dependencyLock.${key} is not supported.`,
      );
    }
  }
  if (
    typeof dependencyLock.path !== 'string' ||
    !dependencyLock.path ||
    !path.isAbsolute(dependencyLock.path)
  ) {
    throw new TypeError(
      'sourceRevision.dependencyLock.path must be an absolute file path.',
    );
  }
  const input = validateDependencyLockInput(
    dependencyLock.input,
    'sourceRevision.dependencyLock.input',
  );
  if (!hasSameCanonicalJson(input, revision.inputs.dependencies)) {
    throw new Error(
      'Source dependency lock descriptor does not match the immutable application revision.',
    );
  }

  return {
    manifest,
    revision,
    dependencyLock: { path: dependencyLock.path, input },
  };
}

/**
 * Decode one canonical base64 external archive.
 * @param {unknown} value - Candidate base64 archive.
 * @returns {Buffer} - Exact archive bytes.
 */
function decodeExternalArchive(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(
      'Prepared source external closure did not produce an archive.',
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error(
      'Prepared source external closure produced a noncanonical archive encoding.',
    );
  }
  return bytes;
}

/**
 * Ensure a source entrypoint cannot resolve a different app-local Wharfie copy
 * than the runtime whose bytes are locked by the prepared revision. A missing
 * resolution is allowed here because activities need not import Wharfie; an
 * actual unresolved import still fails in the normal module/bundle boundary.
 * @param {string} entrypointPath - Absolute sealed activity entrypoint.
 * @returns {void}
 */
function assertSourceRuntimeResolution(entrypointPath) {
  const runningWharfiePackagePath = realpathSync(
    createRequire(import.meta.url).resolve('@wharfie/wharfie/package.json'),
  );
  let resolvedPackagePath;
  try {
    resolvedPackagePath = realpathSync(
      createRequire(entrypointPath).resolve('@wharfie/wharfie/package.json'),
    );
  } catch {
    return;
  }
  if (resolvedPackagePath !== runningWharfiePackagePath) {
    throw new Error(
      'Source activity resolves a different @wharfie/wharfie runtime than the runtime locked by its prepared application revision.',
    );
  }
}

/**
 * Clone caller-owned values before they cross an activity boundary.
 * @param {{ event?: any, context?: any }} options - Invocation options.
 * @returns {{ event: any, context: Record<string, any> }} - JSON-only inputs.
 */
function cloneActivityInputs(options) {
  const hasEvent = Object.prototype.hasOwnProperty.call(options, 'event');
  const hasContext = Object.prototype.hasOwnProperty.call(options, 'context');
  return {
    event: cloneJsonValue(hasEvent ? options.event : {}, 'Activity event'),
    context: cloneJsonObject(
      hasContext ? options.context : {},
      'Activity context',
    ),
  };
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestActivities(manifest) {
  return isObjectRecord(manifest?.activities) ? manifest.activities : {};
}

/**
 * @param {any} manifest - manifest.
 * @returns {string[]} - Result.
 */
export function getManifestActivityNames(manifest) {
  return Object.keys(getManifestActivities(manifest)).sort(
    compareCanonicalStrings,
  );
}

/**
 * @param {{ manifest: any, activityName: string }} options - options.
 * @returns {any | undefined} - Result.
 */
export function getManifestActivityDefinition(options) {
  assertLogicalId(options.activityName, 'activityName');
  return getManifestActivities(options.manifest)[options.activityName];
}

/**
 * @param {any} manifest - manifest.
 * @returns {Record<string, any>} - Result.
 */
export function getManifestResourcesSpec(manifest) {
  return isObjectRecord(manifest?.resources) ? manifest.resources : {};
}

/**
 * @param {{ manifest: any, activityName: string, appDir: string }} options - options.
 * @returns {WharfieFunction} - Result.
 */
export function createManifestActivityFunction(options) {
  const activityName = options.activityName;
  const definition = getManifestActivityDefinition(options);

  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(options.manifest);
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }

  return new WharfieFunction({
    name: activityName,
    entrypoint: {
      path: path.resolve(options.appDir, definition.entrypoint.path),
      export: definition.entrypoint.export,
    },
    properties: {
      ...(Array.isArray(definition.externalPackages)
        ? { external: definition.externalPackages }
        : {}),
      ...(isObjectRecord(definition.resources)
        ? { resources: definition.resources }
        : {}),
    },
  });
}

/**
 * Build and invoke one external-bearing activity from the sealed source and
 * dependency lock owned by its revision. This intentionally calls the public
 * FunctionResource bundle primitives directly; it does not reconcile a build
 * graph, write a SEA asset, or select any manifest packaging target.
 * @param {{ manifest: Record<string, any>, revision: import('./application-revision.js').ApplicationRevision, dependencyLock: { path: string, input: import('./application-revision.js').LockedInputDescriptor }, appDir: string, activityName: string, event: any, context: Record<string, any>, baseResources: Record<string, any> }} options - Prepared invocation inputs.
 * @returns {Promise<any>} - Activity result.
 */
async function invokePreparedSourceExternalActivity(options) {
  const definition = getManifestActivityDefinition(options);
  if (
    !definition ||
    !isObjectRecord(definition.entrypoint) ||
    !Array.isArray(definition.externalPackages) ||
    definition.externalPackages.length === 0
  ) {
    throw new Error(
      `Source activity '${options.activityName}' has no external package closure to prepare.`,
    );
  }

  const buildTarget = getHostSourceBuildTarget();
  const resource = new FunctionResource({
    name: `source-${options.revision.revisionId}-${options.activityName}`,
    properties: {
      functionName: options.activityName,
      entrypoint: {
        path: path.resolve(options.appDir, definition.entrypoint.path),
        export: definition.entrypoint.export,
      },
      external: definition.externalPackages,
      buildTarget,
    },
    dependencyLock: options.dependencyLock,
  });

  const [codeString, bundledExternals] = await Promise.all([
    resource.esbuild(),
    resource.bundleExternals(),
  ]);
  if (!bundledExternals.receipt) {
    throw new Error(
      `Source activity '${options.activityName}' produced no frozen dependency receipt.`,
    );
  }
  const closurePlan = bundledExternals.receipt.plan;
  const planExternals = Array.isArray(closurePlan?.roots)
    ? closurePlan.roots.map(
        (/** @type {{name: string, version: string}} */ root) => ({
          name: root.name,
          version: root.version,
        }),
      )
    : undefined;
  if (
    !closurePlan ||
    closurePlan.activity !== options.activityName ||
    getBuildTargetId(closurePlan.target) !== getBuildTargetId(buildTarget) ||
    !hasSameCanonicalJson(planExternals, definition.externalPackages)
  ) {
    throw new Error(
      `Source activity '${options.activityName}' frozen closure plan does not match its prepared revision inputs.`,
    );
  }
  const receiptDependencyLockInput = validateDependencyLockInput(
    closurePlan.lock,
    'prepared source dependency receipt',
  );
  if (
    !hasSameCanonicalJson(
      bundledExternals.receipt.dependencyLockInput,
      receiptDependencyLockInput,
    )
  ) {
    throw new Error(
      'Prepared source dependency receipt fields do not name one frozen lock.',
    );
  }
  if (
    !hasSameCanonicalJson(
      receiptDependencyLockInput,
      options.revision.inputs.dependencies,
    )
  ) {
    throw new Error(
      'Prepared source dependency receipt does not match the immutable application revision.',
    );
  }

  const externalsTar = decodeExternalArchive(bundledExternals.externalsTar);
  const externalArchiveDigest = {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(externalsTar).digest('base64url'),
  };
  return await WharfieFunction.runPreparedBundle(
    options.activityName,
    {
      codeString,
      externalsTar,
      externalArchiveDigest,
      ...(isObjectRecord(definition.resources)
        ? { resourceSpecs: definition.resources }
        : {}),
    },
    options.event,
    options.context,
    { resources: options.baseResources },
  );
}

/**
 * @param {{ manifest: any, activityName: string, event?: any, context?: any, resourceResolution?: { registryPath?: string } }} options - options.
 * @returns {Promise<any>} - Result.
 */
export async function invokeEmbeddedManifestActivity(options) {
  const activityName = options.activityName;
  const definition = getManifestActivityDefinition(options);

  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(options.manifest);
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }

  const { event, context } = cloneActivityInputs(options);

  const { resources: baseResources, close } = await createActorSystemResources(
    getManifestResourcesSpec(options.manifest),
    options.resourceResolution,
  );

  try {
    const result = await WharfieFunction.run(activityName, event, context, {
      resources: baseResources,
    });
    return cloneJsonValue(result, 'Activity result');
  } finally {
    await close();
  }
}

/**
 * @param {{ manifest: any, appDir?: string, activityName: string, event?: any, context?: any, resourceResolution?: { registryPath?: string }, executionMode?: 'source' | 'embedded', sourceRevision?: { revision: unknown, dependencyLock: unknown } }} options - options.
 * @returns {Promise<any>} - Result.
 */
export async function invokeManifestActivity(options) {
  if (options.executionMode === 'embedded') {
    return await invokeEmbeddedManifestActivity(options);
  }

  if (typeof options.appDir !== 'string' || !options.appDir) {
    throw new Error(
      'Source activity execution requires the application directory.',
    );
  }
  const initialDefinition = getManifestActivityDefinition(options);
  const hasExternalPackages =
    Array.isArray(initialDefinition?.externalPackages) &&
    initialDefinition.externalPackages.length > 0;
  if (hasExternalPackages && !options.sourceRevision) {
    throw new Error(
      `Source activity '${options.activityName}' declares external packages and requires a prepared sourceRevision; ambient node_modules are not execution inputs.`,
    );
  }
  const sourceIdentity = options.sourceRevision
    ? validateSourceRevisionContext({
        manifest: options.manifest,
        appDir: options.appDir,
        sourceRevision: options.sourceRevision,
      })
    : null;
  const manifest = sourceIdentity?.manifest || options.manifest;
  if (sourceIdentity && isObjectRecord(initialDefinition?.entrypoint)) {
    assertSourceRuntimeResolution(
      path.resolve(options.appDir, initialDefinition.entrypoint.path),
    );
  }
  const fn = hasExternalPackages
    ? null
    : createManifestActivityFunction({
        manifest,
        activityName: options.activityName,
        appDir: options.appDir,
      });
  const { event, context } = cloneActivityInputs(options);
  const { resources: baseResources, close } = await createActorSystemResources(
    getManifestResourcesSpec(manifest),
    options.resourceResolution,
  );

  try {
    let result;
    if (sourceIdentity && hasExternalPackages) {
      result = await invokePreparedSourceExternalActivity({
        manifest: sourceIdentity.manifest,
        revision: sourceIdentity.revision,
        dependencyLock: sourceIdentity.dependencyLock,
        appDir: options.appDir,
        activityName: options.activityName,
        event,
        context,
        baseResources,
      });
    } else {
      if (!fn) {
        throw new Error(
          `Source activity '${options.activityName}' was not prepared for execution.`,
        );
      }
      result = await fn.fn(event, context, { baseResources });
    }
    return cloneJsonValue(result, 'Activity result');
  } finally {
    await Promise.allSettled([
      close(),
      fn && typeof fn.closeRuntimeResources === 'function'
        ? fn.closeRuntimeResources()
        : Promise.resolve(),
    ]);
  }
}

/**
 * @param {string} appId - Canonical application logical ID.
 * @returns {string} - Result.
 */
export function getAppResourceId(appId) {
  assertLogicalId(appId, 'appId');
  return `app:${appId}`;
}

/**
 * Derive one stable operation identity from a queue and its provider-assigned
 * message identity. JSON encodes the pair without delimiter ambiguity; the
 * domain-separated digest keeps operation IDs compact and safe for storage.
 * @param {{ queueUrl: string, messageId: string }} options - Queue message identity.
 * @returns {string} - Stable queue operation ID.
 */
export function getQueueOperationId(options) {
  if (typeof options?.queueUrl !== 'string' || options.queueUrl.length === 0) {
    throw new TypeError('queueUrl must be a non-empty string.');
  }
  if (
    typeof options?.messageId !== 'string' ||
    options.messageId.length === 0
  ) {
    throw new TypeError('messageId must be a non-empty string.');
  }

  const digest = createHash('sha256')
    .update('wharfie:queue-operation:v1\0', 'utf8')
    .update(JSON.stringify([options.queueUrl, options.messageId]), 'utf8')
    .digest('hex');
  return `queue-${digest}`;
}

/**
 * @param {any} trigger - trigger.
 * @returns {{ source: string, scheduledTime?: string, event?: any, queueUrl?: string, messageId?: string }} - Result.
 */
function normalizeTrigger(trigger) {
  if (!isObjectRecord(trigger)) {
    return { source: 'manual' };
  }

  return {
    source:
      typeof trigger.source === 'string' && trigger.source.trim()
        ? trigger.source.trim()
        : 'manual',
    ...(typeof trigger.scheduledTime === 'string' && trigger.scheduledTime
      ? { scheduledTime: trigger.scheduledTime }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(trigger, 'event')
      ? { event: cloneJsonValue(trigger.event, 'Operation trigger event') }
      : {}),
    ...(typeof trigger.queueUrl === 'string' && trigger.queueUrl.length > 0
      ? { queueUrl: trigger.queueUrl }
      : {}),
    ...(typeof trigger.messageId === 'string' && trigger.messageId.length > 0
      ? { messageId: trigger.messageId }
      : {}),
  };
}

/**
 * @param {{ appId: string, revisionId: string, activityName: string, event?: any, context?: Record<string, any>, operationId?: string, trigger?: any }} options - options.
 * @returns {Operation} - Result.
 */
export function createOperationFromActivity(options) {
  assertLogicalId(options.appId, 'appId');
  assertApplicationRevisionId(options.revisionId, 'revisionId');
  assertLogicalId(options.activityName, 'activityName');
  const hasOperationId = options.operationId !== undefined;
  if (
    hasOperationId &&
    (typeof options.operationId !== 'string' ||
      options.operationId.length === 0)
  ) {
    throw new TypeError('operationId must be a nonempty string when provided.');
  }
  const event = cloneJsonValue(
    Object.prototype.hasOwnProperty.call(options, 'event') ? options.event : {},
    'Activity event',
  );
  const context = cloneJsonObject(
    Object.prototype.hasOwnProperty.call(options, 'context')
      ? options.context
      : {},
    'Activity context',
  );
  const operation = new Operation({
    resource_id: getAppResourceId(options.appId),
    revision_id: options.revisionId,
    ...(hasOperationId ? { id: options.operationId } : {}),
    type: OperationType.PIPELINE,
    operation_config: {
      source: 'app-manifest',
      app_id: options.appId,
      activity_name: options.activityName,
      context,
      trigger: normalizeTrigger(options.trigger),
    },
    operation_inputs: event,
  });

  operation.createAction({
    id: 'invoke',
    type: Action.Type.INVOKE_FUNCTION,
    function_name: options.activityName,
    inputs: cloneJsonValue(event, 'Activity action input'),
    placement: { mode: 'local' },
  });

  return operation;
}

/**
 * @typedef RunPersistedActivityOptions
 * @property {import('../lib/db/tables/operations.js').OperationsTableClient} store - Operations store.
 * @property {string} appId - Canonical application ID.
 * @property {string} revisionId - Immutable application revision identity.
 * @property {string} activityName - Canonical activity ID.
 * @property {string} operationId - Stable operation ID.
 * @property {any} [event] - Activity event.
 * @property {Record<string, any>} [context] - Immutable user activity context.
 * @property {Record<string, any>} [attemptContext] - Volatile current-attempt context excluded from durable identity.
 * @property {any} [trigger] - Immutable operation trigger.
 * @property {(request: { activityName: string, revisionId: string, event?: any, context: Record<string, any> }) => Promise<any>} execute - Activity executor.
 */

/**
 * @param {unknown} error - Candidate duplicate-create error.
 * @returns {boolean} - Whether the operation already exists.
 */
function isOperationAlreadyExistsError(error) {
  return error instanceof Error && error.name === 'OperationAlreadyExistsError';
}

/**
 * @param {string} message - Error message.
 * @param {{ resourceId: string, operationId: string, status: string, requestedRevisionId?: string, persistedRevisionId?: string }} details - Operation details.
 * @param {string} [name] - Error name.
 * @returns {Error} - Enriched operation error.
 */
function createOperationRunError(message, details, name) {
  const error = new Error(message);
  if (name) error.name = name;
  Object.assign(error, details);
  return error;
}

/**
 * Return the immutable part of a persisted named-activity operation. Runtime
 * status, generations, attempts, timestamps, errors, and outputs intentionally
 * do not participate in idempotency identity.
 * @param {Operation} operation - Operation to describe.
 * @returns {Record<string, any>} - Canonical identity input.
 */
function getPersistedActivityIdentity(operation) {
  return {
    resource_id: operation.resource_id,
    revision_id: operation.revision_id,
    id: operation.id,
    type: operation.type,
    operation_config: operation.operation_config,
    operation_inputs: operation.operation_inputs,
    actions: operation
      .getActions()
      .map((action) => ({
        id: action.id,
        resource_id: action.resource_id,
        operation_id: action.operation_id,
        type: action.type,
        function_name: action.function_name,
        inputs: action.inputs,
        placement: action.placement,
        retry: action.retry,
        depends_on: operation
          .getUpstreamActionIds(action.id)
          .sort(compareCanonicalStrings),
      }))
      .sort((left, right) => compareCanonicalStrings(left.id, right.id)),
  };
}

/**
 * @param {Operation} requested - Requested immutable definition.
 * @param {Operation} existing - Persisted immutable definition.
 * @returns {boolean} - Whether both definitions describe the same work.
 */
function hasSamePersistedActivityIdentity(requested, existing) {
  try {
    return (
      JSON.stringify(
        sortCanonicalJsonValue(getPersistedActivityIdentity(requested)),
      ) ===
      JSON.stringify(
        sortCanonicalJsonValue(getPersistedActivityIdentity(existing)),
      )
    );
  } catch {
    return false;
  }
}

/**
 * Create or resume one persisted named-activity operation and execute it through
 * the shared graph runner. Operation creation is immutable: duplicate delivery
 * loads existing truth, completed work deduplicates, and retryable terminal work
 * is reopened only through the store's explicit retry transition.
 * @param {RunPersistedActivityOptions} options - Run options.
 * @returns {Promise<{ resourceId: string, operationId: string, status: 'COMPLETED', deduplicated: boolean }>} - Completed operation identity.
 */
export async function runPersistedActivity(options) {
  if (!options?.store) {
    throw new Error('runPersistedActivity requires store');
  }
  if (typeof options.store.createOperation !== 'function') {
    throw new Error('runPersistedActivity requires store.createOperation');
  }
  if (typeof options.execute !== 'function') {
    throw new Error('runPersistedActivity requires execute(request)');
  }
  if (typeof options.operationId !== 'string' || !options.operationId) {
    throw new Error('runPersistedActivity requires operationId');
  }

  const operation = createOperationFromActivity({
    appId: options.appId,
    revisionId: options.revisionId,
    activityName: options.activityName,
    operationId: options.operationId,
    ...(Object.prototype.hasOwnProperty.call(options, 'event')
      ? { event: options.event }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(options, 'context')
      ? { context: options.context }
      : {}),
    trigger: options.trigger,
  });
  const resourceId = operation.resource_id;
  const operationId = operation.id;
  const attemptContext = cloneJsonObject(
    Object.prototype.hasOwnProperty.call(options, 'attemptContext')
      ? options.attemptContext
      : {},
    'Activity attempt context',
  );

  let created = false;
  let operationToClaim = operation;
  try {
    await options.store.createOperation(operation);
    created = true;
  } catch (error) {
    if (!isOperationAlreadyExistsError(error)) throw error;
  }

  if (!created) {
    const records = await options.store.getRecords(resourceId, operationId);
    const existing = records.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (!existing) {
      throw createOperationRunError(
        `Operation already exists but could not be loaded: ${resourceId}#${operationId}`,
        { resourceId, operationId, status: 'UNKNOWN' },
      );
    }

    if (operation.revision_id !== existing.revision_id) {
      throw createOperationRunError(
        `Operation revision conflicts with existing work: ${resourceId}#${operationId} requested ${operation.revision_id}, persisted ${existing.revision_id}`,
        {
          resourceId,
          operationId,
          status: existing.status,
          requestedRevisionId: operation.revision_id,
          persistedRevisionId: existing.revision_id,
        },
        'OperationRevisionMismatchError',
      );
    }

    if (!hasSamePersistedActivityIdentity(operation, existing)) {
      throw createOperationRunError(
        `Operation identity conflicts with existing work: ${resourceId}#${operationId}`,
        { resourceId, operationId, status: existing.status },
        'OperationIdentityConflictError',
      );
    }

    if (existing.status === OperationStatus.COMPLETED) {
      return {
        resourceId,
        operationId,
        status: 'COMPLETED',
        deduplicated: true,
      };
    }

    if (existing.status === OperationStatus.CANCELLED) {
      throw createOperationRunError(
        `Operation ${resourceId}#${operationId} was cancelled.`,
        { resourceId, operationId, status: existing.status },
        'OperationCancelledError',
      );
    }

    if (existing.status === OperationStatus.RUNNING) {
      throw createOperationRunError(
        `Operation ${resourceId}#${operationId} is already running.`,
        { resourceId, operationId, status: existing.status },
        'OperationInProgressError',
      );
    }

    if (
      existing.status === OperationStatus.FAILED ||
      existing.status === OperationStatus.BLOCKED
    ) {
      if (typeof options.store.retryOperation !== 'function') {
        throw new Error('runPersistedActivity requires store.retryOperation');
      }
      operationToClaim = await options.store.retryOperation(
        resourceId,
        operationId,
        existing.version,
      );
      if (!hasSamePersistedActivityIdentity(operation, operationToClaim)) {
        throw createOperationRunError(
          `Operation identity changed during retry: ${resourceId}#${operationId}`,
          { resourceId, operationId, status: operationToClaim.status },
          'OperationIdentityConflictError',
        );
      }
    } else if (existing.status !== OperationStatus.PENDING) {
      throw createOperationRunError(
        `Operation ${resourceId}#${operationId} has unsupported status ${String(existing.status)}.`,
        { resourceId, operationId, status: String(existing.status) },
      );
    } else {
      operationToClaim = existing;
    }
  }

  const result = await runOperation({
    store: options.store,
    resourceId,
    operationId,
    expectedGeneration: operationToClaim.generation,
    expectedVersion: operationToClaim.version,
    executeAction: async (action) => {
      if (action.type !== Action.Type.INVOKE_FUNCTION) {
        throw new Error(
          `Persisted activity operation contains unsupported action type '${action.type}'.`,
        );
      }
      const activityName = action.function_name || options.activityName;
      const persistedContext = cloneJsonObject(
        operationToClaim.operation_config?.context,
        'Persisted activity context',
      );
      const context = cloneJsonObject(
        { ...persistedContext, ...attemptContext },
        'Activity execution context',
      );
      const rawOutputs = await options.execute({
        activityName,
        revisionId: operationToClaim.revision_id,
        event: cloneJsonValue(action.inputs, 'Activity event'),
        context,
      });
      const outputs =
        rawOutputs === undefined
          ? undefined
          : cloneJsonValue(rawOutputs, 'Activity result');
      return { ok: true, outputs };
    },
  });

  if (result.status !== 'COMPLETED') {
    const finalRecords = await options.store.getRecords(
      resourceId,
      operationId,
    );
    const failedAction = finalRecords.actions.find(
      (candidate) => candidate.status === ActionStatus.FAILED,
    );
    const message =
      typeof failedAction?.error?.message === 'string' &&
      failedAction.error.message.trim()
        ? failedAction.error.message.trim()
        : `Persisted activity ${resourceId}#${operationId} finished with status ${result.status}`;
    throw createOperationRunError(message, {
      resourceId,
      operationId,
      status: result.status,
    });
  }

  return {
    resourceId,
    operationId,
    status: 'COMPLETED',
    deduplicated: false,
  };
}

export default {
  createManifestActivityFunction,
  createOperationFromActivity,
  getAppResourceId,
  getManifestActivities,
  getManifestActivityDefinition,
  getManifestActivityNames,
  getManifestResourcesSpec,
  getQueueOperationId,
  invokeEmbeddedManifestActivity,
  invokeManifestActivity,
  runPersistedActivity,
};
