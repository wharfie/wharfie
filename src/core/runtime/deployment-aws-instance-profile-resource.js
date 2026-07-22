/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import {
  AWS_IAM_INSTANCE_PROFILE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
} from './deployment-aws-runtime-identity-contract.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

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

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const ACTION_CONTEXT_KEYS = new Set([
  'operation',
  'plan',
  'action',
  'actionIndex',
  'ownershipNonce',
  'head',
  'profile',
  'artifactStage',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'getInstanceProfile',
  'createInstanceProfile',
  'deleteInstanceProfile',
  'listInstanceProfileTags',
  'describeInstances',
]);
const IAM_ROLE_NAME_PATTERN = /^[A-Za-z0-9_+=,.@-]{1,64}$/;
const IAM_INSTANCE_PROFILE_NAME_PATTERN = /^[A-Za-z0-9_+=,.@-]{1,128}$/;
const IAM_PATH_PATTERN = /^\/(?:[\u0021-\u007e]+\/)*$/;
const IAM_INSTANCE_PROFILE_ARN_PATTERN =
  /^arn:[a-z0-9-]+:iam::[0-9]{12}:instance-profile\/[\u0021-\u007e]+$/;
const EC2_INSTANCE_ID_PATTERN = /^i-[0-9a-f]{17}$/;
const PAGINATION_TOKEN_MAX_LENGTH = 4096;
const RESOURCE_KEY = 'runtime-identity';
const PROVIDER_TYPE = 'instance-profile';

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeInstanceProfileResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node instance profile resource conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeInstanceProfileResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_INSTANCE_PROFILE_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeInstanceProfileResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node instance profile resource state is unknown.');
    this.name = 'AwsSingleNodeInstanceProfileResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_INSTANCE_PROFILE_RESOURCE_UNKNOWN';
  }
}

/** Provider evidence is well formed and contradicts the exact resource. */
class InstanceProfileEvidenceConflictError extends Error {}

/** Provider evidence may still be converging or disappearing. */
class InstanceProfileEvidenceTransientError extends Error {}

