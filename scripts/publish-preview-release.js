import { execFile as nodeExecFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzip as nodeGunzip } from 'node:zlib';

import packageMetadata from '../package.json' with { type: 'json' };
import { assertPreviewPublishEnvironment } from './assert-preview-publish.js';

const REPOSITORY = 'wharfie/wharfie';
const CANONICAL_GITHUB_HOST = 'github.com';
const CANONICAL_GITHUB_REPOSITORY = `${CANONICAL_GITHUB_HOST}/${REPOSITORY}`;
const CANONICAL_REMOTE = 'https://github.com/wharfie/wharfie.git';
const RELEASE_MANIFEST_NAME = 'preview-release.json';
const CHECKSUMS_NAME = 'SHA256SUMS';
const MAX_COMMAND_OUTPUT = 20 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_PACKAGE_ARCHIVE_BYTES = 128 * 1024 * 1024;
const MAX_PACKAGE_TAR_BYTES = 512 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_TAR_ENTRIES = 100_000;
const NPM_REGISTRY = 'https://registry.npmjs.org';
const PREVIEW_DIST_TAG = 'preview';
const QUARANTINE_DIST_TAG = 'preview-candidate';
const SLSA_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';
const AUTHORITY_TAG_REF = 'refs/wharfie-preview-authority/tag';
const AUTHORITY_MASTER_REF = 'refs/wharfie-preview-authority/master';
const PREVIEW_TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const NPM_LIFECYCLE_HOOKS = new Set([
  'dependencies',
  'install',
  'postdependencies',
  'postinstall',
  'postpack',
  'postprepare',
  'postpublish',
  'postrestart',
  'postshrinkwrap',
  'poststart',
  'poststop',
  'postuninstall',
  'postversion',
  'predependencies',
  'preinstall',
  'prepack',
  'prepare',
  'preprepare',
  'prepublish',
  'prepublishOnly',
  'prerestart',
  'preshrinkwrap',
  'prestart',
  'prestop',
  'preuninstall',
  'preversion',
  'publish',
  'restart',
  'shrinkwrap',
  'start',
  'stop',
  'uninstall',
  'version',
]);
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * @typedef {object} PreviewPublicationOptions
 * @property {string} [artifactDir] - Directory containing the candidate assets.
 * @property {boolean} [deferFinalize] - Leave the exact release as a draft.
 * @property {boolean} [finalizeOnly] - Perform only the final draft-to-prerelease transition.
 */

/**
 * @typedef {object} CommandResult
 * @property {string} stdout - Captured standard output.
 * @property {string} stderr - Captured standard error.
 */

/**
 * @typedef {(command: string, args: string[], options?: {cwd?: string, env?: NodeJS.ProcessEnv}) => Promise<CommandResult>} CommandRunner
 */

/**
 * @typedef {object} PreviewPublicationDependencies
 * @property {CommandRunner} [runCommand] - Injected command boundary.
 * @property {(candidate: PreviewReleaseCandidate) => void | Promise<void>} [authorize] - Publication authorization boundary.
 * @property {string} [expectedCommit] - Expected workflow source commit.
 */

/**
 * @typedef {object} LocalReleaseAsset
 * @property {string} name - Release asset name.
 * @property {string} filePath - Absolute local path.
 * @property {number} size - Local byte size.
 * @property {string} sha256 - Local SHA-256 digest.
 */

/**
 * @typedef {object} PreviewReleaseCandidate
 * @property {string} artifactDir - Absolute artifact directory.
 * @property {Record<string, any>} manifest - Validated preview manifest.
 * @property {Record<string, any>} npmArtifact - npm tarball manifest entry.
 * @property {LocalReleaseAsset[]} assets - Exact GitHub release asset set.
 * @property {string} title - Exact GitHub release title.
 * @property {string} notes - Exact GitHub release notes.
 */

/**
 * @param {string} command - Executable name.
 * @param {string[]} args - Exact command arguments.
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [options] - Process options.
 * @returns {Promise<CommandResult>} Captured command output.
 */
function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    nodeExecFile(
      command,
      args,
      {
        cwd: options.cwd,
        env: options.env || process.env,
        encoding: 'utf8',
        maxBuffer: MAX_COMMAND_OUTPUT,
        timeout: COMMAND_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new Error(
            `${command} ${args.join(' ')} failed: ${error.message}`,
            { cause: error },
          );
          Object.assign(failure, {
            code: /** @type {any} */ (error).code,
            stdout: String(stdout || ''),
            stderr: String(stderr || ''),
          });
          reject(failure);
          return;
        }
        resolve({
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        });
      },
    );
  });
}

/**
 * @param {unknown} value - Candidate JSON value.
 * @param {string} label - Diagnostic label.
 * @returns {Record<string, any>} Object value.
 */
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value - Candidate string.
 * @param {string} label - Diagnostic label.
 * @returns {string} Nonempty string.
 */
function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  return value;
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} keys - Exact supported own keys.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertExactKeys(value, keys, label) {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${label}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} Whether both JSON values are structurally identical.
 */
function sameJson(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]))
    );
  }
  if (
    !left ||
    !right ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false;
  }
  const leftObject = /** @type {Record<string, any>} */ (left);
  const rightObject = /** @type {Record<string, any>} */ (right);
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return (
    sameJson(leftKeys, rightKeys) &&
    leftKeys.every((key) => sameJson(leftObject[key], rightObject[key]))
  );
}

/**
 * @param {unknown} actual - Candidate JSON value.
 * @param {unknown} expected - Exact required JSON value.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertSameJson(actual, expected, label) {
  if (!sameJson(actual, expected)) {
    throw new TypeError(
      `${label} does not match the preview package contract.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate unpadded base64url SHA-256 digest.
 * @returns {boolean} Whether the digest has one canonical spelling.
 */
function isCanonicalSha256Base64Url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    return false;
  }
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === 32 && bytes.toString('base64url') === value;
}

/**
 * @param {unknown} value - Candidate domain-separated identity.
 * @param {'waf1'|'wrv1'} prefix - Exact identity type.
 * @param {string} label - Diagnostic label.
 * @returns {string} Validated identity.
 */
function requireCanonicalId(value, prefix, label) {
  const encoded =
    typeof value === 'string' && value.startsWith(`${prefix}_`)
      ? value.slice(prefix.length + 1)
      : undefined;
  if (!isCanonicalSha256Base64Url(encoded)) {
    throw new TypeError(
      `${label} must be a canonical ${prefix}_<base64url SHA-256> identity.`,
    );
  }
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value - Candidate exact release version.
 * @param {string} label - Diagnostic label.
 * @returns {[number, number, number]} Numeric version tuple.
 */
function parseExactReleaseVersion(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be an exact x.y.z release version.`);
  }
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value);
  if (!match) {
    throw new TypeError(`${label} must be an exact x.y.z release version.`);
  }
  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new TypeError(`${label} contains an unsafe numeric component.`);
  }
  return /** @type {[number, number, number]} */ (parts);
}

/**
 * @param {unknown} value - Candidate canonical semantic version.
 * @param {string} label - Diagnostic label.
 * @returns {{version: string, core: [number, number, number], prerelease: string[] | null}} Parsed semantic version.
 */
function parseCanonicalSemver(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a semantic version string.`);
  }
  const version = value;
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
      version,
    );
  if (!match)
    throw new TypeError(
      `${label} contains invalid semantic version ${version}.`,
    );
  const core = /** @type {[number, number, number]} */ (
    match.slice(1, 4).map(Number)
  );
  if (core.some((part) => !Number.isSafeInteger(part))) {
    throw new TypeError(
      `${label} contains an unsafe semantic version ${version}.`,
    );
  }
  return {
    version,
    core,
    prerelease: match[4] === undefined ? null : match[4].split('.'),
  };
}

