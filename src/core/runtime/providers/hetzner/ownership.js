/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { createHash } from 'node:crypto';

import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
} from '../../single-node-deployment-identity.js';

export const HETZNER_OWNERSHIP_SCHEMA_VERSION = 1;
export const HETZNER_OWNERSHIP_KIND = 'hetznerResourceOwnership';
export const HETZNER_OWNERSHIP_LABEL_PREFIX = 'wharfie.dev/';
export const HETZNER_OWNERSHIP_MANAGED_BY = 'wharfie';
export const HETZNER_OWNERSHIP_MAX_MATCHES = 64;
export const HETZNER_OWNERSHIP_MAX_LABELS = 64;
export const HETZNER_RESOURCE_ROLES = Object.freeze([
  'firewall',
  'primary-ip',
  'server',
]);
export const HETZNER_OWNERSHIP_CONFLICT_REASONS = Object.freeze([
  'multiple-matches',
  'stored-id-mismatch',
  'name-mismatch',
  'unknown-ownership-label',
  'spec-mismatch',
  'labels-mismatch',
]);

const SINGLE_NODE_DEPLOYMENT_ACTION_ID_PREFIX = 'wsna1';
const OWNERSHIP_NAME_DOMAIN = 'wharfie:hetzner-resource-name:v1';
const OWNERSHIP_INPUT_MAX_BYTES = 8 * 1024;
const CLASSIFICATION_INPUT_MAX_BYTES = 64 * 1024;
const LABEL_KEY_MAX_LENGTH = 63;
const LABEL_VALUE_MAX_LENGTH = 63;
const RESOURCE_NAME_MAX_LENGTH = 128;
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const LABEL_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/u;
const LABEL_PREFIX_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/u;
const RESOURCE_NAME_PATTERN = /^[\u0020-\u007e]+$/u;

const OWNERSHIP_INPUT_KEYS = new Set([
  'deploymentInstanceId',
  'incarnationId',
  'role',
  'createdByActionId',
  'ownershipNonce',
  'desiredStateDigest',
]);
const OWNERSHIP_DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  ...OWNERSHIP_INPUT_KEYS,
  'name',
  'labels',
]);
const CLASSIFICATION_INPUT_KEYS = new Set([
  'ownership',
  'storedResourceId',
  'matches',
]);
const MATCH_KEYS = new Set(['id', 'name', 'labels']);

const LABEL_KEYS = Object.freeze({
  managedBy: `${HETZNER_OWNERSHIP_LABEL_PREFIX}managed-by`,
  schema: `${HETZNER_OWNERSHIP_LABEL_PREFIX}schema`,
  deployment: `${HETZNER_OWNERSHIP_LABEL_PREFIX}deployment`,
  incarnation: `${HETZNER_OWNERSHIP_LABEL_PREFIX}incarnation`,
  role: `${HETZNER_OWNERSHIP_LABEL_PREFIX}role`,
  action: `${HETZNER_OWNERSHIP_LABEL_PREFIX}action`,
  nonce: `${HETZNER_OWNERSHIP_LABEL_PREFIX}nonce`,
  spec: `${HETZNER_OWNERSHIP_LABEL_PREFIX}spec`,
});
const RESERVED_LABEL_KEYS = /** @type {Set<string>} */ (
  new Set(Object.values(LABEL_KEYS))
);

/**
 * @typedef {'firewall'|'primary-ip'|'server'} HetznerResourceRole
 */

/**
 * @typedef HetznerOwnership
 * @property {1} schemaVersion - Ownership schema version.
 * @property {'hetznerResourceOwnership'} kind - Document kind.
 * @property {string} deploymentInstanceId - Stable provider placement.
 * @property {string} incarnationId - One create-to-destroy lifetime.
 * @property {HetznerResourceRole} role - Exact aggregate resource role.
 * @property {string} createdByActionId - Persisted create action identity.
 * @property {string} ownershipNonce - Unpredictable 256-bit create fence.
 * @property {string} desiredStateDigest - Exact desired-state SHA-256.
 * @property {string} name - Deterministic provider-safe resource name.
 * @property {Readonly<Record<string, string>>} labels - Exact reserved labels.
 */

