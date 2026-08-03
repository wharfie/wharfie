/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamJsonDocument,
} from './deployment-aws-iam-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  createAwsSingleNodeRuntimeIdentityTags,
} from './deployment-aws-runtime-identity-contract.js';

export const AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS = 10;

const IAM_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;
const ROLE_EVIDENCE_AUTHORITY_KEYS = new Set([
  'providerScope',
  'roleName',
  'providerResourceId',
]);
const OWNERSHIP_AUTHORITY_KEYS = new Set([
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
const PERMISSIONS_BOUNDARY_KEYS = new Set([
  'PermissionsBoundaryType',
  'PermissionsBoundaryArn',
]);
const INSTANCE_PROFILE_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;

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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeRuntimeRoleId(value) {
  try {
    assertAwsIamRoleId(value, 'awsSingleNodeRuntimeRole evidence.RoleId');
  } catch {
    throw new AwsIamEvidenceUnknownError();
  }
  return /** @type {string} */ (value);
}

/**
 * Decode one exact GetRole envelope. The deterministic account-global name is
 * an identity boundary; a different returned name is contradictory evidence.
 * @param {unknown} response - Raw GetRole response.
 * @param {unknown} expectedRoleName - Deterministic role name.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeRuntimeRoleResponse(
  response,
  expectedRoleName,
) {
  if (
    typeof expectedRoleName !== 'string' ||
    !IAM_NAME_PATTERN.test(expectedRoleName)
  ) {
    throw new TypeError(
      'awsSingleNodeRuntimeRole expectedRoleName must be a valid IAM name.',
    );
  }
  if (!isPlainObject(response) || !isPlainObject(response.Role)) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (typeof response.Role.RoleName !== 'string') {
    throw new AwsIamEvidenceUnknownError();
  }
  if (response.Role.RoleName !== expectedRoleName) {
    throw new AwsIamEvidenceConflictError();
  }
  const role = response.Role;
  return deepFreeze({
    Path: role.Path,
    RoleName: role.RoleName,
    RoleId: role.RoleId,
    Arn: role.Arn,
    Description: role.Description,
    MaxSessionDuration: role.MaxSessionDuration,
    AssumeRolePolicyDocument: role.AssumeRolePolicyDocument,
    PermissionsBoundary: isPlainObject(role.PermissionsBoundary)
      ? { ...role.PermissionsBoundary }
      : role.PermissionsBoundary,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>|null} */
function decodePermissionsBoundary(value) {
  if (value === undefined || value === null) return null;
  if (!isPlainObject(value)) throw new AwsIamEvidenceUnknownError();
  if (
    Object.keys(value).length !== PERMISSIONS_BOUNDARY_KEYS.size ||
    ![...PERMISSIONS_BOUNDARY_KEYS].every((key) => Object.hasOwn(value, key)) ||
    value.PermissionsBoundaryType !== 'PermissionsBoundaryPolicy' ||
    typeof value.PermissionsBoundaryArn !== 'string' ||
    value.PermissionsBoundaryArn.length === 0
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  return deepFreeze({
    permissionsBoundaryArn: value.PermissionsBoundaryArn,
    permissionsBoundaryType: value.PermissionsBoundaryType,
  });
}

/** @param {Readonly<Record<string, any>>} descriptor @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function actualStateDigest(descriptor) {
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_RUNTIME_ROLE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        sortCanonicalJsonValue(descriptor),
      )}`,
    ),
  });
}

/**
 * Decode immutable role identity and every readable role configuration field.
 * Configuration drift is represented by observedDigest rather than collapsed
 * into an ownership conflict.
 * @param {unknown} value - Raw Role record.
 * @param {unknown} expected - Exact scope, name, and optional durable RoleId.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeRuntimeRoleEvidence(value, expected) {
  if (!isPlainObject(expected)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRole evidence authority must be an object.',
    );
  }
  assertExactKeys(
    expected,
    ROLE_EVIDENCE_AUTHORITY_KEYS,
    'awsSingleNodeRuntimeRole evidence authority',
  );
  const providerScope = validateProviderScope(
    expected.providerScope,
    'awsSingleNodeRuntimeRole evidence authority.providerScope',
  );
  if (
    typeof expected.roleName !== 'string' ||
    !IAM_NAME_PATTERN.test(expected.roleName)
  ) {
    throw new TypeError(
      'awsSingleNodeRuntimeRole evidence authority.roleName must be a valid IAM name.',
    );
  }
  if (expected.providerResourceId !== null) {
    try {
      assertAwsIamRoleId(
        expected.providerResourceId,
        'awsSingleNodeRuntimeRole evidence authority.providerResourceId',
      );
    } catch {
      throw new TypeError(
        'awsSingleNodeRuntimeRole evidence authority.providerResourceId must be null or a valid RoleId.',
      );
    }
  }
  if (!isPlainObject(value)) throw new AwsIamEvidenceUnknownError();
  if (
    typeof value.Path !== 'string' ||
    typeof value.RoleName !== 'string' ||
    typeof value.RoleId !== 'string' ||
    typeof value.Arn !== 'string' ||
    (value.Description !== undefined &&
      value.Description !== null &&
      typeof value.Description !== 'string') ||
    !Number.isSafeInteger(value.MaxSessionDuration) ||
    value.MaxSessionDuration < 3600 ||
    value.MaxSessionDuration > 43200 ||
    typeof value.AssumeRolePolicyDocument !== 'string'
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  const providerResourceId = validateAwsSingleNodeRuntimeRoleId(value.RoleId);
  const expectedArn = `arn:${providerScope.partition}:iam::${providerScope.accountId}:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${expected.roleName}`;
  if (
    value.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    value.RoleName !== expected.roleName ||
    value.Arn !== expectedArn ||
    (expected.providerResourceId !== null &&
      providerResourceId !== expected.providerResourceId)
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  const actualState = deepFreeze({
    schemaVersion: 1,
    kind: 'awsSingleNodeRuntimeRoleState',
    roleName: value.RoleName,
    path: value.Path,
    description: value.Description ?? null,
    maxSessionDuration: value.MaxSessionDuration,
    assumeRolePolicyDocument: decodeAwsIamJsonDocument(
      value.AssumeRolePolicyDocument,
      'awsSingleNodeRuntimeRole evidence.AssumeRolePolicyDocument',
    ),
    permissionsBoundary: decodePermissionsBoundary(value.PermissionsBoundary),
    onDestroy: 'purge',
  });
  return deepFreeze({
    providerResourceId,
    roleName: value.RoleName,
    observedDigest: actualStateDigest(actualState),
    actualState,
  });
}

/**
 * Render the exact 13-tag role ownership record shared by mutation and
 * observation.
 * @param {unknown} value - Exact controller lineage and desired digest.
 * @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>}
 */
export function getAwsSingleNodeRuntimeRoleOwnershipTags(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRole ownership authority must be an object.',
    );
  }
  assertExactKeys(
    value,
    OWNERSHIP_AUTHORITY_KEYS,
    'awsSingleNodeRuntimeRole ownership authority',
  );
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-role',
    capabilityKind: value.capabilityKind,
    roleKind: value.roleKind,
    providerScopeId: value.providerScopeId,
    deploymentInstanceId: value.deploymentInstanceId,
    incarnationId: value.incarnationId,
    resourceKey: value.resourceKey,
    createdByActionId: value.createdByActionId,
    ownershipNonce: value.ownershipNonce,
    stateDigest: value.stateDigest,
  });
}

