/* eslint-disable jsdoc/valid-types -- Recursive exact runtime contracts are clearer as JSDoc object types. */

import { TextDecoder } from 'node:util';

import { validateSha256Digest } from '../../application-revision.js';
import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
} from '../../single-node-deployment-identity.js';
import { SINGLE_NODE_CLOUD_INIT_MAX_BYTES } from '../../single-node-cloud-init.js';
import {
  classifyHetznerOwnershipMatches,
  createHetznerOwnership,
  validateHetznerOwnership,
} from './ownership.js';
import { validateHetznerSingleNodePlan } from './single-node-plan.js';

export const HETZNER_PROVISIONING_INTENT_SCHEMA_VERSION = 1;
export const HETZNER_PROVISIONING_INTENT_KIND =
  'hetznerSingleNodeProvisioningIntent';
export const HETZNER_PROVISIONING_INTENT_ID_PREFIX = 'wshpi1';
export const HETZNER_PROVISIONING_MUTATION_ATTEMPT_SCHEMA_VERSION = 1;
export const HETZNER_PROVISIONING_MUTATION_ATTEMPT_KIND =
  'hetznerProvisioningMutationAttempt';
export const HETZNER_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX = 'wshma1';
export const HETZNER_PROVISIONED_RESOURCE_SCHEMA_VERSION = 1;
export const HETZNER_PROVISIONED_RESOURCE_KIND = 'hetznerProvisionedResource';

const PROVISIONING_INTENT_ID_DOMAIN =
  'wharfie:hetzner-single-node-provisioning-intent:v1';
const MUTATION_ATTEMPT_ID_DOMAIN =
  'wharfie:hetzner-single-node-provisioning-mutation-attempt:v1';
const PROVISIONING_INTENT_MAX_BYTES = 256 * 1024;
const MUTATION_ATTEMPT_MAX_BYTES = 16 * 1024;
const PROVISIONING_RESULT_KIND = 'hetznerSingleNodeProvisioningResult';
const INPUT_KEYS = new Set([
  'plan',
  'incarnationId',
  'ownershipNonces',
  'cloudInitDigest',
]);
const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  'plan',
  'incarnationId',
  'cloudInitDigest',
  'resources',
]);
const NONCE_KEYS = new Set(['firewall', 'primaryIp', 'server']);
const RESOURCE_KEYS = new Set(['firewall', 'primaryIp', 'server']);
const RESOURCE_INTENT_KEYS = new Set(['desiredSpec', 'ownership']);
const CONVERGE_KEYS = new Set([
  'intent',
  'cloudInitBytes',
  'storedResourceIds',
  'storedMutationAttempts',
  'api',
  'waitForAction',
  'recordMutationAttempt',
  'recordResource',
]);
const STORED_ID_KEYS = new Set(['firewall', 'primaryIp', 'server']);
const MUTATION_ATTEMPT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'attemptId',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'role',
  'operation',
  'ownershipName',
  'desiredStateDigest',
]);
const PROVISIONED_RESOURCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'role',
  'providerResourceId',
]);
const API_METHODS = Object.freeze([
  'listFirewalls',
  'getFirewall',
  'createFirewall',
  'listPrimaryIps',
  'getPrimaryIp',
  'createPrimaryIp',
  'listServers',
  'getServer',
  'createServer',
]);
/** @type {Readonly<Record<string, Readonly<{list: string, get: string, create: string}>>>} */
const ROLE_CONFIG = Object.freeze({
  firewall: Object.freeze({
    list: 'listFirewalls',
    get: 'getFirewall',
    create: 'createFirewall',
  }),
  primaryIp: Object.freeze({
    list: 'listPrimaryIps',
    get: 'getPrimaryIp',
    create: 'createPrimaryIp',
  }),
  server: Object.freeze({
    list: 'listServers',
    get: 'getServer',
    create: 'createServer',
  }),
});

/**
 * @param {any} value - Value to freeze.
 * @returns {any} - Deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} expected - Exact keys.
 * @param {string} valuePath - Human-readable path.
 * @returns {void}
 */
