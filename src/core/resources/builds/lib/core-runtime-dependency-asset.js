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

export const CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION = 1;
export const CORE_RUNTIME_DEPENDENCY_ASSET_KIND =
  'coreRuntimeDependencyClosure';
export const CORE_RUNTIME_DEPENDENCY_ASSET_PREFIX =
  '<WHARFIE_CORE>/dependencies/';
export const CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME = `${CORE_RUNTIME_DEPENDENCY_ASSET_PREFIX}v1/manifest.json`;
export const CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME = `${CORE_RUNTIME_DEPENDENCY_ASSET_PREFIX}v1/local-control-store.tgz`;
export const CORE_RUNTIME_DEPENDENCY_PURPOSE = 'localControlStore';
export const CORE_RUNTIME_DEPENDENCY_ROOT = Object.freeze({
  name: 'lmdb',
  version: '3.4.4',
});

/**
 * Validate a target against the runtime security boundary of the first core
 * native closure. Windows needs an ACL/reparse-point design rather than the
 * POSIX mode/realpath checks used by the current fresh extraction root, so
 * emitting an artifact that fails during bootstrap would be misleading.
 * @param {unknown} value - Candidate target.
 * @param {string} [valuePath] - Human-readable target label.
 * @returns {import('../../../runtime/build-target.js').BuildTarget} - Supported exact target.
 */
export function assertCoreRuntimeDependencyTargetSupported(
  value,
  valuePath = 'core runtime dependency target',
) {
  const target = validateBuildTarget(value, valuePath);
  if (target.platform === 'win32') {
    throw new Error(
      'Windows SEA targets are deferred until private core-runtime extraction is hardened and tested with Windows ACL and reparse-point semantics.',
    );
  }
  return target;
}

const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'kind',
  'purpose',
  'target',
  'roots',
  'dependencyLockInput',
  'closureDigest',
  'archive',
]);
const ARCHIVE_KEYS = new Set(['assetName', 'digest']);
const ROOT_KEYS = new Set(['name', 'version']);
const NPM_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * @typedef CoreRuntimeDependencyRoot
 * @property {string} name - Exact npm package name.
 * @property {string} version - Exact npm package version.
 */

/**
 * @typedef CoreRuntimeDependencyManifest
 * @property {1} schemaVersion - Strict document schema version.
 * @property {'coreRuntimeDependencyClosure'} kind - Fixed document kind.
 * @property {'localControlStore'} purpose - Fixed runtime use.
 * @property {import('../../../runtime/build-target.js').BuildTarget} target - Exact target.
 * @property {CoreRuntimeDependencyRoot[]} roots - Exact root packages.
 * @property {import('../../../runtime/application-revision.js').LockedInputDescriptor} dependencyLockInput - Core-owned frozen lock receipt.
 * @property {import('../../../runtime/application-revision.js').Sha256Digest} closureDigest - Target-specific semantic closure receipt.
 * @property {{assetName: string, digest: import('../../../runtime/application-revision.js').Sha256Digest}} archive - Exact SEA archive asset receipt.
 */

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact allowed keys.
 * @param {string} valuePath - Human-readable document path.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * Validate the fixed core runtime native-dependency asset receipt.
 *
 * Unlike app activity archives, this closure is owned by Wharfie's shipped
 * runtime lock rather than the application's dependency lock. Keeping it in
 * a dedicated strict document prevents an application dependency declaration
 * from silently controlling the durable local control store.
 * @param {unknown} value - Candidate manifest.
 * @param {string} [valuePath] - Human-readable document path.
 * @returns {CoreRuntimeDependencyManifest} - Independently cloned receipt.
 */
