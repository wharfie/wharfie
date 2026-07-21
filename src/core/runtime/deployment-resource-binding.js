/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import { randomBytes } from 'node:crypto';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
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
export const DEPLOYMENT_ACTION_ID_PREFIX = 'wda3';
export const DEPLOYMENT_RESOURCE_BINDING_SCHEMA_VERSION = 2;
export const DEPLOYMENT_RESOURCE_BINDING_KIND = 'deploymentResourceBinding';
export const DEPLOYMENT_RESOURCE_BINDING_ID_DOMAIN =
  'wharfie:deployment-resource-binding:v2';
export const DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX = 'wrb2';
export const DEPLOYMENT_CAPABILITIES = DEPLOYMENT_CAPABILITY_KINDS;
export const DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES = 1024;
export const DEPLOYMENT_RESOURCE_BINDING_LIMIT = 32;
export const DEPLOYMENT_RESOURCE_OWNERSHIP_MODES = Object.freeze([
  'direct',
  'derived',
  'external',
]);
export const DEPLOYMENT_RESOURCE_DESTROY_POLICIES = Object.freeze([
  'retain',
  'purge',
]);

const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deploymentInstanceId',
  'incarnationId',
  'resourceKey',
  'capability',
  'role',
  'management',
  'ownershipMode',
  'onDestroy',
  'dependencyBindings',
  'providerType',
  'providerResourceId',
  'providerScopeId',
  'ownershipNonce',
  'createdByActionId',
]);
const DOCUMENT_KEYS = new Set(['bindingId', ...PAYLOAD_KEYS]);
const CAPABILITY_KEYS = new Set(['kind', 'version']);
const ROLE_KEYS = new Set(['kind', 'version']);
const DEPENDENCY_BINDING_KEYS = new Set(['resourceKey', 'bindingId']);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const JSON_STABLE_PRINTABLE_ASCII_PATTERN =
  /^[\u0021\u0023-\u005b\u005d-\u007e]+$/u;

/**
 * @typedef DeploymentResourceBinding
 * @property {2} schemaVersion - Schema version.
 * @property {'deploymentResourceBinding'} kind - Document kind.
 * @property {string} bindingId - Immutable binding identity.
 * @property {string} deploymentInstanceId - Stable deployment/provider-scope identity.
 * @property {string} incarnationId - One create-to-destroy lifetime.
 * @property {string} resourceKey - Finite logical resource key.
 * @property {{kind: string, version: 1}} capability - Wharfie capability fulfilled.
 * @property {{kind: string, version: 1}} role - Exact effect role within the capability.
 * @property {'managed'|'external'} management - Mutation authority.
 * @property {'direct'|'derived'|'external'} ownershipMode - Provider-visible or dependency-derived ownership model.
 * @property {'retain'|'purge'} onDestroy - Effect-specific destroy disposition.
 * @property {{resourceKey: string, bindingId: string}[]} dependencyBindings - Exact binding lineage for direct dependencies.
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
  if (
    typeof value !== 'string' ||
    value.length > DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES ||
    !JSON_STABLE_PRINTABLE_ASCII_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be a nonempty JSON-stable printable ASCII provider resource ID without spaces, quotes, or backslashes and must not exceed ${DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES} bytes.`,
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
 * @param {unknown} value - Candidate effect role marker.
 * @param {string} valuePath - Human-readable value path.
 * @returns {{kind: string, version: 1}} - Canonical role.
 */
