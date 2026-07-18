/* eslint-disable jsdoc/valid-types -- Arborist's runtime graph types are not published as stable TypeScript declarations. */

import { constants as fsConstants } from 'node:fs';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// eslint-disable-next-line import/no-named-as-default
import Arborist from '@npmcli/arborist';
import semver from 'semver';

import {
  validateDependencyLockInput,
  validateSha256Digest,
} from '../../../runtime/application-revision.js';
import { validateBuildTarget } from '../../../runtime/build-target.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from '../../../runtime/canonical-order.js';
import { sha256Base64Url } from '../../../runtime/content-id.js';
import { cloneJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import {
  FROZEN_DEPENDENCY_CLOSURE_DIGEST_DOMAIN,
  FROZEN_DEPENDENCY_CLOSURE_KIND,
  FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION,
  digestFrozenDependencyClosurePlan,
  frozenTargetConstraintsMatch,
  validateFrozenDependencyClosurePlan,
} from './frozen-dependency-closure-plan.js';

export {
  FROZEN_DEPENDENCY_CLOSURE_DIGEST_DOMAIN,
  FROZEN_DEPENDENCY_CLOSURE_KIND,
  FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION,
};

const SUPPORTED_EDGE_TYPES = new Set([
  'optional',
  'peer',
  'peerOptional',
  'prod',
]);
const NPM_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SHA512_INTEGRITY_PATTERN = /^sha512-([A-Za-z0-9+/]+={0,2})$/;

/**
 * @typedef DependencyLockHandle
 * @property {string} path - Sealed package-lock path.
 * @property {import('../../../runtime/application-revision.js').LockedInputDescriptor} input - Owning revision descriptor.
 */

/**
 * @typedef ExternalDependency
 * @property {string} name - Exact npm package name.
 * @property {string} version - Exact semantic version.
 */

/**
 * @typedef FrozenDependencyClosureResult
 * @property {Readonly<Record<string, any>>} plan - Canonical target/activity closure plan.
 * @property {import('../../../runtime/application-revision.js').Sha256Digest} digest - Domain-separated plan digest.
 */

/**
 * Deeply freeze one validated JSON value.
 * @param {any} value - JSON-compatible value.
 * @returns {any} - Same value, recursively frozen.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * @param {import('node:fs').BigIntStats} left - First file snapshot.
 * @param {import('node:fs').BigIntStats} right - Second file snapshot.
 * @returns {boolean} - Whether both snapshots name unchanged bytes.
 */
function hasStableFileIdentity(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}

/**
 * Read one regular file twice through the same non-symlink descriptor.
 * @param {string} filePath - File to consume.
 * @param {string} valuePath - Human-readable label.
 * @returns {Promise<Buffer>} - Stable exact bytes.
 */
async function readStableRegularFile(filePath, valuePath) {
  const noFollow =
    typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0;
  /** @type {import('node:fs/promises').FileHandle} */
  let handle;
  try {
    handle = await open(filePath, fsConstants.O_RDONLY | noFollow);
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new TypeError(
      `${valuePath} must be a readable non-symbolic file.${detail}`,
    );
  }

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new TypeError(`${valuePath} must be a regular file.`);
    }
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TypeError(`${valuePath} is too large to consume safely.`);
    }
    const size = Number(before.size);

    /** @returns {Promise<Buffer>} One exact descriptor read. */
    async function readPass() {
      const bytes = Buffer.allocUnsafe(size);
      let offset = 0;
      while (offset < size) {
        const result = await handle.read(bytes, offset, size - offset, offset);
        if (result.bytesRead === 0) {
          throw new Error(`${valuePath} changed while it was being read.`);
        }
        offset += result.bytesRead;
      }
      return bytes;
    }

    const first = await readPass();
    const second = await readPass();
    if (!first.equals(second)) {
      throw new Error(`${valuePath} changed while it was being read.`);
    }
    const after = await handle.stat({ bigint: true });
    if (!hasStableFileIdentity(before, after)) {
      throw new Error(`${valuePath} changed while it was being read.`);
    }
    return first;
  } finally {
    await handle.close();
  }
}

