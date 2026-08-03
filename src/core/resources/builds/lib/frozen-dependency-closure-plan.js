import { createHash } from 'node:crypto';
import path from 'node:path';

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
import { cloneJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';

export const FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION = 2;
export const FROZEN_DEPENDENCY_CLOSURE_KIND = 'frozenDependencyClosure';
export const FROZEN_DEPENDENCY_CLOSURE_DIGEST_DOMAIN =
  'wharfie:frozen-dependency-closure:v2';

const NPM_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const SHA512_INTEGRITY_PATTERN = /^sha512-([A-Za-z0-9+/]+={0,2})$/;
const PLAN_KEYS = new Set([
  'schemaVersion',
  'kind',
  'activity',
  'lock',
  'target',
  'installScripts',
  'binLinks',
  'selectedOptionalFailures',
  'roots',
  'packages',
]);
const ROOT_KEYS = new Set(['name', 'version', 'location']);
const PACKAGE_KEYS = new Set([
  'location',
  'name',
  'version',
  'resolved',
  'integrity',
  'hasInstallScript',
  'manifestContract',
  'targetConstraints',
  'edges',
]);
const EDGE_KEYS = new Set(['name', 'type', 'spec', 'location', 'omission']);
const MANIFEST_CONTRACT_KEYS = new Set([
  'name',
  'version',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'targetConstraints',
  'bundleDependencies',
  'hasInstallScript',
]);
const TARGET_CONSTRAINT_KEYS = new Set(['os', 'cpu', 'libc', 'node']);
const EDGE_TYPES = new Set(['optional', 'peer', 'peerOptional', 'prod']);

/**
 * Deeply freeze one validated JSON value.
 * @param {any} value - JSON value.
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
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowed - Allowed keys.
 * @param {string} valuePath - Human-readable value path.
 * @param {Set<string>} [optional] - Optional allowed keys.
 * @returns {void}
 */
function assertExactKeys(value, allowed, valuePath, optional = new Set()) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of allowed) {
    if (
      !optional.has(key) &&
      !Object.prototype.hasOwnProperty.call(value, key)
    ) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate package name.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical npm package name.
 */
function validatePackageName(value, valuePath) {
  if (typeof value !== 'string' || !NPM_PACKAGE_NAME_PATTERN.test(value)) {
    throw new TypeError(`${valuePath} must be a canonical npm package name.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate package version.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical semantic version.
 */
function validatePackageVersion(value, valuePath) {
  if (typeof value !== 'string' || semver.valid(value) !== value) {
    throw new TypeError(`${valuePath} must be a canonical semantic version.`);
  }
  return value;
}

/**
 * Validate a canonical package-lock physical location.
 * @param {unknown} value - Candidate location.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical POSIX node_modules location.
 */
export function validateFrozenPackageLocation(value, valuePath) {
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
 * @param {unknown} value - Candidate canonical string list.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string[] | undefined} - Sorted unique list.
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
 * Apply npm's positive/negative target-list semantics.
 * @param {string | undefined} targetValue - Exact target field.
 * @param {string[] | undefined} constraints - Canonical constraints.
 * @returns {boolean} - Whether the field satisfies the constraints.
 */
function constraintListMatches(targetValue, constraints) {
  if (!constraints || constraints.length === 0) return true;
  if (constraints.length === 1 && constraints[0] === 'any') return true;
  let negated = 0;
  let match = false;
  for (const entry of constraints) {
    const negate = entry.startsWith('!');
    const test = negate ? entry.slice(1) : entry;
    if (negate) {
      negated += 1;
      if (targetValue === test) return false;
    } else {
      match = match || targetValue === test;
    }
  }
  return match || negated === constraints.length;
}

/**
 * Match normalized package target constraints against one exact build target.
 * Builders and packaged runtime validation use this same interpretation.
 * @param {Record<string, any> | undefined} constraints - Canonical target constraints.
 * @param {import('../../../runtime/build-target.js').BuildTarget} target - Exact target.
 * @returns {boolean} - Whether the package is eligible for the target.
 */
export function frozenTargetConstraintsMatch(constraints, target) {
  if (!constraints) return true;
  const targetLibc = target.platform === 'linux' ? target.libc : undefined;
  return (
    constraintListMatches(target.platform, constraints.os) &&
    constraintListMatches(target.architecture, constraints.cpu) &&
    (constraints.libc === undefined ||
      (targetLibc !== undefined &&
        constraintListMatches(targetLibc, constraints.libc))) &&
    (constraints.node === undefined ||
      semver.satisfies(target.nodeVersion, constraints.node))
  );
}

/**
 * @param {unknown} value - Candidate dependency map.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, string> | undefined} - Canonical dependency map.
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
    validatePackageName(name, `${valuePath} package name`);
    if (typeof spec !== 'string' || !spec || spec.trim() !== spec) {
      throw new TypeError(`${valuePath}.${name} must be a canonical string.`);
    }
    normalized[name] = spec;
  }
  return entries.length === 0 ? undefined : normalized;
}

/**
 * @param {unknown} value - Candidate peer metadata.
 * @param {Record<string, string> | undefined} peers - Declared peers.
 * @param {string} valuePath - Human-readable value path.
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
 * Normalize package behavior represented by lock v3 and package.json.
 * @param {Record<string, any>} manifest - Lock entry or package.json.
 * @param {string} expectedName - Exact physical package name.
 * @param {string} expectedVersion - Exact package version.
 * @param {'lock'|'package'} source - Input representation.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, any>} - Canonical manifest contract.
 */
export function normalizeFrozenPackageManifestContract(
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
 * Verify extracted package.json behavior against a validated plan entry.
 * @param {unknown} manifest - Parsed package.json.
 * @param {Readonly<Record<string, any>>} packageEntry - Planned package.
 * @returns {void}
 */
export function verifyExtractedPackageManifest(manifest, packageEntry) {
  const valuePath = `Frozen dependency '${String(packageEntry.location)}' package.json`;
  const actual = normalizeFrozenPackageManifestContract(
    /** @type {Record<string, any>} */ (manifest),
    packageEntry.name,
    packageEntry.version,
    'package',
    valuePath,
  );
  if (
    JSON.stringify(actual) !== JSON.stringify(packageEntry.manifestContract)
  ) {
    throw new Error(
      `Frozen dependency '${packageEntry.location}' package.json does not match its sealed lock manifest contract.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate registry URL.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Credential-free canonical HTTPS URL.
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
 * @param {unknown} value - Candidate SHA-512 SRI.
 * @param {string} valuePath - Human-readable value path.
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
 * Validate the full canonical closure plan used by builders and SEA runtime.
 * @param {unknown} value - Candidate plan.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Deeply frozen canonical plan.
 */
export function validateFrozenDependencyClosurePlan(
  value,
  valuePath = 'frozen dependency closure plan',
) {
  const plan = cloneJsonObject(value, valuePath);
  assertExactKeys(plan, PLAN_KEYS, valuePath);
  if (plan.schemaVersion !== FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION}.`,
    );
  }
  if (plan.kind !== FROZEN_DEPENDENCY_CLOSURE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${FROZEN_DEPENDENCY_CLOSURE_KIND}'.`,
    );
  }
  assertLogicalId(plan.activity, `${valuePath}.activity`);
  const lock = validateDependencyLockInput(plan.lock, `${valuePath}.lock`);
  const target = validateBuildTarget(plan.target, `${valuePath}.target`);
  if (
    plan.installScripts !== 'ignored' ||
    plan.binLinks !== 'not-created' ||
    plan.selectedOptionalFailures !== 'fatal'
  ) {
    throw new TypeError(
      `${valuePath} must use the closure-v1 install semantics.`,
    );
  }
  if (!Array.isArray(plan.roots) || plan.roots.length === 0) {
    throw new TypeError(`${valuePath}.roots must be a nonempty array.`);
  }
  if (!Array.isArray(plan.packages) || plan.packages.length === 0) {
    throw new TypeError(`${valuePath}.packages must be a nonempty array.`);
  }

  const roots = plan.roots.map((candidate, index) => {
    const rootPath = `${valuePath}.roots[${index}]`;
    const root = cloneJsonObject(candidate, rootPath);
    assertExactKeys(root, ROOT_KEYS, rootPath);
    return {
      name: validatePackageName(root.name, `${rootPath}.name`),
      version: validatePackageVersion(root.version, `${rootPath}.version`),
      location: validateFrozenPackageLocation(
        root.location,
        `${rootPath}.location`,
      ),
    };
  });
  for (let index = 1; index < roots.length; index += 1) {
    if (
      compareCanonicalStrings(roots[index - 1].name, roots[index].name) >= 0
    ) {
      throw new TypeError(`${valuePath}.roots must be uniquely name-sorted.`);
    }
  }

  const packages = plan.packages.map((candidate, index) => {
    const packagePath = `${valuePath}.packages[${index}]`;
    const packageEntry = cloneJsonObject(candidate, packagePath);
    assertExactKeys(
      packageEntry,
      PACKAGE_KEYS,
      packagePath,
      new Set(['targetConstraints']),
    );
    const location = validateFrozenPackageLocation(
      packageEntry.location,
      `${packagePath}.location`,
    );
    const name = validatePackageName(packageEntry.name, `${packagePath}.name`);
    const version = validatePackageVersion(
      packageEntry.version,
      `${packagePath}.version`,
    );
    const expectedSuffix = `node_modules/${name}`;
    if (
      location !== expectedSuffix &&
      !location.endsWith(`/${expectedSuffix}`)
    ) {
      throw new TypeError(
        `${packagePath}.location does not match package name '${name}'.`,
      );
    }
    if (typeof packageEntry.hasInstallScript !== 'boolean') {
      throw new TypeError(`${packagePath}.hasInstallScript must be a boolean.`);
    }

    const contractPath = `${packagePath}.manifestContract`;
    const contract = cloneJsonObject(
      packageEntry.manifestContract,
      contractPath,
    );
    assertExactKeys(
      contract,
      MANIFEST_CONTRACT_KEYS,
      contractPath,
      new Set([
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        'peerDependenciesMeta',
        'targetConstraints',
      ]),
    );
    if (
      contract.name !== name ||
      contract.version !== version ||
      contract.hasInstallScript !== packageEntry.hasInstallScript ||
      !Array.isArray(contract.bundleDependencies) ||
      contract.bundleDependencies.length !== 0
    ) {
      throw new TypeError(
        `${contractPath} does not match the planned package identity and install behavior.`,
      );
    }
    const dependencies = normalizeDependencyMap(
      contract.dependencies,
      `${contractPath}.dependencies`,
    );
    const optionalDependencies = normalizeDependencyMap(
      contract.optionalDependencies,
      `${contractPath}.optionalDependencies`,
    );
    const peerDependencies = normalizeDependencyMap(
      contract.peerDependencies,
      `${contractPath}.peerDependencies`,
    );
    const peerDependenciesMeta = normalizePeerDependenciesMeta(
      contract.peerDependenciesMeta,
      peerDependencies,
      `${contractPath}.peerDependenciesMeta`,
    );
    let targetConstraints;
    if (contract.targetConstraints !== undefined) {
      const constraintsPath = `${contractPath}.targetConstraints`;
      const constraints = cloneJsonObject(
        contract.targetConstraints,
        constraintsPath,
      );
      assertExactKeys(
        constraints,
        TARGET_CONSTRAINT_KEYS,
        constraintsPath,
        new Set(TARGET_CONSTRAINT_KEYS),
      );
      targetConstraints = sortCanonicalJsonValue({
        ...(constraints.os === undefined
          ? {}
          : {
              os: normalizeConstraintList(
                constraints.os,
                `${constraintsPath}.os`,
              ),
            }),
        ...(constraints.cpu === undefined
          ? {}
          : {
              cpu: normalizeConstraintList(
                constraints.cpu,
                `${constraintsPath}.cpu`,
              ),
            }),
        ...(constraints.libc === undefined
          ? {}
          : {
              libc: normalizeConstraintList(
                constraints.libc,
                `${constraintsPath}.libc`,
              ),
            }),
        ...(constraints.node === undefined
          ? {}
          : (() => {
              if (
                typeof constraints.node !== 'string' ||
                semver.validRange(constraints.node) === null
              ) {
                throw new TypeError(
                  `${constraintsPath}.node must be a semantic-version range.`,
                );
              }
              return { node: constraints.node };
            })()),
      });
      if (Object.keys(targetConstraints).length === 0) {
        throw new TypeError(`${constraintsPath} must not be empty.`);
      }
    }
    const canonicalContract = sortCanonicalJsonValue({
      name,
      version,
      ...(dependencies ? { dependencies } : {}),
      ...(optionalDependencies ? { optionalDependencies } : {}),
      ...(peerDependencies ? { peerDependencies } : {}),
      ...(peerDependenciesMeta ? { peerDependenciesMeta } : {}),
      ...(targetConstraints ? { targetConstraints } : {}),
      bundleDependencies: [],
      hasInstallScript: packageEntry.hasInstallScript,
    });
    if (JSON.stringify(contract) !== JSON.stringify(canonicalContract)) {
      throw new TypeError(`${contractPath} must be canonical.`);
    }
    if (!frozenTargetConstraintsMatch(targetConstraints, target)) {
      throw new TypeError(
        `${packagePath}.targetConstraints do not match the closure target.`,
      );
    }
    if (
      JSON.stringify(packageEntry.targetConstraints) !==
      JSON.stringify(targetConstraints)
    ) {
      throw new TypeError(
        `${packagePath}.targetConstraints must match its manifest contract.`,
      );
    }
    if (!Array.isArray(packageEntry.edges)) {
      throw new TypeError(`${packagePath}.edges must be an array.`);
    }
    const edges = packageEntry.edges.map((candidateEdge, edgeIndex) => {
      const edgePath = `${packagePath}.edges[${edgeIndex}]`;
      const edge = cloneJsonObject(candidateEdge, edgePath);
      assertExactKeys(edge, EDGE_KEYS, edgePath, new Set(['omission']));
      const edgeName = validatePackageName(edge.name, `${edgePath}.name`);
      if (!EDGE_TYPES.has(edge.type)) {
        throw new TypeError(`${edgePath}.type is not supported.`);
      }
      if (
        typeof edge.spec !== 'string' ||
        !edge.spec ||
        edge.spec.trim() !== edge.spec ||
        semver.validRange(edge.spec) === null
      ) {
        throw new TypeError(
          `${edgePath}.spec must be a semantic-version range.`,
        );
      }
      const edgeLocation =
        edge.location === null
          ? null
          : validateFrozenPackageLocation(
              edge.location,
              `${edgePath}.location`,
            );
      if (
        edgeLocation === null &&
        edge.type !== 'optional' &&
        edge.type !== 'peerOptional'
      ) {
        throw new TypeError(
          `${edgePath}.location may be null only for an omitted optional dependency.`,
        );
      }
      let omission;
      if (edgeLocation === null) {
        if (
          edge.omission !== 'target-incompatible' &&
          !(
            edge.type === 'peerOptional' &&
            edge.omission === 'absent-optional-peer'
          )
        ) {
          throw new TypeError(
            `${edgePath}.omission must explain why its optional dependency has no location.`,
          );
        }
        omission = edge.omission;
      } else if (edge.omission !== undefined) {
        throw new TypeError(
          `${edgePath}.omission is supported only when location is null.`,
        );
      }
      const declaredSpec =
        edge.type === 'prod'
          ? dependencies?.[edgeName]
          : edge.type === 'optional'
            ? optionalDependencies?.[edgeName]
            : peerDependencies?.[edgeName];
      if (declaredSpec !== edge.spec) {
        throw new TypeError(
          `${edgePath} does not match its package manifest contract.`,
        );
      }
      const optionalPeer = peerDependenciesMeta?.[edgeName]?.optional === true;
      if (
        (edge.type === 'peerOptional' && !optionalPeer) ||
        (edge.type === 'peer' && optionalPeer)
      ) {
        throw new TypeError(
          `${edgePath}.type does not match its peer dependency metadata.`,
        );
      }
      return {
        name: edgeName,
        type: edge.type,
        spec: edge.spec,
        location: edgeLocation,
        ...(omission ? { omission } : {}),
      };
    });
    for (let edgeIndex = 1; edgeIndex < edges.length; edgeIndex += 1) {
      const previous = `${edges[edgeIndex - 1].name}\0${edges[edgeIndex - 1].type}`;
      const current = `${edges[edgeIndex].name}\0${edges[edgeIndex].type}`;
      if (compareCanonicalStrings(previous, current) >= 0) {
        throw new TypeError(`${packagePath}.edges must be uniquely sorted.`);
      }
    }
    const expectedEdges = new Map();
    for (const [dependencyName, spec] of Object.entries(dependencies || {})) {
      expectedEdges.set(dependencyName, { type: 'prod', spec });
    }
    for (const [dependencyName, spec] of Object.entries(
      optionalDependencies || {},
    )) {
      expectedEdges.set(dependencyName, { type: 'optional', spec });
    }
    for (const [dependencyName, spec] of Object.entries(
      peerDependencies || {},
    )) {
      if (expectedEdges.has(dependencyName)) continue;
      expectedEdges.set(dependencyName, {
        type:
          peerDependenciesMeta?.[dependencyName]?.optional === true
            ? 'peerOptional'
            : 'peer',
        spec,
      });
    }
    const edgesByName = new Map();
    for (const edge of edges) {
      if (edgesByName.has(edge.name)) {
        throw new TypeError(
          `${packagePath}.edges must contain at most one edge per package name.`,
        );
      }
      edgesByName.set(edge.name, edge);
    }
    if (edgesByName.size !== expectedEdges.size) {
      throw new TypeError(
        `${packagePath}.edges must exactly cover its manifest dependency contract.`,
      );
    }
    for (const [dependencyName, expectedEdge] of expectedEdges) {
      const edge = edgesByName.get(dependencyName);
      if (
        !edge ||
        edge.type !== expectedEdge.type ||
        edge.spec !== expectedEdge.spec
      ) {
        throw new TypeError(
          `${packagePath}.edges must exactly represent manifest dependency '${dependencyName}'.`,
        );
      }
      if (
        (edge.type === 'prod' || edge.type === 'peer') &&
        edge.location === null
      ) {
        throw new TypeError(
          `${packagePath}.edges required dependency '${dependencyName}' must have a location.`,
        );
      }
    }
    return {
      location,
      name,
      version,
      resolved: validateRegistryLocator(
        packageEntry.resolved,
        `${packagePath}.resolved`,
      ),
      integrity: validateRegistryIntegrity(
        packageEntry.integrity,
        `${packagePath}.integrity`,
      ),
      hasInstallScript: packageEntry.hasInstallScript,
      manifestContract: canonicalContract,
      ...(targetConstraints ? { targetConstraints } : {}),
      edges,
    };
  });
  for (let index = 1; index < packages.length; index += 1) {
    if (
      compareCanonicalStrings(
        packages[index - 1].location,
        packages[index].location,
      ) >= 0
    ) {
      throw new TypeError(
        `${valuePath}.packages must be uniquely location-sorted.`,
      );
    }
  }

  const packagesByLocation = new Map(
    packages.map((packageEntry) => [packageEntry.location, packageEntry]),
  );
  for (const root of roots) {
    const packageEntry = packagesByLocation.get(root.location);
    if (
      !packageEntry ||
      packageEntry.name !== root.name ||
      packageEntry.version !== root.version
    ) {
      throw new TypeError(
        `${valuePath}.roots must name exact packages in the plan.`,
      );
    }
  }
  for (const packageEntry of packages) {
    for (const edge of packageEntry.edges) {
      if (edge.location === null) continue;
      const dependency = packagesByLocation.get(edge.location);
      if (
        !dependency ||
        dependency.name !== edge.name ||
        !semver.satisfies(dependency.version, edge.spec)
      ) {
        throw new TypeError(
          `${valuePath} edge '${packageEntry.location}' -> '${edge.name}' does not name an exact compatible package.`,
        );
      }
    }
  }
  const reachable = new Set(roots.map((root) => root.location));
  const queue = [...reachable];
  while (queue.length > 0) {
    const location = queue.shift();
    if (location === undefined) continue;
    const packageEntry = packagesByLocation.get(location);
    for (const edge of packageEntry?.edges || []) {
      if (edge.location !== null && !reachable.has(edge.location)) {
        reachable.add(edge.location);
        queue.push(edge.location);
      }
    }
  }
  if (reachable.size !== packages.length) {
    throw new TypeError(
      `${valuePath}.packages contains a package that is unreachable from its roots.`,
    );
  }

  return freezeJsonSnapshot(
    sortCanonicalJsonValue({
      schemaVersion: FROZEN_DEPENDENCY_CLOSURE_SCHEMA_VERSION,
      kind: FROZEN_DEPENDENCY_CLOSURE_KIND,
      activity: plan.activity,
      lock,
      target,
      installScripts: 'ignored',
      binLinks: 'not-created',
      selectedOptionalFailures: 'fatal',
      roots,
      packages,
    }),
  );
}

/**
 * Compute the canonical domain-separated digest of a strict closure plan.
 * @param {unknown} value - Candidate plan.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {import('../../../runtime/application-revision.js').Sha256Digest} - Canonical SHA-256 receipt.
 */
export function digestFrozenDependencyClosurePlan(
  value,
  valuePath = 'frozen dependency closure plan',
) {
  const plan = validateFrozenDependencyClosurePlan(value, valuePath);
  return freezeJsonSnapshot(
    validateSha256Digest(
      {
        algorithm: 'sha256',
        value: createHash('sha256')
          .update(
            `${FROZEN_DEPENDENCY_CLOSURE_DIGEST_DOMAIN}\0${JSON.stringify(plan)}`,
          )
          .digest('base64url'),
      },
      `${valuePath} digest`,
    ),
  );
}

export default validateFrozenDependencyClosurePlan;
