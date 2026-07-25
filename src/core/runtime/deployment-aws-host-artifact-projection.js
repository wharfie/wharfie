/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This privileged adapter deliberately keeps its exact injected host seams and V66 port types inline. */

import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sortCanonicalJsonValue } from './canonical-order.js';
import { validateAwsSingleNodeHostActivationRequest } from './deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from './deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
  decodeAwsSingleNodeManagedArtifactHead,
} from './deployment-aws-managed-artifact-evidence.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT =
  '/opt/wharfie/app/v1';
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND =
  'awsSingleNodeHostArtifactProjectionEvidence';
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_MAX_BYTES =
  16 * 1024;
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_RECORD_MAX_BYTES =
  24 * 1024;
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_DEFAULT_TIMEOUT_MILLISECONDS =
  5 * 60_000;
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_TIMEOUT_MILLISECONDS =
  15 * 60_000;
export const AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES = 128;

const ARTIFACT_PROJECTION_STEP = 'artifact-projection';
const ARTIFACT_FILE_NAME = 'app';
const PROJECTION_RECORD_FILE_NAME = 'projection.json';
const NAMESPACE_DIRECTORY_MODE = 0o750;
const TEMPORARY_DIRECTORY_MODE = 0o700;
const ARTIFACT_FILE_MODE = 0o550;
const PROJECTION_RECORD_FILE_MODE = 0o440;
const DOWNLOAD_FILE_MODE = 0o600;
const BODY_RELEASE_TIMEOUT_MILLISECONDS = 100;
const REQUEST_DIRECTORY_PATTERN = /^whaq1_[A-Za-z0-9_-]{43}$/u;
const TEMPORARY_DIRECTORY_PATTERN = /^\.(whaq1_[A-Za-z0-9_-]{43})\.tmp$/u;
const FACTORY_KEYS = new Set([
  'client',
  'runtimeGid',
  'root',
  'expectedUid',
  'fsOps',
  'attemptTimeoutMilliseconds',
  'testOnlyRoot',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'runtimeGid']);
const CLIENT_KEYS = new Set(['getObject']);
const CONTEXT_KEYS = new Set(['request', 'step', 'priorEvidence']);
const STEP_KEYS = new Set(['intentId', 'kind', 'attemptGeneration']);
const PRIOR_EVIDENCE_KEYS = new Set([
  'runtime-identity',
  'application-storage',
  'control-storage',
]);
const EVIDENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'requestId',
  'deploymentInstanceId',
  'appId',
  'artifactId',
  'revisionId',
  'targetId',
  'contentLength',
  'byteDigest',
  'artifactPath',
]);
const REQUIRED_FS_METHODS = Object.freeze([
  'lstat',
  'mkdir',
  'chown',
  'chmod',
  'open',
  'opendir',
  'rename',
  'rm',
]);
const FIXED_ARTIFACT_STORAGE = Object.freeze({
  contractVersion: 1,
  storage: 's3-object',
  encryption: 'AES256',
  onDestroy: 'purge',
});

/** Local durable projection exists but violates its immutable envelope. */
export class AwsSingleNodeHostArtifactProjectionConflictError extends Error {
  constructor() {
    super(
      'AWS single-node host artifact projection conflicts with its contract.',
    );
    this.name = 'AwsSingleNodeHostArtifactProjectionConflictError';
    this.code = 'AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_CONFLICT';
  }
}

/** Exact artifact state could not be established from current local evidence. */
export class AwsSingleNodeHostArtifactProjectionUnknownError extends Error {
  constructor() {
    super('AWS single-node host artifact projection state is unknown.');
    this.name = 'AwsSingleNodeHostArtifactProjectionUnknownError';
    this.code = 'AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_UNKNOWN';
  }
}

/** The bounded S3 header/body operation exceeded its fixed deadline. */
export class AwsSingleNodeHostArtifactProjectionTimeoutError extends Error {
  constructor() {
    super('AWS single-node host artifact download timed out.');
    this.name = 'AwsSingleNodeHostArtifactProjectionTimeoutError';
    this.code = 'AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_TIMEOUT';
  }
}

