/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This specialized immutable publication transaction keeps its narrow boundary inline. */

import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_MAX_BYTES,
  validateAwsRetainedStorageHostPreflightSeaArtifactRecord,
} from './aws-host-retained-storage-host-preflight-sea-artifact-record.js';

const INPUT_KEYS = new Set([
  'outputDirectory',
  'record',
  'bundleBytes',
  'artifactBytes',
  'generation',
]);
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;

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
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(
      `${valuePath} must contain only its exact required keys.`,
    );
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
    }
  }
}

/** @param {unknown} value @param {number} maximum @param {string} valuePath @returns {Buffer} */
function snapshotBytes(value, maximum, valuePath) {
  let bytes;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    bytes = Buffer.from(value);
  } else if (value instanceof ArrayBuffer) {
    bytes = Buffer.from(value.slice(0));
  } else {
    throw new TypeError(`${valuePath} must be bytes.`);
  }
  if (bytes.length < 1 || bytes.length > maximum) {
    throw new TypeError(
      `${valuePath} must contain between 1 and ${maximum} bytes.`,
    );
  }
  return bytes;
}

/** @param {unknown} error @returns {boolean} */
function isNotFound(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

/** @param {unknown} error @returns {boolean} */
function isAlreadyExists(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}

/** @param {string} filePath @returns {Promise<import('node:fs').Stats | null>} */
async function lstatIfExists(filePath) {
  try {
    return await fsp.lstat(filePath);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

/**
 * Classify an unchanged snapshot or the one expected transient transition:
 * removing the winning publisher's staged hardlink changes nlink from two to
 * one and updates ctime. A cleanup transition never makes a read trustworthy;
 * callers must discard the read and retry until every snapshot is stable.
 * @param {import('node:fs').BigIntStats} before
 * @param {import('node:fs').BigIntStats} after
 * @returns {'stable'|'retry'|'changed'}
 */
function classifyReadSnapshot(before, after) {
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs ||
    before.mode !== after.mode ||
    before.uid !== after.uid ||
    before.gid !== after.gid
  ) {
    return 'changed';
  }
  if (before.nlink === after.nlink && before.ctimeNs === after.ctimeNs) {
    return 'stable';
  }
  if (before.nlink === 2n && after.nlink === 1n) {
    return 'retry';
  }
  return 'changed';
}

/**
 * @param {string} filePath
 * @param {string} label
 * @param {number} expectedSize
 * @returns {Promise<Buffer>}
 */
async function readRegularFile(filePath, label, expectedSize) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 1) {
    throw new TypeError(
      `${label} expected size must be a positive safe integer.`,
    );
  }
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const before = await fsp.lstat(filePath, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error(`${label} must be a regular non-symbolic file.`);
    }
    const handle = await fsp.open(filePath, fsConstants.O_RDONLY | noFollow);
    try {
      const opened = await handle.stat({ bigint: true });
      const openTransition = classifyReadSnapshot(before, opened);
      if (!opened.isFile() || openTransition === 'changed') {
        throw new Error(`${label} changed before it could be read.`);
      }
      if (openTransition === 'retry') continue;
      if (opened.size !== BigInt(expectedSize)) {
        throw new Error(
          `${label} size conflicts with the exact immutable bytes being published.`,
        );
      }
      const bytes = await handle.readFile();
      // Keep these observations ordered so the permitted 2-to-1 cleanup can
      // be identified, discarded, and retried instead of appearing reversed.
      const after = await handle.stat({ bigint: true });
      const afterPath = await fsp.lstat(filePath, { bigint: true });
      const readTransition = classifyReadSnapshot(opened, after);
      const pathTransition = classifyReadSnapshot(after, afterPath);
      if (
        readTransition === 'changed' ||
        afterPath.isSymbolicLink() ||
        !afterPath.isFile() ||
        pathTransition === 'changed' ||
        BigInt(bytes.length) !== opened.size
      ) {
        throw new Error(`${label} changed while it was being read.`);
      }
      if (readTransition === 'retry' || pathTransition === 'retry') continue;
      return bytes;
    } finally {
      await handle.close();
    }
  }
  throw new Error(`${label} did not stabilize after staged-link cleanup.`);
}

/** @param {string} filePath @returns {Promise<void>} */
async function syncFile(filePath) {
  const handle = await fsp.open(filePath, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {string} directory @returns {Promise<void>} */
async function syncDirectory(directory) {
  const handle = await fsp.open(directory, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** @param {unknown} value @returns {Promise<string>} */
export async function validateAwsRetainedStorageHostPreflightSeaOutputDirectory(
  value,
) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight outputDirectory must be an absolute canonical path.',
    );
  }
  const stats = await fsp.lstat(value);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new TypeError(
      'AWS retained-storage host preflight outputDirectory must be a real directory.',
    );
  }
  const real = await fsp.realpath(value);
  if (real !== value) {
    throw new TypeError(
      'AWS retained-storage host preflight outputDirectory cannot traverse symbolic links.',
    );
  }
  return value;
}

