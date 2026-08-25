/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact private helpers are not understood cleanly by the current JSDoc lint parser. */

import { constants as fsConstants } from 'node:fs';
import {
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rmdir,
  unlink,
} from 'node:fs/promises';
import {
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import path from 'node:path';

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
} from '../../content-id.js';
import { assertSingleNodeDeploymentInstanceId } from '../../single-node-deployment-identity.js';

export const HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION = 1;
export const HETZNER_CREDENTIAL_BINDING_KIND = 'hetznerCredentialBinding';
export const HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND =
  'hetznerCredentialBindingEvidence';
export const HETZNER_CREDENTIAL_BINDING_ID_DOMAIN =
  'wharfie:hetzner-credential-binding:v1';
export const HETZNER_CREDENTIAL_BINDING_ID_PREFIX = 'whcb1';
export const HETZNER_CREDENTIAL_BINDING_FILE_NAME = 'binding.json';
export const HETZNER_CREDENTIAL_TOKEN_MAX_BYTES = 4096;

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;
const SALT_BYTE_LENGTH = 32;
const BINDING_FILE_MAX_BYTES = 2048;
const MAX_REMOVAL_DIRECTORY_ENTRIES = 2;
const OPTIONS_ROOT_KEYS = new Set(['root']);
const OPTIONS_RANDOM_KEYS = new Set(['root', 'randomBytes']);
const ENSURE_KEYS = new Set(['deploymentInstanceId', 'token']);
const REQUIRE_KEYS = new Set(['deploymentInstanceId', 'token']);
const EVIDENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'bindingId',
]);
const BINDING_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'salt',
  'verifier',
]);
const BINDING_DOCUMENT_KEYS = new Set([...BINDING_PAYLOAD_KEYS, 'bindingId']);

let publicationSequence = 0;

/**
 * Stored credential-binding state is malformed or has an unsafe filesystem
 * envelope.
 */
export class HetznerCredentialBindingInvalidError extends Error {
  constructor() {
    super('Hetzner credential binding state is invalid.');
    this.name = 'HetznerCredentialBindingInvalidError';
    this.code = 'WHARFIE_HETZNER_CREDENTIAL_BINDING_INVALID';
  }
}

/** The requested deployment has no previously established credential binding. */
export class HetznerCredentialBindingMissingError extends Error {
  constructor() {
    super('Hetzner credential binding state is missing.');
    this.name = 'HetznerCredentialBindingMissingError';
    this.code = 'WHARFIE_HETZNER_CREDENTIAL_BINDING_MISSING';
  }
}

/**
 * The supplied credential is not the credential first bound to this
 * deployment.
 */
export class HetznerCredentialBindingMismatchError extends Error {
  constructor() {
    super(
      'Hetzner credential rotation is unsupported for this deployment preview.',
    );
    this.name = 'HetznerCredentialBindingMismatchError';
    this.code = 'WHARFIE_HETZNER_CREDENTIAL_BINDING_MISMATCH';
  }
}

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
 * @param {Set<string>} keys - Exact required keys.
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

/** @param {unknown} error @param {string} code @returns {boolean} */
function hasCode(error, code) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === code
  );
}

/**
 * @param {unknown} value - Candidate absolute root.
 * @returns {string} - Canonical root.
 */
function validateRoot(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(
      'hetznerCredentialBinding.root must be one canonical absolute path.',
    );
  }
  return value;
}

/**
 * @param {string} value - Candidate token.
 * @returns {boolean} - Whether the UTF-16 string has controls or lone surrogates.
 */
function hasInvalidTokenCodeUnit(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Validate exact token bytes without ever rendering them.
 * @param {unknown} value - Candidate token.
 * @returns {string} - Exact token.
 */
function validateToken(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    hasInvalidTokenCodeUnit(value) ||
    Buffer.byteLength(value, 'utf8') > HETZNER_CREDENTIAL_TOKEN_MAX_BYTES
  ) {
    throw new TypeError(
      'Hetzner credential must be nonempty, trimmed, control-free UTF-8 not exceeding 4096 bytes.',
    );
  }
  return value;
}

