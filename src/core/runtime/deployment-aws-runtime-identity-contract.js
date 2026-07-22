/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact provider-contract helpers are clearer than parser-specific expansions. */

import { createHash } from 'node:crypto';

import { validateSha256Digest } from './application-revision.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from './content-id.js';
import { getDeploymentControlBucketName } from './deployment-artifact-stage.js';
import {
  assertDeploymentInstanceId,
  PROVIDER_SCOPE_ID_PREFIX,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  assertDeploymentIncarnationId,
  assertDeploymentActionId,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX } from './deployment-service-health-contract.js';
import { assertLogicalId } from './logical-id.js';

export const AWS_IAM_ROLE_ID_PATTERN = /^AROA[A-Z0-9]{12,124}$/;
export const AWS_IAM_INSTANCE_PROFILE_ID_PATTERN = /^AIPA[A-Z0-9]{12,124}$/;
export const AWS_EC2_INSTANCE_ID_PATTERN = /^i-[0-9a-f]{17}$/;

export const AWS_SINGLE_NODE_RUNTIME_ROLE_PATH = '/wharfie/runtime/v1/';
export const AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION =
  'Wharfie single-node resident service runtime role.';
export const AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION = 3600;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_NAME_PREFIX =
  'wharfie-runtime-role-v1-';
export const AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_NAME_PREFIX =
  'wharfie-runtime-profile-v1-';
export const AWS_SINGLE_NODE_RUNTIME_POLICY_NAME = 'wharfie-runtime-policy-v1';
export const AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-runtime-policy-template:v1';
export const AWS_SINGLE_NODE_RUNTIME_ROLE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-runtime-role-state:v1';
export const AWS_SINGLE_NODE_RUNTIME_POLICY_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-runtime-policy-state:v1';
export const AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-runtime-instance-profile-state:v1';
export const AWS_SINGLE_NODE_RUNTIME_ASSOCIATION_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-runtime-association-state:v1';

const NAME_HASH_BYTES = 16;
const IAM_POLICY_DOCUMENT_MAX_BYTES = 128 * 1024;
const IAM_RESOURCE_NAME_AUTHORITY_KEYS = new Set([
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
]);
const POLICY_AUTHORITY_KEYS = new Set([
  'providerScope',
  'deploymentInstanceId',
  'incarnationId',
]);
const POLICY_ID_KEYS = new Set(['runtimeRoleId']);
const ASSOCIATION_ID_KEYS = new Set(['runtimeRoleId', 'instanceProfileId']);
const TAG_AUTHORITY_KEYS = new Set([
  'resourceKind',
  'capabilityKind',
  'roleKind',
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
  'resourceKey',
  'createdByActionId',
  'ownershipNonce',
  'stateDigest',
]);
const IAM_RESOURCE_KINDS = new Set([
  'single-node-runtime-role',
  'single-node-runtime-instance-profile',
]);

const RUNTIME_ROLE_TRUST_POLICY = deepFreeze(
  sortCanonicalJsonValue({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { Service: 'ec2.amazonaws.com' },
        Action: 'sts:AssumeRole',
      },
    ],
  }),
);

const RUNTIME_POLICY_TEMPLATE = createRuntimePolicyDocument({
  partition: '${wharfie:partition}',
  accountId: '${wharfie:account-id}',
  bucketName: '${wharfie:control-bucket}',
  artifactKey: '${wharfie:managed-artifact-key}',
});

export const AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST = deepFreeze({
  algorithm: 'sha256',
  value: sha256Base64Url(
    `${AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST_DOMAIN}\0${JSON.stringify(
      RUNTIME_POLICY_TEMPLATE,
    )}`,
  ),
});

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function exactObject(value, path) {
  if (!isPlainObject(value)) throw new TypeError(`${path} must be an object.`);
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertAwsIamRoleId(value, valuePath = 'iamRoleId') {
  if (typeof value !== 'string' || !AWS_IAM_ROLE_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be a 16-128 character AWS IAM RoleId beginning with AROA followed by uppercase alphanumeric characters.`,
    );
  }
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertAwsIamInstanceProfileId(
  value,
  valuePath = 'instanceProfileId',
) {
  if (
    typeof value !== 'string' ||
    !AWS_IAM_INSTANCE_PROFILE_ID_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be a 16-128 character AWS IAM InstanceProfileId beginning with AIPA followed by uppercase alphanumeric characters.`,
    );
  }
}