/**
 * @param {ReturnType<typeof parseCanonicalSemver>} left - First version.
 * @param {ReturnType<typeof parseCanonicalSemver>} right - Second version.
 * @returns {number} Semantic-version ordering.
 */
function compareSemver(left, right) {
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] !== right.core[index]) {
      return left.core[index] - right.core[index];
    }
  }
  if (left.prerelease === null || right.prerelease === null) {
    if (left.prerelease === right.prerelease) return 0;
    return left.prerelease === null ? 1 : -1;
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      if (leftPart.length !== rightPart.length) {
        return leftPart.length - rightPart.length;
      }
      return leftPart < rightPart ? -1 : 1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

/**
 * @param {Buffer} bytes - Compressed archive bytes.
 * @param {string} label - Diagnostic label.
 * @returns {Promise<Buffer>} Bounded decompressed tar bytes.
 */
function gunzipPackage(bytes, label) {
  if (bytes.length > MAX_PACKAGE_ARCHIVE_BYTES) {
    throw new TypeError(`${label} exceeds the package archive size limit.`);
  }
  return new Promise((resolve, reject) => {
    nodeGunzip(
      bytes,
      { maxOutputLength: MAX_PACKAGE_TAR_BYTES },
      (error, result) => {
        if (error) {
          reject(
            new TypeError(`${label} is not a bounded gzip archive.`, {
              cause: error,
            }),
          );
          return;
        }
        resolve(result);
      },
    );
  });
}

/**
 * @param {Buffer} field - Tar header text field.
 * @param {string} label - Diagnostic label.
 * @returns {string} Valid UTF-8 field text before the first NUL.
 */
function readTarText(field, label) {
  const nul = field.indexOf(0);
  const bytes = nul === -1 ? field : field.subarray(0, nul);
  const value = bytes.toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(bytes)) {
    throw new TypeError(`${label} is not canonical UTF-8.`);
  }
  return value;
}

/**
 * @param {Buffer} field - Tar octal number field.
 * @param {string} label - Diagnostic label.
 * @returns {number} Safe nonnegative integer.
 */
function readTarNumber(field, label) {
  if ((field[0] & 0x80) !== 0) {
    throw new TypeError(`${label} uses an unsupported base-256 integer.`);
  }
  const value = readTarText(field, label).trim();
  if (!/^[0-7]+$/u.test(value)) {
    throw new TypeError(`${label} must be a canonical tar octal integer.`);
  }
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`${label} exceeds the safe integer range.`);
  }
  return parsed;
}

/**
 * @param {Buffer} header - One 512-byte tar header.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertTarChecksum(header, label) {
  const expected = readTarNumber(
    header.subarray(148, 156),
    `${label} checksum`,
  );
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  if (actual !== expected) {
    throw new TypeError(`${label} has an invalid tar header checksum.`);
  }
}

/**
 * @param {Buffer} bytes - PAX extended-header body.
 * @param {string} label - Diagnostic label.
 * @returns {Record<string, string>} Parsed PAX keys.
 */
function parsePaxHeader(bytes, label) {
  /** @type {Record<string, string>} */
  const fields = Object.create(null);
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(0x20, offset);
    if (space === -1) throw new TypeError(`${label} has an invalid record.`);
    const lengthText = bytes.subarray(offset, space).toString('ascii');
    if (!/^[1-9]\d*$/u.test(lengthText)) {
      throw new TypeError(`${label} has an invalid record length.`);
    }
    const length = Number(lengthText);
    const end = offset + length;
    if (
      !Number.isSafeInteger(length) ||
      end > bytes.length ||
      end <= space + 1
    ) {
      throw new TypeError(`${label} has an out-of-range record length.`);
    }
    const record = bytes.subarray(space + 1, end);
    if (record.at(-1) !== 0x0a) {
      throw new TypeError(`${label} record must end in a newline.`);
    }
    const equals = record.indexOf(0x3d);
    if (equals <= 0) throw new TypeError(`${label} has an invalid key.`);
    const key = readTarText(record.subarray(0, equals), `${label} key`);
    const value = readTarText(
      record.subarray(equals + 1, record.length - 1),
      `${label}.${key}`,
    );
    if (Object.hasOwn(fields, key)) {
      throw new TypeError(`${label} repeats ${key}.`);
    }
    fields[key] = value;
    offset = end;
  }
  return fields;
}

/**
 * @param {string} memberPath - Logical archive member path.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertSafeTarPath(memberPath, label) {
  const parts = memberPath.split('/');
  if (
    memberPath.length === 0 ||
    memberPath.startsWith('/') ||
    memberPath.includes('\\') ||
    memberPath.includes('\0') ||
    parts.some((part) => part.length === 0 || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label} contains an unsafe archive path.`);
  }
}

/**
 * Locate and parse the one logical package/package.json tar member without
 * extracting any archive content or trusting path overrides.
 * @param {Buffer} tar - Decompressed tar bytes.
 * @param {string} label - Diagnostic label.
 * @returns {Record<string, any>} Parsed package metadata.
 */
function readPackageJsonFromTar(tar, label) {
  /** @type {Record<string, any> | null} */
  let metadata = null;
  /** @type {Record<string, string> | null} */
  let pendingPax = null;
  /** @type {string | null} */
  let pendingLongName = null;
  let offset = 0;
  let entries = 0;
  let ended = false;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      if (
        offset + 512 > tar.length ||
        !tar.subarray(offset, offset + 512).every((byte) => byte === 0) ||
        !tar.subarray(offset + 512).every((byte) => byte === 0)
      ) {
        throw new TypeError(`${label} has an invalid tar terminator.`);
      }
      ended = true;
      break;
    }
    entries += 1;
    if (entries > MAX_TAR_ENTRIES) {
      throw new TypeError(`${label} contains too many tar entries.`);
    }
    assertTarChecksum(header, `${label} entry ${entries}`);
    const name = readTarText(
      header.subarray(0, 100),
      `${label} entry ${entries} name`,
    );
    const prefix = readTarText(
      header.subarray(345, 500),
      `${label} entry ${entries} prefix`,
    );
    const headerPath = prefix ? `${prefix}/${name}` : name;
    const size = readTarNumber(
      header.subarray(124, 136),
      `${label} entry ${entries} size`,
    );
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > tar.length) {
      throw new TypeError(`${label} contains a truncated tar entry.`);
    }
    const body = tar.subarray(offset, offset + size);
    offset += paddedSize;
    const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]);

    if (type === 'x' || type === 'g') {
      const pax = parsePaxHeader(body, `${label} PAX entry ${entries}`);
      if (type === 'g') {
        if (Object.hasOwn(pax, 'path') || Object.hasOwn(pax, 'linkpath')) {
          throw new TypeError(`${label} uses an unsafe global PAX path.`);
        }
      } else {
        if (pendingPax) {
          throw new TypeError(`${label} contains stacked local PAX headers.`);
        }
        pendingPax = pax;
      }
      continue;
    }
    if (type === 'L') {
      if (pendingLongName) {
        throw new TypeError(`${label} contains stacked GNU long names.`);
      }
      pendingLongName = readTarText(body, `${label} GNU long name`);
      continue;
    }

    const logicalPath =
      pendingPax && Object.hasOwn(pendingPax, 'path')
        ? pendingPax.path
        : pendingLongName !== null
          ? pendingLongName
          : headerPath;
    pendingPax = null;
    pendingLongName = null;
    assertSafeTarPath(logicalPath, `${label} entry ${entries}`);
    if (logicalPath !== 'package/package.json') continue;
    if (type !== '0') {
      throw new TypeError(
        `${label} package/package.json is not a regular file.`,
      );
    }
    if (metadata) {
      throw new TypeError(`${label} contains duplicate package/package.json.`);
    }
    if (body.length === 0 || body.length > MAX_PACKAGE_JSON_BYTES) {
      throw new TypeError(`${label} package/package.json has an invalid size.`);
    }
    metadata = requireObject(
      parseJson(body.toString('utf8'), `${label} package/package.json`),
      `${label} package/package.json`,
    );
  }

  if (!ended || pendingPax || pendingLongName) {
    throw new TypeError(`${label} is not a complete canonical tar archive.`);
  }
  if (!metadata) {
    throw new TypeError(`${label} is missing package/package.json.`);
  }
  return metadata;
}

