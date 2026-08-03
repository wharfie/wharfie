/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This evidence-only Linux collector keeps its closed host port inline. */

import { createHash } from 'node:crypto';
import { constants as fsConstants, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { TextDecoder } from 'node:util';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../src/core/runtime/content-id.js';
import { cloneBoundedJsonObject } from '../src/core/runtime/json-value.js';
import { assertManifestIsSecretFree } from '../src/core/runtime/manifest-security.js';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SCHEMA_VERSION = 1;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_KIND =
  'awsSingleNodeRetainedStorageHostToolchainPreflight';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SAFETY_CLASS =
  'read-only-no-device';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_DOMAIN =
  'wharfie:aws-single-node:retained-storage-host-toolchain-preflight:v1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX = 'whe1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RECEIPT_MAX_BYTES = 256 * 1024;

const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const BOOT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const KERNEL_RELEASE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,127}$/u;
const ABSOLUTE_CANONICAL_PATH_PATTERN = /^\/(?:[^/\0]+(?:\/[^/\0]+)*)?$/u;
const SMALL_TEXT_MAX_BYTES = 16 * 1024;
const CONFIG_MAX_BYTES = 64 * 1024;
const BINARY_MAX_BYTES = 16 * 1024 * 1024;
const MAX_SYMLINKS = 8;
const MAX_LINK_TARGET_BYTES = 4 * 1024;

const INPUT_KEYS = new Set(['sourceCommit', 'expectedArchitecture']);
const TEST_FACTORY_KEYS = new Set(['host', 'ports']);
const HOST_KEYS = new Set([
  'platform',
  'realUserId',
  'effectiveUserId',
  'nodeArchitecture',
  'nodeVersion',
  'kernelRelease',
]);
const PORT_KEYS = new Set(['inspectPath', 'readText']);
const ABSENT_PATH_RESULT_KEYS = new Set(['path', 'state', 'chain']);
const PRESENT_PATH_RESULT_KEYS = new Set([
  'path',
  'state',
  'resolvedPath',
  'chain',
  'sha256',
]);
const PATH_CHAIN_ENTRY_KEYS = new Set([
  'path',
  'type',
  'uid',
  'gid',
  'mode',
  'size',
  'linkTarget',
]);
const RECEIPT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'evidenceId',
  'safetyClass',
  'authority',
  'source',
  'host',
  'files',
  'configuration',
  'conclusion',
]);
const SOURCE_KEYS = new Set(['commit', 'binding']);
const RECEIPT_HOST_KEYS = new Set([
  'operatingSystem',
  'kernel',
  'bootId',
  'identity',
  'runtime',
  'providerArchitecture',
]);
const OPERATING_SYSTEM_KEYS = new Set(['id', 'versionId']);
const KERNEL_KEYS = new Set(['release']);
const IDENTITY_KEYS = new Set(['realUserId', 'effectiveUserId']);
const RUNTIME_KEYS = new Set(['name', 'version', 'architecture']);
const FILE_EVIDENCE_KEYS = new Set(['name', 'required', 'observation']);
const CONFIGURATION_KEYS = new Set(['mke2fs', 'includedFilesObserved']);
const MKE2FS_CONFIGURATION_KEYS = new Set(['state', 'content']);
const TEXT_EVIDENCE_KEYS = new Set(['byteLength', 'sha256']);
const CONCLUSION_KEYS = new Set([
  'classification',
  'authoritative',
  'limitations',
]);

const EXPECTED_ARCHITECTURES =
  /** @type {Readonly<Record<string, Readonly<{nodeArchitecture: string}>>>} */ (
    Object.freeze({
      x86_64: Object.freeze({
        nodeArchitecture: 'x64',
      }),
      arm64: Object.freeze({
        nodeArchitecture: 'arm64',
      }),
    })
  );

