import path from 'node:path';

import {
  getBuildTargetId,
  validateBuildTarget,
} from '../../core/runtime/build-target.js';
import {
  validateApplicationRevision,
  validateSha256Digest,
} from '../../core/runtime/application-revision.js';
import { validateArtifactRecordObservation } from '../../core/runtime/artifact-record.js';
import {
  createDeploymentRevisionFromArtifactObservation,
  validateDeploymentRevision,
} from '../../core/runtime/deployment-revision.js';
import { validateDeploymentProfile } from '../../core/runtime/deployment-profile.js';
import { validateProviderScope } from '../../core/runtime/deployment-provider-scope.js';
import { cloneJsonObject } from '../../core/runtime/json-value.js';
import { openHeldArtifactSource } from '../../core/runtime/packaged-artifact.js';

import { packageLocalApp } from './local-app.js';

const MINT_KEYS = new Set(['dir', 'outputDir', 'target', 'build']);
const MINT_REQUIRED_KEYS = new Set(['dir', 'target']);
const BUILD_KEYS = new Set(['signing', 'assets']);
const SIGNING_KEYS = new Set(['macos']);
const MACOS_SIGNING_KEYS = new Set([
  'certificateBase64',
  'certificatePassword',
  'keychainPassword',
]);
const PACKAGE_RESULT_KEYS = new Set([
  'app',
  'revision',
  'targets',
  'outputDir',
  'artifacts',
]);
const PACKAGE_APP_KEYS = new Set(['id']);
const PACKAGE_ARTIFACT_KEYS = new Set([
  'fileName',
  'path',
  'recordPath',
  'target',
  'artifactId',
  'revisionId',
  'byteDigest',
  'size',
  'record',
]);
const REVISION_INPUT_KEYS = new Set(['deployment', 'profile']);
const CLAIM_KEYS = new Set(['deploymentRevision', 'profile', 'providerScope']);
const INVALID_MINT_REQUEST =
  'Selected SEA artifact package request is invalid.';
const INVALID_PACKAGE_RESULT = 'Fresh selected SEA package result is invalid.';
const INVALID_AUTHORITY = 'Selected SEA artifact authority is invalid.';
const UNAVAILABLE_AUTHORITY =
  'Selected SEA artifact authority is no longer available.';
const UNBOUND_AUTHORITY =
  'Selected SEA artifact authority has no bound deployment revision.';
const BINDING_CONFLICT =
  'Selected SEA artifact authority is already bound to a different deployment revision.';
const CLAIM_CONFLICT =
  'Selected SEA artifact claim does not match its bound deployment authority.';
const MINT_AND_CLEANUP_FAILED =
  'Selected SEA artifact minting and descriptor cleanup both failed.';

/**
 * Private state is reachable only through the exact opaque object returned by
 * this module's closed packaging path.
 * @type {WeakMap<object, {
 *   status: 'ready'|'claimed'|'closed',
 *   revision: Readonly<Record<string, any>>,
 *   runtime: Readonly<Record<string, any>>,
 *   record: Readonly<Record<string, any>>,
 *   source: Readonly<Record<string, any>>,
 *   binding?: {
 *     deploymentRevision: Readonly<Record<string, any>>,
 *     profile: Readonly<Record<string, any>>
 *   },
 *   closePromise?: Promise<void>
 * }>}
 */
const authorityState = new WeakMap();

/**
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, any>} - Whether the value is plain.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Snapshot one exact plain object through own data descriptors.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} supportedKeys - Complete supported key set.
 * @param {Set<string>} requiredKeys - Required key subset.
 * @param {string} message - Fixed failure.
 * @returns {Readonly<Record<string, any>>} - Stable shallow snapshot.
 */
function snapshotExactObject(value, supportedKeys, requiredKeys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((key) => typeof key !== 'string' || !supportedKeys.has(key)) ||
    requiredKeys.size > ownKeys.length
  ) {
    throw new TypeError(message);
  }
  /** @type {Record<string, any>} */
  const snapshot = Object.create(null);
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
    snapshot[key] = descriptor.value;
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(snapshot, key)) throw new TypeError(message);
  }
  return Object.freeze(snapshot);
}

/**
 * Snapshot a dense ordinary array without invoking index accessors.
 * @param {unknown} value - Candidate array.
 * @param {string} message - Fixed failure.
 * @returns {Readonly<any[]>} - Stable shallow elements.
 */