/** @param {unknown} value @param {string} [valuePath] @returns {asserts value is string} */
export function assertAwsEc2InstanceId(value, valuePath = 'instanceId') {
  if (typeof value !== 'string' || !AWS_EC2_INSTANCE_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be a lowercase long-format AWS EC2 instance ID.`,
    );
  }
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, string>>} */
function validateNameAuthority(value, path) {
  const authority = exactObject(value, path);
  assertExactKeys(authority, IAM_RESOURCE_NAME_AUTHORITY_KEYS, path);
  assertDomainSeparatedSha256Id(
    authority.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${path}.providerScopeId`,
  );
  assertDeploymentInstanceId(
    authority.deploymentInstanceId,
    `${path}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(
    authority.incarnationId,
    `${path}.incarnationId`,
  );
  return deepFreeze({
    providerScopeId: authority.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/** @param {string} domain @param {Readonly<Record<string, string>>} authority @returns {string} */
function identityNameHash(domain, authority) {
  return createHash('sha256')
    .update(domain, 'utf8')
    .update('\0', 'utf8')
    .update(JSON.stringify(sortCanonicalJsonValue(authority)), 'utf8')
    .digest('hex')
    .slice(0, NAME_HASH_BYTES * 2);
}

/** @param {unknown} value @returns {string} */
export function getAwsSingleNodeRuntimeRoleName(value) {
  const authority = validateNameAuthority(value, 'runtimeRoleName authority');
  return `${AWS_SINGLE_NODE_RUNTIME_ROLE_NAME_PREFIX}${identityNameHash(
    'wharfie:aws-single-node-runtime-role-name:v1',
    authority,
  )}`;
}

/** @param {unknown} value @returns {string} */
export function getAwsSingleNodeRuntimeInstanceProfileName(value) {
  const authority = validateNameAuthority(
    value,
    'runtimeInstanceProfileName authority',
  );
  return `${AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_NAME_PREFIX}${identityNameHash(
    'wharfie:aws-single-node-runtime-instance-profile-name:v1',
    authority,
  )}`;
}

/** @returns {Readonly<Record<string, any>>} */
export function getAwsSingleNodeRuntimeRoleTrustPolicy() {
  return RUNTIME_ROLE_TRUST_POLICY;
}

/** @returns {Readonly<{algorithm: 'sha256', value: string}>} */
export function getAwsSingleNodeRuntimePolicyTemplateDigest() {
  return AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST;
}

/** @param {{partition: string, accountId: string, bucketName: string, artifactKey: string}} value @returns {Readonly<Record<string, any>>} */
function createRuntimePolicyDocument(value) {
  const artifactArn = `arn:${value.partition}:s3:::${value.bucketName}/${value.artifactKey}`;
  const healthArn = `arn:${value.partition}:s3:::${value.bucketName}/${DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX}\${aws:userid}`;
  const resourceAccount = value.accountId;
  return deepFreeze(
    sortCanonicalJsonValue({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ManageWithSsm',
          Effect: 'Allow',
          Action: [
            'ssm:UpdateInstanceInformation',
            'ssmmessages:CreateControlChannel',
            'ssmmessages:CreateDataChannel',
            'ssmmessages:OpenControlChannel',
            'ssmmessages:OpenDataChannel',
          ],
          Resource: '*',
        },
        {
          Sid: 'ReadExactManagedArtifact',
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: artifactArn,
          Condition: {
            Bool: { 'aws:SecureTransport': 'true' },
            StringEquals: { 's3:ResourceAccount': resourceAccount },
          },
        },
        {
          Sid: 'ReadOwnCurrentHealth',
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: healthArn,
          Condition: {
            Bool: { 'aws:SecureTransport': 'true' },
            StringEquals: { 's3:ResourceAccount': resourceAccount },
          },
        },
        {
          Sid: 'CreateOwnCurrentHealth',
          Effect: 'Allow',
          Action: 's3:PutObject',
          Resource: healthArn,
          Condition: {
            Bool: { 'aws:SecureTransport': 'true' },
            StringEquals: {
              's3:ResourceAccount': resourceAccount,
              's3:if-none-match': '*',
              's3:x-amz-server-side-encryption': 'AES256',
              's3:x-amz-storage-class': 'STANDARD',
            },
          },
        },
        {
          Sid: 'ReplaceOwnCurrentHealth',
          Effect: 'Allow',
          Action: 's3:PutObject',
          Resource: healthArn,
          Condition: {
            Bool: { 'aws:SecureTransport': 'true' },
            Null: { 's3:if-match': 'false' },
            StringEquals: {
              's3:ResourceAccount': resourceAccount,
              's3:x-amz-server-side-encryption': 'AES256',
              's3:x-amz-storage-class': 'STANDARD',
            },
          },
        },
        {
          Sid: 'DenyDeletingOwnHealthHistory',
          Effect: 'Deny',
          Action: ['s3:DeleteObject', 's3:DeleteObjectVersion'],
          Resource: healthArn,
        },
      ],
    }),
  );
}

/** @param {unknown} value @returns {Readonly<{providerScope: Readonly<Record<string, any>>, deploymentInstanceId: string, incarnationId: string, bucketName: string, artifactKey: string}>} */
function validatePolicyAuthority(value) {
  const authority = exactObject(value, 'runtimePolicy authority');
  assertExactKeys(authority, POLICY_AUTHORITY_KEYS, 'runtimePolicy authority');
  const providerScope = validateProviderScope(
    authority.providerScope,
    'runtimePolicy authority.providerScope',
  );
  assertDeploymentInstanceId(
    authority.deploymentInstanceId,
    'runtimePolicy authority.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    authority.incarnationId,
    'runtimePolicy authority.incarnationId',
  );
  const bucketName = getDeploymentControlBucketName(
    providerScope,
    'runtimePolicy authority.providerScope',
  );
  const artifactKey = `artifact/v1/${authority.deploymentInstanceId}/${authority.incarnationId}/current`;
  return deepFreeze({
    providerScope,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    bucketName,
    artifactKey,
  });
}

/** @param {unknown} value @returns {Readonly<{bucketName: string, key: string, arn: string}>} */
export function getAwsSingleNodeManagedArtifactObjectLocation(value) {
  const authority = validatePolicyAuthority(value);
  return deepFreeze({
    bucketName: authority.bucketName,
    key: authority.artifactKey,
    arn: `arn:${authority.providerScope.partition}:s3:::${authority.bucketName}/${authority.artifactKey}`,
  });
}

/**
 * Render the exact least-privilege runtime policy. Each current artifact is
 * published to an incarnation-specific stable managed key known before
 * provider planning. The health ARN uses the IAM
 * role-session `${aws:userid}` value, which is RoleId:InstanceId for an EC2
 * instance-profile session and therefore selects one exact V3 current object.
 * @param {unknown} value - Exact credential scope and deployment/artifact identity.
 * @returns {Readonly<Record<string, any>>} - Canonical IAM policy document.
 */
export function createAwsSingleNodeRuntimePolicy(value) {
  const authority = validatePolicyAuthority(value);
  return createRuntimePolicyDocument({
    partition: authority.providerScope.partition,
    accountId: authority.providerScope.accountId,
    bucketName: authority.bucketName,
    artifactKey: authority.artifactKey,
  });
}

/** @param {unknown} value @param {unknown} expected @param {string} path @returns {Readonly<Record<string, any>>} */
function validateEncodedPolicy(value, expected, path) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > IAM_POLICY_DOCUMENT_MAX_BYTES
  ) {
    throw new TypeError(
      `${path} must be a bounded URI-encoded IAM policy document.`,
    );
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      throw new TypeError(
        `${path} must be JSON or a valid URI-encoded IAM policy document.`,
      );
    }
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new TypeError(`${path} must encode valid JSON.`);
    }
  }
  if (!isPlainObject(parsed)) {
    throw new TypeError(`${path} must encode one JSON object.`);
  }
  const canonical = sortCanonicalJsonValue(parsed);
  if (JSON.stringify(canonical) !== JSON.stringify(expected)) {
    throw new Error(`${path} does not match the exact runtime IAM policy.`);
  }
  return /** @type {Readonly<Record<string, any>>} */ (expected);
}

/** @param {unknown} value @param {string} [valuePath] @returns {Readonly<Record<string, any>>} */
export function validateAwsSingleNodeRuntimeRoleTrustPolicy(
  value,
  valuePath = 'assumeRolePolicyDocument',
) {
  return validateEncodedPolicy(value, RUNTIME_ROLE_TRUST_POLICY, valuePath);
}

/** @param {unknown} value @param {unknown} authority @param {string} [valuePath] @returns {Readonly<Record<string, any>>} */
export function validateAwsSingleNodeRuntimePolicy(
  value,
  authority,
  valuePath = 'policyDocument',
) {
  return validateEncodedPolicy(
    value,
    createAwsSingleNodeRuntimePolicy(authority),
    valuePath,
  );
}

/** @param {string} domain @param {unknown} descriptor @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function stateDigest(domain, descriptor) {
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${domain}\0${JSON.stringify(sortCanonicalJsonValue(descriptor))}`,
    ),
  });
}

