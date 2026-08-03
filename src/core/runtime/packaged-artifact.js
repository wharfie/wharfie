import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { ARTIFACT_ID_PREFIX } from './artifact-record.js';

const READ_CHUNK_SIZE = 64 * 1024;
const INVALID_ARTIFACT_PATH_ERROR =
  'artifactPath must be a nonempty canonical path.';
const NOT_REGULAR_FILE_ERROR = 'Artifact path must identify a regular file.';
const ARTIFACT_TOO_LARGE_ERROR =
  'Artifact file is too large to identify safely.';
const ARTIFACT_CHANGED_ERROR =
  'Artifact bytes changed while they were being read.';
const SOURCE_CLOSED_ERROR = 'Held artifact source is closed.';
const SOURCE_STREAM_ACTIVE_ERROR =
  'Held artifact source already has an active read stream.';
const SOURCE_STREAM_USED_ERROR =
  'Held artifact source read stream is single-use.';
const SOURCE_STREAM_REQUIRED_ERROR =
  'Held artifact source must be streamed before verification.';
const SOURCE_STREAM_INCOMPLETE_ERROR =
  'Held artifact source stream did not finish successfully.';
const ARTIFACT_VALIDATION_AND_CLOSE_FAILED =
  'Artifact validation and descriptor cleanup both failed.';

/**
 * Close a descriptor after validation failed without losing either failure.
 * Explicit booleans preserve `undefined` and other non-Error rejection reasons.
 * @param {unknown} primaryError - Validation failure.
 * @param {() => Promise<void>} close - Descriptor cleanup.
 * @returns {Promise<never>} - Always rejects with deterministic precedence.
 */
async function closeAfterValidationFailure(primaryError, close) {
  let closeFailed = false;
  /** @type {unknown} */
  let closeError;
  try {
    await close();
  } catch (error) {
    closeFailed = true;
    closeError = error;
  }
  if (closeFailed) {
    throw new AggregateError(
      [primaryError, closeError],
      ARTIFACT_VALIDATION_AND_CLOSE_FAILED,
    );
  }
  throw primaryError;
}

/**
 * @typedef HeldArtifactObservation
 * @property {string} artifactId - Content-addressed artifact identity.
 * @property {Readonly<{algorithm: 'sha256', value: string}>} byteDigest - Exact byte digest.
 * @property {number} size - Exact byte length.
 */

/**
 * @typedef HeldArtifactSource
 * @property {Readonly<HeldArtifactObservation>} observation - Identity read through the held descriptor.
 * @property {() => Readable} createReadStream - Create the sole bounded upload stream.
 * @property {() => Promise<Readonly<HeldArtifactObservation>>} verifyUnchanged - Verify descriptor metadata after upload streaming.
 * @property {() => Promise<void>} close - Close the descriptor exactly once.
 */

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
 * @param {import('node:fs').BigIntStats} left - First descriptor observation.
 * @param {import('node:fs').BigIntStats} right - Observation after streaming.
 * @returns {boolean} - Whether both observations describe unchanged bytes.
 */
function isSameArtifactFile(left, right) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * Reject pathname spellings that could be reinterpreted between security
 * boundaries. Symlink resolution deliberately remains an `open(2)` concern:
 * Linux `/proc/self/exe` must retain its held-executable semantics.
 * @param {string} artifactPath - Candidate executable path.
 * @returns {void} - Validates or throws.
 */
function assertCanonicalArtifactPath(artifactPath) {
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
    throw new TypeError(INVALID_ARTIFACT_PATH_ERROR);
  }
}

/**
 * Read exactly the original descriptor length using explicit positions. Each
 * yielded buffer is independently owned so downstream backpressure cannot
 * observe a later read mutating an earlier chunk.
 * @param {import('node:fs/promises').FileHandle} artifactFile - Held file.
 * @param {number} size - Original byte length.
 * @yields {Buffer} - One independently owned byte chunk.
 * @returns {AsyncIterable<Buffer>} - Bounded byte sequence.
 */
async function* readHeldArtifactChunks(artifactFile, size) {
  let position = 0;
  while (position < size) {
    const requested = Math.min(READ_CHUNK_SIZE, size - position);
    const buffer = Buffer.allocUnsafe(requested);
    const { bytesRead } = await artifactFile.read(
      buffer,
      0,
      requested,
      position,
    );
    if (bytesRead === 0) throw new Error(ARTIFACT_CHANGED_ERROR);
    position += bytesRead;
    yield bytesRead === requested ? buffer : buffer.subarray(0, bytesRead);
  }
}

/**
 * Open and identify an artifact once, retaining the same descriptor for a
 * later upload. The source is intentionally one-shot: callers cannot perform
 * overlapping or ambiguous replay reads. `close()` may be called at any point
 * and safely tears down an unconsumed or active stream before closing the
 * descriptor.
 * @param {string} artifactPath - Absolute, lexically canonical artifact path.
 * @returns {Promise<Readonly<HeldArtifactSource>>} - Held artifact capability.
 */
