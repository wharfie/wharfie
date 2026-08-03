/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This proof handoff keeps its exact immutable schema and filesystem boundary together. */

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from '../src/core/runtime/application-revision.js';
import {
  ARTIFACT_ID_PREFIX,
  assertArtifactId,
} from '../src/core/runtime/artifact-record.js';
import {
  getBuildTargetId,
  validateBuildTarget,
} from '../src/core/runtime/build-target.js';
import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
} from '../src/core/runtime/json-value.js';

export const STEADY_FILE_PREVIEW_HANDOFF_SCHEMA_VERSION = 1;
export const STEADY_FILE_PREVIEW_HANDOFF_KIND =
  'wharfie.steady-file-preview.handoff';
export const STEADY_FILE_PREVIEW_HANDOFF_MAX_BYTES = 256 * 1024;
export const STEADY_FILE_PREVIEW_HANDOFF_FILES = Object.freeze([
  'source/app',
  'source/artifact-record.json',
  'target/app',
  'target/artifact-record.json',
  'handoff.json',
  'SHA256SUMS',
]);
export const STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES = Object.freeze(
  STEADY_FILE_PREVIEW_HANDOFF_FILES.filter(
    (relativePath) => relativePath !== 'SHA256SUMS',
  ),
);
export const STEADY_FILE_PREVIEW_STARTER_FILES = Object.freeze([
  'README.md',
  'activities.js',
  'cli.js',
  'file-stability.js',
  'local.js',
  'package.json',
  'wharfie.app.js',
]);

const APP_ID = 'steady-file-demo';
const INSTALLED_STARTER = 'examples/steady-file';
const HANDOFF_PATH = 'handoff.json';
const CHECKSUM_PATH = 'SHA256SUMS';
const SOURCE_PATH = 'source/app';
const SOURCE_RECORD_PATH = 'source/artifact-record.json';
const TARGET_PATH = 'target/app';
const TARGET_RECORD_PATH = 'target/artifact-record.json';
const MAX_CHECKSUM_BYTES = 16 * 1024;
const MAX_RECORD_BYTES = 1024 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024 * 1024;
const READ_BUFFER_BYTES = 64 * 1024;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const MACHINE_ID_PATTERN = /^[0-9a-f]{32}$/u;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/u;
const EXACT_SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const TOP_LEVEL_KEYS = new Set([
  'schemaVersion',
  'kind',
  'commit',
  'builder',
  'package',
  'starter',
  'mutation',
  'ordinary',
  'artifacts',
]);
const BUILDER_KEYS = new Set(['machineId', 'toolchain']);
const TOOLCHAIN_KEYS = new Set(['node', 'npm']);
const PACKAGE_KEYS = new Set([
  'name',
  'version',
  'tarballSha256',
  'packedFileCount',
  'installedStarter',
]);
const STARTER_KEYS = new Set(['files']);
const MUTATION_KEYS = new Set([
  'path',
  'from',
  'to',
  'beforeSha256',
  'afterSha256',
]);
const ORDINARY_KEYS = new Set(['input', 'expected', 'equivalent']);
const ORDINARY_INPUT_KEYS = new Set(['bytes', 'sha256']);
const ORDINARY_EXPECTED_KEYS = new Set(['stable', 'baseline', 'current']);
const FINGERPRINT_KEYS = new Set(['bytes', 'sha256', 'readStable']);
const ARTIFACTS_KEYS = new Set(['source', 'target']);
const ARTIFACT_KEYS = new Set([
  'path',
  'recordPath',
  'artifactId',
  'revisionId',
  'byteDigest',
  'size',
  'target',
  'sha256',
]);
const ARTIFACT_RECORD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'artifactId',
  'byteDigest',
  'size',
  'appId',
  'revisionId',
  'target',
  'targetId',
  'format',
  'provenance',
]);
const ARTIFACT_FORMAT_KEYS = new Set(['kind', 'version']);

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

/** @param {unknown} value @param {Set<string>} keys @param {string} valuePath @returns {Record<string, any>} */
function exactObject(value, keys, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  assertExactKeys(value, keys, valuePath);
  return value;
}

/** @param {any} value @returns {any} */
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