/**
 * Validate and consume the exact sealed npm lock named by a revision.
 * @param {unknown} value - Internal dependency-lock handle.
 * @returns {Promise<{ handle: DependencyLockHandle, lock: Record<string, any>, canonicalText: string }>} - Exact parsed lock.
 */
async function consumeDependencyLock(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('dependencyLock must be a sealed lock handle.');
  }
  const candidate = /** @type {Record<string, any>} */ (value);
  for (const key of Object.keys(candidate)) {
    if (key !== 'path' && key !== 'input') {
      throw new TypeError(`dependencyLock.${key} is not supported.`);
    }
  }
  if (
    typeof candidate.path !== 'string' ||
    !candidate.path ||
    !path.isAbsolute(candidate.path)
  ) {
    throw new TypeError('dependencyLock.path must be an absolute file path.');
  }
  const input = validateDependencyLockInput(
    candidate.input,
    'dependencyLock.input',
  );
  const bytes = await readStableRegularFile(
    candidate.path,
    'dependencyLock.path',
  );

  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new TypeError('dependencyLock.path must contain valid JSON.');
  }
  const lock = cloneJsonObject(parsed, 'dependency lock');
  if (lock.lockfileVersion !== 3) {
    throw new TypeError(
      'dependency lock.lockfileVersion must be the integer 3.',
    );
  }
  if (
    !lock.packages ||
    typeof lock.packages !== 'object' ||
    Array.isArray(lock.packages)
  ) {
    throw new TypeError('dependency lock.packages must be an object.');
  }
  const canonicalText = JSON.stringify(sortCanonicalJsonValue(lock));
  const actualDigest = validateSha256Digest(
    {
      algorithm: 'sha256',
      value: sha256Base64Url(canonicalText),
    },
    'dependency lock digest',
  );
  if (
    actualDigest.algorithm !== input.digest.algorithm ||
    actualDigest.value !== input.digest.value
  ) {
    throw new Error(
      'dependencyLock.path does not match the owning application revision dependency digest.',
    );
  }

  return {
    handle: { path: candidate.path, input },
    lock,
    canonicalText,
  };
}

/**
 * Normalize npm os/cpu/libc constraint arrays for canonical plans.
 * @param {unknown} value - Candidate list.
 * @param {string} valuePath - Human-readable path.
 * @returns {string[] | undefined} - Sorted unique constraints.
 */
function normalizeConstraintList(value, valuePath) {
  if (value === undefined) return undefined;
  const entries = typeof value === 'string' ? [value] : value;
  if (!Array.isArray(entries)) {
    throw new TypeError(`${valuePath} must be a string or string array.`);
  }
  const normalized = entries.map((entry, index) => {
    if (typeof entry !== 'string' || !entry || entry.trim() !== entry) {
      throw new TypeError(
        `${valuePath}[${index}] must be a nonempty canonical string.`,
      );
    }
    return entry;
  });
  normalized.sort(compareCanonicalStrings);
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1] === normalized[index]) {
      throw new TypeError(`${valuePath} must not contain duplicates.`);
    }
  }
  return normalized;
}

/**
 * @param {any} node - Arborist virtual node.
 * @param {import('../../../runtime/build-target.js').BuildTarget} target - Canonical target.
 * @returns {boolean} - Whether one locked package applies to the target.
 */
function packageMatchesTarget(node, target) {
  const osConstraints = normalizeConstraintList(
    node.package?.os,
    `${node.location}.os`,
  );
  const cpuConstraints = normalizeConstraintList(
    node.package?.cpu,
    `${node.location}.cpu`,
  );
  const libcConstraints = normalizeConstraintList(
    node.package?.libc,
    `${node.location}.libc`,
  );
  const nodeRange = node.package?.engines?.node;
  if (
    nodeRange !== undefined &&
    (typeof nodeRange !== 'string' ||
      !nodeRange ||
      nodeRange.trim() !== nodeRange ||
      semver.validRange(nodeRange) === null)
  ) {
    throw new TypeError(
      `${node.location}.engines.node must be a canonical semantic-version range.`,
    );
  }
  return frozenTargetConstraintsMatch(
    {
      ...(osConstraints ? { os: osConstraints } : {}),
      ...(cpuConstraints ? { cpu: cpuConstraints } : {}),
      ...(libcConstraints ? { libc: libcConstraints } : {}),
      ...(nodeRange ? { node: nodeRange } : {}),
    },
    target,
  );
}