export async function openHeldArtifactSource(artifactPath) {
  assertCanonicalArtifactPath(artifactPath);

  const artifactFile = await fsp.open(artifactPath, 'r');
  try {
    const before = await artifactFile.stat({ bigint: true });
    if (!before.isFile()) throw new Error(NOT_REGULAR_FILE_ERROR);
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(ARTIFACT_TOO_LARGE_ERROR);
    }
    const size = Number(before.size);
    const hash = createHash('sha256');
    let hashedSize = 0;
    for await (const chunk of readHeldArtifactChunks(artifactFile, size)) {
      hash.update(chunk);
      hashedSize += chunk.length;
    }
    const afterHash = await artifactFile.stat({ bigint: true });
    if (hashedSize !== size || !isSameArtifactFile(before, afterHash)) {
      throw new Error(ARTIFACT_CHANGED_ERROR);
    }

    const digest = hash.digest('base64url');
    const observation = Object.freeze({
      artifactId: `${ARTIFACT_ID_PREFIX}_${digest}`,
      byteDigest: Object.freeze({ algorithm: 'sha256', value: digest }),
      size,
    });

    /** @type {'unused' | 'active' | 'complete' | 'incomplete'} */
    let streamState = 'unused';
    /** @type {Readable | undefined} */
    let activeStream;
    /** @type {Promise<void> | undefined} */
    let activeStreamDone;
    /** @type {Promise<Readonly<HeldArtifactObservation>> | undefined} */
    let verificationPromise;
    /** @type {Promise<void> | undefined} */
    let closePromise;

    /** @returns {void} */
    function assertOpen() {
      if (closePromise) throw new Error(SOURCE_CLOSED_ERROR);
    }

    /** @returns {Readable} - Sole bounded upload stream. */
    function createReadStream() {
      assertOpen();
      if (streamState === 'active') {
        throw new Error(SOURCE_STREAM_ACTIVE_ERROR);
      }
      if (streamState !== 'unused') {
        throw new Error(SOURCE_STREAM_USED_ERROR);
      }

      streamState = 'active';
      let readCompleted = false;
      const stream = Readable.from(
        (async function* () {
          yield* readHeldArtifactChunks(artifactFile, size);
          readCompleted = true;
        })(),
        { objectMode: false },
      );
      activeStream = stream;
      activeStreamDone = new Promise((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          streamState = readCompleted ? 'complete' : 'incomplete';
          activeStream = undefined;
          resolve();
        };
        stream.once('end', settle);
        stream.once('error', settle);
        stream.once('close', settle);
      });
      return stream;
    }

    /** @returns {Promise<Readonly<HeldArtifactObservation>>} - Stable verification result. */
    function verifyUnchanged() {
      if (closePromise) return Promise.reject(new Error(SOURCE_CLOSED_ERROR));
      if (streamState === 'unused') {
        return Promise.reject(new Error(SOURCE_STREAM_REQUIRED_ERROR));
      }
      if (streamState === 'active') {
        return Promise.reject(new Error(SOURCE_STREAM_ACTIVE_ERROR));
      }
      if (streamState !== 'complete') {
        return Promise.reject(new Error(SOURCE_STREAM_INCOMPLETE_ERROR));
      }
      verificationPromise ??= (async () => {
        const afterStream = await artifactFile.stat({ bigint: true });
        if (!isSameArtifactFile(before, afterStream)) {
          throw new Error(ARTIFACT_CHANGED_ERROR);
        }
        return observation;
      })();
      return verificationPromise;
    }

    /** @returns {Promise<void>} - Stable close result. */
    function close() {
      if (closePromise) return closePromise;
      const pendingVerification = verificationPromise;
      const pendingStream = activeStreamDone;
      const stream = activeStream;
      closePromise = (async () => {
        if (stream) {
          stream.destroy();
          await pendingStream;
        }
        if (pendingVerification) {
          await pendingVerification.catch(() => {});
        }
        await artifactFile.close();
      })();
      return closePromise;
    }

    return Object.freeze({
      observation,
      createReadStream,
      verifyUnchanged,
      close,
    });
  } catch (error) {
    return closeAfterValidationFailure(error, async () => {
      await artifactFile.close();
    });
  }
}

/**
 * Stream-hash one packaged executable through a single opened file handle.
 * The returned identity describes the exact bytes consumed, not merely the
 * path supplied by the caller.
 * @param {string} artifactPath - Executable path.
 * @returns {Promise<Readonly<{artifactId: string, byteDigest: {algorithm: 'sha256', value: string}, size: number}>>} - Exact byte observation.
 */
export async function inspectArtifactBytes(artifactPath) {
  const source = await openHeldArtifactSource(artifactPath);
  try {
    return source.observation;
  } finally {
    await source.close();
  }
}

export default inspectArtifactBytes;
