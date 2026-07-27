import { createHash, randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import WharfieFunction from '../resources/builds/function.js';
import FunctionResource from '../resources/builds/function-resource.js';
import { validateAppManifest } from './app-manifest.js';
import { getBuildTargetId, validateBuildTarget } from './build-target.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  validateApplicationRevision,
  validateDependencyLockInput,
} from './application-revision.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  validateActivityProtocolComponentFrame,
  validateActivityProtocolHostFrame,
} from './activity-protocol.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { validateEmbeddedRevisionRuntimePair } from '../resources/builds/lib/revision-runtime-assets.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {unknown} value - Candidate host cancellation signal.
 * @param {string} label - Human-readable option path.
 * @returns {void}
 */
function assertOptionalAbortSignal(value, label) {
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
 * @param {any} value - JSON-compatible value to freeze recursively.
 * @returns {any} - The same deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
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
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} keys - Exact supported keys.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertExactKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
}

/**
 * Validate and clone the author-facing invocation values. In particular,
 * callerMetadata is not a legacy mutable context: it becomes only
 * runtime.caller.metadata inside the Activity Protocol adapter.
 * @param {{ input?: any, callerMetadata?: any, deadlineUnixMs?: unknown }} options - Invocation values.
 * @returns {{ input: any, callerMetadata: Record<string, any>, deadlineUnixMs?: number }} - Strict JSON inputs.
 */
function cloneActivityAttemptInputs(options) {
  const input = cloneJsonValue(
    Object.prototype.hasOwnProperty.call(options, 'input') ? options.input : {},
    'Activity input',
  );
  const callerMetadata = cloneJsonObject(
    Object.prototype.hasOwnProperty.call(options, 'callerMetadata')
      ? options.callerMetadata
      : {},
    'Activity caller metadata',
  );
  if (!Object.prototype.hasOwnProperty.call(options, 'deadlineUnixMs')) {
    return { input, callerMetadata };
  }
  if (
    !Number.isSafeInteger(options.deadlineUnixMs) ||
    Number(options.deadlineUnixMs) <= 0
  ) {
    throw new TypeError(
      'deadlineUnixMs must be a positive safe integer when provided.',
    );
  }
  return {
    input,
    callerMetadata,
    deadlineUnixMs: Number(options.deadlineUnixMs),
  };
}

/**
 * Allocate fresh local-only identity for one physical activity attempt. These
 * values deliberately do not borrow durable run identity or fencing state;
 * this convenience path carries no recovery or idempotency claim.
 * @param {{ revisionId: string, activityName: string, input: any, callerMetadata: Record<string, any>, deadlineUnixMs?: number }} options - Bound invocation inputs.
 * @returns {Readonly<Record<string, any>>} - Validated immutable start frame.
 */
function createEphemeralActivityAttemptStart(options) {
  return validateActivityProtocolHostFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'start',
      revisionId: options.revisionId,
      activityId: options.activityName,
      runId: `local-run-${randomUUID()}`,
      invocationId: `local-invocation-${randomUUID()}`,
      attemptId: `local-attempt-${randomUUID()}`,
      fencingToken: `local-fence-${randomUUID()}`,
      input: options.input,
      caller: { metadata: options.callerMetadata },
      ...(options.deadlineUnixMs === undefined
        ? {}
        : { deadlineUnixMs: options.deadlineUnixMs }),
    },
    'local activity attempt start',
  );
}

/**
 * Validate the durable host frame supplied by a scheduler against the sealed
 * execution identity. The scheduler owns run/invocation/attempt/fence IDs;
 * this adapter only accepts a frame that names this exact activity revision.
 * @param {unknown} value - Host-owned candidate start frame.
 * @param {string} revisionId - Immutable execution revision.
 * @param {string} activityName - Declared activity ID.
 * @returns {Readonly<Record<string, any>>} - Validated immutable start frame.
 */
function validateBoundActivityAttemptStart(value, revisionId, activityName) {
  const start = validateActivityProtocolHostFrame(
    value,
    'manifest activity attempt start',
  );
  if (start.type !== 'start') {
    throw new TypeError(
      'manifest activity attempt start must have type start.',
    );
  }
  if (start.revisionId !== revisionId) {
    throw new Error(
      `manifest activity attempt start revision ${start.revisionId} does not match execution revision ${revisionId}.`,
    );
  }
  if (start.activityId !== activityName) {
    throw new Error(
      `manifest activity attempt start activity ${start.activityId} does not match requested activity ${activityName}.`,
    );
  }
  return start;
}

