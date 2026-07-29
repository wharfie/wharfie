import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import {
  classifyHetznerOwnershipMatches,
  validateHetznerOwnership,
} from './ownership.js';
import { validateHetznerSingleNodeProvisioningIntent } from './single-node-provisioning.js';

export const HETZNER_DESTRUCTION_ATTEMPT_SCHEMA_VERSION = 1;
export const HETZNER_DESTRUCTION_ATTEMPT_KIND =
  'hetznerDestructionMutationAttempt';
export const HETZNER_DESTRUCTION_ATTEMPT_ID_PREFIX = 'wshda1';
export const HETZNER_DELETION_RECORD_SCHEMA_VERSION = 1;
export const HETZNER_DELETION_RECORD_KIND = 'hetznerResourceDeletion';
export const HETZNER_DELETION_RECORD_ID_PREFIX = 'wshdd1';

const DESTRUCTION_ATTEMPT_ID_DOMAIN =
  'wharfie:hetzner-destruction-mutation-attempt:v1';
const DELETION_RECORD_ID_DOMAIN = 'wharfie:hetzner-resource-deletion:v1';
const EVIDENCE_MAX_BYTES = 16 * 1024;
const DESTRUCTION_RESULT_KIND = 'hetznerSingleNodeDestructionResult';
const RESOURCE_ROLES = Object.freeze(['server', 'primaryIp', 'firewall']);
const RESOURCE_ROLE_SET = new Set(RESOURCE_ROLES);
const STORED_RESOURCE_KEYS = new Set(RESOURCE_ROLES);
const CONVERGE_KEYS = new Set([
  'intent',
  'storedResourceIds',
  'storedDestroyAttempts',
  'storedDeletionRecords',
  'api',
  'waitForAction',
  'recordDestroyAttempt',
  'recordDeletion',
]);
const ATTEMPT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'attemptId',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'role',
  'operation',
  'providerResourceId',
  'ownershipName',
  'desiredStateDigest',
]);
const DELETION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'deletionId',
  'destroyAttemptId',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'role',
  'operation',
  'providerResourceId',
  'ownershipName',
  'desiredStateDigest',
  'state',
]);
const API_METHODS = Object.freeze([
  'listServers',
  'getServer',
  'deleteServer',
  'listPrimaryIps',
  'getPrimaryIp',
  'deletePrimaryIp',
  'listFirewalls',
  'getFirewall',
  'deleteFirewall',
]);
/** @type {Readonly<Record<string, Readonly<{list: string, get: string, remove: string}>>>} */
const ROLE_CONFIG = Object.freeze({
  server: Object.freeze({
    list: 'listServers',
    get: 'getServer',
    remove: 'deleteServer',
  }),
  primaryIp: Object.freeze({
    list: 'listPrimaryIps',
    get: 'getPrimaryIp',
    remove: 'deletePrimaryIp',
  }),
  firewall: Object.freeze({
    list: 'listFirewalls',
    get: 'getFirewall',
    remove: 'deleteFirewall',
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
 * @param {unknown} value - Candidate provider ID.
 * @param {string} valuePath - Human-readable path.
 * @returns {number} - Positive provider ID.
 */
function providerId(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} value - Candidate role.
 * @param {string} valuePath - Human-readable path.
 * @returns {string} - Validated role.
 */
function resourceRole(value, valuePath) {
  if (typeof value !== 'string' || !RESOURCE_ROLE_SET.has(value)) {
    throw new TypeError(`${valuePath} is not supported.`);
  }
  return value;
}

/**
 * @param {unknown} left - First canonical value.
 * @param {unknown} right - Second canonical value.
 * @returns {boolean} - Whether values are canonically equal.
 */
function canonicalEqual(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/**
 * @param {Readonly<Record<string, any>>} intent - Validated intent.
 * @param {string} role - Validated role.
 * @returns {Readonly<Record<string, any>>} - Exact resource intent.
 */
function resourceIntent(intent, role) {
  return intent.resources[role];
}

/**
 * @param {Readonly<Record<string, any>>} intent - Validated intent.
 * @param {string} role - Validated role.
 * @param {number} id - Exact provider resource ID.
 * @returns {Readonly<Record<string, any>>} - Attempt payload.
 */
function attemptPayload(intent, role, id) {
  const ownership = resourceIntent(intent, role).ownership;
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_DESTRUCTION_ATTEMPT_SCHEMA_VERSION,
      kind: HETZNER_DESTRUCTION_ATTEMPT_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      role,
      operation: 'delete',
      providerResourceId: id,
      ownershipName: ownership.name,
      desiredStateDigest: ownership.desiredStateDigest,
    }),
  );
}

/**
 * Create the durable exact-ID fence that must precede a provider DELETE.
 * @param {unknown} intent - Exact provisioning intent.
 * @param {unknown} role - Resource role.
 * @param {unknown} providerResourceId - Persisted provider ID.
 * @returns {Readonly<Record<string, any>>} - Canonical attempt evidence.
 */
export function createHetznerDestructionAttempt(
  intent,
  role,
  providerResourceId,
) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  const canonicalRole = resourceRole(role, 'hetznerDestruction.attempt.role');
  const id = providerId(
    providerResourceId,
    'hetznerDestruction.attempt.providerResourceId',
  );
  const payload = attemptPayload(canonicalIntent, canonicalRole, id);
  const attemptId = createCanonicalJsonSha256Id({
    domain: DESTRUCTION_ATTEMPT_ID_DOMAIN,
    prefix: HETZNER_DESTRUCTION_ATTEMPT_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerDestruction.attempt',
  });
  const result = deepFreeze(sortCanonicalJsonValue({ ...payload, attemptId }));
  assertManifestIsSecretFree(result, 'hetznerDestruction.attempt');
  return result;
}

/**
 * Validate persisted attempt evidence against exact durable authority.
 * @param {unknown} value - Candidate evidence.
 * @param {unknown} intent - Exact provisioning intent.
 * @param {unknown} [role] - Optional required role.
 * @param {unknown} [providerResourceId] - Optional required provider ID.
 * @param {string} [valuePath] - Safe boundary path.
 * @returns {Readonly<Record<string, any>>} - Canonical attempt.
 */
export function validateHetznerDestructionAttempt(
  value,
  intent,
  role,
  providerResourceId,
  valuePath = 'hetznerDestruction.attempt',
) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  const document = cloneBoundedJsonObject(value, EVIDENCE_MAX_BYTES, valuePath);
  assertExactKeys(document, ATTEMPT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.attemptId,
    HETZNER_DESTRUCTION_ATTEMPT_ID_PREFIX,
    `${valuePath}.attemptId`,
  );
  const expectedRole = resourceRole(role ?? document.role, `${valuePath}.role`);
  const expectedId = providerId(
    providerResourceId ?? document.providerResourceId,
    `${valuePath}.providerResourceId`,
  );
  const expected = createHetznerDestructionAttempt(
    canonicalIntent,
    expectedRole,
    expectedId,
  );
  if (!canonicalEqual(document, expected)) {
    throw new Error(`${valuePath} does not match its exact destroy authority.`);
  }
  return expected;
}