/** @param {unknown} error @returns {Error} */
function safeProjectionError(error) {
  if (
    error instanceof AwsSingleNodeHostArtifactProjectionConflictError ||
    error instanceof AwsSingleNodeHostArtifactProjectionUnknownError ||
    error instanceof AwsSingleNodeHostArtifactProjectionTimeoutError
  ) {
    return error;
  }
  return new AwsSingleNodeHostArtifactProjectionUnknownError();
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertSupportedKeys(value, keys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertRequiredKeys(value, keys, valuePath) {
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} error @param {string} code @returns {boolean} */
function hasCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    String(error.code) === code
  );
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsolutePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${valuePath} must be a canonical absolute path.`);
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactPlainObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  return value;
}

/**
 * Derive the only local path set admitted for one exact V65 request. Opaque
 * provider identifiers never become filesystem components.
 * @param {unknown} requestValue - Exact V65 activation request.
 * @param {unknown} [rootValue] - Canonical projection root.
 * @returns {Readonly<Record<string, string>>} - Fixed local layout.
 */
export function getAwsSingleNodeHostArtifactProjectionLayout(
  requestValue,
  rootValue = AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
) {
  const request = validateAwsSingleNodeHostActivationRequest(
    requestValue,
    'awsSingleNodeHostArtifactProjection layout.request',
  );
  const root = canonicalAbsolutePath(
    rootValue,
    'awsSingleNodeHostArtifactProjection layout.root',
  );
  const deploymentDirectory = path.join(root, request.deploymentInstanceId);
  const projectionDirectory = path.join(deploymentDirectory, request.requestId);
  return Object.freeze({
    root,
    deploymentDirectory,
    projectionDirectory,
    artifactPath: path.join(projectionDirectory, ARTIFACT_FILE_NAME),
    recordPath: path.join(projectionDirectory, PROJECTION_RECORD_FILE_NAME),
  });
}

/**
 * Revalidate the complete V66 artifact-projection context before filesystem
 * or provider I/O. Predecessor evidence is already canonical V66 evidence;
 * this adapter owns only its exact key frontier until concrete storage
 * evidence contracts exist.
 * @param {unknown} value - Candidate effect context.
 * @returns {Readonly<{request: Readonly<Record<string, any>>, attemptGeneration: number}>}
 */
function validateContext(value) {
  const context = exactPlainObject(
    value,
    'awsSingleNodeHostArtifactProjection context',
  );
  assertExactKeys(
    context,
    CONTEXT_KEYS,
    'awsSingleNodeHostArtifactProjection context',
  );
  const request = validateAwsSingleNodeHostActivationRequest(
    context.request,
    'awsSingleNodeHostArtifactProjection context.request',
  );
  const step = exactPlainObject(
    context.step,
    'awsSingleNodeHostArtifactProjection context.step',
  );
  assertExactKeys(
    step,
    STEP_KEYS,
    'awsSingleNodeHostArtifactProjection context.step',
  );
  if (step.kind !== ARTIFACT_PROJECTION_STEP) {
    throw new TypeError(
      `awsSingleNodeHostArtifactProjection context.step.kind must be '${ARTIFACT_PROJECTION_STEP}'.`,
    );
  }
  if (
    step.intentId !==
    getAwsSingleNodeHostActivationIntentId(request, ARTIFACT_PROJECTION_STEP)
  ) {
    throw new Error(
      'awsSingleNodeHostArtifactProjection context.step.intentId does not match its exact request.',
    );
  }
  const attemptGeneration = nonnegativeSafeInteger(
    step.attemptGeneration,
    'awsSingleNodeHostArtifactProjection context.step.attemptGeneration',
  );
  const priorEvidence = exactPlainObject(
    context.priorEvidence,
    'awsSingleNodeHostArtifactProjection context.priorEvidence',
  );
  assertExactKeys(
    priorEvidence,
    PRIOR_EVIDENCE_KEYS,
    'awsSingleNodeHostArtifactProjection context.priorEvidence',
  );
  for (const key of PRIOR_EVIDENCE_KEYS) {
    cloneBoundedJsonObject(
      priorEvidence[key],
      AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_MAX_BYTES,
      `awsSingleNodeHostArtifactProjection context.priorEvidence.${key}`,
    );
  }
  return Object.freeze({ request, attemptGeneration });
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, string>>} layout @returns {Readonly<Record<string, any>>} */
function createEvidence(request, layout) {
  const evidence = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND,
      requestId: request.requestId,
      deploymentInstanceId: request.deploymentInstanceId,
      appId: request.appId,
      artifactId: request.artifactId,
      revisionId: request.revisionId,
      targetId: request.targetId,
      contentLength: request.artifact.contentLength,
      byteDigest: request.artifact.byteDigest,
      artifactPath: layout.artifactPath,
    }),
  );
  assertManifestIsSecretFree(
    evidence,
    'awsSingleNodeHostArtifactProjectionEvidence',
  );
  return evidence;
}

/**
 * Validate and bind one durable projection receipt to an exact request and
 * deterministic local path. Provider VersionId and ETag remain bound through
 * the content-addressed requestId without being echoed into evidence.
 * @param {unknown} value - Candidate evidence.
 * @param {unknown} context - Exact V66 artifact context.
 * @param {unknown} [rootValue] - Canonical projection root.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen evidence.
 */
export function validateAwsSingleNodeHostArtifactProjectionEvidence(
  value,
  context,
  rootValue = AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
) {
  const validated = validateContext(context);
  const layout = getAwsSingleNodeHostArtifactProjectionLayout(
    validated.request,
    rootValue,
  );
  const evidence = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_MAX_BYTES,
    'awsSingleNodeHostArtifactProjectionEvidence',
  );
  assertExactKeys(
    evidence,
    EVIDENCE_KEYS,
    'awsSingleNodeHostArtifactProjectionEvidence',
  );
  const expected = createEvidence(validated.request, layout);
  if (!sameJson(evidence, expected)) {
    throw new Error(
      'awsSingleNodeHostArtifactProjectionEvidence does not match the exact request.',
    );
  }
  return expected;
}

/** @param {import('node:fs').Stats} stats @param {'file'|'directory'} kind @param {number} expectedUid @param {number} runtimeGid @param {number} mode @returns {void} */
function assertManagedStats(stats, kind, expectedUid, runtimeGid, mode) {
  const correctKind = kind === 'file' ? stats.isFile() : stats.isDirectory();
  if (
    !correctKind ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== expectedUid ||
    !Number.isSafeInteger(stats.gid) ||
    stats.gid !== runtimeGid ||
    (stats.mode & 0o777) !== mode ||
    !Number.isSafeInteger(stats.nlink) ||
    stats.nlink < 1 ||
    (kind === 'file' && stats.nlink !== 1)
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
}

/** @param {import('node:fs').Stats} stats @param {number} expectedUid @returns {void} */
function assertTrustedAncestorStats(stats, expectedUid) {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== expectedUid ||
    (stats.mode & 0o777 & 0o022) !== 0
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
}

/** @param {import('node:fs').Stats} stats @param {number} expectedUid @param {number} runtimeGid @returns {boolean} */
function isExactOrRepairableManagedDirectory(stats, expectedUid, runtimeGid) {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== expectedUid ||
    (stats.mode & 0o777 & 0o022) !== 0
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  return (
    stats.gid === runtimeGid &&
    (stats.mode & 0o777) === NAMESPACE_DIRECTORY_MODE
  );
}

/** @param {typeof fsp} fsOps @param {string} directory @returns {Promise<void>} */
async function syncDirectory(fsOps, directory) {
  const handle = await fsOps.open(
    directory,
    fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY || 0) |
      (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {typeof fsp} fsOps @param {string} directory @param {number} expectedUid @param {number} runtimeGid @returns {Promise<void>} */
async function ensureManagedDirectory(
  fsOps,
  directory,
  expectedUid,
  runtimeGid,
) {
  const parent = path.dirname(directory);
  assertTrustedAncestorStats(await fsOps.lstat(parent), expectedUid);
  let created = false;
  try {
    await fsOps.mkdir(directory, { mode: TEMPORARY_DIRECTORY_MODE });
    created = true;
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  const initial = await fsOps.lstat(directory);
  if (
    !initial.isDirectory() ||
    initial.isSymbolicLink() ||
    initial.uid !== expectedUid ||
    (initial.mode & 0o777 & 0o022) !== 0
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  if (
    created ||
    initial.gid !== runtimeGid ||
    (initial.mode & 0o777) !== NAMESPACE_DIRECTORY_MODE
  ) {
    await fsOps.chown(directory, expectedUid, runtimeGid);
    await fsOps.chmod(directory, NAMESPACE_DIRECTORY_MODE);
  }
  assertManagedStats(
    await fsOps.lstat(directory),
    'directory',
    expectedUid,
    runtimeGid,
    NAMESPACE_DIRECTORY_MODE,
  );
  await syncDirectory(fsOps, directory);
  await syncDirectory(fsOps, parent);
}

/** @param {import('node:fs').Stats} stats @param {number} expectedUid @param {number} runtimeGid @returns {void} */
function assertOwnedTemporaryDirectory(stats, expectedUid, runtimeGid) {
  const mode = stats.mode & 0o777;
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== expectedUid ||
    (mode !== TEMPORARY_DIRECTORY_MODE && mode !== NAMESPACE_DIRECTORY_MODE) ||
    (mode === NAMESPACE_DIRECTORY_MODE && stats.gid !== runtimeGid) ||
    !Number.isSafeInteger(stats.nlink) ||
    stats.nlink < 1
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
}

/** @param {typeof fsp} fsOps @param {string} temporaryDirectory @param {string} parent @param {number} expectedUid @param {number} runtimeGid @returns {Promise<void>} */
async function removeOwnedTemporaryDirectory(
  fsOps,
  temporaryDirectory,
  parent,
  expectedUid,
  runtimeGid,
) {
  let stats;
  try {
    stats = await fsOps.lstat(temporaryDirectory);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return;
    throw error;
  }
  assertOwnedTemporaryDirectory(stats, expectedUid, runtimeGid);
  await fsOps.rm(temporaryDirectory, { recursive: true, force: true });
  await syncDirectory(fsOps, parent);
}

/** @param {typeof fsp} fsOps @param {string} directory @param {number} maximum @returns {Promise<string[]>} */
async function readBoundedDirectoryNames(fsOps, directory, maximum) {
  const opened = await fsOps.opendir(directory);
  /** @type {string[]} */
  const names = [];
  try {
    while (true) {
      const entry = await opened.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > maximum) {
        throw new AwsSingleNodeHostArtifactProjectionUnknownError();
      }
    }
  } finally {
    await opened.close().catch((error) => {
      if (!hasCode(error, 'ERR_DIR_CLOSED')) throw error;
    });
  }
  return names;
}

/** @param {typeof fsp} fsOps @param {string} directory @param {number} expectedUid @param {number} runtimeGid @returns {Promise<void>} */
async function assertBoundedTemporaryContents(
  fsOps,
  directory,
  expectedUid,
  runtimeGid,
) {
  const names = await readBoundedDirectoryNames(fsOps, directory, 2);
  for (const name of names) {
    if (name !== ARTIFACT_FILE_NAME && name !== PROJECTION_RECORD_FILE_NAME) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    const stats = await fsOps.lstat(path.join(directory, name));
    const mode = stats.mode & 0o777;
    if (
      !stats.isFile() ||
      stats.isSymbolicLink() ||
      stats.uid !== expectedUid ||
      !Number.isSafeInteger(stats.nlink) ||
      stats.nlink !== 1 ||
      ![
        DOWNLOAD_FILE_MODE,
        ARTIFACT_FILE_MODE,
        PROJECTION_RECORD_FILE_MODE,
      ].includes(mode) ||
      (mode !== DOWNLOAD_FILE_MODE && stats.gid !== runtimeGid)
    ) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
  }
}

/**
 * Validate the bounded deployment namespace and identify only authenticated
 * publication temps. Immutable final request directories have a separate
 * retention owner and are never collected by this inspection.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} deploymentDirectory - Exact managed deployment namespace.
 * @param {number} expectedUid - Required privileged owner.
 * @param {number} runtimeGid - Required runtime reader group.
 * @returns {Promise<Readonly<{entryCount: number, temporaryDirectories: readonly string[]}>>} - Exact bounded entry census.
 */
async function inspectDeploymentDirectoryEntries(
  fsOps,
  deploymentDirectory,
  expectedUid,
  runtimeGid,
) {
  const names = await readBoundedDirectoryNames(
    fsOps,
    deploymentDirectory,
    AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES,
  );
  /** @type {string[]} */
  const temporaryDirectories = [];
  for (const name of names) {
    const candidate = path.join(deploymentDirectory, name);
    if (TEMPORARY_DIRECTORY_PATTERN.test(name)) {
      const stats = await fsOps.lstat(candidate);
      assertOwnedTemporaryDirectory(stats, expectedUid, runtimeGid);
      await assertBoundedTemporaryContents(
        fsOps,
        candidate,
        expectedUid,
        runtimeGid,
      );
      temporaryDirectories.push(candidate);
      continue;
    }
    if (!REQUEST_DIRECTORY_PATTERN.test(name)) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    assertManagedStats(
      await fsOps.lstat(candidate),
      'directory',
      expectedUid,
      runtimeGid,
      NAMESPACE_DIRECTORY_MODE,
    );
  }
  return Object.freeze({
    entryCount: names.length,
    temporaryDirectories: Object.freeze(temporaryDirectories),
  });
}

/**
 * Remove only bounded, authenticated publication temps across superseded
 * requests. Immutable final request directories have a separate retention
 * owner and are validated but never collected here.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} deploymentDirectory - Exact managed deployment namespace.
 * @param {number} expectedUid - Required privileged owner.
 * @param {number} runtimeGid - Required runtime reader group.
 * @returns {Promise<void>} - Resolves after one durable bounded collection.
 */
async function collectStaleProjectionTemps(
  fsOps,
  deploymentDirectory,
  expectedUid,
  runtimeGid,
) {
  const inspection = await inspectDeploymentDirectoryEntries(
    fsOps,
    deploymentDirectory,
    expectedUid,
    runtimeGid,
  );
  for (const directory of inspection.temporaryDirectories) {
    await fsOps.rm(directory, { recursive: true, force: true });
  }
  if (inspection.temporaryDirectories.length !== 0) {
    await syncDirectory(fsOps, deploymentDirectory);
  }
}

/**
 * Refuse publication when its stable temporary entry would exceed the
 * authenticated deployment namespace cap. Retention of immutable finals is
 * owned elsewhere; this adapter may consume only one currently free slot.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} deploymentDirectory - Exact managed deployment namespace.
 * @param {number} expectedUid - Required privileged owner.
 * @param {number} runtimeGid - Required runtime reader group.
 * @returns {Promise<void>} - Resolves only when one entry is available.
 */
async function assertProjectionEntryCapacity(
  fsOps,
  deploymentDirectory,
  expectedUid,
  runtimeGid,
) {
  const inspection = await inspectDeploymentDirectoryEntries(
    fsOps,
    deploymentDirectory,
    expectedUid,
    runtimeGid,
  );
  if (
    inspection.temporaryDirectories.length !== 0 ||
    inspection.entryCount >=
      AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES
  ) {
    throw new AwsSingleNodeHostArtifactProjectionUnknownError();
  }
}

/** @param {import('node:fs').Stats} before @param {import('node:fs').Stats} after @returns {boolean} */
function sameFileIdentity(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs &&
    before.nlink === after.nlink
  );
}

/** @param {typeof fsp} fsOps @param {string} filePath @param {number} expectedUid @param {number} runtimeGid @returns {Promise<Readonly<Record<string, any>>>} */
async function readProjectionRecord(fsOps, filePath, expectedUid, runtimeGid) {
  let handle;
  try {
    handle = await fsOps.open(
      filePath,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    );
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    assertManagedStats(
      before,
      'file',
      expectedUid,
      runtimeGid,
      PROJECTION_RECORD_FILE_MODE,
    );
    if (
      !Number.isSafeInteger(before.size) ||
      before.size < 2 ||
      before.size > AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_RECORD_MAX_BYTES
    ) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    const text = await handle.readFile({ encoding: 'utf8' });
    const after = await handle.stat();
    if (
      !sameFileIdentity(before, after) ||
      Buffer.byteLength(text, 'utf8') !== before.size ||
      !text.endsWith('\n')
    ) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    try {
      return Object.freeze({
        value: cloneBoundedJsonObject(
          JSON.parse(text),
          AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_RECORD_MAX_BYTES,
          'awsSingleNodeHostArtifactProjection record',
        ),
        text,
      });
    } catch (error) {
      if (error instanceof AwsSingleNodeHostArtifactProjectionConflictError) {
        throw error;
      }
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
  } finally {
    await handle.close();
  }
}

/** @param {string} root @returns {Readonly<{anchor: string, managed: readonly string[]}>} */
function getManagedRootChain(root) {
  if (root === AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT) {
    return Object.freeze({
      anchor: '/opt',
      managed: Object.freeze([
        '/opt/wharfie',
        '/opt/wharfie/app',
        AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
      ]),
    });
  }
  return Object.freeze({
    anchor: path.dirname(root),
    managed: Object.freeze([root]),
  });
}

/**
 * Prove the durability of every mutable namespace directory and of every
 * parent directory whose entry names that namespace. Authentication happens
 * both before and after the leaf-to-anchor sync sequence.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} root - Exact projection root.
 * @param {string} deploymentDirectory - Exact deployment namespace.
 * @param {number} expectedUid - Required privileged owner.
 * @param {number} runtimeGid - Required runtime reader group.
 * @returns {Promise<void>} - Resolves only after full-chain durability.
 */
async function syncAuthenticatedManagedNamespace(
  fsOps,
  root,
  deploymentDirectory,
  expectedUid,
  runtimeGid,
) {
  const rootChain = getManagedRootChain(root);
  const managed = [...rootChain.managed, deploymentDirectory];
  const authenticate = async () => {
    assertTrustedAncestorStats(
      await fsOps.lstat(rootChain.anchor),
      expectedUid,
    );
    for (const directory of managed) {
      assertManagedStats(
        await fsOps.lstat(directory),
        'directory',
        expectedUid,
        runtimeGid,
        NAMESPACE_DIRECTORY_MODE,
      );
    }
  };
  await authenticate();
  for (const directory of [...managed].reverse()) {
    await syncDirectory(fsOps, directory);
  }
  await syncDirectory(fsOps, rootChain.anchor);
  await authenticate();
}

/** @param {typeof fsp} fsOps @param {string} artifactPath @param {number} expectedUid @param {number} runtimeGid @param {number} expectedLength @returns {Promise<Readonly<{size: number, digest: string}>>} */
async function inspectProjectedArtifact(
  fsOps,
  artifactPath,
  expectedUid,
  runtimeGid,
  expectedLength,
) {
  let handle;
  try {
    handle = await fsOps.open(
      artifactPath,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    );
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    throw error;
  }
  try {
    const before = await handle.stat();
    assertManagedStats(
      before,
      'file',
      expectedUid,
      runtimeGid,
      ARTIFACT_FILE_MODE,
    );
    if (!Number.isSafeInteger(before.size) || before.size !== expectedLength) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    const hash = createHash('sha256');
    let position = 0;
    while (position < expectedLength) {
      const requested = Math.min(64 * 1024, expectedLength - position);
      const buffer = Buffer.allocUnsafe(requested);
      const { bytesRead } = await handle.read(buffer, 0, requested, position);
      if (
        !Number.isSafeInteger(bytesRead) ||
        bytesRead < 1 ||
        bytesRead > requested
      ) {
        throw new AwsSingleNodeHostArtifactProjectionConflictError();
      }
      hash.update(
        bytesRead === requested ? buffer : buffer.subarray(0, bytesRead),
      );
      position += bytesRead;
    }
    const after = await handle.stat();
    if (!sameFileIdentity(before, after)) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    return Object.freeze({
      size: position,
      digest: hash.digest('base64url'),
    });
  } finally {
    await handle.close();
  }
}

/** @param {typeof fsp} fsOps @param {string} directory @returns {Promise<void>} */
async function assertExactProjectionEntries(fsOps, directory) {
  const opened = await fsOps.opendir(directory);
  /** @type {string[]} */
  const names = [];
  try {
    while (true) {
      const entry = await opened.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > 2) {
        throw new AwsSingleNodeHostArtifactProjectionConflictError();
      }
    }
  } finally {
    await opened.close().catch((error) => {
      if (!hasCode(error, 'ERR_DIR_CLOSED')) throw error;
    });
  }
  names.sort();
  if (
    names.length !== 2 ||
    names[0] !== ARTIFACT_FILE_NAME ||
    names[1] !== PROJECTION_RECORD_FILE_NAME
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
}

/**
 * Read the final immutable directory without consulting S3.
 * @param {{fsOps: typeof fsp, layout: Readonly<Record<string, string>>, request: Readonly<Record<string, any>>, expectedUid: number, runtimeGid: number, root: string}} options - Projection inputs.
 * @returns {Promise<Readonly<Record<string, any>>|null>}
 */
async function inspectProjection(options) {
  const rootChain = getManagedRootChain(options.root);
  assertTrustedAncestorStats(
    await options.fsOps.lstat(rootChain.anchor),
    options.expectedUid,
  );
  const namespace = [...rootChain.managed, options.layout.deploymentDirectory];
  for (let index = 0; index < namespace.length; index += 1) {
    const directory = namespace[index];
    let stats;
    try {
      stats = await options.fsOps.lstat(directory);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return null;
      throw error;
    }
    if (
      !isExactOrRepairableManagedDirectory(
        stats,
        options.expectedUid,
        options.runtimeGid,
      )
    ) {
      return null;
    }
  }
  const deploymentInspection = await inspectDeploymentDirectoryEntries(
    options.fsOps,
    options.layout.deploymentDirectory,
    options.expectedUid,
    options.runtimeGid,
  );
  let projectionStats;
  try {
    projectionStats = await options.fsOps.lstat(
      options.layout.projectionDirectory,
    );
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  assertManagedStats(
    projectionStats,
    'directory',
    options.expectedUid,
    options.runtimeGid,
    NAMESPACE_DIRECTORY_MODE,
  );
  await assertExactProjectionEntries(
    options.fsOps,
    options.layout.projectionDirectory,
  );
  const record = await readProjectionRecord(
    options.fsOps,
    options.layout.recordPath,
    options.expectedUid,
    options.runtimeGid,
  );
  const context = Object.freeze({
    request: options.request,
    step: Object.freeze({
      intentId: getAwsSingleNodeHostActivationIntentId(
        options.request,
        ARTIFACT_PROJECTION_STEP,
      ),
      kind: ARTIFACT_PROJECTION_STEP,
      attemptGeneration: 0,
    }),
    priorEvidence: Object.freeze({
      'runtime-identity': Object.freeze({ projectionReadback: true }),
      'application-storage': Object.freeze({ projectionReadback: true }),
      'control-storage': Object.freeze({ projectionReadback: true }),
    }),
  });
  const evidence = validateAwsSingleNodeHostArtifactProjectionEvidence(
    record.value,
    context,
    options.root,
  );
  if (record.text !== `${JSON.stringify(evidence)}\n`) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  const bytes = await inspectProjectedArtifact(
    options.fsOps,
    options.layout.artifactPath,
    options.expectedUid,
    options.runtimeGid,
    options.request.artifact.contentLength,
  );
  if (
    bytes.size !== options.request.artifact.contentLength ||
    bytes.digest !== options.request.artifact.byteDigest.value ||
    options.request.artifactId !== `waf1_${bytes.digest}`
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  return deploymentInspection.temporaryDirectories.length !== 0
    ? null
    : evidence;
}

/** @param {unknown} value @param {string} key @returns {unknown} */
function ownDataValue(value, key) {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    !Object.hasOwn(descriptor, 'value') ||
    descriptor.enumerable !== true
  ) {
    return undefined;
  }
  return descriptor.value;
}

/** @param {unknown} outcome @returns {Promise<void>} */
async function containCleanupOutcome(outcome) {
  try {
    if (
      outcome !== null &&
      (typeof outcome === 'object' || typeof outcome === 'function') &&
      typeof (/** @type {{then?: unknown}} */ (outcome).then) === 'function'
    ) {
      const contained = Promise.resolve(outcome).then(
        () => undefined,
        () => undefined,
      );
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let timer;
      const bounded = new Promise((resolve) => {
        timer = setTimeout(resolve, BODY_RELEASE_TIMEOUT_MILLISECONDS);
      });
      await Promise.race([contained, bounded]);
      clearTimeout(timer);
    }
  } catch {
    // Preserve the authoritative validation, timeout, or filesystem failure.
  }
}

/** @param {unknown} body @returns {Promise<void>} */
async function releaseBody(body) {
  if (
    body === null ||
    (typeof body !== 'object' && typeof body !== 'function')
  ) {
    return;
  }
  const candidate = /** @type {Record<string, any>} */ (body);
  try {
    if (
      candidate.destroyed === true ||
      candidate.readableEnded === true ||
      candidate.closed === true
    ) {
      return;
    }
  } catch {
    // A hostile terminal-state accessor is not trusted; attempt fixed cleanup.
  }
  let destroy;
  try {
    destroy = candidate.destroy;
  } catch {
    return;
  }
  if (typeof destroy !== 'function') return;
  try {
    await containCleanupOutcome(Reflect.apply(destroy, body, []));
  } catch {
    // Preserve the authoritative validation, timeout, or filesystem failure.
  }
}

/**
 * Validate all managed-object headers and exact known request fields before
 * accepting one byte from Body.
 * @param {unknown} responseValue - Raw GetObject response.
 * @param {Readonly<Record<string, any>>} request - Exact V65 request.
 * @returns {unknown} - Captured response Body.
 */
function validateGetObjectResponse(responseValue, request) {
  if (!isPlainObject(responseValue)) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  const metadata = ownDataValue(responseValue, 'Metadata');
  if (!isPlainObject(metadata)) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  const createdByActionId = ownDataValue(
    metadata,
    'wharfie-created-by-action-id',
  );
  const ownershipNonce = ownDataValue(metadata, 'wharfie-ownership-nonce');
  if (
    typeof createdByActionId !== 'string' ||
    typeof ownershipNonce !== 'string'
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  let decoded;
  try {
    decoded = decodeAwsSingleNodeManagedArtifactHead(
      responseValue,
      {
        providerScope: request.providerScope,
        artifactStorage: FIXED_ARTIFACT_STORAGE,
        deploymentInstanceId: request.deploymentInstanceId,
        incarnationId: request.incarnationId,
        createdByActionId,
        ownershipNonce,
        appId: request.appId,
      },
      request.artifact.versionId,
    );
  } catch {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  if (
    decoded.etag !== request.artifact.etag ||
    decoded.contentLength !== request.artifact.contentLength ||
    decoded.artifactId !== request.artifactId ||
    decoded.deploymentRevisionId !== request.deploymentRevisionId ||
    decoded.revisionId !== request.revisionId ||
    decoded.stageIntentId !== request.artifact.stageIntentId ||
    decoded.stageReceiptId !== request.artifact.stageReceiptId ||
    !sameJson(decoded.stateDigest, request.artifact.stateDigest) ||
    ownDataValue(responseValue, 'ServerSideEncryption') !== 'AES256' ||
    (ownDataValue(responseValue, 'StorageClass') ?? 'STANDARD') !==
      'STANDARD' ||
    ownDataValue(responseValue, 'ContentType') !==
      AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE ||
    ownDataValue(responseValue, 'CacheControl') !==
      AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL
  ) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  const body = ownDataValue(responseValue, 'Body');
  if (body === undefined || body === null) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  return body;
}

/** @returns {{controller: AbortController, wait: <T>(operation: Promise<T>|T) => Promise<T>, close: () => void}} */
function createDeadline(/** @type {number} */ timeoutMilliseconds) {
  const controller = new AbortController();
  const marker = Object.freeze({});
  /** @type {ReturnType<typeof setTimeout>} */
  const timer = setTimeout(() => controller.abort(), timeoutMilliseconds);
  const aborted = new Promise((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(marker), {
      once: true,
    });
  });
  return {
    controller,
    async wait(operation) {
      const result = await Promise.race([Promise.resolve(operation), aborted]);
      if (result === marker) {
        throw new AwsSingleNodeHostArtifactProjectionTimeoutError();
      }
      return /** @type {any} */ (result);
    },
    close() {
      clearTimeout(timer);
    },
  };
}

/** @param {import('node:fs/promises').FileHandle} handle @param {Buffer} bytes @returns {Promise<void>} */
async function writeAll(handle, bytes) {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (
      !Number.isSafeInteger(bytesWritten) ||
      bytesWritten < 1 ||
      bytesWritten > bytes.byteLength - offset
    ) {
      throw new AwsSingleNodeHostArtifactProjectionUnknownError();
    }
    offset += bytesWritten;
  }
}

/**
 * Stream one Body through a held destination descriptor, enforcing exact
 * length before every write and hashing precisely the bytes persisted.
 * @param {{body: unknown, handle: import('node:fs/promises').FileHandle, expectedLength: number, wait: <T>(operation: Promise<T>|T) => Promise<T>}} options - Stream inputs.
 * @returns {Promise<Readonly<{size: number, digest: string}>>}
 */
async function streamBodyToArtifact(options) {
  const hash = createHash('sha256');
  let size = 0;

  /** @param {unknown} value @param {boolean} allowEmpty @returns {Promise<void>} */
  async function consume(value, allowEmpty) {
    let bytes;
    if (value instanceof Uint8Array) {
      bytes = Buffer.from(value);
    } else if (value instanceof ArrayBuffer) {
      bytes = Buffer.from(new Uint8Array(value));
    } else {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    if (bytes.byteLength > options.expectedLength - size) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    if (bytes.byteLength === 0) {
      if (!allowEmpty) {
        throw new AwsSingleNodeHostArtifactProjectionConflictError();
      }
      return;
    }
    await writeAll(options.handle, bytes);
    hash.update(bytes);
    size += bytes.byteLength;
  }

  if (
    options.body instanceof Uint8Array ||
    options.body instanceof ArrayBuffer
  ) {
    await consume(options.body, true);
  } else {
    let getIterator;
    try {
      getIterator = /** @type {any} */ (options.body)[Symbol.asyncIterator];
    } catch {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    if (typeof getIterator !== 'function') {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    let iterator;
    try {
      iterator = Reflect.apply(getIterator, options.body, []);
    } catch {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    if (
      iterator === null ||
      (typeof iterator !== 'object' && typeof iterator !== 'function')
    ) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    let next;
    let finish;
    try {
      next = iterator.next;
      finish = iterator.return;
    } catch {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    if (
      typeof next !== 'function' ||
      (finish !== undefined && typeof finish !== 'function')
    ) {
      throw new AwsSingleNodeHostArtifactProjectionConflictError();
    }
    let complete = false;
    try {
      while (true) {
        const result = await options.wait(Reflect.apply(next, iterator, []));
        if (!isPlainObject(result) || typeof result.done !== 'boolean') {
          throw new AwsSingleNodeHostArtifactProjectionConflictError();
        }
        if (result.done) {
          complete = true;
          break;
        }
        await consume(result.value, false);
      }
    } finally {
      if (!complete && typeof finish === 'function') {
        try {
          await containCleanupOutcome(Reflect.apply(finish, iterator, []));
        } catch {
          // The original iteration failure remains authoritative.
        }
      }
    }
  }
  if (size !== options.expectedLength) {
    throw new AwsSingleNodeHostArtifactProjectionConflictError();
  }
  return Object.freeze({ size, digest: hash.digest('base64url') });
}

/** @template T @param {typeof fsp} fsOps @param {string} filePath @param {number} mode @param {number} expectedUid @param {number} runtimeGid @param {(handle: import('node:fs/promises').FileHandle) => Promise<T>} write @returns {Promise<T>} */
async function createManagedFile(
  fsOps,
  filePath,
  mode,
  expectedUid,
  runtimeGid,
  write,
) {
  const handle = await fsOps.open(
    filePath,
    fsConstants.O_CREAT |
      fsConstants.O_EXCL |
      fsConstants.O_WRONLY |
      (fsConstants.O_NOFOLLOW || 0),
    DOWNLOAD_FILE_MODE,
  );
  /** @type {T} */
  let result;
  try {
    result = await write(handle);
    await handle.sync();
    await handle.chown(expectedUid, runtimeGid);
    await handle.chmod(mode);
    assertManagedStats(
      await handle.stat(),
      'file',
      expectedUid,
      runtimeGid,
      mode,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
  return result;
}

/** @param {unknown} value @returns {Readonly<{client: Readonly<{getObject: Function}>, runtimeGid: number, root: string, expectedUid: number, fsOps: typeof fsp, attemptTimeoutMilliseconds: number}>} */
function validateFactoryOptions(value) {
  const options = exactPlainObject(
    value,
    'awsSingleNodeHostArtifactProjection options',
  );
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeHostArtifactProjection options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeHostArtifactProjection options',
  );
  const clientValue = exactPlainObject(
    options.client,
    'awsSingleNodeHostArtifactProjection options.client',
  );
  assertExactKeys(
    clientValue,
    CLIENT_KEYS,
    'awsSingleNodeHostArtifactProjection options.client',
  );
  const getObjectDescriptor = Object.getOwnPropertyDescriptor(
    clientValue,
    'getObject',
  );
  if (
    getObjectDescriptor === undefined ||
    !Object.hasOwn(getObjectDescriptor, 'value') ||
    typeof getObjectDescriptor.value !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeHostArtifactProjection options.client.getObject must be an own data-property function.',
    );
  }
  const runtimeGid = nonnegativeSafeInteger(
    options.runtimeGid,
    'awsSingleNodeHostArtifactProjection options.runtimeGid',
  );
  if (runtimeGid < 1) {
    throw new TypeError(
      'awsSingleNodeHostArtifactProjection options.runtimeGid must be positive.',
    );
  }
  const root = canonicalAbsolutePath(
    options.root ?? AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
    'awsSingleNodeHostArtifactProjection options.root',
  );
  const customRoot = root !== AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT;
  if (customRoot) {
    const temporaryRoot = canonicalAbsolutePath(
      tmpdir(),
      'awsSingleNodeHostArtifactProjection temporary root',
    );
    const relative = path.relative(temporaryRoot, root);
    if (
      options.testOnlyRoot !== true ||
      !Object.hasOwn(options, 'expectedUid') ||
      relative.length === 0 ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new TypeError(
        'awsSingleNodeHostArtifactProjection custom root must be an explicit isolated test-only path.',
      );
    }
  } else {
    for (const key of ['expectedUid', 'fsOps', 'testOnlyRoot']) {
      if (Object.hasOwn(options, key)) {
        throw new TypeError(
          `awsSingleNodeHostArtifactProjection options.${key} is supported only with an isolated custom test root.`,
        );
      }
    }
  }
  const expectedUid = nonnegativeSafeInteger(
    options.expectedUid ?? 0,
    'awsSingleNodeHostArtifactProjection options.expectedUid',
  );
  const fsOps = options.fsOps ?? fsp;
  if (
    fsOps === null ||
    typeof fsOps !== 'object' ||
    REQUIRED_FS_METHODS.some(
      (method) => typeof (/** @type {any} */ (fsOps)[method]) !== 'function',
    )
  ) {
    throw new TypeError(
      'awsSingleNodeHostArtifactProjection options.fsOps is invalid.',
    );
  }
  const attemptTimeoutMilliseconds = nonnegativeSafeInteger(
    options.attemptTimeoutMilliseconds ??
      AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_DEFAULT_TIMEOUT_MILLISECONDS,
    'awsSingleNodeHostArtifactProjection options.attemptTimeoutMilliseconds',
  );
  if (
    attemptTimeoutMilliseconds < 1 ||
    attemptTimeoutMilliseconds >
      AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_TIMEOUT_MILLISECONDS
  ) {
    throw new TypeError(
      `awsSingleNodeHostArtifactProjection options.attemptTimeoutMilliseconds must be an integer from 1 through ${AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_TIMEOUT_MILLISECONDS}.`,
    );
  }
  return Object.freeze({
    client: Object.freeze({
      getObject: getObjectDescriptor.value.bind(clientValue),
    }),
    runtimeGid,
    root,
    expectedUid,
    fsOps,
    attemptTimeoutMilliseconds,
  });
}

/**
 * Create the concrete V66 exact-version artifact adapter. The caller owns the
 * narrow S3 lifetime; this adapter owns each response Body until it is fully
 * consumed or destroyed and publishes only through an immutable directory
 * rename.
 * @param {unknown} value - Exact client, runtime group, and optional test seams.
 * @returns {Readonly<{observe: Function, converge: Function, validateEvidence: Function}>}
 */
export function createAwsSingleNodeHostArtifactProjectionAdapter(value) {
  const options = validateFactoryOptions(value);
  /** @type {Set<string>} */
  const durabilityPoison = new Set();

  /** @param {Readonly<Record<string, any>>} request @returns {Readonly<Record<string, string>>} */
  function layoutFor(request) {
    return getAwsSingleNodeHostArtifactProjectionLayout(request, options.root);
  }

  /**
   * @param {string} requestId - Exact poisoned request.
   * @param {Readonly<Record<string, string>>} layout - Exact local layout.
   * @returns {Promise<void>} - Resolves only after full namespace durability.
   */
  async function recoverDurabilityPoison(requestId, layout) {
    await syncAuthenticatedManagedNamespace(
      options.fsOps,
      options.root,
      layout.deploymentDirectory,
      options.expectedUid,
      options.runtimeGid,
    );
    durabilityPoison.delete(requestId);
  }

  /**
   * @param {unknown} context - Exact V66 context.
   * @returns {Promise<Readonly<{status: 'ready'}>|Readonly<{status: 'unknown'}>|Readonly<{status: 'conflict'}>|Readonly<{status: 'settled', evidence: Readonly<Record<string, any>>}>>}
   */
  async function observe(context) {
    const validated = validateContext(context);
    const layout = layoutFor(validated.request);
    try {
      const evidence = await inspectProjection({
        fsOps: options.fsOps,
        layout,
        request: validated.request,
        expectedUid: options.expectedUid,
        runtimeGid: options.runtimeGid,
        root: options.root,
      });
      if (evidence !== null) {
        await recoverDurabilityPoison(validated.request.requestId, layout);
      }
      return evidence === null
        ? Object.freeze({ status: 'ready' })
        : deepFreeze({ status: 'settled', evidence });
    } catch (error) {
      return Object.freeze({
        status:
          error instanceof AwsSingleNodeHostArtifactProjectionConflictError
            ? 'conflict'
            : 'unknown',
      });
    }
  }

  /**
   * @param {unknown} context - Exact V66 effect context.
   * @returns {Promise<void>} - Resolves after complete immutable publication.
   */
  async function converge(context) {
    const validated = validateContext(context);
    if (validated.attemptGeneration < 1) {
      throw new TypeError(
        'awsSingleNodeHostArtifactProjection converge requires a positive attemptGeneration.',
      );
    }
    const request = validated.request;
    const layout = layoutFor(request);
    const temporaryDirectory = path.join(
      layout.deploymentDirectory,
      `.${request.requestId}.tmp`,
    );
    /** @type {unknown} */
    let body;
    /** @type {ReturnType<typeof createDeadline>|undefined} */
    let deadline;
    let namespaceReady = false;
    /** @type {Error|undefined} */
    let failure;
    try {
      const existing = await inspectProjection({
        fsOps: options.fsOps,
        layout,
        request,
        expectedUid: options.expectedUid,
        runtimeGid: options.runtimeGid,
        root: options.root,
      });
      if (existing !== null) {
        await recoverDurabilityPoison(request.requestId, layout);
        return;
      }
      durabilityPoison.add(request.requestId);

      const rootChain = getManagedRootChain(options.root);
      assertTrustedAncestorStats(
        await options.fsOps.lstat(rootChain.anchor),
        options.expectedUid,
      );
      for (const directory of rootChain.managed) {
        await ensureManagedDirectory(
          options.fsOps,
          directory,
          options.expectedUid,
          options.runtimeGid,
        );
      }
      await ensureManagedDirectory(
        options.fsOps,
        layout.deploymentDirectory,
        options.expectedUid,
        options.runtimeGid,
      );
      namespaceReady = true;
      await collectStaleProjectionTemps(
        options.fsOps,
        layout.deploymentDirectory,
        options.expectedUid,
        options.runtimeGid,
      );
      const repairedExisting = await inspectProjection({
        fsOps: options.fsOps,
        layout,
        request,
        expectedUid: options.expectedUid,
        runtimeGid: options.runtimeGid,
        root: options.root,
      });
      if (repairedExisting !== null) {
        await recoverDurabilityPoison(request.requestId, layout);
        return;
      }
      await assertProjectionEntryCapacity(
        options.fsOps,
        layout.deploymentDirectory,
        options.expectedUid,
        options.runtimeGid,
      );
      await options.fsOps.mkdir(temporaryDirectory, {
        mode: TEMPORARY_DIRECTORY_MODE,
      });
      await options.fsOps.chown(
        temporaryDirectory,
        options.expectedUid,
        options.runtimeGid,
      );
      await options.fsOps.chmod(temporaryDirectory, TEMPORARY_DIRECTORY_MODE);
      assertManagedStats(
        await options.fsOps.lstat(temporaryDirectory),
        'directory',
        options.expectedUid,
        options.runtimeGid,
        TEMPORARY_DIRECTORY_MODE,
      );

      const activeDeadline = createDeadline(options.attemptTimeoutMilliseconds);
      deadline = activeDeadline;
      const getInput = deepFreeze({
        Bucket: request.artifact.bucketName,
        Key: request.artifact.key,
        VersionId: request.artifact.versionId,
        ExpectedBucketOwner: request.providerScope.accountId,
        ChecksumMode: 'ENABLED',
        IfMatch: request.artifact.etag,
      });
      const getOptions = Object.freeze({
        abortSignal: activeDeadline.controller.signal,
      });
      const response = await activeDeadline.wait(
        options.client.getObject(getInput, getOptions),
      );
      body = ownDataValue(response, 'Body');
      body = validateGetObjectResponse(response, request);

      const temporaryArtifact = path.join(
        temporaryDirectory,
        ARTIFACT_FILE_NAME,
      );
      const streamed = await createManagedFile(
        options.fsOps,
        temporaryArtifact,
        ARTIFACT_FILE_MODE,
        options.expectedUid,
        options.runtimeGid,
        async (handle) =>
          await streamBodyToArtifact({
            body,
            handle,
            expectedLength: request.artifact.contentLength,
            wait: activeDeadline.wait,
          }),
      );
      if (
        streamed.size !== request.artifact.contentLength ||
        streamed.digest !== request.artifact.byteDigest.value ||
        request.artifactId !== `waf1_${streamed.digest}`
      ) {
        throw new AwsSingleNodeHostArtifactProjectionConflictError();
      }

      const evidence = createEvidence(request, layout);
      const temporaryRecord = path.join(
        temporaryDirectory,
        PROJECTION_RECORD_FILE_NAME,
      );
      await createManagedFile(
        options.fsOps,
        temporaryRecord,
        PROJECTION_RECORD_FILE_MODE,
        options.expectedUid,
        options.runtimeGid,
        async (handle) => {
          await handle.writeFile(`${JSON.stringify(evidence)}\n`, {
            encoding: 'utf8',
          });
        },
      );
      await options.fsOps.chmod(temporaryDirectory, NAMESPACE_DIRECTORY_MODE);
      assertManagedStats(
        await options.fsOps.lstat(temporaryDirectory),
        'directory',
        options.expectedUid,
        options.runtimeGid,
        NAMESPACE_DIRECTORY_MODE,
      );
      await syncDirectory(options.fsOps, temporaryDirectory);

      let renameError;
      try {
        await options.fsOps.rename(
          temporaryDirectory,
          layout.projectionDirectory,
        );
      } catch (error) {
        renameError = error;
      }
      const finalEvidence = await inspectProjection({
        fsOps: options.fsOps,
        layout,
        request,
        expectedUid: options.expectedUid,
        runtimeGid: options.runtimeGid,
        root: options.root,
      });
      if (finalEvidence === null) {
        if (renameError !== undefined) throw renameError;
        throw new AwsSingleNodeHostArtifactProjectionUnknownError();
      }
      await recoverDurabilityPoison(request.requestId, layout);
    } catch (error) {
      failure = safeProjectionError(error);
    }
    deadline?.close();
    await releaseBody(body);
    if (namespaceReady) {
      try {
        await removeOwnedTemporaryDirectory(
          options.fsOps,
          temporaryDirectory,
          layout.deploymentDirectory,
          options.expectedUid,
          options.runtimeGid,
        );
        await syncDirectory(options.fsOps, layout.deploymentDirectory);
      } catch {
        failure = new AwsSingleNodeHostArtifactProjectionUnknownError();
      }
    }
    if (failure !== undefined) throw failure;
  }

  /** @param {unknown} evidence @param {unknown} context @returns {Readonly<Record<string, any>>} */
  function validateEvidence(evidence, context) {
    return validateAwsSingleNodeHostArtifactProjectionEvidence(
      evidence,
      context,
      options.root,
    );
  }

  return Object.freeze({ observe, converge, validateEvidence });
}

export default {
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_DEFAULT_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_TIMEOUT_MILLISECONDS,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_MAX_DIRECTORY_ENTRIES,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_RECORD_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ARTIFACT_PROJECTION_ROOT,
  AwsSingleNodeHostArtifactProjectionConflictError,
  AwsSingleNodeHostArtifactProjectionTimeoutError,
  AwsSingleNodeHostArtifactProjectionUnknownError,
  createAwsSingleNodeHostArtifactProjectionAdapter,
  getAwsSingleNodeHostArtifactProjectionLayout,
  validateAwsSingleNodeHostArtifactProjectionEvidence,
};
