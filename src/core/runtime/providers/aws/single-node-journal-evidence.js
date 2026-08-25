/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- These compact provider evidence envelopes intentionally keep exact schemas and content identities together. */

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { validateAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

export const AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION = 1;
export const AWS_PROVISIONING_MUTATION_ATTEMPT_KIND =
  'awsProvisioningMutationAttempt';
export const AWS_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX = 'wsama1';
export const AWS_PROVISIONED_RESOURCE_KIND = 'awsProvisionedResource';
export const AWS_DESTRUCTION_ATTEMPT_KIND = 'awsDestructionMutationAttempt';
export const AWS_DESTRUCTION_ATTEMPT_ID_PREFIX = 'wsada1';
export const AWS_DELETION_RECORD_KIND = 'awsResourceDeletion';
export const AWS_DELETION_RECORD_ID_PREFIX = 'wsadd1';

const MUTATION_ATTEMPT_ID_DOMAIN =
  'wharfie:aws-single-node-provisioning-mutation-attempt:v1';
const DESTRUCTION_ATTEMPT_ID_DOMAIN =
  'wharfie:aws-single-node-destruction-mutation-attempt:v1';
const DELETION_RECORD_ID_DOMAIN =
  'wharfie:aws-single-node-resource-deletion:v1';
const EVIDENCE_MAX_BYTES = 16 * 1024;
const ROLE_OPERATIONS = Object.freeze({
  securityGroup: 'create',
  instance: 'create',
  rootVolume: 'discover',
});
const ROLE_PATTERNS = Object.freeze({
  securityGroup: /^sg-[0-9a-f]{8,32}$/u,
  instance: /^i-[0-9a-f]{8,32}$/u,
  rootVolume: /^vol-[0-9a-f]{8,32}$/u,
});
const MUTATION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'attemptId',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'providerScopeId',
  'role',
  'operation',
]);
const RESOURCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'providerScopeId',
  'role',
  'providerResourceId',
]);
const DESTRUCTION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'attemptId',
  'provisioningIntentId',
  'planId',
  'deploymentInstanceId',
  'incarnationId',
  'providerScopeId',
  'role',
  'operation',
  'providerResourceId',
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
  'providerScopeId',
  'role',
  'operation',
  'providerResourceId',
  'state',
]);

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, expected, valuePath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const prototype = Object.getPrototypeOf(object);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
  }
  return object;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function role(value, valuePath) {
  if (typeof value !== 'string' || !Object.hasOwn(ROLE_OPERATIONS, value)) {
    throw new TypeError(`${valuePath} is unsupported.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {string} expectedRole
 * @param {string} valuePath
 * @returns {string}
 */
function resourceId(value, expectedRole, valuePath) {
  const pattern =
    ROLE_PATTERNS[/** @type {keyof typeof ROLE_PATTERNS} */ (expectedRole)];
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(
      `${valuePath} is not a canonical ${expectedRole} AWS resource ID.`,
    );
  }
  return value;
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string} resourceRole
 * @param {string} operation
 * @returns {Readonly<Record<string, any>>}
 */
function authorityPayload(intent, resourceRole, operation) {
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      providerScopeId: intent.plan.providerSpec.providerScope.providerScopeId,
      role: resourceRole,
      operation,
    }),
  );
}

/**
 * @param {unknown} value
 * @param {unknown} intentValue
 * @param {string|undefined} expectedRole
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsProvisioningMutationAttempt(
  value,
  intentValue,
  expectedRole,
  valuePath = 'awsProvisioningMutationAttempt',
) {
  const intent = validateAwsSingleNodeProvisioningIntent(
    intentValue,
    `${valuePath}.intent`,
  );
  const attempt = cloneBoundedJsonObject(value, EVIDENCE_MAX_BYTES, valuePath);
  exactDataObject(attempt, MUTATION_KEYS, valuePath);
  if (
    attempt.schemaVersion !== AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION ||
    attempt.kind !== AWS_PROVISIONING_MUTATION_ATTEMPT_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  const resourceRole = role(attempt.role, `${valuePath}.role`);
  if (expectedRole !== undefined && resourceRole !== expectedRole) {
    throw new Error(`${valuePath}.role does not match the expected role.`);
  }
  const payload = deepFreeze({
    ...authorityPayload(
      intent,
      resourceRole,
      ROLE_OPERATIONS[
        /** @type {keyof typeof ROLE_OPERATIONS} */ (resourceRole)
      ],
    ),
    kind: AWS_PROVISIONING_MUTATION_ATTEMPT_KIND,
  });
  if (
    Object.entries(payload).some(([key, expected]) => attempt[key] !== expected)
  ) {
    throw new Error(`${valuePath} does not match its immutable authority.`);
  }
  assertDomainSeparatedSha256Id(
    attempt.attemptId,
    AWS_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
    `${valuePath}.attemptId`,
  );
  const attemptId = createCanonicalJsonSha256Id({
    domain: MUTATION_ATTEMPT_ID_DOMAIN,
    prefix: AWS_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (attempt.attemptId !== attemptId) {
    throw new Error(`${valuePath}.attemptId does not match its exact payload.`);
  }
  const result = deepFreeze(sortCanonicalJsonValue({ ...payload, attemptId }));
  assertManifestIsSecretFree(result, valuePath);
  return result;
}

/**
 * @param {unknown} intentValue
 * @param {unknown} roleValue
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsProvisioningMutationAttempt(intentValue, roleValue) {
  const intent = validateAwsSingleNodeProvisioningIntent(intentValue);
  const resourceRole = role(roleValue, 'awsProvisioningMutationAttempt.role');
  const payload = deepFreeze({
    ...authorityPayload(
      intent,
      resourceRole,
      ROLE_OPERATIONS[
        /** @type {keyof typeof ROLE_OPERATIONS} */ (resourceRole)
      ],
    ),
    kind: AWS_PROVISIONING_MUTATION_ATTEMPT_KIND,
  });
  const attemptId = createCanonicalJsonSha256Id({
    domain: MUTATION_ATTEMPT_ID_DOMAIN,
    prefix: AWS_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
    value: payload,
    valuePath: 'awsProvisioningMutationAttempt',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, attemptId }));
}

/**
 * @param {unknown} value
 * @param {unknown} intentValue
 * @param {string|undefined} expectedRole
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsProvisionedResourceRecord(
  value,
  intentValue,
  expectedRole,
  valuePath = 'awsProvisionedResource',
) {
  const intent = validateAwsSingleNodeProvisioningIntent(
    intentValue,
    `${valuePath}.intent`,
  );
  const record = cloneBoundedJsonObject(value, EVIDENCE_MAX_BYTES, valuePath);
  exactDataObject(record, RESOURCE_KEYS, valuePath);
  if (
    record.schemaVersion !== AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION ||
    record.kind !== AWS_PROVISIONED_RESOURCE_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  const resourceRole = role(record.role, `${valuePath}.role`);
  if (expectedRole !== undefined && resourceRole !== expectedRole) {
    throw new Error(`${valuePath}.role does not match the expected role.`);
  }
  const payload = deepFreeze({
    ...authorityPayload(intent, resourceRole, 'observe'),
    kind: AWS_PROVISIONED_RESOURCE_KIND,
    providerResourceId: resourceId(
      record.providerResourceId,
      resourceRole,
      `${valuePath}.providerResourceId`,
    ),
  });
  const expected = {
    ...payload,
    operation: undefined,
  };
  delete expected.operation;
  if (
    Object.entries(expected).some(
      ([key, expectedValue]) => record[key] !== expectedValue,
    )
  ) {
    throw new Error(`${valuePath} does not match its immutable authority.`);
  }
  const result = deepFreeze(sortCanonicalJsonValue(expected));
  assertManifestIsSecretFree(result, valuePath);
  return result;
}

/**
 * @param {unknown} intentValue
 * @param {unknown} roleValue
 * @param {unknown} providerResourceId
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsProvisionedResourceRecord(
  intentValue,
  roleValue,
  providerResourceId,
) {
  const intent = validateAwsSingleNodeProvisioningIntent(intentValue);
  const resourceRole = role(roleValue, 'awsProvisionedResource.role');
  return validateAwsProvisionedResourceRecord(
    {
      schemaVersion: AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_PROVISIONED_RESOURCE_KIND,
      provisioningIntentId: intent.provisioningIntentId,
      planId: intent.plan.planId,
      deploymentInstanceId: intent.plan.deploymentInstanceId,
      incarnationId: intent.incarnationId,
      providerScopeId: intent.plan.providerSpec.providerScope.providerScopeId,
      role: resourceRole,
      providerResourceId,
    },
    intent,
    resourceRole,
  );
}

/**
 * @param {unknown} value
 * @param {unknown} intentValue
 * @param {string|undefined} expectedRole
 * @param {unknown} expectedProviderResourceId
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsDestructionAttempt(
  value,
  intentValue,
  expectedRole,
  expectedProviderResourceId,
  valuePath = 'awsDestructionAttempt',
) {
  const intent = validateAwsSingleNodeProvisioningIntent(
    intentValue,
    `${valuePath}.intent`,
  );
  const attempt = cloneBoundedJsonObject(value, EVIDENCE_MAX_BYTES, valuePath);
  exactDataObject(attempt, DESTRUCTION_KEYS, valuePath);
  if (
    attempt.schemaVersion !== AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION ||
    attempt.kind !== AWS_DESTRUCTION_ATTEMPT_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  const resourceRole = role(attempt.role, `${valuePath}.role`);
  if (expectedRole !== undefined && resourceRole !== expectedRole) {
    throw new Error(`${valuePath}.role does not match the expected role.`);
  }
  const id = resourceId(
    attempt.providerResourceId,
    resourceRole,
    `${valuePath}.providerResourceId`,
  );
  if (
    expectedProviderResourceId !== undefined &&
    id !== expectedProviderResourceId
  ) {
    throw new Error(
      `${valuePath}.providerResourceId does not match the expected resource.`,
    );
  }
  const payload = deepFreeze({
    ...authorityPayload(intent, resourceRole, 'delete'),
    kind: AWS_DESTRUCTION_ATTEMPT_KIND,
    providerResourceId: id,
  });
  if (
    Object.entries(payload).some(([key, expected]) => attempt[key] !== expected)
  ) {
    throw new Error(`${valuePath} does not match its immutable authority.`);
  }
  assertDomainSeparatedSha256Id(
    attempt.attemptId,
    AWS_DESTRUCTION_ATTEMPT_ID_PREFIX,
    `${valuePath}.attemptId`,
  );
  const attemptId = createCanonicalJsonSha256Id({
    domain: DESTRUCTION_ATTEMPT_ID_DOMAIN,
    prefix: AWS_DESTRUCTION_ATTEMPT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (attempt.attemptId !== attemptId) {
    throw new Error(`${valuePath}.attemptId does not match its exact payload.`);
  }
  const result = deepFreeze(sortCanonicalJsonValue({ ...payload, attemptId }));
  assertManifestIsSecretFree(result, valuePath);
  return result;
}

/**
 * @param {unknown} intentValue
 * @param {unknown} roleValue
 * @param {unknown} providerResourceId
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsDestructionAttempt(
  intentValue,
  roleValue,
  providerResourceId,
) {
  const intent = validateAwsSingleNodeProvisioningIntent(intentValue);
  const resourceRole = role(roleValue, 'awsDestructionAttempt.role');
  const id = resourceId(
    providerResourceId,
    resourceRole,
    'awsDestructionAttempt.providerResourceId',
  );
  const payload = deepFreeze({
    ...authorityPayload(intent, resourceRole, 'delete'),
    kind: AWS_DESTRUCTION_ATTEMPT_KIND,
    providerResourceId: id,
  });
  const attemptId = createCanonicalJsonSha256Id({
    domain: DESTRUCTION_ATTEMPT_ID_DOMAIN,
    prefix: AWS_DESTRUCTION_ATTEMPT_ID_PREFIX,
    value: payload,
    valuePath: 'awsDestructionAttempt',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, attemptId }));
}

/**
 * @param {unknown} value
 * @param {unknown} intentValue
 * @param {string|undefined} expectedRole
 * @param {unknown} expectedProviderResourceId
 * @param {Readonly<Record<string, any>>|null|undefined} expectedAttempt
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsDeletionRecord(
  value,
  intentValue,
  expectedRole,
  expectedProviderResourceId,
  expectedAttempt,
  valuePath = 'awsDeletionRecord',
) {
  const intent = validateAwsSingleNodeProvisioningIntent(
    intentValue,
    `${valuePath}.intent`,
  );
  const record = cloneBoundedJsonObject(value, EVIDENCE_MAX_BYTES, valuePath);
  exactDataObject(record, DELETION_KEYS, valuePath);
  if (
    record.schemaVersion !== AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION ||
    record.kind !== AWS_DELETION_RECORD_KIND ||
    record.state !== 'absent'
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  const resourceRole = role(record.role, `${valuePath}.role`);
  if (expectedRole !== undefined && resourceRole !== expectedRole) {
    throw new Error(`${valuePath}.role does not match the expected role.`);
  }
  const id = resourceId(
    record.providerResourceId,
    resourceRole,
    `${valuePath}.providerResourceId`,
  );
  if (
    expectedProviderResourceId !== undefined &&
    id !== expectedProviderResourceId
  ) {
    throw new Error(
      `${valuePath}.providerResourceId does not match the expected resource.`,
    );
  }
  let destroyAttemptId = null;
  if (expectedAttempt !== undefined && expectedAttempt !== null) {
    const attempt = validateAwsDestructionAttempt(
      expectedAttempt,
      intent,
      resourceRole,
      id,
      `${valuePath}.destroyAttempt`,
    );
    destroyAttemptId = attempt.attemptId;
  }
  if (record.destroyAttemptId !== destroyAttemptId) {
    throw new Error(
      `${valuePath}.destroyAttemptId does not match durable destroy authority.`,
    );
  }
  const payload = deepFreeze({
    ...authorityPayload(intent, resourceRole, 'delete'),
    kind: AWS_DELETION_RECORD_KIND,
    destroyAttemptId,
    providerResourceId: id,
    state: 'absent',
  });
  if (
    Object.entries(payload).some(([key, expected]) => record[key] !== expected)
  ) {
    throw new Error(`${valuePath} does not match its immutable authority.`);
  }
  assertDomainSeparatedSha256Id(
    record.deletionId,
    AWS_DELETION_RECORD_ID_PREFIX,
    `${valuePath}.deletionId`,
  );
  const deletionId = createCanonicalJsonSha256Id({
    domain: DELETION_RECORD_ID_DOMAIN,
    prefix: AWS_DELETION_RECORD_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (record.deletionId !== deletionId) {
    throw new Error(
      `${valuePath}.deletionId does not match its exact payload.`,
    );
  }
  const result = deepFreeze(sortCanonicalJsonValue({ ...payload, deletionId }));
  assertManifestIsSecretFree(result, valuePath);
  return result;
}

/**
 * @param {unknown} intentValue
 * @param {unknown} roleValue
 * @param {unknown} providerResourceId
 * @param {unknown} [attemptValue]
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsDeletionRecord(
  intentValue,
  roleValue,
  providerResourceId,
  attemptValue = null,
) {
  const intent = validateAwsSingleNodeProvisioningIntent(intentValue);
  const resourceRole = role(roleValue, 'awsDeletionRecord.role');
  const id = resourceId(
    providerResourceId,
    resourceRole,
    'awsDeletionRecord.providerResourceId',
  );
  const attempt =
    attemptValue === null
      ? null
      : validateAwsDestructionAttempt(
          attemptValue,
          intent,
          resourceRole,
          id,
          'awsDeletionRecord.destroyAttempt',
        );
  const payload = deepFreeze({
    ...authorityPayload(intent, resourceRole, 'delete'),
    kind: AWS_DELETION_RECORD_KIND,
    destroyAttemptId: attempt?.attemptId ?? null,
    providerResourceId: id,
    state: 'absent',
  });
  const deletionId = createCanonicalJsonSha256Id({
    domain: DELETION_RECORD_ID_DOMAIN,
    prefix: AWS_DELETION_RECORD_ID_PREFIX,
    value: payload,
    valuePath: 'awsDeletionRecord',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, deletionId }));
}

export default {
  AWS_DELETION_RECORD_ID_PREFIX,
  AWS_DELETION_RECORD_KIND,
  AWS_DESTRUCTION_ATTEMPT_ID_PREFIX,
  AWS_DESTRUCTION_ATTEMPT_KIND,
  AWS_JOURNAL_EVIDENCE_SCHEMA_VERSION,
  AWS_PROVISIONED_RESOURCE_KIND,
  AWS_PROVISIONING_MUTATION_ATTEMPT_ID_PREFIX,
  AWS_PROVISIONING_MUTATION_ATTEMPT_KIND,
  createAwsDeletionRecord,
  createAwsDestructionAttempt,
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
  validateAwsDeletionRecord,
  validateAwsDestructionAttempt,
  validateAwsProvisionedResourceRecord,
  validateAwsProvisioningMutationAttempt,
};
