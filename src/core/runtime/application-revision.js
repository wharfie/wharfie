/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { validateAppManifest } from './app-manifest.js';
import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const APPLICATION_REVISION_SCHEMA_VERSION = 1;
export const APPLICATION_REVISION_KIND = 'applicationRevision';
export const APPLICATION_REVISION_ID_DOMAIN = 'wharfie:revision:v1';
export const APPLICATION_REVISION_ID_PREFIX = 'wrv1';
export const SOURCE_TREE_INPUT_FORMAT = 'wharfie-source-tree-v1';
export const DEPENDENCY_LOCK_INPUT_FORMAT =
  'wharfie-npm-package-lock-v3-closure-v1';
export const RUNTIME_INPUT_FORMAT = 'wharfie-runtime-v1';

const REVISION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'revisionId',
  'contract',
  'inputs',
]);
const INPUTS_KEYS = new Set(['source', 'dependencies', 'runtime', 'assets']);
const INPUT_DESCRIPTOR_KEYS = new Set(['format', 'digest']);
const ASSET_INPUT_KEYS = new Set(['name', 'digest']);
const DIGEST_KEYS = new Set(['algorithm', 'value']);

/**
 * Deeply freeze one independently validated JSON record.
 * @param {any} value - JSON record.
 * @returns {any} - The same frozen record.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * @typedef Sha256Digest
 * @property {'sha256'} algorithm - Digest algorithm.
 * @property {string} value - Unpadded base64url digest bytes.
 */

/**
 * @typedef LockedInputDescriptor
 * @property {string} format - Versioned input serialization format.
 * @property {Sha256Digest} digest - Named digest algorithm and value.
 */

/**
 * @typedef RevisionAssetInput
 * @property {string} name - Canonical logical asset name.
 * @property {Sha256Digest} digest - Named digest algorithm and value.
 */

/**
 * @typedef RevisionInputs
 * @property {LockedInputDescriptor} source - Target-independent source tree lock.
 * @property {LockedInputDescriptor} dependencies - Canonical dependency lock.
 * @property {LockedInputDescriptor} runtime - Wharfie runtime/protocol lock.
 * @property {RevisionAssetInput[]} [assets] - Behavior-bearing packaged asset locks.
 */

/**
 * @typedef ApplicationRevision
 * @property {1} schemaVersion - Revision schema version.
 * @property {'applicationRevision'} kind - Document kind.
 * @property {string} revisionId - Recomputed domain-separated identity.
 * @property {Record<string, any>} contract - Target-free v3 app contract.
 * @property {RevisionInputs} inputs - Locked behavior inputs.
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
 * Validate one explicitly named SHA-256 digest value.
 * @param {unknown} value - Candidate digest.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Sha256Digest} - Validated digest.
 */
export function validateSha256Digest(value, valuePath = 'digest') {
  const digest = cloneJsonObject(value, valuePath);
  assertExactKeys(digest, DIGEST_KEYS, valuePath);
  if (digest.algorithm !== 'sha256') {
    throw new TypeError(`${valuePath}.algorithm must be 'sha256'.`);
  }
  assertSha256Base64Url(digest.value, `${valuePath}.value`);
  return /** @type {Sha256Digest} */ (digest);
}

/**
 * Validate an app contract that deliberately excludes build-target requests.
 * Targets identify artifact realizations and therefore cannot affect a logical
 * application revision when another target is added later.
 * @param {unknown} value - Candidate target-free application contract.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Record<string, any>} - Validated independent contract.
 */
export function validateRevisionContract(value, valuePath = 'contract') {
  const candidate = cloneJsonObject(value, valuePath);
  if (Object.prototype.hasOwnProperty.call(candidate, 'targets')) {
    throw new TypeError(
      `${valuePath}.targets is not part of a logical application revision; targets belong to artifact records.`,
    );
  }
  return validateAppManifest(candidate, valuePath);
}

