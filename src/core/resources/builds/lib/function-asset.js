import { createHash } from 'node:crypto';
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

export const FUNCTION_ASSET_SCHEMA_VERSION = 3;

const FUNCTION_ASSET_KEYS = new Set([
  'schemaVersion',
  'activity',
  'target',
  'externals',
  'codeBundle',
  'externalsTar',
  'externalDependencyReceipt',
  'resourceSpecs',
]);
const EXTERNAL_DEPENDENCY_RECEIPT_KEYS = new Set([
  'dependencyLockInput',
  'closureDigest',
  'archiveDigest',
]);
const EXTERNAL_KEYS = new Set(['name', 'version']);
const NPM_PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

/**
 * @typedef FunctionExternalDependencyReceipt
 * @property {import('../../../runtime/application-revision.js').LockedInputDescriptor} dependencyLockInput - Exact owning dependency lock.
 * @property {import('../../../runtime/application-revision.js').Sha256Digest} closureDigest - Semantic target closure digest.
 * @property {import('../../../runtime/application-revision.js').Sha256Digest} archiveDigest - Digest of the exact embedded archive bytes.
 */

/**
 * @typedef FunctionAssetDescription
 * @property {3} schemaVersion - Strict function asset schema.
 * @property {string} activity - Canonical activity registered by the code bundle.
 * @property {import('../../../runtime/build-target.js').BuildTarget} target - Exact target for this function realization.
 * @property {{name: string, version: string}[]} externals - Exact direct external roots, including an exact empty list.
 * @property {string} codeBundle - Canonical base64 Brotli-compressed activity bundle.
 * @property {string} externalsTar - Canonical base64 target dependency archive, or empty.
 * @property {FunctionExternalDependencyReceipt | null} externalDependencyReceipt - Receipt bound to the exact archive bytes.
 * @property {Record<string, any>} resourceSpecs - Function-scoped runtime resource declarations.
 */

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} keys - Exact required keys.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertExactRequiredKeys(value, keys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * Decode an exact canonical base64 string.
 * @param {unknown} value - Candidate base64 text.
 * @param {string} valuePath - Human-readable value path.
 * @param {boolean} allowEmpty - Whether empty bytes are supported.
 * @returns {Buffer} - Exact decoded bytes.
 */
function decodeCanonicalBase64(value, valuePath, allowEmpty) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new TypeError(
      `${valuePath} must be ${allowEmpty ? 'a' : 'a nonempty'} canonical base64 string.`,
    );
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new TypeError(`${valuePath} must use canonical base64 encoding.`);
  }
  return bytes;
}

/**
 * Validate the strict dependency receipt embedded beside one external archive.
 * @param {unknown} value - Candidate receipt.
 * @param {string} valuePath - Human-readable value path.
 * @returns {FunctionExternalDependencyReceipt} - Validated receipt.
 */
export function validateFunctionExternalDependencyReceipt(
  value,
  valuePath = 'externalDependencyReceipt',
) {
  const receipt = cloneJsonObject(value, valuePath);
  assertExactRequiredKeys(receipt, EXTERNAL_DEPENDENCY_RECEIPT_KEYS, valuePath);
  return {
    dependencyLockInput: validateDependencyLockInput(
      receipt.dependencyLockInput,
      `${valuePath}.dependencyLockInput`,
    ),
    closureDigest: validateSha256Digest(
      receipt.closureDigest,
      `${valuePath}.closureDigest`,
    ),
    archiveDigest: validateSha256Digest(
      receipt.archiveDigest,
      `${valuePath}.archiveDigest`,
    ),
  };
}

/**
 * Validate and canonically order exact direct external roots.
 * @param {unknown} value - Candidate external list.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{name: string, version: string}[]} - Canonical external roots.
 */
