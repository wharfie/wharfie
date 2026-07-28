import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

export const STABILITY_WINDOW_MS = 250;
const READ_CHUNK_BYTES = 64 * 1024;

/**
 * Require one absolute regular-file path.
 * @param {unknown} value - Candidate path.
 * @returns {string} - Exact absolute path.
 */
function requireAbsolutePath(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    !path.isAbsolute(value)
  ) {
    throw new TypeError('steady-file requires one absolute file path.');
  }
  return value;
}

/**
 * Read exactly the size observed from one held regular-file descriptor and
 * return a JSON-safe content fingerprint. Nonblocking open lets special files
 * be rejected without waiting for a peer. `readStable` is false when the full
 * snapshot cannot be read or metadata changes while it is being hashed.
 * @param {unknown} value - Absolute file path.
 * @returns {Promise<{path: string, bytes: number, sha256: string, readStable: boolean}>} - Exact observed fingerprint.
 */
export async function fingerprintFile(value) {
  const filePath = requireAbsolutePath(value);
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | fsConstants.O_NONBLOCK,
  );
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new TypeError('steady-file can inspect only a regular file.');
    }
    if (!Number.isSafeInteger(before.size) || before.size < 0) {
      throw new RangeError('steady-file file size is outside the safe range.');
    }

    const hash = createHash('sha256');
    let bytes = 0;
    while (bytes < before.size) {
      const length = Math.min(READ_CHUNK_BYTES, before.size - bytes);
      const buffer = Buffer.allocUnsafe(length);
      const result = await handle.read(buffer, 0, length, bytes);
      if (result.bytesRead === 0) break;
      hash.update(buffer.subarray(0, result.bytesRead));
      bytes += result.bytesRead;
    }

    const after = await handle.stat();
    return {
      path: filePath,
      bytes,
      sha256: hash.digest('hex'),
      readStable:
        bytes === before.size &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Compare two independently observed fingerprints.
 * @param {Record<string, any>} baseline - Earlier fingerprint.
 * @param {Record<string, any>} current - Later fingerprint.
 * @returns {{path: string, stable: boolean, baseline: {bytes: number, sha256: string, readStable: boolean}, current: {bytes: number, sha256: string, readStable: boolean}}} - Stable/changed decision.
 */
export function compareFileFingerprints(baseline, current) {
  for (const [label, value] of [
    ['baseline', baseline],
    ['current', current],
  ]) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      typeof value.path !== 'string' ||
      !path.isAbsolute(value.path) ||
      !Number.isSafeInteger(value.bytes) ||
      value.bytes < 0 ||
      typeof value.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      typeof value.readStable !== 'boolean'
    ) {
      throw new TypeError(`steady-file ${label} fingerprint is invalid.`);
    }
  }
  if (baseline.path !== current.path) {
    throw new TypeError(
      'steady-file fingerprints must describe the same absolute path.',
    );
  }

  return {
    path: baseline.path,
    stable:
      baseline.readStable &&
      current.readStable &&
      baseline.bytes === current.bytes &&
      baseline.sha256 === current.sha256,
    baseline: {
      bytes: baseline.bytes,
      sha256: baseline.sha256,
      readStable: baseline.readStable,
    },
    current: {
      bytes: current.bytes,
      sha256: current.sha256,
      readStable: current.readStable,
    },
  };
}

/**
 * Answer the ordinary local CLI question without durable runtime state.
 * @param {unknown} value - Absolute file path.
 * @param {number} [windowMs] - Observation window.
 * @returns {Promise<ReturnType<typeof compareFileFingerprints>>} - Stable/changed decision.
 */
export async function checkFileStability(
  value,
  windowMs = STABILITY_WINDOW_MS,
) {
  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('steady-file window must be a positive integer.');
  }
  const baseline = await fingerprintFile(value);
  await new Promise((resolve) => setTimeout(resolve, windowMs));
  const current = await fingerprintFile(value);
  return compareFileFingerprints(baseline, current);
}