/**
 * @param {unknown} value - Candidate locked input descriptor.
 * @param {string} expectedFormat - Required serialization format.
 * @param {string} valuePath - Human-readable value path.
 * @returns {LockedInputDescriptor} - Validated descriptor.
 */
function validateInputDescriptor(value, expectedFormat, valuePath) {
  const descriptor = cloneJsonObject(value, valuePath);
  assertExactKeys(descriptor, INPUT_DESCRIPTOR_KEYS, valuePath);
  if (descriptor.format !== expectedFormat) {
    throw new TypeError(`${valuePath}.format must be '${expectedFormat}'.`);
  }
  return {
    format: descriptor.format,
    digest: validateSha256Digest(descriptor.digest, `${valuePath}.digest`),
  };
}

/**
 * Validate the versioned dependency-lock descriptor used by revision and
 * artifact boundaries.
 * @param {unknown} value - Candidate dependency-lock descriptor.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {LockedInputDescriptor} - Validated dependency-lock descriptor.
 */
export function validateDependencyLockInput(value, valuePath = 'dependencies') {
  return validateInputDescriptor(
    value,
    DEPENDENCY_LOCK_INPUT_FORMAT,
    valuePath,
  );
}

/**
 * Validate the complete target-independent input lock for a revision.
 * @param {unknown} value - Candidate input lock.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {RevisionInputs} - Validated independent input lock.
 */
export function validateRevisionInputs(value, valuePath = 'inputs') {
  const inputs = cloneJsonObject(value, valuePath);
  assertExactKeys(inputs, INPUTS_KEYS, valuePath);

  const normalized = /** @type {RevisionInputs} */ ({
    source: validateInputDescriptor(
      inputs.source,
      SOURCE_TREE_INPUT_FORMAT,
      `${valuePath}.source`,
    ),
    dependencies: validateDependencyLockInput(
      inputs.dependencies,
      `${valuePath}.dependencies`,
    ),
    runtime: validateInputDescriptor(
      inputs.runtime,
      RUNTIME_INPUT_FORMAT,
      `${valuePath}.runtime`,
    ),
  });

  if (Object.prototype.hasOwnProperty.call(inputs, 'assets')) {
    if (!Array.isArray(inputs.assets) || inputs.assets.length === 0) {
      throw new TypeError(
        `${valuePath}.assets must be a nonempty array when provided.`,
      );
    }

    let previousName = '';
    normalized.assets = inputs.assets.map((value, index) => {
      const assetPath = `${valuePath}.assets[${index}]`;
      const asset = cloneJsonObject(value, assetPath);
      assertExactKeys(asset, ASSET_INPUT_KEYS, assetPath);
      assertLogicalId(asset.name, `${assetPath}.name`);
      const digest = validateSha256Digest(asset.digest, `${assetPath}.digest`);
      if (
        previousName &&
        compareCanonicalStrings(asset.name, previousName) <= 0
      ) {
        throw new TypeError(
          `${valuePath}.assets must contain unique assets sorted by name.`,
        );
      }
      previousName = asset.name;
      return /** @type {RevisionAssetInput} */ ({
        name: asset.name,
        digest,
      });
    });
  }

  return normalized;
}

/**
 * Compute the identity payload shared by creation and validation.
 * @param {Record<string, any>} contract - Validated target-free contract.
 * @param {RevisionInputs} inputs - Validated input lock.
 * @returns {{ schemaVersion: 1, kind: 'applicationRevision', contract: Record<string, any>, inputs: RevisionInputs }} - Identity payload excluding its own ID.
 */
function createRevisionIdentityPayload(contract, inputs) {
  return /** @type {const} */ ({
    schemaVersion: APPLICATION_REVISION_SCHEMA_VERSION,
    kind: APPLICATION_REVISION_KIND,
    contract,
    inputs,
  });
}

/**
 * Compute one logical application revision identity.
 * @param {{ contract: unknown, inputs: unknown }} value - Revision identity fields.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - `wrv1_<base64url sha256>` identity.
 */