/**
 * @param {Readonly<Record<string, any>>} intent - Validated intent.
 * @param {string} role - Validated role.
 * @param {number} id - Exact provider ID.
 * @param {string|null} attemptId - Optional persisted DELETE fence.
 * @returns {Readonly<Record<string, any>>} - Deletion payload.
 */
function deletionPayload(intent, role, id, attemptId) {
  const ownership = resourceIntent(intent, role).ownership;
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: HETZNER_DELETION_RECORD_SCHEMA_VERSION,
      kind: HETZNER_DELETION_RECORD_KIND,
      destroyAttemptId: attemptId,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      role,
      operation: 'delete',
      providerResourceId: id,
      ownershipName: ownership.name,
      desiredStateDigest: ownership.desiredStateDigest,
      state: 'absent',
    }),
  );
}

/**
 * Create durable evidence that one exact owned provider ID is absent.
 * @param {unknown} intent - Exact provisioning intent.
 * @param {unknown} role - Resource role.
 * @param {unknown} providerResourceId - Persisted provider ID.
 * @param {unknown} destroyAttempt - Exact attempt, or null when already absent.
 * @returns {Readonly<Record<string, any>>} - Canonical deletion record.
 */
export function createHetznerDeletionRecord(
  intent,
  role,
  providerResourceId,
  destroyAttempt,
) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  const canonicalRole = resourceRole(role, 'hetznerDestruction.deletion.role');
  const id = providerId(
    providerResourceId,
    'hetznerDestruction.deletion.providerResourceId',
  );
  const attempt =
    destroyAttempt === null
      ? null
      : validateHetznerDestructionAttempt(
          destroyAttempt,
          canonicalIntent,
          canonicalRole,
          id,
          'hetznerDestruction.deletion.destroyAttempt',
        );
  const payload = deletionPayload(
    canonicalIntent,
    canonicalRole,
    id,
    attempt?.attemptId ?? null,
  );
  const deletionId = createCanonicalJsonSha256Id({
    domain: DELETION_RECORD_ID_DOMAIN,
    prefix: HETZNER_DELETION_RECORD_ID_PREFIX,
    value: payload,
    valuePath: 'hetznerDestruction.deletion',
  });
  const result = deepFreeze(sortCanonicalJsonValue({ ...payload, deletionId }));
  assertManifestIsSecretFree(result, 'hetznerDestruction.deletion');
  return result;
}