function validateFunctionAssetExternals(value, valuePath) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an array.`);
  }
  const externals = value.map((entry, index) => {
    const entryPath = `${valuePath}[${index}]`;
    const external = cloneJsonObject(entry, entryPath);
    assertExactRequiredKeys(external, EXTERNAL_KEYS, entryPath);
    if (
      typeof external.name !== 'string' ||
      !NPM_PACKAGE_NAME_PATTERN.test(external.name) ||
      typeof external.version !== 'string' ||
      semver.valid(external.version) !== external.version
    ) {
      throw new TypeError(
        `${entryPath} must contain an exact lowercase npm package name and canonical semantic version.`,
      );
    }
    return { name: external.name, version: external.version };
  });
  externals.sort((left, right) =>
    compareCanonicalStrings(left.name, right.name),
  );
  for (let index = 1; index < externals.length; index += 1) {
    if (externals[index - 1].name === externals[index].name) {
      throw new TypeError(`${valuePath} must contain unique package names.`);
    }
  }
  return externals;
}

/**
 * Validate a strict function asset and bind its receipt to its archive bytes.
 * @param {unknown} value - Candidate function asset description.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{ description: FunctionAssetDescription, codeBundleBytes: Buffer, externalArchiveBytes: Buffer }} - Validated description and decoded bytes.
 */
export function validateFunctionAssetDescription(
  value,
  valuePath = 'function asset',
) {
  const candidate = cloneJsonObject(value, valuePath);
  assertExactRequiredKeys(candidate, FUNCTION_ASSET_KEYS, valuePath);
  if (candidate.schemaVersion !== FUNCTION_ASSET_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${FUNCTION_ASSET_SCHEMA_VERSION}.`,
    );
  }
  assertLogicalId(candidate.activity, `${valuePath}.activity`);
  const target = validateBuildTarget(candidate.target, `${valuePath}.target`);
  const externals = validateFunctionAssetExternals(
    candidate.externals,
    `${valuePath}.externals`,
  );

  const codeBundleBytes = decodeCanonicalBase64(
    candidate.codeBundle,
    `${valuePath}.codeBundle`,
    false,
  );
  const externalArchiveBytes = decodeCanonicalBase64(
    candidate.externalsTar,
    `${valuePath}.externalsTar`,
    true,
  );
  const resourceSpecs = cloneJsonObject(
    candidate.resourceSpecs,
    `${valuePath}.resourceSpecs`,
  );

  /** @type {FunctionExternalDependencyReceipt | null} */
  let externalDependencyReceipt = null;
  if (candidate.externalDependencyReceipt !== null) {
    externalDependencyReceipt = validateFunctionExternalDependencyReceipt(
      candidate.externalDependencyReceipt,
      `${valuePath}.externalDependencyReceipt`,
    );
  }
  if (externals.length === 0 && externalArchiveBytes.length > 0) {
    throw new Error(
      `${valuePath}.externals must name the roots represented by external archive bytes.`,
    );
  }
  if (externals.length > 0 && externalArchiveBytes.length === 0) {
    throw new Error(
      `${valuePath}.externals require nonempty external archive bytes.`,
    );
  }
  if (externalArchiveBytes.length === 0 && externalDependencyReceipt) {
    throw new Error(
      `${valuePath}.externalDependencyReceipt requires nonempty external archive bytes.`,
    );
  }
  if (externalArchiveBytes.length > 0 && !externalDependencyReceipt) {
    throw new Error(
      `${valuePath}.externalDependencyReceipt is required for nonempty external archive bytes.`,
    );
  }
  if (externalDependencyReceipt) {
    const actualArchiveDigest = createHash('sha256')
      .update(externalArchiveBytes)
      .digest('base64url');
    if (externalDependencyReceipt.archiveDigest.value !== actualArchiveDigest) {
      throw new Error(
        `${valuePath}.externalDependencyReceipt.archiveDigest does not match the exact embedded archive bytes.`,
      );
    }
  }

  return {
    description: {
      schemaVersion: FUNCTION_ASSET_SCHEMA_VERSION,
      activity: candidate.activity,
      target,
      externals,
      codeBundle: candidate.codeBundle,
      externalsTar: candidate.externalsTar,
      externalDependencyReceipt,
      resourceSpecs,
    },
    codeBundleBytes,
    externalArchiveBytes,
  };
}

/**
 * Serialize one validated function asset using its only accepted byte encoding.
 * @param {unknown} value - Candidate function asset description.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Buffer} - Canonical UTF-8 JSON bytes.
 */
export function serializeFunctionAssetDescription(
  value,
  valuePath = 'function asset',
) {
  const { description } = validateFunctionAssetDescription(value, valuePath);
  return Buffer.from(
    JSON.stringify(sortCanonicalJsonValue(description)),
    'utf8',
  );
}

/**
 * Parse exact canonical function asset bytes.
 * @param {Buffer | Uint8Array} value - Exact function asset bytes.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{ description: FunctionAssetDescription, codeBundleBytes: Buffer, externalArchiveBytes: Buffer }} - Validated description and decoded bytes.
 */
export function parseFunctionAssetDescription(
  value,
  valuePath = 'function asset',
) {
  const bytes = Buffer.from(value);
  let candidate;
  try {
    candidate = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : '';
    throw new TypeError(`${valuePath} must contain valid JSON.${detail}`);
  }
  const validated = validateFunctionAssetDescription(candidate, valuePath);
  const canonicalBytes = Buffer.from(
    JSON.stringify(sortCanonicalJsonValue(validated.description)),
    'utf8',
  );
  if (!bytes.equals(canonicalBytes)) {
    throw new TypeError(`${valuePath} must use canonical UTF-8 JSON encoding.`);
  }
  return validated;
}

export default {
  FUNCTION_ASSET_SCHEMA_VERSION,
  parseFunctionAssetDescription,
  serializeFunctionAssetDescription,
  validateFunctionAssetDescription,
  validateFunctionExternalDependencyReceipt,
};