/**
 * Deeply freeze one module-owned value.
 * @param {any} value - Value to freeze.
 * @returns {any} - Frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Require exactly the supported own JSON keys.
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expectedKeys - Exact required key set.
 * @param {string} valuePath - Human-readable value path.
 * @returns {void}
 */
function assertExactKeys(value, expectedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate role.
 * @param {string} valuePath - Human-readable value path.
 * @returns {asserts value is HetznerResourceRole}
 */
function assertResourceRole(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !HETZNER_RESOURCE_ROLES.includes(/** @type {HetznerResourceRole} */ (value))
  ) {
    throw new TypeError(
      `${valuePath} must be 'firewall', 'primary-ip', or 'server'.`,
    );
  }
}

/**
 * Encode bytes with the lowercase, unpadded RFC 4648 base32 alphabet.
 * @param {Uint8Array} bytes - Bytes to encode.
 * @returns {string} - Label-safe full-width encoding.
 */
function base32(bytes) {
  let accumulator = 0;
  let bitCount = 0;
  let encoded = '';

  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += BASE32_ALPHABET[(accumulator >>> bitCount) & 31];
    }
    accumulator &= (1 << bitCount) - 1;
  }

  if (bitCount > 0) {
    encoded += BASE32_ALPHABET[(accumulator << (5 - bitCount)) & 31];
  }
  return encoded;
}

/**
 * Preserve a complete typed SHA-256 identity in a Hetzner-safe label value.
 * @param {string} value - Validated typed identity.
 * @param {string} prefix - Typed identity prefix.
 * @returns {string} - Label-safe identity.
 */
function typedIdLabel(value, prefix) {
  const digest = value.slice(prefix.length + 1);
  return `${prefix}-${base32(Buffer.from(digest, 'base64url'))}`;
}

/**
 * Build the one exact provider-side selector used to inventory every resource
 * belonging to a deployment, including an incarnation whose local journal is
 * unavailable. This selector grants discovery only; full ownership still
 * requires the remaining labels, name, and durable action evidence.
 * @param {unknown} value - Stable deployment instance identity.
 * @returns {string} - Exact Hetzner label selector.
 */
export function getHetznerDeploymentLabelSelector(value) {
  assertSingleNodeDeploymentInstanceId(
    value,
    'hetznerOwnership.deploymentInstanceId',
  );
  return `${LABEL_KEYS.deployment}=${typedIdLabel(
    /** @type {string} */ (value),
    'wsnd1',
  )}`;
}

/**
 * Preserve a complete SHA-256 digest in a Hetzner-safe label value.
 * @param {string} value - Validated digest.
 * @returns {string} - Label-safe digest.
 */
function digestLabel(value) {
  return `sha256-${base32(Buffer.from(value, 'base64url'))}`;
}

/**
 * Derive a deterministic name without placing typed base64url IDs directly in
 * the provider name.
 * @param {{deploymentInstanceId: string, incarnationId: string, role: HetznerResourceRole}} value - Stable naming inputs.
 * @returns {string} - Lowercase DNS-label-safe name.
 */