/**
 * Validate durable absence evidence against exact authority.
 * @param {unknown} value - Candidate deletion record.
 * @param {unknown} intent - Exact provisioning intent.
 * @param {unknown} [role] - Optional required role.
 * @param {unknown} [providerResourceId] - Optional required provider ID.
 * @param {unknown} [destroyAttempt] - Expected attempt or null.
 * @param {string} [valuePath] - Safe boundary path.
 * @returns {Readonly<Record<string, any>>} - Canonical deletion record.
 */
export function validateHetznerDeletionRecord(
  value,
  intent,
  role,
  providerResourceId,
  destroyAttempt,
  valuePath = 'hetznerDestruction.deletion',
) {
  const canonicalIntent = validateHetznerSingleNodeProvisioningIntent(intent);
  const document = cloneBoundedJsonObject(value, EVIDENCE_MAX_BYTES, valuePath);
  assertExactKeys(document, DELETION_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.deletionId,
    HETZNER_DELETION_RECORD_ID_PREFIX,
    `${valuePath}.deletionId`,
  );
  const expectedRole = resourceRole(role ?? document.role, `${valuePath}.role`);
  const expectedId = providerId(
    providerResourceId ?? document.providerResourceId,
    `${valuePath}.providerResourceId`,
  );
  let expectedAttempt = null;
  if (destroyAttempt !== undefined) {
    expectedAttempt =
      destroyAttempt === null
        ? null
        : validateHetznerDestructionAttempt(
            destroyAttempt,
            canonicalIntent,
            expectedRole,
            expectedId,
            `${valuePath}.destroyAttempt`,
          );
  } else if (document.destroyAttemptId !== null) {
    throw new Error(
      `${valuePath} requires the exact persisted destroy attempt.`,
    );
  }
  const expected = createHetznerDeletionRecord(
    canonicalIntent,
    expectedRole,
    expectedId,
    expectedAttempt,
  );
  if (!canonicalEqual(document, expected)) {
    throw new Error(`${valuePath} does not match its exact destroy authority.`);
  }
  return expected;
}

/** A safe exact-ownership conflict. */
export class HetznerDestructionConflictError extends Error {
  /**
   * @param {string} role - Resource role.
   * @param {string} reason - Safe conflict reason.
   */
  constructor(role, reason) {
    super(`Hetzner ${role} destruction encountered a provider conflict.`);
    this.name = 'HetznerDestructionConflictError';
    this.code = 'HETZNER_DESTRUCTION_CONFLICT';
    this.role = role;
    this.reason = reason;
  }
}

/**
 * @param {string} code - Stable code.
 * @param {string} role - Resource role.
 * @param {string} message - Safe fixed message.
 * @returns {Error & {code: string, role: string}} - Safe role error.
 */
function safeRoleError(code, role, message) {
  const error = /** @type {Error & {code: string, role: string}} */ (
    new Error(message)
  );
  error.name = 'HetznerDestructionError';
  error.code = code;
  error.role = role;
  return error;
}