/**
 * @param {import('node:fs').Stats} stats - Filesystem state.
 * @param {'file'|'directory'} kind - Required concrete type.
 * @param {number} expectedUid - Required process owner.
 * @param {number} exactMode - Exact permission bits.
 * @param {number} [maximumFileLinks] - Maximum accepted file links.
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
  if (
    !correctKind ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== expectedUid ||
    (stats.mode & 0o777) !== exactMode ||
    (kind === 'file' &&
      (!Number.isSafeInteger(stats.nlink) ||
        stats.nlink < 1 ||
        stats.nlink > maximumFileLinks))
  ) {
    throw new HetznerCredentialBindingInvalidError();
  }
}

/**
 * Validate an existing owner-controlled ancestor. It need not be private, but
 * another account must not be able to replace its direct children.
 * @param {string} directory - Existing parent directory.
 * @param {number} expectedUid - Required process owner.
 * @returns {Promise<void>}
 */
async function assertTrustedParent(directory, expectedUid) {
  let stats;
  try {
    stats = await lstat(directory);
  } catch {
    throw new HetznerCredentialBindingInvalidError();
  }
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    !Number.isSafeInteger(stats.uid) ||
    stats.uid !== expectedUid ||
    (stats.mode & 0o022) !== 0
  ) {
    throw new HetznerCredentialBindingInvalidError();
  }
}

/**
 * Sync one authenticated directory.
 * @param {string} directory - Directory to sync.
 * @param {number} expectedUid - Required process owner.
 * @returns {Promise<void>}
 */