/**
 * A protocol attempt reached a genuine non-completed terminal. It is not a
 * transport crash or delivery uncertainty, both of which continue to reject
 * without inventing a user-visible application outcome.
 */
export class ActivityAttemptOutcomeError extends Error {
  /**
   * @param {Readonly<Record<string, any>>} evidence - Valid physical attempt evidence.
   */
  constructor(evidence) {
    const terminal = evidence.terminal;
    const error = terminal.error;
    super(error.message);
    this.name = error.name;
    this.code = error.code;
    this.details = error.details;
    this.terminalType = terminal.type;
    this.evidence = evidence;
  }
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
 * @param {any} manifest - Validated application manifest.
 * @returns {Record<string, any>} - Declared workflow definitions.
 */
export function getManifestWorkflows(manifest) {
  return isObjectRecord(manifest?.workflows) ? manifest.workflows : {};
}

/**
 * @param {any} manifest - Validated application manifest.
 * @returns {string[]} - Canonically ordered workflow names.
 */
export function getManifestWorkflowNames(manifest) {
  return Object.keys(getManifestWorkflows(manifest)).sort(
    compareCanonicalStrings,
  );
}

/**
 * @param {{manifest: any, workflowName: string}} options - Manifest lookup.
 * @returns {any | undefined} - Exact declared workflow definition.
 */
export function getManifestWorkflowDefinition(options) {
  assertLogicalId(options.workflowName, 'workflowName');
  return getManifestWorkflows(options.manifest)[options.workflowName];
}

/**
 * @param {unknown} value - Candidate complete source execution identity.
 * @returns {{ manifest: Record<string, any>, revision: import('./application-revision.js').ApplicationRevision, dependencyLock: { path: string, input: import('./application-revision.js').LockedInputDescriptor }, appDir: string, verifyRuntime: () => Promise<void> }} - Validated sealed source identity.
 */
function validatePreparedSourceExecution(value) {
  if (!isObjectRecord(value)) {
    throw new TypeError('Activity execution must be a prepared source handle.');
  }
  if (value.kind !== 'prepared-source') {
    throw new TypeError(
      "activity execution.kind must be 'prepared-source' for source execution.",
    );
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'prepared')) {
    throw new TypeError(
      'activity execution.prepared must be a complete prepared application revision.',
    );
  }
  assertExactKeys(value, ['kind', 'prepared'], 'activity execution');
  if (!isObjectRecord(value.prepared)) {
    throw new TypeError(
      'activity execution.prepared must be a complete prepared application revision.',
    );
  }
  const prepared = value.prepared;
  for (const key of [
    'revision',
    'appDir',
    'manifest',
    'assets',
    'dependencyLock',
    'verifyRuntime',
    'cleanup',
  ]) {
    if (!Object.prototype.hasOwnProperty.call(prepared, key)) {
      throw new TypeError(
        `activity execution.prepared.${key} is required on a prepared application revision.`,
      );
    }
  }
  if (
    typeof prepared.appDir !== 'string' ||
    !prepared.appDir ||
    !path.isAbsolute(prepared.appDir)
  ) {
    throw new TypeError(
      'activity execution.prepared.appDir must be an absolute sealed snapshot path.',
    );
  }
  if (
    typeof prepared.verifyRuntime !== 'function' ||
    typeof prepared.cleanup !== 'function'
  ) {
    throw new TypeError(
      'activity execution.prepared must retain its runtime verification and cleanup handles.',
    );
  }
  const source = validateSourceRevisionContext({
    manifest: prepared.manifest,
    appDir: prepared.appDir,
    sourceRevision: {
      revision: prepared.revision,
      dependencyLock: prepared.dependencyLock,
    },
  });
  return {
    ...source,
    appDir: prepared.appDir,
    verifyRuntime: prepared.verifyRuntime,
  };
}

/**
 * @param {unknown} value - Candidate embedded execution identity.
 * @returns {{ manifest: Record<string, any>, revision: import('./application-revision.js').ApplicationRevision, embeddedRevision: import('../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair }} - Validated embedded manifest/revision pair.
 */
