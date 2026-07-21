/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import { randomBytes } from 'node:crypto';

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
  createDomainSeparatedSha256Id,
} from './content-id.js';
import {
  assertDeploymentInstanceId,
  PROVIDER_SCOPE_ID_PREFIX,
} from './deployment-provider-scope.js';
import { DEPLOYMENT_CAPABILITY_KINDS } from './deployment-profile.js';
import { cloneJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const DEPLOYMENT_INCARNATION_ID_DOMAIN =
  'wharfie:deployment-incarnation:v1';
export const DEPLOYMENT_INCARNATION_ID_PREFIX = 'wic1';
export const DEPLOYMENT_ACTION_ID_PREFIX = 'wda1';
export const DEPLOYMENT_RESOURCE_BINDING_SCHEMA_VERSION = 1;
export const DEPLOYMENT_RESOURCE_BINDING_KIND = 'deploymentResourceBinding';
export const DEPLOYMENT_RESOURCE_BINDING_ID_DOMAIN =
  'wharfie:deployment-resource-binding:v1';
export const DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX = 'wrb1';
export const DEPLOYMENT_CAPABILITIES = DEPLOYMENT_CAPABILITY_KINDS;

const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'incarnationId',
  'resourceKey',
  'capability',
  'management',
  'providerType',
  'providerResourceId',
  'providerScopeId',
  'ownershipNonce',
  'createdByActionId',
]);
const DOCUMENT_KEYS = new Set(['bindingId', ...PAYLOAD_KEYS]);
const CAPABILITY_KEYS = new Set(['kind', 'version']);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * @typedef DeploymentResourceBinding
 * @property {1} schemaVersion - Schema version.
 * @property {'deploymentResourceBinding'} kind - Document kind.
 * @property {string} bindingId - Immutable binding identity.
 * @property {string} deploymentInstanceId - Stable deployment/provider-scope identity.
 * @property {string} incarnationId - One create-to-destroy lifetime.
 * @property {string} resourceKey - Finite logical resource key.
 * @property {{kind: string, version: 1}} capability - Wharfie capability fulfilled.
 * @property {'managed'|'external'} management - Mutation authority.
 * @property {string} providerType - Finite driver resource type.
 * @property {string} providerResourceId - Exact immutable provider identity.
 * @property {string} providerScopeId - Exact provider scope.
 * @property {string} [ownershipNonce] - Managed ownership envelope nonce.
 * @property {string} [createdByActionId] - Persisted create action.
 */

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value - Candidate exact provider resource ID.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical identity.
 */
export function validateProviderResourceId(
  value,
  valuePath = 'providerResourceId',
) {
  const containsControlCharacter =
    typeof value === 'string' &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
    });
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 2048 ||
    value.trim() !== value ||
    containsControlCharacter
  ) {
    throw new TypeError(
      `${valuePath} must be a nonempty canonical provider resource ID.`,
    );
  }
  assertManifestIsSecretFree({ providerResourceId: value }, valuePath);
  return value;
}

/**
 * @param {unknown} value - Candidate ownership nonce.
 * @param {string} valuePath - Human-readable value path.
 * @returns {string} - Canonical nonce with at least 128 bits.
 */
export function validateOwnershipNonce(value, valuePath = 'ownershipNonce') {
  if (
    typeof value !== 'string' ||
    !BASE64URL_PATTERN.test(value) ||
    value.length > 86
  ) {
    throw new TypeError(
      `${valuePath} must be canonical unpadded base64url with at least 128 bits.`,
    );
  }
  const bytes = Buffer.from(value, 'base64url');
  if (
    bytes.byteLength < 16 ||
    bytes.byteLength > 64 ||
    bytes.toString('base64url') !== value
  ) {
    throw new TypeError(
      `${valuePath} must be canonical unpadded base64url with at least 128 bits.`,
    );
  }
  return value;
}

/**
 * Create a fresh 256-bit ownership nonce. Tests may supply exact entropy.
 * @param {Buffer|Uint8Array} [entropy] - At least 128 bits of entropy.
 * @returns {string} - Canonical nonce.
 */
export function createOwnershipNonce(entropy = randomBytes(32)) {
  const bytes = Buffer.from(entropy);
  return validateOwnershipNonce(bytes.toString('base64url'));
}

/**
 * Create one unpredictable deployment incarnation identity.
 * @param {Buffer|Uint8Array} [entropy] - Fresh entropy.
 * @returns {string} - `wic1_` identity.
 */
