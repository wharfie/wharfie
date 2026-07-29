/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This pure derivation boundary keeps its exact authority and AWS limits adjacent. */

import { createHash } from 'node:crypto';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from '../../canonical-order.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import {
  AWS_SINGLE_NODE_OWNERSHIP_MANAGED_BY,
  AWS_SINGLE_NODE_OWNERSHIP_SCHEMA,
  AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS,
} from './ownership.js';
import { validateAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

export const AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION =
  'Wharfie single-node security group.';
export const AWS_SINGLE_NODE_RESOURCE_ROLES = Object.freeze([
  'securityGroup',
  'instance',
  'rootVolume',
]);

const RESOURCE_ROLE_SET = new Set(AWS_SINGLE_NODE_RESOURCE_ROLES);
const ROLE_SLUGS = Object.freeze({
  securityGroup: 'security-group',
  instance: 'instance',
  rootVolume: 'root-volume',
});
const NAME_PREFIXES = Object.freeze({
  securityGroup: 'wharfie-sn-sg-',
  instance: 'wharfie-sn-node-',
  rootVolume: 'wharfie-sn-root-',
});
const OWNERSHIP_NONCE_DOMAIN =
  'wharfie:aws-single-node-resource-ownership-nonce:v1';
const RESOURCE_NAME_DOMAIN = 'wharfie:aws-single-node-resource-name:v1';
const RUN_INSTANCES_CLIENT_TOKEN_DOMAIN =
  'wharfie:aws-single-node-run-instances-client-token:v1';
const LOWERCASE_SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const BASE64URL_SHA256_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const AWS_TAG_KEY_MAX_LENGTH = 128;
const AWS_TAG_VALUE_MAX_LENGTH = 256;
const AWS_SECURITY_GROUP_NAME_MAX_LENGTH = 255;
const AWS_RUN_INSTANCES_CLIENT_TOKEN_LENGTH = 64;

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function resourceRole(value, valuePath) {
  if (typeof value !== 'string' || !RESOURCE_ROLE_SET.has(value)) {
    throw new TypeError(`${valuePath} is unsupported.`);
  }
  return value;
}

/**
 * @param {Readonly<Record<string, any>>} provisioningIntent
 * @returns {string}
 */
function provisioningActionId(provisioningIntent) {
  const actions = provisioningIntent.plan.actions.filter(
    (/** @type {Readonly<Record<string, any>>} */ action) =>
      action.kind === 'provision-managed-node',
  );
  if (actions.length !== 1) {
    throw new Error(
      'awsResourceIdentity requires exactly one provision-managed-node action.',
    );
  }
  return actions[0].actionId;
}

/**
 * @param {Readonly<Record<string, any>>} provisioningIntent
 * @param {string} role
 * @returns {Readonly<Record<string, string>>}
 */
function createBasePayload(provisioningIntent, role) {
  return deepFreeze(
    sortCanonicalJsonValue({
      provisioningIntentId: provisioningIntent.provisioningIntentId,
      planId: provisioningIntent.plan.planId,
      actionId: provisioningActionId(provisioningIntent),
      deploymentInstanceId: provisioningIntent.plan.deploymentInstanceId,
      incarnationId: provisioningIntent.incarnationId,
      providerScopeId:
        provisioningIntent.plan.providerSpec.providerScope.providerScopeId,
      role,
    }),
  );
}

/** @param {Readonly<Record<string, string>>} base @returns {string} */
function canonicalBaseJson(base) {
  return JSON.stringify(sortCanonicalJsonValue(base));
}

/**
 * @param {string} domain
 * @param {Readonly<Record<string, string>>} base
 * @param {'base64url'|'hex'} encoding
 * @returns {string}
 */
function deriveDigest(domain, base, encoding) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(canonicalBaseJson(base), 'utf8')
    .digest(encoding);
}

/**
 * @param {string} name
 * @param {Readonly<Record<string, string>>} base
 * @param {string} ownershipNonce
 * @param {string} stateDigest
 * @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>}
 */