function snapshotExactArray(value, message) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw new TypeError(message);
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (
    !lengthDescriptor ||
    !Object.hasOwn(lengthDescriptor, 'value') ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new TypeError(message);
  }
  const length = lengthDescriptor.value;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== length + 1) throw new TypeError(message);
  const snapshot = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
    snapshot.push(descriptor.value);
  }
  if (
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        (key !== 'length' &&
          (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)),
    )
  ) {
    throw new TypeError(message);
  }
  return Object.freeze(snapshot);
}

/**
 * Snapshot a dynamic string mapping without invoking accessors.
 * @param {unknown} value - Candidate mapping.
 * @param {string} message - Fixed failure.
 * @returns {Readonly<Record<string, string>>} - Stable mapping.
 */
function snapshotStringMap(value, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  /** @type {Record<string, string>} */
  const snapshot = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      typeof key !== 'string' ||
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string' ||
      descriptor.value.length === 0
    ) {
      throw new TypeError(message);
    }
    snapshot[key] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/**
 * Snapshot the optional ephemeral packaging config before packageLocalApp
 * crosses an await. Dynamic asset functions are captured by identity; ordinary
 * asset maps and signing credentials are independently copied and frozen.
 * @param {unknown} value - Candidate build config.
 * @returns {Readonly<Record<string, any>>} - Stable build config.
 */
function snapshotBuildConfig(value) {
  const build = snapshotExactObject(
    value,
    BUILD_KEYS,
    new Set(),
    INVALID_MINT_REQUEST,
  );
  let assets;
  if (Object.hasOwn(build, 'assets')) {
    assets =
      typeof build.assets === 'function'
        ? build.assets
        : snapshotStringMap(build.assets, INVALID_MINT_REQUEST);
  }
  let signing;
  if (Object.hasOwn(build, 'signing')) {
    const signingInput = snapshotExactObject(
      build.signing,
      SIGNING_KEYS,
      new Set(),
      INVALID_MINT_REQUEST,
    );
    let macos;
    if (Object.hasOwn(signingInput, 'macos')) {
      const macosInput = snapshotExactObject(
        signingInput.macos,
        MACOS_SIGNING_KEYS,
        new Set(),
        INVALID_MINT_REQUEST,
      );
      /** @type {Record<string, string>} */
      const copied = {};
      for (const [key, credential] of Object.entries(macosInput)) {
        if (typeof credential !== 'string') {
          throw new TypeError(INVALID_MINT_REQUEST);
        }
        copied[key] = credential;
      }
      macos = Object.freeze(copied);
    }
    signing = Object.freeze({
      ...(macos === undefined ? {} : { macos }),
    });
  }
  return Object.freeze({
    ...(signing === undefined ? {} : { signing }),
    ...(assets === undefined ? {} : { assets }),
  });
}

/**
 * @param {unknown} left - First canonical JSON value.
 * @param {unknown} right - Second canonical JSON value.
 * @returns {boolean} - Whether their exact encodings match.
 */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Look up an opaque token without inspecting it. In particular, a Proxy key
 * cannot trigger its traps merely by being rejected as unbranded.
 * @param {unknown} authority - Candidate token.
 * @returns {Record<string, any>} - Private state.
 */
function getAuthorityState(authority) {
  if (
    (typeof authority !== 'object' && typeof authority !== 'function') ||
    authority === null
  ) {
    throw new TypeError(INVALID_AUTHORITY);
  }
  const state = authorityState.get(authority);
  if (!state) throw new TypeError(INVALID_AUTHORITY);
  return state;
}

/**
 * Validate and snapshot public package selection before build work begins.
 * @param {unknown} value - Candidate request.
 * @returns {Readonly<{dir: string, outputDir?: string, target: Readonly<Record<string, any>>, build?: Record<string, any>}>} - Canonical request.
 */
function validateMintRequest(value) {
  const request = snapshotExactObject(
    value,
    MINT_KEYS,
    MINT_REQUIRED_KEYS,
    INVALID_MINT_REQUEST,
  );
  if (
    typeof request.dir !== 'string' ||
    request.dir.length === 0 ||
    request.dir.trim() !== request.dir ||
    (Object.hasOwn(request, 'outputDir') &&
      (typeof request.outputDir !== 'string' ||
        request.outputDir.length === 0 ||
        request.outputDir.trim() !== request.outputDir))
  ) {
    throw new TypeError(INVALID_MINT_REQUEST);
  }
  let target;
  let build;
  try {
    target = Object.freeze(
      validateBuildTarget(request.target, 'selectedSea target'),
    );
    if (Object.hasOwn(request, 'build')) {
      build = snapshotBuildConfig(request.build);
    }
  } catch {
    throw new TypeError(INVALID_MINT_REQUEST);
  }
  return Object.freeze({
    dir: path.resolve(request.dir),
    ...(Object.hasOwn(request, 'outputDir')
      ? { outputDir: path.resolve(request.outputDir) }
      : {}),
    target,
    ...(build === undefined ? {} : { build }),
  });
}