/** A bounded provider response cannot establish exact evidence. */
class ProviderResponseUnknownError extends Error {}

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

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertSupportedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertRequiredKeys(value, keys, path) {
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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {unknown} error @returns {boolean} */
function instanceProfileNotFound(error) {
  return (
    errorNamed(error, 'NoSuchEntity') ||
    errorNamed(error, 'NoSuchEntityException')
  );
}

/** @param {unknown} error @returns {boolean} */
function instanceProfileAlreadyExists(error) {
  return (
    errorNamed(error, 'EntityAlreadyExists') ||
    errorNamed(error, 'EntityAlreadyExistsException')
  );
}

/** @param {unknown} error @returns {boolean} */
function deletionMayStillConverge(error) {
  return (
    errorNamed(error, 'DeleteConflict') ||
    errorNamed(error, 'DeleteConflictException') ||
    errorNamed(error, 'ConcurrentModification') ||
    errorNamed(error, 'ConcurrentModificationException')
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function nameAuthority(authority) {
  return deepFreeze({
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @param {string} ownershipNonce @returns {boolean} */
function bindingMatchesAuthority(
  binding,
  action,
  plan,
  providerScope,
  ownershipNonce,
) {
  return (
    binding.management === 'managed' &&
    binding.providerType === PROVIDER_TYPE &&
    AWS_IAM_INSTANCE_PROFILE_ID_PATTERN.test(binding.providerResourceId) &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === RESOURCE_KEY &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0 &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === PROVIDER_TYPE &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfile action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeInstanceProfile context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeInstanceProfile context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeInstanceProfile context.head',
  );
  const expectedOperationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : head.settledDeploymentRevisionId === null
        ? 'create'
        : head.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  if (
    value.operation !== plan.operation ||
    plan.providerScope.providerScopeId !== providerScope.providerScopeId ||
    canonicalProviderSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
    head.deploymentInstanceId !== plan.deploymentInstanceId ||
    head.incarnationId !== plan.incarnationId ||
    head.providerScope.providerScopeId !== providerScope.providerScopeId ||
    head.activeOperation === null ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.kind !== expectedOperationKind ||
    plan.basis.headGeneration >= head.generation ||
    plan.basis.settledDeploymentRevisionId !==
      head.settledDeploymentRevisionId ||
    head.targetDeploymentRevisionId !==
      (expectedOperationKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId) ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ candidate,
        /** @type {number} */ index,
      ) => candidate.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeInstanceProfileResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeInstanceProfileResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'runtime-identity', version: 1 }) ||
    !sameJson(action.role, { kind: 'instance-profile', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeInstanceProfileResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeInstanceProfile context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeInstanceProfileResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeRuntimeInstanceProfileStateDigest({
    providerScopeId: plan.providerScope.providerScopeId,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeInstanceProfileResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      action.after === null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
      ) ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeInstanceProfileResourceConflictError();
    }
  } else if (action.action === 'delete') {
    if (
      plan.operation !== 'destroy' ||
      action.after !== null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
      ) ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeInstanceProfileResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeInstanceProfileResourceConflictError();
  }
  return deepFreeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec: validateAwsSingleNodeProviderSpec(canonicalProviderSpec),
    stateDigest,
    priorBinding: priorBinding ?? null,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
function requiredTags(authority) {
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-instance-profile',
    capabilityKind: authority.action.capability.kind,
    roleKind: authority.action.role.kind,
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    resourceKey: authority.action.resourceKey,
    createdByActionId:
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    ownershipNonce: authority.ownershipNonce,
    stateDigest: authority.stateDigest,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<import('@aws-sdk/client-iam').CreateInstanceProfileCommandInput>} */
function createInstanceProfileRequest(authority) {
  return deepFreeze({
    InstanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(
      nameAuthority(authority),
    ),
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    Tags: requiredTags(authority),
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateInstanceProfileEnvelope(value, authority) {
  if (!isPlainObject(value) || !isPlainObject(value.InstanceProfile)) {
    throw new ProviderResponseUnknownError();
  }
  const observed = value.InstanceProfile;
  const expectedName = getAwsSingleNodeRuntimeInstanceProfileName(
    nameAuthority(authority),
  );
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${expectedName}`;
  for (const key of [
    'InstanceProfileName',
    'InstanceProfileId',
    'Arn',
    'Path',
  ]) {
    if (typeof observed[key] !== 'string' || observed[key].length === 0) {
      throw new ProviderResponseUnknownError();
    }
  }
  if (
    !AWS_IAM_INSTANCE_PROFILE_ID_PATTERN.test(observed.InstanceProfileId) ||
    !IAM_INSTANCE_PROFILE_NAME_PATTERN.test(observed.InstanceProfileName) ||
    observed.Path.length > 512 ||
    !IAM_PATH_PATTERN.test(observed.Path) ||
    !IAM_INSTANCE_PROFILE_ARN_PATTERN.test(observed.Arn)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    observed.InstanceProfileName !== expectedName ||
    observed.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    observed.Arn !== expectedArn
  ) {
    throw new InstanceProfileEvidenceConflictError();
  }
  if (authority.priorBinding !== null) {
    if (
      observed.InstanceProfileId !== authority.priorBinding.providerResourceId
    ) {
      throw new InstanceProfileEvidenceConflictError();
    }
  }
  if (!Array.isArray(observed.Roles)) {
    throw new ProviderResponseUnknownError();
  }
  if (observed.Roles.length > 1) {
    throw new InstanceProfileEvidenceConflictError();
  }
  for (const role of observed.Roles) {
    validateRole(role, authority);
  }
  return observed;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateRole(value, authority) {
  if (!isPlainObject(value)) {
    throw new InstanceProfileEvidenceConflictError();
  }
  for (const key of ['Path', 'RoleName', 'RoleId', 'Arn']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new InstanceProfileEvidenceConflictError();
    }
  }
  if (
    value.Path.length > 512 ||
    !IAM_PATH_PATTERN.test(value.Path) ||
    !IAM_ROLE_NAME_PATTERN.test(value.RoleName) ||
    !AWS_IAM_ROLE_ID_PATTERN.test(value.RoleId)
  ) {
    throw new InstanceProfileEvidenceConflictError();
  }
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:role${value.Path}${value.RoleName}`;
  if (value.Arn !== expectedArn) {
    throw new InstanceProfileEvidenceConflictError();
  }
}

/** @param {unknown} response @returns {{tags: Readonly<Array<Readonly<{Key: string, Value: string}>>>, marker: string|null}} */
function validateTagPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Tags)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.Tags.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE) {
    throw new ProviderResponseUnknownError();
  }
  const tags = [];
  for (const tag of response.Tags) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      tag.Key.length > 128 ||
      typeof tag.Value !== 'string' ||
      tag.Value.length > 256
    ) {
      throw new ProviderResponseUnknownError();
    }
    tags.push({ Key: tag.Key, Value: tag.Value });
  }
  if (
    response.IsTruncated !== undefined &&
    typeof response.IsTruncated !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  const truncated = response.IsTruncated === true;
  if (truncated) {
    if (
      typeof response.Marker !== 'string' ||
      response.Marker.length === 0 ||
      response.Marker.length > PAGINATION_TOKEN_MAX_LENGTH
    ) {
      throw new ProviderResponseUnknownError();
    }
    return { tags, marker: response.Marker };
  }
  if (response.Marker !== undefined && response.Marker !== null) {
    throw new ProviderResponseUnknownError();
  }
  return { tags, marker: null };
}

/** @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} observed @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expected @param {boolean} allowIncomplete @returns {void} */
function validateExactTags(observed, expected, allowIncomplete) {
  if (
    observed.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAGS ||
    observed.length > expected.length
  ) {
    throw new InstanceProfileEvidenceConflictError();
  }
  const expectedValues = new Map(expected.map((tag) => [tag.Key, tag.Value]));
  const values = new Map();
  for (const tag of observed) {
    if (values.has(tag.Key)) {
      throw new InstanceProfileEvidenceConflictError();
    }
    if (
      !expectedValues.has(tag.Key) ||
      expectedValues.get(tag.Key) !== tag.Value
    ) {
      throw new InstanceProfileEvidenceConflictError();
    }
    values.set(tag.Key, tag.Value);
  }
  if (observed.length === expected.length) return;
  if (allowIncomplete) {
    throw new InstanceProfileEvidenceTransientError();
  }
  if (expected.some((tag) => values.get(tag.Key) !== tag.Value)) {
    throw new InstanceProfileEvidenceConflictError();
  }
}

/** @param {unknown} response @returns {{instances: Readonly<Array<Readonly<Record<string, any>>>>, nextToken: string|null}} */
function validateInstancePage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Reservations)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    response.Reservations.length >
    AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE
  ) {
    throw new ProviderResponseUnknownError();
  }
  const instances = [];
  for (const reservation of response.Reservations) {
    if (!isPlainObject(reservation) || !Array.isArray(reservation.Instances)) {
      throw new ProviderResponseUnknownError();
    }
    for (const instance of reservation.Instances) {
      if (!isPlainObject(instance)) {
        throw new ProviderResponseUnknownError();
      }
      instances.push(instance);
      if (
        instances.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE
      ) {
        throw new ProviderResponseUnknownError();
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
      throw new ProviderResponseUnknownError();
    }
    nextToken = response.NextToken;
  }
  return { instances, nextToken };
}

/**
 * Validate the only EC2 evidence this profile driver can safely observe.
 * This is a bounded current-region fence, not account-global proof: the
 * deletion guarantee depends on Wharfie's exclusive-profile contract, under
 * which this managed profile is never attached outside its configured region
 * or reused by non-Wharfie infrastructure.
 * @param {Readonly<Record<string, any>>} instance - One returned EC2 instance.
 * @param {Readonly<Record<string, any>>} instanceProfile - Exact owned profile.
 * @param {Readonly<Record<string, any>>} authority - Fixed controller authority.
 * @returns {void} - Returns only for confirmed terminated use.
 */
function validateFencedInstance(instance, instanceProfile, authority) {
  if (
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
    throw new ProviderResponseUnknownError();
  }
  if (
    instance.IamInstanceProfile.Id !== instanceProfile.InstanceProfileId ||
    instance.IamInstanceProfile.Arn !== instanceProfile.Arn
  ) {
    throw new InstanceProfileEvidenceConflictError();
  }
  if (
    instance.State.Name !== 'terminated' ||
    (instance.State.Code & 0xff) !== 48
  ) {
    throw new InstanceProfileEvidenceConflictError();
  }
  if (
    instance.IamInstanceProfile.Arn !==
    `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${instanceProfile.InstanceProfileName}`
  ) {
    throw new InstanceProfileEvidenceConflictError();
  }
}

/**
 * Bind one exact directly owned runtime instance profile to the fixed AWS
 * single-node graph. The factory never owns or closes the caller's narrow
 * IAM/EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>}
 */
export function createAwsSingleNodeInstanceProfileResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfile options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInstanceProfile options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInstanceProfile options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfile client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeInstanceProfile client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInstanceProfile providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_INSTANCE_PROFILE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInstanceProfile maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInstanceProfile waitForRetry must be a function.',
    );
  }
  /** One crossed IAM create boundary cannot be replayed in this process. */
  const attemptedEffects = new Set();

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeInstanceProfileResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {string} */
  function effectKey(authority) {
    return `${authority.action.actionId}\0${authority.ownershipNonce}`;
  }

  /** @param {string} instanceProfileName @returns {Promise<Readonly<Array<Readonly<{Key: string, Value: string}>>>>} */
  async function readAllTags(instanceProfileName) {
    const tags = [];
    const seenMarkers = new Set();
    let marker = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.listInstanceProfileTags(
          deepFreeze({
            InstanceProfileName: instanceProfileName,
            MaxItems: AWS_SINGLE_NODE_INSTANCE_PROFILE_TAG_PAGE_SIZE,
            ...(marker === null ? {} : { Marker: marker }),
          }),
        );
      } catch (error) {
        if (instanceProfileNotFound(error)) {
          throw new InstanceProfileEvidenceTransientError();
        }
        throw new ProviderResponseUnknownError();
      }
      const observed = validateTagPage(response);
      tags.push(...observed.tags);
      if (tags.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAGS) {
        throw new InstanceProfileEvidenceConflictError();
      }
      if (observed.marker === null) return tags;
      if (
        page === AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES ||
        seenMarkers.has(observed.marker)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenMarkers.add(observed.marker);
      marker = observed.marker;
    }
    throw new ProviderResponseUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} instanceProfile @param {Readonly<Record<string, any>>} authority @returns {Promise<void>} */
  async function assertNoCurrentRegionInstanceUse(instanceProfile, authority) {
    const seenTokens = new Set();
    let nextToken = null;
    let totalInstances = 0;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeInstances(
          deepFreeze({
            Filters: [
              {
                Name: 'iam-instance-profile.id',
                Values: [instanceProfile.InstanceProfileId],
              },
            ],
            IncludeManagedResources: true,
            MaxResults: AWS_SINGLE_NODE_INSTANCE_PROFILE_INSTANCE_PAGE_SIZE,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = validateInstancePage(response);
      totalInstances += observed.instances.length;
      if (totalInstances > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCES) {
        throw new ProviderResponseUnknownError();
      }
      for (const instance of observed.instances) {
        validateFencedInstance(instance, instanceProfile, authority);
      }
      if (observed.nextToken === null) return;
      if (
        page === AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    throw new ProviderResponseUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExactProfile(authority) {
    const instanceProfileName = getAwsSingleNodeRuntimeInstanceProfileName(
      nameAuthority(authority),
    );
    let response;
    try {
      response = await client.getInstanceProfile(
        deepFreeze({ InstanceProfileName: instanceProfileName }),
      );
    } catch (error) {
      if (instanceProfileNotFound(error)) return null;
      throw new ProviderResponseUnknownError();
    }
    const instanceProfile = validateInstanceProfileEnvelope(
      response,
      authority,
    );
    const tags = await readAllTags(instanceProfileName);
    validateExactTags(
      tags,
      requiredTags(authority),
      authority.action.action !== 'noop',
    );
    if (authority.action.action === 'delete') {
      if (instanceProfile.Roles.length !== 0) {
        throw new InstanceProfileEvidenceConflictError();
      }
      await assertNoCurrentRegionInstanceUse(instanceProfile, authority);
    }
    return instanceProfile;
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let instanceProfile;
    try {
      instanceProfile = await readExactProfile(authority);
    } catch (error) {
      if (error instanceof InstanceProfileEvidenceConflictError) {
        if (authority.action.action === 'delete') return;
        throw new AwsSingleNodeInstanceProfileResourceConflictError();
      }
      if (
        (authority.action.action === 'create' ||
          authority.action.action === 'delete') &&
        error instanceof InstanceProfileEvidenceTransientError
      ) {
        return;
      }
      throw new AwsSingleNodeInstanceProfileResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (instanceProfile === null) return;
      try {
        await client.deleteInstanceProfile(
          deepFreeze({
            InstanceProfileName: instanceProfile.InstanceProfileName,
          }),
        );
      } catch (error) {
        if (instanceProfileNotFound(error)) return;
        if (deletionMayStillConverge(error)) return;
        // DeleteInstanceProfile is deterministic and safely replayable. A
        // lost response advances through exact ownership readback first; only
        // an unreadable provider state is surfaced as unknown.
        try {
          await readExactProfile(authority);
        } catch (readError) {
          if (
            readError instanceof InstanceProfileEvidenceConflictError ||
            readError instanceof InstanceProfileEvidenceTransientError
          ) {
            return;
          }
          throw new AwsSingleNodeInstanceProfileResourceUnknownError();
        }
        return;
      }
      return;
    }
    if (instanceProfile !== null) return;
    const key = effectKey(authority);
    if (attemptedEffects.has(key)) {
      return;
    }
    attemptedEffects.add(key);
    try {
      await client.createInstanceProfile(
        createInstanceProfileRequest(authority),
      );
    } catch (error) {
      if (!instanceProfileAlreadyExists(error)) {
        // IAM provides no create idempotency token. Once the request crosses
        // the narrow authority boundary every failure is ambiguous too.
      }
    }
    // A successful response, EntityAlreadyExists, and transport response loss
    // all advance exclusively through exact deterministic-name/tag readback.
    try {
      await readExactProfile(authority);
    } catch (error) {
      if (error instanceof InstanceProfileEvidenceConflictError) {
        throw new AwsSingleNodeInstanceProfileResourceConflictError();
      }
      if (
        error instanceof ProviderResponseUnknownError ||
        error instanceof InstanceProfileEvidenceTransientError
      ) {
        return;
      }
      throw error;
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const instanceProfile = await readExactProfile(authority);
        if (instanceProfile !== null) {
          if (authority.action.action === 'delete') {
            return Object.freeze({ status: 'not-converged' });
          }
          const binding =
            authority.priorBinding ??
            createDeploymentResourceBinding({
              schemaVersion: 2,
              kind: 'deploymentResourceBinding',
              deploymentInstanceId: authority.plan.deploymentInstanceId,
              incarnationId: authority.plan.incarnationId,
              resourceKey: authority.action.resourceKey,
              capability: authority.action.capability,
              role: authority.action.role,
              management: 'managed',
              ownershipMode: authority.action.ownershipMode,
              onDestroy: authority.action.onDestroy,
              dependencyBindings: [],
              providerType: PROVIDER_TYPE,
              providerResourceId: instanceProfile.InstanceProfileId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          return deepFreeze({ status: 'converged', binding });
        }
        if (authority.action.action === 'delete') {
          return deepFreeze({ status: 'converged', binding: null });
        }
      } catch (error) {
        if (error instanceof InstanceProfileEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof InstanceProfileEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeInstanceProfileResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
    return authority.action.action === 'noop'
      ? Object.freeze({ status: 'blocked' })
      : Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
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
  AwsSingleNodeInstanceProfileResourceConflictError,
  AwsSingleNodeInstanceProfileResourceUnknownError,
  createAwsSingleNodeInstanceProfileResource,
};