function createTags(name, base, ownershipNonce, stateDigest) {
  const tags = [
    ['Name', name],
    [AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.action, base.actionId],
    [AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.deployment, base.deploymentInstanceId],
    [AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.incarnation, base.incarnationId],
    [
      AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.managedBy,
      AWS_SINGLE_NODE_OWNERSHIP_MANAGED_BY,
    ],
    [AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.nonce, ownershipNonce],
    [AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.role, base.role],
    [
      AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.schema,
      AWS_SINGLE_NODE_OWNERSHIP_SCHEMA,
    ],
    [AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.state, stateDigest],
  ]
    .map(([Key, Value]) => {
      if (
        Key.length === 0 ||
        Key.length > AWS_TAG_KEY_MAX_LENGTH ||
        Value.length === 0 ||
        Value.length > AWS_TAG_VALUE_MAX_LENGTH
      ) {
        throw new Error('awsResourceIdentity derived an invalid AWS tag.');
      }
      return { Key, Value };
    })
    .sort((left, right) => compareCanonicalStrings(left.Key, right.Key));
  return deepFreeze(tags);
}

/**
 * Derive all stable provider-visible identity for one AWS resource role.
 * Nothing secret or random is accepted: the unpredictable persisted
 * incarnation is the root authority for names, nonces, and state identity.
 * @param {unknown} intentValue
 * @param {unknown} roleValue
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeResourceIdentity(intentValue, roleValue) {
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    intentValue,
    'awsResourceIdentity.provisioningIntent',
  );
  const role = resourceRole(roleValue, 'awsResourceIdentity.role');
  const base = createBasePayload(provisioningIntent, role);
  const ownershipNonce = deriveDigest(
    OWNERSHIP_NONCE_DOMAIN,
    base,
    'base64url',
  );
  const roleSlug = ROLE_SLUGS[/** @type {keyof typeof ROLE_SLUGS} */ (role)];
  const stateDigest = deriveDigest(
    `wharfie:aws-single-node-resource-state:${roleSlug}:v1`,
    base,
    'base64url',
  );
  const nameHash = deriveDigest(RESOURCE_NAME_DOMAIN, base, 'hex');
  const name = `${
    NAME_PREFIXES[/** @type {keyof typeof NAME_PREFIXES} */ (role)]
  }${nameHash}`;
  if (
    !BASE64URL_SHA256_PATTERN.test(ownershipNonce) ||
    !BASE64URL_SHA256_PATTERN.test(stateDigest) ||
    !LOWERCASE_SHA256_PATTERN.test(nameHash) ||
    name.length > AWS_SECURITY_GROUP_NAME_MAX_LENGTH
  ) {
    throw new Error(
      'awsResourceIdentity derivation violated an AWS identity limit.',
    );
  }
  const identity = deepFreeze(
    sortCanonicalJsonValue({
      base,
      name,
      ownershipNonce,
      stateDigest,
      tags: createTags(name, base, ownershipNonce, stateDigest),
    }),
  );
  assertManifestIsSecretFree(identity, 'awsResourceIdentity');
  return identity;
}

/**
 * Derive the exact deterministic idempotency token for RunInstances.
 * @param {unknown} intentValue
 * @returns {string}
 */
export function createAwsSingleNodeRunInstancesClientToken(intentValue) {
  const provisioningIntent = validateAwsSingleNodeProvisioningIntent(
    intentValue,
    'awsRunInstancesClientToken.provisioningIntent',
  );
  const base = createBasePayload(provisioningIntent, 'instance');
  const clientToken = deriveDigest(
    RUN_INSTANCES_CLIENT_TOKEN_DOMAIN,
    base,
    'hex',
  );
  if (
    clientToken.length !== AWS_RUN_INSTANCES_CLIENT_TOKEN_LENGTH ||
    !LOWERCASE_SHA256_PATTERN.test(clientToken)
  ) {
    throw new Error(
      'awsRunInstancesClientToken derivation violated the AWS token limit.',
    );
  }
  return clientToken;
}

export default {
  AWS_SINGLE_NODE_RESOURCE_ROLES,
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  createAwsSingleNodeResourceIdentity,
  createAwsSingleNodeRunInstancesClientToken,
};