function resourceName(value) {
  const digest = createHash('sha256')
    .update(OWNERSHIP_NAME_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(
      JSON.stringify([
        value.deploymentInstanceId,
        value.incarnationId,
        value.role,
      ]),
      'utf8',
    )
    .digest('hex')
    .slice(0, 24);
  return `wharfie-${value.role}-${digest}`;
}

/**
 * Validate one provider label key.
 * @param {string} key - Label key.
 * @returns {boolean} - Whether the key is valid and bounded.
 */
function isLabelKey(key) {
  if (key.length === 0 || key.length > LABEL_KEY_MAX_LENGTH) return false;
  const parts = key.split('/');
  if (parts.length === 1) return LABEL_NAME_PATTERN.test(parts[0]);
  return (
    parts.length === 2 &&
    LABEL_PREFIX_PATTERN.test(parts[0]) &&
    LABEL_NAME_PATTERN.test(parts[1])
  );
}

/**
 * Validate one provider label value.
 * @param {string} value - Label value.
 * @returns {boolean} - Whether the value is valid and bounded.
 */
function isLabelValue(value) {
  return (
    value.length <= LABEL_VALUE_MAX_LENGTH &&
    (value.length === 0 || LABEL_NAME_PATTERN.test(value))
  );
}

/**
 * Validate an observed label projection without returning it.
 * @param {unknown} value - Candidate labels.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Readonly<Record<string, string>>} - Validated labels.
 */
function validateObservedLabels(value, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be a JSON object.`);
  }
  const labels = /** @type {Record<string, unknown>} */ (value);
  const entries = Object.entries(labels);
  if (entries.length > HETZNER_OWNERSHIP_MAX_LABELS) {
    throw new RangeError(
      `${valuePath} must contain at most ${HETZNER_OWNERSHIP_MAX_LABELS} labels.`,
    );
  }
  for (const [key, labelValue] of entries) {
    if (
      !isLabelKey(key) ||
      typeof labelValue !== 'string' ||
      !isLabelValue(labelValue)
    ) {
      throw new TypeError(`${valuePath} contains an invalid Hetzner label.`);
    }
  }
  return /** @type {Readonly<Record<string, string>>} */ (labels);
}

/**
 * @param {unknown} value - Candidate positive provider identifier.
 * @param {string} valuePath - Human-readable value path.
 * @returns {number} - Provider identifier.
 */
function resourceId(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return /** @type {number} */ (value);
}

/**
 * Create exact deterministic ownership for one Hetzner aggregate resource.
 * This boundary accepts identities and digests only: credentials, private
 * keys, arbitrary tags, and cloud-init are unsupported fields.
 * @param {unknown} value - Exact ownership inputs.
 * @returns {Readonly<HetznerOwnership>} - Canonical ownership document.
 */
export function createHetznerOwnership(value) {
  const input = cloneBoundedJsonObject(
    value,
    OWNERSHIP_INPUT_MAX_BYTES,
    'hetznerOwnership',
  );
  assertExactKeys(input, OWNERSHIP_INPUT_KEYS, 'hetznerOwnership');
  assertSingleNodeDeploymentInstanceId(
    input.deploymentInstanceId,
    'hetznerOwnership.deploymentInstanceId',
  );
  assertSingleNodeDeploymentIncarnationId(
    input.incarnationId,
    'hetznerOwnership.incarnationId',
  );
  assertResourceRole(input.role, 'hetznerOwnership.role');
  assertDomainSeparatedSha256Id(
    input.createdByActionId,
    SINGLE_NODE_DEPLOYMENT_ACTION_ID_PREFIX,
    'hetznerOwnership.createdByActionId',
  );
  assertSha256Base64Url(
    input.ownershipNonce,
    'hetznerOwnership.ownershipNonce',
  );
  assertSha256Base64Url(
    input.desiredStateDigest,
    'hetznerOwnership.desiredStateDigest',
  );

  const name = resourceName({
    deploymentInstanceId: input.deploymentInstanceId,
    incarnationId: input.incarnationId,
    role: input.role,
  });
  const labels = {
    [LABEL_KEYS.managedBy]: HETZNER_OWNERSHIP_MANAGED_BY,
    [LABEL_KEYS.schema]: String(HETZNER_OWNERSHIP_SCHEMA_VERSION),
    [LABEL_KEYS.deployment]: typedIdLabel(input.deploymentInstanceId, 'wsnd1'),
    [LABEL_KEYS.incarnation]: typedIdLabel(input.incarnationId, 'wsnc1'),
    [LABEL_KEYS.role]: input.role,
    [LABEL_KEYS.action]: typedIdLabel(
      input.createdByActionId,
      SINGLE_NODE_DEPLOYMENT_ACTION_ID_PREFIX,
    ),
    [LABEL_KEYS.nonce]: digestLabel(input.ownershipNonce),
    [LABEL_KEYS.spec]: digestLabel(input.desiredStateDigest),
  };

  return deepFreeze({
    schemaVersion: HETZNER_OWNERSHIP_SCHEMA_VERSION,
    kind: HETZNER_OWNERSHIP_KIND,
    deploymentInstanceId: input.deploymentInstanceId,
    incarnationId: input.incarnationId,
    role: input.role,
    createdByActionId: input.createdByActionId,
    ownershipNonce: input.ownershipNonce,
    desiredStateDigest: input.desiredStateDigest,
    name,
    labels,
  });
}

/**
 * Validate serialized ownership and recompute its derived name and labels.
 * @param {unknown} value - Candidate serialized ownership.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<HetznerOwnership>} - Canonical ownership document.
 */
export function validateHetznerOwnership(
  value,
  valuePath = 'hetznerOwnership',
) {
  const document = cloneBoundedJsonObject(
    value,
    OWNERSHIP_INPUT_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(document, OWNERSHIP_DOCUMENT_KEYS, valuePath);
  if (document.schemaVersion !== HETZNER_OWNERSHIP_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (document.kind !== HETZNER_OWNERSHIP_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${HETZNER_OWNERSHIP_KIND}'.`,
    );
  }

  const expected = createHetznerOwnership({
    deploymentInstanceId: document.deploymentInstanceId,
    incarnationId: document.incarnationId,
    role: document.role,
    createdByActionId: document.createdByActionId,
    ownershipNonce: document.ownershipNonce,
    desiredStateDigest: document.desiredStateDigest,
  });
  if (document.name !== expected.name) {
    throw new Error(`${valuePath}.name does not match its ownership identity.`);
  }

  const labels = validateObservedLabels(document.labels, `${valuePath}.labels`);
  if (
    Object.keys(labels).length !== Object.keys(expected.labels).length ||
    Object.entries(expected.labels).some(
      ([key, labelValue]) => labels[key] !== labelValue,
    )
  ) {
    throw new Error(
      `${valuePath}.labels do not match the exact ownership envelope.`,
    );
  }
  return expected;
}