function validateEmbeddedExecution(value) {
  if (!isObjectRecord(value)) {
    throw new TypeError('Activity execution must be an embedded identity.');
  }
  assertExactKeys(
    value,
    ['kind', 'manifest', 'embeddedRevision'],
    'activity execution',
  );
  if (value.kind !== 'embedded') {
    throw new TypeError(
      "activity execution.kind must be 'embedded' for packaged execution.",
    );
  }
  if (!isObjectRecord(value.embeddedRevision)) {
    throw new TypeError(
      'activity execution.embeddedRevision must contain embedded revision/runtime metadata.',
    );
  }
  const pair = validateEmbeddedRevisionRuntimePair(
    value.embeddedRevision.revision,
    value.embeddedRevision.runtime,
    'embedded activity execution',
  );
  const manifest = validateAppManifest(value.manifest, 'embedded manifest');
  const targetFreeManifest = { ...manifest };
  delete targetFreeManifest.targets;
  if (!hasSameCanonicalJson(targetFreeManifest, pair.revision.contract)) {
    throw new Error(
      'Embedded manifest does not match the immutable embedded application revision contract.',
    );
  }
  return { manifest, revision: pair.revision, embeddedRevision: pair };
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
    },
  });
}

/**
 * Build and execute one external-bearing activity from its sealed source
 * snapshot and dependency lock. The bundle runs the private attempt wrapper;
 * no legacy context or resource RPC is assembled on this path.
 * @param {{ manifest: Record<string, any>, revision: import('./application-revision.js').ApplicationRevision, dependencyLock: { path: string, input: import('./application-revision.js').LockedInputDescriptor }, appDir: string, activityName: string, startFrame: Readonly<Record<string, any>>, signal?: AbortSignal, onComponentFrame?: (frame: Readonly<Record<string, any>>) => unknown | Promise<unknown>, handleEffect?: (request: Readonly<Record<string, any>>, options: {signal: AbortSignal}) => unknown | Promise<unknown> }} options - Bound source attempt inputs.
 * @returns {Promise<Readonly<import('./activity-attempt.js').ActivityAttemptEvidence>>} - Revalidated physical attempt evidence.
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
  return await WharfieFunction.runPreparedActivityAttempt(
    options.activityName,
    { codeString, externalsTar, externalArchiveDigest },
    options.startFrame,
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.handleEffect === undefined
        ? {}
        : { handleEffect: options.handleEffect }),
      ...(options.onComponentFrame === undefined
        ? {}
        : { onComponentFrame: options.onComponentFrame }),
    },
  );
}

/**
 * @param {Record<string, any>} manifest - Valid manifest.
 * @param {string} activityName - Declared activity ID.
 * @returns {Record<string, any>} - Valid selected activity definition.
 */
function requireManifestActivityDefinition(manifest, activityName) {
  const definition = getManifestActivityDefinition({ manifest, activityName });
  if (!definition || !isObjectRecord(definition.entrypoint)) {
    const available = getManifestActivityNames(manifest);
    throw new Error(
      `Unknown activity '${activityName}'. Available activities: ${available.join(', ') || '(none)'}`,
    );
  }
  return definition;
}

/**
 * @param {Record<string, any>} options - Candidate invocation options.
 * @returns {void}
 */
function validateManifestActivityAttemptOptions(options) {
  if (!isObjectRecord(options)) {
    throw new TypeError('invokeManifestActivityAttempt requires options.');
  }
  const allowed = new Set([
    'activityName',
    'input',
    'callerMetadata',
    'deadlineUnixMs',
    'execution',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `invokeManifestActivityAttempt.${key} is not supported.`,
      );
    }
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'activityName')) {
    throw new TypeError(
      'invokeManifestActivityAttempt.activityName is required.',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(options, 'execution')) {
    throw new TypeError('invokeManifestActivityAttempt.execution is required.');
  }
  assertLogicalId(options.activityName, 'activityName');
}

/**
 * Validate an attempt invocation that already has its host-owned start frame.
 * @param {Record<string, any>} options - Candidate durable invocation options.
 * @returns {void}
 */