export function validateDeploymentResourceRole(value, valuePath = 'role') {
  const role = cloneJsonObject(value, valuePath);
  assertExactKeys(role, ROLE_KEYS, valuePath);
  for (const key of ROLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(role, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
  assertLogicalId(role.kind, `${valuePath}.kind`);
  if (role.version !== 1) {
    throw new TypeError(`${valuePath}.version must be the integer 1.`);
  }
  return { kind: role.kind, version: 1 };
}

/**
 * @param {unknown} value - Candidate exact dependency binding references.
 * @param {string} ownerResourceKey - Resource owning the references.
 * @param {string} valuePath - Human-readable value path.
 * @param {boolean} serialized - Whether input ordering must already be canonical.
 * @returns {{resourceKey: string, bindingId: string}[]} - Canonical references.
 */
function validateDependencyBindings(
  value,
  ownerResourceKey,
  valuePath,
  serialized,
) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be an array.`);
  }
  if (value.length > DEPLOYMENT_RESOURCE_BINDING_LIMIT) {
    throw new TypeError(
      `${valuePath} must contain at most ${DEPLOYMENT_RESOURCE_BINDING_LIMIT} references.`,
    );
  }
  /** @type {string[]} */
  const originalResourceKeys = [];
  const dependencies = value.map((candidate, index) => {
    const path = `${valuePath}[${index}]`;
    const dependency = cloneJsonObject(candidate, path);
    assertExactKeys(dependency, DEPENDENCY_BINDING_KEYS, path);
    for (const key of DEPENDENCY_BINDING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(dependency, key)) {
        throw new TypeError(`${path}.${key} is required.`);
      }
    }
    assertLogicalId(dependency.resourceKey, `${path}.resourceKey`);
    if (dependency.resourceKey === ownerResourceKey) {
      throw new Error(`${valuePath} cannot reference its own resourceKey.`);
    }
    assertDomainSeparatedSha256Id(
      dependency.bindingId,
      DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
      `${path}.bindingId`,
    );
    originalResourceKeys.push(dependency.resourceKey);
    return {
      resourceKey: dependency.resourceKey,
      bindingId: dependency.bindingId,
    };
  });
  if (
    serialized &&
    originalResourceKeys.some(
      (resourceKey, index) =>
        index > 0 &&
        compareCanonicalStrings(originalResourceKeys[index - 1], resourceKey) >=
          0,
    )
  ) {
    throw new Error(
      `${valuePath} must be strictly sorted by unique resourceKey.`,
    );
  }
  dependencies.sort((left, right) =>
    compareCanonicalStrings(left.resourceKey, right.resourceKey),
  );
  for (let index = 1; index < dependencies.length; index += 1) {
    if (
      dependencies[index - 1].resourceKey === dependencies[index].resourceKey
    ) {
      throw new Error(`${valuePath} must have unique resourceKey values.`);
    }
  }
  return dependencies;
}

/**
 * @param {unknown} value - Candidate binding payload.
 * @param {string} valuePath - Human-readable value path.
 * @param {{serialized: boolean}} options - Canonical serialized-form policy.
 * @returns {Omit<DeploymentResourceBinding, 'bindingId'>} - Canonical payload.
 */
function validatePayload(value, valuePath, options) {
  const binding = cloneJsonObject(value, valuePath);
  assertExactKeys(binding, PAYLOAD_KEYS, valuePath);
  const commonKeys = [
    'schemaVersion',
    'kind',
    'deploymentInstanceId',
    'incarnationId',
    'resourceKey',
    'capability',
    'role',
    'management',
    'ownershipMode',
    'onDestroy',
    'dependencyBindings',
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
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 2.`);
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
  const role = validateDeploymentResourceRole(
    binding.role,
    `${valuePath}.role`,
  );
  if (binding.management !== 'managed' && binding.management !== 'external') {
    throw new TypeError(
      `${valuePath}.management must be 'managed' or 'external'.`,
    );
  }
  const managed = binding.management === 'managed';
  if (!DEPLOYMENT_RESOURCE_OWNERSHIP_MODES.includes(binding.ownershipMode)) {
    throw new TypeError(`${valuePath}.ownershipMode is not supported.`);
  }
  if (managed && binding.ownershipMode === 'external') {
    throw new Error(
      `${valuePath} managed resources cannot use external ownership.`,
    );
  }
  if (!managed && binding.ownershipMode !== 'external') {
    throw new Error(
      `${valuePath} external resources must use external ownership.`,
    );
  }
  if (!DEPLOYMENT_RESOURCE_DESTROY_POLICIES.includes(binding.onDestroy)) {
    throw new TypeError(`${valuePath}.onDestroy is not supported.`);
  }
  const dependencyBindings = validateDependencyBindings(
    binding.dependencyBindings,
    binding.resourceKey,
    `${valuePath}.dependencyBindings`,
    options.serialized,
  );
  if (!managed && dependencyBindings.length !== 0) {
    throw new Error(
      `${valuePath} external resources cannot carry dependency binding lineage.`,
    );
  }
  if (binding.ownershipMode === 'derived' && dependencyBindings.length === 0) {
    throw new Error(
      `${valuePath} derived ownership requires dependency binding lineage.`,
    );
  }
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
    role,
    management: binding.management,
    ownershipMode: binding.ownershipMode,
    onDestroy: binding.onDestroy,
    dependencyBindings,
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
    sortCanonicalJsonValue(
      validatePayload(value, 'deploymentResourceBinding', {
        serialized: false,
      }),
    ),
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
    sortCanonicalJsonValue(
      validatePayload(payloadInput, valuePath, { serialized: true }),
    ),
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
  DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
  DEPLOYMENT_RESOURCE_BINDING_LIMIT,
  DEPLOYMENT_RESOURCE_BINDING_ID_DOMAIN,
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
  DEPLOYMENT_RESOURCE_BINDING_KIND,
  DEPLOYMENT_RESOURCE_BINDING_SCHEMA_VERSION,
  DEPLOYMENT_RESOURCE_DESTROY_POLICIES,
  DEPLOYMENT_RESOURCE_OWNERSHIP_MODES,
  assertDeploymentActionId,
  assertDeploymentIncarnationId,
  createDeploymentIncarnationId,
  createDeploymentResourceBinding,
  createOwnershipNonce,
  validateDeploymentResourceBinding,
  validateDeploymentResourceRole,
  validateOwnershipNonce,
};