/**
 * @param {Record<string, any>} metadata - Packed package metadata.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertNoLifecycleScripts(metadata, label) {
  if (metadata.scripts === undefined) return;
  const scripts = requireObject(metadata.scripts, `${label}.scripts`);
  for (const hook of Object.keys(scripts)) {
    if (NPM_LIFECYCLE_HOOKS.has(hook)) {
      throw new TypeError(
        `${label} must not contain npm lifecycle hook ${hook}.`,
      );
    }
  }
}

/**
 * @param {Buffer} coreBytes - Exact packed core bytes.
 * @param {Buffer} companionBytes - Exact packed AWS companion bytes.
 * @param {string} version - Exact preview version.
 * @returns {Promise<void>}
 */
async function assertPackedPackageContracts(
  coreBytes,
  companionBytes,
  version,
) {
  const [coreTar, companionTar] = await Promise.all([
    gunzipPackage(coreBytes, 'Preview core package'),
    gunzipPackage(companionBytes, 'Preview AWS companion package'),
  ]);
  const core = readPackageJsonFromTar(coreTar, 'Preview core package');
  const companion = readPackageJsonFromTar(
    companionTar,
    'Preview AWS companion package',
  );
  const engine = { node: '>=24.13.1 <25' };
  const repository = {
    type: 'git',
    url: 'git+https://github.com/wharfie/wharfie.git',
  };

  if (
    core.name !== '@wharfie/wharfie' ||
    core.version !== version ||
    core.private !== false
  ) {
    throw new TypeError(
      'Preview core package must have the exact public name and version.',
    );
  }
  if (
    companion.name !== '@wharfie/aws' ||
    companion.version !== version ||
    companion.private !== false
  ) {
    throw new TypeError(
      'Preview AWS companion package must have the exact public name and version.',
    );
  }
  assertSameJson(core.engines, engine, 'Preview core package engines');
  assertSameJson(
    companion.engines,
    engine,
    'Preview AWS companion package engines',
  );
  assertSameJson(core.repository, repository, 'Preview core repository');
  assertSameJson(
    companion.repository,
    { ...repository, directory: 'packages/aws' },
    'Preview AWS companion repository',
  );
  assertSameJson(
    core.peerDependencies,
    { '@wharfie/aws': version },
    'Preview core peerDependencies',
  );
  assertSameJson(
    companion.peerDependencies,
    { '@wharfie/wharfie': version },
    'Preview AWS companion peerDependencies',
  );
  assertSameJson(
    core.peerDependenciesMeta,
    { '@wharfie/aws': { optional: true } },
    'Preview core peerDependenciesMeta',
  );
  assertSameJson(
    companion.peerDependenciesMeta,
    { '@wharfie/wharfie': { optional: true } },
    'Preview AWS companion peerDependenciesMeta',
  );
  assertSameJson(
    core.publishConfig,
    { access: 'public', tag: QUARANTINE_DIST_TAG, provenance: true },
    'Preview core publishConfig',
  );
  assertSameJson(
    companion.publishConfig,
    { access: 'public' },
    'Preview AWS companion publishConfig',
  );
  assertNoLifecycleScripts(core, 'Preview core package');
  assertNoLifecycleScripts(companion, 'Preview AWS companion package');
}

/**
 * @param {string} text - JSON response text.
 * @param {string} label - Diagnostic label.
 * @returns {any} Parsed JSON value.
 */
function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TypeError(`${label} did not return valid JSON.`, {
      cause: error,
    });
  }
}

/**
 * @param {Buffer | string} contents - Bytes to digest.
 * @param {'sha1' | 'sha256' | 'sha512'} algorithm - Digest algorithm.
 * @param {'hex' | 'base64'} encoding - Digest encoding.
 * @returns {string} Digest.
 */
function digest(contents, algorithm, encoding) {
  return createHash(algorithm).update(contents).digest(encoding);
}

/**
 * @param {unknown} error - npm command failure.
 * @returns {boolean} Whether npm explicitly reported a missing version.
 */
function isNpmVersionNotFound(error) {
  if (!error || typeof error !== 'object') return false;
  const failure = /** @type {Record<string, any>} */ (error);
  if (failure.code === 'E404') return true;
  for (const output of [failure.stdout, failure.stderr]) {
    if (typeof output !== 'string' || output.trim() === '') continue;
    let response;
    try {
      response = JSON.parse(output);
    } catch {
      continue;
    }
    if (
      response &&
      typeof response === 'object' &&
      !Array.isArray(response) &&
      response.error &&
      typeof response.error === 'object' &&
      !Array.isArray(response.error) &&
      response.error.code === 'E404'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * @param {PreviewPublicationOptions} options - Publication mode options.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertExactlyOnePublicationMode(options, label) {
  for (const key of ['deferFinalize', 'finalizeOnly']) {
    const value =
      options[/** @type {'deferFinalize' | 'finalizeOnly'} */ (key)];
    if (value !== undefined && typeof value !== 'boolean') {
      throw new TypeError(`${label} ${key} must be a boolean when provided.`);
    }
  }
  const deferFinalize = options.deferFinalize === true;
  const finalizeOnly = options.finalizeOnly === true;
  if (deferFinalize === finalizeOnly) {
    throw new TypeError(
      `${label} requires exactly one of deferFinalize or finalizeOnly.`,
    );
  }
}

/**
 * @param {CommandResult} result - `git rev-parse` result.
 * @param {string} label - Diagnostic label.
 * @returns {string} Exact lowercase Git object ID.
 */
function parseGitCommit(result, label) {
  const commit = result.stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(commit)) {
    throw new TypeError(`${label} did not resolve to one full Git commit ID.`);
  }
  return commit;
}

/**
 * Fetch the authoritative tag and current master from the canonical URL,
 * then bind both the tag and master ancestry to the manifest commit.
 * @param {PreviewReleaseCandidate} candidate - Validated release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @returns {Promise<void>}
 */
async function assertCanonicalSourceAuthority(candidate, command) {
  const tagRef = `refs/tags/${candidate.manifest.tag}`;
  await command(
    'git',
    [
      'fetch',
      '--no-tags',
      '--force',
      '--no-write-fetch-head',
      CANONICAL_REMOTE,
      `+${tagRef}:${AUTHORITY_TAG_REF}`,
      `+refs/heads/master:${AUTHORITY_MASTER_REF}`,
    ],
    { cwd: REPO_ROOT },
  );
  const [tagResult, masterResult] = await Promise.all([
    command('git', ['rev-parse', '--verify', `${AUTHORITY_TAG_REF}^{commit}`], {
      cwd: REPO_ROOT,
    }),
    command(
      'git',
      ['rev-parse', '--verify', `${AUTHORITY_MASTER_REF}^{commit}`],
      {
        cwd: REPO_ROOT,
      },
    ),
  ]);
  const tagCommit = parseGitCommit(tagResult, 'Canonical remote tag');
  const masterCommit = parseGitCommit(masterResult, 'Canonical remote master');
  if (tagCommit !== candidate.manifest.source.commit) {
    throw new TypeError(
      `Canonical remote tag ${candidate.manifest.tag} resolves to ${tagCommit}, not manifest commit ${candidate.manifest.source.commit}.`,
    );
  }
  try {
    await command(
      'git',
      [
        'merge-base',
        '--is-ancestor',
        candidate.manifest.source.commit,
        masterCommit,
      ],
      { cwd: REPO_ROOT },
    );
  } catch (error) {
    throw new TypeError(
      `Manifest commit ${candidate.manifest.source.commit} is not an ancestor of canonical current master ${masterCommit}.`,
      { cause: error },
    );
  }
}

/**
 * @param {string[]} argv - Command arguments.
 * @returns {PreviewPublicationOptions} Parsed bounded options.
 */
export function parsePreviewPublicationArgs(argv) {
  /** @type {PreviewPublicationOptions} */
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--defer-finalize' || argument === '--finalize-only') {
      const key =
        argument === '--defer-finalize' ? 'deferFinalize' : 'finalizeOnly';
      if (options[key] === true) {
        throw new TypeError(`${argument} may be provided only once.`);
      }
      options[key] = true;
      continue;
    }
    if (argument !== '--artifact-dir') {
      throw new TypeError(`Unknown preview publication option: ${argument}`);
    }
    if (options.artifactDir !== undefined) {
      throw new TypeError('--artifact-dir may be provided only once.');
    }
    const value = argv[index + 1];
    if (typeof value !== 'string' || value.length === 0) {
      throw new TypeError('--artifact-dir requires a value.');
    }
    options.artifactDir = value;
    index += 1;
  }
  try {
    assertExactlyOnePublicationMode(options, 'Preview publication CLI');
  } catch (error) {
    throw new TypeError(
      'Preview publication CLI requires exactly one of --defer-finalize or --finalize-only.',
      { cause: error },
    );
  }
  return options;
}