/** @param {unknown} value @param {string} valuePath @returns {string} */
function validateSha256Hex(value, valuePath) {
  if (typeof value !== 'string' || !SHA256_HEX_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be one lowercase hexadecimal SHA-256 digest.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function validateExactSemver(value, valuePath) {
  if (typeof value !== 'string' || !EXACT_SEMVER_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be one exact semantic version in x.y.z form.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function validateNonemptyString(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes('\0') ||
    value.includes('\r')
  ) {
    throw new TypeError(`${valuePath} must be one nonempty canonical string.`);
  }
  return value;
}

/**
 * Require a path that has one portable POSIX spelling and cannot escape the
 * handoff root. Backslashes are rejected even on POSIX so a later Windows
 * consumer cannot reinterpret them as separators.
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {string}
 */
function validateRelativePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value === '.' ||
    value === '..' ||
    value.startsWith('../') ||
    value.endsWith('/') ||
    value.split('/').some((segment) => segment === '.' || segment === '..')
  ) {
    throw new TypeError(
      `${valuePath} must be one canonical relative POSIX path.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @param {{positive?: boolean}} [options] @returns {number} */
function validateByteCount(value, valuePath, options = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (options.positive === true ? 1 : 0)
  ) {
    throw new TypeError(
      `${valuePath} must be a ${options.positive === true ? 'positive' : 'nonnegative'} safe integer.`,
    );
  }
  return value;
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateFingerprint(value, valuePath) {
  const fingerprint = exactObject(value, FINGERPRINT_KEYS, valuePath);
  const bytes = validateByteCount(fingerprint.bytes, `${valuePath}.bytes`, {
    positive: true,
  });
  const sha256 = validateSha256Hex(fingerprint.sha256, `${valuePath}.sha256`);
  if (fingerprint.readStable !== true) {
    throw new TypeError(`${valuePath}.readStable must be true.`);
  }
  return deepFreeze({ bytes, sha256, readStable: true });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateOrdinary(value, valuePath) {
  const ordinary = exactObject(value, ORDINARY_KEYS, valuePath);
  const input = exactObject(
    ordinary.input,
    ORDINARY_INPUT_KEYS,
    `${valuePath}.input`,
  );
  const inputBytes = validateByteCount(
    input.bytes,
    `${valuePath}.input.bytes`,
    { positive: true },
  );
  const inputSha256 = validateSha256Hex(
    input.sha256,
    `${valuePath}.input.sha256`,
  );
  const expected = exactObject(
    ordinary.expected,
    ORDINARY_EXPECTED_KEYS,
    `${valuePath}.expected`,
  );
  if (expected.stable !== true) {
    throw new TypeError(`${valuePath}.expected.stable must be true.`);
  }
  const baseline = validateFingerprint(
    expected.baseline,
    `${valuePath}.expected.baseline`,
  );
  const current = validateFingerprint(
    expected.current,
    `${valuePath}.expected.current`,
  );
  if (
    baseline.bytes !== inputBytes ||
    current.bytes !== inputBytes ||
    baseline.sha256 !== inputSha256 ||
    current.sha256 !== inputSha256
  ) {
    throw new Error(
      `${valuePath}.expected fingerprints must match the exact input.`,
    );
  }
  if (ordinary.equivalent !== true) {
    throw new TypeError(`${valuePath}.equivalent must be true.`);
  }
  return deepFreeze({
    input: { bytes: inputBytes, sha256: inputSha256 },
    expected: { stable: true, baseline, current },
    equivalent: true,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, string>>} */
function validateStarterFiles(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be a plain object.`);
  }
  assertExactKeys(value, new Set(STEADY_FILE_PREVIEW_STARTER_FILES), valuePath);
  /** @type {Record<string, string>} */
  const files = {};
  for (const relativePath of STEADY_FILE_PREVIEW_STARTER_FILES) {
    validateRelativePath(relativePath, `${valuePath} key`);
    files[relativePath] = validateSha256Hex(
      value[relativePath],
      `${valuePath}.${relativePath}`,
    );
  }
  return deepFreeze(sortCanonicalJsonValue(files));
}

/** @param {unknown} value @param {'source'|'target'} label @param {string} nodeVersion @returns {Readonly<Record<string, any>>} */
function validateArtifact(value, label, nodeVersion) {
  const valuePath = `steady-file preview handoff.artifacts.${label}`;
  const artifact = exactObject(value, ARTIFACT_KEYS, valuePath);
  const expectedPath = label === 'source' ? SOURCE_PATH : TARGET_PATH;
  const expectedRecordPath =
    label === 'source' ? SOURCE_RECORD_PATH : TARGET_RECORD_PATH;
  const artifactPath = validateRelativePath(artifact.path, `${valuePath}.path`);
  const recordPath = validateRelativePath(
    artifact.recordPath,
    `${valuePath}.recordPath`,
  );
  if (artifactPath !== expectedPath || recordPath !== expectedRecordPath) {
    throw new TypeError(
      `${valuePath} must use the fixed ${expectedPath} and ${expectedRecordPath} paths.`,
    );
  }
  assertArtifactId(artifact.artifactId, `${valuePath}.artifactId`);
  assertApplicationRevisionId(artifact.revisionId, `${valuePath}.revisionId`);
  const byteDigest = validateSha256Digest(
    artifact.byteDigest,
    `${valuePath}.byteDigest`,
  );
  const sha256 = validateSha256Hex(artifact.sha256, `${valuePath}.sha256`);
  const digestBytes = Buffer.from(byteDigest.value, 'base64url');
  if (
    digestBytes.toString('base64url') !== byteDigest.value ||
    digestBytes.toString('hex') !== sha256 ||
    artifact.artifactId !== `${ARTIFACT_ID_PREFIX}_${byteDigest.value}`
  ) {
    throw new Error(
      `${valuePath} identities must name its exact hexadecimal SHA-256 digest.`,
    );
  }
  const size = validateByteCount(artifact.size, `${valuePath}.size`, {
    positive: true,
  });
  const target = validateBuildTarget(artifact.target, `${valuePath}.target`);
  if (target.platform !== 'linux' || target.libc !== 'glibc') {
    throw new TypeError(`${valuePath}.target must be Linux glibc.`);
  }
  if (target.nodeVersion !== nodeVersion) {
    throw new Error(
      `${valuePath}.target.nodeVersion must match the builder toolchain.`,
    );
  }
  return deepFreeze({
    path: artifactPath,
    recordPath,
    artifactId: artifact.artifactId,
    revisionId: artifact.revisionId,
    byteDigest,
    size,
    target,
    sha256,
  });
}

/** @param {Record<string, any>} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateArtifactRecordShape(value, valuePath) {
  assertExactKeys(value, ARTIFACT_RECORD_KEYS, valuePath);
  if (value.schemaVersion !== 1 || value.kind !== 'artifactRecord') {
    throw new TypeError(`${valuePath} header is invalid.`);
  }
  if (value.appId !== APP_ID) {
    throw new TypeError(`${valuePath}.appId must be '${APP_ID}'.`);
  }
  const format = exactObject(
    value.format,
    ARTIFACT_FORMAT_KEYS,
    `${valuePath}.format`,
  );
  if (format.kind !== 'node-sea' || format.version !== 1) {
    throw new TypeError(`${valuePath}.format must be Node SEA version 1.`);
  }
  if (!isPlainObject(value.provenance)) {
    throw new TypeError(`${valuePath}.provenance must be a plain object.`);
  }
  return value;
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
export function validateSteadyFilePreviewHandoffDocument(value) {
  const document = cloneBoundedJsonObject(
    value,
    STEADY_FILE_PREVIEW_HANDOFF_MAX_BYTES,
    'steady-file preview handoff',
  );
  assertExactKeys(document, TOP_LEVEL_KEYS, 'steady-file preview handoff');
  if (
    document.schemaVersion !== STEADY_FILE_PREVIEW_HANDOFF_SCHEMA_VERSION ||
    document.kind !== STEADY_FILE_PREVIEW_HANDOFF_KIND
  ) {
    throw new TypeError('steady-file preview handoff header is invalid.');
  }
  if (
    typeof document.commit !== 'string' ||
    !COMMIT_PATTERN.test(document.commit)
  ) {
    throw new TypeError(
      'steady-file preview handoff.commit must be one lowercase 40-hex commit.',
    );
  }

  const builder = exactObject(
    document.builder,
    BUILDER_KEYS,
    'steady-file preview handoff.builder',
  );
  if (
    typeof builder.machineId !== 'string' ||
    !MACHINE_ID_PATTERN.test(builder.machineId) ||
    /^0+$/u.test(builder.machineId)
  ) {
    throw new TypeError(
      'steady-file preview handoff.builder.machineId must be one nonzero lowercase Linux machine ID.',
    );
  }
  const toolchainInput = exactObject(
    builder.toolchain,
    TOOLCHAIN_KEYS,
    'steady-file preview handoff.builder.toolchain',
  );
  const toolchain = {
    node: validateExactSemver(
      toolchainInput.node,
      'steady-file preview handoff.builder.toolchain.node',
    ),
    npm: validateExactSemver(
      toolchainInput.npm,
      'steady-file preview handoff.builder.toolchain.npm',
    ),
  };

  const packageInput = exactObject(
    document.package,
    PACKAGE_KEYS,
    'steady-file preview handoff.package',
  );
  if (packageInput.name !== '@wharfie/wharfie') {
    throw new TypeError(
      "steady-file preview handoff.package.name must be '@wharfie/wharfie'.",
    );
  }
  const packageVersion = validateExactSemver(
    packageInput.version,
    'steady-file preview handoff.package.version',
  );
  const tarballSha256 = validateSha256Hex(
    packageInput.tarballSha256,
    'steady-file preview handoff.package.tarballSha256',
  );
  const packedFileCount = validateByteCount(
    packageInput.packedFileCount,
    'steady-file preview handoff.package.packedFileCount',
    { positive: true },
  );
  const installedStarter = validateRelativePath(
    packageInput.installedStarter,
    'steady-file preview handoff.package.installedStarter',
  );
  if (installedStarter !== INSTALLED_STARTER) {
    throw new TypeError(
      `steady-file preview handoff.package.installedStarter must be '${INSTALLED_STARTER}'.`,
    );
  }

  const starterInput = exactObject(
    document.starter,
    STARTER_KEYS,
    'steady-file preview handoff.starter',
  );
  const starterFiles = validateStarterFiles(
    starterInput.files,
    'steady-file preview handoff.starter.files',
  );

  const mutationInput = exactObject(
    document.mutation,
    MUTATION_KEYS,
    'steady-file preview handoff.mutation',
  );
  const mutationPath = validateRelativePath(
    mutationInput.path,
    'steady-file preview handoff.mutation.path',
  );
  if (!STEADY_FILE_PREVIEW_STARTER_FILES.includes(mutationPath)) {
    throw new TypeError(
      'steady-file preview handoff.mutation.path must select a supported starter file.',
    );
  }
  const mutationFrom = validateNonemptyString(
    mutationInput.from,
    'steady-file preview handoff.mutation.from',
  );
  const mutationTo = validateNonemptyString(
    mutationInput.to,
    'steady-file preview handoff.mutation.to',
  );
  const beforeSha256 = validateSha256Hex(
    mutationInput.beforeSha256,
    'steady-file preview handoff.mutation.beforeSha256',
  );
  const afterSha256 = validateSha256Hex(
    mutationInput.afterSha256,
    'steady-file preview handoff.mutation.afterSha256',
  );
  if (
    mutationFrom === mutationTo ||
    beforeSha256 === afterSha256 ||
    starterFiles[mutationPath] !== beforeSha256
  ) {
    throw new Error(
      'steady-file preview handoff mutation must describe one changed starter file.',
    );
  }

  const ordinary = validateOrdinary(
    document.ordinary,
    'steady-file preview handoff.ordinary',
  );
  const artifactsInput = exactObject(
    document.artifacts,
    ARTIFACTS_KEYS,
    'steady-file preview handoff.artifacts',
  );
  const source = validateArtifact(
    artifactsInput.source,
    'source',
    toolchain.node,
  );
  const target = validateArtifact(
    artifactsInput.target,
    'target',
    toolchain.node,
  );
  if (
    source.revisionId === target.revisionId ||
    source.artifactId === target.artifactId ||
    source.sha256 === target.sha256
  ) {
    throw new Error(
      'steady-file preview handoff source and target must be distinct revisions and artifacts.',
    );
  }
  if (!sameJson(source.target, target.target)) {
    throw new Error(
      'steady-file preview handoff source and target must use the same build target.',
    );
  }

  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: STEADY_FILE_PREVIEW_HANDOFF_SCHEMA_VERSION,
      kind: STEADY_FILE_PREVIEW_HANDOFF_KIND,
      commit: document.commit,
      builder: {
        machineId: builder.machineId,
        toolchain,
      },
      package: {
        name: packageInput.name,
        version: packageVersion,
        tarballSha256,
        packedFileCount,
        installedStarter,
      },
      starter: { files: starterFiles },
      mutation: {
        path: mutationPath,
        from: mutationFrom,
        to: mutationTo,
        beforeSha256,
        afterSha256,
      },
      ordinary,
      artifacts: { source, target },
    }),
  );
}

/** @param {unknown} input @returns {Readonly<Record<string, any>>} */
export function createSteadyFilePreviewHandoff(input) {
  const snapshot = cloneBoundedJsonValue(
    input,
    STEADY_FILE_PREVIEW_HANDOFF_MAX_BYTES,
    'steady-file preview handoff input',
  );
  return validateSteadyFilePreviewHandoffDocument(snapshot);
}

/** @param {unknown} value @returns {string} */
export function stringifySteadyFilePreviewHandoff(value) {
  const handoff = validateSteadyFilePreviewHandoffDocument(value);
  return `${JSON.stringify(sortCanonicalJsonValue(handoff))}\n`;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalAbsoluteRoot(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    !path.isAbsolute(value) ||
    path.resolve(value) !== value ||
    path.parse(value).root === value
  ) {
    throw new TypeError(
      `${valuePath} must be a canonical absolute non-root path.`,
    );
  }
  return value;
}

/** @param {string} root @param {ReadonlyArray<string>} expectedFiles @returns {void} */
function assertExactTree(root, expectedFiles) {
  const rootStats = lstatSync(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError(
      'steady-file preview handoff root must be a real directory.',
    );
  }
  const expectedDirectories = new Set(['source', 'target']);
  const actualDirectories = new Set();
  const actualFiles = new Set();

  /** @param {string} absoluteDirectory @param {string} relativeDirectory */
  function visit(absoluteDirectory, relativeDirectory) {
    for (const entry of readdirSync(absoluteDirectory, {
      withFileTypes: true,
    })) {
      const relativePath = relativeDirectory
        ? path.posix.join(relativeDirectory, entry.name)
        : entry.name;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      const stats = lstatSync(absolutePath);
      if (stats.isSymbolicLink()) {
        throw new TypeError(
          `steady-file preview handoff entry ${relativePath} must not be a symlink.`,
        );
      }
      if (stats.isDirectory()) {
        actualDirectories.add(relativePath);
        visit(absolutePath, relativePath);
      } else if (stats.isFile()) {
        actualFiles.add(relativePath);
      } else {
        throw new TypeError(
          `steady-file preview handoff entry ${relativePath} must be a regular file or directory.`,
        );
      }
    }
  }
  visit(root, '');
  if (
    actualDirectories.size !== expectedDirectories.size ||
    [...actualDirectories].some(
      (relativePath) => !expectedDirectories.has(relativePath),
    )
  ) {
    throw new TypeError(
      'steady-file preview handoff must contain only source and target directories.',
    );
  }
  const expected = new Set(expectedFiles);
  if (
    actualFiles.size !== expected.size ||
    [...actualFiles].some((relativePath) => !expected.has(relativePath))
  ) {
    throw new TypeError(
      'steady-file preview handoff files must match the exact allowlist.',
    );
  }
}

/**
 * Observe a regular non-symlink through one held descriptor. Metadata is
 * checked before and after hashing so a concurrently rewritten file cannot
 * silently produce a mixed observation.
 * @param {string} filePath
 * @param {{maxBytes: number, capture: boolean, executable?: boolean}} options
 * @returns {Readonly<{kind: 'regular', size: number, sha256: string, bytes?: Buffer}>}
 */
function observeRegularFile(filePath, options) {
  const beforeOpen = lstatSync(filePath);
  if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) {
    throw new TypeError(
      `steady-file preview handoff file ${filePath} must be a regular non-symlink.`,
    );
  }
  const noFollow = Number(fsConstants.O_NOFOLLOW || 0);
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const before = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.dev !== beforeOpen.dev ||
      before.ino !== beforeOpen.ino ||
      before.size !== beforeOpen.size ||
      before.size < 1 ||
      before.size > options.maxBytes
    ) {
      throw new TypeError(
        `steady-file preview handoff file ${filePath} has an invalid regular-file observation.`,
      );
    }
    if (options.executable === true && (before.mode & 0o111) === 0) {
      throw new TypeError(
        `steady-file preview handoff application ${filePath} must be executable.`,
      );
    }
    const hash = createHash('sha256');
    /** @type {Buffer[]} */
    const captured = [];
    const buffer = Buffer.allocUnsafe(Math.min(READ_BUFFER_BYTES, before.size));
    let offset = 0;
    while (offset < before.size) {
      const length = Math.min(buffer.length, before.size - offset);
      const bytesRead = readSync(descriptor, buffer, 0, length, offset);
      if (bytesRead === 0) break;
      const view = buffer.subarray(0, bytesRead);
      hash.update(view);
      if (options.capture) captured.push(Buffer.from(view));
      offset += bytesRead;
    }
    const after = fstatSync(descriptor);
    if (
      offset !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw new Error(
        `steady-file preview handoff file ${filePath} changed while observed.`,
      );
    }
    const observation = {
      kind: /** @type {'regular'} */ ('regular'),
      size: before.size,
      sha256: hash.digest('hex'),
    };
    if (!options.capture) return Object.freeze(observation);
    return Object.freeze({
      ...observation,
      bytes: Buffer.concat(captured, before.size),
    });
  } finally {
    closeSync(descriptor);
  }
}