/**
 * Capture the immediate result of the closed package call before awaiting any
 * other operation.
 * @param {unknown} value - Fresh package result.
 * @param {Readonly<Record<string, any>>} requestedTarget - Exact selected target.
 * @param {string} expectedOutputDir - Exact resolved package destination.
 * @returns {{revision: Readonly<Record<string, any>>, summary: Readonly<Record<string, any>>}} - Trusted fresh projections.
 */
function captureFreshPackageResult(value, requestedTarget, expectedOutputDir) {
  const result = snapshotExactObject(
    value,
    PACKAGE_RESULT_KEYS,
    PACKAGE_RESULT_KEYS,
    INVALID_PACKAGE_RESULT,
  );
  const app = snapshotExactObject(
    result.app,
    PACKAGE_APP_KEYS,
    PACKAGE_APP_KEYS,
    INVALID_PACKAGE_RESULT,
  );
  const targets = snapshotExactArray(result.targets, INVALID_PACKAGE_RESULT);
  const artifacts = snapshotExactArray(
    result.artifacts,
    INVALID_PACKAGE_RESULT,
  );
  if (
    typeof result.outputDir !== 'string' ||
    result.outputDir.length === 0 ||
    path.resolve(result.outputDir) !== result.outputDir ||
    result.outputDir !== expectedOutputDir ||
    targets.length !== 1 ||
    artifacts.length !== 1
  ) {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }

  let revision;
  let target;
  let summary;
  try {
    revision = validateApplicationRevision(
      result.revision,
      'selectedSea package revision',
    );
    target = validateBuildTarget(
      targets[0],
      'selectedSea package selected target',
    );
    summary = snapshotExactObject(
      artifacts[0],
      PACKAGE_ARTIFACT_KEYS,
      PACKAGE_ARTIFACT_KEYS,
      INVALID_PACKAGE_RESULT,
    );
  } catch {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }

  if (
    typeof app.id !== 'string' ||
    app.id !== revision.contract.app.id ||
    getBuildTargetId(target) !== getBuildTargetId(requestedTarget) ||
    typeof summary.fileName !== 'string' ||
    summary.fileName.length === 0 ||
    typeof summary.path !== 'string' ||
    summary.path.length === 0 ||
    typeof summary.recordPath !== 'string' ||
    summary.recordPath.length === 0 ||
    summary.path !== path.join(result.outputDir, summary.fileName) ||
    path.dirname(summary.path) !== result.outputDir ||
    path.basename(summary.path) !== summary.fileName ||
    summary.recordPath !== `${summary.path}.artifact.json`
  ) {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }

  let summaryTarget;
  let summaryDigest;
  let record;
  try {
    summaryTarget = Object.freeze(
      validateBuildTarget(
        summary.target,
        'selectedSea package artifact target',
      ),
    );
    summaryDigest = Object.freeze(
      validateSha256Digest(
        summary.byteDigest,
        'selectedSea package artifact byteDigest',
      ),
    );
    record = cloneJsonObject(
      summary.record,
      'selectedSea package artifact record snapshot',
    );
  } catch {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }
  if (getBuildTargetId(summaryTarget) !== getBuildTargetId(requestedTarget)) {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }

  return {
    revision,
    summary: Object.freeze({
      fileName: summary.fileName,
      path: summary.path,
      recordPath: summary.recordPath,
      target: summaryTarget,
      artifactId: summary.artifactId,
      revisionId: summary.revisionId,
      byteDigest: summaryDigest,
      size: summary.size,
      record,
    }),
  };
}

/**
 * Finish validating one held descriptor against the fresh generation-backed
 * package record.
 * @param {{revision: Readonly<Record<string, any>>, summary: Readonly<Record<string, any>>}} captured - Immediate package projections.
 * @param {Readonly<Record<string, any>>} source - Held descriptor source.
 * @param {Readonly<Record<string, any>>} requestedTarget - Exact requested target.
 * @returns {{revision: Readonly<Record<string, any>>, runtime: Readonly<Record<string, any>>, record: Readonly<Record<string, any>>}} - Canonical authority evidence.
 */
