import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';

import { assertDomainSeparatedSha256Id } from '../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../runtime/json-value.js';
import {
  RESIDENT_REPLACEMENT_INPUT_MAX_BYTES,
  RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
  decodeResidentReplacementInputReceipt,
  encodeResidentReplacementInputReceipt,
  validateResidentReplacementInputReceipt,
} from '../../runtime/resident-replacement-input.js';

const RECEIPT_DIRECTORY = 'receipts';
const STORE_OPTIONS_MAX_BYTES = 8 * 1024;

/** @typedef {ReturnType<typeof validateResidentReplacementInputReceipt>} ResidentReplacementInputReceipt */

/** A requested immutable replacement-input receipt is not retained. */
export class ResidentReplacementInputStoreNotFoundError extends Error {
  /** @param {string} receiptId - Missing receipt identity. */
  constructor(receiptId) {
    super(`Resident replacement input receipt is missing: ${receiptId}`);
    this.name = 'ResidentReplacementInputStoreNotFoundError';
    this.code = 'WHARFIE_RESIDENT_REPLACEMENT_INPUT_NOT_FOUND';
    this.receiptId = receiptId;
  }
}

/** Retained receipt bytes do not satisfy their immutable identity. */
export class ResidentReplacementInputStoreIntegrityError extends Error {
  /**
   * @param {string} receiptId - Expected receipt identity.
   * @param {string} reason - Safe bounded failure reason.
   * @param {{cause?: unknown}} [options] - Optional validation failure.
   */
  constructor(receiptId, reason, options = {}) {
    super(
      `Resident replacement input receipt failed verification: ${receiptId} (${reason})`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ResidentReplacementInputStoreIntegrityError';
    this.code = 'WHARFIE_RESIDENT_REPLACEMENT_INPUT_INTEGRITY';
    this.receiptId = receiptId;
    this.reason = reason;
  }
}

/**
 * @param {unknown} error - Candidate filesystem failure.
 * @returns {boolean} - Whether the path was absent.
 */
function isNotFound(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === 'ENOENT'
  );
}

/**
 * @param {unknown} error - Candidate filesystem failure.
 * @returns {boolean} - Whether publication found an immutable artifact.
 */
function isAlreadyExists(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code === 'EEXIST'
  );
}

/**
 * @param {unknown} value - Candidate canonical absolute root.
 * @returns {string} - Exact resolved root.
 */
function canonicalRoot(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !isAbsolute(value) ||
    normalize(value) !== value ||
    resolve(value) !== value
  ) {
    throw new TypeError(
      'Local resident replacement input store path must be a canonical absolute path.',
    );
  }
  return resolve(value);
}

/**
 * @param {unknown} value - Candidate immutable receipt identity.
 * @returns {string} - Exact receipt identity.
 */
function receiptId(value) {
  assertDomainSeparatedSha256Id(
    value,
    RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
    'resident replacement input receiptId',
  );
  return /** @type {string} */ (value);
}

/**
 * @param {string} directory - Directory whose metadata must reach storage.
 * @returns {Promise<void>} - Resolves after fsync.
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
 * @param {string} directory - Required private directory.
 * @returns {Promise<void>} - Resolves after creation and metadata flush.
 */
async function ensureDurableDirectory(directory) {
  const missing = [];
  let existing = directory;
  for (;;) {
    try {
      const stats = await fsp.lstat(existing);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(
          'Local resident replacement input store path is not a directory.',
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
      throw new Error(
        'Local resident replacement input store path is not a directory.',
      );
    }
    await syncDirectory(path);
    await syncDirectory(dirname(path));
  }
}

/**
 * @param {string} filePath - Private temporary path.
 * @param {Buffer} bytes - Canonical receipt bytes.
 * @returns {Promise<void>} - Resolves after file data reaches storage.
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
 * @param {string} filePath - Unpublished temporary file.
 * @returns {Promise<void>} - Never rejects for cleanup failure.
 */
async function removeTemporaryFile(filePath) {
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // An unreachable temporary file is never accepted as a receipt artifact.
  }
}

/**
 * @param {import('node:fs').BigIntStats} before - Initial held-file state.
 * @param {import('node:fs').BigIntStats} after - Final held-file state.
 * @returns {boolean} - Whether the same regular file remained unchanged.
 */
