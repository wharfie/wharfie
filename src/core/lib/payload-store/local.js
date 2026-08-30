/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  EXECUTION_PAYLOAD_STORAGE_KIND,
  createExecutionPayloadReference,
  createExecutionPayloadStorageIdentity,
  encodeCanonicalJsonPayload,
  validateExecutionPayloadReference,
  verifyExecutionPayloadReference,
} from '../../runtime/execution-payload.js';

/** Error raised when a referenced immutable payload cannot be read. */
export class ExecutionPayloadStoreNotFoundError extends Error {
  /** @param {string} payloadId - Missing immutable payload identity. */
  constructor(payloadId) {
    super(`Execution payload is missing: ${payloadId}`);
    this.name = 'ExecutionPayloadStoreNotFoundError';
    this.payloadId = payloadId;
  }
}

/** Error raised when bytes at an immutable payload location do not verify. */
export class ExecutionPayloadStoreIntegrityError extends Error {
  /**
   * @param {string} payloadId - Immutable payload identity.
   * @param {string} reason - Safe integrity failure reason.
   */
  constructor(payloadId, reason) {
    super(`Execution payload integrity check failed: ${payloadId} (${reason})`);
    this.name = 'ExecutionPayloadStoreIntegrityError';
    this.payloadId = payloadId;
  }
}

/**
 * @param {unknown} error - Candidate file-system error.
 * @returns {boolean} - Whether the path did not exist.
 */
function isNotFound(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === 'ENOENT'
  );
}

/**
 * @param {unknown} error - Candidate file-system error.
 * @returns {boolean} - Whether a create-if-absent link lost its race.
 */
function isAlreadyExists(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === 'EEXIST'
  );
}

/**
 * @param {string} directory - Directory whose metadata must reach durable storage.
 * @returns {Promise<void>} - Resolves only after directory fsync succeeds.
 */
