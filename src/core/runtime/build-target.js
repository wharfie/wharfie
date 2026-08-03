/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import semver from 'semver';

import { cloneJsonObject } from './json-value.js';

const BUILD_TARGET_KEYS = new Set([
  'nodeVersion',
  'platform',
  'architecture',
  'libc',
]);
const EXACT_RELEASE_SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * @typedef BuildTarget
 * @property {string} nodeVersion - Exact canonical Node semantic version.
 * @property {'darwin'|'linux'|'win32'} platform - Target operating system.
 * @property {'arm64'|'x64'} architecture - Target CPU architecture.
 * @property {'glibc'} [libc] - Required for Linux and forbidden elsewhere.
 */

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
}

/**
 * Validate and independently clone one exact portable build target.
 * @param {unknown} value - Candidate target.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {BuildTarget} - Canonical independent target.
 */
export function validateBuildTarget(value, valuePath = 'target') {
  const target = cloneJsonObject(value, valuePath);
  assertExactKeys(target, BUILD_TARGET_KEYS, valuePath);

  if (
    typeof target.nodeVersion !== 'string' ||
    target.nodeVersion.trim() !== target.nodeVersion ||
    semver.valid(target.nodeVersion) !== target.nodeVersion ||
    !EXACT_RELEASE_SEMVER_PATTERN.test(target.nodeVersion)
  ) {
    throw new TypeError(
      `${valuePath}.nodeVersion must be an exact canonical semantic version in x.y.z form.`,
    );
  }

  if (!['darwin', 'linux', 'win32'].includes(target.platform)) {
    throw new TypeError(
      `${valuePath}.platform must be 'darwin', 'linux', or 'win32'.`,
    );
  }
  if (!['arm64', 'x64'].includes(target.architecture)) {
    throw new TypeError(`${valuePath}.architecture must be 'arm64' or 'x64'.`);
  }

  if (target.platform === 'linux') {
    if (target.libc !== 'glibc') {
      throw new TypeError(`${valuePath}.libc must be 'glibc' for Linux.`);
    }
  } else if (Object.prototype.hasOwnProperty.call(target, 'libc')) {
    throw new TypeError(
      `${valuePath}.libc is supported only for Linux targets.`,
    );
  }

  return /** @type {BuildTarget} */ (target);
}

/**
 * Derive the one readable stable identity for an exact build target.
 * @param {unknown} value - Candidate target.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - Canonical target identity.
 */
export function getBuildTargetId(value, valuePath = 'target') {
  const target = validateBuildTarget(value, valuePath);
  return `node-v${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

export default {
  getBuildTargetId,
  validateBuildTarget,
};