function sameFile(before, after) {
  return (
    before.isFile() &&
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mode === after.mode &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

/**
 * Create a local immutable store for canonical replacement-input receipt
 * artifacts. Receipt IDs determine every final path. Publication is a
 * create-if-absent hard link followed by directory fsync; existing paths are
 * accepted only after their exact bytes validate. `readBytes` plus `putBytes`
 * is the deliberate provider-neutral copy boundary for a fresh local root.
 * @param {{path: string}} options - Exact durable root.
 * @returns {Readonly<{
 *   put: (receipt: unknown) => Promise<ResidentReplacementInputReceipt>,
 *   putBytes: (bytes: unknown) => Promise<ResidentReplacementInputReceipt>,
 *   read: (receiptId: string) => Promise<ResidentReplacementInputReceipt>,
 *   readBytes: (receiptId: string) => Promise<Buffer>,
 *   getPath: (receiptId: string) => string,
 * }>} - Immutable handoff-store API.
 */
export function createLocalResidentReplacementInputStore(options) {
  const captured = cloneBoundedJsonObject(
    options,
    STORE_OPTIONS_MAX_BYTES,
    'local resident replacement input store options',
  );
  if (
    Object.keys(captured).length !== 1 ||
    !Object.prototype.hasOwnProperty.call(captured, 'path')
  ) {
    throw new TypeError(
      'Local resident replacement input store options must contain exactly path.',
    );
  }
  const root = canonicalRoot(captured.path);
  const receiptsRoot = join(root, RECEIPT_DIRECTORY);

  /**
   * @param {string} inputReceiptId - Exact receipt identity.
   * @returns {string} - Deterministic immutable artifact path.
   */
  function getPath(inputReceiptId) {
    const normalized = receiptId(inputReceiptId);
    return join(receiptsRoot, `${normalized}.json`);
  }

  /**
   * @param {string} inputReceiptId - Exact receipt identity.
   * @returns {Promise<Buffer>} - Independently owned canonical receipt bytes.
   */
  async function readBytes(inputReceiptId) {
    const normalizedId = receiptId(inputReceiptId);
    const filePath = getPath(normalizedId);
    try {
      const linkStats = await fsp.lstat(filePath, { bigint: true });
      if (!linkStats.isFile() || linkStats.isSymbolicLink()) {
        throw new ResidentReplacementInputStoreIntegrityError(
          normalizedId,
          'artifact path is not a regular file',
        );
      }
      const handle = await fsp.open(filePath, 'r');
      try {
        const before = await handle.stat({ bigint: true });
        if (
          !before.isFile() ||
          before.dev !== linkStats.dev ||
          before.ino !== linkStats.ino
        ) {
          throw new ResidentReplacementInputStoreIntegrityError(
            normalizedId,
            'artifact changed before it was read',
          );
        }
        if (
          before.size < 1n ||
          before.size > BigInt(RESIDENT_REPLACEMENT_INPUT_MAX_BYTES)
        ) {
          throw new ResidentReplacementInputStoreIntegrityError(
            normalizedId,
            'artifact size is invalid',
          );
        }
        const size = Number(before.size);
        const bytes = Buffer.allocUnsafe(size);
        let offset = 0;
        while (offset < size) {
          const { bytesRead } = await handle.read(
            bytes,
            offset,
            size - offset,
            offset,
          );
          if (bytesRead === 0) {
            throw new ResidentReplacementInputStoreIntegrityError(
              normalizedId,
              'artifact ended before its observed size',
            );
          }
          offset += bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        if (!sameFile(before, after)) {
          throw new ResidentReplacementInputStoreIntegrityError(
            normalizedId,
            'artifact changed while it was read',
          );
        }
        let receipt;
        try {
          receipt = decodeResidentReplacementInputReceipt(
            bytes,
            `stored resident replacement input ${normalizedId}`,
          );
        } catch (cause) {
          throw new ResidentReplacementInputStoreIntegrityError(
            normalizedId,
            'artifact bytes are invalid',
            { cause },
          );
        }
        if (receipt.receiptId !== normalizedId) {
          throw new ResidentReplacementInputStoreIntegrityError(
            normalizedId,
            'artifact identity does not match its path',
          );
        }
        return bytes;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (isNotFound(error)) {
        throw new ResidentReplacementInputStoreNotFoundError(normalizedId);
      }
      throw error;
    }
  }

  /**
   * @param {string} inputReceiptId - Exact receipt identity.
   * @returns {Promise<ResidentReplacementInputReceipt>} - Verified receipt.
   */
  async function read(inputReceiptId) {
    return decodeResidentReplacementInputReceipt(
      await readBytes(inputReceiptId),
      `stored resident replacement input ${inputReceiptId}`,
    );
  }

  /**
   * @param {unknown} value - Canonical receipt artifact bytes.
   * @returns {Promise<ResidentReplacementInputReceipt>} - Exact accepted receipt.
   */
  async function putBytes(value) {
    const receipt = decodeResidentReplacementInputReceipt(
      value,
      'resident replacement input artifact',
    );
    const bytes = encodeResidentReplacementInputReceipt(receipt);
    const destination = getPath(receipt.receiptId);
    await ensureDurableDirectory(root);
    await ensureDurableDirectory(receiptsRoot);
    const temporary = join(
      receiptsRoot,
      `.${receipt.receiptId}.${process.pid}.${randomUUID()}.tmp`,
    );
    try {
      await writeAndSyncFile(temporary, bytes);
      try {
        await fsp.link(temporary, destination);
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      await syncDirectory(receiptsRoot);
      const retained = await readBytes(receipt.receiptId);
      if (!retained.equals(bytes)) {
        throw new ResidentReplacementInputStoreIntegrityError(
          receipt.receiptId,
          'retained artifact differs from the accepted bytes',
        );
      }
      return receipt;
    } finally {
      await removeTemporaryFile(temporary);
    }
  }

  /**
   * @param {unknown} value - Candidate replacement-input receipt.
   * @returns {Promise<ResidentReplacementInputReceipt>} - Exact accepted receipt.
   */
  async function put(value) {
    const receipt = validateResidentReplacementInputReceipt(value);
    return await putBytes(encodeResidentReplacementInputReceipt(receipt));
  }

  return Object.freeze({ put, putBytes, read, readBytes, getPath });
}

export default createLocalResidentReplacementInputStore;