/**
 * Normalize one package-name keyed string map preserved by lockfile v3.
 * Empty maps are equivalent to omission because npm omits them when writing a
 * lock.
 * @param {unknown} value - Candidate dependency map.
 * @param {string} valuePath - Human-readable path.
 * @returns {Record<string, string> | undefined} - Canonical map.
 */
function normalizeDependencyMap(value, valuePath) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  /** @type {Record<string, string>} */
  const normalized = {};
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareCanonicalStrings(left, right),
  );
  for (const [name, spec] of entries) {
    if (!NPM_PACKAGE_NAME_PATTERN.test(name)) {
      throw new TypeError(
        `${valuePath} contains invalid package name '${name}'.`,
      );
    }
    if (typeof spec !== 'string' || !spec || spec.trim() !== spec) {
      throw new TypeError(`${valuePath}.${name} must be a canonical string.`);
    }
    normalized[name] = spec;
  }
  return entries.length === 0 ? undefined : normalized;
}

/**
 * Normalize peer metadata exactly as lockfile v3 preserves it.
 * @param {unknown} value - Candidate peer metadata.
 * @param {Record<string, string> | undefined} peers - Canonical peer map.
 * @param {string} valuePath - Human-readable path.
 * @returns {Record<string, {optional?: boolean}> | undefined} - Canonical metadata.
 */
function normalizePeerDependenciesMeta(value, peers, valuePath) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  /** @type {Record<string, {optional?: boolean}>} */
  const normalized = {};
  const entries = Object.entries(value).sort(([left], [right]) =>
    compareCanonicalStrings(left, right),
  );
  for (const [name, metadata] of entries) {
    if (!NPM_PACKAGE_NAME_PATTERN.test(name) || !peers?.[name]) {
      throw new TypeError(
        `${valuePath}.${name} must name a declared peer dependency.`,
      );
    }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new TypeError(`${valuePath}.${name} must be an object.`);
    }
    const keys = Object.keys(metadata);
    if (keys.some((key) => key !== 'optional')) {
      throw new TypeError(
        `${valuePath}.${name} supports only the 'optional' property.`,
      );
    }
    const optional = /** @type {Record<string, any>} */ (metadata).optional;
    if (optional !== undefined && typeof optional !== 'boolean') {
      throw new TypeError(`${valuePath}.${name}.optional must be a boolean.`);
    }
    normalized[name] = optional === undefined ? {} : { optional };
  }
  return entries.length === 0 ? undefined : normalized;
}

/**
 * Normalize the subset of package metadata that lockfile v3 preserves and
 * that can change dependency or target behavior.
 * @param {Record<string, any>} manifest - Lock entry or extracted package.json.
 * @param {string} expectedName - Physical package name.
 * @param {string} expectedVersion - Exact package version.
 * @param {'lock'|'package'} source - Metadata representation.
 * @param {string} valuePath - Human-readable path.
 * @returns {Record<string, any>} - Canonical contract.
 */