function validateHeldPackageArtifact(captured, source, requestedTarget) {
  let record;
  try {
    record = validateArtifactRecordObservation(
      captured.summary.record,
      {
        observation: source.observation,
        revision: captured.revision,
      },
      'selectedSea package artifact record',
    );
  } catch {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }
  if (
    getBuildTargetId(record.target) !== getBuildTargetId(requestedTarget) ||
    getBuildTargetId(captured.summary.target) !==
      getBuildTargetId(record.target) ||
    captured.summary.artifactId !== record.artifactId ||
    captured.summary.revisionId !== record.revisionId ||
    captured.summary.byteDigest.algorithm !== record.byteDigest.algorithm ||
    captured.summary.byteDigest.value !== record.byteDigest.value ||
    captured.summary.size !== record.size
  ) {
    throw new TypeError(INVALID_PACKAGE_RESULT);
  }
  return {
    revision: captured.revision,
    runtime: Object.freeze({
      schemaVersion: 1,
      kind: 'artifactRuntime',
      appId: record.appId,
      revisionId: record.revisionId,
      target: record.target,
    }),
    record,
  };
}

/**
 * Preserve the primary mint failure while closing the otherwise unowned
 * descriptor.
 * @param {Readonly<Record<string, any>>} source - Held source.
 * @param {unknown} primaryError - Primary failure.
 * @returns {Promise<never>} - Always rejects.
 */
async function rejectAfterSourceCleanup(source, primaryError) {
  /** @type {unknown} */
  let cleanupError;
  let cleanupFailed = false;
  try {
    await Reflect.apply(source.close, source, []);
  } catch (error) {
    cleanupFailed = true;
    cleanupError = error;
  }
  if (cleanupFailed) {
    throw new AggregateError(
      [primaryError, cleanupError],
      MINT_AND_CLEANUP_FAILED,
    );
  }
  throw primaryError;
}

/**
 * Package and retain one exact selected SEA.
 * @param {Readonly<{dir: string, outputDir?: string, target: Readonly<Record<string, any>>, build?: Record<string, any>}>} request - Canonical request.
 * @returns {Promise<Readonly<Record<string, never>>>} - Opaque authority token.
 */
async function mintSelectedSeaArtifactAuthority(request) {
  const libcSuffix =
    typeof request.target.libc === 'string' ? `-${request.target.libc}` : '';
  const targetFilter = `node${request.target.nodeVersion}-${request.target.platform}-${request.target.architecture}${libcSuffix}`;
  const targetFilters = Object.freeze([targetFilter]);
  const expectedOutputDir = path.resolve(
    request.outputDir ?? path.join(request.dir, 'dist'),
  );
  const result = await packageLocalApp(
    /** @type {any} */ (
      Object.freeze({
        dir: request.dir,
        ...(request.outputDir === undefined
          ? {}
          : { outputDir: request.outputDir }),
        targetFilters,
        ...(Object.hasOwn(request, 'build') ? { build: request.build } : {}),
      })
    ),
  );

  // This synchronous capture deliberately occurs before the descriptor-opening
  // await. No mutable package summary escapes to another caller first.
  const captured = captureFreshPackageResult(
    result,
    request.target,
    expectedOutputDir,
  );
  const source = await openHeldArtifactSource(captured.summary.path);
  let evidence;
  try {
    evidence = validateHeldPackageArtifact(captured, source, request.target);
  } catch (error) {
    return await rejectAfterSourceCleanup(source, error);
  }

  const authority = /** @type {Readonly<Record<string, never>>} */ (
    Object.freeze(Object.create(null))
  );
  authorityState.set(authority, {
    status: 'ready',
    revision: evidence.revision,
    runtime: evidence.runtime,
    record: evidence.record,
    source,
  });
  return authority;
}

/**
 * Package exactly one requested target and mint an opaque in-process
 * authority over its retained descriptor.
 * @param {unknown} value - Exact dir, optional output/build, and target.
 * @returns {Promise<Readonly<Record<string, never>>>} - Opaque authority.
 */
export async function packageSelectedSeaArtifact(value) {
  return mintSelectedSeaArtifactAuthority(validateMintRequest(value));
}

/**
 * Return non-authorizing selected artifact identity for display and profile
 * construction.
 * @param {unknown} authority - Opaque selected-SEA authority.
 * @returns {Readonly<Record<string, any>>} - Canonical public summary.
 */