async function syncDirectory(directory, expectedUid) {
  const handle = await open(
    directory,
    fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY || 0) |
      (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    assertPrivateStats(
      await handle.stat(),
      'directory',
      expectedUid,
      PRIVATE_DIRECTORY_MODE,
    );
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Create one direct child and authenticate its exact private envelope.
 * @param {string} directory - Direct child directory.
 * @param {number} expectedUid - Required process owner.
 * @returns {Promise<void>}
 */
async function ensurePrivateDirectory(directory, expectedUid) {
  const parent = path.dirname(directory);
  await assertTrustedParent(parent, expectedUid);
  try {
    await mkdir(directory, { mode: PRIVATE_DIRECTORY_MODE });
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) throw error;
  }
  let stats;
  try {
    stats = await lstat(directory);
  } catch {
    throw new HetznerCredentialBindingInvalidError();
  }
  assertPrivateStats(stats, 'directory', expectedUid, PRIVATE_DIRECTORY_MODE);

  const parentHandle = await open(
    parent,
    fsConstants.O_RDONLY |
      (fsConstants.O_DIRECTORY || 0) |
      (fsConstants.O_NOFOLLOW || 0),
  );
  try {
    await parentHandle.sync();
  } finally {
    await parentHandle.close();
  }
}

/**
 * Inspect one private directory or return null for absence.
 * @param {string} directory - Exact directory.
 * @param {number} expectedUid - Required process owner.
 * @returns {Promise<import('node:fs').Stats|null>} - Directory state.
 */
async function inspectPrivateDirectoryIfPresent(directory, expectedUid) {
  let stats;
  try {
    stats = await lstat(directory);
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
  assertPrivateStats(stats, 'directory', expectedUid, PRIVATE_DIRECTORY_MODE);
  return stats;
}

/**
 * @param {unknown} value - Parsed binding payload.
 * @returns {Readonly<{schemaVersion: 1, kind: 'hetznerCredentialBinding', deploymentInstanceId: string, salt: string, verifier: string}>} - Canonical payload.
 */
function validateBindingPayload(value) {
  const payload = exactDataObject(
    value,
    BINDING_PAYLOAD_KEYS,
    'Hetzner credential binding payload',
  );
  if (
    payload.schemaVersion !== HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION ||
    payload.kind !== HETZNER_CREDENTIAL_BINDING_KIND
  ) {
    throw new HetznerCredentialBindingInvalidError();
  }
  assertSingleNodeDeploymentInstanceId(
    payload.deploymentInstanceId,
    'Hetzner credential binding deploymentInstanceId',
  );
  assertSha256Base64Url(payload.salt, 'Hetzner credential binding salt');
  assertSha256Base64Url(
    payload.verifier,
    'Hetzner credential binding verifier',
  );
  return Object.freeze({
    schemaVersion: HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
    kind: HETZNER_CREDENTIAL_BINDING_KIND,
    deploymentInstanceId: payload.deploymentInstanceId,
    salt: payload.salt,
    verifier: payload.verifier,
  });
}

/**
 * @param {Readonly<Record<string, any>>} payload - Canonical binding payload.
 * @returns {string} - Stable binding ID.
 */
function getBindingId(payload) {
  return createCanonicalJsonSha256Id({
    domain: HETZNER_CREDENTIAL_BINDING_ID_DOMAIN,
    prefix: HETZNER_CREDENTIAL_BINDING_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerCredentialBinding',
  });
}

/**
 * @param {Readonly<Record<string, any>>} document - Binding document.
 * @returns {string} - Exact canonical JSON text.
 */
function canonicalBindingText(document) {
  return `${JSON.stringify(sortCanonicalJsonValue(document))}\n`;
}

/**
 * @param {Readonly<Record<string, any>>} document - Binding document.
 * @returns {Readonly<{schemaVersion: 1, kind: 'hetznerCredentialBindingEvidence', deploymentInstanceId: string, bindingId: string}>} - Secret-free evidence.
 */
function bindingEvidence(document) {
  return Object.freeze({
    schemaVersion: HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
    kind: HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
    deploymentInstanceId: document.deploymentInstanceId,
    bindingId: document.bindingId,
  });
}

/**
 * Parse and require one exact canonical versioned document.
 * @param {string} text - Stable UTF-8 file contents.
 * @param {string} deploymentInstanceId - Expected path identity.
 * @returns {{document: Readonly<Record<string, any>>, evidence: ReturnType<typeof bindingEvidence>}} - Canonical binding.
 */
function parseBinding(text, deploymentInstanceId) {
  try {
    const candidate = JSON.parse(text);
    const document = exactDataObject(
      candidate,
      BINDING_DOCUMENT_KEYS,
      'Hetzner credential binding document',
    );
    assertDomainSeparatedSha256Id(
      document.bindingId,
      HETZNER_CREDENTIAL_BINDING_ID_PREFIX,
      'Hetzner credential binding ID',
    );
    const payload = validateBindingPayload({
      schemaVersion: document.schemaVersion,
      kind: document.kind,
      deploymentInstanceId: document.deploymentInstanceId,
      salt: document.salt,
      verifier: document.verifier,
    });
    const bindingId = getBindingId(payload);
    const canonical = Object.freeze({ ...payload, bindingId });
    if (
      canonical.deploymentInstanceId !== deploymentInstanceId ||
      document.bindingId !== bindingId ||
      text !== canonicalBindingText(canonical)
    ) {
      throw new HetznerCredentialBindingInvalidError();
    }
    return { document: canonical, evidence: bindingEvidence(canonical) };
  } catch (error) {
    if (error instanceof HetznerCredentialBindingInvalidError) throw error;
    throw new HetznerCredentialBindingInvalidError();
  }
}

/**
 * Read one bounded private binding through a no-follow descriptor.
 * @param {{filePath: string, deploymentInstanceId: string, expectedUid: number, maximumFileLinks: number}} options - Exact read.
 * @returns {Promise<({document: Readonly<Record<string, any>>, evidence: ReturnType<typeof bindingEvidence>, stats: import('node:fs').Stats})|null>} - Stable binding or absence.
 */
async function readBinding(options) {
  let handle;
  try {
    handle = await open(
      options.filePath,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    );
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw new HetznerCredentialBindingInvalidError();
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
      before.size > BINDING_FILE_MAX_BYTES
    ) {
      throw new HetznerCredentialBindingInvalidError();
    }
    const text = await handle.readFile({ encoding: 'utf8' });
    const after = await handle.stat();
    assertPrivateStats(
      after,
      'file',
      options.expectedUid,
      PRIVATE_FILE_MODE,
      options.maximumFileLinks,
    );
    const stableLinkMetadata =
      before.nlink === after.nlink && before.ctimeMs === after.ctimeMs;
    const completedPublicationCleanup =
      options.maximumFileLinks === 2 &&
      before.nlink === 2 &&
      after.nlink === 1 &&
      before.ctimeMs !== after.ctimeMs;
    if (
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      (!stableLinkMetadata && !completedPublicationCleanup) ||
      Buffer.byteLength(text, 'utf8') !== before.size ||
      Buffer.byteLength(text, 'utf8') > BINDING_FILE_MAX_BYTES
    ) {
      throw new HetznerCredentialBindingInvalidError();
    }
    return {
      ...parseBinding(text, options.deploymentInstanceId),
      stats: before,
    };
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} token - Exact credential token.
 * @param {Buffer} salt - Random 32-byte salt.
 * @returns {Buffer} - HMAC-SHA256 verifier.
 */
function tokenVerifier(token, salt) {
  return createHmac('sha256', salt).update(token, 'utf8').digest();
}

/**
 * Compare supplied token bytes with one stored salted verifier.
 * @param {Readonly<Record<string, any>>} document - Stored binding.
 * @param {string} token - Supplied credential.
 * @returns {void}
 */
function assertMatchingToken(document, token) {
  const salt = Buffer.from(document.salt, 'base64url');
  const expected = Buffer.from(document.verifier, 'base64url');
  const actual = tokenVerifier(token, salt);
  if (
    actual.byteLength !== expected.byteLength ||
    !timingSafeEqual(actual, expected)
  ) {
    throw new HetznerCredentialBindingMismatchError();
  }
}

/**
 * @param {unknown} value - Entropy returned by the injected source.
 * @returns {Buffer} - Independent exact salt bytes.
 */
function validateSalt(value) {
  if (!(value instanceof Uint8Array) || value.byteLength !== SALT_BYTE_LENGTH) {
    throw new TypeError(
      'hetznerCredentialBinding.randomBytes must return exactly 32 bytes.',
    );
  }
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

/**
 * @param {string} deploymentInstanceId - Deployment identity.
 * @param {string} token - Exact token.
 * @param {(size: number) => Uint8Array} randomSource - Salt source.
 * @returns {{document: Readonly<Record<string, any>>, text: string}} - Candidate binding.
 */
function createBindingCandidate(deploymentInstanceId, token, randomSource) {
  const salt = validateSalt(randomSource(SALT_BYTE_LENGTH));
  const payload = validateBindingPayload({
    schemaVersion: HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
    kind: HETZNER_CREDENTIAL_BINDING_KIND,
    deploymentInstanceId,
    salt: salt.toString('base64url'),
    verifier: tokenVerifier(token, salt).toString('base64url'),
  });
  const document = Object.freeze({
    ...payload,
    bindingId: getBindingId(payload),
  });
  return { document, text: canonicalBindingText(document) };
}

/**
 * @param {string} directory - Private binding directory.
 * @param {string} bindingId - Candidate binding ID.
 * @returns {string} - Same-directory private temporary path.
 */
function nextTemporaryPath(directory, bindingId) {
  publicationSequence = (publicationSequence + 1) % Number.MAX_SAFE_INTEGER;
  return path.join(
    directory,
    `.binding.${process.pid}.${publicationSequence}.${bindingId}.tmp`,
  );
}

/**
 * Atomically publish one immutable candidate without replacing a winner.
 * @param {{directory: string, bindingPath: string, candidate: ReturnType<typeof createBindingCandidate>, expectedUid: number}} options - Publication.
 * @returns {Promise<boolean>} - Whether this invocation won publication.
 */
async function publishBinding(options) {
  const temporaryPath = nextTemporaryPath(
    options.directory,
    options.candidate.document.bindingId,
  );
  let handle;
  let temporaryCreated = false;
  let linked = false;
  /** @type {unknown} */
  let failure;
  try {
    handle = await open(
      temporaryPath,
      fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_WRONLY |
        (fsConstants.O_NOFOLLOW || 0),
      PRIVATE_FILE_MODE,
    );
    temporaryCreated = true;
    assertPrivateStats(
      await handle.stat(),
      'file',
      options.expectedUid,
      PRIVATE_FILE_MODE,
    );
    await handle.writeFile(options.candidate.text, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporaryPath, options.bindingPath);
      linked = true;
      await syncDirectory(options.directory, options.expectedUid);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
    }
  } catch (error) {
    failure = error;
  }
  await handle?.close().catch((error) => {
    failure ||= error;
  });
  if (temporaryCreated) {
    try {
      await unlink(temporaryPath);
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) failure ||= error;
    }
    try {
      await syncDirectory(options.directory, options.expectedUid);
    } catch (error) {
      failure ||= error;
    }
  }
  if (failure) throw failure;
  return linked;
}

/**
 * Read a private directory with a strict finite bound.
 * @param {string} directory - Exact private directory.
 * @returns {Promise<string[]>} - Sorted entry names.
 */
async function readBoundedDirectoryNames(directory) {
  const opened = await opendir(directory);
  /** @type {string[]} */
  const names = [];
  try {
    while (true) {
      const entry = await opened.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length > MAX_REMOVAL_DIRECTORY_ENTRIES) {
        throw new HetznerCredentialBindingInvalidError();
      }
    }
  } finally {
    await opened.close().catch((error) => {
      if (!hasCode(error, 'ERR_DIR_CLOSED')) throw error;
    });
  }
  return names.sort();
}

