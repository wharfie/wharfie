/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable IAM relationship evidence contracts are clearer than repeated parser-specific expansions. */

import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
} from './deployment-aws-iam-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
} from './deployment-aws-runtime-identity-contract.js';

const MEMBERSHIP_AUTHORITY_KEYS = new Set([
  'providerScope',
  'roleName',
  'runtimeRoleId',
  'instanceProfileName',
  'instanceProfileId',
]);
const MEMBERSHIP_VIEW_KEYS = new Set(['membership']);
const IAM_ROLE_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;
const IAM_INSTANCE_PROFILE_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;

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

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateMembershipAuthority(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation evidence authority must be an object.',
    );
  }
  assertExactKeys(
    value,
    MEMBERSHIP_AUTHORITY_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociation evidence authority',
  );
  const providerScope = validateProviderScope(
    value.providerScope,
    'awsSingleNodeInstanceProfileRoleAssociation evidence authority.providerScope',
  );
  if (
    typeof value.roleName !== 'string' ||
    !IAM_ROLE_NAME_PATTERN.test(value.roleName) ||
    typeof value.instanceProfileName !== 'string' ||
    !IAM_INSTANCE_PROFILE_NAME_PATTERN.test(value.instanceProfileName)
  ) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation evidence authority names are invalid.',
    );
  }
  try {
    assertAwsIamRoleId(
      value.runtimeRoleId,
      'awsSingleNodeInstanceProfileRoleAssociation evidence authority.runtimeRoleId',
    );
  } catch {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation evidence authority.runtimeRoleId is invalid.',
    );
  }
  try {
    assertAwsIamInstanceProfileId(
      value.instanceProfileId,
      'awsSingleNodeInstanceProfileRoleAssociation evidence authority.instanceProfileId',
    );
  } catch {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation evidence authority.instanceProfileId is invalid.',
    );
  }
  return deepFreeze({
    providerScope,
    roleName: value.roleName,
    runtimeRoleId: value.runtimeRoleId,
    instanceProfileName: value.instanceProfileName,
    instanceProfileId: value.instanceProfileId,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateExactRoleReference(value, authority) {
  if (!isPlainObject(value)) throw new AwsIamEvidenceUnknownError();
  for (const key of ['Path', 'RoleName', 'RoleId', 'Arn']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new AwsIamEvidenceUnknownError();
    }
  }
  try {
    assertAwsIamRoleId(
      value.RoleId,
      'awsSingleNodeInstanceProfileRoleAssociation profile role.RoleId',
    );
  } catch {
    throw new AwsIamEvidenceUnknownError();
  }
  const expectedArn = `arn:${authority.providerScope.partition}:iam::${authority.providerScope.accountId}:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.roleName}`;
  if (
    value.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    value.RoleName !== authority.roleName ||
    value.RoleId !== authority.runtimeRoleId ||
    value.Arn !== expectedArn
  ) {
    throw new AwsIamEvidenceConflictError();
  }
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateExactProfileReference(value, authority) {
  if (!isPlainObject(value)) throw new AwsIamEvidenceUnknownError();
  for (const key of [
    'path',
    'instanceProfileName',
    'instanceProfileId',
    'arn',
  ]) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new AwsIamEvidenceUnknownError();
    }
  }
  try {
    assertAwsIamInstanceProfileId(
      value.instanceProfileId,
      'awsSingleNodeInstanceProfileRoleAssociation role profile.InstanceProfileId',
    );
  } catch {
    throw new AwsIamEvidenceUnknownError();
  }
  const expectedArn = `arn:${authority.providerScope.partition}:iam::${authority.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.instanceProfileName}`;
  if (
    value.path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    value.instanceProfileName !== authority.instanceProfileName ||
    value.instanceProfileId !== authority.instanceProfileId ||
    value.arn !== expectedArn
  ) {
    throw new AwsIamEvidenceConflictError();
  }
}

/**
 * Decode membership as projected by GetInstanceProfile.Roles.
 * @param {unknown} value - Exact decoded instance-profile record.
 * @param {unknown} authorityValue - Exact immutable endpoint authority.
 * @returns {Readonly<{membership: 'present'|'absent'}>}
 */
export function decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
  value,
  authorityValue,
) {
  const authority = validateMembershipAuthority(authorityValue);
  if (!isPlainObject(value) || !Array.isArray(value.Roles)) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (value.Roles.length === 0) {
    return deepFreeze({ membership: 'absent' });
  }
  for (const role of value.Roles) validateExactRoleReference(role, authority);
  if (value.Roles.length > 1) {
    throw new AwsIamEvidenceConflictError();
  }
  return deepFreeze({ membership: 'present' });
}

/**
 * Decode membership as projected by ListInstanceProfilesForRole.
 * @param {unknown} value - Complete normalized profile descendants.
 * @param {unknown} authorityValue - Exact immutable endpoint authority.
 * @returns {Readonly<{membership: 'present'|'absent'}>}
 */
export function decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
  value,
  authorityValue,
) {
  const authority = validateMembershipAuthority(authorityValue);
  if (!Array.isArray(value)) throw new AwsIamEvidenceUnknownError();
  if (value.length === 0) {
    return deepFreeze({ membership: 'absent' });
  }
  for (const profile of value) {
    validateExactProfileReference(profile, authority);
  }
  if (value.length > 1) {
    throw new AwsIamEvidenceConflictError();
  }
  return deepFreeze({ membership: 'present' });
}

/**
 * Corroborate both IAM membership projections. One-sided propagation is
 * transient and cannot prove either presence or absence.
 * @param {unknown} value - Both decoded membership projections.
 * @returns {Readonly<{presence: 'present'|'absent'}>}
 */
export function corroborateAwsSingleNodeInstanceProfileRoleAssociationViews(
  value,
) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation views must be an object.',
    );
  }
  assertExactKeys(
    value,
    new Set(['profileView', 'roleView']),
    'awsSingleNodeInstanceProfileRoleAssociation views',
  );
  if (!isPlainObject(value.profileView) || !isPlainObject(value.roleView)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation membership views must be objects.',
    );
  }
  assertExactKeys(
    value.profileView,
    MEMBERSHIP_VIEW_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociation views.profileView',
  );
  assertExactKeys(
    value.roleView,
    MEMBERSHIP_VIEW_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociation views.roleView',
  );
  const profileMembership = value.profileView?.membership;
  const roleMembership = value.roleView?.membership;
  if (
    (profileMembership !== 'present' && profileMembership !== 'absent') ||
    (roleMembership !== 'present' && roleMembership !== 'absent')
  ) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation membership views must be exact.',
    );
  }
  if (profileMembership !== roleMembership) {
    throw new AwsIamEvidenceTransientError();
  }
  return deepFreeze({ presence: profileMembership });
}

export default {
  corroborateAwsSingleNodeInstanceProfileRoleAssociationViews,
  decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView,
  decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView,
};