export function getApplicationRevisionId(value, valuePath = 'revision') {
  const contract = validateRevisionContract(
    value?.contract,
    `${valuePath}.contract`,
  );
  const inputs = validateRevisionInputs(value?.inputs, `${valuePath}.inputs`);
  return createCanonicalJsonSha256Id({
    domain: APPLICATION_REVISION_ID_DOMAIN,
    prefix: APPLICATION_REVISION_ID_PREFIX,
    value: createRevisionIdentityPayload(contract, inputs),
    valuePath,
  });
}

/**
 * Assert the public textual identity form for ApplicationRevisionV1.
 * @param {unknown} value - Candidate revision identity.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertApplicationRevisionId(value, valuePath = 'revisionId') {
  assertDomainSeparatedSha256Id(
    value,
    APPLICATION_REVISION_ID_PREFIX,
    valuePath,
  );
}

/**
 * Create an immutable logical revision value from a target-free app contract
 * and locked behavior inputs.
 * @param {{ contract: unknown, inputs: unknown }} value - Revision fields.
 * @returns {ApplicationRevision} - Validated independent revision.
 */
export function createApplicationRevision(value) {
  const contract = validateRevisionContract(
    value?.contract,
    'revision.contract',
  );
  const inputs = validateRevisionInputs(value?.inputs, 'revision.inputs');
  const identityPayload = createRevisionIdentityPayload(contract, inputs);
  return freezeJsonSnapshot(
    sortCanonicalJsonValue({
      ...identityPayload,
      revisionId: createCanonicalJsonSha256Id({
        domain: APPLICATION_REVISION_ID_DOMAIN,
        prefix: APPLICATION_REVISION_ID_PREFIX,
        value: identityPayload,
        valuePath: 'revision',
      }),
    }),
  );
}

/**
 * Validate a serialized ApplicationRevisionV1 and recompute its identity.
 * @param {unknown} value - Candidate revision.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {ApplicationRevision} - Validated independent revision.
 */
export function validateApplicationRevision(value, valuePath = 'revision') {
  const revision = cloneJsonObject(value, valuePath);
  assertExactKeys(revision, REVISION_KEYS, valuePath);
  if (revision.schemaVersion !== APPLICATION_REVISION_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${APPLICATION_REVISION_SCHEMA_VERSION}.`,
    );
  }
  if (revision.kind !== APPLICATION_REVISION_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${APPLICATION_REVISION_KIND}'.`,
    );
  }
  assertApplicationRevisionId(revision.revisionId, `${valuePath}.revisionId`);

  const contract = validateRevisionContract(
    revision.contract,
    `${valuePath}.contract`,
  );
  const inputs = validateRevisionInputs(revision.inputs, `${valuePath}.inputs`);
  const identityPayload = createRevisionIdentityPayload(contract, inputs);
  const expectedRevisionId = createCanonicalJsonSha256Id({
    domain: APPLICATION_REVISION_ID_DOMAIN,
    prefix: APPLICATION_REVISION_ID_PREFIX,
    value: identityPayload,
    valuePath,
  });
  if (revision.revisionId !== expectedRevisionId) {
    throw new Error(
      `${valuePath}.revisionId does not match the canonical contract and locked inputs.`,
    );
  }

  return freezeJsonSnapshot(
    sortCanonicalJsonValue({
      ...identityPayload,
      revisionId: expectedRevisionId,
    }),
  );
}

export default {
  APPLICATION_REVISION_ID_DOMAIN,
  APPLICATION_REVISION_ID_PREFIX,
  APPLICATION_REVISION_KIND,
  APPLICATION_REVISION_SCHEMA_VERSION,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  assertApplicationRevisionId,
  createApplicationRevision,
  getApplicationRevisionId,
  validateApplicationRevision,
  validateDependencyLockInput,
  validateRevisionContract,
  validateRevisionInputs,
  validateSha256Digest,
};
