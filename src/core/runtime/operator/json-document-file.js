import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';

export const OPERATOR_JSON_DOCUMENT_MAX_BYTES = 4 * 1024 * 1024;

/**
 * @param {unknown} value - Candidate file path.
 * @param {string} label - Human-readable document label.
 * @returns {string} - Nonempty safe path.
 */
function requireFilePath(value, label) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    throw new TypeError(`${label} file path must be a nonempty string.`);
  }
  return value;
}

/**
 * @param {import('node:fs').BigIntStats} before - Pre-read descriptor metadata.
 * @param {import('node:fs').BigIntStats} after - Post-read descriptor metadata.
 * @returns {boolean} - Whether the held file remained the same immutable read.
 */
function sameFileObservation(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.nlink === after.nlink &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs
  );
}

/**
 * Read one complete regular UTF-8 JSON object through a held descriptor.
 * Size is checked before allocation and again after the read so an operator
 * file cannot grow unnoticed while it is admitted. File contents are never
 * included in an error.
 * @param {unknown} filePath - Host path to the JSON document.
 * @param {string} [label] - Human-readable document label.
 * @returns {Promise<Record<string, any>>} - Parsed JSON object.
 */
export async function readOperatorJsonObjectFile(
  filePath,
  label = 'operator JSON document',
) {
  const path = requireFilePath(filePath, label);
  const handle = await open(
    path,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  /** @type {unknown} */
  let primaryError;
  let failed = false;
  /** @type {Record<string, any> | undefined} */
  let result;
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error(`${label} file must be a regular file.`);
    }
    if (
      before.size < 0n ||
      before.size > BigInt(OPERATOR_JSON_DOCUMENT_MAX_BYTES)
    ) {
      throw new RangeError(
        `${label} file must not exceed ${OPERATOR_JSON_DOCUMENT_MAX_BYTES} bytes.`,
      );
    }

    const bytes = Buffer.alloc(Number(before.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new Error(`${label} file changed while it was read.`);
      }
      offset += bytesRead;
    }

    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(
      extra,
      0,
      extra.length,
      bytes.length,
    );
    const after = await handle.stat({ bigint: true });
    if (extraBytes !== 0 || !sameFileObservation(before, after)) {
      throw new Error(`${label} file changed while it was read.`);
    }

    let parsed;
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error(`${label} file must contain valid UTF-8 JSON.`);
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      throw new TypeError(`${label} file must contain one JSON object.`);
    }
    result = parsed;
  } catch (error) {
    failed = true;
    primaryError = error;
  }

  /** @type {unknown} */
  let closeError;
  let closeFailed = false;
  try {
    await handle.close();
  } catch (error) {
    closeFailed = true;
    closeError = error;
  }
  if (failed) {
    if (closeFailed) {
      throw new AggregateError(
        [primaryError, closeError],
        `${label} read and descriptor cleanup both failed.`,
      );
    }
    throw primaryError;
  }
  if (closeFailed) throw closeError;
  return /** @type {Record<string, any>} */ (result);
}

export default { readOperatorJsonObjectFile };
