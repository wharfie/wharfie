/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamListPage,
  decodeAwsIamTags,
  validateAwsIamTags,
} from './deployment-aws-iam-evidence.js';
import {
  AWS_IAM_INSTANCE_PROFILE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
} from './deployment-aws-runtime-identity-contract.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export const AWS_SINGLE_NODE_INSTANCE_PROFILE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES = 16;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE = 50;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAGS = 50;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES = 16;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE = 1000;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCES =
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES *
  AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE;

const IAM_ROLE_NAME_PATTERN = /^[A-Za-z0-9_+=,.@-]{1,64}$/;
const IAM_INSTANCE_PROFILE_NAME_PATTERN = /^[A-Za-z0-9_+=,.@-]{1,128}$/;
const IAM_PATH_PATTERN = /^\/(?:[\u0021-\u007e]+\/)*$/;
const IAM_INSTANCE_PROFILE_ARN_PATTERN =
  /^arn:[a-z0-9-]+:iam::[0-9]{12}:instance-profile\/[\u0021-\u007e]+$/;
const EC2_INSTANCE_ID_PATTERN = /^i-[0-9a-f]{17}$/;
const PAGINATION_TOKEN_MAX_LENGTH = 4096;
const RESPONSE_OPTIONS_KEYS = new Set([
  'providerScope',
  'instanceProfileName',
  'expectedInstanceProfileId',
]);
const OWNERSHIP_TAG_KEYS = new Set([
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
  'createdByActionId',
  'ownershipNonce',
  'stateDigest',
]);
const ACTUAL_STATE_KEYS = new Set([
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
]);

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
export function validateAwsSingleNodeInstanceProfileId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_IAM_INSTANCE_PROFILE_ID_PATTERN.test(value)
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  return value;
}

/**
 * Extract only the immutable provider ID from a named profile response. This
 * lets an observer report a collision without treating malformed shape as
 * ownership evidence.
 * @param {unknown} value - Raw GetInstanceProfile response.
 * @returns {string} - Strict provider-allocated InstanceProfileId.
 */