/** @param {Readonly<Record<string, any>>} record @returns {Buffer} */
function recordBytes(record) {
  const bytes = Buffer.from(
    `${JSON.stringify(sortCanonicalJsonValue(record))}\n`,
    'utf8',
  );
  if (
    bytes.length < 1 ||
    bytes.length >
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_ARTIFACT_RECORD_MAX_BYTES
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA artifact record is too large to publish.',
    );
  }
  return bytes;
}

/**
 * Require exact staged or published binary and sidecar bytes and validate the
 * record again against same-generation build evidence.
 * @param {string} binaryPath
 * @param {string} sidecarPath
 * @param {Buffer} expectedArtifactBytes
 * @param {Buffer} expectedRecordBytes
 * @param {Buffer} bundleBytes
 * @param {unknown} generation
 * @returns {Promise<void>}
 */
async function validatePublishedPair(
  binaryPath,
  sidecarPath,
  expectedArtifactBytes,
  expectedRecordBytes,
  bundleBytes,
  generation,
) {
  const [artifactBytes, sidecarBytes] = await Promise.all([
    readRegularFile(
      binaryPath,
      `SEA artifact '${binaryPath}'`,
      expectedArtifactBytes.length,
    ),
    readRegularFile(
      sidecarPath,
      `SEA artifact record '${sidecarPath}'`,
      expectedRecordBytes.length,
    ),
  ]);
  if (!artifactBytes.equals(expectedArtifactBytes)) {
    throw new Error(
      `SEA artifact '${binaryPath}' conflicts with the exact immutable artifact being published.`,
    );
  }
  if (!sidecarBytes.equals(expectedRecordBytes)) {
    throw new Error(
      `SEA artifact record '${sidecarPath}' conflicts with the exact immutable record being published.`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(sidecarBytes.toString('utf8'));
  } catch {
    throw new Error(`SEA artifact record '${sidecarPath}' is not valid JSON.`);
  }
  validateAwsRetainedStorageHostPreflightSeaArtifactRecord(parsed, {
    bundleBytes,
    artifactBytes,
    generation,
  });
}

/**
 * Link a staged immutable path create-if-absent. An EEXIST winner is accepted
 * only after exact byte equality is established.
 * @param {string} stagedPath
 * @param {string} finalPath
 * @param {Buffer} expectedBytes
 * @param {string} label
 * @returns {Promise<void>}
 */
async function linkOrReuse(stagedPath, finalPath, expectedBytes, label) {
  try {
    await fsp.link(stagedPath, finalPath);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const winner = await readRegularFile(
      finalPath,
      label,
      expectedBytes.length,
    );
    if (!winner.equals(expectedBytes)) {
      throw new Error(
        `${label} conflicts with the exact immutable bytes being published.`,
      );
    }
  }
}

/**
 * Publish one content-addressed Linux SEA and its post-build evidence sidecar.
 * The sidecar is linked last and is the durable commit marker. A matching
 * binary left by an interrupted prior transaction is safely completed. Final
 * immutable links are never rolled back: that makes the binary-only state
 * crash-recoverable and prevents one concurrent publisher from deleting a
 * path another publisher has already reused.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function publishAwsRetainedStorageHostPreflightSeaArtifact(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA publication input must be an object.',
    );
  }
  assertExactKeys(
    value,
    INPUT_KEYS,
    'AWS retained-storage host preflight SEA publication input',
  );
  const bundleBytes = snapshotBytes(
    value.bundleBytes,
    MAX_BUNDLE_BYTES,
    'AWS retained-storage host preflight SEA publication bundleBytes',
  );
  const artifactBytes = snapshotBytes(
    value.artifactBytes,
    MAX_ARTIFACT_BYTES,
    'AWS retained-storage host preflight SEA publication artifactBytes',
  );
  const record = validateAwsRetainedStorageHostPreflightSeaArtifactRecord(
    value.record,
    {
      bundleBytes,
      artifactBytes,
      generation: value.generation,
    },
  );
  const outputDirectory =
    await validateAwsRetainedStorageHostPreflightSeaOutputDirectory(
      value.outputDirectory,
    );
  const providerArchitecture = record.delivery.collector.expectedArchitecture;
  const fileName =
    `wharfie-aws-retained-storage-host-preflight-` +
    `${providerArchitecture}-${record.artifactId}`;
  const finalPath = path.join(outputDirectory, fileName);
  const finalRecordPath = `${finalPath}.artifact.json`;
  const expectedRecordBytes = recordBytes(record);
  /** @type {string | undefined} */
  let stagingDirectory;
  /** @type {unknown} */
  let primaryError;
  /** @type {Readonly<Record<string, any>> | undefined} */
  let result;

  try {
    stagingDirectory = await fsp.mkdtemp(
      path.join(outputDirectory, '.wharfie-host-preflight-'),
    );
    await fsp.chmod(stagingDirectory, 0o700);
    const readyDirectory = path.join(stagingDirectory, 'ready');
    await fsp.mkdir(readyDirectory, { mode: 0o700 });
    await fsp.chmod(readyDirectory, 0o700);
    const stagedPath = path.join(readyDirectory, fileName);
    const stagedRecordPath = `${stagedPath}.artifact.json`;
    await fsp.writeFile(stagedPath, artifactBytes, {
      flag: 'wx',
      mode: 0o755,
    });
    await fsp.chmod(stagedPath, 0o755);
    await fsp.writeFile(stagedRecordPath, expectedRecordBytes, {
      flag: 'wx',
      mode: 0o600,
    });
    await fsp.chmod(stagedRecordPath, 0o600);
    await Promise.all([syncFile(stagedPath), syncFile(stagedRecordPath)]);
    await syncDirectory(readyDirectory);
    await validatePublishedPair(
      stagedPath,
      stagedRecordPath,
      artifactBytes,
      expectedRecordBytes,
      bundleBytes,
      value.generation,
    );

    const [existingArtifact, existingRecord] = await Promise.all([
      lstatIfExists(finalPath),
      lstatIfExists(finalRecordPath),
    ]);
    if (
      existingArtifact &&
      (existingArtifact.isSymbolicLink() || !existingArtifact.isFile())
    ) {
      throw new Error(
        `SEA artifact destination '${finalPath}' must be a regular non-symbolic file.`,
      );
    }
    if (
      existingRecord &&
      (existingRecord.isSymbolicLink() || !existingRecord.isFile())
    ) {
      throw new Error(
        `SEA artifact record destination '${finalRecordPath}' must be a regular non-symbolic file.`,
      );
    }
    if (existingRecord && !existingArtifact) {
      throw new Error(
        `SEA artifact record '${finalRecordPath}' exists without its immutable artifact.`,
      );
    }
    if (existingArtifact) {
      const existingBytes = await readRegularFile(
        finalPath,
        `Existing SEA artifact '${finalPath}'`,
        artifactBytes.length,
      );
      if (!existingBytes.equals(artifactBytes)) {
        throw new Error(
          `Existing SEA artifact '${finalPath}' conflicts with the exact immutable artifact being published.`,
        );
      }
    }
    if (existingRecord) {
      await validatePublishedPair(
        finalPath,
        finalRecordPath,
        artifactBytes,
        expectedRecordBytes,
        bundleBytes,
        value.generation,
      );
    }

    await linkOrReuse(
      stagedPath,
      finalPath,
      artifactBytes,
      `SEA artifact destination '${finalPath}'`,
    );
    await syncDirectory(outputDirectory);

    await linkOrReuse(
      stagedRecordPath,
      finalRecordPath,
      expectedRecordBytes,
      `SEA artifact record destination '${finalRecordPath}'`,
    );
    await syncDirectory(outputDirectory);

    await validatePublishedPair(
      finalPath,
      finalRecordPath,
      artifactBytes,
      expectedRecordBytes,
      bundleBytes,
      value.generation,
    );
    result = Object.freeze({
      fileName,
      path: finalPath,
      recordPath: finalRecordPath,
      artifactId: record.artifactId,
      recordId: record.recordId,
      byteDigest: record.byteDigest,
      size: record.size,
      target: record.target,
      record,
    });
  } catch (error) {
    primaryError = error;
  }

  /** @type {unknown[]} */
  const cleanupErrors = [];
  if (stagingDirectory) {
    try {
      await fsp.rm(stagingDirectory, { force: true, recursive: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (primaryError || cleanupErrors.length > 0) {
    if (primaryError && cleanupErrors.length === 0) throw primaryError;
    throw new AggregateError(
      [...(primaryError ? [primaryError] : []), ...cleanupErrors],
      primaryError
        ? 'AWS retained-storage host preflight SEA publication failed and cleanup was incomplete.'
        : 'AWS retained-storage host preflight SEA publication committed but cleanup was incomplete.',
    );
  }
  if (!result) {
    throw new Error(
      'AWS retained-storage host preflight SEA publication completed without a result.',
    );
  }
  return result;
}

export default publishAwsRetainedStorageHostPreflightSeaArtifact;