const FILE_SPECS = Object.freeze([
  Object.freeze({
    name: 'os-release',
    path: '/etc/os-release',
    maxBytes: SMALL_TEXT_MAX_BYTES,
    required: true,
    publicText: true,
  }),
  Object.freeze({
    name: 'boot-id',
    path: '/proc/sys/kernel/random/boot_id',
    maxBytes: 128,
    required: true,
    publicText: true,
  }),
  Object.freeze({
    name: 'mke2fs-config',
    path: '/etc/mke2fs.conf',
    maxBytes: CONFIG_MAX_BYTES,
    required: false,
    publicText: true,
  }),
  ...[
    ['systemctl', '/usr/bin/systemctl'],
    ['udevadm', '/usr/bin/udevadm'],
    ['mke2fs', '/usr/sbin/mke2fs'],
    ['mkfs-ext4', '/usr/sbin/mkfs.ext4'],
    ['dumpe2fs', '/usr/sbin/dumpe2fs'],
    ['tune2fs', '/usr/sbin/tune2fs'],
    ['debugfs', '/usr/sbin/debugfs'],
    ['e2fsck', '/usr/sbin/e2fsck'],
    ['blockdev', '/usr/sbin/blockdev'],
  ].map(([name, filePath]) =>
    Object.freeze({
      name,
      path: filePath,
      maxBytes: BINARY_MAX_BYTES,
      required: false,
      publicText: false,
    }),
  ),
]);

const LIMITATIONS = Object.freeze([
  'The source commit is caller-provided and this receipt does not inspect a Git worktree.',
  'No AWS API, instance metadata endpoint, or cloud identity was observed.',
  'No block device was opened, inspected, probed, mounted, formatted, or modified.',
  'No child process or tool command was executed; package ownership and version banners were not observed.',
  'Only the fixed /etc/mke2fs.conf fingerprint is captured; its bytes and included configuration discovery are not published.',
  'Fixed path ancestry is not authenticated beyond the recorded symlink chain and terminal file.',
  'This receipt is evidence, not formatter authority or proof that any media is safe to format.',
]);

export class AwsRetainedStorageHostPreflightUnknownError extends Error {
  constructor() {
    super('AWS retained-storage host toolchain preflight is unknown.');
    this.name = 'AwsRetainedStorageHostPreflightUnknownError';
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

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsolutePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !ABSOLUTE_CANONICAL_PATH_PATTERN.test(value) ||
    path.posix.normalize(value) !== value
  ) {
    throw new TypeError(`${valuePath} must be a canonical absolute path.`);
  }
  return value;
}