/** @param {unknown} value @returns {Readonly<{algorithm: 'sha256', value: string}>} */
export function getAwsSingleNodeRuntimeRoleStateDigest(value) {
  return stateDigest(AWS_SINGLE_NODE_RUNTIME_ROLE_STATE_DIGEST_DOMAIN, {
    schemaVersion: 1,
    kind: 'awsSingleNodeRuntimeRoleState',
    roleName: getAwsSingleNodeRuntimeRoleName(value),
    path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
    maxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
    assumeRolePolicyDocument: RUNTIME_ROLE_TRUST_POLICY,
    permissionsBoundary: null,
    onDestroy: 'purge',
  });
}

/** @param {unknown} value @returns {Readonly<{algorithm: 'sha256', value: string}>} */
export function getAwsSingleNodeRuntimePolicyStateDigest(value) {
  return stateDigest(AWS_SINGLE_NODE_RUNTIME_POLICY_STATE_DIGEST_DOMAIN, {
    schemaVersion: 1,
    kind: 'awsSingleNodeRuntimePolicyState',
    policyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    policyTemplateDigest: AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
    policyDocument: createAwsSingleNodeRuntimePolicy(value),
    onDestroy: 'purge',
  });
}

/** @param {unknown} value @returns {Readonly<{algorithm: 'sha256', value: string}>} */
export function getAwsSingleNodeRuntimeInstanceProfileStateDigest(value) {
  return stateDigest(
    AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_STATE_DIGEST_DOMAIN,
    {
      schemaVersion: 1,
      kind: 'awsSingleNodeRuntimeInstanceProfileState',
      instanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(value),
      path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
      onDestroy: 'purge',
    },
  );
}