function assertExactKeys(value, expected, valuePath) {
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate positive provider ID.
 * @param {string} valuePath - Human-readable path.
 * @returns {number} - Provider ID.
 */
function providerId(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} value - Canonical JSON desired spec.
 * @returns {string} - Plain SHA-256 desired-state digest.
 */
function desiredSpecDigest(value) {
  return sha256Base64Url(
    JSON.stringify(sortCanonicalJsonValue(value)),
    'hetznerProvisioning.desiredSpec',
  );
}

/**
 * @param {Readonly<Record<string, any>>} plan - Actionable plan.
 * @returns {string} - Exact provisioning aggregate action ID.
 */
function provisioningActionId(plan) {
  const matches = plan.actions.filter(
    (/** @type {Readonly<Record<string, any>>} */ action) =>
      action.kind === 'provision-managed-node',
  );
  if (matches.length !== 1) {
    throw new Error(
      'hetznerProvisioning plan must contain exactly one provisioning action.',
    );
  }
  return matches[0].actionId;
}

/**
 * Build the exact role specs and ownership documents.
 * @param {Readonly<Record<string, any>>} plan - Validated plan.
 * @param {string} incarnationId - Exact create-to-destroy lifetime.
 * @param {Readonly<Record<string, string>>} nonces - Role nonces.
 * @param {Readonly<{algorithm: 'sha256', value: string}>} cloudInitDigest - Bootstrap digest.
 * @returns {Readonly<Record<string, any>>} - Exact resource intents.
 */
function deriveResources(plan, incarnationId, nonces, cloudInitDigest) {
  const actionId = provisioningActionId(plan);
  const deploymentInstanceId = plan.deploymentInstanceId;
  const location = plan.providerSpec.location;
  const allowedIpv4 = Object.freeze([
    ...plan.desired.intent.access.allowedIpv4,
  ]);
  const firewallSpec = deepFreeze(
    sortCanonicalJsonValue({
      role: 'firewall',
      rules: [
        {
          direction: 'in',
          protocol: 'tcp',
          port: '22',
          sourceIps: allowedIpv4,
          destinationIps: [],
          description: null,
        },
      ],
      defaultOutbound: 'allow',
    }),
  );
  const firewallOwnership = createHetznerOwnership({
    deploymentInstanceId,
    incarnationId,
    role: 'firewall',
    createdByActionId: actionId,
    ownershipNonce: nonces.firewall,
    desiredStateDigest: desiredSpecDigest(firewallSpec),
  });

  const primaryIpSpec = deepFreeze(
    sortCanonicalJsonValue({
      role: 'primary-ip',
      type: 'ipv4',
      location,
      autoDelete: false,
      blocked: false,
      deleteProtected: false,
    }),
  );
  const primaryIpOwnership = createHetznerOwnership({
    deploymentInstanceId,
    incarnationId,
    role: 'primary-ip',
    createdByActionId: actionId,
    ownershipNonce: nonces.primaryIp,
    desiredStateDigest: desiredSpecDigest(primaryIpSpec),
  });

  const serverSpec = deepFreeze(
    sortCanonicalJsonValue({
      role: 'server',
      location,
      serverType: plan.providerSpec.serverType,
      image: plan.providerSpec.image,
      firewallName: firewallOwnership.name,
      primaryIpName: primaryIpOwnership.name,
      enableIpv4: true,
      enableIpv6: false,
      startAfterCreate: true,
      cloudInitDigest,
      locked: false,
      deleteProtected: false,
    }),
  );
  const serverOwnership = createHetznerOwnership({
    deploymentInstanceId,
    incarnationId,
    role: 'server',
    createdByActionId: actionId,
    ownershipNonce: nonces.server,
    desiredStateDigest: desiredSpecDigest(serverSpec),
  });

  return deepFreeze({
    firewall: { desiredSpec: firewallSpec, ownership: firewallOwnership },
    primaryIp: {
      desiredSpec: primaryIpSpec,
      ownership: primaryIpOwnership,
    },
    server: { desiredSpec: serverSpec, ownership: serverOwnership },
  });
}

/**
 * Validate the three unpredictable ownership nonces.
 * @param {unknown} value - Candidate nonces.
 * @returns {Readonly<Record<string, string>>} - Canonical nonces.
 */
function validateNonces(value) {
  const nonces = cloneBoundedJsonObject(
    value,
    4096,
    'hetznerProvisioning.ownershipNonces',
  );
  assertExactKeys(nonces, NONCE_KEYS, 'hetznerProvisioning.ownershipNonces');
  for (const key of NONCE_KEYS) {
    assertSha256Base64Url(
      nonces[key],
      `hetznerProvisioning.ownershipNonces.${key}`,
    );
  }
  if (new Set(Object.values(nonces)).size !== NONCE_KEYS.size) {
    throw new Error('hetznerProvisioning ownership nonces must be distinct.');
  }
  return Object.freeze({
    firewall: nonces.firewall,
    primaryIp: nonces.primaryIp,
    server: nonces.server,
  });
}

/**
 * Canonicalize an intent payload without its content ID.
 * @param {unknown} value - Candidate payload.
 * @param {string} valuePath - Human-readable path.
 * @returns {Readonly<Record<string, any>>} - Canonical payload.
 */
function canonicalizeIntentPayload(value, valuePath) {
  const document = cloneBoundedJsonObject(
    value,
    PROVISIONING_INTENT_MAX_BYTES,
    valuePath,
  );
  const payloadKeys = new Set(
    [...DOCUMENT_KEYS].filter((key) => key !== 'provisioningIntentId'),
  );
  assertExactKeys(document, payloadKeys, valuePath);
  if (
    document.schemaVersion !== HETZNER_PROVISIONING_INTENT_SCHEMA_VERSION ||
    document.kind !== HETZNER_PROVISIONING_INTENT_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  const plan = validateHetznerSingleNodePlan(
    document.plan,
    `${valuePath}.plan`,
  );
  if (plan.status !== 'actionable') {
    throw new Error(`${valuePath}.plan must be actionable.`);
  }
  assertSingleNodeDeploymentIncarnationId(
    document.incarnationId,
    `${valuePath}.incarnationId`,
  );
  const cloudInitDigest = validateSha256Digest(
    document.cloudInitDigest,
    `${valuePath}.cloudInitDigest`,
  );
  const resources = cloneBoundedJsonObject(
    document.resources,
    64 * 1024,
    `${valuePath}.resources`,
  );
  assertExactKeys(resources, RESOURCE_KEYS, `${valuePath}.resources`);
  /** @type {Record<string, any>} */
  const validatedResources = {};
  for (const key of RESOURCE_KEYS) {
    assertExactKeys(
      resources[key],
      RESOURCE_INTENT_KEYS,
      `${valuePath}.resources.${key}`,
    );
    validatedResources[key] = {
      desiredSpec: deepFreeze(
        sortCanonicalJsonValue(resources[key].desiredSpec),
      ),
      ownership: validateHetznerOwnership(
        resources[key].ownership,
        `${valuePath}.resources.${key}.ownership`,
      ),
    };
  }
  const expected = deriveResources(
    plan,
    document.incarnationId,
    {
      firewall: validatedResources.firewall.ownership.ownershipNonce,
      primaryIp: validatedResources.primaryIp.ownership.ownershipNonce,
      server: validatedResources.server.ownership.ownershipNonce,
    },
    cloudInitDigest,
  );
  if (
    JSON.stringify(sortCanonicalJsonValue(validatedResources)) !==
    JSON.stringify(sortCanonicalJsonValue(expected))
  ) {
    throw new Error(`${valuePath}.resources do not match the exact plan.`);
  }
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_PROVISIONING_INTENT_SCHEMA_VERSION,
      kind: HETZNER_PROVISIONING_INTENT_KIND,
      plan,
      incarnationId: document.incarnationId,
      cloudInitDigest,
      resources: expected,
    }),
  );
  assertManifestIsSecretFree(payload, valuePath);
  return payload;
}

/**
 * Create a persisted, content-addressed provisioning intent.
 * @param {unknown} value - Exact plan, incarnation, nonces, and cloud-init digest.
 * @returns {Readonly<Record<string, any>>} - Provisioning intent.
 */