/** @param {unknown} value @param {number} maxBytes @returns {string} */
function boundedText(value, maxBytes) {
  if (
    typeof value !== 'string' ||
    value.includes('\0') ||
    hasUnpairedSurrogate(value) ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  return value;
}

/** @param {string} value @returns {boolean} */
function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
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

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateHost(value, valuePath) {
  const host = exactPlainObject(value, valuePath);
  assertExactKeys(host, HOST_KEYS, valuePath);
  const platform = ownDataValue(host, 'platform', valuePath);
  const nodeArchitecture = ownDataValue(host, 'nodeArchitecture', valuePath);
  const nodeVersion = ownDataValue(host, 'nodeVersion', valuePath);
  const kernelRelease = ownDataValue(host, 'kernelRelease', valuePath);
  if (platform !== 'linux') {
    throw new Error('AWS retained-storage host preflight requires Linux.');
  }
  if (
    typeof nodeArchitecture !== 'string' ||
    !['x64', 'arm64'].includes(nodeArchitecture)
  ) {
    throw new TypeError(`${valuePath}.nodeArchitecture must be x64 or arm64.`);
  }
  if (
    typeof nodeVersion !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(nodeVersion)
  ) {
    throw new TypeError(
      `${valuePath}.nodeVersion must be a canonical Node version.`,
    );
  }
  if (
    typeof kernelRelease !== 'string' ||
    !KERNEL_RELEASE_PATTERN.test(kernelRelease)
  ) {
    throw new TypeError(
      `${valuePath}.kernelRelease must be a canonical kernel release.`,
    );
  }
  const realUserId = nonnegativeSafeInteger(
    ownDataValue(host, 'realUserId', valuePath),
    `${valuePath}.realUserId`,
  );
  const effectiveUserId = nonnegativeSafeInteger(
    ownDataValue(host, 'effectiveUserId', valuePath),
    `${valuePath}.effectiveUserId`,
  );
  if (realUserId !== 0 || effectiveUserId !== 0) {
    throw new Error(
      'AWS retained-storage host preflight requires real and effective root.',
    );
  }
  return Object.freeze({
    platform,
    realUserId,
    effectiveUserId,
    nodeArchitecture,
    nodeVersion,
    kernelRelease,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, Function>>} */
function validatePorts(value) {
  const ports = exactPlainObject(value, 'host preflight ports');
  assertExactKeys(ports, PORT_KEYS, 'host preflight ports');
  /** @type {Record<string, Function>} */
  const snapshot = {};
  for (const key of PORT_KEYS) {
    snapshot[key] = ownDataFunction(ports, key, 'host preflight ports').bind(
      ports,
    );
  }
  return Object.freeze(snapshot);
}

/** @param {unknown} value @returns {Readonly<{sourceCommit: string, expectedArchitecture: string}>} */
function validateInput(value) {
  const input = exactPlainObject(value, 'host preflight input');
  assertExactKeys(input, INPUT_KEYS, 'host preflight input');
  const sourceCommit = ownDataValue(
    input,
    'sourceCommit',
    'host preflight input',
  );
  const expectedArchitecture = ownDataValue(
    input,
    'expectedArchitecture',
    'host preflight input',
  );
  if (
    typeof sourceCommit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(sourceCommit)
  ) {
    throw new TypeError(
      'host preflight input.sourceCommit must be a lowercase 40-hex commit.',
    );
  }
  if (
    typeof expectedArchitecture !== 'string' ||
    !Object.hasOwn(EXPECTED_ARCHITECTURES, expectedArchitecture)
  ) {
    throw new TypeError(
      'host preflight input.expectedArchitecture must be x86_64 or arm64.',
    );
  }
  return Object.freeze({
    sourceCommit,
    expectedArchitecture,
  });
}

/** @param {unknown} value @param {string} requestedPath @param {number} maxBytes @returns {Readonly<Record<string, any>>} */
function validatePathInspection(value, requestedPath, maxBytes) {
  const result = exactPlainObject(value, 'host preflight path inspection');
  const state = ownDataValue(result, 'state', 'host preflight path inspection');
  assertExactKeys(
    result,
    state === 'absent' ? ABSENT_PATH_RESULT_KEYS : PRESENT_PATH_RESULT_KEYS,
    'host preflight path inspection',
  );
  if (
    ownDataValue(result, 'path', 'host preflight path inspection') !==
    requestedPath
  ) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  const chainValue = ownDataValue(
    result,
    'chain',
    'host preflight path inspection',
  );
  if (!Array.isArray(chainValue)) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  if (state === 'absent') {
    if (chainValue.length !== 0) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    return deepFreeze({ path: requestedPath, state: 'absent', chain: [] });
  }
  if (
    state !== 'present' ||
    chainValue.length < 1 ||
    chainValue.length > MAX_SYMLINKS + 1
  ) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }

  let expectedPath = requestedPath;
  const chain = chainValue.map((entryValue, index) => {
    const valuePath = `host preflight path inspection.chain[${index}]`;
    const entry = exactPlainObject(entryValue, valuePath);
    assertExactKeys(entry, PATH_CHAIN_ENTRY_KEYS, valuePath);
    const entryPath = canonicalAbsolutePath(
      ownDataValue(entry, 'path', valuePath),
      `${valuePath}.path`,
    );
    if (entryPath !== expectedPath) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const type = ownDataValue(entry, 'type', valuePath);
    if (typeof type !== 'string' || !['regular', 'symlink'].includes(type)) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const uid = nonnegativeSafeInteger(
      ownDataValue(entry, 'uid', valuePath),
      `${valuePath}.uid`,
    );
    const gid = nonnegativeSafeInteger(
      ownDataValue(entry, 'gid', valuePath),
      `${valuePath}.gid`,
    );
    const mode = nonnegativeSafeInteger(
      ownDataValue(entry, 'mode', valuePath),
      `${valuePath}.mode`,
    );
    const size = nonnegativeSafeInteger(
      ownDataValue(entry, 'size', valuePath),
      `${valuePath}.size`,
    );
    if (mode > 0o7777) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const linkTarget = ownDataValue(entry, 'linkTarget', valuePath);
    if (type === 'symlink') {
      if (
        typeof linkTarget !== 'string' ||
        linkTarget.length === 0 ||
        linkTarget.includes('\0') ||
        Buffer.byteLength(linkTarget, 'utf8') > MAX_LINK_TARGET_BYTES ||
        index === chainValue.length - 1
      ) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      expectedPath = path.posix.resolve(
        path.posix.dirname(entryPath),
        linkTarget,
      );
    } else {
      if (
        linkTarget !== null ||
        index !== chainValue.length - 1 ||
        size > maxBytes
      ) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
    }
    return Object.freeze({
      path: entryPath,
      type,
      uid,
      gid,
      mode,
      size,
      linkTarget,
    });
  });

  const resolvedPath = canonicalAbsolutePath(
    ownDataValue(result, 'resolvedPath', 'host preflight path inspection'),
    'host preflight path inspection.resolvedPath',
  );
  if (resolvedPath !== expectedPath) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  const sha256 = ownDataValue(
    result,
    'sha256',
    'host preflight path inspection',
  );
  assertSha256Base64Url(sha256, 'host preflight path inspection.sha256');
  return deepFreeze({
    path: requestedPath,
    state: 'present',
    resolvedPath,
    chain,
    sha256,
  });
}

/** @param {string} text @returns {{id: string, versionId: string}} */
function parseOperatingSystemRelease(text) {
  /** @type {Map<string, string>} */
  const selected = new Map();
  for (const line of text.split(/\r?\n/u)) {
    if (line.length === 0 || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    if (!['ID', 'VERSION_ID'].includes(key)) continue;
    if (selected.has(key)) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const encoded = line.slice(separator + 1);
    let decoded;
    if (encoded.startsWith('"') && encoded.endsWith('"')) {
      try {
        decoded = JSON.parse(encoded);
      } catch {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
    } else if (encoded.startsWith("'") && encoded.endsWith("'")) {
      decoded = encoded.slice(1, -1);
    } else {
      decoded = encoded;
    }
    if (
      typeof decoded !== 'string' ||
      !/^[A-Za-z0-9._:-]{1,64}$/u.test(decoded)
    ) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    selected.set(key, decoded);
  }
  if (selected.get('ID') !== 'amzn' || selected.get('VERSION_ID') !== '2023') {
    throw new Error(
      'AWS retained-storage host preflight requires Amazon Linux 2023.',
    );
  }
  return Object.freeze({ id: 'amzn', versionId: '2023' });
}

/** @param {string} value @returns {{byteLength: number, sha256: string}} */
function textEvidence(value) {
  return Object.freeze({
    byteLength: Buffer.byteLength(value, 'utf8'),
    sha256: sha256Base64Url(value),
  });
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {Readonly<Record<string, any>>} spec @param {Readonly<Record<string, any>>} inspection @returns {void} */
function assertAllowedFileObservation(spec, inspection) {
  if (inspection.state === 'absent') return;
  const terminal = inspection.chain.at(-1);
  if (
    terminal?.type !== 'regular' ||
    terminal.uid !== 0 ||
    (terminal.mode & 0o022) !== 0
  ) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  for (const entry of inspection.chain) {
    if (entry.uid !== 0) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
  }

  if (spec.name === 'os-release') {
    const allowed = new Set(['/etc/os-release', '/usr/lib/os-release']);
    if (
      !allowed.has(inspection.resolvedPath) ||
      inspection.chain.some(
        (/** @type {Readonly<Record<string, any>>} */ entry) =>
          !allowed.has(entry.path),
      )
    ) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    return;
  }
  if (spec.name === 'boot-id' || spec.name === 'mke2fs-config') {
    if (
      inspection.resolvedPath !== spec.path ||
      inspection.chain.length !== 1
    ) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    return;
  }

  const isAllowedToolPath = (/** @type {string} */ candidate) =>
    candidate.startsWith('/usr/bin/') || candidate.startsWith('/usr/sbin/');
  if (
    !isAllowedToolPath(inspection.resolvedPath) ||
    inspection.chain.some(
      (/** @type {Readonly<Record<string, any>>} */ entry) =>
        !isAllowedToolPath(entry.path),
    ) ||
    (terminal.mode & 0o111) === 0
  ) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
}

/** @param {Readonly<Record<string, Function>>} ports @returns {Promise<Readonly<Record<string, any>>>} */
async function observeFileSet(ports) {
  /** @type {Readonly<Record<string, any>>[]} */
  const files = [];
  /** @type {Record<string, string|null>} */
  const publicText = {};
  for (const spec of FILE_SPECS) {
    const inspection = validatePathInspection(
      await ports.inspectPath(
        deepFreeze({ path: spec.path, maxBytes: spec.maxBytes }),
      ),
      spec.path,
      spec.maxBytes,
    );
    if (spec.required && inspection.state !== 'present') {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    assertAllowedFileObservation(spec, inspection);
    if (spec.publicText) {
      if (inspection.state === 'absent') {
        publicText[spec.name] = null;
      } else {
        const text = await ports.readText(
          deepFreeze({
            path: inspection.resolvedPath,
            maxBytes: spec.maxBytes,
          }),
        );
        const bounded = boundedText(text, spec.maxBytes);
        if (sha256Base64Url(bounded) !== inspection.sha256) {
          throw new AwsRetainedStorageHostPreflightUnknownError();
        }
        publicText[spec.name] = bounded;
      }
    }
    files.push(
      deepFreeze({
        name: spec.name,
        required: spec.required,
        observation: inspection,
      }),
    );
  }
  return deepFreeze({ files, publicText });
}

/** @param {Readonly<Record<string, any>>} host @param {Readonly<Record<string, Function>>} ports @returns {Readonly<{collect: Function}>} */
function createCollector(host, ports) {
  return Object.freeze({
    /** @param {unknown} inputValue - Exact collection request. */
    async collect(inputValue) {
      const input = validateInput(inputValue);
      const expected = EXPECTED_ARCHITECTURES[input.expectedArchitecture];
      if (host.nodeArchitecture !== expected.nodeArchitecture) {
        throw new Error(
          'AWS retained-storage host architecture does not match the requested architecture.',
        );
      }

      const first = await observeFileSet(ports);
      const second = await observeFileSet(ports);
      if (!sameJson(first, second)) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }

      const osReleaseText = second.publicText['os-release'];
      const bootIdText = second.publicText['boot-id'];
      if (typeof osReleaseText !== 'string' || typeof bootIdText !== 'string') {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      const operatingSystem = parseOperatingSystemRelease(osReleaseText);
      const bootId = bootIdText.trim();
      if (!BOOT_ID_PATTERN.test(bootId)) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }

      const mke2fsConfig = second.publicText['mke2fs-config'];
      const payload = sortCanonicalJsonValue({
        schemaVersion: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SCHEMA_VERSION,
        kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_KIND,
        safetyClass: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SAFETY_CLASS,
        authority: 'none',
        source: {
          commit: input.sourceCommit,
          binding: 'caller-provided',
        },
        host: {
          operatingSystem,
          kernel: {
            release: host.kernelRelease,
          },
          bootId,
          identity: {
            realUserId: host.realUserId,
            effectiveUserId: host.effectiveUserId,
          },
          runtime: {
            name: 'node',
            version: host.nodeVersion,
            architecture: host.nodeArchitecture,
          },
          providerArchitecture: input.expectedArchitecture,
        },
        files: second.files,
        configuration: {
          mke2fs:
            typeof mke2fsConfig === 'string'
              ? {
                  state: 'present',
                  content: textEvidence(mke2fsConfig),
                }
              : { state: 'absent', content: null },
          includedFilesObserved: false,
        },
        conclusion: {
          classification: 'host-toolchain-fingerprinted',
          authoritative: false,
          limitations: [...LIMITATIONS],
        },
      });
      assertManifestIsSecretFree(payload, 'host preflight evidence');
      const evidenceId = createCanonicalJsonSha256Id({
        domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_DOMAIN,
        prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX,
        value: payload,
        valuePath: 'host preflight evidence',
      });
      const receipt = sortCanonicalJsonValue({ ...payload, evidenceId });
      return validateAwsRetainedStorageHostPreflightReceipt(receipt);
    },
  });
}

/** @param {Record<string, any>} receipt @returns {void} */
function validateReceiptPayloadShape(receipt) {
  const source = exactPlainObject(
    receipt.source,
    'host preflight receipt.source',
  );
  assertExactKeys(source, SOURCE_KEYS, 'host preflight receipt.source');
  if (
    typeof source.commit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(source.commit) ||
    source.binding !== 'caller-provided'
  ) {
    throw new TypeError('host preflight receipt.source is invalid.');
  }

  const host = exactPlainObject(receipt.host, 'host preflight receipt.host');
  assertExactKeys(host, RECEIPT_HOST_KEYS, 'host preflight receipt.host');
  const operatingSystem = exactPlainObject(
    host.operatingSystem,
    'host preflight receipt.host.operatingSystem',
  );
  assertExactKeys(
    operatingSystem,
    OPERATING_SYSTEM_KEYS,
    'host preflight receipt.host.operatingSystem',
  );
  if (operatingSystem.id !== 'amzn' || operatingSystem.versionId !== '2023') {
    throw new TypeError(
      'host preflight receipt operating system is not Amazon Linux 2023.',
    );
  }
  const kernel = exactPlainObject(
    host.kernel,
    'host preflight receipt.host.kernel',
  );
  assertExactKeys(kernel, KERNEL_KEYS, 'host preflight receipt.host.kernel');
  if (
    typeof kernel.release !== 'string' ||
    !KERNEL_RELEASE_PATTERN.test(kernel.release)
  ) {
    throw new TypeError('host preflight receipt kernel is invalid.');
  }
  if (typeof host.bootId !== 'string' || !BOOT_ID_PATTERN.test(host.bootId)) {
    throw new TypeError('host preflight receipt bootId is invalid.');
  }
  const identity = exactPlainObject(
    host.identity,
    'host preflight receipt.host.identity',
  );
  assertExactKeys(
    identity,
    IDENTITY_KEYS,
    'host preflight receipt.host.identity',
  );
  if (identity.realUserId !== 0 || identity.effectiveUserId !== 0) {
    throw new TypeError('host preflight receipt identity is not root.');
  }
  const runtime = exactPlainObject(
    host.runtime,
    'host preflight receipt.host.runtime',
  );
  assertExactKeys(runtime, RUNTIME_KEYS, 'host preflight receipt.host.runtime');
  if (
    runtime.name !== 'node' ||
    typeof runtime.version !== 'string' ||
    !/^[0-9]+\.[0-9]+\.[0-9]+$/u.test(runtime.version) ||
    !['x64', 'arm64'].includes(runtime.architecture)
  ) {
    throw new TypeError('host preflight receipt runtime is invalid.');
  }
  if (
    !Object.hasOwn(EXPECTED_ARCHITECTURES, String(host.providerArchitecture)) ||
    EXPECTED_ARCHITECTURES[host.providerArchitecture].nodeArchitecture !==
      runtime.architecture
  ) {
    throw new TypeError(
      'host preflight receipt provider architecture is invalid.',
    );
  }

  if (
    !Array.isArray(receipt.files) ||
    receipt.files.length !== FILE_SPECS.length
  ) {
    throw new TypeError('host preflight receipt files are invalid.');
  }
  for (let index = 0; index < FILE_SPECS.length; index += 1) {
    const spec = FILE_SPECS[index];
    const valuePath = `host preflight receipt.files[${index}]`;
    const file = exactPlainObject(receipt.files[index], valuePath);
    assertExactKeys(file, FILE_EVIDENCE_KEYS, valuePath);
    if (file.name !== spec.name || file.required !== spec.required) {
      throw new TypeError(`${valuePath} does not match its fixed file slot.`);
    }
    const observation = validatePathInspection(
      file.observation,
      spec.path,
      spec.maxBytes,
    );
    if (spec.required && observation.state !== 'present') {
      throw new TypeError(`${valuePath} is required.`);
    }
    assertAllowedFileObservation(spec, observation);
  }

  const configuration = exactPlainObject(
    receipt.configuration,
    'host preflight receipt.configuration',
  );
  assertExactKeys(
    configuration,
    CONFIGURATION_KEYS,
    'host preflight receipt.configuration',
  );
  if (configuration.includedFilesObserved !== false) {
    throw new TypeError(
      'host preflight receipt cannot claim included configuration evidence.',
    );
  }
  const mke2fs = exactPlainObject(
    configuration.mke2fs,
    'host preflight receipt.configuration.mke2fs',
  );
  assertExactKeys(
    mke2fs,
    MKE2FS_CONFIGURATION_KEYS,
    'host preflight receipt.configuration.mke2fs',
  );
  const configObservation = receipt.files.find(
    (file) => file.name === 'mke2fs-config',
  ).observation;
  if (mke2fs.state === 'absent') {
    if (mke2fs.content !== null || configObservation.state !== 'absent') {
      throw new TypeError(
        'host preflight receipt mke2fs configuration absence is inconsistent.',
      );
    }
  } else if (mke2fs.state === 'present') {
    const content = exactPlainObject(
      mke2fs.content,
      'host preflight receipt.configuration.mke2fs.content',
    );
    assertExactKeys(
      content,
      TEXT_EVIDENCE_KEYS,
      'host preflight receipt.configuration.mke2fs.content',
    );
    const byteLength = nonnegativeSafeInteger(
      content.byteLength,
      'host preflight receipt.configuration.mke2fs.content.byteLength',
    );
    assertSha256Base64Url(
      content.sha256,
      'host preflight receipt.configuration.mke2fs.content.sha256',
    );
    const terminalSize = configObservation.chain.at(-1)?.size;
    if (
      byteLength > CONFIG_MAX_BYTES ||
      configObservation.state !== 'present' ||
      content.sha256 !== configObservation.sha256 ||
      byteLength !== terminalSize
    ) {
      throw new TypeError(
        'host preflight receipt mke2fs configuration evidence is inconsistent.',
      );
    }
  } else {
    throw new TypeError(
      'host preflight receipt mke2fs configuration state is invalid.',
    );
  }

  const conclusion = exactPlainObject(
    receipt.conclusion,
    'host preflight receipt.conclusion',
  );
  assertExactKeys(
    conclusion,
    CONCLUSION_KEYS,
    'host preflight receipt.conclusion',
  );
  if (
    conclusion.classification !== 'host-toolchain-fingerprinted' ||
    conclusion.authoritative !== false ||
    !sameJson(conclusion.limitations, LIMITATIONS)
  ) {
    throw new TypeError('host preflight receipt conclusion is invalid.');
  }
}

/**
 * Validate one bounded, self-addressed non-authoritative host fingerprint.
 * This boundary authenticates the exact evidence bytes, not their issuer.
 * @param {unknown} value - Candidate serialized receipt.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen receipt.
 */
export function validateAwsRetainedStorageHostPreflightReceipt(value) {
  const receipt = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RECEIPT_MAX_BYTES,
    'host preflight receipt',
  );
  assertExactKeys(receipt, RECEIPT_KEYS, 'host preflight receipt');
  if (
    receipt.schemaVersion !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SCHEMA_VERSION ||
    receipt.kind !== AWS_RETAINED_STORAGE_HOST_PREFLIGHT_KIND ||
    receipt.safetyClass !== AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SAFETY_CLASS ||
    receipt.authority !== 'none'
  ) {
    throw new TypeError('host preflight receipt contract is invalid.');
  }
  validateReceiptPayloadShape(receipt);
  assertDomainSeparatedSha256Id(
    receipt.evidenceId,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX,
    'host preflight receipt.evidenceId',
  );
  const payload = { ...receipt };
  delete payload.evidenceId;
  const expectedEvidenceId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX,
    value: payload,
    valuePath: 'host preflight receipt payload',
  });
  if (receipt.evidenceId !== expectedEvidenceId) {
    throw new Error(
      'host preflight receipt evidenceId does not match its exact payload.',
    );
  }
  assertManifestIsSecretFree(receipt, 'host preflight receipt');
  return deepFreeze(sortCanonicalJsonValue(receipt));
}

/** @param {import('node:fs').Stats} stats @returns {{uid: number, gid: number, mode: number, size: number}} */
function nativeMetadata(stats) {
  if (
    !Number.isSafeInteger(stats.uid) ||
    !Number.isSafeInteger(stats.gid) ||
    !Number.isSafeInteger(stats.mode) ||
    !Number.isSafeInteger(stats.size) ||
    stats.uid < 0 ||
    stats.gid < 0 ||
    stats.size < 0
  ) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  return {
    uid: stats.uid,
    gid: stats.gid,
    mode: stats.mode & 0o7777,
    size: stats.size,
  };
}

/** @param {import('node:fs').Stats} left @param {import('node:fs').Stats} right @returns {boolean} */
function sameNativeFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.uid === right.uid &&
    left.gid === right.gid &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

/** @param {{path: string, maxBytes: number}} input @returns {Promise<Readonly<Record<string, any>>>} */
async function nativeInspectPath(input) {
  /** @type {Readonly<Record<string, any>>[]} */
  const chain = [];
  let current = input.path;
  const seen = new Set();
  for (let depth = 0; depth <= MAX_SYMLINKS; depth += 1) {
    if (seen.has(current)) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    seen.add(current);
    let stats;
    try {
      stats = await fsp.lstat(current);
    } catch (error) {
      if (
        depth === 0 &&
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return deepFreeze({ path: input.path, state: 'absent', chain: [] });
      }
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const metadata = nativeMetadata(stats);
    if (stats.isSymbolicLink()) {
      const linkTarget = await fsp.readlink(current, { encoding: 'utf8' });
      const rechecked = await fsp.lstat(current);
      if (!sameNativeFileIdentity(stats, rechecked)) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      if (
        linkTarget.length === 0 ||
        linkTarget.includes('\0') ||
        Buffer.byteLength(linkTarget, 'utf8') > MAX_LINK_TARGET_BYTES
      ) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      chain.push(
        Object.freeze({
          path: current,
          type: 'symlink',
          ...metadata,
          linkTarget,
        }),
      );
      current = path.posix.resolve(path.posix.dirname(current), linkTarget);
      continue;
    }
    const virtualContent =
      input.path === '/proc/sys/kernel/random/boot_id' &&
      current === input.path;
    if (!stats.isFile() || stats.size > input.maxBytes) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const handle = await fsp.open(
      current,
      fsConstants.O_RDONLY |
        (fsConstants.O_NOFOLLOW || 0) |
        (fsConstants.O_NONBLOCK || 0),
    );
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameNativeFileIdentity(stats, opened)) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      const hash = createHash('sha256');
      let offset = 0;
      while (true) {
        const buffer = Buffer.alloc(
          Math.min(64 * 1024, input.maxBytes + 1 - offset),
        );
        if (buffer.length === 0) {
          throw new AwsRetainedStorageHostPreflightUnknownError();
        }
        const { bytesRead } = await handle.read(
          buffer,
          0,
          buffer.length,
          offset,
        );
        if (bytesRead === 0) break;
        offset += bytesRead;
        if (offset > input.maxBytes) {
          throw new AwsRetainedStorageHostPreflightUnknownError();
        }
        hash.update(buffer.subarray(0, bytesRead));
      }
      const finalStats = await handle.stat();
      if (
        !sameNativeFileIdentity(opened, finalStats) ||
        (!virtualContent && offset !== opened.size)
      ) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      chain.push(
        Object.freeze({
          path: current,
          type: 'regular',
          ...nativeMetadata(finalStats),
          size: offset,
          linkTarget: null,
        }),
      );
      return deepFreeze({
        path: input.path,
        state: 'present',
        resolvedPath: current,
        chain,
        sha256: hash.digest('base64url'),
      });
    } finally {
      await handle.close();
    }
  }
  throw new AwsRetainedStorageHostPreflightUnknownError();
}

/** @param {{path: string, maxBytes: number}} input @returns {Promise<string|null>} */
async function nativeReadText(input) {
  let resolved;
  try {
    resolved = await fsp.realpath(input.path);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  if (resolved !== input.path) {
    throw new AwsRetainedStorageHostPreflightUnknownError();
  }
  const handle = await fsp.open(
    resolved,
    fsConstants.O_RDONLY |
      (fsConstants.O_NOFOLLOW || 0) |
      (fsConstants.O_NONBLOCK || 0),
  );
  try {
    const stats = await handle.stat();
    if (!stats.isFile() || stats.size > input.maxBytes) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    const chunks = [];
    let used = 0;
    while (true) {
      const buffer = Buffer.alloc(Math.min(4096, input.maxBytes + 1 - used));
      if (buffer.length === 0) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, used);
      if (bytesRead === 0) break;
      used += bytesRead;
      if (used > input.maxBytes) {
        throw new AwsRetainedStorageHostPreflightUnknownError();
      }
      chunks.push(buffer.subarray(0, bytesRead));
    }
    const finalStats = await handle.stat();
    if (!sameNativeFileIdentity(stats, finalStats)) {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, used),
      );
    } catch {
      throw new AwsRetainedStorageHostPreflightUnknownError();
    }
  } finally {
    await handle.close();
  }
}