/**
 * Validate the narrow, non-secret provider projection accepted by ownership
 * classification.
 * @param {unknown} value - Candidate projection.
 * @param {number} index - Match index.
 * @returns {{id: number, name: string, labels: Readonly<Record<string, string>>}} - Validated projection.
 */
function validateMatch(value, index) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      `hetznerOwnershipClassification.matches[${index}] must be a JSON object.`,
    );
  }
  const match = /** @type {Record<string, any>} */ (value);
  const valuePath = `hetznerOwnershipClassification.matches[${index}]`;
  assertExactKeys(match, MATCH_KEYS, valuePath);
  const id = resourceId(match.id, `${valuePath}.id`);
  if (
    typeof match.name !== 'string' ||
    match.name.length === 0 ||
    match.name.length > RESOURCE_NAME_MAX_LENGTH ||
    !RESOURCE_NAME_PATTERN.test(match.name)
  ) {
    throw new TypeError(`${valuePath}.name is invalid.`);
  }
  return {
    id,
    name: match.name,
    labels: validateObservedLabels(match.labels, `${valuePath}.labels`),
  };
}

/**
 * @param {'absent'|'exact'|'conflict'} status - Classification status.
 * @param {string|null} reason - Conflict reason.
 * @param {number} matchCount - Bounded match count.
 * @param {number|null} providerResourceId - Exact provider ID when owned.
 * @returns {Readonly<{status: string, reason: string|null, matchCount: number, providerResourceId: number|null}>} - Safe classification.
 */
