/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This closed Linux observer deliberately keeps its exact read-only host port inline. */

import { spawn } from 'node:child_process';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  getAwsSingleNodeHostRetainedStorageBootProjection,
  validateAwsSingleNodeHostRetainedStorageDesired,
} from './deployment-aws-host-retained-storage.js';
import { createAwsSingleNodeHostRetainedStorageBlankFormatProof } from './deployment-aws-host-retained-storage-format-journal.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from './deployment-aws-host-retained-storage-projection.js';
import { cloneBoundedJsonObject } from './json-value.js';

export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_UDEVADM_PATH =
  '/usr/bin/udevadm';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LSBLK_PATH =
  '/usr/bin/lsblk';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLKID_PATH =
  '/usr/sbin/blkid';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_WIPEFS_PATH =
  '/usr/sbin/wipefs';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_MOUNTINFO_PATH =
  '/proc/1/mountinfo';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SELF_MOUNT_NAMESPACE_PATH =
  '/proc/self/ns/mnt';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PID1_MOUNT_NAMESPACE_PATH =
  '/proc/1/ns/mnt';

const TOOL_TIMEOUT_MILLISECONDS = 10_000;
const SMALL_OUTPUT_MAX_BYTES = 16 * 1024;
const LSBLK_OUTPUT_MAX_BYTES = 256 * 1024;
const MOUNTINFO_MAX_BYTES = 1024 * 1024;
const UNIT_MAX_BYTES = 16 * 1024;
const MAX_BLOCK_RECORDS = 256;
const MAX_BLOCK_DEPTH = 8;
const MAX_MOUNTINFO_LINES = 4096;
const MAX_HOLDERS = 64;
const MAX_TARGET_DIRECTORY_ENTRIES = 1;
const MOUNT_NAMESPACE_PATTERN = /^mnt:\[[1-9][0-9]*\]$/u;
const PORT_KEYS = new Set([
  'run',
  'readText',
  'readDirectory',
  'readLink',
  'stat',
]);
const TEST_FACTORY_KEYS = new Set(['ports']);
const RUN_RESULT_KEYS = new Set(['exitCode', 'stdout', 'stderr']);
const STAT_KEYS = new Set([
  'type',
  'uid',
  'gid',
  'mode',
  'nlink',
  'rdevMajor',
  'rdevMinor',
]);
const LSBLK_ROOT_KEYS = new Set(['blockdevices']);
const LSBLK_REQUIRED_KEYS = new Set([
  'path',
  'type',
  'size',
  'ro',
  'rm',
  'model',
  'serial',
  'maj:min',
  'pkname',
]);
const LSBLK_SUPPORTED_KEYS = new Set([...LSBLK_REQUIRED_KEYS, 'children']);
const WIPEFS_ROOT_KEYS = new Set(['signatures']);
const WIPEFS_SIGNATURE_KEYS = new Set(['type', 'uuid']);
const NVME_PATH_PATTERN = /^\/dev\/nvme[0-9]+n[0-9]+$/u;
const EBS_SERIAL_PATTERN = /^vol-?[0-9a-f]{8,32}$/u;
const MAJOR_MINOR_PATTERN = /^([0-9]+):([0-9]+)$/u;
const FIXED_LIVE_MOUNT_OPTIONS = Object.freeze([
  'rw',
  'nodev',
  'noexec',
  'nosuid',
  'relatime',
]);

class RetainedStorageUnknownError extends Error {
  constructor() {
    super('AWS single-node retained storage observation is unknown.');
    this.name = 'RetainedStorageUnknownError';
  }
}