export function createDeploymentIncarnationId(entropy = randomBytes(32)) {
  const bytes = Buffer.from(entropy);
  if (bytes.byteLength < 16) {
    throw new TypeError(
      'Deployment incarnation entropy must contain at least 128 bits.',
    );
  }
  return createDomainSeparatedSha256Id({
    domain: DEPLOYMENT_INCARNATION_ID_DOMAIN,
    prefix: DEPLOYMENT_INCARNATION_ID_PREFIX,
    payload: bytes,
  });
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertDeploymentIncarnationId(
  value,
  valuePath = 'incarnationId',
) {
  assertDomainSeparatedSha256Id(
    value,
    DEPLOYMENT_INCARNATION_ID_PREFIX,
    valuePath,
  );
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertDeploymentActionId(value, valuePath = 'actionId') {
  assertDomainSeparatedSha256Id(value, DEPLOYMENT_ACTION_ID_PREFIX, valuePath);
}

/**
 * @param {unknown} value - Candidate capability marker.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{kind: string, version: 1}} - Canonical capability.
 */
function validateCapability(value, valuePath) {
  const capability = cloneJsonObject(value, valuePath);
  assertExactKeys(capability, CAPABILITY_KEYS, valuePath);
  for (const key of CAPABILITY_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(capability, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
  if (!DEPLOYMENT_CAPABILITIES.includes(capability.kind)) {
    throw new TypeError(`${valuePath}.kind is not a supported capability.`);
  }
  if (capability.version !== 1) {
    throw new TypeError(`${valuePath}.version must be the integer 1.`);
  }
  return { kind: capability.kind, version: 1 };
}

/**
 * @param {unknown} value - Candidate binding payload.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Omit<DeploymentResourceBinding, 'bindingId'>} - Canonical payload.
 */
function validatePayload(value, valuePath) {
  const binding = cloneJsonObject(value, valuePath);
  assertExactKeys(binding, PAYLOAD_KEYS, valuePath);
  const commonKeys = [
    'schemaVersion',
    'kind',
    'deploymentInstanceId',
    'incarnationId',
    'resourceKey',
    'capability',
    'management',
    'providerType',
    'providerResourceId',
    'providerScopeId',
  ];
  for (const key of commonKeys) {
    if (!Object.prototype.hasOwnProperty.call(binding, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
  if (binding.schemaVersion !== DEPLOYMENT_RESOURCE_BINDING_SCHEMA_VERSION) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (binding.kind !== DEPLOYMENT_RESOURCE_BINDING_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${DEPLOYMENT_RESOURCE_BINDING_KIND}'.`,
    );
  }
  assertDeploymentInstanceId(
    binding.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(
    binding.incarnationId,
    `${valuePath}.incarnationId`,
  );
  assertLogicalId(binding.resourceKey, `${valuePath}.resourceKey`);
  assertLogicalId(binding.providerType, `${valuePath}.providerType`);
  assertDomainSeparatedSha256Id(
    binding.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${valuePath}.providerScopeId`,
  );
  const capability = validateCapability(
    binding.capability,
    `${valuePath}.capability`,
  );
  if (binding.management !== 'managed' && binding.management !== 'external') {
    throw new TypeError(
      `${valuePath}.management must be 'managed' or 'external'.`,
    );
  }
  const managed = binding.management === 'managed';
  for (const key of ['ownershipNonce', 'createdByActionId']) {
    const present = Object.prototype.hasOwnProperty.call(binding, key);
    if (managed && !present) {
      throw new TypeError(
        `${valuePath}.${key} is required for managed resources.`,
      );
    }
    if (!managed && present) {
      throw new TypeError(
        `${valuePath}.${key} is not supported for external resources.`,
      );
    }
  }

  return {
    schemaVersion: DEPLOYMENT_RESOURCE_BINDING_SCHEMA_VERSION,
    kind: DEPLOYMENT_RESOURCE_BINDING_KIND,
    deploymentInstanceId: binding.deploymentInstanceId,
    incarnationId: binding.incarnationId,
    resourceKey: binding.resourceKey,
    capability,
    management: binding.management,
    providerType: binding.providerType,
    providerResourceId: validateProviderResourceId(
      binding.providerResourceId,
      `${valuePath}.providerResourceId`,
    ),
    providerScopeId: binding.providerScopeId,
    ...(managed
      ? {
          ownershipNonce: validateOwnershipNonce(
            binding.ownershipNonce,
            `${valuePath}.ownershipNonce`,
          ),
          createdByActionId: (() => {
            assertDeploymentActionId(
              binding.createdByActionId,
              `${valuePath}.createdByActionId`,
            );
            return binding.createdByActionId;
          })(),
        }
      : {}),
  };
}

/**
 * Create one immutable ownership/external-reference receipt.
 * @param {unknown} value - Binding fields without `bindingId`.
 * @returns {Readonly<DeploymentResourceBinding>} - Canonical binding.
 */
export function createDeploymentResourceBinding(value) {
  const payload = deepFreeze(
    sortCanonicalJsonValue(validatePayload(value, 'deploymentResourceBinding')),
  );
  const bindingId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_RESOURCE_BINDING_ID_DOMAIN,
    prefix: DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    value: payload,
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, bindingId }));
}

/**
 * Validate and recompute a serialized binding.
 * @param {unknown} value - Candidate binding.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentResourceBinding>} - Canonical binding.
 */
export function validateDeploymentResourceBinding(
  value,
  valuePath = 'deploymentResourceBinding',
) {
  const document = cloneJsonObject(value, valuePath);
  assertExactKeys(document, DOCUMENT_KEYS, valuePath);
  if (!Object.prototype.hasOwnProperty.call(document, 'bindingId')) {
    throw new TypeError(`${valuePath}.bindingId is required.`);
  }
  assertDomainSeparatedSha256Id(
    document.bindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${valuePath}.bindingId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) {
    if (Object.prototype.hasOwnProperty.call(document, key)) {
      payloadInput[key] = document[key];
    }
  }
  const payload = deepFreeze(
    sortCanonicalJsonValue(validatePayload(payloadInput, valuePath)),
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_RESOURCE_BINDING_ID_DOMAIN,
    prefix: DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    value: payload,
  });
  if (document.bindingId !== expectedId) {
    throw new Error(`${valuePath}.bindingId does not match its exact receipt.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, bindingId: expectedId }),
  );
}

export default {
  DEPLOYMENT_ACTION_ID_PREFIX,
  DEPLOYMENT_CAPABILITIES,
  DEPLOYMENT_INCARNATION_ID_DOMAIN,
  DEPLOYMENT_INCARNATION_ID_PREFIX,
  DEPLOYMENT_RESOURCE_BINDING_ID_DOMAIN,
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
  DEPLOYMENT_RESOURCE_BINDING_KIND,
  DEPLOYMENT_RESOURCE_BINDING_SCHEMA_VERSION,
  assertDeploymentActionId,
  assertDeploymentIncarnationId,
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
  validateDeploymentResourceBinding,
  validateOwnershipNonce,
};