/** @param {Buffer} bytes @param {string} valuePath @returns {unknown} */
function parseJsonBytes(bytes, valuePath) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(`${valuePath} must contain valid UTF-8.`, {
      cause: error,
    });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${valuePath} must contain one JSON document.`, {
      cause: error,
    });
  }
}

/** @param {Buffer} bytes @returns {Readonly<Record<string, string>>} */
function parseChecksums(bytes) {
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new TypeError(
      'steady-file preview handoff SHA256SUMS must contain valid UTF-8.',
      { cause: error },
    );
  }
  if (!text.endsWith('\n') || text.slice(0, -1).includes('\r')) {
    throw new TypeError(
      'steady-file preview handoff SHA256SUMS must use canonical LF lines.',
    );
  }
  const lines = text.slice(0, -1).split('\n');
  if (lines.length !== STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES.length) {
    throw new TypeError(
      'steady-file preview handoff SHA256SUMS must cover the exact file set.',
    );
  }
  /** @type {Record<string, string>} */
  const checksums = {};
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/u.exec(lines[index]);
    const expectedPath = STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES[index];
    if (
      !match ||
      validateRelativePath(match[2], `SHA256SUMS line ${index + 1}`) !==
        expectedPath
    ) {
      throw new TypeError(
        'steady-file preview handoff SHA256SUMS paths must use the exact canonical order.',
      );
    }
    checksums[expectedPath] = match[1];
  }
  return deepFreeze(checksums);
}

/** @param {Record<string, any>} record @param {Record<string, any>} artifact @param {string} label @returns {void} */
function assertRecordMatchesArtifact(record, artifact, label) {
  const valuePath = `steady-file preview handoff ${label} artifact record`;
  validateArtifactRecordShape(record, valuePath);
  assertArtifactId(record.artifactId, `${valuePath}.artifactId`);
  assertApplicationRevisionId(record.revisionId, `${valuePath}.revisionId`);
  const byteDigest = validateSha256Digest(
    record.byteDigest,
    `${valuePath}.byteDigest`,
  );
  const target = validateBuildTarget(record.target, `${valuePath}.target`);
  if (
    record.artifactId !== artifact.artifactId ||
    record.revisionId !== artifact.revisionId ||
    record.size !== artifact.size ||
    !sameJson(byteDigest, artifact.byteDigest) ||
    !sameJson(target, artifact.target) ||
    record.targetId !== getBuildTargetId(target, `${valuePath}.target`)
  ) {
    throw new Error(
      `${valuePath} must match the handoff artifact observation.`,
    );
  }
}

/**
 * Independently open and validate one complete handoff tree.
 * @param {unknown} rootValue
 * @returns {Readonly<{handoff: Record<string, any>, files: Record<string, {kind: 'regular', size: number, sha256: string}>}>}
 */
export function validateSteadyFilePreviewHandoff(rootValue) {
  const root = canonicalAbsoluteRoot(
    rootValue,
    'steady-file preview handoff root',
  );
  assertExactTree(root, STEADY_FILE_PREVIEW_HANDOFF_FILES);
  /** @type {Record<string, any>} */
  const observations = {};
  for (const relativePath of STEADY_FILE_PREVIEW_HANDOFF_FILES) {
    const isArtifact =
      relativePath === SOURCE_PATH || relativePath === TARGET_PATH;
    const capture = !isArtifact;
    observations[relativePath] = observeRegularFile(
      path.join(root, ...relativePath.split('/')),
      {
        maxBytes: isArtifact
          ? MAX_ARTIFACT_BYTES
          : relativePath === CHECKSUM_PATH
            ? MAX_CHECKSUM_BYTES
            : relativePath.endsWith('artifact-record.json')
              ? MAX_RECORD_BYTES
              : STEADY_FILE_PREVIEW_HANDOFF_MAX_BYTES,
        capture,
        executable: isArtifact,
      },
    );
  }

  const handoffObservation = observations[HANDOFF_PATH];
  const handoffRaw = parseJsonBytes(
    handoffObservation.bytes,
    'steady-file preview handoff.json',
  );
  const handoff = validateSteadyFilePreviewHandoffDocument(handoffRaw);
  if (
    handoffObservation.bytes.toString('utf8') !==
    stringifySteadyFilePreviewHandoff(handoff)
  ) {
    throw new TypeError(
      'steady-file preview handoff.json must use canonical serialization.',
    );
  }
  const checksums = parseChecksums(observations[CHECKSUM_PATH].bytes);
  for (const relativePath of STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES) {
    if (checksums[relativePath] !== observations[relativePath].sha256) {
      throw new Error(
        `steady-file preview handoff checksum does not match ${relativePath}.`,
      );
    }
  }

  for (const [label, artifact] of Object.entries(handoff.artifacts)) {
    const applicationObservation = observations[artifact.path];
    if (
      applicationObservation.sha256 !== artifact.sha256 ||
      applicationObservation.size !== artifact.size
    ) {
      throw new Error(
        `steady-file preview handoff ${label} application bytes do not match its artifact observation.`,
      );
    }
    const record = parseJsonBytes(
      observations[artifact.recordPath].bytes,
      `steady-file preview handoff ${label} artifact record`,
    );
    if (!isPlainObject(record)) {
      throw new TypeError(
        `steady-file preview handoff ${label} artifact record must be a JSON object.`,
      );
    }
    assertRecordMatchesArtifact(record, artifact, label);
  }

  /** @type {Record<string, {kind: 'regular', size: number, sha256: string}>} */
  const files = {};
  for (const relativePath of STEADY_FILE_PREVIEW_HANDOFF_FILES) {
    const observation = observations[relativePath];
    files[relativePath] = Object.freeze({
      kind: 'regular',
      size: observation.size,
      sha256: observation.sha256,
    });
  }
  return deepFreeze({ handoff, files });
}

/** @param {string} destination @param {string | Buffer} bytes @returns {void} */
function writeAtomic(destination, bytes) {
  const parent = path.dirname(destination);
  const temporary = path.join(
    parent,
    `.${path.basename(destination)}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  const descriptor = openSync(
    temporary,
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
    0o600,
  );
  try {
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  try {
    renameSync(temporary, destination);
    const directory = openSync(parent, fsConstants.O_RDONLY);
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

/**
 * Write canonical metadata around four already-staged artifact files, then
 * reopen the complete handoff through the independent validator.
 * @param {unknown} rootValue
 * @param {unknown} input
 * @returns {Readonly<{handoff: Record<string, any>, files: Record<string, {kind: 'regular', size: number, sha256: string}>}>}
 */
export function writeSteadyFilePreviewHandoff(rootValue, input) {
  const root = canonicalAbsoluteRoot(
    rootValue,
    'steady-file preview handoff root',
  );
  const stagedFiles = STEADY_FILE_PREVIEW_HANDOFF_FILES.filter(
    (relativePath) =>
      relativePath !== HANDOFF_PATH && relativePath !== CHECKSUM_PATH,
  );
  assertExactTree(root, stagedFiles);
  const handoff = createSteadyFilePreviewHandoff(input);

  for (const [label, artifact] of Object.entries(handoff.artifacts)) {
    const application = observeRegularFile(
      path.join(root, ...artifact.path.split('/')),
      {
        maxBytes: MAX_ARTIFACT_BYTES,
        capture: false,
        executable: true,
      },
    );
    if (
      application.sha256 !== artifact.sha256 ||
      application.size !== artifact.size
    ) {
      throw new Error(
        `steady-file preview handoff ${label} application bytes do not match its artifact observation.`,
      );
    }
    const recordObservation = observeRegularFile(
      path.join(root, ...artifact.recordPath.split('/')),
      { maxBytes: MAX_RECORD_BYTES, capture: true },
    );
    if (!recordObservation.bytes) {
      throw new Error(
        `steady-file preview handoff ${label} artifact record bytes were not captured.`,
      );
    }
    const record = parseJsonBytes(
      recordObservation.bytes,
      `steady-file preview handoff ${label} artifact record`,
    );
    if (!isPlainObject(record)) {
      throw new TypeError(
        `steady-file preview handoff ${label} artifact record must be a JSON object.`,
      );
    }
    assertRecordMatchesArtifact(record, artifact, label);
  }

  const handoffDestination = path.join(root, HANDOFF_PATH);
  const checksumDestination = path.join(root, CHECKSUM_PATH);
  let handoffWritten = false;
  let checksumWritten = false;
  try {
    writeAtomic(handoffDestination, stringifySteadyFilePreviewHandoff(handoff));
    handoffWritten = true;
    /** @type {Record<string, string>} */
    const hashes = {};
    for (const relativePath of STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES) {
      const isArtifact =
        relativePath === SOURCE_PATH || relativePath === TARGET_PATH;
      hashes[relativePath] = observeRegularFile(
        path.join(root, ...relativePath.split('/')),
        {
          maxBytes: isArtifact
            ? MAX_ARTIFACT_BYTES
            : relativePath.endsWith('artifact-record.json')
              ? MAX_RECORD_BYTES
              : STEADY_FILE_PREVIEW_HANDOFF_MAX_BYTES,
          capture: false,
          executable: isArtifact,
        },
      ).sha256;
    }
    const checksumText = STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES.map(
      (relativePath) => `${hashes[relativePath]}  ${relativePath}\n`,
    ).join('');
    writeAtomic(checksumDestination, checksumText);
    checksumWritten = true;
    return validateSteadyFilePreviewHandoff(root);
  } catch (error) {
    if (checksumWritten || existsSync(checksumDestination)) {
      rmSync(checksumDestination, { force: true });
    }
    if (handoffWritten || existsSync(handoffDestination)) {
      rmSync(handoffDestination, { force: true });
    }
    throw error;
  }
}

export default {
  STEADY_FILE_PREVIEW_HANDOFF_CHECKSUM_FILES,
  STEADY_FILE_PREVIEW_HANDOFF_FILES,
  STEADY_FILE_PREVIEW_HANDOFF_KIND,
  STEADY_FILE_PREVIEW_HANDOFF_MAX_BYTES,
  STEADY_FILE_PREVIEW_HANDOFF_SCHEMA_VERSION,
  STEADY_FILE_PREVIEW_STARTER_FILES,
  createSteadyFilePreviewHandoff,
  stringifySteadyFilePreviewHandoff,
  validateSteadyFilePreviewHandoff,
  validateSteadyFilePreviewHandoffDocument,
  writeSteadyFilePreviewHandoff,
};
