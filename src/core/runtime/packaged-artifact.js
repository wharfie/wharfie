import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { ARTIFACT_ID_PREFIX } from './artifact-record.js';

/**
 * Resolve the executable inode backing this process. Linux exposes the held
 * executable through `/proc/self/exe`, which remains bound to the running
 * inode even if the pathname used to launch the process is replaced.
 * @param {{platform?: string, execPath?: string}} [options] - Host identity.
 * @returns {string} - Stable path to the running executable bytes.
 */
export function getRunningExecutablePath(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'linux') return '/proc/self/exe';
  return options.execPath || process.execPath;
}

/**
 * Compare the properties that identify the exact regular file opened for an
 * artifact observation. Reading through one held descriptor prevents a path
 * replacement from silently changing the bytes being identified.
 * @param {import('node:fs').Stats} left - First descriptor observation.
 * @param {import('node:fs').Stats} right - Observation after streaming.
 * @returns {boolean} - Whether both observations describe unchanged bytes.
 */
function isSameArtifactFile(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/**
 * Stream-hash one packaged executable through a single opened file handle.
 * The returned identity describes the exact bytes consumed, not merely the
 * path supplied by the caller.
 * @param {string} artifactPath - Executable path.
 * @returns {Promise<Readonly<{artifactId: string, byteDigest: {algorithm: 'sha256', value: string}, size: number}>>} - Exact byte observation.
 */
export async function inspectArtifactBytes(artifactPath) {
  if (
    typeof artifactPath !== 'string' ||
    artifactPath.length === 0 ||
    artifactPath.trim() !== artifactPath ||
    artifactPath.includes('\0') ||
    artifactPath.includes('\n') ||
    artifactPath.includes('\r') ||
    !path.isAbsolute(artifactPath) ||
    path.normalize(artifactPath) !== artifactPath
  ) {
    throw new TypeError('artifactPath must be a nonempty canonical path.');
  }

  const artifactFile = await fsp.open(artifactPath, 'r');
  try {
    const before = await artifactFile.stat();
    if (!before.isFile()) {
      throw new Error('Artifact path must identify a regular file.');
    }
    const hash = createHash('sha256');
    let streamedSize = 0;
    const stream = artifactFile.createReadStream({
      autoClose: false,
      start: 0,
    });
    for await (const chunk of stream) {
      hash.update(chunk);
      streamedSize += chunk.length;
    }
    const after = await artifactFile.stat();
    if (streamedSize !== before.size || !isSameArtifactFile(before, after)) {
      throw new Error('Artifact bytes changed while they were being read.');
    }

    const digest = hash.digest('base64url');
    return Object.freeze({
      artifactId: `${ARTIFACT_ID_PREFIX}_${digest}`,
      byteDigest: Object.freeze({ algorithm: 'sha256', value: digest }),
      size: streamedSize,
    });
  } finally {
    await artifactFile.close();
  }
}

export default inspectArtifactBytes;