async function syncDirectory(directory) {
  const handle = await fsp.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Create a directory and flush both its own metadata and the direct parent
 * link. A failure is surfaced before a caller can append a ledger reference.
 * @param {string} directory - Required directory.
 * @returns {Promise<void>} - Resolves when the directory entry is durable.
 */
async function ensureDurableDirectory(directory) {
  const missing = [];
  let existing = directory;
  for (;;) {
    try {
      const stats = await fsp.lstat(existing);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(
          'Local execution payload store path is not a directory.',
        );
      }
      break;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      missing.push(existing);
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }

  if (missing.length === 0) {
    await syncDirectory(directory);
    const parent = dirname(directory);
    if (parent !== directory) await syncDirectory(parent);
    return;
  }

  for (const path of missing.reverse()) {
    try {
      await fsp.mkdir(path, { mode: 0o700 });
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    const stats = await fsp.lstat(path);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error('Local execution payload store path is not a directory.');
    }
    await syncDirectory(path);
    await syncDirectory(dirname(path));
  }
}

/**
 * @param {string} filePath - Private temporary file path.
 * @param {Buffer} bytes - Exact bytes to persist.
 * @returns {Promise<void>} - Resolves after file data reaches durable storage.
 */
async function writeAndSyncFile(filePath, bytes) {
  const handle = await fsp.open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * @param {string} filePath - Temporary path to remove after publication.
 * @returns {Promise<void>} - Never rejects for an orphan cleanup failure.
 */
async function removeTemporaryFile(filePath) {
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // A crash or cleanup failure can leave an unreachable temporary file. It is
    // not a content-addressed payload and is never returned as one.
  }
}

/**
 * @param {string} root - Store root.
 * @param {string} key - Already-validated content-derived storage key.
 * @returns {string} - Path under the configured store root.
 */
function getSafePayloadPath(root, key) {
  const destination = resolve(root, ...key.split('/'));
  const relation = relative(root, destination);
  if (
    relation === '' ||
    relation === '..' ||
    relation.startsWith(`..${sep}`) ||
    isAbsolute(relation)
  ) {
    throw new TypeError(
      'Execution payload storage key escapes its store root.',
    );
  }
  return destination;
}

/**
 * Create a local immutable content-addressed store for execution payloads.
 * Payloads are written to a private file, fsynced, then published using an
 * atomic create-if-absent hard link. Existing keys are accepted only after
 * their bytes rehash, decode, and canonically verify against the same ref.
 * This API intentionally has no deletion or garbage-collection operation.
 * A later retained-ledger-root reachability design must own that decision.
 * @param {{path: string, storeId: string}} options - Local durable-store inputs.
 * @returns {{storage: Readonly<{kind: 'wharfie.local-content-addressed.v1', storeId: string}>, putJson: (input: {value: unknown, payloadSchema: string}) => Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>, importBytes: (input: {reference: unknown, bytes: unknown}) => Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>, readBytes: (reference: unknown) => Promise<Buffer>, readVerified: (reference: unknown) => Promise<{reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, value: any}>, readJson: (reference: unknown) => Promise<any>, verify: (reference: unknown) => Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>, getPath: (reference: unknown) => string}} - Immutable payload-store API.
 */
export function createLocalExecutionPayloadStore(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Local execution payload store options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  const allowed = new Set(['path', 'storeId']);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) {
      throw new TypeError(
        `Local execution payload store options.${key} is not supported.`,
      );
    }
  }
  if (
    typeof candidate.path !== 'string' ||
    candidate.path.length === 0 ||
    candidate.path.trim() !== candidate.path
  ) {
    throw new TypeError(
      'Local execution payload store options.path must be a nonempty canonical path.',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(candidate, 'storeId')) {
    throw new TypeError(
      'Local execution payload store options.storeId is required.',
    );
  }

  const root = resolve(candidate.path);
  const storage = createExecutionPayloadStorageIdentity(
    candidate.storeId,
    'Local execution payload store storeId',
  );

  /**
   * @param {unknown} reference - Candidate reference stored in the ledger.
   * @returns {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} - Validated reference for this exact store.
   */
  function normalizeLocalReference(reference) {
    const normalized = validateExecutionPayloadReference(
      reference,
      'execution payload reference',
    );
    if (
      normalized.storage.kind !== EXECUTION_PAYLOAD_STORAGE_KIND ||
      normalized.storage.storeId !== storage.storeId
    ) {
      throw new TypeError(
        `Execution payload ${normalized.payloadId} belongs to a different local payload store.`,
      );
    }
    return normalized;
  }

  /**
   * @param {unknown} reference - Candidate reference stored in the ledger.
   * @returns {string} - Safe local content path.
   */
  function getPath(reference) {
    const normalized = normalizeLocalReference(reference);
    return getSafePayloadPath(root, normalized.storage.key);
  }

  /**
   * Normalize the reference, preflight its exact file size, and return an
   * independently owned byte buffer. Callers that interpret the bytes must
   * still bind them to the reference with verifyExecutionPayloadReference.
   * @param {unknown} reference - Candidate immutable payload reference.
   * @returns {Promise<Buffer>} - Exact content bytes after size preflight.
   */
  async function readBytes(reference) {
    const normalized = normalizeLocalReference(reference);
    const filePath = getSafePayloadPath(root, normalized.storage.key);
    try {
      const linkStats = await fsp.lstat(filePath);
      if (!linkStats.isFile()) {
        throw new ExecutionPayloadStoreIntegrityError(
          normalized.payloadId,
          'content path is not a regular file',
        );
      }
      const handle = await fsp.open(filePath, 'r');
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.size !== normalized.size) {
          throw new ExecutionPayloadStoreIntegrityError(
            normalized.payloadId,
            `content file size ${before.size} does not match reference size ${normalized.size}`,
          );
        }
        const bytes = Buffer.allocUnsafe(normalized.size);
        let offset = 0;
        while (offset < bytes.byteLength) {
          const { bytesRead } = await handle.read(
            bytes,
            offset,
            bytes.byteLength - offset,
            offset,
          );
          if (bytesRead === 0) {
            throw new ExecutionPayloadStoreIntegrityError(
              normalized.payloadId,
              'content file ended before its referenced size',
            );
          }
          offset += bytesRead;
        }
        const after = await handle.stat();
        if (!after.isFile() || after.size !== normalized.size) {
          throw new ExecutionPayloadStoreIntegrityError(
            normalized.payloadId,
            'content file changed while it was being read',
          );
        }
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isNotFound(error)) {
        throw new ExecutionPayloadStoreNotFoundError(normalized.payloadId);
      }
      throw error;
    }
  }

  /**
   * Atomically read bytes through the one preflighted store path and bind the
   * decoded JSON to their rehashed immutable reference. Callers must use this
   * instead of separately reading and verifying mutable filesystem content.
   * @param {unknown} reference - Candidate immutable payload reference.
   * @returns {Promise<{reference: Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>, value: any}>} - Rehashed and decoded payload.
   */
  async function readVerified(reference) {
    const normalized = normalizeLocalReference(reference);
    const bytes = await readBytes(normalized);

    try {
      return verifyExecutionPayloadReference(
        normalized,
        bytes,
        `stored execution payload ${normalized.payloadId}`,
      );
    } catch (error) {
      if (error instanceof ExecutionPayloadStoreIntegrityError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new ExecutionPayloadStoreIntegrityError(
        normalized.payloadId,
        message,
      );
    }
  }

  /**
   * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} reference - Immutable payload reference.
   * @param {Buffer} bytes - Exact canonical bytes to publish.
   * @returns {Promise<void>} - Resolves only after publish and read-back verification.
   */
  async function publishImmutable(reference, bytes) {
    const destination = getSafePayloadPath(root, reference.storage.key);
    const destinationDirectory = dirname(destination);
    await ensureDurableDirectory(root);
    await ensureDurableDirectory(destinationDirectory);
    const temporary = join(
      destinationDirectory,
      `.${reference.payloadId}.${process.pid}.${randomUUID()}.tmp`,
    );

    try {
      await writeAndSyncFile(temporary, bytes);
      try {
        await fsp.link(temporary, destination);
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      // The caller that lost the create-if-absent race must flush this too:
      // it may be the first caller to append the reference while the winner
      // is still between link(2) and its own directory fsync.
      await syncDirectory(destinationDirectory);

      // This is intentionally a complete read-back verification, even for a
      // freshly linked file. A ledger append may follow only after the final
      // path names canonical bytes matching the reference.
      await readVerified(reference);
    } finally {
      await removeTemporaryFile(temporary);
    }
  }

  /**
   * Import exact canonical bytes under an already-issued immutable reference.
   * This is the narrow hydration seam used by a replicated store: callers
   * cannot choose a path or derive a new reference, and an existing key is
   * accepted only when its retained bytes verify exactly. A conflicting local
   * object is never overwritten or repaired in place.
   * @param {{reference: unknown, bytes: unknown}} input - Exact reference and bytes to import.
   * @returns {Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>} - The independently normalized imported reference.
   */
  async function importBytes(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError(
        'Execution payload importBytes input must be an object.',
      );
    }
    const candidate = /** @type {Record<string, unknown>} */ (input);
    const allowed = new Set(['reference', 'bytes']);
    for (const key of Object.keys(candidate)) {
      if (!allowed.has(key)) {
        throw new TypeError(
          `Execution payload importBytes input.${key} is not supported.`,
        );
      }
    }
    for (const key of allowed) {
      if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
        throw new TypeError(
          `Execution payload importBytes input.${key} is required.`,
        );
      }
    }

    const reference = normalizeLocalReference(candidate.reference);
    let byteLength;
    if (
      Buffer.isBuffer(candidate.bytes) ||
      candidate.bytes instanceof Uint8Array
    ) {
      byteLength = candidate.bytes.byteLength;
    } else if (candidate.bytes instanceof ArrayBuffer) {
      byteLength = candidate.bytes.byteLength;
    } else {
      throw new TypeError(
        'Execution payload importBytes input.bytes must be a Buffer, Uint8Array, or ArrayBuffer.',
      );
    }
    if (byteLength !== reference.size) {
      throw new ExecutionPayloadStoreIntegrityError(
        reference.payloadId,
        `imported byte size ${byteLength} does not match reference size ${reference.size}`,
      );
    }
    const bytes =
      candidate.bytes instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(candidate.bytes))
        : Buffer.from(candidate.bytes);
    try {
      verifyExecutionPayloadReference(
        reference,
        bytes,
        `imported execution payload ${reference.payloadId}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ExecutionPayloadStoreIntegrityError(
        reference.payloadId,
        message,
      );
    }
    await publishImmutable(reference, bytes);
    return reference;
  }

  /**
   * @param {{value: unknown, payloadSchema: string}} input - JSON payload and semantic schema.
   * @returns {Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>} - Durable immutable payload reference.
   */
  async function putJson(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('Execution payload putJson input must be an object.');
    }
    const payload = /** @type {Record<string, unknown>} */ (input);
    const allowed = new Set(['value', 'payloadSchema']);
    for (const key of Object.keys(payload)) {
      if (!allowed.has(key)) {
        throw new TypeError(
          `Execution payload putJson input.${key} is not supported.`,
        );
      }
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'value')) {
      throw new TypeError('Execution payload putJson input.value is required.');
    }
    if (!Object.prototype.hasOwnProperty.call(payload, 'payloadSchema')) {
      throw new TypeError(
        'Execution payload putJson input.payloadSchema is required.',
      );
    }
    const bytes = encodeCanonicalJsonPayload(
      payload.value,
      'execution payload',
    );
    const reference = createExecutionPayloadReference({
      bytes,
      payloadSchema: payload.payloadSchema,
      storeId: storage.storeId,
    });
    await publishImmutable(reference, bytes);
    return reference;
  }

  /**
   * @param {unknown} reference - Candidate immutable payload reference.
   * @returns {Promise<any>} - Independently decoded verified JSON value.
   */
  async function readJson(reference) {
    return (await readVerified(reference)).value;
  }

  /**
   * @param {unknown} reference - Candidate immutable payload reference.
   * @returns {Promise<Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>>} - Verified immutable reference.
   */
  async function verify(reference) {
    return (await readVerified(reference)).reference;
  }

  return Object.freeze({
    storage,
    putJson,
    importBytes,
    readBytes,
    readVerified,
    readJson,
    verify,
    getPath,
  });
}

export default createLocalExecutionPayloadStore;
