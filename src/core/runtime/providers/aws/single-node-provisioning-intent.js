/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This small durable contract keeps its exact runtime schema adjacent to its content-addressing rules. */

import { validateSha256Digest } from '../../application-revision.js';
import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { assertSingleNodeDeploymentIncarnationId } from '../../single-node-deployment-identity.js';
import { validateAwsSingleNodePlan } from './single-node-plan.js';

export const AWS_PROVISIONING_INTENT_SCHEMA_VERSION = 1;
export const AWS_PROVISIONING_INTENT_KIND = 'awsSingleNodeProvisioningIntent';
export const AWS_PROVISIONING_INTENT_ID_PREFIX = 'wsapi1';

const PROVISIONING_INTENT_ID_DOMAIN =
  'wharfie:aws-single-node-provisioning-intent:v1';
const PROVISIONING_INTENT_MAX_BYTES = 256 * 1024;
const INPUT_KEYS = new Set(['plan', 'incarnationId', 'cloudInitDigest']);
const DOCUMENT_KEYS = new Set([
  'schemaVersion',
  'kind',
  'provisioningIntentId',
  ...INPUT_KEYS,
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

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
function canonicalPayload(value, valuePath) {
  const input = exactDataObject(value, INPUT_KEYS, valuePath);
  const plan = validateAwsSingleNodePlan(input.plan, `${valuePath}.plan`);
  if (plan.status !== 'actionable') {
    throw new Error(`${valuePath}.plan must be actionable.`);
  }
  assertSingleNodeDeploymentIncarnationId(
    input.incarnationId,
    `${valuePath}.incarnationId`,
  );
  const cloudInitDigest = validateSha256Digest(
    input.cloudInitDigest,
    `${valuePath}.cloudInitDigest`,
  );
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_PROVISIONING_INTENT_SCHEMA_VERSION,
      kind: AWS_PROVISIONING_INTENT_KIND,
      plan,
      incarnationId: input.incarnationId,
      cloudInitDigest,
    }),
  );
  assertManifestIsSecretFree(payload, valuePath);
  return payload;
}

/**
 * Bind an actionable AWS plan, one fresh incarnation, and exact bootstrap
 * bytes before the first provider mutation.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeProvisioningIntent(value) {
  const payload = canonicalPayload(value, 'awsProvisioningIntent');
  const provisioningIntentId = createCanonicalJsonSha256Id({
    domain: PROVISIONING_INTENT_ID_DOMAIN,
    prefix: AWS_PROVISIONING_INTENT_ID_PREFIX,
    value: payload,
    valuePath: 'awsProvisioningIntent',
  });
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, provisioningIntentId }),
  );
}

/**
 * Validate a serialized AWS provisioning intent and recompute its identity.
 * @param {unknown} value
 * @param {string} [valuePath]
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodeProvisioningIntent(
  value,
  valuePath = 'awsProvisioningIntent',
) {
  const document = cloneBoundedJsonObject(
    value,
    PROVISIONING_INTENT_MAX_BYTES,
    valuePath,
  );
  exactDataObject(document, DOCUMENT_KEYS, valuePath);
  if (
    document.schemaVersion !== AWS_PROVISIONING_INTENT_SCHEMA_VERSION ||
    document.kind !== AWS_PROVISIONING_INTENT_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  assertDomainSeparatedSha256Id(
    document.provisioningIntentId,
    AWS_PROVISIONING_INTENT_ID_PREFIX,
    `${valuePath}.provisioningIntentId`,
  );
  const payload = canonicalPayload(
    {
      plan: document.plan,
      incarnationId: document.incarnationId,
      cloudInitDigest: document.cloudInitDigest,
    },
    valuePath,
  );
  const expectedId = createCanonicalJsonSha256Id({
    domain: PROVISIONING_INTENT_ID_DOMAIN,
    prefix: AWS_PROVISIONING_INTENT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.provisioningIntentId !== expectedId) {
    throw new Error(
      `${valuePath}.provisioningIntentId does not match its exact contents.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, provisioningIntentId: expectedId }),
  );
}

export default {
  AWS_PROVISIONING_INTENT_ID_PREFIX,
  AWS_PROVISIONING_INTENT_KIND,
  AWS_PROVISIONING_INTENT_SCHEMA_VERSION,
  createAwsSingleNodeProvisioningIntent,
  validateAwsSingleNodeProvisioningIntent,
};