function normalizePackageManifestContract(
  manifest,
  expectedName,
  expectedVersion,
  source,
  valuePath,
) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  const name =
    source === 'lock' && manifest.name === undefined
      ? expectedName
      : manifest.name;
  if (name !== expectedName || manifest.version !== expectedVersion) {
    throw new TypeError(
      `${valuePath} must identify ${expectedName}@${expectedVersion}.`,
    );
  }

  const dependencies = normalizeDependencyMap(
    manifest.dependencies,
    `${valuePath}.dependencies`,
  );
  const optionalDependencies = normalizeDependencyMap(
    manifest.optionalDependencies,
    `${valuePath}.optionalDependencies`,
  );
  const peerDependencies = normalizeDependencyMap(
    manifest.peerDependencies,
    `${valuePath}.peerDependencies`,
  );
  const peerDependenciesMeta = normalizePeerDependenciesMeta(
    manifest.peerDependenciesMeta,
    peerDependencies,
    `${valuePath}.peerDependenciesMeta`,
  );

  /** @type {Record<string, any>} */
  const targetConstraints = {
    ...(manifest.os === undefined
      ? {}
      : { os: normalizeConstraintList(manifest.os, `${valuePath}.os`) }),
    ...(manifest.cpu === undefined
      ? {}
      : { cpu: normalizeConstraintList(manifest.cpu, `${valuePath}.cpu`) }),
    ...(manifest.libc === undefined
      ? {}
      : {
          libc: normalizeConstraintList(manifest.libc, `${valuePath}.libc`),
        }),
  };
  if (manifest.engines !== undefined) {
    if (
      !manifest.engines ||
      typeof manifest.engines !== 'object' ||
      Array.isArray(manifest.engines)
    ) {
      throw new TypeError(`${valuePath}.engines must be an object.`);
    }
    if (manifest.engines.node !== undefined) {
      if (
        typeof manifest.engines.node !== 'string' ||
        !manifest.engines.node ||
        manifest.engines.node.trim() !== manifest.engines.node ||
        semver.validRange(manifest.engines.node) === null
      ) {
        throw new TypeError(
          `${valuePath}.engines.node must be a canonical semantic-version range.`,
        );
      }
      targetConstraints.node = manifest.engines.node;
    }
  }

  for (const key of ['bundleDependencies', 'bundledDependencies']) {
    const bundled = manifest[key];
    if (
      bundled !== undefined &&
      bundled !== false &&
      (!Array.isArray(bundled) || bundled.length !== 0)
    ) {
      throw new TypeError(
        `${valuePath}.${key} must be absent, false, or an empty array; bundled dependencies are unsupported.`,
      );
    }
  }

  let hasInstallScript;
  if (source === 'lock') {
    if (
      manifest.hasInstallScript !== undefined &&
      typeof manifest.hasInstallScript !== 'boolean'
    ) {
      throw new TypeError(`${valuePath}.hasInstallScript must be a boolean.`);
    }
    hasInstallScript = manifest.hasInstallScript === true;
  } else {
    if (
      manifest.scripts !== undefined &&
      (!manifest.scripts ||
        typeof manifest.scripts !== 'object' ||
        Array.isArray(manifest.scripts))
    ) {
      throw new TypeError(`${valuePath}.scripts must be an object.`);
    }
    const scripts = manifest.scripts || {};
    for (const key of ['preinstall', 'install', 'postinstall']) {
      if (scripts[key] !== undefined && typeof scripts[key] !== 'string') {
        throw new TypeError(`${valuePath}.scripts.${key} must be a string.`);
      }
    }
    hasInstallScript = Boolean(
      scripts.preinstall || scripts.install || scripts.postinstall,
    );
  }

  return sortCanonicalJsonValue({
    name: expectedName,
    version: expectedVersion,
    ...(dependencies ? { dependencies } : {}),
    ...(optionalDependencies ? { optionalDependencies } : {}),
    ...(peerDependencies ? { peerDependencies } : {}),
    ...(peerDependenciesMeta ? { peerDependenciesMeta } : {}),
    ...(Object.keys(targetConstraints).length > 0 ? { targetConstraints } : {}),
    bundleDependencies: [],
    hasInstallScript,
  });
}

/**
 * Verify extracted package.json behavior against the exact sealed-lock
 * contract embedded in a closure plan.
 * @param {unknown} manifest - Parsed extracted package.json.
 * @param {Readonly<Record<string, any>>} packageEntry - Planned package.
 * @returns {void}
 */