/**
 * @param {unknown} error - Candidate provider error.
 * @returns {boolean} - Whether the exact provider ID is absent.
 */
function isNotFound(error) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {{status?: unknown}} */ (error).status === 404
  );
}

/**
 * @param {unknown} value - Candidate API object.
 * @returns {Readonly<Record<string, Function>>} - Snapshotted bound methods.
 */
function snapshotApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerDestruction.api must be an API client.');
  }
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of API_METHODS) {
    const candidate = /** @type {Record<string, any>} */ (value)[method];
    if (typeof candidate !== 'function') {
      throw new TypeError(`hetznerDestruction.api.${method} is required.`);
    }
    result[method] = candidate.bind(value);
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value - Exact required stored ID object.
 * @returns {Readonly<Record<string, number|null>>} - Canonical IDs.
 */
function storedResourceIds(value) {
  const document = cloneBoundedJsonObject(
    value,
    4096,
    'hetznerDestruction.storedResourceIds',
  );
  assertExactKeys(
    document,
    STORED_RESOURCE_KEYS,
    'hetznerDestruction.storedResourceIds',
  );
  /** @type {Record<string, number|null>} */
  const result = {};
  for (const role of RESOURCE_ROLES) {
    result[role] =
      document[role] === null
        ? null
        : providerId(
            document[role],
            `hetznerDestruction.storedResourceIds.${role}`,
          );
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value - Optional exact per-role records.
 * @param {string} valuePath - Boundary path.
 * @returns {Record<string, unknown>} - Exact raw record map.
 */
function storedEvidenceMap(value, valuePath) {
  if (value === undefined) {
    return { server: null, primaryIp: null, firewall: null };
  }
  const document = cloneBoundedJsonObject(value, 64 * 1024, valuePath);
  assertExactKeys(document, STORED_RESOURCE_KEYS, valuePath);
  return document;
}

/**
 * @param {unknown} value - Optional attempts.
 * @param {Readonly<Record<string, any>>} intent - Exact intent.
 * @param {Readonly<Record<string, number|null>>} ids - Exact stored IDs.
 * @returns {Readonly<Record<string, Readonly<Record<string, any>>|null>>} - Attempts.
 */
function storedAttempts(value, intent, ids) {
  const document = storedEvidenceMap(
    value,
    'hetznerDestruction.storedDestroyAttempts',
  );
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const result = {};
  for (const role of RESOURCE_ROLES) {
    if (document[role] === null) {
      result[role] = null;
      continue;
    }
    if (ids[role] === null) {
      throw new Error(
        `hetznerDestruction.storedDestroyAttempts.${role} requires a stored provider ID.`,
      );
    }
    result[role] = validateHetznerDestructionAttempt(
      document[role],
      intent,
      role,
      ids[role],
      `hetznerDestruction.storedDestroyAttempts.${role}`,
    );
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value - Optional deletion records.
 * @param {Readonly<Record<string, any>>} intent - Exact intent.
 * @param {Readonly<Record<string, number|null>>} ids - Exact stored IDs.
 * @param {Readonly<Record<string, Readonly<Record<string, any>>|null>>} attempts - Exact attempts.
 * @returns {Readonly<Record<string, Readonly<Record<string, any>>|null>>} - Records.
 */
function storedDeletions(value, intent, ids, attempts) {
  const document = storedEvidenceMap(
    value,
    'hetznerDestruction.storedDeletionRecords',
  );
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const result = {};
  for (const role of RESOURCE_ROLES) {
    if (document[role] === null) {
      result[role] = null;
      continue;
    }
    if (ids[role] === null) {
      throw new Error(
        `hetznerDestruction.storedDeletionRecords.${role} requires a stored provider ID.`,
      );
    }
    result[role] = validateHetznerDeletionRecord(
      document[role],
      intent,
      role,
      ids[role],
      attempts[role],
      `hetznerDestruction.storedDeletionRecords.${role}`,
    );
  }
  return Object.freeze(result);
}

/**
 * @param {Readonly<Record<string, string>>} labels - Exact labels.
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
      throw new TypeError('invalid inventory');
    }
    const id = providerId(observation.id, 'hetznerDestruction.inventory.id');
    byId.set(id, observation);
  }
  return [...byId.values()];
}

/**
 * Read one exact ID, converting only provider 404 to absence.
 * @param {string} role - Resource role.
 * @param {number} id - Exact ID.
 * @param {Readonly<Record<string, Function>>} api - API methods.
 * @returns {Promise<any|null>} - Observation or null.
 */
async function getById(role, id, api) {
  try {
    return await api[ROLE_CONFIG[role].get](id);
  } catch (error) {
    if (isNotFound(error)) return null;
    throw safeRoleError(
      'HETZNER_DESTRUCTION_READ_FAILED',
      role,
      `Hetzner ${role} ownership readback failed.`,
    );
  }
}

/**
 * Classify current provider inventory against exact persisted ownership.
 * The stored ID is an input to classification, never discovered authority.
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} intent - Exact intent.
 * @param {number|null} id - Persisted ID, or null.
 * @param {Readonly<Record<string, Function>>} api - API methods.
 * @returns {Promise<Readonly<Record<string, any>>>} - Safe classification.
 */
async function classifyCurrent(role, intent, id, api) {
  const ownership = validateHetznerOwnership(
    resourceIntent(intent, role).ownership,
    `hetznerDestruction.${role}.ownership`,
  );
  let reads;
  try {
    reads = await Promise.all([
      api[ROLE_CONFIG[role].list]({ name: ownership.name }),
      api[ROLE_CONFIG[role].list]({
        labelSelector: ownershipLabelSelector(ownership.labels),
      }),
      id === null ? Promise.resolve(null) : getById(role, id, api),
    ]);
  } catch (error) {
    if (
      error !== null &&
      typeof error === 'object' &&
      /** @type {{code?: unknown}} */ (error).code ===
        'HETZNER_DESTRUCTION_READ_FAILED'
    ) {
      throw error;
    }
    throw safeRoleError(
      'HETZNER_DESTRUCTION_READ_FAILED',
      role,
      `Hetzner ${role} ownership inventory failed.`,
    );
  }
  const [byName, byLabels, byId] = reads;
  if (!Array.isArray(byName) || !Array.isArray(byLabels)) {
    throw safeRoleError(
      'HETZNER_DESTRUCTION_READ_FAILED',
      role,
      `Hetzner ${role} ownership inventory failed.`,
    );
  }
  let observations;
  try {
    observations = deduplicateObservations([
      ...byName,
      ...byLabels,
      ...(byId === null ? [] : [byId]),
    ]);
  } catch {
    throw safeRoleError(
      'HETZNER_DESTRUCTION_READ_FAILED',
      role,
      `Hetzner ${role} ownership inventory failed.`,
    );
  }
  try {
    return classifyHetznerOwnershipMatches({
      ownership,
      storedResourceId: id,
      matches: observations.map((observation) => ({
        id: observation.id,
        name: observation.name,
        labels: observation.labels,
      })),
    });
  } catch {
    throw safeRoleError(
      'HETZNER_DESTRUCTION_READ_FAILED',
      role,
      `Hetzner ${role} ownership inventory failed.`,
    );
  }
}

/**
 * Require an exact owned match, or return false for proven absence.
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} classification - Classification.
 * @returns {boolean} - Whether the exact resource exists.
 */
function requireExactOrAbsent(role, classification) {
  if (classification.status === 'absent') return false;
  if (classification.status === 'exact') return true;
  throw new HetznerDestructionConflictError(
    role,
    typeof classification.reason === 'string'
      ? classification.reason
      : 'ownership-mismatch',
  );
}

/**
 * @param {Readonly<Record<string, any>>} attempt - Exact attempt.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} callback - Durable recorder.
 * @returns {Promise<void>} - Settles after persistence.
 */
async function persistAttempt(attempt, callback) {
  try {
    await callback(attempt);
  } catch {
    throw safeRoleError(
      'HETZNER_DESTRUCTION_ATTEMPT_RECORD_FAILED',
      attempt.role,
      `Hetzner ${attempt.role} destroy attempt could not be recorded durably.`,
    );
  }
}

/**
 * @param {Readonly<Record<string, any>>} record - Exact deletion record.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} callback - Durable recorder.
 * @returns {Promise<void>} - Settles after persistence.
 */
async function persistDeletion(record, callback) {
  try {
    await callback(record);
  } catch {
    throw safeRoleError(
      'HETZNER_DESTRUCTION_DELETION_RECORD_FAILED',
      record.role,
      `Hetzner ${record.role} absence could not be recorded durably.`,
    );
  }
}

/**
 * Parse an optional exact action ID from one delete response.
 * @param {unknown} value - API response.
 * @returns {number|null} - Action ID, or null for a 204 response.
 */
function deletionActionId(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('invalid deletion response');
  }
  return providerId(
    /** @type {Record<string, any>} */ (value).id,
    'hetznerDestruction.action.id',
  );
}

/**
 * Establish absence after one provider mutation, then persist it immediately.
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} intent - Exact intent.
 * @param {number} id - Exact ID.
 * @param {Readonly<Record<string, any>>} attempt - Exact delete attempt.
 * @param {Readonly<Record<string, Function>>} api - API methods.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordDeletion - Durable recorder.
 * @param {string} unresolvedCode - Code when the resource remains.
 * @returns {Promise<Readonly<Record<string, any>>>} - Deletion evidence.
 */
async function establishAbsence(
  role,
  intent,
  id,
  attempt,
  api,
  recordDeletion,
  unresolvedCode,
) {
  const classification = await classifyCurrent(role, intent, id, api);
  if (requireExactOrAbsent(role, classification)) {
    throw safeRoleError(
      unresolvedCode,
      role,
      `Hetzner ${role} deletion has not established absence yet.`,
    );
  }
  const deletion = createHetznerDeletionRecord(intent, role, id, attempt);
  await persistDeletion(deletion, recordDeletion);
  return deletion;
}

/**
 * Destroy one exact owned resource, safely resuming prior evidence.
 * @param {string} role - Resource role.
 * @param {Readonly<Record<string, any>>} intent - Exact intent.
 * @param {number|null} id - Persisted provider ID.
 * @param {Readonly<Record<string, any>>|null} storedAttempt - Prior attempt.
 * @param {Readonly<Record<string, any>>|null} storedDeletion - Prior deletion.
 * @param {Readonly<Record<string, Function>>} api - API methods.
 * @param {(actionId: number) => Promise<any>} waitForAction - Bounded waiter.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordDestroyAttempt - Attempt recorder.
 * @param {(record: Readonly<Record<string, any>>) => Promise<any>} recordDeletion - Deletion recorder.
 * @returns {Promise<Readonly<Record<string, any>>|null>} - Deletion evidence.
 */
async function destroyResource(
  role,
  intent,
  id,
  storedAttempt,
  storedDeletion,
  api,
  waitForAction,
  recordDestroyAttempt,
  recordDeletion,
) {
  const initial = await classifyCurrent(role, intent, id, api);
  const exists = requireExactOrAbsent(role, initial);
  if (id === null) {
    if (exists) {
      throw safeRoleError(
        'HETZNER_DESTRUCTION_RESOURCE_ID_REQUIRED',
        role,
        `Hetzner ${role} cannot be deleted without a persisted provider ID.`,
      );
    }
    return null;
  }
  if (storedDeletion !== null) {
    if (exists) {
      throw safeRoleError(
        'HETZNER_DESTRUCTION_RESOURCE_REAPPEARED',
        role,
        `Hetzner ${role} exists after durable absence was recorded.`,
      );
    }
    return storedDeletion;
  }
  if (!exists) {
    const deletion = createHetznerDeletionRecord(
      intent,
      role,
      id,
      storedAttempt,
    );
    await persistDeletion(deletion, recordDeletion);
    return deletion;
  }

  const attempt =
    storedAttempt ?? createHetznerDestructionAttempt(intent, role, id);
  if (storedAttempt === null) {
    await persistAttempt(attempt, recordDestroyAttempt);
  }

  let response;
  try {
    response = await api[ROLE_CONFIG[role].remove](id);
  } catch {
    return establishAbsence(
      role,
      intent,
      id,
      attempt,
      api,
      recordDeletion,
      'HETZNER_DESTRUCTION_MUTATION_UNRESOLVED',
    );
  }

  let actionId;
  try {
    actionId = deletionActionId(response);
  } catch {
    return establishAbsence(
      role,
      intent,
      id,
      attempt,
      api,
      recordDeletion,
      'HETZNER_DESTRUCTION_MUTATION_UNRESOLVED',
    );
  }
  if (actionId !== null) {
    try {
      await waitForAction(actionId);
    } catch {
      return establishAbsence(
        role,
        intent,
        id,
        attempt,
        api,
        recordDeletion,
        'HETZNER_DESTRUCTION_ACTION_UNRESOLVED',
      );
    }
  }
  return establishAbsence(
    role,
    intent,
    id,
    attempt,
    api,
    recordDeletion,
    'HETZNER_DESTRUCTION_NOT_SETTLED',
  );
}

/**
 * Converge exact Hetzner single-node resource destruction. The fixed order is
 * server, verified absent; Primary IP, verified absent; firewall, verified
 * absent.
 * @param {unknown} value - Exact intent, persisted recovery state, and effects.
 * @returns {Promise<Readonly<Record<string, any>>>} - Secret-free result.
 */
export async function convergeHetznerSingleNodeDestruction(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('hetznerDestruction convergence input is invalid.');
  }
  /** @type {Record<string, any>} */
  const input = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !CONVERGE_KEYS.has(key)) {
      throw new TypeError(
        'hetznerDestruction convergence contains an unsupported field.',
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError('hetznerDestruction convergence input is invalid.');
    }
    input[key] = descriptor.value;
  }
  for (const key of [
    'intent',
    'storedResourceIds',
    'api',
    'waitForAction',
    'recordDestroyAttempt',
    'recordDeletion',
  ]) {
    if (!Object.hasOwn(input, key)) {
      throw new TypeError(`hetznerDestruction convergence.${key} is required.`);
    }
  }
  const intent = validateHetznerSingleNodeProvisioningIntent(input.intent);
  const ids = storedResourceIds(input.storedResourceIds);
  const attempts = storedAttempts(input.storedDestroyAttempts, intent, ids);
  const deletions = storedDeletions(
    input.storedDeletionRecords,
    intent,
    ids,
    attempts,
  );
  const api = snapshotApi(input.api);
  if (
    typeof input.waitForAction !== 'function' ||
    typeof input.recordDestroyAttempt !== 'function' ||
    typeof input.recordDeletion !== 'function'
  ) {
    throw new TypeError('hetznerDestruction callbacks must be functions.');
  }
  const waitForAction = input.waitForAction;
  const recordDestroyAttempt = input.recordDestroyAttempt;
  const recordDeletion = input.recordDeletion;
  /** @type {Record<string, Readonly<Record<string, any>>|null>} */
  const finalDeletions = {};
  for (const role of RESOURCE_ROLES) {
    finalDeletions[role] = await destroyResource(
      role,
      intent,
      ids[role],
      attempts[role],
      deletions[role],
      api,
      waitForAction,
      recordDestroyAttempt,
      recordDeletion,
    );
  }
  const result = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: DESTRUCTION_RESULT_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      providerSpecId: intent.plan.providerSpec.providerSpecId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      status: 'destroyed',
      resources: Object.fromEntries(
        RESOURCE_ROLES.map((role) => [
          role,
          {
            providerResourceId: ids[role],
            state: 'absent',
            deletionId: finalDeletions[role]?.deletionId ?? null,
          },
        ]),
      ),
    }),
  );
  assertManifestIsSecretFree(result, 'hetznerDestruction.result');
  return result;
}

export default {
  HETZNER_DELETION_RECORD_ID_PREFIX,
  HETZNER_DELETION_RECORD_KIND,
  HETZNER_DELETION_RECORD_SCHEMA_VERSION,
  HETZNER_DESTRUCTION_ATTEMPT_ID_PREFIX,
  HETZNER_DESTRUCTION_ATTEMPT_KIND,
  HETZNER_DESTRUCTION_ATTEMPT_SCHEMA_VERSION,
  HetznerDestructionConflictError,
  convergeHetznerSingleNodeDestruction,
  createHetznerDeletionRecord,
  createHetznerDestructionAttempt,
  validateHetznerDeletionRecord,
  validateHetznerDestructionAttempt,
};
