/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines -- This privileged filesystem boundary deliberately keeps its injected test seam and exact V66 ports in one module. */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_MAX_BYTES,
  validateAwsSingleNodeHostActivationFence,
  validateAwsSingleNodeHostActivationState,
} from './deployment-aws-host-activation.js';
import { AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX } from './deployment-aws-host-agent-contract.js';
import {
  LinuxAbstractOperationLockBusyError,
  acquireLinuxAbstractOperationLock,
} from './linux-abstract-operation-lock.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import { assertDeploymentInstanceId } from './deployment-provider-scope.js';

export const AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ROOT =
  '/var/lib/wharfie/host-activation/v1';
export const AWS_SINGLE_NODE_HOST_ACTIVATION_RETAINED_SUPERSEDED_STATES = 8;
export const AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES = 128;

const FENCE_FILE_NAME = 'fence.json';
const STATES_DIRECTORY_NAME = 'states';
const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const MAX_DEPLOYMENT_DIRECTORY_ENTRIES = 16;
const MAX_STATE_TEMP_RECOVERY_ENTRIES = 16;
const TRANSACTION_LOCK_ATTEMPTS = 250;
const TRANSACTION_LOCK_WAIT_MS = 20;
const HOST_LOCK_DOMAIN = 'wharfie:aws-host-activation-operation-lock:v1';
const TRANSACTION_LOCK_DOMAIN =
  'wharfie:aws-host-activation-store-transaction-lock:v1';
const CREATE_OPTION_KEYS = new Set([
  'deploymentInstanceId',
  'stateDirectory',
  'expectedUid',
  'fsOps',
  'createServer',
  'createToken',
  'retainedSupersededStates',
]);
const OPEN_OPTION_KEYS = new Set(['deploymentInstanceId']);
const HOST_LOCK_INPUT_KEYS = new Set(['deploymentInstanceId']);
const INSPECT_INPUT_KEYS = new Set(['requestId']);
const FENCE_CAS_INPUT_KEYS = new Set([
  'deploymentInstanceId',
  'expectedFenceId',
  'nextFence',
]);
const STATE_CAS_INPUT_KEYS = new Set([
  'requestId',
  'expectedStateId',
  'nextState',
]);
const INSPECTION_KEYS = new Set(['authority', 'fence', 'state']);
const TEMP_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const STATE_TEMP_PATTERN =
  /^\.state\.(whaq1_[A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{1,128})\.tmp$/;
const FENCE_TEMP_PATTERN = /^\.fence\.([A-Za-z0-9_-]{1,128})\.tmp$/;
const BOOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOCK_NAMESPACE_CLAIM_KEYS = new Set([
  'bootId',
  'kind',
  'netNamespaceDevice',
  'netNamespaceInode',
  'schemaVersion',
]);
const LOCK_NAMESPACE_CLAIM_KIND = 'awsSingleNodeHostActivationLockNamespace';
const LOCK_NAMESPACE_CLAIM_MAX_BYTES = 512;

/** Root-owned activation persistence could not be initialized safely. */
export class AwsSingleNodeHostActivationPersistenceInitializationError extends Error {
  constructor() {
    super('AWS single-node host activation persistence initialization failed.');
    this.name = 'AwsSingleNodeHostActivationPersistenceInitializationError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_INITIALIZATION_FAILED';
  }
}

/** A persistence capability was used after owner shutdown began. */
export class AwsSingleNodeHostActivationPersistenceClosedError extends Error {
  constructor() {
    super('AWS single-node host activation persistence is closed.');
    this.name = 'AwsSingleNodeHostActivationPersistenceClosedError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_CLOSED';
  }
}

/** Another process currently owns this deployment's host operation. */
export class AwsSingleNodeHostActivationPersistenceLockBusyError extends Error {
  constructor() {
    super('AWS single-node host activation is already active.');
    this.name = 'AwsSingleNodeHostActivationPersistenceLockBusyError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_LOCK_BUSY';
  }
}

/** Durable host records or their root-owned filesystem envelope are invalid. */
export class AwsSingleNodeHostActivationPersistenceCorruptError extends Error {
  constructor() {
    super('AWS single-node host activation persistence is invalid.');
    this.name = 'AwsSingleNodeHostActivationPersistenceCorruptError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_INVALID';
  }
}

/** The bounded local activation directory cannot safely accept more records. */
export class AwsSingleNodeHostActivationPersistenceCapacityError extends Error {
  constructor() {
    super(
      'AWS single-node host activation persistence reached its safe bound.',
    );
    this.name = 'AwsSingleNodeHostActivationPersistenceCapacityError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_CAPACITY';
  }
}

/** One durable read, publication, sync, cleanup, or lock operation failed. */
export class AwsSingleNodeHostActivationPersistenceOperationError extends Error {
  constructor() {
    super('AWS single-node host activation persistence operation failed.');
    this.name = 'AwsSingleNodeHostActivationPersistenceOperationError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_OPERATION_FAILED';
  }
}

/** Persistence shutdown could not drain admitted operations. */
export class AwsSingleNodeHostActivationPersistenceCloseError extends Error {
  constructor() {
    super('AWS single-node host activation persistence close failed.');
    this.name = 'AwsSingleNodeHostActivationPersistenceCloseError';
    this.code = 'WHARFIE_AWS_HOST_ACTIVATION_PERSISTENCE_CLOSE_FAILED';
  }
}

/** A rename may have committed but its containing directory could not sync. */
class PersistenceDurabilityUncertainError extends Error {}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Reject inherited, accessor-backed, hidden, symbol, missing, and extra input.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Exact string keys.
 * @param {string} valuePath - Safe input label.
 * @returns {Record<string, any>} - Original exact data object.
 */
function exactDataObject(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${valuePath} must contain only its exact fields.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an enumerable value.`);
    }
  }
  return value;
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} error @param {string} code @returns {boolean} */
function hasCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === code
  );
}

/** @param {unknown} value @param {string} label @returns {string} */
function canonicalAbsolutePath(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${label} must be one canonical absolute path.`);
  }
  return value;
}