export function inspectSelectedSeaArtifact(authority) {
  const state = getAuthorityState(authority);
  if (state.status !== 'ready') throw new Error(UNAVAILABLE_AUTHORITY);
  return Object.freeze({
    appId: state.record.appId,
    revisionId: state.record.revisionId,
    artifactId: state.record.artifactId,
    byteDigest: state.record.byteDigest,
    size: state.record.size,
    target: state.record.target,
  });
}

/**
 * Bind this authority to one deployment/profile tuple and create its
 * serialized deployment revision from the same held-byte observation.
 * @param {unknown} authority - Opaque selected-SEA authority.
 * @param {unknown} value - Exact deployment and profile.
 * @returns {Readonly<Record<string, any>>} - Bound deployment revision.
 */
export function createSelectedSeaDeploymentRevision(authority, value) {
  const state = getAuthorityState(authority);
  if (state.status !== 'ready') throw new Error(UNAVAILABLE_AUTHORITY);
  const input = snapshotExactObject(
    value,
    REVISION_INPUT_KEYS,
    REVISION_INPUT_KEYS,
    INVALID_AUTHORITY,
  );
  const profile = validateDeploymentProfile(
    input.profile,
    'selectedSea deployment profile',
  );
  const deploymentRevision = createDeploymentRevisionFromArtifactObservation(
    input,
    {
      revision: state.revision,
      runtime: state.runtime,
      artifact: state.source.observation,
    },
  );
  if (state.binding) {
    if (
      !sameJson(state.binding.deploymentRevision, deploymentRevision) ||
      !sameJson(state.binding.profile, profile)
    ) {
      throw new Error(BINDING_CONFLICT);
    }
    return state.binding.deploymentRevision;
  }
  state.binding = { deploymentRevision, profile };
  return deploymentRevision;
}

/**
 * Atomically transfer the exact held source after validating its complete
 * deployment authority. This function has no await: two same-tick claims
 * cannot both observe the ready state.
 * @param {unknown} authority - Opaque selected-SEA authority.
 * @param {unknown} value - Exact deployment revision, profile, and scope.
 * @returns {Readonly<{deploymentRevision: Readonly<Record<string, any>>, profile: Readonly<Record<string, any>>, providerScope: Readonly<Record<string, any>>, source: Readonly<Record<string, any>>, revision: Readonly<Record<string, any>>, runtime: Readonly<Record<string, any>>, record: Readonly<Record<string, any>>}>} - Complete transferred staging bundle.
 */
export function claimSelectedSeaArtifactSource(authority, value) {
  const state = getAuthorityState(authority);
  if (state.status !== 'ready') throw new Error(UNAVAILABLE_AUTHORITY);
  if (!state.binding) throw new Error(UNBOUND_AUTHORITY);
  const claim = snapshotExactObject(
    value,
    CLAIM_KEYS,
    CLAIM_KEYS,
    CLAIM_CONFLICT,
  );
  const deploymentRevision = validateDeploymentRevision(
    claim.deploymentRevision,
    'selectedSea claim deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    claim.profile,
    'selectedSea claim profile',
  );
  const providerScope = validateProviderScope(
    claim.providerScope,
    'selectedSea claim providerScope',
  );
  if (
    !sameJson(deploymentRevision, state.binding.deploymentRevision) ||
    !sameJson(profile, state.binding.profile) ||
    profile.provider.kind !== providerScope.provider ||
    profile.provider.scope.region !== providerScope.region
  ) {
    throw new Error(CLAIM_CONFLICT);
  }

  state.status = 'claimed';
  return Object.freeze({
    deploymentRevision: state.binding.deploymentRevision,
    profile: state.binding.profile,
    providerScope,
    source: state.source,
    revision: state.revision,
    runtime: state.runtime,
    record: state.record,
  });
}

/**
 * Deterministically close an authority that was never transferred. Repeated
 * discard returns one stable close promise.
 * @param {unknown} authority - Opaque selected-SEA authority.
 * @returns {Promise<void>} - Stable close result.
 */
export function discardSelectedSeaArtifact(authority) {
  const state = getAuthorityState(authority);
  if (state.status === 'claimed') throw new Error(UNAVAILABLE_AUTHORITY);
  if (state.closePromise) return state.closePromise;
  state.status = 'closed';
  state.closePromise = Promise.resolve().then(
    async () => await Reflect.apply(state.source.close, state.source, []),
  );
  return state.closePromise;
}

export default {
  claimSelectedSeaArtifactSource,
  createSelectedSeaDeploymentRevision,
  discardSelectedSeaArtifact,
  inspectSelectedSeaArtifact,
  packageSelectedSeaArtifact,
};