export function decodeAwsSingleNodeInstanceProfileCandidateId(value) {
  if (!isPlainObject(value) || !isPlainObject(value.InstanceProfile)) {
    throw new AwsIamEvidenceUnknownError();
  }
  return validateAwsSingleNodeInstanceProfileId(
    value.InstanceProfile.InstanceProfileId,
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} options @returns {void} */
function validateProfileRole(value, options) {
  if (!isPlainObject(value)) {
    throw new AwsIamEvidenceConflictError();
  }
  for (const key of ['Path', 'RoleName', 'RoleId', 'Arn']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new AwsIamEvidenceConflictError();
    }
  }
  if (
    value.Path.length > 512 ||
    !IAM_PATH_PATTERN.test(value.Path) ||
    !IAM_ROLE_NAME_PATTERN.test(value.RoleName) ||
    !AWS_IAM_ROLE_ID_PATTERN.test(value.RoleId)
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  const expectedArn = `arn:${options.providerScope.partition}:iam::${options.providerScope.accountId}:role${value.Path}${value.RoleName}`;
  if (value.Arn !== expectedArn) {
    throw new AwsIamEvidenceConflictError();
  }
}

/**
 * Decode one exact deterministic-name GetInstanceProfile response. The
 * provider-allocated ID, deterministic name/path/ARN, and bounded child-role
 * cardinality are all checked without claiming ownership of the child
 * association.
 * @param {unknown} value - Raw GetInstanceProfile response.
 * @param {unknown} options - Exact credential scope and identity authority.
 * @returns {Readonly<Record<string, any>>} - Provider profile record.
 */
export function decodeAwsSingleNodeInstanceProfileResponse(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileEvidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    RESPONSE_OPTIONS_KEYS,
    'awsSingleNodeInstanceProfileEvidence options',
  );
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInstanceProfileEvidence providerScope',
  );
  if (
    typeof options.instanceProfileName !== 'string' ||
    !IAM_INSTANCE_PROFILE_NAME_PATTERN.test(options.instanceProfileName)
  ) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileEvidence instanceProfileName is invalid.',
    );
  }
  if (options.expectedInstanceProfileId !== null) {
    validateAwsSingleNodeInstanceProfileId(options.expectedInstanceProfileId);
  }
  if (!isPlainObject(value) || !isPlainObject(value.InstanceProfile)) {
    throw new AwsIamEvidenceUnknownError();
  }
  const observed = value.InstanceProfile;
  for (const key of [
    'InstanceProfileName',
    'InstanceProfileId',
    'Arn',
    'Path',
  ]) {
    if (typeof observed[key] !== 'string' || observed[key].length === 0) {
      throw new AwsIamEvidenceUnknownError();
    }
  }
  if (
    !AWS_IAM_INSTANCE_PROFILE_ID_PATTERN.test(observed.InstanceProfileId) ||
    !IAM_INSTANCE_PROFILE_NAME_PATTERN.test(observed.InstanceProfileName) ||
    observed.Path.length > 512 ||
    !IAM_PATH_PATTERN.test(observed.Path) ||
    !IAM_INSTANCE_PROFILE_ARN_PATTERN.test(observed.Arn)
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  const expectedArn = `arn:${providerScope.partition}:iam::${providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${options.instanceProfileName}`;
  if (
    observed.InstanceProfileName !== options.instanceProfileName ||
    observed.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    observed.Arn !== expectedArn ||
    (options.expectedInstanceProfileId !== null &&
      observed.InstanceProfileId !== options.expectedInstanceProfileId)
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  if (!Array.isArray(observed.Roles)) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (observed.Roles.length > 1) {
    throw new AwsIamEvidenceConflictError();
  }
  for (const role of observed.Roles) {
    validateProfileRole(role, { providerScope });
  }
  return deepFreeze({
    Path: observed.Path,
    InstanceProfileName: observed.InstanceProfileName,
    InstanceProfileId: observed.InstanceProfileId,
    Arn: observed.Arn,
    Roles: observed.Roles.map((role) => ({
      Path: role.Path,
      RoleName: role.RoleName,
      RoleId: role.RoleId,
      Arn: role.Arn,
    })),
  });
}

/**
 * Create the exact thirteen IAM ownership tags shared by profile mutation and
 * observation. Provider tags are evidence; the state digest is always
 * recomputed from durable authority before reaching this function.
 * @param {unknown} value - Exact durable ownership receipt.
 * @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>}
 */
export function createAwsSingleNodeInstanceProfileOwnershipTags(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfile ownership tags must be an object.',
    );
  }
  assertExactKeys(
    value,
    OWNERSHIP_TAG_KEYS,
    'awsSingleNodeInstanceProfile ownership tags',
  );
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-instance-profile',
    capabilityKind: 'runtime-identity',
    roleKind: 'instance-profile',
    providerScopeId: value.providerScopeId,
    deploymentInstanceId: value.deploymentInstanceId,
    incarnationId: value.incarnationId,
    resourceKey: 'runtime-identity',
    createdByActionId: value.createdByActionId,
    ownershipNonce: value.ownershipNonce,
    stateDigest: value.stateDigest,
  });
}

/**
 * Decode one IAM ListInstanceProfileTags page while retaining the historical
 * API allowance for an omitted false IsTruncated field.
 * @param {unknown} response - Raw IAM page.
 * @returns {{tags: unknown[], marker: string|null}}
 */
export function decodeAwsSingleNodeInstanceProfileTagPage(response) {
  if (!isPlainObject(response)) {
    throw new AwsIamEvidenceUnknownError();
  }
  const normalized =
    response.IsTruncated === undefined
      ? { ...response, IsTruncated: false }
      : response;
  const page = decodeAwsIamListPage(
    normalized,
    'Tags',
    AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
  );
  return { tags: page.items, marker: page.nextMarker };
}

/**
 * Validate accumulated tag evidence. Callers invoke this after every page so
 * a conclusive earlier contradiction cannot be erased by a later read error.
 * @param {Readonly<Array<unknown>>} observed - Accumulated raw IAM tag values.
 * @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expected - Exact durable ownership tags.
 * @param {boolean} allowIncomplete - Whether a strict exact subset is transitional.
 * @returns {void}
 */
export function validateAwsSingleNodeInstanceProfileTags(
  observed,
  expected,
  allowIncomplete,
) {
  if (!Array.isArray(observed)) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (observed.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAGS) {
    throw new AwsIamEvidenceConflictError();
  }
  const tags = decodeAwsIamTags(observed);
  validateAwsIamTags(tags, expected, { allowIncomplete });
}