/**
 * Strictly decode profile descendants returned by
 * ListInstanceProfilesForRole.
 * @param {unknown} value - Provider profile records.
 * @returns {Readonly<Array<Readonly<Record<string, any>>>>}
 */
export function decodeAwsSingleNodeRuntimeRoleInstanceProfiles(value) {
  if (!Array.isArray(value)) throw new AwsIamEvidenceUnknownError();
  const profiles = [];
  const ids = new Set();
  const names = new Set();
  for (const candidate of value) {
    if (
      !isPlainObject(candidate) ||
      typeof candidate.InstanceProfileId !== 'string' ||
      typeof candidate.InstanceProfileName !== 'string' ||
      !INSTANCE_PROFILE_NAME_PATTERN.test(candidate.InstanceProfileName) ||
      typeof candidate.Path !== 'string' ||
      candidate.Path.length === 0 ||
      typeof candidate.Arn !== 'string' ||
      candidate.Arn.length === 0
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    try {
      assertAwsIamInstanceProfileId(candidate.InstanceProfileId);
    } catch {
      throw new AwsIamEvidenceUnknownError();
    }
    if (
      ids.has(candidate.InstanceProfileId) ||
      names.has(candidate.InstanceProfileName)
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    ids.add(candidate.InstanceProfileId);
    names.add(candidate.InstanceProfileName);
    profiles.push(
      deepFreeze({
        instanceProfileId: candidate.InstanceProfileId,
        instanceProfileName: candidate.InstanceProfileName,
        path: candidate.Path,
        arn: candidate.Arn,
      }),
    );
  }
  profiles.sort((left, right) =>
    left.instanceProfileId < right.instanceProfileId
      ? -1
      : left.instanceProfileId > right.instanceProfileId
        ? 1
        : 0,
  );
  return Object.freeze(profiles);
}

export default {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleInstanceProfiles,
  decodeAwsSingleNodeRuntimeRoleResponse,
  getAwsSingleNodeRuntimeRoleOwnershipTags,
  validateAwsSingleNodeRuntimeRoleId,
};