export function createHetznerSingleNodeProvisioningIntent(value) {
  const input = cloneBoundedJsonObject(
    value,
    PROVISIONING_INTENT_MAX_BYTES,
    'hetznerProvisioning',
  );
  assertExactKeys(input, INPUT_KEYS, 'hetznerProvisioning');
  const plan = validateHetznerSingleNodePlan(
    input.plan,
    'hetznerProvisioning.plan',
  );
  if (plan.status !== 'actionable') {
    throw new Error('hetznerProvisioning.plan must be actionable.');
  }
  assertSingleNodeDeploymentIncarnationId(
    input.incarnationId,
    'hetznerProvisioning.incarnationId',
  );
  const nonces = validateNonces(input.ownershipNonces);
  const cloudInitDigest = validateSha256Digest(
    input.cloudInitDigest,
    'hetznerProvisioning.cloudInitDigest',
  );
  const payload = canonicalizeIntentPayload(
    {
      schemaVersion: HETZNER_PROVISIONING_INTENT_SCHEMA_VERSION,
      kind: HETZNER_PROVISIONING_INTENT_KIND,
      plan,
      incarnationId: input.incarnationId,
      cloudInitDigest,
      resources: deriveResources(
        plan,
        input.incarnationId,
        nonces,
        cloudInitDigest,
      ),
    },
    'hetznerProvisioning',
  );
  const provisioningIntentId = createCanonicalJsonSha256Id({
    domain: PROVISIONING_INTENT_ID_DOMAIN,
    prefix: HETZNER_PROVISIONING_INTENT_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerProvisioning',
  });
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, provisioningIntentId }),
  );
}

/**
 * Validate a serialized provisioning intent and recompute its content ID.
 * @param {unknown} value - Candidate intent.
 * @param {string} [valuePath] - Human-readable path.
 * @returns {Readonly<Record<string, any>>} - Canonical intent.
 */