/** @param {unknown} response @returns {{instances: Readonly<Array<Readonly<Record<string, any>>>>, nextToken: string|null}} */
export function decodeAwsSingleNodeInstanceProfileInstancePage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Reservations)) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (
    response.Reservations.length >
    AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  const instances = [];
  for (const reservation of response.Reservations) {
    if (!isPlainObject(reservation) || !Array.isArray(reservation.Instances)) {
      throw new AwsIamEvidenceUnknownError();
    }
    for (const instance of reservation.Instances) {
      if (!isPlainObject(instance)) {
        throw new AwsIamEvidenceUnknownError();
      }
      instances.push(instance);
      if (
        instances.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE
      ) {
        throw new AwsIamEvidenceUnknownError();
      }
    }
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0 ||
      response.NextToken.length > PAGINATION_TOKEN_MAX_LENGTH
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    nextToken = response.NextToken;
  }
  return { instances, nextToken };
}

/**
 * Validate the bounded current-region deletion fence. This is intentionally
 * not account-global proof: safe deletion relies on Wharfie's exclusive
 * profile rule, under which this managed profile is not reused outside the
 * configured region.
 * @param {unknown} instance - One EC2 instance returned by the exact profile-ID filter.
 * @param {Readonly<Record<string, any>>} instanceProfile - Exact owned profile.
 * @param {unknown} providerScopeValue - Fixed credential scope.
 * @returns {void}
 */
export function validateAwsSingleNodeInstanceProfileFencedInstance(
  instance,
  instanceProfile,
  providerScopeValue,
) {
  const providerScope = validateProviderScope(
    providerScopeValue,
    'awsSingleNodeInstanceProfile fenced instance providerScope',
  );
  if (
    !isPlainObject(instance) ||
    typeof instance.InstanceId !== 'string' ||
    !EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId) ||
    !isPlainObject(instance.IamInstanceProfile) ||
    typeof instance.IamInstanceProfile.Id !== 'string' ||
    typeof instance.IamInstanceProfile.Arn !== 'string' ||
    !isPlainObject(instance.State) ||
    !Number.isSafeInteger(instance.State.Code) ||
    instance.State.Code < 0 ||
    typeof instance.State.Name !== 'string'
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (
    instance.IamInstanceProfile.Id !== instanceProfile.InstanceProfileId ||
    instance.IamInstanceProfile.Arn !== instanceProfile.Arn ||
    instance.State.Name !== 'terminated' ||
    (instance.State.Code & 0xff) !== 48 ||
    instance.IamInstanceProfile.Arn !==
      `arn:${providerScope.partition}:iam::${providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${instanceProfile.InstanceProfileName}`
  ) {
    throw new AwsIamEvidenceConflictError();
  }
}

/**
 * Return the provider-allocated identity plus a digest recomputed from the
 * readable deterministic-name/path contract, never from provider tags.
 * @param {Readonly<Record<string, any>>} instanceProfile - Already decoded exact profile.
 * @param {unknown} value - Deterministic name authority.
 * @returns {Readonly<{providerResourceId: string, observedDigest: Readonly<{algorithm: 'sha256', value: string}>}>}
 */
export function decodeAwsSingleNodeInstanceProfileActualState(
  instanceProfile,
  value,
) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfile actual-state authority must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTUAL_STATE_KEYS,
    'awsSingleNodeInstanceProfile actual-state authority',
  );
  const providerResourceId = validateAwsSingleNodeInstanceProfileId(
    instanceProfile.InstanceProfileId,
  );
  return deepFreeze({
    providerResourceId,
    observedDigest: getAwsSingleNodeRuntimeInstanceProfileStateDigest(value),
  });
}

export default {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAGS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
  createAwsSingleNodeInstanceProfileOwnershipTags,
  decodeAwsSingleNodeInstanceProfileActualState,
  decodeAwsSingleNodeInstanceProfileCandidateId,
  decodeAwsSingleNodeInstanceProfileInstancePage,
  decodeAwsSingleNodeInstanceProfileResponse,
  decodeAwsSingleNodeInstanceProfileTagPage,
  validateAwsSingleNodeInstanceProfileFencedInstance,
  validateAwsSingleNodeInstanceProfileId,
  validateAwsSingleNodeInstanceProfileTags,
};