/** @param {unknown} value @returns {string} */
export function getAwsSingleNodeRuntimePolicyProviderResourceId(value) {
  const input = exactObject(value, 'runtimePolicy provider identity');
  assertExactKeys(input, POLICY_ID_KEYS, 'runtimePolicy provider identity');
  assertAwsIamRoleId(
    input.runtimeRoleId,
    'runtimePolicy provider identity.runtimeRoleId',
  );
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:aws-single-node-runtime-inline-policy:v1',
    prefix: 'wrp1',
    value: {
      runtimeRoleId: input.runtimeRoleId,
      policyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
    },
  });
}

/** @param {unknown} value @returns {string} */
export function getAwsSingleNodeRuntimeAssociationProviderResourceId(value) {
  const input = exactObject(value, 'runtimeAssociation provider identity');
  assertExactKeys(
    input,
    ASSOCIATION_ID_KEYS,
    'runtimeAssociation provider identity',
  );
  assertAwsIamRoleId(
    input.runtimeRoleId,
    'runtimeAssociation provider identity.runtimeRoleId',
  );
  assertAwsIamInstanceProfileId(
    input.instanceProfileId,
    'runtimeAssociation provider identity.instanceProfileId',
  );
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:aws-single-node-runtime-association:v1',
    prefix: 'wra1',
    value: {
      runtimeRoleId: input.runtimeRoleId,
      instanceProfileId: input.instanceProfileId,
    },
  });
}