/**
 * @param {string} artifactDir - Candidate release directory.
 * @param {{expectedCommit?: string}} [options] - Workflow identity.
 * @returns {Promise<PreviewReleaseCandidate>} Validated local candidate.
 */
export async function loadPreviewReleaseCandidate(artifactDir, options = {}) {
  const absoluteDirectory = path.resolve(artifactDir);
  const manifestPath = path.join(absoluteDirectory, RELEASE_MANIFEST_NAME);
  const manifestBytes = await fsp.readFile(manifestPath);
  const manifest = requireObject(
    parseJson(manifestBytes.toString('utf8'), RELEASE_MANIFEST_NAME),
    RELEASE_MANIFEST_NAME,
  );

  assertExactKeys(
    manifest,
    [
      'schemaVersion',
      'kind',
      'package',
      'version',
      'tag',
      'source',
      'artifacts',
    ],
    RELEASE_MANIFEST_NAME,
  );
  if (
    manifest.schemaVersion !== 1 ||
    manifest.kind !== 'wharfie.preview-release'
  ) {
    throw new TypeError('Unsupported preview-release.json contract.');
  }
  if (manifest.package !== packageMetadata.name) {
    throw new TypeError(
      `Preview package must be exactly ${packageMetadata.name}.`,
    );
  }
  if (manifest.version !== packageMetadata.version) {
    throw new TypeError(
      `Preview version must be exactly ${packageMetadata.version}.`,
    );
  }
  parseExactReleaseVersion(manifest.version, 'Preview version');
  if (manifest.tag !== `v${manifest.version}`) {
    throw new TypeError(`Preview tag must be exactly v${manifest.version}.`);
  }
  const source = requireObject(manifest.source, 'preview source');
  assertExactKeys(source, ['repository', 'commit'], 'preview source');
  if (source.repository !== 'https://github.com/wharfie/wharfie') {
    throw new TypeError('Preview source repository is not authoritative.');
  }
  if (!/^[a-f0-9]{40}$/u.test(String(source.commit || ''))) {
    throw new TypeError('Preview source commit must be a full Git commit ID.');
  }
  if (
    options.expectedCommit !== undefined &&
    source.commit !== options.expectedCommit
  ) {
    throw new TypeError(
      `Preview source commit ${source.commit} does not match workflow commit ${options.expectedCommit}.`,
    );
  }
  if (!Array.isArray(manifest.artifacts)) {
    throw new TypeError('Preview manifest artifacts must be an array.');
  }

  /** @type {Map<string, Record<string, any>>} */
  const artifactByName = new Map();
  /** @type {Map<string, Record<string, any>>} */
  const artifactByKind = new Map();
  const expectedFileNameByKind = new Map([
    ['npm-package', `wharfie-wharfie-${manifest.version}.tgz`],
    ['npm-companion-package', `wharfie-aws-${manifest.version}.tgz`],
    ['standalone-cli', `wharfie-v${manifest.version}-linux-x64`],
    ['artifact-record', `wharfie-v${manifest.version}-linux-x64.artifact.json`],
  ]);
  const keysByKind = new Map([
    [
      'npm-package',
      [
        'fileName',
        'integrity',
        'kind',
        'package',
        'publication',
        'npmShasum',
        'sha256',
        'size',
        'version',
      ],
    ],
    [
      'npm-companion-package',
      [
        'fileName',
        'integrity',
        'kind',
        'package',
        'publication',
        'npmShasum',
        'sha256',
        'size',
        'version',
      ],
    ],
    [
      'standalone-cli',
      [
        'fileName',
        'kind',
        'sha256',
        'size',
        'target',
        'artifactId',
        'revisionId',
      ],
    ],
    ['artifact-record', ['fileName', 'kind', 'sha256', 'size', 'artifactId']],
  ]);
  for (const rawArtifact of manifest.artifacts) {
    const artifact = requireObject(rawArtifact, 'preview artifact');
    const kind = requireString(artifact.kind, 'artifact kind');
    const expectedFileName = expectedFileNameByKind.get(kind);
    const expectedKeys = keysByKind.get(kind);
    if (!expectedFileName || !expectedKeys) {
      throw new TypeError(`Unknown preview artifact kind: ${kind}`);
    }
    if (artifactByKind.has(kind)) {
      throw new TypeError(`Duplicate preview artifact kind: ${kind}`);
    }
    assertExactKeys(artifact, expectedKeys, `preview artifact ${kind}`);
    const fileName = requireString(artifact.fileName, 'artifact fileName');
    if (
      path.basename(fileName) !== fileName ||
      fileName === RELEASE_MANIFEST_NAME ||
      fileName === CHECKSUMS_NAME
    ) {
      throw new TypeError(`Unsafe preview artifact name: ${fileName}`);
    }
    if (fileName !== expectedFileName) {
      throw new TypeError(
        `Preview ${kind} filename must be exactly ${expectedFileName}.`,
      );
    }
    if (artifactByName.has(fileName)) {
      throw new TypeError(`Duplicate preview artifact name: ${fileName}`);
    }
    if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
      throw new TypeError(`Invalid preview artifact size: ${fileName}`);
    }
    if (!/^[a-f0-9]{64}$/u.test(String(artifact.sha256 || ''))) {
      throw new TypeError(`Invalid preview artifact SHA-256: ${fileName}`);
    }
    artifactByName.set(fileName, artifact);
    artifactByKind.set(kind, artifact);
  }

  if (!artifactByKind.has('npm-package')) {
    throw new TypeError('Preview manifest must contain one npm package.');
  }
  if (!artifactByKind.has('npm-companion-package')) {
    throw new TypeError(
      'Preview manifest must contain one npm companion package.',
    );
  }
  if (!artifactByKind.has('standalone-cli')) {
    throw new TypeError('Preview manifest must contain one standalone CLI.');
  }
  if (!artifactByKind.has('artifact-record')) {
    throw new TypeError('Preview manifest must contain one artifact record.');
  }
  if (manifest.artifacts.length !== 4 || artifactByKind.size !== 4) {
    throw new TypeError(
      'Preview manifest must contain exactly four artifacts.',
    );
  }

  const npmArtifact = /** @type {Record<string, any>} */ (
    artifactByKind.get('npm-package')
  );
  const companionArtifact = /** @type {Record<string, any>} */ (
    artifactByKind.get('npm-companion-package')
  );
  const standaloneArtifact = /** @type {Record<string, any>} */ (
    artifactByKind.get('standalone-cli')
  );
  const recordArtifact = /** @type {Record<string, any>} */ (
    artifactByKind.get('artifact-record')
  );
  if (
    npmArtifact.package !== manifest.package ||
    npmArtifact.version !== manifest.version ||
    npmArtifact.publication !== 'npm-preview'
  ) {
    throw new TypeError(
      'Preview npm package identity must match the release manifest.',
    );
  }
  if (
    companionArtifact.package !== '@wharfie/aws' ||
    companionArtifact.version !== manifest.version ||
    companionArtifact.publication !== 'github-release-only'
  ) {
    throw new TypeError(
      'Preview AWS companion must be an exact GitHub-release-only handoff.',
    );
  }
  for (const artifact of [npmArtifact, companionArtifact]) {
    if (!/^sha512-[A-Za-z0-9+/]+={0,2}$/u.test(String(artifact.integrity))) {
      throw new TypeError(
        'Preview npm integrity must be an SHA-512 SRI value.',
      );
    }
    if (!/^[a-f0-9]{40}$/u.test(String(artifact.npmShasum))) {
      throw new TypeError('Preview npm shasum must be an SHA-1 digest.');
    }
  }
  const artifactId = requireCanonicalId(
    standaloneArtifact.artifactId,
    'waf1',
    'Preview standalone artifactId',
  );
  const revisionId = requireCanonicalId(
    standaloneArtifact.revisionId,
    'wrv1',
    'Preview standalone revisionId',
  );
  const standaloneTarget = requireObject(
    standaloneArtifact.target,
    'Preview standalone target',
  );
  assertExactKeys(
    standaloneTarget,
    ['nodeVersion', 'platform', 'architecture', 'libc'],
    'Preview standalone target',
  );
  assertSameJson(standaloneTarget, PREVIEW_TARGET, 'Preview standalone target');
  if (recordArtifact.artifactId !== artifactId) {
    throw new TypeError(
      'Preview artifact-record identity must match the standalone CLI.',
    );
  }

  /** @type {LocalReleaseAsset[]} */
  const assets = [];
  /** @type {Map<string, Buffer>} */
  const bytesByKind = new Map();
  for (const [fileName, artifact] of artifactByName) {
    const filePath = path.join(absoluteDirectory, fileName);
    const stats = await fsp.lstat(filePath);
    if (!stats.isFile()) {
      throw new TypeError(
        `Preview artifact must be a regular file: ${fileName}`,
      );
    }
    const bytes = await fsp.readFile(filePath);
    const sha256 = digest(bytes, 'sha256', 'hex');
    if (stats.size !== artifact.size || sha256 !== artifact.sha256) {
      throw new TypeError(`Preview artifact bytes do not match: ${fileName}`);
    }
    if (
      artifact.kind === 'npm-package' ||
      artifact.kind === 'npm-companion-package'
    ) {
      const integrity = `sha512-${digest(bytes, 'sha512', 'base64')}`;
      const npmShasum = digest(bytes, 'sha1', 'hex');
      if (
        integrity !== artifact.integrity ||
        npmShasum !== artifact.npmShasum
      ) {
        throw new TypeError(
          'Preview npm package bytes do not match npm integrity metadata.',
        );
      }
    }
    bytesByKind.set(artifact.kind, bytes);
    assets.push({ name: fileName, filePath, size: stats.size, sha256 });
  }

  const standaloneBytes = /** @type {Buffer} */ (
    bytesByKind.get('standalone-cli')
  );
  const byteDigest = createHash('sha256')
    .update(standaloneBytes)
    .digest('base64url');
  if (artifactId !== `waf1_${byteDigest}`) {
    throw new TypeError(
      'Preview standalone artifactId does not name the exact executable bytes.',
    );
  }
  const recordBytes = /** @type {Buffer} */ (
    bytesByKind.get('artifact-record')
  );
  const record = requireObject(
    parseJson(recordBytes.toString('utf8'), 'Preview artifact record'),
    'Preview artifact record',
  );
  assertExactKeys(
    record,
    [
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
    ],
    'Preview artifact record',
  );
  if (record.schemaVersion !== 1 || record.kind !== 'artifactRecord') {
    throw new TypeError('Preview artifact record has an unsupported contract.');
  }
  requireCanonicalId(
    record.artifactId,
    'waf1',
    'Preview artifact record artifactId',
  );
  requireCanonicalId(
    record.revisionId,
    'wrv1',
    'Preview artifact record revisionId',
  );
  const recordDigest = requireObject(
    record.byteDigest,
    'Preview artifact record byteDigest',
  );
  assertExactKeys(
    recordDigest,
    ['algorithm', 'value'],
    'Preview artifact record byteDigest',
  );
  if (
    recordDigest.algorithm !== 'sha256' ||
    !isCanonicalSha256Base64Url(recordDigest.value)
  ) {
    throw new TypeError(
      'Preview artifact record byteDigest must be canonical SHA-256.',
    );
  }
  const recordTarget = requireObject(
    record.target,
    'Preview artifact record target',
  );
  assertExactKeys(
    recordTarget,
    ['nodeVersion', 'platform', 'architecture', 'libc'],
    'Preview artifact record target',
  );
  const format = requireObject(record.format, 'Preview artifact record format');
  assertExactKeys(
    format,
    ['kind', 'version'],
    'Preview artifact record format',
  );
  requireObject(record.provenance, 'Preview artifact record provenance');
  if (
    record.artifactId !== artifactId ||
    record.artifactId !== `waf1_${recordDigest.value}` ||
    recordDigest.value !== byteDigest ||
    record.size !== standaloneBytes.length ||
    record.appId !== 'wharfie' ||
    record.revisionId !== revisionId ||
    !sameJson(recordTarget, standaloneTarget) ||
    record.targetId !== 'node-v24.13.1-linux-x64-glibc' ||
    format.kind !== 'node-sea' ||
    format.version !== 1
  ) {
    throw new TypeError(
      'Preview artifact record does not match the exact standalone bytes, identity, revision, and target.',
    );
  }

  await assertPackedPackageContracts(
    /** @type {Buffer} */ (bytesByKind.get('npm-package')),
    /** @type {Buffer} */ (bytesByKind.get('npm-companion-package')),
    manifest.version,
  );

  const manifestSha256 = digest(manifestBytes, 'sha256', 'hex');
  assets.push({
    name: RELEASE_MANIFEST_NAME,
    filePath: manifestPath,
    size: manifestBytes.length,
    sha256: manifestSha256,
  });
  const expectedChecksums = `${[
    ...[...artifactByName.values()].map((artifact) => ({
      name: artifact.fileName,
      sha256: artifact.sha256,
    })),
    { name: RELEASE_MANIFEST_NAME, sha256: manifestSha256 },
  ]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256}  ${entry.name}`)
    .join('\n')}\n`;
  const checksumsPath = path.join(absoluteDirectory, CHECKSUMS_NAME);
  const checksumsBytes = await fsp.readFile(checksumsPath);
  if (checksumsBytes.toString('utf8') !== expectedChecksums) {
    throw new TypeError('SHA256SUMS does not match preview-release.json.');
  }
  assets.push({
    name: CHECKSUMS_NAME,
    filePath: checksumsPath,
    size: checksumsBytes.length,
    sha256: digest(checksumsBytes, 'sha256', 'hex'),
  });

  const expectedNames = new Set(assets.map((asset) => asset.name));
  const directoryEntries = await fsp.readdir(absoluteDirectory, {
    withFileTypes: true,
  });
  for (const entry of directoryEntries) {
    if (!entry.isFile() || !expectedNames.has(entry.name)) {
      throw new TypeError(
        `Unexpected preview release directory entry: ${entry.name}`,
      );
    }
  }
  if (directoryEntries.length !== expectedNames.size) {
    throw new TypeError(
      'Preview release directory is missing an expected file.',
    );
  }

  assets.sort((left, right) => left.name.localeCompare(right.name));
  return Object.freeze({
    artifactDir: absoluteDirectory,
    manifest,
    npmArtifact,
    assets,
    title: `Wharfie ${manifest.tag} preview`,
    notes:
      'Experimental Wharfie preview. Install with npm using the preview dist-tag; do not treat this as a stable release.',
  });
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @returns {Promise<Record<string, any> | null>} Existing GitHub release.
 */
async function readGithubRelease(candidate, command) {
  const result = await command('gh', [
    'api',
    '--hostname',
    CANONICAL_GITHUB_HOST,
    '--paginate',
    '--slurp',
    `repos/${REPOSITORY}/releases?per_page=100`,
  ]);
  const pages = parseJson(result.stdout, 'GitHub release inspection');
  if (!Array.isArray(pages)) {
    throw new TypeError(
      'GitHub release inspection must return paginated arrays.',
    );
  }
  /** @type {Record<string, any>[]} */
  const matches = [];
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new TypeError(
        'GitHub release inspection returned an invalid page.',
      );
    }
    for (const rawRelease of page) {
      const release = requireObject(rawRelease, 'GitHub release inspection');
      if (release.tag_name === candidate.manifest.tag) matches.push(release);
    }
  }
  if (matches.length > 1) {
    throw new TypeError(
      `GitHub returned duplicate releases for ${candidate.manifest.tag}.`,
    );
  }
  return matches[0] || null;
}

/**
 * @param {Record<string, any>} release - GitHub release response.
 * @param {PreviewReleaseCandidate} candidate - Local candidate.
 * @returns {void}
 */
function assertGithubReleaseMetadata(release, candidate) {
  if (
    release.tag_name !== candidate.manifest.tag ||
    release.name !== candidate.title ||
    release.body !== candidate.notes ||
    release.prerelease !== true ||
    typeof release.draft !== 'boolean'
  ) {
    throw new TypeError(
      `GitHub release ${candidate.manifest.tag} does not match the preview candidate.`,
    );
  }
  if (!Array.isArray(release.assets)) {
    throw new TypeError('GitHub release assets must be an array.');
  }
}

/**
 * @param {Record<string, any>} remote - GitHub release asset.
 * @param {LocalReleaseAsset} local - Local release asset.
 * @returns {void}
 */
function assertGithubAsset(remote, local) {
  if (
    remote.name !== local.name ||
    remote.state !== 'uploaded' ||
    remote.size !== local.size ||
    remote.digest !== `sha256:${local.sha256}`
  ) {
    throw new TypeError(
      `GitHub release asset does not match local bytes: ${local.name}`,
    );
  }
}

/**
 * @param {Record<string, any>} release - GitHub release response.
 * @param {PreviewReleaseCandidate} candidate - Local candidate.
 * @param {boolean} complete - Whether all exact assets are required.
 * @returns {Map<string, Record<string, any>>} Remote assets by name.
 */
function inspectGithubAssets(release, candidate, complete) {
  const localByName = new Map(
    candidate.assets.map((asset) => [asset.name, asset]),
  );
  /** @type {Map<string, Record<string, any>>} */
  const remoteByName = new Map();
  for (const rawAsset of release.assets) {
    const remote = requireObject(rawAsset, 'GitHub release asset');
    const name = requireString(remote.name, 'GitHub release asset name');
    if (remoteByName.has(name)) {
      throw new TypeError(`GitHub release has duplicate asset: ${name}`);
    }
    const local = localByName.get(name);
    if (!local) {
      throw new TypeError(`GitHub release has unexpected asset: ${name}`);
    }
    assertGithubAsset(remote, local);
    remoteByName.set(name, remote);
  }
  if (complete && remoteByName.size !== localByName.size) {
    const missing = candidate.assets
      .filter((asset) => !remoteByName.has(asset.name))
      .map((asset) => asset.name);
    throw new TypeError(
      `GitHub release is missing assets: ${missing.join(', ')}`,
    );
  }
  return remoteByName;
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @param {() => Promise<void>} beforeMutation - Fresh remote tag guard.
 * @returns {Promise<Record<string, any>>} Existing or newly created release.
 */
async function ensureGithubRelease(candidate, command, beforeMutation) {
  let release = await readGithubRelease(candidate, command);
  if (release) {
    assertGithubReleaseMetadata(release, candidate);
    return release;
  }

  /** @type {unknown} */
  let createFailure;
  await beforeMutation();
  try {
    await command('gh', [
      'release',
      'create',
      candidate.manifest.tag,
      '--repo',
      CANONICAL_GITHUB_REPOSITORY,
      '--verify-tag',
      '--draft',
      '--prerelease',
      '--latest=false',
      '--title',
      candidate.title,
      '--notes',
      candidate.notes,
    ]);
  } catch (error) {
    createFailure = error;
  }
  release = await readGithubRelease(candidate, command);
  if (!release) {
    if (createFailure) throw createFailure;
    throw new Error(
      `GitHub did not expose the draft release ${candidate.manifest.tag}.`,
    );
  }
  assertGithubReleaseMetadata(release, candidate);
  return release;
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {Record<string, any>} release - Current GitHub release.
 * @param {CommandRunner} command - Command boundary.
 * @param {() => Promise<void>} beforeMutation - Fresh remote tag guard.
 * @returns {Promise<Record<string, any>>} Release with all exact assets.
 */
async function reconcileGithubAssets(
  candidate,
  release,
  command,
  beforeMutation,
) {
  assertGithubReleaseMetadata(release, candidate);
  const existing = inspectGithubAssets(release, candidate, false);
  const missing = candidate.assets.filter((asset) => !existing.has(asset.name));
  if (missing.length > 0 && release.draft !== true) {
    inspectGithubAssets(release, candidate, true);
  }

  for (const asset of missing) {
    /** @type {unknown} */
    let uploadFailure;
    await beforeMutation();
    try {
      await command('gh', [
        'release',
        'upload',
        candidate.manifest.tag,
        asset.filePath,
        '--repo',
        CANONICAL_GITHUB_REPOSITORY,
      ]);
    } catch (error) {
      uploadFailure = error;
    }
    if (uploadFailure) {
      const observed = await readGithubRelease(candidate, command);
      if (!observed) throw uploadFailure;
      assertGithubReleaseMetadata(observed, candidate);
      const observedAssets = inspectGithubAssets(observed, candidate, false);
      if (!observedAssets.has(asset.name)) throw uploadFailure;
    }
  }

  const complete = await readGithubRelease(candidate, command);
  if (!complete) {
    throw new Error(
      `GitHub release ${candidate.manifest.tag} disappeared during reconciliation.`,
    );
  }
  assertGithubReleaseMetadata(complete, candidate);
  inspectGithubAssets(complete, candidate, true);
  return complete;
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @returns {Promise<Record<string, any> | null>} Exact npm version metadata.
 */
async function readNpmVersion(candidate, command) {
  try {
    const result = await command('npm', [
      'view',
      `${candidate.manifest.package}@${candidate.manifest.version}`,
      '--json',
      `--registry=${NPM_REGISTRY}`,
    ]);
    return requireObject(
      parseJson(result.stdout, 'npm version inspection'),
      'npm version inspection',
    );
  } catch (error) {
    if (isNpmVersionNotFound(error)) return null;
    throw error;
  }
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @param {'preview' | 'preview-candidate'} distTag - Exact dist-tag.
 * @returns {Promise<string | null>} Current dist-tag version, when present.
 */
async function readNpmDistTag(candidate, command, distTag) {
  try {
    const result = await command('npm', [
      'view',
      candidate.manifest.package,
      `dist-tags.${distTag}`,
      '--json',
      `--registry=${NPM_REGISTRY}`,
    ]);
    if (result.stdout.trim() === '') return null;
    const value = parseJson(
      result.stdout,
      `npm ${distTag} dist-tag inspection`,
    );
    if (value === null) return null;
    if (typeof value !== 'string') {
      throw new TypeError(
        `npm ${distTag} dist-tag inspection must return a version or null.`,
      );
    }
    parseCanonicalSemver(value, `npm ${distTag} dist-tag`);
    return value;
  } catch (error) {
    if (isNpmVersionNotFound(error)) return null;
    throw error;
  }
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @returns {Promise<string[]>} Canonical published version set.
 */
async function readNpmVersions(candidate, command) {
  try {
    const result = await command('npm', [
      'view',
      candidate.manifest.package,
      'versions',
      '--json',
      `--registry=${NPM_REGISTRY}`,
    ]);
    const value = parseJson(result.stdout, 'npm versions inspection');
    if (value === null) return [];
    if (!Array.isArray(value)) {
      throw new TypeError('npm versions inspection must return an array.');
    }
    const seen = new Set();
    return value.map((version, index) => {
      if (typeof version !== 'string') {
        throw new TypeError(
          `npm versions inspection entry ${index} must be a string.`,
        );
      }
      parseCanonicalSemver(version, `npm versions inspection entry ${index}`);
      if (seen.has(version)) {
        throw new TypeError(`npm versions inspection repeats ${version}.`);
      }
      seen.add(version);
      return version;
    });
  } catch (error) {
    if (isNpmVersionNotFound(error)) return [];
    throw error;
  }
}

/**
 * @param {Record<string, any>} version - npm version response.
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @returns {void}
 */
function assertNpmVersion(version, candidate) {
  const dist = requireObject(version.dist, 'npm version dist metadata');
  const attestations = requireObject(
    dist.attestations,
    'npm version attestation metadata',
  );
  const provenance = requireObject(
    attestations.provenance,
    'npm version provenance metadata',
  );
  let attestationUrl;
  try {
    attestationUrl = new URL(attestations.url);
  } catch (error) {
    throw new TypeError('npm provenance attestation URL is invalid.', {
      cause: error,
    });
  }
  const attestationPrefix = '/-/npm/v1/attestations/';
  let attestedPackage;
  try {
    attestedPackage = decodeURIComponent(
      attestationUrl.pathname.slice(attestationPrefix.length),
    );
  } catch (error) {
    throw new TypeError('npm provenance attestation path is invalid.', {
      cause: error,
    });
  }
  if (
    version.name !== candidate.manifest.package ||
    version.version !== candidate.manifest.version ||
    dist.integrity !== candidate.npmArtifact.integrity ||
    dist.shasum !== candidate.npmArtifact.npmShasum ||
    attestationUrl.protocol !== 'https:' ||
    attestationUrl.hostname !== 'registry.npmjs.org' ||
    attestationUrl.port !== '' ||
    attestationUrl.username !== '' ||
    attestationUrl.password !== '' ||
    attestationUrl.search !== '' ||
    attestationUrl.hash !== '' ||
    !attestationUrl.pathname.startsWith(attestationPrefix) ||
    attestedPackage !==
      `${candidate.manifest.package}@${candidate.manifest.version}` ||
    provenance.predicateType !== SLSA_PROVENANCE_PREDICATE
  ) {
    throw new TypeError(
      `npm ${candidate.manifest.package}@${candidate.manifest.version} does not match preview-release.json.`,
    );
  }
}

/**
 * Before any remote mutation, distinguish a new monotonic publication from an
 * exact already-published recovery state.
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {CommandRunner} command - Command boundary.
 * @param {'phase-one' | 'finalize'} mode - Exact publication phase.
 * @returns {Promise<{version: Record<string, any> | null, previewTag: string | null, quarantineTag: string | null, versions: string[]}>} Registry snapshot.
 */
async function assertNpmPublicationPreflight(candidate, command, mode) {
  const [version, previewTag, quarantineTag, versions] = await Promise.all([
    readNpmVersion(candidate, command),
    readNpmDistTag(candidate, command, PREVIEW_DIST_TAG),
    readNpmDistTag(candidate, command, QUARANTINE_DIST_TAG),
    readNpmVersions(candidate, command),
  ]);
  if (!version && mode === 'finalize') {
    return { version, previewTag, quarantineTag, versions };
  }
  const candidateVersion = parseCanonicalSemver(
    candidate.manifest.version,
    'candidate version',
  );
  if (
    previewTag !== null &&
    (!version || previewTag !== candidate.manifest.version) &&
    compareSemver(
      candidateVersion,
      parseCanonicalSemver(previewTag, 'npm preview dist-tag'),
    ) <= 0
  ) {
    throw new TypeError(
      `Preview version ${candidate.manifest.version} must be strictly newer than current preview dist-tag ${previewTag}.`,
    );
  }
  const parsedVersions = versions
    .filter((published) => !version || published !== candidate.manifest.version)
    .map((published, index) =>
      parseCanonicalSemver(published, `npm versions inspection entry ${index}`),
    );
  const maximum = parsedVersions.reduce(
    (current, published) =>
      current === null || compareSemver(published, current) > 0
        ? published
        : current,
    /** @type {ReturnType<typeof parseCanonicalSemver> | null} */ (null),
  );
  if (maximum && compareSemver(candidateVersion, maximum) <= 0) {
    throw new TypeError(
      `Preview version ${candidate.manifest.version} must be strictly newer than maximum published version ${maximum.version}.`,
    );
  }
  if (version) {
    assertNpmVersion(version, candidate);
    if (!versions.includes(candidate.manifest.version)) {
      throw new TypeError(
        'npm registry version metadata is inconsistent with the exact published version.',
      );
    }
    if (mode === 'finalize' && previewTag !== candidate.manifest.version) {
      throw new TypeError(
        `Finalize-only requires the manually promoted npm preview dist-tag to point to ${candidate.manifest.version}; received ${String(previewTag)}.`,
      );
    }
    if (
      mode === 'phase-one' &&
      previewTag !== candidate.manifest.version &&
      quarantineTag !== candidate.manifest.version
    ) {
      throw new TypeError(
        `Existing npm ${candidate.manifest.package}@${candidate.manifest.version} may be recovered only from ${QUARANTINE_DIST_TAG} quarantine or an already-promoted ${PREVIEW_DIST_TAG} dist-tag.`,
      );
    }
    return { version, previewTag, quarantineTag, versions };
  }
  return { version, previewTag, quarantineTag, versions };
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {Record<string, any>} release - Current GitHub release.
 * @param {CommandRunner} command - Command boundary.
 * @param {() => Promise<void>} beforeMutation - Fresh remote tag guard.
 * @returns {Promise<void>}
 */
async function reconcileNpm(candidate, release, command, beforeMutation) {
  let registry = await assertNpmPublicationPreflight(
    candidate,
    command,
    'phase-one',
  );
  if (registry.version) return;
  if (release.draft !== true) {
    throw new TypeError(
      `Final GitHub release ${candidate.manifest.tag} exists without its npm version.`,
    );
  }

  /** @type {unknown} */
  let publishFailure;
  const freshRegistry = await assertNpmPublicationPreflight(
    candidate,
    command,
    'phase-one',
  );
  if (freshRegistry.version) return;
  const freshRelease = await readGithubRelease(candidate, command);
  if (!freshRelease) {
    throw new TypeError(
      `GitHub release ${candidate.manifest.tag} disappeared before npm publication.`,
    );
  }
  assertGithubReleaseMetadata(freshRelease, candidate);
  inspectGithubAssets(freshRelease, candidate, true);
  if (freshRelease.draft !== true) {
    throw new TypeError(
      `Final GitHub release ${candidate.manifest.tag} exists without its npm version.`,
    );
  }
  await beforeMutation();
  try {
    await command('npm', [
      'publish',
      candidate.npmArtifact.fileName
        ? path.join(candidate.artifactDir, candidate.npmArtifact.fileName)
        : '',
      '--access=public',
      `--tag=${QUARANTINE_DIST_TAG}`,
      '--provenance',
      '--ignore-scripts',
      `--registry=${NPM_REGISTRY}`,
    ]);
  } catch (error) {
    publishFailure = error;
  }

  registry = await assertNpmPublicationPreflight(
    candidate,
    command,
    'phase-one',
  );
  if (!registry.version) {
    if (publishFailure) throw publishFailure;
    throw new Error(
      `npm publish returned success but ${candidate.manifest.package}@${candidate.manifest.version} is absent.`,
    );
  }
}

/**
 * @param {PreviewReleaseCandidate} candidate - Local release candidate.
 * @param {Record<string, any>} release - Draft or final GitHub release.
 * @param {CommandRunner} command - Command boundary.
 * @param {() => Promise<Record<string, any>>} beforeMutation - Fresh composite finalization guard.
 * @returns {Promise<Record<string, any>>} Finalized prerelease.
 */
async function finalizeGithubRelease(
  candidate,
  release,
  command,
  beforeMutation,
) {
  release = await beforeMutation();
  if (release.draft !== true) return release;
  /** @type {unknown} */
  let editFailure;
  try {
    await command('gh', [
      'release',
      'edit',
      candidate.manifest.tag,
      '--repo',
      CANONICAL_GITHUB_REPOSITORY,
      '--draft=false',
      '--prerelease',
      '--latest=false',
      '--title',
      candidate.title,
      '--notes',
      candidate.notes,
    ]);
  } catch (error) {
    editFailure = error;
  }
  const finalized = await readGithubRelease(candidate, command);
  if (!finalized) {
    if (editFailure) throw editFailure;
    throw new Error(`GitHub release ${candidate.manifest.tag} disappeared.`);
  }
  assertGithubReleaseMetadata(finalized, candidate);
  inspectGithubAssets(finalized, candidate, true);
  if (finalized.draft) {
    if (editFailure) throw editFailure;
    throw new Error(
      `GitHub release ${candidate.manifest.tag} remains a draft.`,
    );
  }
  return finalized;
}

/**
 * Converge npm and GitHub on one exact preview release.
 * @param {PreviewPublicationOptions} [options] - Publication options.
 * @param {PreviewPublicationDependencies} [dependencies] - Test seams.
 * @returns {Promise<{tag: string, version: string, published: true, finalized: boolean}>} Final state.
 */
export async function publishPreviewRelease(options = {}, dependencies = {}) {
  assertExactlyOnePublicationMode(options, 'Preview publication');
  const artifactDir = path.resolve(
    options.artifactDir || path.join('dist', 'preview-release'),
  );
  const candidate = await loadPreviewReleaseCandidate(artifactDir, {
    expectedCommit: dependencies.expectedCommit ?? process.env.GITHUB_SHA,
  });
  const authorize =
    dependencies.authorize || (() => assertPreviewPublishEnvironment());
  await authorize(candidate);
  const command = dependencies.runCommand || runCommand;
  const beforeRemoteMutation = async () =>
    await assertCanonicalSourceAuthority(candidate, command);

  /** @type {Record<string, any>} */
  let release;
  if (options.finalizeOnly === true) {
    const npmPreflight = await assertNpmPublicationPreflight(
      candidate,
      command,
      'finalize',
    );
    if (!npmPreflight.version) {
      throw new TypeError(
        `Finalize-only requires existing npm ${candidate.manifest.package}@${candidate.manifest.version}.`,
      );
    }
    const existing = await readGithubRelease(candidate, command);
    if (!existing) {
      throw new TypeError(
        `Finalize-only requires existing GitHub release ${candidate.manifest.tag}.`,
      );
    }
    assertGithubReleaseMetadata(existing, candidate);
    inspectGithubAssets(existing, candidate, true);
    release = await finalizeGithubRelease(
      candidate,
      existing,
      command,
      async () => {
        const freshRegistry = await assertNpmPublicationPreflight(
          candidate,
          command,
          'finalize',
        );
        if (!freshRegistry.version) {
          throw new TypeError(
            `Finalize-only requires existing npm ${candidate.manifest.package}@${candidate.manifest.version}.`,
          );
        }
        const freshRelease = await readGithubRelease(candidate, command);
        if (!freshRelease) {
          throw new TypeError(
            `Finalize-only requires existing GitHub release ${candidate.manifest.tag}.`,
          );
        }
        assertGithubReleaseMetadata(freshRelease, candidate);
        inspectGithubAssets(freshRelease, candidate, true);
        await beforeRemoteMutation();
        return freshRelease;
      },
    );
  } else {
    await assertNpmPublicationPreflight(candidate, command, 'phase-one');
    release = await ensureGithubRelease(
      candidate,
      command,
      beforeRemoteMutation,
    );
    release = await reconcileGithubAssets(
      candidate,
      release,
      command,
      beforeRemoteMutation,
    );
    await reconcileNpm(candidate, release, command, beforeRemoteMutation);
    await assertCanonicalSourceAuthority(candidate, command);
    const observed = await readGithubRelease(candidate, command);
    if (!observed) {
      throw new TypeError(
        `GitHub release ${candidate.manifest.tag} disappeared after npm reconciliation.`,
      );
    }
    assertGithubReleaseMetadata(observed, candidate);
    inspectGithubAssets(observed, candidate, true);
    if (observed.draft !== true) {
      const promotedRegistry = await assertNpmPublicationPreflight(
        candidate,
        command,
        'finalize',
      );
      if (!promotedRegistry.version) {
        throw new TypeError(
          `Final GitHub release ${candidate.manifest.tag} exists without its npm version.`,
        );
      }
    }
    release = observed;
  }
  const finalized = release.draft === false && release.prerelease === true;
  if (options.finalizeOnly && !finalized) {
    throw new TypeError(
      `GitHub release ${candidate.manifest.tag} is not a finalized prerelease.`,
    );
  }
  return Object.freeze({
    tag: candidate.manifest.tag,
    version: candidate.manifest.version,
    published: true,
    finalized,
  });
}

/** @param {string[]} [argv] - Command arguments. @returns {Promise<void>} */
export async function main(argv = process.argv.slice(2)) {
  const options = parsePreviewPublicationArgs(argv);
  const result = await publishPreviewRelease(options);
  process.stdout.write(
    result.finalized
      ? `Published and finalized ${result.tag} as the npm/GitHub preview.\n`
      : `Published and reconciled ${result.tag}; GitHub finalization remains deferred.\n`,
  );
}

const isDirect =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  await main();
}