/**
 * Validate the stable secret-free evidence returned by ensureBinding.
 * @param {unknown} value - Candidate evidence.
 * @returns {Readonly<{schemaVersion: 1, kind: 'hetznerCredentialBindingEvidence', deploymentInstanceId: string, bindingId: string}>} - Canonical evidence.
 */
export function validateHetznerCredentialBindingEvidence(value) {
  const evidence = exactDataObject(
    value,
    EVIDENCE_KEYS,
    'Hetzner credential binding evidence',
  );
  if (
    evidence.schemaVersion !== HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION ||
    evidence.kind !== HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND
  ) {
    throw new TypeError(
      'Hetzner credential binding evidence has an unsupported version or kind.',
    );
  }
  assertSingleNodeDeploymentInstanceId(
    evidence.deploymentInstanceId,
    'Hetzner credential binding evidence deploymentInstanceId',
  );
  assertDomainSeparatedSha256Id(
    evidence.bindingId,
    HETZNER_CREDENTIAL_BINDING_ID_PREFIX,
    'Hetzner credential binding evidence bindingId',
  );
  return Object.freeze({
    schemaVersion: HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
    kind: HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
    deploymentInstanceId: evidence.deploymentInstanceId,
    bindingId: evidence.bindingId,
  });
}

/**
 * Create one private local binding store. No method reads the environment,
 * invokes a provider, or writes during construction.
 * @param {unknown} value - Exact `{root, randomBytes?}` options.
 * @returns {{ensureBinding(value: unknown): Promise<ReturnType<typeof bindingEvidence>>, requireBinding(value: unknown): Promise<ReturnType<typeof bindingEvidence>>, removeBinding(value: unknown): Promise<void>}} - Credential-binding lifecycle.
 */