/**
 * Describe the plan-time relationship intent through deterministic names.
 * Provider-allocated RoleId and InstanceProfileId values instead belong to
 * the synthetic provider identity and exact dependency-binding lineage.
 * @param {unknown} value - Deterministic role/profile name authority.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeRuntimeAssociationStateDigest(value) {
  const authority = validateNameAuthority(value, 'runtimeAssociation state');
  return stateDigest(AWS_SINGLE_NODE_RUNTIME_ASSOCIATION_STATE_DIGEST_DOMAIN, {
    schemaVersion: 1,
    kind: 'awsSingleNodeRuntimeAssociationState',
    roleName: getAwsSingleNodeRuntimeRoleName(authority),
    instanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(authority),
    membership: 'exactly-one-role',
    onDestroy: 'purge',
  });
}

/** @param {unknown} value @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
export function createAwsSingleNodeRuntimeIdentityTags(value) {
  const authority = exactObject(value, 'runtimeIdentity tags');
  assertExactKeys(authority, TAG_AUTHORITY_KEYS, 'runtimeIdentity tags');
  if (!IAM_RESOURCE_KINDS.has(authority.resourceKind)) {
    throw new TypeError('runtimeIdentity tags.resourceKind is not supported.');
  }
  for (const key of ['capabilityKind', 'roleKind', 'resourceKey']) {
    assertLogicalId(authority[key], `runtimeIdentity tags.${key}`);
  }
  assertDomainSeparatedSha256Id(
    authority.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    'runtimeIdentity tags.providerScopeId',
  );
  assertDeploymentInstanceId(
    authority.deploymentInstanceId,
    'runtimeIdentity tags.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    authority.incarnationId,
    'runtimeIdentity tags.incarnationId',
  );
  assertDeploymentActionId(
    authority.createdByActionId,
    'runtimeIdentity tags.createdByActionId',
  );
  validateOwnershipNonce(
    authority.ownershipNonce,
    'runtimeIdentity tags.ownershipNonce',
  );
  const digest = validateSha256Digest(
    authority.stateDigest,
    'runtimeIdentity tags.stateDigest',
  );
  const tags = {
    'wharfie:managed-by': 'wharfie',
    'wharfie:resource-kind': authority.resourceKind,
    'wharfie:retention': 'purge',
    'wharfie:schema-version': '2',
    'wharfie:capability': authority.capabilityKind,
    'wharfie:role': authority.roleKind,
    'wharfie:provider-scope-id': authority.providerScopeId,
    'wharfie:deployment-instance-id': authority.deploymentInstanceId,
    'wharfie:incarnation-id': authority.incarnationId,
    'wharfie:resource-key': authority.resourceKey,
    'wharfie:created-by-action-id': authority.createdByActionId,
    'wharfie:ownership-nonce': authority.ownershipNonce,
    'wharfie:state-digest': digest.value,
  };
  return deepFreeze(
    Object.entries(tags)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([Key, Value]) => ({ Key, Value })),
  );
}

export default {
  AWS_EC2_INSTANCE_ID_PATTERN,
  AWS_IAM_INSTANCE_PROFILE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  AWS_SINGLE_NODE_RUNTIME_INSTANCE_PROFILE_NAME_PREFIX,
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_NAME_PREFIX,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsEc2InstanceId,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  createAwsSingleNodeRuntimeIdentityTags,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimePolicyTemplateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
  validateAwsSingleNodeRuntimePolicy,
  validateAwsSingleNodeRuntimeRoleTrustPolicy,
};