function validateManifestActivityAttemptWithStartOptions(options) {
  if (!isObjectRecord(options)) {
    throw new TypeError(
      'invokeManifestActivityAttemptWithStart requires options.',
    );
  }
  const allowed = new Set([
    'activityName',
    'startFrame',
    'execution',
    'signal',
    'handleEffect',
    'onComponentFrame',
  ]);
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `invokeManifestActivityAttemptWithStart.${key} is not supported.`,
      );
    }
  }
  for (const key of ['activityName', 'startFrame', 'execution']) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new TypeError(
        `invokeManifestActivityAttemptWithStart.${key} is required.`,
      );
    }
  }
  assertLogicalId(options.activityName, 'activityName');
  assertOptionalAbortSignal(
    options.signal,
    'invokeManifestActivityAttemptWithStart.signal',
  );
  if (
    options.handleEffect !== undefined &&
    typeof options.handleEffect !== 'function'
  ) {
    throw new TypeError(
      'invokeManifestActivityAttemptWithStart.handleEffect must be a function when provided.',
    );
  }
  if (
    options.onComponentFrame !== undefined &&
    typeof options.onComponentFrame !== 'function'
  ) {
    throw new TypeError(
      'invokeManifestActivityAttemptWithStart.onComponentFrame must be a function when provided.',
    );
  }
}

/**
 * Execute one prepared source attempt between two source-revision checks.
 * A local source snapshot is not immutable by itself: accepting an outcome
 * after its bytes drifted would falsely bind that work to the old revision.
 * @template T
 * @param {{ verifyRuntime: () => Promise<void> }} source - Sealed source handle.
 * @param {() => Promise<T>} execute - Attempt operation.
 * @returns {Promise<T>} - Verified operation result.
 */
async function executeVerifiedPreparedSourceAttempt(source, execute) {
  await source.verifyRuntime();

  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let executionFailure;
  try {
    result = await execute();
  } catch (cause) {
    executionFailure = cause;
  }

  try {
    await source.verifyRuntime();
  } catch (verificationFailure) {
    if (executionFailure) {
      throw new AggregateError(
        [executionFailure, verificationFailure],
        'The activity attempt failed and its prepared source revision changed while it ran.',
      );
    }
    throw verificationFailure;
  }
  if (executionFailure) throw executionFailure;
  return /** @type {T} */ (result);
}

/**
 * Resolve and validate a source or packaged execution identity once before
 * dispatching the physical activity attempt.
 * @param {unknown} execution - Candidate execution identity.
 * @returns {{kind: 'prepared-source', source: ReturnType<typeof validatePreparedSourceExecution>} | {kind: 'embedded', embedded: ReturnType<typeof validateEmbeddedExecution>}} - Resolved execution identity.
 */
function resolveManifestActivityAttemptExecution(execution) {
  if (isObjectRecord(execution) && execution.kind === 'embedded') {
    return { kind: 'embedded', embedded: validateEmbeddedExecution(execution) };
  }
  return {
    kind: 'prepared-source',
    source: validatePreparedSourceExecution(execution),
  };
}

/**
 * Validate and snapshot one source or packaged execution descriptor before a
 * durable host creates any ledger state. The physical executor receives only
 * this normalized descriptor, never a caller-owned object that could change
 * after preflight.
 * @param {unknown} execution - Candidate immutable execution descriptor.
 * @returns {Readonly<{identity: Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>, execution: {kind: 'prepared-source', prepared: import('../../cli/app/compile-application-revision.js').PreparedApplicationRevision} | {kind: 'embedded', manifest: any, embeddedRevision: import('../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair}}>} - Bound durable execution identity and normalized executor input.
 */
export function resolveManifestActivityExecutionBinding(execution) {
  const resolved = resolveManifestActivityAttemptExecution(execution);
  const manifest = deepFreeze(
    resolved.kind === 'embedded'
      ? resolved.embedded.manifest
      : resolved.source.manifest,
  );
  const revision =
    resolved.kind === 'embedded'
      ? resolved.embedded.revision
      : resolved.source.revision;
  const identity = Object.freeze({
    appId: manifest.app.id,
    revisionId: revision.revisionId,
    manifest,
  });
  if (resolved.kind === 'embedded') {
    return Object.freeze({
      identity,
      execution: Object.freeze({
        kind: /** @type {const} */ ('embedded'),
        manifest: resolved.embedded.manifest,
        embeddedRevision: resolved.embedded.embeddedRevision,
      }),
    });
  }

  const candidate = /** @type {Record<string, any>} */ (execution);
  const prepared = candidate.prepared;
  return Object.freeze({
    identity,
    execution: Object.freeze({
      kind: /** @type {const} */ ('prepared-source'),
      prepared: Object.freeze({
        revision: resolved.source.revision,
        appDir: resolved.source.appDir,
        manifest: resolved.source.manifest,
        assets: Object.freeze({ ...prepared.assets }),
        dependencyLock: resolved.source.dependencyLock,
        verifyRuntime: resolved.source.verifyRuntime,
        cleanup: prepared.cleanup,
      }),
    }),
  });
}