/** @returns {Readonly<{collect: Function}>} */
export function createAwsRetainedStorageHostPreflightCollector() {
  if (arguments.length !== 0) {
    throw new TypeError(
      'AWS retained-storage host preflight collector accepts no options.',
    );
  }
  if (
    process.platform !== 'linux' ||
    typeof process.getuid !== 'function' ||
    typeof process.geteuid !== 'function'
  ) {
    throw new Error('AWS retained-storage host preflight requires Linux root.');
  }
  const host = validateHost(
    {
      platform: process.platform,
      realUserId: process.getuid(),
      effectiveUserId: process.geteuid(),
      nodeArchitecture: process.arch,
      nodeVersion: process.versions.node,
      kernelRelease: os.release(),
    },
    'host preflight native host',
  );
  return createCollector(
    host,
    validatePorts({
      inspectPath: nativeInspectPath,
      readText: nativeReadText,
    }),
  );
}

/** @param {unknown} optionsValue @returns {Readonly<{collect: Function}>} */
export function createAwsRetainedStorageHostPreflightCollectorForTest(
  optionsValue,
) {
  const options = exactPlainObject(optionsValue, 'host preflight test options');
  assertExactKeys(options, TEST_FACTORY_KEYS, 'host preflight test options');
  return createCollector(
    validateHost(
      ownDataValue(options, 'host', 'host preflight test options'),
      'host preflight test host',
    ),
    validatePorts(
      ownDataValue(options, 'ports', 'host preflight test options'),
    ),
  );
}

export default createAwsRetainedStorageHostPreflightCollector;