export function verifyExtractedPackageManifest(manifest, packageEntry) {
  const valuePath = `Frozen dependency '${String(packageEntry.location)}' package.json`;
  const actual = normalizePackageManifestContract(
    /** @type {Record<string, any>} */ (manifest),
    packageEntry.name,
    packageEntry.version,
    'package',
    valuePath,
  );
  const expected = packageEntry.manifestContract;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Frozen dependency '${packageEntry.location}' package.json does not match its sealed lock manifest contract.`,
    );
  }
}

/**
 * Validate a canonical package location beneath node_modules.
 * @param {unknown} value - Candidate Arborist location.
 * @param {string} valuePath - Human-readable path.
 * @returns {string} - Canonical POSIX lock location.
 */
function validatePackageLocation(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('node_modules/') ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.normalize(value) !== value ||
    value.split('/').includes('..')
  ) {
    throw new TypeError(
      `${valuePath} must be a canonical package-lock node_modules location.`,
    );
  }
  return value;
}

/**
 * Require one canonical immutable sha512 registry SRI value.
 * @param {unknown} value - Candidate integrity string.
 * @param {string} valuePath - Human-readable path.
 * @returns {string} - Canonical SRI.
 */
function validateRegistryIntegrity(value, valuePath) {
  if (typeof value !== 'string') {
    throw new TypeError(`${valuePath} must be a sha512 SRI string.`);
  }
  const match = value.match(SHA512_INTEGRITY_PATTERN);
  if (!match) {
    throw new TypeError(`${valuePath} must be one canonical sha512 SRI.`);
  }
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== match[1]) {
    throw new TypeError(`${valuePath} must encode exactly 64 SHA-512 bytes.`);
  }
  return value;
}

/**
 * Require an immutable credential-free HTTPS tarball locator.
 * @param {unknown} value - Candidate resolved locator.
 * @param {string} valuePath - Human-readable path.
 * @returns {string} - Validated URL text.
 */
function validateRegistryLocator(value, valuePath) {
  if (typeof value !== 'string' || !value || value.trim() !== value) {
    throw new TypeError(`${valuePath} must be a canonical HTTPS URL.`);
  }
  let locator;
  try {
    locator = new URL(value);
  } catch {
    throw new TypeError(`${valuePath} must be a canonical HTTPS URL.`);
  }
  if (
    locator.protocol !== 'https:' ||
    locator.username ||
    locator.password ||
    locator.search ||
    locator.hash ||
    locator.href !== value
  ) {
    throw new TypeError(
      `${valuePath} must be a credential-free canonical HTTPS URL.`,
    );
  }
  return value;
}

/**
 * Validate one registry-backed virtual package and build its stable fields.
 * @param {any} node - Arborist virtual node.
 * @param {Record<string, any>} lockedPackage - Exact lockfile package entry.
 * @returns {Record<string, any>} - Canonical package plan fields.
 */
function describeLockedPackage(node, lockedPackage) {
  const location = validatePackageLocation(
    node.location,
    'locked package location',
  );
  if (node.isLink) {
    throw new TypeError(
      `Locked package '${location}' is a link; workspace, file, and linked externals are not supported.`,
    );
  }
  if (node.inBundle) {
    throw new TypeError(
      `Locked package '${location}' is bundled inside another package and cannot be independently verified.`,
    );
  }
  const bundled =
    node.package?.bundleDependencies ?? node.package?.bundledDependencies;
  if (bundled === true || (Array.isArray(bundled) && bundled.length > 0)) {
    throw new TypeError(
      `Locked package '${location}' contains bundled dependencies, which closure v1 does not support.`,
    );
  }
  if (
    typeof node.name !== 'string' ||
    !node.name ||
    node.name.trim() !== node.name ||
    !NPM_PACKAGE_NAME_PATTERN.test(node.name) ||
    typeof node.version !== 'string' ||
    !node.version ||
    node.version.trim() !== node.version ||
    semver.valid(node.version) !== node.version
  ) {
    throw new TypeError(
      `Locked package '${location}' must have canonical name and version strings.`,
    );
  }
  const packageName = node.packageName || node.package?.name || node.name;
  if (packageName !== node.name) {
    throw new TypeError(
      `Locked package '${location}' is an npm alias; closure v1 requires package and installed names to match.`,
    );
  }
  const expectedLocationSuffix = `node_modules/${node.name}`;
  if (
    location !== expectedLocationSuffix &&
    !location.endsWith(`/${expectedLocationSuffix}`)
  ) {
    throw new TypeError(
      `Locked package '${location}' does not match package name '${node.name}'.`,
    );
  }

  const manifestContract = normalizePackageManifestContract(
    lockedPackage,
    node.name,
    node.version,
    'lock',
    `${location} lock entry`,
  );

  return {
    location,
    name: node.name,
    version: node.version,
    resolved: validateRegistryLocator(node.resolved, `${location}.resolved`),
    integrity: validateRegistryIntegrity(
      node.integrity,
      `${location}.integrity`,
    ),
    hasInstallScript: manifestContract.hasInstallScript,
    manifestContract,
    ...(manifestContract.targetConstraints
      ? { targetConstraints: manifestContract.targetConstraints }
      : {}),
  };
}

/**
 * Validate exact unique external roots.
 * @param {unknown} value - Candidate external list.
 * @returns {ExternalDependency[]} - Canonically ordered roots.
 */
function validateExternals(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('externals must be a nonempty array.');
  }
  const externals = value.map((entry, index) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.name !== 'string' ||
      !entry.name ||
      entry.name.trim() !== entry.name ||
      !NPM_PACKAGE_NAME_PATTERN.test(entry.name) ||
      typeof entry.version !== 'string' ||
      !entry.version ||
      entry.version.trim() !== entry.version ||
      semver.valid(entry.version) !== entry.version
    ) {
      throw new TypeError(
        `externals[${index}] must have canonical name and version strings.`,
      );
    }
    return { name: entry.name, version: entry.version };
  });
  externals.sort((left, right) =>
    compareCanonicalStrings(left.name, right.name),
  );
  for (let index = 1; index < externals.length; index += 1) {
    if (externals[index - 1].name === externals[index].name) {
      throw new TypeError(
        `External package '${externals[index].name}' is declared more than once.`,
      );
    }
  }
  return externals;
}

/**
 * Resolve one virtual tree from a private exact copy of already-validated lock
 * bytes. Arborist is used only for npm's locked physical layout and peer-edge
 * semantics; no ideal-tree or metadata resolution is permitted here.
 * @param {string} canonicalLockText - Exact canonical package lock.
 * @returns {Promise<any>} - Arborist virtual root.
 */
async function loadExactVirtualTree(canonicalLockText) {
  const workspace = await mkdtemp(
    path.join(os.tmpdir(), 'wharfie-frozen-lock-'),
  );
  try {
    await writeFile(
      path.join(workspace, 'package-lock.json'),
      `${canonicalLockText}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    const arborist = new Arborist({ path: workspace });
    return await arborist.loadVirtual();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/**
 * Create one canonical physical npm closure from an exact sealed lock.
 * @param {{
 *   activity: string,
 *   buildTarget: unknown,
 *   dependencyLock: unknown,
 *   externals: unknown
 * }} options - Closure inputs.
 * @returns {Promise<FrozenDependencyClosureResult>} - Frozen plan and digest.
 */
export async function createFrozenDependencyClosurePlan(options) {
  assertLogicalId(options?.activity, 'activity');
  const target = validateBuildTarget(options.buildTarget, 'buildTarget');
  const externals = validateExternals(options.externals);
  const consumed = await consumeDependencyLock(options.dependencyLock);
  const tree = await loadExactVirtualTree(consumed.canonicalText);

  /** @type {Array<{name: string, version: string, location: string}>} */
  const roots = [];
  /** @type {any[]} */
  const queue = [];

  for (const external of externals) {
    const edge = tree.edgesOut.get(external.name);
    if (!edge || (edge.type !== 'prod' && edge.type !== 'optional')) {
      throw new Error(
        `External '${external.name}' must be a root production or optional dependency in the frozen lock.`,
      );
    }
    if (!edge.to || edge.valid !== true) {
      throw new Error(
        `External '${external.name}' does not resolve to one valid frozen lock node.`,
      );
    }
    if (
      semver.validRange(edge.spec) === null ||
      edge.to.name !== external.name
    ) {
      throw new Error(
        `External '${external.name}' must resolve from a registry semantic-version edge without an npm alias.`,
      );
    }
    if (edge.to.version !== external.version) {
      throw new Error(
        `External '${external.name}' is pinned to ${external.version}, but the frozen root resolves ${edge.to.version}.`,
      );
    }
    if (!packageMatchesTarget(edge.to, target)) {
      throw new Error(
        `External '${external.name}' does not support target ${target.platform}/${target.architecture}.`,
      );
    }
    const location = validatePackageLocation(
      edge.to.location,
      `External '${external.name}' location`,
    );
    roots.push({
      name: external.name,
      version: external.version,
      location,
    });
    queue.push(edge.to);
  }

  /** @type {Map<string, Record<string, any>>} */
  const packagesByLocation = new Map();
  while (queue.length > 0) {
    const node = queue.shift();
    const location = validatePackageLocation(
      node.location,
      'locked package location',
    );
    if (packagesByLocation.has(location)) continue;
    if (!packageMatchesTarget(node, target)) {
      throw new Error(
        `Required locked package '${location}' does not support target ${target.platform}/${target.architecture}.`,
      );
    }

    const lockedPackage = consumed.lock.packages[location];
    if (
      !lockedPackage ||
      typeof lockedPackage !== 'object' ||
      Array.isArray(lockedPackage)
    ) {
      throw new TypeError(
        `Locked package '${location}' must have one package-lock entry.`,
      );
    }
    const packageDescription = describeLockedPackage(node, lockedPackage);
    /** @type {Record<string, any>[]} */
    const edges = [];
    const outgoing = Array.from(node.edgesOut.values()).sort((left, right) =>
      compareCanonicalStrings(
        `${left.name}\0${left.type}`,
        `${right.name}\0${right.type}`,
      ),
    );
    for (const edge of outgoing) {
      if (edge.type === 'dev') continue;
      if (!SUPPORTED_EDGE_TYPES.has(edge.type)) {
        throw new Error(
          `Locked package '${location}' has unsupported '${edge.type}' edge '${edge.name}'.`,
        );
      }
      const isOptional =
        edge.type === 'optional' || edge.type === 'peerOptional';
      if (
        typeof edge.spec !== 'string' ||
        semver.validRange(edge.spec) === null
      ) {
        throw new Error(
          `Locked package '${location}' has non-registry ${edge.type} dependency '${edge.name}'.`,
        );
      }
      if (!edge.to) {
        if (edge.type === 'peerOptional') {
          edges.push({
            name: edge.name,
            type: edge.type,
            spec: edge.spec,
            location: null,
            omission: 'absent-optional-peer',
          });
          continue;
        }
        throw new Error(
          `Locked package '${location}' is missing ${edge.type} dependency '${edge.name}'.`,
        );
      }
      if (edge.to.name !== edge.name) {
        throw new Error(
          `Locked package '${location}' has non-registry or aliased ${edge.type} dependency '${edge.name}'.`,
        );
      }
      if (edge.valid !== true) {
        throw new Error(
          `Locked package '${location}' has invalid ${edge.type} dependency '${edge.name}' (${edge.spec}).`,
        );
      }
      if (!packageMatchesTarget(edge.to, target)) {
        if (isOptional) {
          edges.push({
            name: edge.name,
            type: edge.type,
            spec: edge.spec,
            location: null,
            omission: 'target-incompatible',
          });
          continue;
        }
        throw new Error(
          `Locked package '${location}' requires '${edge.name}', which does not support target ${target.platform}/${target.architecture}.`,
        );
      }
      const dependencyLocation = validatePackageLocation(
        edge.to.location,
        `Locked dependency '${edge.name}' location`,
      );
      edges.push({
        name: edge.name,
        type: edge.type,
        spec: edge.spec,
        location: dependencyLocation,
      });
      queue.push(edge.to);
    }
    packageDescription.edges = edges;
    packagesByLocation.set(location, packageDescription);
  }

  const packages = Array.from(packagesByLocation.values()).sort((left, right) =>
    compareCanonicalStrings(left.location, right.location),
  );
  const plan = validateFrozenDependencyClosurePlan(
    sortCanonicalJsonValue({
      schemaVersion: FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION,
      kind: FROZEN_DEPENDENCY_CLOSURE_KIND,
      activity: options.activity,
      lock: consumed.handle.input,
      target,
      installScripts: 'ignored',
      binLinks: 'not-created',
      selectedOptionalFailures: 'fatal',
      roots,
      packages,
    }),
    'frozen dependency closure plan',
  );
  const digest = digestFrozenDependencyClosurePlan(plan);

  return {
    plan: freezeJsonSnapshot(plan),
    digest: freezeJsonSnapshot(digest),
  };
}

export default createFrozenDependencyClosurePlan;