export function createHetznerCredentialBindingStore(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'hetznerCredentialBinding options must be one exact object.',
    );
  }
  const optionKeys = Object.hasOwn(value, 'randomBytes')
    ? OPTIONS_RANDOM_KEYS
    : OPTIONS_ROOT_KEYS;
  const options = exactDataObject(
    value,
    optionKeys,
    'hetznerCredentialBinding options',
  );
  const root = validateRoot(options.root);
  const randomSource = Object.hasOwn(options, 'randomBytes')
    ? options.randomBytes
    : nodeRandomBytes;
  if (typeof randomSource !== 'function') {
    throw new TypeError(
      'hetznerCredentialBinding.randomBytes must be a function.',
    );
  }
  if (typeof process.getuid !== 'function') {
    throw new Error(
      'Hetzner credential binding requires a local filesystem owner identity.',
    );
  }
  const expectedUid = process.getuid();
  if (!Number.isSafeInteger(expectedUid) || expectedUid < 0) {
    throw new Error(
      'Hetzner credential binding requires a local filesystem owner identity.',
    );
  }

  /**
   * @param {string} deploymentInstanceId - Deployment identity.
   * @returns {{directory: string, bindingPath: string}} - Exact owned paths.
   */
  function getPaths(deploymentInstanceId) {
    const directory = path.join(root, deploymentInstanceId);
    return {
      directory,
      bindingPath: path.join(directory, HETZNER_CREDENTIAL_BINDING_FILE_NAME),
    };
  }

  /**
   * @param {string} deploymentInstanceId - Deployment identity.
   * @returns {Promise<{directory: string, bindingPath: string}>} - Authenticated paths.
   */
  async function ensureDirectories(deploymentInstanceId) {
    await ensurePrivateDirectory(root, expectedUid);
    const paths = getPaths(deploymentInstanceId);
    await ensurePrivateDirectory(paths.directory, expectedUid);
    return paths;
  }

  return Object.freeze({
    /**
     * Create or verify the immutable first-token binding for one deployment.
     * @param {unknown} value - Exact deployment identity and token.
     * @returns {Promise<ReturnType<typeof bindingEvidence>>} - Stable secret-free evidence.
     */
    async ensureBinding(value) {
      const request = exactDataObject(
        value,
        ENSURE_KEYS,
        'Hetzner credential binding request',
      );
      assertSingleNodeDeploymentInstanceId(
        request.deploymentInstanceId,
        'Hetzner credential binding request deploymentInstanceId',
      );
      const token = validateToken(request.token);
      const paths = await ensureDirectories(request.deploymentInstanceId);
      const existing = await readBinding({
        filePath: paths.bindingPath,
        deploymentInstanceId: request.deploymentInstanceId,
        expectedUid,
        maximumFileLinks: 2,
      });
      if (existing !== null) {
        assertMatchingToken(existing.document, token);
        await syncDirectory(paths.directory, expectedUid);
        return existing.evidence;
      }

      const candidate = createBindingCandidate(
        request.deploymentInstanceId,
        token,
        randomSource,
      );
      await publishBinding({
        directory: paths.directory,
        bindingPath: paths.bindingPath,
        candidate,
        expectedUid,
      });
      const stored = await readBinding({
        filePath: paths.bindingPath,
        deploymentInstanceId: request.deploymentInstanceId,
        expectedUid,
        maximumFileLinks: 2,
      });
      if (stored === null) {
        throw new HetznerCredentialBindingInvalidError();
      }
      assertMatchingToken(stored.document, token);
      await syncDirectory(paths.directory, expectedUid);
      return stored.evidence;
    },

    /**
     * Require and verify an already-published immutable binding. This path is
     * deliberately read-only: absence, corruption, or a mismatched token can
     * never create directories, publish a candidate, or rebind authority.
     * @param {unknown} value - Exact deployment identity and token.
     * @returns {Promise<ReturnType<typeof bindingEvidence>>} - Existing secret-free evidence.
     */
    async requireBinding(value) {
      const request = exactDataObject(
        value,
        REQUIRE_KEYS,
        'Hetzner credential binding requirement',
      );
      assertSingleNodeDeploymentInstanceId(
        request.deploymentInstanceId,
        'Hetzner credential binding requirement deploymentInstanceId',
      );
      const token = validateToken(request.token);
      await assertTrustedParent(path.dirname(root), expectedUid);
      const rootState = await inspectPrivateDirectoryIfPresent(
        root,
        expectedUid,
      );
      if (rootState === null) {
        throw new HetznerCredentialBindingMissingError();
      }
      const paths = getPaths(request.deploymentInstanceId);
      const directoryState = await inspectPrivateDirectoryIfPresent(
        paths.directory,
        expectedUid,
      );
      if (directoryState === null) {
        throw new HetznerCredentialBindingMissingError();
      }
      const names = await readBoundedDirectoryNames(paths.directory);
      if (names.length === 0) {
        throw new HetznerCredentialBindingMissingError();
      }
      if (
        names.length !== 1 ||
        names[0] !== HETZNER_CREDENTIAL_BINDING_FILE_NAME
      ) {
        throw new HetznerCredentialBindingInvalidError();
      }
      const existing = await readBinding({
        filePath: paths.bindingPath,
        deploymentInstanceId: request.deploymentInstanceId,
        expectedUid,
        maximumFileLinks: 1,
      });
      if (existing === null) {
        throw new HetznerCredentialBindingMissingError();
      }
      assertMatchingToken(existing.document, token);
      return existing.evidence;
    },

    /**
     * Remove only the exact binding named by prior verified evidence.
     * @param {unknown} value - Exact secret-free evidence.
     * @returns {Promise<void>}
     */
    async removeBinding(value) {
      const evidence = validateHetznerCredentialBindingEvidence(value);
      const rootState = await inspectPrivateDirectoryIfPresent(
        root,
        expectedUid,
      );
      if (rootState === null) return;
      const paths = getPaths(evidence.deploymentInstanceId);
      const directoryState = await inspectPrivateDirectoryIfPresent(
        paths.directory,
        expectedUid,
      );
      if (directoryState === null) return;

      const names = await readBoundedDirectoryNames(paths.directory);
      if (names.length === 0) {
        try {
          await rmdir(paths.directory);
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
        await syncDirectory(root, expectedUid);
        return;
      }
      if (
        names.length !== 1 ||
        names[0] !== HETZNER_CREDENTIAL_BINDING_FILE_NAME
      ) {
        throw new HetznerCredentialBindingInvalidError();
      }
      const stored = await readBinding({
        filePath: paths.bindingPath,
        deploymentInstanceId: evidence.deploymentInstanceId,
        expectedUid,
        maximumFileLinks: 1,
      });
      if (stored === null) {
        const remaining = await readBoundedDirectoryNames(paths.directory);
        if (remaining.length !== 0) {
          throw new HetznerCredentialBindingInvalidError();
        }
        try {
          await rmdir(paths.directory);
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
        await syncDirectory(root, expectedUid);
        return;
      }
      if (stored.evidence.bindingId !== evidence.bindingId) {
        throw new HetznerCredentialBindingMismatchError();
      }

      const current = await lstat(paths.bindingPath);
      assertPrivateStats(current, 'file', expectedUid, PRIVATE_FILE_MODE);
      if (
        current.dev !== stored.stats.dev ||
        current.ino !== stored.stats.ino ||
        current.size !== stored.stats.size ||
        current.mtimeMs !== stored.stats.mtimeMs ||
        current.ctimeMs !== stored.stats.ctimeMs
      ) {
        throw new HetznerCredentialBindingInvalidError();
      }
      try {
        await unlink(paths.bindingPath);
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
      await syncDirectory(paths.directory, expectedUid);
      try {
        await rmdir(paths.directory);
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
      }
      await syncDirectory(root, expectedUid);
    },
  });
}

export default {
  HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
  HETZNER_CREDENTIAL_BINDING_FILE_NAME,
  HETZNER_CREDENTIAL_BINDING_ID_DOMAIN,
  HETZNER_CREDENTIAL_BINDING_ID_PREFIX,
  HETZNER_CREDENTIAL_BINDING_KIND,
  HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
  HETZNER_CREDENTIAL_TOKEN_MAX_BYTES,
  HetznerCredentialBindingInvalidError,
  HetznerCredentialBindingMissingError,
  HetznerCredentialBindingMismatchError,
  createHetznerCredentialBindingStore,
  validateHetznerCredentialBindingEvidence,
};