/** @param {unknown} value @param {string} label @returns {number} */
function nonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} label @returns {number} */
function positiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * Assert concrete file or directory identity through lstat/fstat output.
 * @param {import('node:fs').Stats} stats - Filesystem state.
 * @param {'file'|'directory'} kind - Required concrete type.
 * @param {number} expectedUid - Required root/test owner.
 * @param {number|null} exactMode - Exact permission bits or null.
 * @param {number} [maximumFileLinks] - Maximum accepted regular-file links.
 * @returns {void}
 */
function assertPrivateStats(
  stats,
  kind,
  expectedUid,
  exactMode,
  maximumFileLinks = 1,
) {
  const correctKind = kind === 'file' ? stats.isFile() : stats.isDirectory();
  if (!correctKind || stats.isSymbolicLink()) {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
  if (
    kind === 'file' &&
    (!Number.isSafeInteger(stats.nlink) ||
      stats.nlink < 1 ||
      stats.nlink > maximumFileLinks)
  ) {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
  if (!Number.isSafeInteger(stats.uid) || stats.uid !== expectedUid) {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
  const permissions = stats.mode & 0o777;
  if (
    (exactMode === null && (permissions & 0o022) !== 0) ||
    (exactMode !== null && permissions !== exactMode)
  ) {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
}

/**
 * Validate one existing trusted ancestor without creating or changing it.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Existing ancestor.
 * @param {number} expectedUid - Required owner.
 * @returns {Promise<void>} - Resolves for a real non-writable directory.
 */
async function assertTrustedDirectory(fsOps, directory, expectedUid) {
  const stats = await fsOps.lstat(directory);
  assertPrivateStats(stats, 'directory', expectedUid, null);
}

/**
 * Create one direct child and then authenticate its exact private envelope.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Direct child.
 * @param {number} expectedUid - Required owner.
 * @returns {Promise<void>} - Resolves for a real 0700 directory.
 */
async function ensurePrivateDirectory(fsOps, directory, expectedUid) {
  const parent = path.dirname(directory);
  await assertTrustedDirectory(fsOps, parent, expectedUid);
  try {
    await fsOps.mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  const stats = await fsOps.lstat(directory);
  assertPrivateStats(stats, 'directory', expectedUid, PRIVATE_DIRECTORY_MODE);
  // Sync even an existing entry. This repairs the durability boundary after
  // either a prior mkdir response loss or a parent-fsync failure.
  await syncDirectory(fsOps, parent);
}

/**
 * Sync the containing directory after rename or unlink.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Authenticated directory.
 * @returns {Promise<void>} - Resolves after fsync.
 */
async function syncDirectory(fsOps, directory) {
  const handle = await fsOps.open(
    directory,
    fsConstants.O_RDONLY | (fsConstants.O_DIRECTORY || 0),
  );
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Read a directory incrementally so a corrupt namespace cannot allocate an
 * attacker-sized result before its finite entry bound is enforced.
 * @param {typeof fsp} fsOps - Filesystem implementation.
 * @param {string} directory - Authenticated directory.
 * @param {number} maximum - Maximum accepted entries.
 * @returns {Promise<import('node:fs').Dirent[]>} - Bounded entries.
 */
async function readBoundedDirectory(fsOps, directory, maximum) {
  const opened = await fsOps.opendir(directory);
  /** @type {import('node:fs').Dirent[]} */
  const entries = [];
  try {
    while (true) {
      const entry = await opened.read();
      if (entry === null) break;
      entries.push(entry);
      if (entries.length > maximum) {
        throw new AwsSingleNodeHostActivationPersistenceCapacityError();
      }
    }
  } finally {
    await opened.close().catch((error) => {
      if (!hasCode(error, 'ERR_DIR_CLOSED')) throw error;
    });
  }
  return entries;
}

/**
 * Read one bounded private record through a no-follow descriptor.
 * @param {{fsOps: typeof fsp, filePath: string, expectedUid: number, maxBytes: number, maximumFileLinks?: number}} options - Record boundary.
 * @returns {Promise<{text: string, stats: import('node:fs').Stats}|null>} - Stable bytes and identity, or null.
 */
async function readPrivateText(options) {
  let handle;
  try {
    handle = await options.fsOps.open(
      options.filePath,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    );
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  try {
    const before = await handle.stat();
    assertPrivateStats(
      before,
      'file',
      options.expectedUid,
      PRIVATE_FILE_MODE,
      options.maximumFileLinks,
    );
    if (
      !Number.isSafeInteger(before.size) ||
      before.size < 1 ||
      before.size > options.maxBytes
    ) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
    const text = await handle.readFile({ encoding: 'utf8' });
    const after = await handle.stat();
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      Buffer.byteLength(text, 'utf8') !== before.size ||
      Buffer.byteLength(text, 'utf8') > options.maxBytes
    ) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
    return { text, stats: before };
  } finally {
    await handle.close();
  }
}

/** @param {unknown} value @returns {string} */
function canonicalRecordText(value) {
  return `${JSON.stringify(value)}\n`;
}

/**
 * Bind the shared production state root to one Linux network namespace for
 * this boot. Abstract AF_UNIX addresses are network-namespace-local, while
 * `/var/lib` may be shared across namespaces. The filesystem-wide O_EXCL
 * claim ensures two namespaces can never both rely on disjoint abstract
 * locks for the same durable files.
 * @param {string} stateRoot - Fixed authenticated v1 state root.
 * @returns {Promise<void>} - Resolves for the one claimed namespace.
 */
async function claimProductionLockNamespace(stateRoot) {
  const bootIdText = await fsp.readFile(
    '/proc/sys/kernel/random/boot_id',
    'utf8',
  );
  const bootId = bootIdText.trim();
  if (
    !BOOT_ID_PATTERN.test(bootId) ||
    Buffer.byteLength(bootIdText, 'utf8') > 128
  ) {
    throw new AwsSingleNodeHostActivationPersistenceInitializationError();
  }
  const [selfNamespace, initNamespace] = await Promise.all([
    fsp.stat('/proc/self/ns/net'),
    fsp.stat('/proc/1/ns/net'),
  ]);
  if (
    selfNamespace.dev !== initNamespace.dev ||
    selfNamespace.ino !== initNamespace.ino
  ) {
    throw new AwsSingleNodeHostActivationPersistenceInitializationError();
  }
  const claim = Object.freeze({
    bootId,
    kind: LOCK_NAMESPACE_CLAIM_KIND,
    netNamespaceDevice: String(selfNamespace.dev),
    netNamespaceInode: String(selfNamespace.ino),
    schemaVersion: 1,
  });
  const claimPath = path.join(stateRoot, `.lock-namespace.${bootId}.json`);
  const expectedText = canonicalRecordText(claim);
  const temporaryPath = path.join(
    stateRoot,
    `.lock-namespace.${bootId}.${randomUUID()}.tmp`,
  );
  let handle;
  let temporaryCreated = false;
  let linked = false;
  try {
    handle = await fsp.open(
      temporaryPath,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        (fsConstants.O_NOFOLLOW || 0),
      PRIVATE_FILE_MODE,
    );
    temporaryCreated = true;
    try {
      await handle.writeFile(expectedText, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
      handle = undefined;
    }
    try {
      // Hard-link publication is one filesystem-wide no-replace CAS. Unlike
      // opening the final path O_EXCL, a crash can expose only absent or
      // complete fsynced claim bytes, never a truncated final claim.
      await fsp.link(temporaryPath, claimPath);
      linked = true;
      await syncDirectory(fsp, stateRoot);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  } finally {
    await handle?.close().catch(() => undefined);
    if (temporaryCreated) {
      await fsp.unlink(temporaryPath).catch(() => undefined);
      // Make normal successful claims single-linked and establish any
      // response-lost link/unlink result. Recovery also accepts two links
      // after a crash between claim fsync and this cleanup.
      await syncDirectory(fsp, stateRoot);
    }
  }
  if (!linked) {
    let matched = false;
    for (let attempt = 0; attempt < 100 && !matched; attempt += 1) {
      let stored = null;
      try {
        stored = await readPrivateText({
          fsOps: fsp,
          filePath: claimPath,
          expectedUid: 0,
          maxBytes: LOCK_NAMESPACE_CLAIM_MAX_BYTES,
          maximumFileLinks: 2,
        });
      } catch (error) {
        if (
          !(error instanceof AwsSingleNodeHostActivationPersistenceCorruptError)
        ) {
          throw error;
        }
      }
      if (stored !== null) {
        try {
          const parsed = JSON.parse(stored.text);
          exactDataObject(
            parsed,
            LOCK_NAMESPACE_CLAIM_KEYS,
            'AWS single-node host activation lock namespace claim',
          );
          matched =
            stored.text === expectedText &&
            parsed.schemaVersion === 1 &&
            parsed.kind === LOCK_NAMESPACE_CLAIM_KIND &&
            parsed.bootId === bootId &&
            parsed.netNamespaceDevice === claim.netNamespaceDevice &&
            parsed.netNamespaceInode === claim.netNamespaceInode;
        } catch {
          matched = false;
        }
      }
      if (!matched) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (!matched) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
  }
  // Sync on both the creating and observing paths. This repairs a winner's
  // prior directory-fsync response loss before any abstract lock is trusted.
  await syncDirectory(fsp, stateRoot);
}

/**
 * Parse and require exact canonical serialization.
 * @template T
 * @param {string} text - Stable UTF-8 bytes.
 * @param {(value: unknown) => T} validate - Canonical validator.
 * @returns {T} - Canonical record.
 */
function parseCanonicalRecord(text, validate) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
  let canonical;
  try {
    canonical = validate(parsed);
  } catch {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
  if (text !== canonicalRecordText(canonical)) {
    throw new AwsSingleNodeHostActivationPersistenceCorruptError();
  }
  return canonical;
}

/**
 * Atomically replace one authenticated private record.
 * @param {{fsOps: typeof fsp, filePath: string, text: string, expectedUid: number, temporaryPath: string}} options - Publication.
 * @returns {Promise<void>} - Resolves after file and directory durability.
 */
async function writePrivateTextAtomic(options) {
  const parent = path.dirname(options.filePath);
  await assertTrustedDirectory(options.fsOps, parent, options.expectedUid);
  let handle;
  let renameAttempted = false;
  try {
    handle = await options.fsOps.open(
      options.temporaryPath,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        (fsConstants.O_NOFOLLOW || 0),
      PRIVATE_FILE_MODE,
    );
    await handle.writeFile(options.text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    renameAttempted = true;
    await options.fsOps.rename(options.temporaryPath, options.filePath);
    const published = await options.fsOps.lstat(options.filePath);
    assertPrivateStats(
      published,
      'file',
      options.expectedUid,
      PRIVATE_FILE_MODE,
    );
    await syncDirectory(options.fsOps, parent);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    if (renameAttempted) {
      try {
        // A rename that reported failure may nevertheless have committed.
        // Establish directory durability before readback can recover the CAS.
        await syncDirectory(options.fsOps, parent);
      } catch {
        throw new PersistenceDurabilityUncertainError();
      }
    }
    await options.fsOps.unlink(options.temporaryPath).catch(() => undefined);
    throw error;
  }
}

/** @param {Readonly<Record<string, any>>} fence @param {Readonly<Record<string, any>>} state @returns {boolean} */
function fenceExactlyNamesState(fence, state) {
  const request = state.request;
  return (
    fence.deploymentInstanceId === request.deploymentInstanceId &&
    fence.incarnationId === request.incarnationId &&
    fence.nodeProviderResourceId === request.nodeProviderResourceId &&
    fence.requestId === request.requestId &&
    fence.authorizedHeadGeneration === request.authorizedHeadGeneration
  );
}

/**
 * Classify one state only from the durable local fence. This does not replace
 * the independently authenticated controller authority check.
 * @param {Readonly<Record<string, any>>|null} fence - Current local fence.
 * @param {Readonly<Record<string, any>>} state - Retained state.
 * @returns {'current'|'superseded'|'unclaimed'|'ambiguous'} - Local relation.
 */
function classifyState(fence, state) {
  if (fence === null) return 'unclaimed';
  if (fenceExactlyNamesState(fence, state)) return 'current';
  if (state.request.authorizedHeadGeneration < fence.authorizedHeadGeneration) {
    return 'superseded';
  }
  if (state.request.authorizedHeadGeneration > fence.authorizedHeadGeneration) {
    return 'unclaimed';
  }
  return 'ambiguous';
}

/** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {number} */
function newestStateFirst(left, right) {
  if (
    left.request.authorizedHeadGeneration !==
    right.request.authorizedHeadGeneration
  ) {
    return left.request.authorizedHeadGeneration >
      right.request.authorizedHeadGeneration
      ? -1
      : 1;
  }
  if (left.request.requestId < right.request.requestId) return -1;
  if (left.request.requestId > right.request.requestId) return 1;
  return 0;
}

/**
 * Create the concrete durable V66 store, deployment lock, and inspection
 * boundary from authenticated filesystem and socket dependencies. This
 * lower-level constructor permits an expected non-root UID only so focused
 * tests can exercise real filesystem behavior; the production opener below
 * requires Linux real/effective UID 0 and supplies only native dependencies.
 *
 * @param {unknown} value - Exact construction options.
 * @returns {Promise<Readonly<{store: Readonly<Record<string, Function>>, withHostLock: Function, inspectActivation: Function, close: () => Promise<void>}>>} - Open persistence.
 */
export async function createAwsSingleNodeHostActivationPersistence(value) {
  const options = exactDataObject(
    value,
    CREATE_OPTION_KEYS,
    'AWS single-node host activation persistence options',
  );
  assertDeploymentInstanceId(
    options.deploymentInstanceId,
    'AWS single-node host activation persistence deploymentInstanceId',
  );
  const deploymentInstanceId = options.deploymentInstanceId;
  const stateDirectory = canonicalAbsolutePath(
    options.stateDirectory,
    'AWS single-node host activation persistence stateDirectory',
  );
  const expectedUid = nonnegativeSafeInteger(
    options.expectedUid,
    'AWS single-node host activation persistence expectedUid',
  );
  const fsOps = options.fsOps;
  if (
    !fsOps ||
    typeof fsOps !== 'object' ||
    ['lstat', 'mkdir', 'open', 'opendir', 'rename', 'unlink'].some(
      (method) => typeof fsOps[method] !== 'function',
    )
  ) {
    throw new TypeError(
      'AWS single-node host activation persistence fsOps is invalid.',
    );
  }
  if (typeof options.createServer !== 'function') {
    throw new TypeError(
      'AWS single-node host activation persistence createServer must be a function.',
    );
  }
  if (typeof options.createToken !== 'function') {
    throw new TypeError(
      'AWS single-node host activation persistence createToken must be a function.',
    );
  }
  const retainedSupersededStates = positiveSafeInteger(
    options.retainedSupersededStates,
    'AWS single-node host activation persistence retainedSupersededStates',
  );
  if (
    retainedSupersededStates >
    AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES
  ) {
    throw new TypeError(
      'AWS single-node host activation persistence retainedSupersededStates is too large.',
    );
  }
  const statesDirectory = path.join(stateDirectory, STATES_DIRECTORY_NAME);
  const fencePath = path.join(stateDirectory, FENCE_FILE_NAME);
  const lockScope = JSON.stringify([
    String(expectedUid),
    deploymentInstanceId,
    stateDirectory,
  ]);

  /** @returns {string} */
  function nextToken() {
    const token = options.createToken();
    if (typeof token !== 'string' || !TEMP_TOKEN_PATTERN.test(token)) {
      throw new TypeError(
        'AWS single-node host activation persistence token is invalid.',
      );
    }
    return token;
  }

  /** @param {string} requestId @returns {string} */
  function getStatePath(requestId) {
    assertDomainSeparatedSha256Id(
      requestId,
      AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
      'AWS single-node host activation persistence requestId',
    );
    return path.join(statesDirectory, `${requestId}.json`);
  }

  /** @returns {Promise<() => Promise<void>>} */
  async function acquireHostLock() {
    try {
      return await acquireLinuxAbstractOperationLock({
        domain: HOST_LOCK_DOMAIN,
        scope: lockScope,
        createServer: options.createServer,
      });
    } catch (error) {
      if (error instanceof LinuxAbstractOperationLockBusyError) {
        throw new AwsSingleNodeHostActivationPersistenceLockBusyError();
      }
      throw error;
    }
  }

  /** @returns {Promise<() => Promise<void>>} */
  async function acquireTransactionLock() {
    for (let attempt = 0; attempt < TRANSACTION_LOCK_ATTEMPTS; attempt += 1) {
      try {
        return await acquireLinuxAbstractOperationLock({
          domain: TRANSACTION_LOCK_DOMAIN,
          scope: lockScope,
          createServer: options.createServer,
        });
      } catch (error) {
        if (!(error instanceof LinuxAbstractOperationLockBusyError)) {
          throw error;
        }
        if (attempt + 1 === TRANSACTION_LOCK_ATTEMPTS) {
          throw new AwsSingleNodeHostActivationPersistenceOperationError();
        }
        await new Promise((resolve) =>
          setTimeout(resolve, TRANSACTION_LOCK_WAIT_MS),
        );
      }
    }
    throw new AwsSingleNodeHostActivationPersistenceOperationError();
  }

  /** @template T @param {() => Promise<T>} operation @returns {Promise<T>} */
  async function withTransaction(operation) {
    const release = await acquireTransactionLock();
    try {
      return await operation();
    } finally {
      await release();
    }
  }

  /** @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readFenceRaw() {
    await assertTrustedDirectory(fsOps, stateDirectory, expectedUid);
    const stored = await readPrivateText({
      fsOps,
      filePath: fencePath,
      expectedUid,
      maxBytes: AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_MAX_BYTES + 1,
    });
    if (stored === null) return null;
    const fence = parseCanonicalRecord(
      stored.text,
      validateAwsSingleNodeHostActivationFence,
    );
    if (fence.deploymentInstanceId !== deploymentInstanceId) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
    return fence;
  }

  /**
   * @param {string} requestId - Exact request key.
   * @returns {Promise<{state: Readonly<Record<string, any>>, stats: import('node:fs').Stats}|null>}
   */
  async function readStateRaw(requestId) {
    await assertTrustedDirectory(fsOps, statesDirectory, expectedUid);
    const stored = await readPrivateText({
      fsOps,
      filePath: getStatePath(requestId),
      expectedUid,
      maxBytes: AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_MAX_BYTES + 1,
    });
    if (stored === null) return null;
    const state = parseCanonicalRecord(
      stored.text,
      validateAwsSingleNodeHostActivationState,
    );
    if (
      state.request.requestId !== requestId ||
      state.request.deploymentInstanceId !== deploymentInstanceId
    ) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
    return { state, stats: stored.stats };
  }

  /**
   * Validate and read every bounded state-directory entry. Strictly patterned
   * private temporary files are the only entries cleanup may remove without
   * parsing as durable state.
   * @returns {Promise<Array<{state: Readonly<Record<string, any>>, stats: import('node:fs').Stats, filePath: string}>>}
   */
  async function scanStatesAndCleanTemps() {
    await assertTrustedDirectory(fsOps, statesDirectory, expectedUid);
    const entries = await readBoundedDirectory(
      fsOps,
      statesDirectory,
      AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES +
        MAX_STATE_TEMP_RECOVERY_ENTRIES,
    );
    /** @type {Array<{state: Readonly<Record<string, any>>, stats: import('node:fs').Stats, filePath: string}>} */
    const states = [];
    let removedTemporary = false;
    let temporaryCount = 0;
    for (const entry of entries) {
      const filePath = path.join(statesDirectory, entry.name);
      const temporary = STATE_TEMP_PATTERN.exec(entry.name);
      if (temporary) {
        temporaryCount += 1;
        if (temporaryCount > MAX_STATE_TEMP_RECOVERY_ENTRIES) {
          throw new AwsSingleNodeHostActivationPersistenceCapacityError();
        }
        try {
          assertDomainSeparatedSha256Id(
            temporary[1],
            AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
            'AWS single-node host activation persistence temporary requestId',
          );
        } catch {
          throw new AwsSingleNodeHostActivationPersistenceCorruptError();
        }
        const stats = await fsOps.lstat(filePath);
        assertPrivateStats(stats, 'file', expectedUid, PRIVATE_FILE_MODE);
        await fsOps.unlink(filePath);
        removedTemporary = true;
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        throw new AwsSingleNodeHostActivationPersistenceCorruptError();
      }
      const requestId = entry.name.slice(0, -'.json'.length);
      let stored;
      try {
        stored = await readStateRaw(requestId);
      } catch (error) {
        if (error instanceof TypeError) {
          throw new AwsSingleNodeHostActivationPersistenceCorruptError();
        }
        throw error;
      }
      if (stored === null) {
        throw new AwsSingleNodeHostActivationPersistenceCorruptError();
      }
      states.push({ ...stored, filePath });
    }
    if (
      states.length >
      AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES
    ) {
      throw new AwsSingleNodeHostActivationPersistenceCapacityError();
    }
    if (removedTemporary) await syncDirectory(fsOps, statesDirectory);
    return states;
  }

  /**
   * Remove only deterministic excess history that the current local fence
   * proves superseded. Current, same-generation ambiguous, and higher
   * state-before-fence records are never pruned.
   * @returns {Promise<void>}
   */
  async function cleanupAndRetainRaw() {
    const fence = await readFenceRaw();
    const records = await scanStatesAndCleanTemps();
    if (fence === null) return;
    const current = records.find(
      ({ state }) => state.request.requestId === fence.requestId,
    );
    if (
      current === undefined ||
      !fenceExactlyNamesState(fence, current.state)
    ) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
    const superseded = records
      .filter(({ state }) => classifyState(fence, state) === 'superseded')
      .sort((left, right) => newestStateFirst(left.state, right.state));
    const removals = superseded.slice(retainedSupersededStates);
    if (removals.length === 0) return;
    for (const record of removals) {
      const before = await fsOps.lstat(record.filePath);
      assertPrivateStats(before, 'file', expectedUid, PRIVATE_FILE_MODE);
      if (before.dev !== record.stats.dev || before.ino !== record.stats.ino) {
        throw new AwsSingleNodeHostActivationPersistenceCorruptError();
      }
      await fsOps.unlink(record.filePath);
    }
    await syncDirectory(fsOps, statesDirectory);
  }

  /**
   * Remove a strictly patterned fence temp left by a process that died before
   * rename. The transaction lock proves no live writer owns it.
   * @returns {Promise<void>}
   */
  async function cleanFenceTempsRaw() {
    const entries = await readBoundedDirectory(
      fsOps,
      stateDirectory,
      MAX_DEPLOYMENT_DIRECTORY_ENTRIES,
    );
    let removedTemporary = false;
    for (const entry of entries) {
      if (
        entry.name === FENCE_FILE_NAME ||
        entry.name === STATES_DIRECTORY_NAME
      ) {
        continue;
      }
      if (!FENCE_TEMP_PATTERN.test(entry.name)) {
        throw new AwsSingleNodeHostActivationPersistenceCorruptError();
      }
      const filePath = path.join(stateDirectory, entry.name);
      const stats = await fsOps.lstat(filePath);
      assertPrivateStats(stats, 'file', expectedUid, PRIVATE_FILE_MODE);
      await fsOps.unlink(filePath);
      removedTemporary = true;
    }
    if (removedTemporary) await syncDirectory(fsOps, stateDirectory);
  }

  /**
   * Establish and authenticate the complete test/host-owned directory, then
   * recover bounded temp files and retention while excluding a live host.
   * @returns {Promise<void>}
   */
  async function initialize() {
    await assertTrustedDirectory(
      fsOps,
      path.dirname(stateDirectory),
      expectedUid,
    );
    await ensurePrivateDirectory(fsOps, stateDirectory, expectedUid);
    await ensurePrivateDirectory(fsOps, statesDirectory, expectedUid);
    const releaseHost = await acquireHostLock();
    try {
      await withTransaction(async () => {
        await cleanFenceTempsRaw();
        await cleanupAndRetainRaw();
      });
    } finally {
      await releaseHost();
    }
  }

  try {
    await initialize();
  } catch (error) {
    if (
      error instanceof TypeError ||
      error instanceof AwsSingleNodeHostActivationPersistenceLockBusyError ||
      error instanceof AwsSingleNodeHostActivationPersistenceCorruptError ||
      error instanceof AwsSingleNodeHostActivationPersistenceCapacityError
    ) {
      throw error;
    }
    throw new AwsSingleNodeHostActivationPersistenceInitializationError();
  }

  const admittedHostLock = new AsyncLocalStorage();
  let poisoned = false;
  let closing = false;
  let activeCount = 0;
  /** @type {(() => void)|undefined} */
  let resolveDrained;
  /** @type {Promise<void>|undefined} */
  let closePromise;

  /** @returns {void} */
  function assertOpen() {
    if (poisoned) {
      throw new AwsSingleNodeHostActivationPersistenceCorruptError();
    }
    const admission = admittedHostLock.getStore();
    if (admission && admission.active !== true) {
      throw new AwsSingleNodeHostActivationPersistenceOperationError();
    }
    if (closing && (!admission || admission.active !== true)) {
      throw new AwsSingleNodeHostActivationPersistenceClosedError();
    }
  }

  /** @returns {void} */
  function leave() {
    activeCount -= 1;
    if (activeCount === 0 && resolveDrained) {
      const resolve = resolveDrained;
      resolveDrained = undefined;
      resolve();
    }
  }

  /** @template T @param {() => T|Promise<T>} operation @returns {Promise<T>} */
  function enter(operation) {
    assertOpen();
    const admission = admittedHostLock.getStore();
    activeCount += 1;
    if (admission) admission.nestedCount += 1;
    /** @returns {void} */
    function leaveEnteredOperation() {
      if (admission) {
        admission.nestedCount -= 1;
        if (admission.nestedCount === 0 && admission.resolveNested) {
          const resolve = admission.resolveNested;
          admission.resolveNested = undefined;
          resolve();
        }
      }
      leave();
    }
    try {
      return Promise.resolve(operation()).finally(leaveEnteredOperation);
    } catch (error) {
      leaveEnteredOperation();
      throw error;
    }
  }

  /**
   * Convert unexpected backend detail into one fixed host-safe error.
   * @template T
   * @param {() => Promise<T>} operation - Entered operation.
   * @returns {Promise<T>} - Result.
   */
  async function protectOperation(operation) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof PersistenceDurabilityUncertainError) {
        poisoned = true;
        throw new AwsSingleNodeHostActivationPersistenceCorruptError();
      }
      if (
        error instanceof TypeError ||
        error instanceof AwsSingleNodeHostActivationPersistenceClosedError ||
        error instanceof AwsSingleNodeHostActivationPersistenceLockBusyError ||
        error instanceof AwsSingleNodeHostActivationPersistenceCorruptError ||
        error instanceof AwsSingleNodeHostActivationPersistenceCapacityError ||
        error instanceof AwsSingleNodeHostActivationPersistenceOperationError
      ) {
        throw error;
      }
      throw new AwsSingleNodeHostActivationPersistenceOperationError();
    }
  }

  /**
   * @param {unknown} value - Exact host-lock identity.
   * @param {unknown} operation - Complete deployment operation.
   * @returns {Promise<unknown>} - Callback result.
   */
  function withHostLock(value, operation) {
    const identity = exactDataObject(
      value,
      HOST_LOCK_INPUT_KEYS,
      'AWS single-node host activation lock identity',
    );
    assertDeploymentInstanceId(
      identity.deploymentInstanceId,
      'AWS single-node host activation lock deploymentInstanceId',
    );
    if (identity.deploymentInstanceId !== deploymentInstanceId) {
      throw new TypeError(
        'AWS single-node host activation lock deploymentInstanceId does not match this store.',
      );
    }
    if (typeof operation !== 'function') {
      throw new TypeError(
        'AWS single-node host activation lock operation must be a function.',
      );
    }
    return enter(() =>
      protectOperation(async () => {
        const release = await acquireHostLock();
        const admission = {
          active: true,
          nestedCount: 0,
          /** @type {(() => void)|undefined} */
          resolveNested: undefined,
        };
        try {
          await withTransaction(async () => {
            await cleanFenceTempsRaw();
            await cleanupAndRetainRaw();
          });
          try {
            return await admittedHostLock.run(
              admission,
              /** @type {() => unknown} */ (operation),
            );
          } finally {
            admission.active = false;
            if (admission.nestedCount !== 0) {
              await new Promise((resolve) => {
                admission.resolveNested = () => resolve(undefined);
              });
            }
          }
        } finally {
          await release();
        }
      }),
    );
  }

  /**
   * @param {string} value - Deployment key.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - Fence.
   */
  function readActivationFence(value) {
    assertDeploymentInstanceId(
      value,
      'AWS single-node host activation store deploymentInstanceId',
    );
    if (value !== deploymentInstanceId) {
      throw new TypeError(
        'AWS single-node host activation store deploymentInstanceId does not match this store.',
      );
    }
    return enter(() => protectOperation(readFenceRaw));
  }

  /**
   * @param {unknown} value - Exact fence CAS.
   * @returns {Promise<boolean>} - Literal definite winner.
   */
  function compareAndSetActivationFence(value) {
    const input = exactDataObject(
      value,
      FENCE_CAS_INPUT_KEYS,
      'AWS single-node host activation fence CAS',
    );
    assertDeploymentInstanceId(
      input.deploymentInstanceId,
      'AWS single-node host activation fence CAS deploymentInstanceId',
    );
    if (input.deploymentInstanceId !== deploymentInstanceId) {
      throw new TypeError(
        'AWS single-node host activation fence CAS deploymentInstanceId does not match this store.',
      );
    }
    if (input.expectedFenceId !== null) {
      assertDomainSeparatedSha256Id(
        input.expectedFenceId,
        AWS_SINGLE_NODE_HOST_ACTIVATION_FENCE_ID_PREFIX,
        'AWS single-node host activation fence CAS expectedFenceId',
      );
    }
    const nextFence = validateAwsSingleNodeHostActivationFence(
      input.nextFence,
      'AWS single-node host activation fence CAS nextFence',
    );
    if (nextFence.deploymentInstanceId !== deploymentInstanceId) {
      throw new TypeError(
        'AWS single-node host activation fence CAS nextFence does not match this store.',
      );
    }
    return enter(() =>
      protectOperation(() =>
        withTransaction(async () => {
          await cleanupAndRetainRaw();
          const current = await readFenceRaw();
          if ((current?.fenceId ?? null) !== input.expectedFenceId) {
            return false;
          }
          if (current?.fenceId === nextFence.fenceId) return false;
          if (
            nextFence.recordVersion !==
            (current === null ? 1 : current.recordVersion + 1)
          ) {
            throw new TypeError(
              'AWS single-node host activation fence CAS recordVersion is not the exact successor.',
            );
          }
          if (
            current !== null &&
            (nextFence.requestId === current.requestId ||
              nextFence.authorizedHeadGeneration <=
                current.authorizedHeadGeneration)
          ) {
            throw new TypeError(
              'AWS single-node host activation fence CAS must advance to a higher request generation.',
            );
          }
          const nextState = await readStateRaw(nextFence.requestId);
          if (
            nextState === null ||
            !fenceExactlyNamesState(nextFence, nextState.state)
          ) {
            throw new TypeError(
              'AWS single-node host activation fence CAS requires its complete durable request state.',
            );
          }
          const token = nextToken();
          await writePrivateTextAtomic({
            fsOps,
            filePath: fencePath,
            text: canonicalRecordText(nextFence),
            expectedUid,
            temporaryPath: path.join(stateDirectory, `.fence.${token}.tmp`),
          });
          await cleanupAndRetainRaw();
          return true;
        }),
      ),
    );
  }

  /**
   * @param {string} value - Request key.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - State.
   */
  function readActivationState(value) {
    getStatePath(value);
    return enter(() =>
      protectOperation(async () => (await readStateRaw(value))?.state ?? null),
    );
  }

  /**
   * @param {unknown} value - Exact state CAS.
   * @returns {Promise<boolean>} - Literal definite winner.
   */
  function compareAndSetActivationState(value) {
    const input = exactDataObject(
      value,
      STATE_CAS_INPUT_KEYS,
      'AWS single-node host activation state CAS',
    );
    getStatePath(input.requestId);
    if (input.expectedStateId !== null) {
      assertDomainSeparatedSha256Id(
        input.expectedStateId,
        AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ID_PREFIX,
        'AWS single-node host activation state CAS expectedStateId',
      );
    }
    const nextState = validateAwsSingleNodeHostActivationState(
      input.nextState,
      'AWS single-node host activation state CAS nextState',
    );
    if (
      nextState.request.requestId !== input.requestId ||
      nextState.request.deploymentInstanceId !== deploymentInstanceId
    ) {
      throw new TypeError(
        'AWS single-node host activation state CAS nextState does not match this store.',
      );
    }
    return enter(() =>
      protectOperation(() =>
        withTransaction(async () => {
          const current = await readStateRaw(input.requestId);
          if ((current?.state.stateId ?? null) !== input.expectedStateId) {
            return false;
          }
          if (current?.state.stateId === nextState.stateId) return false;
          if (
            nextState.recordVersion !==
            (current === null ? 1 : current.state.recordVersion + 1)
          ) {
            throw new TypeError(
              'AWS single-node host activation state CAS recordVersion is not the exact successor.',
            );
          }
          if (
            current !== null &&
            JSON.stringify(current.state.request) !==
              JSON.stringify(nextState.request)
          ) {
            throw new TypeError(
              'AWS single-node host activation state CAS cannot replace its immutable request.',
            );
          }
          const entries = await readBoundedDirectory(
            fsOps,
            statesDirectory,
            AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES,
          );
          if (
            current === null &&
            entries.length >=
              AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES
          ) {
            throw new AwsSingleNodeHostActivationPersistenceCapacityError();
          }
          const token = nextToken();
          await writePrivateTextAtomic({
            fsOps,
            filePath: getStatePath(input.requestId),
            text: canonicalRecordText(nextState),
            expectedUid,
            temporaryPath: path.join(
              statesDirectory,
              `.state.${input.requestId}.${token}.tmp`,
            ),
          });
          return true;
        }),
      ),
    );
  }

  const store = Object.freeze({
    readActivationFence,
    compareAndSetActivationFence,
    readActivationState,
    compareAndSetActivationState,
  });

  /**
   * Read one state together with its current local-fence relation. This is
   * local durable truth only; `authority` is intentionally not a claim that
   * the controller still authorizes the request.
   * @param {unknown} value - Exact request selector.
   * @returns {Promise<Readonly<Record<string, any>>|null>} - Frozen inspection.
   */
  function inspectActivation(value) {
    const input = exactDataObject(
      value,
      INSPECT_INPUT_KEYS,
      'AWS single-node host activation persistence inspection',
    );
    getStatePath(input.requestId);
    return enter(() =>
      protectOperation(async () => {
        const release = await acquireHostLock();
        try {
          return await withTransaction(async () => {
            await cleanFenceTempsRaw();
            await cleanupAndRetainRaw();
            const stored = await readStateRaw(input.requestId);
            if (stored === null) return null;
            const fence = await readFenceRaw();
            const inspection = {
              authority: classifyState(fence, stored.state),
              fence,
              state: stored.state,
            };
            exactDataObject(
              inspection,
              INSPECTION_KEYS,
              'AWS single-node host activation persistence inspection result',
            );
            return deepFreeze(inspection);
          });
        } finally {
          await release();
        }
      }),
    );
  }

  /** @returns {Promise<void>} - Memoized draining close. */
  function close() {
    const admission = admittedHostLock.getStore();
    if (admission) {
      return Promise.reject(
        new AwsSingleNodeHostActivationPersistenceCloseError(),
      );
    }
    if (!closePromise) {
      closing = true;
      closePromise = (async () => {
        if (activeCount !== 0) {
          await new Promise((resolve) => {
            resolveDrained = () => resolve(undefined);
          });
        }
      })().catch(() => {
        throw new AwsSingleNodeHostActivationPersistenceCloseError();
      });
    }
    return closePromise;
  }

  return Object.freeze({ store, withHostLock, inspectActivation, close });
}

/**
 * Open the production Linux/root persistence boundary at the one fixed
 * `/var/lib` layout. Caller input cannot redirect durable root state.
 * @param {unknown} value - Exact `{deploymentInstanceId}`.
 * @returns {Promise<Readonly<{store: Readonly<Record<string, Function>>, withHostLock: Function, inspectActivation: Function, close: () => Promise<void>}>>} - Open persistence.
 */
export async function openAwsSingleNodeHostActivationPersistence(value) {
  const options = exactDataObject(
    value,
    OPEN_OPTION_KEYS,
    'AWS single-node host activation persistence opener options',
  );
  assertDeploymentInstanceId(
    options.deploymentInstanceId,
    'AWS single-node host activation persistence opener deploymentInstanceId',
  );
  if (
    process.platform !== 'linux' ||
    typeof process.getuid !== 'function' ||
    typeof process.geteuid !== 'function' ||
    process.getuid() !== 0 ||
    process.geteuid() !== 0
  ) {
    throw new AwsSingleNodeHostActivationPersistenceInitializationError();
  }

  try {
    for (const trusted of ['/var', '/var/lib']) {
      await assertTrustedDirectory(fsp, trusted, 0);
    }
    let parent = '/var/lib';
    for (const child of ['wharfie', 'host-activation', 'v1']) {
      const directory = path.join(parent, child);
      await ensurePrivateDirectory(fsp, directory, 0);
      parent = directory;
    }
    await claimProductionLockNamespace(
      AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ROOT,
    );
    return await createAwsSingleNodeHostActivationPersistence({
      deploymentInstanceId: options.deploymentInstanceId,
      stateDirectory: path.join(
        AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ROOT,
        options.deploymentInstanceId,
      ),
      expectedUid: 0,
      fsOps: fsp,
      createServer: net.createServer,
      createToken: randomUUID,
      retainedSupersededStates:
        AWS_SINGLE_NODE_HOST_ACTIVATION_RETAINED_SUPERSEDED_STATES,
    });
  } catch (error) {
    if (
      error instanceof AwsSingleNodeHostActivationPersistenceLockBusyError ||
      error instanceof AwsSingleNodeHostActivationPersistenceCorruptError ||
      error instanceof AwsSingleNodeHostActivationPersistenceCapacityError
    ) {
      throw error;
    }
    throw new AwsSingleNodeHostActivationPersistenceInitializationError();
  }
}

export default {
  AWS_SINGLE_NODE_HOST_ACTIVATION_MAX_STATE_DIRECTORY_ENTRIES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_RETAINED_SUPERSEDED_STATES,
  AWS_SINGLE_NODE_HOST_ACTIVATION_STATE_ROOT,
  AwsSingleNodeHostActivationPersistenceCapacityError,
  AwsSingleNodeHostActivationPersistenceCloseError,
  AwsSingleNodeHostActivationPersistenceClosedError,
  AwsSingleNodeHostActivationPersistenceCorruptError,
  AwsSingleNodeHostActivationPersistenceInitializationError,
  AwsSingleNodeHostActivationPersistenceLockBusyError,
  AwsSingleNodeHostActivationPersistenceOperationError,
  createAwsSingleNodeHostActivationPersistence,
  openAwsSingleNodeHostActivationPersistence,
};