/**
 * Return only the immutable app/revision identity for callers that do not
 * retain a physical executor binding.
 * @param {unknown} execution - Candidate immutable execution descriptor.
 * @returns {Readonly<{appId: string, revisionId: string, manifest: Record<string, any>}>} - Bound durable execution identity.
 */
export function resolveManifestActivityExecutionIdentity(execution) {
  return resolveManifestActivityExecutionBinding(execution).identity;
}

/**
 * Dispatch one physical attempt after its host start frame has been bound to
 * the selected immutable execution identity.
 * @param {{kind: 'prepared-source', source: ReturnType<typeof validatePreparedSourceExecution>} | {kind: 'embedded', embedded: ReturnType<typeof validateEmbeddedExecution>}} execution - Resolved execution identity.
 * @param {string} activityName - Declared activity ID.
 * @param {Readonly<Record<string, any>>} startFrame - Exact host-owned start frame.
 * @param {{signal?: AbortSignal, onComponentFrame?: (frame: Readonly<Record<string, any>>) => unknown | Promise<unknown>, handleEffect?: (request: Readonly<Record<string, any>>, options: {signal: AbortSignal}) => unknown | Promise<unknown>}} [options] - Trusted host-owned attempt controls.
 * @returns {Promise<Readonly<import('./activity-attempt.js').ActivityAttemptEvidence>>} - Physical attempt evidence.
 */
async function dispatchManifestActivityAttempt(
  execution,
  activityName,
  startFrame,
  options = {},
) {
  if (execution.kind === 'embedded') {
    const { embedded } = execution;
    requireManifestActivityDefinition(embedded.manifest, activityName);
    return await WharfieFunction.runActivityAttempt(
      activityName,
      startFrame,
      options,
    );
  }

  const { source } = execution;
  return await executeVerifiedPreparedSourceAttempt(source, async () => {
    const definition = requireManifestActivityDefinition(
      source.manifest,
      activityName,
    );
    assertSourceRuntimeResolution(
      path.resolve(source.appDir, definition.entrypoint.path),
    );
    const hasExternalPackages =
      Array.isArray(definition.externalPackages) &&
      definition.externalPackages.length > 0;
    if (hasExternalPackages) {
      return await invokePreparedSourceExternalActivity({
        ...source,
        activityName,
        startFrame,
        ...options,
      });
    }
    const fn = createManifestActivityFunction({
      manifest: source.manifest,
      activityName,
      appDir: source.appDir,
    });
    return await fn.runActivityAttempt(startFrame, options);
  });
}

/**
 * Dispatch a physical Protocol v1 attempt from a durable host-owned start
 * frame. This is the narrow scheduler seam: the frame must name the selected
 * revision and activity, but its run/invocation/attempt/fence identity is not
 * regenerated or otherwise changed by the runtime.
 * @param {{ activityName: string, startFrame: Record<string, any>, signal?: AbortSignal, onComponentFrame?: (frame: Readonly<Record<string, any>>) => unknown | Promise<unknown>, handleEffect?: (request: Readonly<Record<string, any>>, options: {signal: AbortSignal}) => unknown | Promise<unknown>, execution: { kind: 'prepared-source', prepared: import('../../cli/app/compile-application-revision.js').PreparedApplicationRevision } | { kind: 'embedded', manifest: any, embeddedRevision: import('../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair } }} options - Durable invocation options.
 * @returns {Promise<Readonly<import('./activity-attempt.js').ActivityAttemptEvidence>>} - Physical attempt evidence.
 */
export async function invokeManifestActivityAttemptWithStart(options) {
  validateManifestActivityAttemptWithStartOptions(options);
  const execution = resolveManifestActivityAttemptExecution(options.execution);
  const revisionId =
    execution.kind === 'embedded'
      ? execution.embedded.revision.revisionId
      : execution.source.revision.revisionId;
  const startFrame = validateBoundActivityAttemptStart(
    options.startFrame,
    revisionId,
    options.activityName,
  );
  return await dispatchManifestActivityAttempt(
    execution,
    options.activityName,
    startFrame,
    {
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.handleEffect === undefined
        ? {}
        : { handleEffect: options.handleEffect }),
      ...(options.onComponentFrame === undefined
        ? {}
        : { onComponentFrame: options.onComponentFrame }),
    },
  );
}