export function validateHetznerSingleNodeProvisioningIntent(
  value,
  valuePath = 'hetznerProvisioning',
) {
  const document = cloneBoundedJsonObject(
    value,
    PROVISIONING_INTENT_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(document, DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.provisioningIntentId,
    HETZNER_PROVISIONING_INTENT_ID_PREFIX,
    `${valuePath}.provisioningIntentId`,
  );
  const payload = canonicalizeIntentPayload(
    Object.fromEntries(
      Object.entries(document).filter(
        ([key]) => key !== 'provisioningIntentId',
      ),
    ),
    valuePath,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: PROVISIONING_INTENT_ID_DOMAIN,
    prefix: HETZNER_PROVISIONING_INTENT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.provisioningIntentId !== expectedId) {
    throw new Error(
      `${valuePath}.provisioningIntentId does not match its exact payload.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, provisioningIntentId: expectedId }),
  );
}

/** A safe ownership or provider-spec conflict. */
export class HetznerProvisioningConflictError extends Error {
  /**
   * @param {string} role - Resource role.
   * @param {string} reason - Safe conflict reason.
   */
  constructor(role, reason) {
    super(`Hetzner ${role} provisioning encountered a provider conflict.`);
    this.name = 'HetznerProvisioningConflictError';
    this.code = 'HETZNER_PROVISIONING_CONFLICT';
    this.role = role;
    this.reason = reason;
  }
}

/**
 * @param {string} code - Stable code.
 * @param {string} role - Resource role.
 * @param {string} message - Safe fixed message.
 * @returns {Error & {code: string, role: string}} - Safe error.
 */
function safeRoleError(code, role, message) {
  const error = /** @type {Error & {code: string, role: string}} */ (
    new Error(message)
  );
  error.name = 'HetznerProvisioningError';
  error.code = code;
  error.role = role;
  return error;
}

/**
 * @param {string} role - Resource role.
 * @returns {Error & {code: string, role: string}} - Stable retryable state.
 */
function notSettledError(role) {
  return safeRoleError(
    'HETZNER_PROVISIONING_NOT_SETTLED',
    role,
    `Hetzner ${role} provisioning has not settled yet.`,
  );
}

/**
 * Snapshot exactly the API methods this convergence owns.
 * @param {unknown} value - Candidate API.
 * @returns {Readonly<Record<string, Function>>} - Bound methods.
 */
function snapshotApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerProvisioning.api must be an API client.');
  }
  /** @type {Record<string, Function>} */
  const api = {};
  for (const method of API_METHODS) {
    const candidate = /** @type {Record<string, any>} */ (value)[method];
    if (typeof candidate !== 'function') {
      throw new TypeError(`hetznerProvisioning.api.${method} is required.`);
    }
    api[method] = candidate.bind(value);
  }
  return Object.freeze(api);
}

/**
 * @param {unknown} value - Candidate optional stored IDs.
 * @returns {Readonly<Record<string, number|null>>} - Stored IDs.
 */
function storedResourceIds(value) {
  if (value === undefined) {
    return Object.freeze({ firewall: null, primaryIp: null, server: null });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'hetznerProvisioning.storedResourceIds must be an object.',
    );
  }
  /** @type {Record<string, number|null>} */
  const result = { firewall: null, primaryIp: null, server: null };
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !STORED_ID_KEYS.has(key)) {
      throw new TypeError(
        'hetznerProvisioning.storedResourceIds contains an unsupported field.',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('hetznerProvisioning.storedResourceIds is invalid.');
    }
    result[key] =
      descriptor.value === null
        ? null
        : providerId(
            descriptor.value,
            `hetznerProvisioning.storedResourceIds.${key}`,
          );
  }
  return Object.freeze(result);
}

/**
 * Derive the immutable payload for one per-incarnation provider create fence.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {string} role - Resource role.
 * @returns {Readonly<Record<string, any>>} - Content-bound payload.
 */
function mutationAttemptPayload(intent, role) {
  const resourceIntent = intent.resources[role];
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_PROVISIONING_MUTATION_ATTEMPT_SCHEMA_VERSION,
      kind: HETZNER_PROVISIONING_MUTATION_ATTEMPT_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      role,
      operation: 'create',
      ownershipName: resourceIntent.ownership.name,
      desiredStateDigest: resourceIntent.ownership.desiredStateDigest,
    }),
  );
}

/**
 * Create the deterministic durable fence that must precede one provider POST.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {string} role - Resource role.
 * @returns {Readonly<Record<string, any>>} - Mutation-attempt evidence.
 */
export function createHetznerProvisioningMutationAttempt(intent, role) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  if (typeof role !== 'string' || !RESOURCE_KEYS.has(role)) {
    throw new TypeError(
      'hetznerProvisioning.mutationAttempt.role is not supported.',
    );
  }
  return createCanonicalMutationAttempt(canonicalIntent, role);
}

/**
 * @param {Readonly<Record<string, any>>} intent - Validated intent.
 * @param {string} role - Validated role.
 * @returns {Readonly<Record<string, any>>} - Exact attempt.
 */
function createCanonicalMutationAttempt(intent, role) {
  const payload = mutationAttemptPayload(intent, role);
  const attemptId = createCanonicalJsonSha256Id({
    domain: MUTATION_ATTEMPT_ID_DOMAIN,
    prefix: HETZNER_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerProvisioning.mutationAttempt',
  });
  const attempt = deepFreeze(sortCanonicalJsonValue({ ...payload, attemptId }));
  assertManifestIsSecretFree(attempt, 'hetznerProvisioning.mutationAttempt');
  return attempt;
}

/**
 * Validate exact persisted attempt evidence against one intent and role.
 * @param {unknown} value - Candidate attempt.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {string} [role] - Optional required resource role.
 * @param {string} [valuePath] - Safe boundary path.
 * @returns {Readonly<Record<string, any>>} - Canonical attempt evidence.
 */
export function validateHetznerProvisioningMutationAttempt(
  value,
  intent,
  role,
  valuePath = 'hetznerProvisioning.mutationAttempt',
) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  const attempt = cloneBoundedJsonObject(
    value,
    MUTATION_ATTEMPT_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(attempt, MUTATION_ATTEMPT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    attempt.attemptId,
    HETZNER_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
    `${valuePath}.attemptId`,
  );
  const expectedRole = role ?? attempt.role;
  if (typeof expectedRole !== 'string' || !RESOURCE_KEYS.has(expectedRole)) {
    throw new TypeError(`${valuePath}.role is not supported.`);
  }
  const expected = createCanonicalMutationAttempt(
    canonicalIntent,
    expectedRole,
  );
  if (!canonicalEqual(attempt, expected)) {
    throw new Error(
      `${valuePath} does not match the exact provisioning intent.`,
    );
  }
  return expected;
}

/**
 * @param {unknown} value - Optional persisted per-role attempts.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @returns {Readonly<Record<string, any|null>>} - Exact attempts.
 */
function storedMutationAttempts(value, intent) {
  if (value === undefined) {
    return Object.freeze({ firewall: null, primaryIp: null, server: null });
  }
  const attempts = cloneBoundedJsonObject(
    value,
    64 * 1024,
    'hetznerProvisioning.storedMutationAttempts',
  );
  assertExactKeys(
    attempts,
    RESOURCE_KEYS,
    'hetznerProvisioning.storedMutationAttempts',
  );
  /** @type {Record<string, any|null>} */
  const result = {};
  for (const role of RESOURCE_KEYS) {
    result[role] =
      attempts[role] === null
        ? null
        : validateHetznerProvisioningMutationAttempt(
            attempts[role],
            intent,
            role,
            `hetznerProvisioning.storedMutationAttempts.${role}`,
          );
  }
  return Object.freeze(result);
}

/**
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {string} role - Resource role.
 * @param {number} id - Exact provider ID.
 * @returns {Readonly<Record<string, any>>} - Callback evidence.
 */
export function createHetznerProvisionedResourceRecord(intent, role, id) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  if (typeof role !== 'string' || !RESOURCE_KEYS.has(role)) {
    throw new TypeError(
      'hetznerProvisioning.resourceRecord.role is not supported.',
    );
  }
  return createCanonicalProvisionedResourceRecord(canonicalIntent, role, id);
}

/**
 * @param {Readonly<Record<string, any>>} intent - Validated intent.
 * @param {string} role - Validated role.
 * @param {number} id - Provider ID.
 * @returns {Readonly<Record<string, any>>} - Exact resource record.
 */
function createCanonicalProvisionedResourceRecord(intent, role, id) {
  const record = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_PROVISIONED_RESOURCE_SCHEMA_VERSION,
      kind: HETZNER_PROVISIONED_RESOURCE_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      role,
      providerResourceId: providerId(
        id,
        'hetznerProvisioning.resourceRecord.providerResourceId',
      ),
    }),
  );
  assertManifestIsSecretFree(record, 'hetznerProvisioning.resourceRecord');
  return record;
}

/**
 * Validate exact provider-resource callback evidence.
 * @param {unknown} value - Candidate record.
 * @param {Readonly<Record<string, any>>} intent - Exact provisioning intent.
 * @param {string} [role] - Optional required resource role.
 * @param {string} [valuePath] - Safe boundary path.
 * @returns {Readonly<Record<string, any>>} - Canonical callback evidence.
 */
export function validateHetznerProvisionedResourceRecord(
  value,
  intent,
  role,
  valuePath = 'hetznerProvisioning.resourceRecord',
) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  const record = cloneBoundedJsonObject(value, 16 * 1024, valuePath);
  assertExactKeys(record, PROVISIONED_RESOURCE_KEYS, valuePath);
  const expectedRole = role ?? record.role;
  if (typeof expectedRole !== 'string' || !RESOURCE_KEYS.has(expectedRole)) {
    throw new TypeError(`${valuePath}.role is not supported.`);
  }
  const expected = createCanonicalProvisionedResourceRecord(
    canonicalIntent,
    expectedRole,
    providerId(record.providerResourceId, `${valuePath}.providerResourceId`),
  );
  if (!canonicalEqual(record, expected)) {
    throw new Error(
      `${valuePath} does not match the exact provisioning intent.`,
    );
  }
  return expected;
}

/**
 * @param {Readonly<Record<string, string>>} labels - Ownership labels.
 * @returns {string} - Exact AND selector.
 */
function ownershipLabelSelector(labels) {
  return Object.entries(labels)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
}

/**
 * @param {any[]} observations - Provider observations.
 * @returns {any[]} - ID-deduplicated observations.
 */
function deduplicateObservations(observations) {
  const byId = new Map();
  for (const observation of observations) {
    if (
      observation === null ||
      typeof observation !== 'object' ||
      Array.isArray(observation)
    ) {
      throw new TypeError('Hetzner provisioning inventory is invalid.');
    }
    const id = providerId(observation.id, 'hetznerProvisioning.inventory.id');
    byId.set(id, observation);
  }
  return [...byId.values()];
}

/**
 * Inventory by both exact name and exact ownership labels, including a held
 * exact ID when available so drift cannot disappear between filters.
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} resourceIntent - Resource intent.
 * @param {number|null} storedId - Optional held ID.
 * @param {Readonly<Record<string, Function>>} api - API methods.
 * @returns {Promise<{classification: Readonly<Record<string, any>>, observations: any[]}>} - Inventory.
 */
async function inventory(role, resourceIntent, storedId, api) {
  const config = ROLE_CONFIG[role];
  const ownership = resourceIntent.ownership;
  try {
    const reads = await Promise.all([
      api[config.list]({ name: ownership.name }),
      api[config.list]({
        labelSelector: ownershipLabelSelector(ownership.labels),
      }),
      storedId === null
        ? Promise.resolve(null)
        : api[config.get](storedId).catch((/** @type {unknown} */ error) => {
            if (
              error !== null &&
              typeof error === 'object' &&
              /** @type {Record<string, any>} */ (error).status === 404
            ) {
              return null;
            }
            throw error;
          }),
    ]);
    if (!Array.isArray(reads[0]) || !Array.isArray(reads[1])) {
      throw new TypeError('invalid list');
    }
    const observations = deduplicateObservations([
      ...reads[0],
      ...reads[1],
      ...(reads[2] === null ? [] : [reads[2]]),
    ]);
    const classification = classifyHetznerOwnershipMatches({
      ownership,
      storedResourceId: storedId,
      matches: observations.map((observation) => ({
        id: observation.id,
        name: observation.name,
        labels: observation.labels,
      })),
    });
    return { classification, observations };
  } catch (error) {
    if (error instanceof HetznerProvisioningConflictError) throw error;
    throw safeRoleError(
      'HETZNER_PROVISIONING_INVENTORY_FAILED',
      role,
      `Hetzner ${role} inventory could not be verified.`,
    );
  }
}

/**
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} classification - Classification.
 * @returns {number|null} - Exact ID, null when absent.
 */
function classifiedId(role, classification) {
  if (classification.status === 'conflict') {
    throw new HetznerProvisioningConflictError(
      role,
      classification.reason ?? 'provider-conflict',
    );
  }
  if (classification.status === 'exact') {
    return providerId(
      classification.providerResourceId,
      `hetznerProvisioning.${role}.providerResourceId`,
    );
  }
  if (classification.status === 'absent') return null;
  throw safeRoleError(
    'HETZNER_PROVISIONING_INVENTORY_FAILED',
    role,
    `Hetzner ${role} inventory could not be verified.`,
  );
}

/**
 * @param {string} role - Resource role.
 * @param {number} id - Exact provider ID.
 * @param {Readonly<Record<string, Function>>} api - API.
 * @returns {Promise<any>} - Exact readback.
 */
async function readback(role, id, api) {
  try {
    return await api[ROLE_CONFIG[role].get](id);
  } catch {
    throw safeRoleError(
      'HETZNER_PROVISIONING_READBACK_FAILED',
      role,
      `Hetzner ${role} readback could not be verified.`,
    );
  }
}

/**
 * @param {unknown} left - Left JSON value.
 * @param {unknown} right - Right JSON value.
 * @returns {boolean} - Canonical equality.
 */
function canonicalEqual(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * @param {any} observed - Firewall readback.
 * @param {Readonly<Record<string, any>>} resourceIntent - Intent.
 * @param {number|null} expectedServerId - Exact attached server, or none.
 * @returns {void}
 */
function verifyFirewall(observed, resourceIntent, expectedServerId) {
  const expected = resourceIntent.desiredSpec;
  const expectedTargets =
    expectedServerId === null
      ? []
      : [
          {
            type: 'server',
            serverId: expectedServerId,
            labelSelector: null,
            appliedToResources: [],
          },
        ];
  if (
    observed.name !== resourceIntent.ownership.name ||
    !canonicalEqual(observed.labels, resourceIntent.ownership.labels) ||
    !canonicalEqual(observed.rules, expected.rules)
  ) {
    throw safeRoleError(
      'HETZNER_PROVISIONING_SPEC_MISMATCH',
      'firewall',
      'Hetzner firewall readback does not match the persisted intent.',
    );
  }
  if (canonicalEqual(observed.appliedTo, expectedTargets)) return;
  if (expectedServerId !== null && canonicalEqual(observed.appliedTo, [])) {
    throw notSettledError('firewall');
  }
  throw safeRoleError(
    'HETZNER_PROVISIONING_SPEC_MISMATCH',
    'firewall',
    'Hetzner firewall readback does not match the persisted intent.',
  );
}

/**
 * @param {any} observed - Primary IP readback.
 * @param {Readonly<Record<string, any>>} resourceIntent - Intent.
 * @param {number|null} expectedAssigneeId - Exact server assignment, or none.
 * @returns {void}
 */
function verifyPrimaryIp(observed, resourceIntent, expectedAssigneeId) {
  const expected = resourceIntent.desiredSpec;
  if (
    observed.name !== resourceIntent.ownership.name ||
    !canonicalEqual(observed.labels, resourceIntent.ownership.labels) ||
    observed.type !== 'ipv4' ||
    observed.location?.id !== expected.location.id ||
    observed.location?.name !== expected.location.name ||
    typeof observed.ip !== 'string' ||
    observed.ip.length === 0 ||
    observed.autoDelete !== false ||
    observed.blocked !== false ||
    observed.deleteProtected !== false
  ) {
    throw safeRoleError(
      'HETZNER_PROVISIONING_SPEC_MISMATCH',
      'primaryIp',
      'Hetzner Primary IP readback does not match the persisted intent.',
    );
  }
  // Hetzner changes the projection for an unassigned Primary IP from
  // `server` to `unassigned` on 2026-08-01. Accept both only while no assignee
  // exists; an attached address must still name the server resource type.
  if (expectedAssigneeId === null) {
    if (
      observed.assigneeId === null &&
      ['server', 'unassigned'].includes(observed.assigneeType)
    ) {
      return;
    }
  } else {
    if (
      observed.assigneeId === expectedAssigneeId &&
      observed.assigneeType === 'server'
    ) {
      return;
    }
    if (
      observed.assigneeId === null &&
      ['server', 'unassigned'].includes(observed.assigneeType)
    ) {
      throw notSettledError('primaryIp');
    }
  }
  throw safeRoleError(
    'HETZNER_PROVISIONING_SPEC_MISMATCH',
    'primaryIp',
    'Hetzner Primary IP readback does not match the persisted intent.',
  );
}

/**
 * @param {any} observed - Server readback.
 * @param {Readonly<Record<string, any>>} resourceIntent - Intent.
 * @param {{firewall: {id: number}, primaryIp: {id: number, ip: string}}} dependencies - Allocated dependencies.
 * @returns {void}
 */
function verifyServer(observed, resourceIntent, dependencies) {
  const expected = resourceIntent.desiredSpec;
  if (
    observed.name !== resourceIntent.ownership.name ||
    !canonicalEqual(observed.labels, resourceIntent.ownership.labels) ||
    observed.location?.id !== expected.location.id ||
    observed.location?.name !== expected.location.name ||
    observed.serverType?.id !== expected.serverType.id ||
    observed.serverType?.name !== expected.serverType.name ||
    observed.image?.id !== expected.image.id ||
    observed.image?.name !== expected.image.name ||
    observed.publicIpv6 !== null ||
    observed.locked !== false ||
    observed.deleteProtected !== false
  ) {
    throw safeRoleError(
      'HETZNER_PROVISIONING_SPEC_MISMATCH',
      'server',
      'Hetzner server readback does not match the persisted intent.',
    );
  }
  const ipv4Settled =
    observed.publicIpv4?.id === dependencies.primaryIp.id &&
    observed.publicIpv4?.ip === dependencies.primaryIp.ip &&
    observed.publicIpv4?.blocked === false;
  if (observed.publicIpv4 !== null && !ipv4Settled) {
    throw safeRoleError(
      'HETZNER_PROVISIONING_SPEC_MISMATCH',
      'server',
      'Hetzner server readback does not match the persisted intent.',
    );
  }
  const firewallSettled = canonicalEqual(observed.firewalls, [
    { id: dependencies.firewall.id, status: 'applied' },
  ]);
  const firewallPending =
    canonicalEqual(observed.firewalls, []) ||
    canonicalEqual(observed.firewalls, [
      { id: dependencies.firewall.id, status: 'applying' },
    ]);
  if (!firewallSettled && !firewallPending) {
    throw safeRoleError(
      'HETZNER_PROVISIONING_SPEC_MISMATCH',
      'server',
      'Hetzner server readback does not match the persisted intent.',
    );
  }
  if (
    observed.publicIpv4 === null ||
    ['initializing', 'starting'].includes(observed.status) ||
    firewallPending
  ) {
    throw notSettledError('server');
  }
  if (observed.status !== 'running') {
    throw safeRoleError(
      'HETZNER_PROVISIONING_SPEC_MISMATCH',
      'server',
      'Hetzner server readback does not match the persisted intent.',
    );
  }
}

/**
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} resourceIntent - Resource intent.
 * @param {Readonly<Record<string, any>>} context - Allocated context.
 * @returns {Readonly<Record<string, any>>} - Exact provider create body.
 */
function createBody(role, resourceIntent, context) {
  const ownership = resourceIntent.ownership;
  const spec = resourceIntent.desiredSpec;
  if (role === 'firewall') {
    return deepFreeze({
      name: ownership.name,
      labels: ownership.labels,
      rules: spec.rules.map(
        (/** @type {Readonly<Record<string, any>>} */ rule) => ({
          direction: rule.direction,
          protocol: rule.protocol,
          port: rule.port,
          source_ips: rule.sourceIps,
        }),
      ),
    });
  }
  if (role === 'primaryIp') {
    return deepFreeze({
      name: ownership.name,
      type: 'ipv4',
      location: spec.location.name,
      auto_delete: false,
      labels: ownership.labels,
    });
  }
  return deepFreeze({
    name: ownership.name,
    labels: ownership.labels,
    server_type: spec.serverType.id,
    image: spec.image.id,
    location: spec.location.name,
    firewalls: [{ firewall: context.firewall.id }],
    public_net: {
      enable_ipv4: true,
      enable_ipv6: false,
      ipv4: context.primaryIp.id,
    },
    start_after_create: true,
    user_data: context.cloudInitText,
  });
}

/**
 * Parse one role-specific create response without retaining provider extras.
 * @param {string} role - Resource role.
 * @param {unknown} response - API creation response.
 * @returns {{id: number, actionIds: number[]}} - Creation evidence.
 */
function parseCreation(role, response) {
  if (response === null || typeof response !== 'object') {
    throw new TypeError('invalid creation');
  }
  const value = /** @type {Record<string, any>} */ (response);
  if (role === 'firewall') {
    if (!Array.isArray(value.actions)) throw new TypeError('invalid creation');
    return {
      id: providerId(value.firewall?.id, 'firewall.id'),
      actionIds: value.actions.map((action) =>
        providerId(action?.id, 'firewall.action.id'),
      ),
    };
  }
  if (role === 'primaryIp') {
    return {
      id: providerId(value.primaryIp?.id, 'primaryIp.id'),
      actionIds:
        value.action === null
          ? []
          : [providerId(value.action?.id, 'primaryIp.action.id')],
    };
  }
  if (!Array.isArray(value.nextActions)) {
    throw new TypeError('invalid creation');
  }
  return {
    id: providerId(value.server?.id, 'server.id'),
    actionIds: [
      providerId(value.action?.id, 'server.action.id'),
      ...value.nextActions.map((action) =>
        providerId(action?.id, 'server.nextAction.id'),
      ),
    ],
  };
}

/**
 * Extract the provider ID separately so malformed action evidence cannot
 * prevent immediate durable recording of an otherwise known resource.
 * @param {string} role - Resource role.
 * @param {unknown} response - API creation response.
 * @returns {number} - Exact created provider ID.
 */
function parseCreationResourceId(role, response) {
  if (response === null || typeof response !== 'object') {
    throw new TypeError('invalid creation');
  }
  const value = /** @type {Record<string, any>} */ (response);
  const key =
    role === 'firewall'
      ? 'firewall'
      : role === 'primaryIp'
        ? 'primaryIp'
        : 'server';
  return providerId(value[key]?.id, `${role}.id`);
}

/**
 * @param {string} role - Resource role.
 * @param {number[]} actionIds - Returned exact actions.
 * @param {(actionId: number) => Promise<any>} waitForAction - Wait authority.
 * @returns {Promise<void>} - Settles when all actions succeed.
 */
async function waitForActions(role, actionIds, waitForAction) {
  try {
    for (const actionId of new Set(actionIds)) {
      await waitForAction(actionId);
    }
  } catch {
    throw safeRoleError(
      'HETZNER_PROVISIONING_ACTION_FAILED',
      role,
      `Hetzner ${role} action did not complete successfully.`,
    );
  }
}

/**
 * @param {Readonly<Record<string, any>>} intent - Provisioning intent.
 * @param {string} role - Resource role.
 * @param {number} id - Exact provider ID.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordResource - Durable callback.
 * @returns {Promise<void>} - Settles after durable record.
 */
async function recordId(intent, role, id, recordResource) {
  const record = createCanonicalProvisionedResourceRecord(intent, role, id);
  try {
    await recordResource(record);
  } catch {
    throw safeRoleError(
      'HETZNER_PROVISIONING_RECORD_FAILED',
      role,
      `Hetzner ${role} provider ID could not be recorded durably.`,
    );
  }
}

/**
 * Persist the deterministic create fence before issuing the provider POST.
 * @param {Readonly<Record<string, any>>} attempt - Exact attempt evidence.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordMutationAttempt - Durable callback.
 * @returns {Promise<void>} - Settles only after durable persistence.
 */
async function recordAttempt(attempt, recordMutationAttempt) {
  try {
    await recordMutationAttempt(attempt);
  } catch {
    throw safeRoleError(
      'HETZNER_PROVISIONING_ATTEMPT_RECORD_FAILED',
      attempt.role,
      `Hetzner ${attempt.role} mutation attempt could not be recorded durably.`,
    );
  }
}

/**
 * Ensure one role, creating at most once and recovering ambiguity only through
 * inventory.
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} intent - Provisioning intent.
 * @param {number|null} storedId - Optional held ID.
 * @param {Readonly<Record<string, any>>|null} storedAttempt - Optional durable create fence.
 * @param {Readonly<Record<string, Function>>} api - API.
 * @param {(actionId: number) => Promise<any>} waitForAction - Action waiter.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordMutationAttempt - Attempt recorder.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordResource - Resource recorder.
 * @param {Readonly<Record<string, any>>} context - Allocated dependencies.
 * @returns {Promise<any>} - Verified provider observation.
 */
async function ensureResource(
  role,
  intent,
  storedId,
  storedAttempt,
  api,
  waitForAction,
  recordMutationAttempt,
  recordResource,
  context,
) {
  const resourceIntent = intent.resources[role];
  let observedInventory = await inventory(role, resourceIntent, storedId, api);
  let id = classifiedId(role, observedInventory.classification);
  let creation;
  if (id === null) {
    if (storedAttempt !== null) {
      throw safeRoleError(
        'HETZNER_PROVISIONING_RECOVERY_REQUIRED',
        role,
        `Hetzner ${role} has a durable mutation attempt but no recoverable resource.`,
      );
    }
    const attempt = createCanonicalMutationAttempt(intent, role);
    await recordAttempt(attempt, recordMutationAttempt);
    let responseId = null;
    try {
      const response = await api[ROLE_CONFIG[role].create](
        createBody(role, resourceIntent, context),
      );
      responseId = parseCreationResourceId(role, response);
      creation = parseCreation(role, response);
    } catch {
      if (responseId !== null) {
        id = responseId;
      } else {
        observedInventory = await inventory(
          role,
          resourceIntent,
          storedId,
          api,
        );
        id = classifiedId(role, observedInventory.classification);
        if (id === null) {
          throw safeRoleError(
            'HETZNER_PROVISIONING_MUTATION_UNRESOLVED',
            role,
            `Hetzner ${role} mutation could not be recovered from inventory.`,
          );
        }
      }
    }
  }
  await recordId(
    intent,
    role,
    /** @type {number} */ (id ?? creation?.id),
    recordResource,
  );
  if (creation !== undefined) {
    id = creation.id;
    await waitForActions(role, creation.actionIds, waitForAction);
    observedInventory = await inventory(role, resourceIntent, id, api);
    const readbackId = classifiedId(role, observedInventory.classification);
    if (readbackId === null || readbackId !== id) {
      throw safeRoleError(
        'HETZNER_PROVISIONING_READBACK_FAILED',
        role,
        `Hetzner ${role} readback could not be verified.`,
      );
    }
  }
  const observed = await readback(role, /** @type {number} */ (id), api);
  if (role === 'firewall') {
    verifyFirewall(observed, resourceIntent, context.expectedServerId);
  } else if (role === 'primaryIp') {
    verifyPrimaryIp(observed, resourceIntent, context.expectedServerId);
  } else {
    verifyServer(observed, resourceIntent, {
      firewall: context.firewall,
      primaryIp: context.primaryIp,
    });
  }
  return observed;
}

/**
 * Converge the exact three-resource Hetzner preview substrate.
 * @param {unknown} value - Persisted intent, held cloud-init, recovery IDs, and effects.
 * @returns {Promise<Readonly<Record<string, any>>>} - Secret-free provider result.
 */
export async function convergeHetznerSingleNodeProvisioning(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerProvisioning convergence input is invalid.');
  }
  /** @type {Record<string, any>} */
  const input = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !CONVERGE_KEYS.has(key)) {
      throw new TypeError(
        'hetznerProvisioning convergence contains an unsupported field.',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('hetznerProvisioning convergence input is invalid.');
    }
    input[key] = descriptor.value;
  }
  for (const key of [
    'intent',
    'cloudInitBytes',
    'api',
    'waitForAction',
    'recordMutationAttempt',
    'recordResource',
  ]) {
    if (!Object.hasOwn(input, key)) {
      throw new TypeError(
        `hetznerProvisioning convergence.${key} is required.`,
      );
    }
  }
  const intent = validateHetznerSingleNodeProvisioningIntent(input.intent);
  const api = snapshotApi(input.api);
  if (
    typeof input.waitForAction !== 'function' ||
    typeof input.recordMutationAttempt !== 'function' ||
    typeof input.recordResource !== 'function'
  ) {
    throw new TypeError('hetznerProvisioning callbacks must be functions.');
  }
  const waitForAction = input.waitForAction;
  const recordMutationAttempt = input.recordMutationAttempt;
  const recordResource = input.recordResource;
  if (!(input.cloudInitBytes instanceof Uint8Array)) {
    throw new TypeError('hetznerProvisioning.cloudInitBytes must be bytes.');
  }
  // Copy before the first await. A Buffer view over caller-owned memory would
  // let the cloud-init bytes change after their persisted digest was checked.
  const cloudInitBytes = Buffer.from(input.cloudInitBytes);
  if (
    cloudInitBytes.byteLength === 0 ||
    cloudInitBytes.byteLength > SINGLE_NODE_CLOUD_INIT_MAX_BYTES ||
    sha256Base64Url(cloudInitBytes) !== intent.cloudInitDigest.value
  ) {
    throw new Error(
      'hetznerProvisioning.cloudInitBytes do not match the persisted digest.',
    );
  }
  let cloudInitText;
  try {
    cloudInitText = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(cloudInitBytes);
    if (!Buffer.from(cloudInitText, 'utf8').equals(cloudInitBytes)) {
      throw new TypeError('non-round-tripping UTF-8');
    }
  } catch {
    throw new TypeError(
      'hetznerProvisioning.cloudInitBytes must be exact UTF-8 text.',
    );
  }
  const storedIds = storedResourceIds(input.storedResourceIds);
  const storedAttempts = storedMutationAttempts(
    input.storedMutationAttempts,
    intent,
  );
  const existingServerInventory = await inventory(
    'server',
    intent.resources.server,
    storedIds.server,
    api,
  );
  const expectedServerId = classifiedId(
    'server',
    existingServerInventory.classification,
  );
  /** @type {Record<string, any>} */
  const context = {
    cloudInitText,
    expectedServerId,
  };

  const firewall = await ensureResource(
    'firewall',
    intent,
    storedIds.firewall,
    storedAttempts.firewall,
    api,
    waitForAction,
    recordMutationAttempt,
    recordResource,
    context,
  );
  context.firewall = { id: firewall.id };

  const primaryIp = await ensureResource(
    'primaryIp',
    intent,
    storedIds.primaryIp,
    storedAttempts.primaryIp,
    api,
    waitForAction,
    recordMutationAttempt,
    recordResource,
    context,
  );
  context.primaryIp = { id: primaryIp.id, ip: primaryIp.ip };

  const server = await ensureResource(
    'server',
    intent,
    storedIds.server,
    storedAttempts.server,
    api,
    waitForAction,
    recordMutationAttempt,
    recordResource,
    context,
  );
  const finalFirewall = await readback('firewall', firewall.id, api);
  verifyFirewall(
    finalFirewall,
    intent.resources.firewall,
    providerId(server.id, 'hetznerProvisioning.server.id'),
  );
  const finalPrimaryIp = await readback('primaryIp', primaryIp.id, api);
  verifyPrimaryIp(
    finalPrimaryIp,
    intent.resources.primaryIp,
    providerId(server.id, 'hetznerProvisioning.server.id'),
  );
  const result = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: PROVISIONING_RESULT_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      providerSpecId: intent.plan.providerSpec.providerSpecId,
      desiredRevisionId: intent.plan.desired.desiredRevisionId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      resources: {
        firewallId: firewall.id,
        primaryIpId: primaryIp.id,
        serverId: server.id,
      },
      publicIpv4: primaryIp.ip,
      status: 'provisioned',
    }),
  );
  assertSingleNodeDeploymentInstanceId(
    result.deploymentInstanceId,
    'hetznerProvisioning.result.deploymentInstanceId',
  );
  assertManifestIsSecretFree(result, 'hetznerProvisioning.result');
  return result;
}

export default {
  HETZNER_PROVISIONING_INTENT_ID_PREFIX,
  HETZNER_PROVISIONING_INTENT_KIND,
  HETZNER_PROVISIONING_INTENT_SCHEMA_VERSION,
  HETZNER_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
  HETZNER_PROVISIONING_MUTATION_ATTEMPT_KIND,
  HETZNER_PROVISIONING_MUTATION_ATTEMPT_SCHEMA_VERSION,
  HETZNER_PROVISIONED_RESOURCE_KIND,
  HETZNER_PROVISIONED_RESOURCE_SCHEMA_VERSION,
  convergeHetznerSingleNodeProvisioning,
  createHetznerProvisionedResourceRecord,
  createHetznerProvisioningMutationAttempt,
  createHetznerSingleNodeProvisioningIntent,
  validateHetznerProvisionedResourceRecord,
  validateHetznerProvisioningMutationAttempt,
  validateHetznerSingleNodeProvisioningIntent,
};