export function validateCoreRuntimeDependencyManifest(
  value,
  valuePath = 'core runtime dependency manifest',
) {
  const manifest = cloneJsonObject(value, valuePath);
  assertExactKeys(manifest, MANIFEST_KEYS, valuePath);
  if (manifest.schemaVersion !== CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION}.`,
    );
  }
  if (manifest.kind !== CORE_RUNTIME_DEPENDENCY_ASSET_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${CORE_RUNTIME_DEPENDENCY_ASSET_KIND}'.`,
    );
  }
  if (manifest.purpose !== CORE_RUNTIME_DEPENDENCY_PURPOSE) {
    throw new TypeError(
      `${valuePath}.purpose must be '${CORE_RUNTIME_DEPENDENCY_PURPOSE}'.`,
    );
  }
  if (!Array.isArray(manifest.roots) || manifest.roots.length === 0) {
    throw new TypeError(`${valuePath}.roots must be a nonempty array.`);
  }
  const roots = manifest.roots.map((value, index) => {
    const rootPath = `${valuePath}.roots[${index}]`;
    const root = cloneJsonObject(value, rootPath);
    assertExactKeys(root, ROOT_KEYS, rootPath);
    if (
      typeof root.name !== 'string' ||
      !NPM_PACKAGE_NAME_PATTERN.test(root.name) ||
      typeof root.version !== 'string' ||
      semver.valid(root.version) !== root.version
    ) {
      throw new TypeError(
        `${rootPath} must contain an exact lowercase npm package name and canonical semantic version.`,
      );
    }
    return { name: root.name, version: root.version };
  });
  roots.sort((left, right) => compareCanonicalStrings(left.name, right.name));
  for (let index = 1; index < roots.length; index += 1) {
    if (roots[index - 1].name === roots[index].name) {
      throw new TypeError(
        `${valuePath}.roots must contain unique package names.`,
      );
    }
  }
  if (
    roots.length !== 1 ||
    roots[0].name !== CORE_RUNTIME_DEPENDENCY_ROOT.name ||
    roots[0].version !== CORE_RUNTIME_DEPENDENCY_ROOT.version
  ) {
    throw new TypeError(
      `${valuePath}.roots must contain exactly ${CORE_RUNTIME_DEPENDENCY_ROOT.name}@${CORE_RUNTIME_DEPENDENCY_ROOT.version} for the local control store.`,
    );
  }

  const archive = cloneJsonObject(manifest.archive, `${valuePath}.archive`);
  assertExactKeys(archive, ARCHIVE_KEYS, `${valuePath}.archive`);
  if (archive.assetName !== CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME) {
    throw new TypeError(
      `${valuePath}.archive.assetName must be '${CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME}'.`,
    );
  }

  return {
    schemaVersion: CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
    kind: CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
    purpose: CORE_RUNTIME_DEPENDENCY_PURPOSE,
    target: validateBuildTarget(manifest.target, `${valuePath}.target`),
    roots,
    dependencyLockInput: validateDependencyLockInput(
      manifest.dependencyLockInput,
      `${valuePath}.dependencyLockInput`,
    ),
    closureDigest: validateSha256Digest(
      manifest.closureDigest,
      `${valuePath}.closureDigest`,
    ),
    archive: {
      assetName: archive.assetName,
      digest: validateSha256Digest(
        archive.digest,
        `${valuePath}.archive.digest`,
      ),
    },
  };
}

/**
 * Serialize one strict core runtime dependency receipt deterministically.
 * @param {unknown} value - Candidate manifest.
 * @param {{pretty?: boolean}} [options] - Serialization options.
 * @returns {string} - Canonical JSON text.
 */
export function stringifyCoreRuntimeDependencyManifest(value, options = {}) {
  const manifest = validateCoreRuntimeDependencyManifest(value);
  const ordered = sortCanonicalJsonValue(manifest);
  return options.pretty === false
    ? JSON.stringify(ordered)
    : JSON.stringify(ordered, null, 2);
}

export default {
  assertCoreRuntimeDependencyTargetSupported,
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_ASSET_KIND,
  CORE_RUNTIME_DEPENDENCY_ASSET_PREFIX,
  CORE_RUNTIME_DEPENDENCY_ASSET_SCHEMA_VERSION,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_PURPOSE,
  CORE_RUNTIME_DEPENDENCY_ROOT,
  stringifyCoreRuntimeDependencyManifest,
  validateCoreRuntimeDependencyManifest,
};