class RetainedStorageConflictError extends Error {
  constructor() {
    super('AWS single-node retained storage observation conflicts.');
    this.name = 'RetainedStorageConflictError';
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

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactPlainObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !keys.has(key)) {
      throw new TypeError(`${valuePath}.${String(key)} is not supported.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
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
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !keys.has(key)) {
      throw new TypeError(`${valuePath}.${String(key)} is not supported.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
    }
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {unknown} */
function ownDataValue(value, key, valuePath) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(`${valuePath}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {Function} */
function ownDataFunction(value, key, valuePath) {
  const candidate = ownDataValue(value, key, valuePath);
  if (typeof candidate !== 'function') {
    throw new TypeError(`${valuePath}.${key} must be a function.`);
  }
  return candidate;
}

/** @template T @param {T} value @returns {T} */
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

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function positiveSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {number} maxBytes @returns {string} */
function boundedText(value, maxBytes) {
  if (
    typeof value !== 'string' ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new RetainedStorageUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string|null} */
function normalizeEbsSerial(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!EBS_SERIAL_PATTERN.test(normalized)) return null;
  const hex = normalized.startsWith('vol-')
    ? normalized.slice('vol-'.length)
    : normalized.slice('vol'.length);
  return `vol-${hex}`;
}

/** @param {unknown} value @returns {string} */
function singleLine(value) {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new RetainedStorageUnknownError();
  }
  const normalized = value.replace(/\r?\n$/u, '');
  if (normalized.includes('\n') || normalized.includes('\r')) {
    throw new RetainedStorageUnknownError();
  }
  return normalized.trim();
}

/** @param {unknown} value @returns {boolean} */
function falseBoolean(value) {
  if (value === false || value === 0) return false;
  if (value === true || value === 1) return true;
  throw new RetainedStorageUnknownError();
}

/** @param {unknown} value @returns {number} */
function decimalSafeInteger(value) {
  if (typeof value === 'number') {
    return nonnegativeSafeInteger(value, 'lsblk integer');
  }
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9][0-9]*)$/u.test(value) ||
    value.length > 16
  ) {
    throw new RetainedStorageUnknownError();
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RetainedStorageUnknownError();
  return parsed;
}

/** @param {unknown} value @returns {{major: number, minor: number}} */
function majorMinor(value) {
  if (typeof value !== 'string') throw new RetainedStorageUnknownError();
  const match = MAJOR_MINOR_PATTERN.exec(value);
  if (match === null) throw new RetainedStorageUnknownError();
  return {
    major: positiveSafeInteger(Number(match[1]), 'block device major'),
    minor: nonnegativeSafeInteger(Number(match[2]), 'block device minor'),
  };
}

/** @param {string} text @param {number} maxBytes @returns {Record<string, any>} */
function parseBoundedJsonObject(text, maxBytes) {
  boundedText(text, maxBytes);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RetainedStorageUnknownError();
  }
  try {
    return cloneBoundedJsonObject(
      parsed,
      maxBytes,
      'retained storage tool JSON',
    );
  } catch {
    throw new RetainedStorageUnknownError();
  }
}

/** @param {unknown} value @param {number} depth @param {{count: number}} budget @returns {Readonly<Record<string, any>>} */
function normalizeLsblkRecord(value, depth, budget) {
  if (depth > MAX_BLOCK_DEPTH || budget.count >= MAX_BLOCK_RECORDS) {
    throw new RetainedStorageUnknownError();
  }
  budget.count += 1;
  const record = exactPlainObject(value, 'lsblk record');
  assertSupportedKeys(record, LSBLK_SUPPORTED_KEYS, 'lsblk record');
  for (const key of LSBLK_REQUIRED_KEYS) {
    if (!Object.hasOwn(record, key)) throw new RetainedStorageUnknownError();
  }
  for (const key of ['path', 'type', 'maj:min']) {
    if (typeof record[key] !== 'string') {
      throw new RetainedStorageUnknownError();
    }
  }
  for (const key of ['model', 'serial', 'pkname']) {
    if (record[key] !== null && typeof record[key] !== 'string') {
      throw new RetainedStorageUnknownError();
    }
  }
  /** @type {Readonly<Record<string, any>>[]} */
  let children = [];
  if (Object.hasOwn(record, 'children')) {
    if (!Array.isArray(record.children)) {
      throw new RetainedStorageUnknownError();
    }
    children = record.children.map((child) =>
      normalizeLsblkRecord(child, depth + 1, budget),
    );
  }
  const deviceNumber = majorMinor(record['maj:min']);
  return deepFreeze({
    path: record.path,
    type: record.type,
    size: decimalSafeInteger(record.size),
    readOnly: falseBoolean(record.ro),
    removable: falseBoolean(record.rm),
    model: record.model,
    serial: record.serial,
    major: deviceNumber.major,
    minor: deviceNumber.minor,
    parentName: record.pkname,
    children,
  });
}

/** @param {readonly Readonly<Record<string, any>>[]} records @returns {Readonly<Record<string, any>>[]} */
function flattenBlockRecords(records) {
  /** @type {Readonly<Record<string, any>>[]} */
  const flattened = [];
  /** @param {Readonly<Record<string, any>>} record - Block record. */
  const visit = (record) => {
    flattened.push(record);
    for (const child of record.children) visit(child);
  };
  for (const record of records) visit(record);
  return flattened;
}

/** @param {string} output @returns {ReadonlyArray<Readonly<Record<string, any>>>} */
function parseLsblk(output) {
  const document = parseBoundedJsonObject(output, LSBLK_OUTPUT_MAX_BYTES);
  assertExactKeys(document, LSBLK_ROOT_KEYS, 'lsblk output');
  if (!Array.isArray(document.blockdevices)) {
    throw new RetainedStorageUnknownError();
  }
  const budget = { count: 0 };
  return document.blockdevices.map((record) =>
    normalizeLsblkRecord(record, 0, budget),
  );
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateRunResult(value) {
  const result = exactPlainObject(value, 'retained storage run result');
  assertExactKeys(result, RUN_RESULT_KEYS, 'retained storage run result');
  const exitCode = nonnegativeSafeInteger(
    result.exitCode,
    'retained storage run result.exitCode',
  );
  if (exitCode > 255) throw new RetainedStorageUnknownError();
  return Object.freeze({
    exitCode,
    stdout: boundedText(result.stdout, LSBLK_OUTPUT_MAX_BYTES),
    stderr: boundedText(result.stderr, SMALL_OUTPUT_MAX_BYTES),
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>|null} */
function validateStat(value) {
  if (value === null) return null;
  const stats = exactPlainObject(value, 'retained storage stat result');
  assertExactKeys(stats, STAT_KEYS, 'retained storage stat result');
  if (
    !['block', 'directory', 'regular', 'symlink', 'other'].includes(stats.type)
  ) {
    throw new RetainedStorageUnknownError();
  }
  const rdevMajor =
    stats.rdevMajor === null
      ? null
      : positiveSafeInteger(stats.rdevMajor, 'stat rdevMajor');
  const rdevMinor =
    stats.rdevMinor === null
      ? null
      : nonnegativeSafeInteger(stats.rdevMinor, 'stat rdevMinor');
  if ((rdevMajor === null) !== (rdevMinor === null)) {
    throw new RetainedStorageUnknownError();
  }
  return Object.freeze({
    type: stats.type,
    uid: nonnegativeSafeInteger(stats.uid, 'stat uid'),
    gid: nonnegativeSafeInteger(stats.gid, 'stat gid'),
    mode: nonnegativeSafeInteger(stats.mode, 'stat mode'),
    nlink: positiveSafeInteger(stats.nlink, 'stat nlink'),
    rdevMajor,
    rdevMinor,
  });
}

/** @param {unknown} portsValue @returns {Readonly<Record<string, Function>>} */
function validatePorts(portsValue) {
  const ports = exactPlainObject(portsValue, 'retained storage observer ports');
  assertExactKeys(ports, PORT_KEYS, 'retained storage observer ports');
  /** @type {Record<string, Function>} */
  const snapshot = {};
  for (const key of PORT_KEYS) {
    snapshot[key] = ownDataFunction(
      ports,
      key,
      'retained storage observer ports',
    ).bind(ports);
  }
  return Object.freeze(snapshot);
}

/** @param {Readonly<Record<string, Function>>} ports @param {string} file @param {ReadonlyArray<string>} args @param {number} maxOutputBytes @returns {Promise<Readonly<Record<string, any>>>} */
async function runTool(ports, file, args, maxOutputBytes) {
  const result = validateRunResult(
    await ports.run(
      deepFreeze({
        file,
        args: [...args],
        maxOutputBytes,
      }),
    ),
  );
  if (Buffer.byteLength(result.stdout, 'utf8') > maxOutputBytes) {
    throw new RetainedStorageUnknownError();
  }
  if (result.stderr.length !== 0) throw new RetainedStorageUnknownError();
  return result;
}

/** @param {Readonly<Record<string, Function>>} ports @param {string} filePath @param {number} maxBytes @returns {Promise<string|null>} */
async function readText(ports, filePath, maxBytes) {
  const value = await ports.readText(deepFreeze({ path: filePath, maxBytes }));
  return value === null ? null : boundedText(value, maxBytes);
}

/** @param {Readonly<Record<string, Function>>} ports @param {string} directoryPath @param {number} maxEntries @returns {Promise<ReadonlyArray<string>|null>} */
async function readDirectory(ports, directoryPath, maxEntries) {
  const value = await ports.readDirectory(
    deepFreeze({ path: directoryPath, maxEntries }),
  );
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > maxEntries) {
    throw new RetainedStorageUnknownError();
  }
  const names = value.map((name) => {
    if (
      typeof name !== 'string' ||
      name.length === 0 ||
      name === '.' ||
      name === '..' ||
      name.includes('/') ||
      name.includes('\0')
    ) {
      throw new RetainedStorageUnknownError();
    }
    return name;
  });
  return Object.freeze([...names].sort());
}

/** @param {Readonly<Record<string, Function>>} ports @param {string} filePath @param {number} maxBytes @returns {Promise<string|null>} */
async function readLink(ports, filePath, maxBytes) {
  const value = await ports.readLink(deepFreeze({ path: filePath, maxBytes }));
  return value === null ? null : boundedText(value, maxBytes);
}

/** @param {Readonly<Record<string, Function>>} ports @param {string} filePath @returns {Promise<Readonly<Record<string, any>>|null>} */
async function stat(ports, filePath) {
  return validateStat(await ports.stat(deepFreeze({ path: filePath })));
}

/** @param {Readonly<Record<string, any>>} desired @returns {ReadonlyArray<Readonly<Record<string, any>>>} */
function targetAncestryProjection(desired) {
  if (
    desired.mount.target !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT &&
    !desired.mount.target.startsWith(
      `${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT}/`,
    )
  ) {
    throw new RetainedStorageConflictError();
  }
  const components = desired.mount.target.split('/').filter(Boolean);
  if (components.length > 32) throw new RetainedStorageConflictError();
  /** @type {Readonly<Record<string, any>>[]} */
  const projected = [Object.freeze({ path: '/', uid: 0, gid: 0, mode: 0o755 })];
  let current = '';
  for (const component of components) {
    current = `${current}/${component}`;
    const runtimeOwned =
      current === '/var/lib/wharfie-runtime' ||
      current.startsWith('/var/lib/wharfie-runtime/');
    projected.push(
      Object.freeze({
        path: current,
        uid: runtimeOwned ? desired.directory.uid : 0,
        gid: runtimeOwned ? desired.directory.gid : 0,
        mode: runtimeOwned
          ? AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE
          : 0o755,
      }),
    );
  }
  return Object.freeze(projected);
}

/**
 * This is read-only conflict classification, not mutation authority. A future
 * mutator still needs quiescence plus descriptor-relative/openat2-style
 * creation and mount publication to close the post-observation TOCTOU.
 * @param {Readonly<Record<string, any>>} desired - Validated target state.
 * @param {Readonly<Record<string, Function>>} ports - Read-only host ports.
 * @returns {Promise<Readonly<{complete: boolean, targetStats: Readonly<Record<string, any>>|null}>>}
 */
async function inspectTargetAncestry(desired, ports) {
  const projection = targetAncestryProjection(desired);
  const observed = await Promise.all(
    projection.map(async (entry) => ({
      entry,
      stats: await stat(ports, entry.path),
    })),
  );
  let complete = true;
  /** @type {Readonly<Record<string, any>>|null} */
  let targetStats = null;
  for (const item of observed) {
    if (item.stats === null) {
      complete = false;
      continue;
    }
    if (
      item.stats.type !== 'directory' ||
      item.stats.uid !== item.entry.uid ||
      item.stats.gid !== item.entry.gid ||
      item.stats.mode !== item.entry.mode
    ) {
      throw new RetainedStorageConflictError();
    }
    if (item.entry.path === desired.mount.target) {
      targetStats = item.stats;
    }
  }
  return deepFreeze({ complete, targetStats });
}

/** @param {Readonly<Record<string, Function>>} ports @returns {Promise<string>} */
async function inspectMountNamespace(ports) {
  const [selfNamespace, pid1Namespace] = await Promise.all([
    readLink(
      ports,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SELF_MOUNT_NAMESPACE_PATH,
      SMALL_OUTPUT_MAX_BYTES,
    ),
    readLink(
      ports,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PID1_MOUNT_NAMESPACE_PATH,
      SMALL_OUTPUT_MAX_BYTES,
    ),
  ]);
  if (
    selfNamespace === null ||
    pid1Namespace === null ||
    !MOUNT_NAMESPACE_PATTERN.test(selfNamespace) ||
    selfNamespace !== pid1Namespace
  ) {
    throw new RetainedStorageUnknownError();
  }
  return selfNamespace;
}

/** @param {Readonly<Record<string, any>>} desired @param {Readonly<Record<string, Function>>} ports @returns {Promise<Readonly<Record<string, any>>>} */
async function observeIdentity(desired, ports) {
  const listing = await runTool(
    ports,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LSBLK_PATH,
    [
      '--json',
      '--bytes',
      '--paths',
      '--tree',
      '--output',
      'PATH,TYPE,SIZE,RO,RM,MODEL,SERIAL,MAJ:MIN,PKNAME',
    ],
    LSBLK_OUTPUT_MAX_BYTES,
  );
  if (listing.exitCode !== 0) throw new RetainedStorageUnknownError();
  const records = parseLsblk(listing.stdout);
  const flattened = flattenBlockRecords(records);
  const matches = flattened.filter(
    (record) =>
      normalizeEbsSerial(record.serial) === desired.volumeProviderResourceId,
  );
  if (matches.length === 0) throw new RetainedStorageUnknownError();
  if (matches.length !== 1) throw new RetainedStorageConflictError();
  const selected = matches[0];
  if (
    !NVME_PATH_PATTERN.test(selected.path) ||
    path.posix.normalize(selected.path) !== selected.path ||
    selected.type !== 'disk' ||
    selected.size !== desired.sizeBytes ||
    selected.readOnly !== false ||
    selected.removable !== false ||
    selected.parentName !== null ||
    selected.children.length !== 0 ||
    singleLine(selected.model) !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL
  ) {
    throw new RetainedStorageConflictError();
  }
  const deviceName = path.posix.basename(selected.path);
  if (
    flattened.some(
      (record) =>
        record !== selected &&
        (record.parentName === deviceName ||
          record.parentName === selected.path ||
          record.path.startsWith(`${selected.path}p`)),
    )
  ) {
    throw new RetainedStorageConflictError();
  }

  const sysfsRoot = path.posix.join('/sys/class/block', deviceName);
  const [modelText, serialText, holders, deviceStats] = await Promise.all([
    readText(
      ports,
      path.posix.join(sysfsRoot, 'device/model'),
      SMALL_OUTPUT_MAX_BYTES,
    ),
    readText(
      ports,
      path.posix.join(sysfsRoot, 'device/serial'),
      SMALL_OUTPUT_MAX_BYTES,
    ),
    readDirectory(ports, path.posix.join(sysfsRoot, 'holders'), MAX_HOLDERS),
    stat(ports, selected.path),
  ]);
  if (
    modelText === null ||
    serialText === null ||
    holders === null ||
    deviceStats === null
  ) {
    throw new RetainedStorageUnknownError();
  }
  if (
    singleLine(modelText) !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL ||
    normalizeEbsSerial(singleLine(serialText)) !==
      desired.volumeProviderResourceId
  ) {
    throw new RetainedStorageConflictError();
  }
  if (holders.length !== 0) throw new RetainedStorageConflictError();
  if (
    deviceStats.type !== 'block' ||
    deviceStats.rdevMajor !== selected.major ||
    deviceStats.rdevMinor !== selected.minor
  ) {
    throw new RetainedStorageUnknownError();
  }

  const byIdPath = getAwsSingleNodeHostRetainedStorageByIdPath(
    desired.volumeProviderResourceId,
  );
  const linkTarget = await readLink(ports, byIdPath, SMALL_OUTPUT_MAX_BYTES);
  if (linkTarget === null) throw new RetainedStorageUnknownError();
  const resolvedLink = path.posix.resolve(
    path.posix.dirname(byIdPath),
    linkTarget,
  );
  if (resolvedLink !== selected.path) {
    throw new RetainedStorageConflictError();
  }
  return deepFreeze({
    path: selected.path,
    major: selected.major,
    minor: selected.minor,
    model: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    serial: desired.volumeProviderResourceId,
    byIdPath,
    byIdTarget: linkTarget,
  });
}

/** @param {string} output @param {string} devicePath @returns {'blank'|'exact'|'foreign'} */
function parseBlkid(output, devicePath) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const line of output.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const separator = line.indexOf('=');
    if (separator < 1) throw new RetainedStorageUnknownError();
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (
      !['DEVNAME', 'TYPE', 'UUID'].includes(key) ||
      Object.hasOwn(values, key)
    ) {
      throw new RetainedStorageUnknownError();
    }
    values[key] = value;
  }
  if (Object.hasOwn(values, 'DEVNAME') && values.DEVNAME !== devicePath) {
    return 'foreign';
  }
  if (!Object.hasOwn(values, 'TYPE') || !Object.hasOwn(values, 'UUID')) {
    throw new RetainedStorageUnknownError();
  }
  return values.TYPE === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE
    ? 'exact'
    : 'foreign';
}

/** @param {string} output @param {Readonly<Record<string, any>>} desired @returns {'blank'|'exact'|'foreign'} */
function parseWipefs(output, desired) {
  const document = parseBoundedJsonObject(output, SMALL_OUTPUT_MAX_BYTES);
  assertExactKeys(document, WIPEFS_ROOT_KEYS, 'wipefs output');
  if (!Array.isArray(document.signatures)) {
    throw new RetainedStorageUnknownError();
  }
  if (document.signatures.length === 0) return 'blank';
  if (document.signatures.length !== 1) return 'foreign';
  const signature = exactPlainObject(
    document.signatures[0],
    'wipefs signature',
  );
  assertExactKeys(signature, WIPEFS_SIGNATURE_KEYS, 'wipefs signature');
  return signature.type ===
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE &&
    signature.uuid === desired.filesystem.uuid
    ? 'exact'
    : 'foreign';
}

/** @param {Readonly<Record<string, any>>} desired @param {Readonly<Record<string, any>>} identity @param {Readonly<Record<string, Function>>} ports @returns {Promise<'blank'|'exact'>} */
async function inspectFilesystem(desired, identity, ports) {
  const [blkid, wipefs] = await Promise.all([
    runTool(
      ports,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLKID_PATH,
      [
        '--probe',
        '--match-tag',
        'TYPE',
        '--match-tag',
        'UUID',
        '--output',
        'export',
        '--',
        identity.path,
      ],
      SMALL_OUTPUT_MAX_BYTES,
    ),
    runTool(
      ports,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_WIPEFS_PATH,
      ['--json', '--noheadings', '--output', 'TYPE,UUID', '--', identity.path],
      SMALL_OUTPUT_MAX_BYTES,
    ),
  ]);
  if (wipefs.exitCode !== 0) throw new RetainedStorageUnknownError();
  const wipefsState = parseWipefs(wipefs.stdout, desired);
  let blkidState;
  if (blkid.exitCode === 2 && blkid.stdout.length === 0) {
    blkidState = 'blank';
  } else if (blkid.exitCode === 0) {
    blkidState = parseBlkid(blkid.stdout, identity.path);
    if (
      blkidState === 'exact' &&
      !blkid.stdout.split(/\r?\n/u).includes(`UUID=${desired.filesystem.uuid}`)
    ) {
      blkidState = 'foreign';
    }
  } else {
    throw new RetainedStorageUnknownError();
  }
  if (blkidState === 'foreign' || wipefsState === 'foreign') {
    throw new RetainedStorageConflictError();
  }
  if (blkidState !== wipefsState) throw new RetainedStorageUnknownError();
  return blkidState;
}

/** @param {string} value @returns {string} */
function decodeMountField(value) {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '\\') {
      result += value[index];
      continue;
    }
    const escape = value.slice(index, index + 4);
    const decoded =
      escape === '\\040'
        ? ' '
        : escape === '\\011'
          ? '\t'
          : escape === '\\012'
            ? '\n'
            : escape === '\\134'
              ? '\\'
              : null;
    if (decoded === null) throw new RetainedStorageUnknownError();
    result += decoded;
    index += 3;
  }
  return result;
}

/** @param {string} output @returns {ReadonlyArray<Readonly<Record<string, any>>>} */
function parseMountinfo(output) {
  boundedText(output, MOUNTINFO_MAX_BYTES);
  const lines = output.split('\n').filter((line) => line.length !== 0);
  if (lines.length > MAX_MOUNTINFO_LINES) {
    throw new RetainedStorageUnknownError();
  }
  return lines.map((line) => {
    const fields = line.split(' ');
    const separator = fields.indexOf('-');
    if (separator < 6 || fields.length < separator + 4) {
      throw new RetainedStorageUnknownError();
    }
    const number = majorMinor(fields[2]);
    const mountOptions = new Set(fields[5].split(','));
    const superOptions = new Set(fields[separator + 3].split(','));
    return deepFreeze({
      major: number.major,
      minor: number.minor,
      root: decodeMountField(fields[3]),
      target: decodeMountField(fields[4]),
      mountOptions: [...mountOptions].sort(),
      optionalFields: fields.slice(6, separator).sort(),
      filesystemType: fields[separator + 1],
      source: decodeMountField(fields[separator + 2]),
      superOptions: [...superOptions].sort(),
    });
  });
}

/** @param {readonly Readonly<Record<string, any>>[]} entries @param {Readonly<Record<string, any>>} desired @param {Readonly<Record<string, any>>} identity @returns {boolean} */
function classifyMount(entries, desired, identity) {
  const involved = entries.filter(
    (entry) =>
      entry.target === desired.mount.target ||
      (entry.major === identity.major && entry.minor === identity.minor),
  );
  if (involved.length === 0) return false;
  if (involved.length !== 1) throw new RetainedStorageConflictError();
  const entry = involved[0];
  const mountOptions = new Set(entry.mountOptions);
  const superOptions = new Set(entry.superOptions);
  const privatePropagation = !entry.optionalFields.some(
    (/** @type {string} */ field) =>
      field.startsWith('shared:') ||
      field.startsWith('master:') ||
      field.startsWith('propagate_from:') ||
      field === 'unbindable',
  );
  if (
    entry.target !== desired.mount.target ||
    entry.major !== identity.major ||
    entry.minor !== identity.minor ||
    entry.root !== '/' ||
    entry.filesystemType !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE ||
    entry.source !== identity.path ||
    !FIXED_LIVE_MOUNT_OPTIONS.every((option) => mountOptions.has(option)) ||
    !superOptions.has('rw') ||
    !superOptions.has('errors=remount-ro') ||
    mountOptions.has('ro') ||
    superOptions.has('ro') ||
    !privatePropagation
  ) {
    throw new RetainedStorageConflictError();
  }
  return true;
}

/** @param {Readonly<Record<string, any>>|null} stats @param {Readonly<Record<string, any>>} desired @param {boolean} mounted @param {Readonly<Record<string, Function>>} ports @returns {Promise<'absent'|'empty'|'mounted'>} */
async function inspectTargetDirectory(stats, desired, mounted, ports) {
  if (stats === null) {
    if (mounted) throw new RetainedStorageUnknownError();
    return 'absent';
  }
  if (
    stats.type !== 'directory' ||
    stats.uid !== desired.directory.uid ||
    stats.gid !== desired.directory.gid ||
    stats.mode !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE
  ) {
    throw new RetainedStorageConflictError();
  }
  if (!mounted) {
    const entries = await readDirectory(
      ports,
      desired.mount.target,
      MAX_TARGET_DIRECTORY_ENTRIES,
    );
    if (entries === null) throw new RetainedStorageUnknownError();
    if (entries.length !== 0) throw new RetainedStorageConflictError();
    return 'empty';
  }
  return 'mounted';
}

/** @param {Readonly<Record<string, any>>} desired @param {Readonly<Record<string, Function>>} ports @returns {Promise<'absent'|'gate-only'|'unit'|'gated'|'enabled'>} */
async function inspectBootWiring(desired, ports) {
  const projection = getAwsSingleNodeHostRetainedStorageBootProjection(desired);
  const gate = projection.userManagerGate;
  const [unitStats, linkStats, gateStats, ...legacyStats] = await Promise.all([
    stat(ports, projection.unitPath),
    stat(ports, projection.enableLinkPath),
    stat(ports, gate.dropInPath),
    ...gate.legacyDropInPaths.map((/** @type {string} */ legacyPath) =>
      stat(ports, legacyPath),
    ),
  ]);
  if (legacyStats.some((stats) => stats !== null)) {
    throw new RetainedStorageConflictError();
  }

  if (gateStats !== null) {
    if (
      gateStats.type !== 'regular' ||
      gateStats.uid !== 0 ||
      gateStats.gid !== 0 ||
      gateStats.mode !== 0o644 ||
      gateStats.nlink !== 1
    ) {
      throw new RetainedStorageConflictError();
    }
    const gateText = await readText(ports, gate.dropInPath, UNIT_MAX_BYTES);
    if (gateText === null) throw new RetainedStorageUnknownError();
    if (gateText !== gate.dropInText) {
      throw new RetainedStorageConflictError();
    }
  }

  if (unitStats === null) {
    if (linkStats !== null) {
      throw new RetainedStorageConflictError();
    }
    return gateStats === null ? 'absent' : 'gate-only';
  }
  if (
    unitStats.type !== 'regular' ||
    unitStats.uid !== 0 ||
    unitStats.gid !== 0 ||
    unitStats.mode !== 0o644 ||
    unitStats.nlink !== 1
  ) {
    throw new RetainedStorageConflictError();
  }
  const unitText = await readText(ports, projection.unitPath, UNIT_MAX_BYTES);
  if (unitText === null) throw new RetainedStorageUnknownError();
  if (unitText !== projection.unitText) {
    throw new RetainedStorageConflictError();
  }
  if (linkStats !== null) {
    if (
      linkStats.type !== 'symlink' ||
      linkStats.uid !== 0 ||
      linkStats.gid !== 0 ||
      linkStats.nlink !== 1
    ) {
      throw new RetainedStorageConflictError();
    }
    const link = await readLink(
      ports,
      projection.enableLinkPath,
      SMALL_OUTPUT_MAX_BYTES,
    );
    if (link === null) throw new RetainedStorageUnknownError();
    if (link !== `../${projection.unitName}`) {
      throw new RetainedStorageConflictError();
    }
  }
  if (linkStats !== null && gateStats === null) {
    throw new RetainedStorageConflictError();
  }
  if (linkStats !== null) return 'enabled';
  return gateStats === null ? 'unit' : 'gated';
}

/** @param {Readonly<Record<string, any>>} desired @param {Readonly<Record<string, Function>>} ports @returns {Promise<Readonly<Record<string, any>>>} */
async function observePhysicalSnapshot(desired, ports) {
  const identity = await observeIdentity(desired, ports);
  const [filesystemState, mountinfo, ancestry, bootState, mountNamespace] =
    await Promise.all([
      inspectFilesystem(desired, identity, ports),
      readText(
        ports,
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_MOUNTINFO_PATH,
        MOUNTINFO_MAX_BYTES,
      ),
      inspectTargetAncestry(desired, ports),
      inspectBootWiring(desired, ports),
      inspectMountNamespace(ports),
    ]);
  if (mountinfo === null) throw new RetainedStorageUnknownError();
  const mounted = classifyMount(parseMountinfo(mountinfo), desired, identity);
  const targetState = await inspectTargetDirectory(
    ancestry.targetStats,
    desired,
    mounted,
    ports,
  );
  if (filesystemState === 'blank' && (mounted || bootState === 'enabled')) {
    throw new RetainedStorageConflictError();
  }
  return deepFreeze({
    identity,
    filesystemState,
    mounted,
    targetState,
    ancestryComplete: ancestry.complete,
    bootState,
    mountNamespace,
  });
}

/**
 * Capture the same complete physical state twice after udev settles. The
 * returned snapshot is observation only; callers separately decide whether
 * it is sufficient for activation inspection or blank-format proof.
 * @param {Readonly<Record<string, any>>} desired - Exact desired storage.
 * @param {Readonly<Record<string, Function>>} ports - Closed read-only ports.
 * @returns {Promise<Readonly<Record<string, any>>>} - Stable snapshot.
 */
async function observeStablePhysicalSnapshot(desired, ports) {
  const settled = await runTool(
    ports,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_UDEVADM_PATH,
    ['settle', '--timeout=10'],
    SMALL_OUTPUT_MAX_BYTES,
  );
  if (settled.exitCode !== 0) throw new RetainedStorageUnknownError();
  const before = await observePhysicalSnapshot(desired, ports);
  const after = await observePhysicalSnapshot(desired, ports);
  if (!sameJson(before, after)) throw new RetainedStorageUnknownError();
  return after;
}

/** @param {Readonly<Record<string, Function>>} ports @returns {Readonly<{inspect: Function, inspectBlankFormat: Function}>} */
function createObserver(ports) {
  return Object.freeze({
    /** @param {unknown} desiredValue @returns {Promise<Readonly<Record<string, any>>>} */
    async inspect(desiredValue) {
      const desired =
        validateAwsSingleNodeHostRetainedStorageDesired(desiredValue);
      try {
        const after = await observeStablePhysicalSnapshot(desired, ports);
        if (after.filesystemState === 'blank') {
          return Object.freeze({ status: 'ready' });
        }
        // Type and UUID alone cannot prove the pinned wharfie-ext4-v1
        // formatter profile (including journal and feature policy). Until a
        // bounded profile verifier exists, never mint settled evidence from
        // an existing ext4 filesystem.
        return Object.freeze({ status: 'unknown' });
      } catch (error) {
        return Object.freeze({
          status:
            error instanceof RetainedStorageConflictError
              ? 'conflict'
              : 'unknown',
        });
      }
    },

    /**
     * Mint a blank-media proof only from the same closed, stable physical
     * observation used by activation inspection. A shared gate by itself is
     * safe and expected to precede formatting; a role-specific unit, gated
     * unit, or enabled unit is already media wiring and blocks the proof.
     *
     * This proof authenticates exact observed bytes, not current controller
     * authority and not permission to run a formatter.
     * @param {unknown} desiredValue - Exact desired retained storage.
     * @returns {Promise<Readonly<Record<string, any>>>} - Blank proof or fixed fail-closed status.
     */
    async inspectBlankFormat(desiredValue) {
      const desired =
        validateAwsSingleNodeHostRetainedStorageDesired(desiredValue);
      try {
        const after = await observeStablePhysicalSnapshot(desired, ports);
        if (after.filesystemState !== 'blank') {
          return Object.freeze({ status: 'unknown' });
        }
        if (
          after.mounted !== false ||
          !['absent', 'gate-only'].includes(after.bootState)
        ) {
          throw new RetainedStorageConflictError();
        }
        const identity = after.identity;
        const proof = createAwsSingleNodeHostRetainedStorageBlankFormatProof({
          desired,
          device: {
            path: identity.path,
            major: identity.major,
            minor: identity.minor,
            nvmeModel: identity.model,
            nvmeSerialVolumeId: identity.serial,
            byIdPath: identity.byIdPath,
            byIdTarget: identity.byIdTarget,
          },
          mountNamespace: after.mountNamespace,
        });
        return deepFreeze({ status: 'blank', proof });
      } catch (error) {
        return Object.freeze({
          status:
            error instanceof RetainedStorageConflictError
              ? 'conflict'
              : 'unknown',
        });
      }
    },
  });
}

/** @param {bigint} device @returns {{major: number, minor: number}} */
function decodeLinuxDeviceNumber(device) {
  const major =
    ((device & 0x00000000000fff00n) >> 8n) |
    ((device & 0xfffff00000000000n) >> 32n);
  const minor =
    (device & 0x00000000000000ffn) | ((device & 0x00000000fff00000n) >> 12n);
  const majorNumber = Number(major);
  const minorNumber = Number(minor);
  if (
    !Number.isSafeInteger(majorNumber) ||
    majorNumber < 1 ||
    !Number.isSafeInteger(minorNumber) ||
    minorNumber < 0
  ) {
    throw new RetainedStorageUnknownError();
  }
  return { major: majorNumber, minor: minorNumber };
}

/** @param {string} filePath @returns {Promise<Readonly<Record<string, any>>|null>} */
async function nativeStat(filePath) {
  let stats;
  try {
    stats = await fsp.lstat(filePath, { bigint: true });
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  const type = stats.isBlockDevice()
    ? 'block'
    : stats.isDirectory()
      ? 'directory'
      : stats.isFile()
        ? 'regular'
        : stats.isSymbolicLink()
          ? 'symlink'
          : 'other';
  const device =
    type === 'block'
      ? decodeLinuxDeviceNumber(stats.rdev)
      : { major: null, minor: null };
  return Object.freeze({
    type,
    uid: Number(stats.uid),
    gid: Number(stats.gid),
    mode: Number(stats.mode & 0o7777n),
    nlink: Number(stats.nlink),
    rdevMajor: device.major,
    rdevMinor: device.minor,
  });
}

/** @param {{path: string, maxBytes: number}} input @returns {Promise<string|null>} */
async function nativeReadText(input) {
  let handle;
  try {
    handle = await fsp.open(
      input.path,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    );
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  try {
    /** @type {Buffer[]} */
    const chunks = [];
    let used = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(4096, input.maxBytes + 1 - used));
      if (buffer.length === 0) throw new RetainedStorageUnknownError();
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      used += bytesRead;
      if (used > input.maxBytes) throw new RetainedStorageUnknownError();
      chunks.push(buffer.subarray(0, bytesRead));
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, used),
      );
    } catch {
      throw new RetainedStorageUnknownError();
    }
  } finally {
    await handle.close();
  }
}

/** @param {{path: string, maxEntries: number}} input @returns {Promise<ReadonlyArray<string>|null>} */
async function nativeReadDirectory(input) {
  let directory;
  try {
    directory = await fsp.opendir(input.path);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  /** @type {string[]} */
  const names = [];
  try {
    while (true) {
      const entry = await directory.read();
      if (entry === null) break;
      names.push(entry.name);
      if (names.length >= input.maxEntries) break;
    }
  } finally {
    await directory.close().catch(() => {});
  }
  return Object.freeze(names.sort());
}

/** @param {{path: string, maxBytes: number}} input @returns {Promise<string|null>} */
async function nativeReadLink(input) {
  let target;
  try {
    target = await fsp.readlink(input.path, { encoding: 'utf8' });
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
  return boundedText(target, input.maxBytes);
}

/** @param {{file: string, args: readonly string[], maxOutputBytes: number}} input @returns {Promise<Readonly<Record<string, any>>>} */
async function nativeRun(input) {
  return await new Promise((resolve, reject) => {
    const child = spawn(input.file, input.args, {
      env: {
        PATH: '/usr/sbin:/usr/bin:/sbin:/bin',
        LANG: 'C',
        LC_ALL: 'C',
      },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    /** @type {Buffer[]} */
    const stdout = [];
    /** @type {Buffer[]} */
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failed = false;
    const fail = () => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new RetainedStorageUnknownError());
    };
    const timer = setTimeout(fail, TOOL_TIMEOUT_MILLISECONDS);
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > input.maxOutputBytes) {
        fail();
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > SMALL_OUTPUT_MAX_BYTES) {
        fail();
        return;
      }
      stderr.push(chunk);
    });
    child.on('error', fail);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failed) return;
      if (signal !== null || !Number.isSafeInteger(code)) {
        fail();
        return;
      }
      let decodedStdout;
      let decodedStderr;
      try {
        decodedStdout = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(stdout, stdoutBytes),
        );
        decodedStderr = new TextDecoder('utf-8', { fatal: true }).decode(
          Buffer.concat(stderr, stderrBytes),
        );
      } catch {
        fail();
        return;
      }
      resolve(
        Object.freeze({
          exitCode: code,
          stdout: decodedStdout,
          stderr: decodedStderr,
        }),
      );
    });
  });
}

/** @returns {Readonly<Record<string, Function>>} - Closed native ports. */
function nativePorts() {
  return validatePorts({
    run: nativeRun,
    readText: nativeReadText,
    readDirectory: nativeReadDirectory,
    readLink: nativeReadLink,
    stat: async (/** @type {{path: string}} */ input) =>
      await nativeStat(input.path),
  });
}

/**
 * Create the production read-only Linux observer. Construction is closed:
 * callers cannot replace tools, files, identity, or privilege checks.
 * @returns {Readonly<{inspect: Function, inspectBlankFormat: Function}>}
 */
export function createAwsSingleNodeHostRetainedStorageObserver() {
  if (arguments.length !== 0) {
    throw new TypeError(
      'AWS single-node retained storage observer accepts no options.',
    );
  }
  if (
    process.platform !== 'linux' ||
    typeof process.getuid !== 'function' ||
    typeof process.geteuid !== 'function' ||
    process.getuid() !== 0 ||
    process.geteuid() !== 0
  ) {
    throw new Error(
      'AWS single-node retained storage observer requires real and effective root on Linux.',
    );
  }
  return createObserver(nativePorts());
}

/**
 * Create the same observer over exact synthetic read-only ports. This export
 * exists only for semantic tests; production construction never accepts it.
 * @param {unknown} optionsValue - Exact own-data port bundle.
 * @returns {Readonly<{inspect: Function, inspectBlankFormat: Function}>}
 */
export function createAwsSingleNodeHostRetainedStorageObserverForTest(
  optionsValue,
) {
  const options = exactPlainObject(
    optionsValue,
    'retained storage observer test options',
  );
  assertExactKeys(
    options,
    TEST_FACTORY_KEYS,
    'retained storage observer test options',
  );
  return createObserver(
    validatePorts(
      ownDataValue(options, 'ports', 'retained storage observer test options'),
    ),
  );
}

export default createAwsSingleNodeHostRetainedStorageObserver;