function classification(status, reason, matchCount, providerResourceId) {
  return Object.freeze({
    status,
    reason,
    matchCount,
    providerResourceId,
  });
}

/**
 * Classify the zero, one, or multiple sanitized provider matches for expected
 * ownership. Unrelated operator labels are ignored. Unknown Wharfie labels,
 * contradictions, and duplicate matches fail closed. The result never returns
 * provider labels or names.
 * @param {unknown} value - Expected ownership, stored ID, and match projections.
 * @returns {Readonly<{status: string, reason: string|null, matchCount: number, providerResourceId: number|null}>} - Safe classification.
 */
export function classifyHetznerOwnershipMatches(value) {
  const input = cloneBoundedJsonObject(
    value,
    CLASSIFICATION_INPUT_MAX_BYTES,
    'hetznerOwnershipClassification',
  );
  assertExactKeys(
    input,
    CLASSIFICATION_INPUT_KEYS,
    'hetznerOwnershipClassification',
  );
  const ownership = validateHetznerOwnership(
    input.ownership,
    'hetznerOwnershipClassification.ownership',
  );
  const storedResourceId =
    input.storedResourceId === null
      ? null
      : resourceId(
          input.storedResourceId,
          'hetznerOwnershipClassification.storedResourceId',
        );
  if (!Array.isArray(input.matches)) {
    throw new TypeError(
      'hetznerOwnershipClassification.matches must be an array.',
    );
  }
  if (input.matches.length > HETZNER_OWNERSHIP_MAX_MATCHES) {
    throw new RangeError(
      `hetznerOwnershipClassification.matches must contain at most ${HETZNER_OWNERSHIP_MAX_MATCHES} entries.`,
    );
  }
  const matches = input.matches.map(validateMatch);

  if (matches.length === 0) {
    return classification('absent', null, 0, null);
  }
  if (matches.length > 1) {
    return classification('conflict', 'multiple-matches', matches.length, null);
  }

  const [match] = matches;
  if (storedResourceId !== null && match.id !== storedResourceId) {
    return classification('conflict', 'stored-id-mismatch', 1, null);
  }
  if (match.name !== ownership.name) {
    return classification('conflict', 'name-mismatch', 1, null);
  }
  for (const key of Object.keys(match.labels)) {
    if (
      key.startsWith(HETZNER_OWNERSHIP_LABEL_PREFIX) &&
      !RESERVED_LABEL_KEYS.has(key)
    ) {
      return classification('conflict', 'unknown-ownership-label', 1, null);
    }
  }
  if (match.labels[LABEL_KEYS.spec] !== ownership.labels[LABEL_KEYS.spec]) {
    return classification('conflict', 'spec-mismatch', 1, null);
  }
  for (const [key, expectedValue] of Object.entries(ownership.labels)) {
    if (key !== LABEL_KEYS.spec && match.labels[key] !== expectedValue) {
      return classification('conflict', 'labels-mismatch', 1, null);
    }
  }
  return classification('exact', null, 1, match.id);
}

export default {
  HETZNER_OWNERSHIP_CONFLICT_REASONS,
  HETZNER_OWNERSHIP_KIND,
  HETZNER_OWNERSHIP_LABEL_PREFIX,
  HETZNER_OWNERSHIP_MANAGED_BY,
  HETZNER_OWNERSHIP_MAX_LABELS,
  HETZNER_OWNERSHIP_MAX_MATCHES,
  HETZNER_OWNERSHIP_SCHEMA_VERSION,
  HETZNER_RESOURCE_ROLES,
  classifyHetznerOwnershipMatches,
  createHetznerOwnership,
  getHetznerDeploymentLabelSelector,
  validateHetznerOwnership,
};
