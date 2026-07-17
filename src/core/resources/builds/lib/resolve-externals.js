import semver from 'semver';

import { compareCanonicalStrings } from '../../../runtime/canonical-order.js';

const EXTERNAL_KEYS = new Set(['name', 'version']);
const NPM_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * @typedef ExternalDependencyInputObject
 * @property {string} name - Exact lowercase npm package name.
 * @property {string} version - Exact canonical semantic version.
 */

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - Exact lowercase npm package name.
 * @property {string} version - Exact canonical semantic version.
 */

/**
 * @param {unknown} value - Candidate package name.
 * @param {string} valuePath - Human-readable input path.
 * @returns {string} - Canonical package name.
 */
function validatePackageName(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    !NPM_PACKAGE_NAME_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be an exact lowercase npm registry package name.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate package version.
 * @param {string} valuePath - Human-readable input path.
 * @returns {string} - Canonical exact semantic version.
 */
function validatePackageVersion(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    semver.valid(value) !== value
  ) {
    throw new TypeError(
      `${valuePath} requires an exact canonical semantic version; ranges, tags, URLs, aliases, and VCS specs are not supported.`,
    );
  }
  return value;
}

/**
 * Parse one exact `name@version` string, including scoped package names.
 * @param {string} value - Exact external specifier.
 * @param {string} valuePath - Human-readable input path.
 * @returns {ExternalDependencyDescription} - Exact descriptor.
 */
function parseExternalString(value, valuePath) {
  if (value.trim() !== value || value.length === 0) {
    throw new TypeError(
      `${valuePath} must be an exact package@version specifier.`,
    );
  }
  const separator = value.lastIndexOf('@');
  if (separator <= 0 || separator === value.length - 1) {
    throw new TypeError(
      `${valuePath} must include an exact version as package@version; ambient installed packages are not build inputs.`,
    );
  }
  return {
    name: validatePackageName(value.slice(0, separator), `${valuePath}.name`),
    version: validatePackageVersion(
      value.slice(separator + 1),
      `${valuePath}.version`,
    ),
  };
}

/**
 * Normalize user-authored external dependency specs into an exact, sorted,
 * duplicate-free descriptor list. Bare names are deliberately rejected:
 * app-local lock bytes, not ambient node_modules, own dependency identity.
 * @param {(string | ExternalDependencyInputObject)[] | undefined} externals - External declarations.
 * @param {string | undefined} [_entrypointPath] - Retained positional compatibility; never used for resolution.
 * @returns {ExternalDependencyDescription[] | undefined} - Canonical descriptors.
 */
export function normalizeExternalDependencies(externals, _entrypointPath) {
  if (externals === undefined || externals === null) return undefined;
  if (!Array.isArray(externals)) {
    throw new TypeError('External dependencies must be an array.');
  }
  if (externals.length === 0) return undefined;

  const normalized = externals.map((external, index) => {
    const valuePath = `external[${index}]`;
    if (typeof external === 'string') {
      return parseExternalString(external, valuePath);
    }
    if (!external || typeof external !== 'object' || Array.isArray(external)) {
      throw new TypeError(
        `${valuePath} must be package@version or { name, version }.`,
      );
    }
    for (const key of Object.keys(external)) {
      if (!EXTERNAL_KEYS.has(key)) {
        throw new TypeError(`${valuePath}.${key} is not supported.`);
      }
    }
    for (const key of EXTERNAL_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(external, key)) {
        throw new TypeError(`${valuePath}.${key} is required.`);
      }
    }
    return {
      name: validatePackageName(external.name, `${valuePath}.name`),
      version: validatePackageVersion(external.version, `${valuePath}.version`),
    };
  });

  normalized.sort((left, right) =>
    compareCanonicalStrings(left.name, right.name),
  );
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].name === normalized[index].name) {
      throw new TypeError(
        `External package '${normalized[index].name}' is declared more than once.`,
      );
    }
  }
  return normalized;
}

export default { normalizeExternalDependencies };