/**
 * Execute one source or packaged activity as exactly one bounded physical
 * Activity Protocol attempt. The returned evidence is not a durable result;
 * callers that want a value must explicitly unwrap only a completed terminal.
 * @param {{ activityName: string, input?: any, callerMetadata?: Record<string, any>, deadlineUnixMs?: number, execution: { kind: 'prepared-source', prepared: import('../../cli/app/compile-application-revision.js').PreparedApplicationRevision } | { kind: 'embedded', manifest: any, embeddedRevision: import('../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair } }} options - Bound invocation options.
 * @returns {Promise<Readonly<import('./activity-attempt.js').ActivityAttemptEvidence>>} - Physical attempt evidence.
 */
export async function invokeManifestActivityAttempt(options) {
  validateManifestActivityAttemptOptions(options);
  const execution = resolveManifestActivityAttemptExecution(options.execution);
  const revisionId =
    execution.kind === 'embedded'
      ? execution.embedded.revision.revisionId
      : execution.source.revision.revisionId;
  const invocation = cloneActivityAttemptInputs(options);
  const startFrame = createEphemeralActivityAttemptStart({
    revisionId,
    activityName: options.activityName,
    ...invocation,
  });
  return await dispatchManifestActivityAttempt(
    execution,
    options.activityName,
    startFrame,
  );
}

/**
 * Execute one embedded manifest activity as a physical Protocol v1 attempt.
 * @param {Record<string, any>} options - Invocation options with embedded execution identity.
 * @returns {Promise<Readonly<import('./activity-attempt.js').ActivityAttemptEvidence>>} - Physical attempt evidence.
 */
export async function invokeEmbeddedManifestActivityAttempt(options) {
  validateManifestActivityAttemptOptions(options);
  const embedded = validateEmbeddedExecution(options.execution);
  const invocation = cloneActivityAttemptInputs(options);
  const startFrame = createEphemeralActivityAttemptStart({
    revisionId: embedded.revision.revisionId,
    activityName: options.activityName,
    ...invocation,
  });
  return await dispatchManifestActivityAttempt(
    { kind: 'embedded', embedded },
    options.activityName,
    startFrame,
  );
}

/**
 * Return only a successful physical attempt result. All other protocol
 * terminals remain structured errors, preserving their status and evidence.
 * @param {Readonly<Record<string, any>>} evidence - Physical attempt evidence.
 * @returns {any} - Independently cloned completed result.
 */
export function unwrapCompletedActivityAttempt(evidence) {
  if (!isObjectRecord(evidence) || !isObjectRecord(evidence.terminal)) {
    throw new TypeError('Activity attempt evidence has no terminal frame.');
  }
  const terminal = validateActivityProtocolComponentFrame(
    evidence.terminal,
    'Activity attempt terminal',
  );
  if (terminal.type === 'completed') {
    return cloneJsonValue(terminal.result, 'Activity result');
  }
  if (
    !['failed', 'cancelled', 'deadline-exceeded', 'protocol-failed'].includes(
      terminal.type,
    )
  ) {
    throw new TypeError('Activity attempt evidence has an invalid terminal.');
  }
  const frozenEvidence = deepFreeze({
    ...evidence,
    terminal,
  });
  throw new ActivityAttemptOutcomeError(frozenEvidence);
}

/**
 * Value-returning convenience API for one local physical attempt.
 * @param {Parameters<typeof invokeManifestActivityAttempt>[0]} options - Bound invocation options.
 * @returns {Promise<any>} - Completed JSON result.
 */
export async function invokeManifestActivity(options) {
  return unwrapCompletedActivityAttempt(
    await invokeManifestActivityAttempt(options),
  );
}

export default {
  createManifestActivityFunction,
  getManifestActivities,
  getManifestActivityDefinition,
  getManifestActivityNames,
  getManifestWorkflowDefinition,
  getManifestWorkflowNames,
  getManifestWorkflows,
  ActivityAttemptOutcomeError,
  invokeEmbeddedManifestActivityAttempt,
  invokeManifestActivity,
  invokeManifestActivityAttempt,
  invokeManifestActivityAttemptWithStart,
  resolveManifestActivityExecutionBinding,
  resolveManifestActivityExecutionIdentity,
  unwrapCompletedActivityAttempt,
};
