/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  getAwsSingleNodeRuntimeRoleTrustPolicy,
  validateAwsSingleNodeRuntimeRoleTrustPolicy,
} from './deployment-aws-runtime-identity-contract.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export const AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES = 16;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS = 1000;

const IAM_PAGINATION_MARKER_MAX_LENGTH = 4096;

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
  'createRole',
  'getRole',
  'deleteRole',
  'listRoleTags',
  'listRolePolicies',
  'listAttachedRolePolicies',
  'listInstanceProfilesForRole',
]);
const IAM_TAG_KEYS = new Set(['Key', 'Value']);
const IAM_ATTACHED_POLICY_KEYS = new Set(['PolicyName', 'PolicyArn']);
const IAM_POLICY_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeRuntimeRoleResourceConflictError extends Error {
  constructor() {
    super('AWS single-node runtime role conflicts with its exact contract.');
    this.name = 'AwsSingleNodeRuntimeRoleResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeRuntimeRoleResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node runtime role state is unknown.');
    this.name = 'AwsSingleNodeRuntimeRoleResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class RuntimeRoleEvidenceConflictError extends Error {}
class RuntimeRoleEvidenceTransientError extends Error {}
class RuntimeRoleDeleteBlockedError extends Error {}

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

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
function requiredTags(authority) {
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: 'single-node-runtime-role',
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

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<import('@aws-sdk/client-iam').CreateRoleCommandInput>} */
function createRoleRequest(authority) {
  return deepFreeze({
    RoleName: authority.roleName,
    Path: AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
    AssumeRolePolicyDocument: JSON.stringify(
      getAwsSingleNodeRuntimeRoleTrustPolicy(),
    ),
    Description: AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
    MaxSessionDuration: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
    Tags: requiredTags(authority),
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
  let validRoleId = true;
  try {
    assertAwsIamRoleId(binding.providerResourceId);
  } catch {
    validRoleId = false;
  }
  return (
    validRoleId &&
    binding.management === 'managed' &&
    binding.providerType === 'iam-role' &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === 'runtime-role' &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0 &&
    binding.ownershipNonce === ownershipNonce &&
    action.before !== null &&
    action.before.providerType === 'iam-role' &&
    action.before.providerResourceId === binding.providerResourceId
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRole action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeRuntimeRole context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeRuntimeRole context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeRuntimeRole context.head',
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
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== 'runtime-role' ||
    !sameJson(action.capability, { kind: 'runtime-identity', version: 1 }) ||
    !sameJson(action.role, { kind: 'role', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeRuntimeRole context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  const nameAuthority = deepFreeze({
    providerScopeId: plan.providerScope.providerScopeId,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  const stateDigest = getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority);
  const roleName = getAwsSingleNodeRuntimeRoleName(nameAuthority);
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation === 'destroy' ||
      action.before !== null ||
      action.after === null ||
      action.after.providerType !== 'iam-role' ||
      action.after.providerResourceId !== null ||
      !sameJson(action.after.stateDigest, stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeRuntimeRoleResourceConflictError();
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
      action.after.providerType !== 'iam-role' ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeRuntimeRoleResourceConflictError();
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
      throw new AwsSingleNodeRuntimeRoleResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeRuntimeRoleResourceConflictError();
  }
  return deepFreeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec: canonicalProviderSpec,
    stateDigest,
    roleName,
    priorBinding: priorBinding ?? null,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function roleFromResponse(value) {
  if (!isPlainObject(value) || !isPlainObject(value.Role)) {
    throw new ProviderResponseUnknownError();
  }
  return value.Role;
}

/** @param {Readonly<Record<string, any>>} role @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateRoleEvidence(role, authority) {
  if (
    typeof role.Path !== 'string' ||
    typeof role.RoleName !== 'string' ||
    typeof role.RoleId !== 'string' ||
    typeof role.Arn !== 'string' ||
    typeof role.Description !== 'string' ||
    typeof role.MaxSessionDuration !== 'number' ||
    typeof role.AssumeRolePolicyDocument !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  try {
    assertAwsIamRoleId(role.RoleId, 'runtimeRole.RoleId');
  } catch {
    throw new ProviderResponseUnknownError();
  }
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.roleName}`;
  if (
    role.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    role.RoleName !== authority.roleName ||
    role.Arn !== expectedArn ||
    role.Description !== AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION ||
    role.MaxSessionDuration !==
      AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION ||
    (role.PermissionsBoundary !== undefined &&
      role.PermissionsBoundary !== null) ||
    (authority.priorBinding !== null &&
      role.RoleId !== authority.priorBinding.providerResourceId)
  ) {
    throw new RuntimeRoleEvidenceConflictError();
  }
  try {
    validateAwsSingleNodeRuntimeRoleTrustPolicy(
      role.AssumeRolePolicyDocument,
      'runtimeRole.AssumeRolePolicyDocument',
    );
  } catch (error) {
    if (error instanceof TypeError) throw new ProviderResponseUnknownError();
    throw new RuntimeRoleEvidenceConflictError();
  }
}

/** @param {unknown} response @param {string} itemKey @returns {{items: unknown[], nextMarker: string|null}} */
function parseIamListPage(response, itemKey) {
  if (
    !isPlainObject(response) ||
    !Array.isArray(response[itemKey]) ||
    response[itemKey].length > AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS ||
    typeof response.IsTruncated !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (response.IsTruncated) {
    if (
      typeof response.Marker !== 'string' ||
      response.Marker.length === 0 ||
      response.Marker.length > IAM_PAGINATION_MARKER_MAX_LENGTH
    ) {
      throw new ProviderResponseUnknownError();
    }
    return { items: response[itemKey], nextMarker: response.Marker };
  }
  if (response.Marker !== undefined && response.Marker !== null) {
    throw new ProviderResponseUnknownError();
  }
  return { items: response[itemKey], nextMarker: null };
}

/** @param {Readonly<Record<string, any>>} client @param {string} method @param {string} itemKey @param {Readonly<Record<string, any>>} baseRequest @returns {Promise<unknown[]>} */
async function readIamList(client, method, itemKey, baseRequest) {
  const items = [];
  const seenMarkers = new Set();
  let marker = null;
  for (
    let page = 1;
    page <= AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES;
    page += 1
  ) {
    const request = deepFreeze({
      ...baseRequest,
      MaxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
      ...(marker === null ? {} : { Marker: marker }),
    });
    let response;
    try {
      response = await client[method](request);
    } catch (error) {
      if (errorNamed(error, 'NoSuchEntity')) {
        throw new RuntimeRoleEvidenceTransientError();
      }
      throw new ProviderResponseUnknownError();
    }
    const observed = parseIamListPage(response, itemKey);
    items.push(...observed.items);
    if (observed.nextMarker === null) return items;
    if (
      page === AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES ||
      seenMarkers.has(observed.nextMarker)
    ) {
      throw new ProviderResponseUnknownError();
    }
    seenMarkers.add(observed.nextMarker);
    marker = observed.nextMarker;
  }
  throw new ProviderResponseUnknownError();
}

/** @param {unknown[]} observed @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expected @param {boolean} allowIncomplete @returns {void} */
function validateExactTags(observed, expected, allowIncomplete) {
  /** @type {Array<{Key: string, Value: string}>} */
  const tags = [];
  const seenKeys = new Set();
  for (const candidate of observed) {
    if (!isPlainObject(candidate)) throw new ProviderResponseUnknownError();
    if (
      Object.keys(candidate).length !== IAM_TAG_KEYS.size ||
      ![...IAM_TAG_KEYS].every((key) => Object.hasOwn(candidate, key)) ||
      typeof candidate.Key !== 'string' ||
      candidate.Key.length === 0 ||
      typeof candidate.Value !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (seenKeys.has(candidate.Key)) {
      throw new RuntimeRoleEvidenceConflictError();
    }
    seenKeys.add(candidate.Key);
    tags.push({ Key: candidate.Key, Value: candidate.Value });
  }
  tags.sort((left, right) =>
    left.Key < right.Key ? -1 : left.Key > right.Key ? 1 : 0,
  );
  if (sameJson(tags, expected)) return;
  if (
    allowIncomplete &&
    tags.length < expected.length &&
    tags.every((tag) =>
      expected.some(
        (candidate) =>
          candidate.Key === tag.Key && candidate.Value === tag.Value,
      ),
    )
  ) {
    throw new RuntimeRoleEvidenceTransientError();
  }
  throw new RuntimeRoleEvidenceConflictError();
}

/** @param {unknown[]} observed @returns {string[]} */
function validatePolicyNames(observed) {
  const names = [];
  const seen = new Set();
  for (const candidate of observed) {
    if (
      typeof candidate !== 'string' ||
      !IAM_POLICY_NAME_PATTERN.test(candidate)
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (seen.has(candidate)) throw new ProviderResponseUnknownError();
    seen.add(candidate);
    names.push(candidate);
  }
  return names;
}

/** @param {unknown[]} observed @returns {void} */
function validateAttachedPolicies(observed) {
  for (const candidate of observed) {
    if (!isPlainObject(candidate)) throw new ProviderResponseUnknownError();
    if (
      Object.keys(candidate).length !== IAM_ATTACHED_POLICY_KEYS.size ||
      ![...IAM_ATTACHED_POLICY_KEYS].every((key) =>
        Object.hasOwn(candidate, key),
      ) ||
      typeof candidate.PolicyName !== 'string' ||
      !IAM_POLICY_NAME_PATTERN.test(candidate.PolicyName) ||
      typeof candidate.PolicyArn !== 'string' ||
      candidate.PolicyArn.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
  }
}

/** @param {unknown[]} observed @returns {void} */
function validateInstanceProfiles(observed) {
  for (const candidate of observed) {
    if (
      !isPlainObject(candidate) ||
      typeof candidate.InstanceProfileId !== 'string' ||
      typeof candidate.InstanceProfileName !== 'string' ||
      candidate.InstanceProfileName.length === 0 ||
      typeof candidate.Arn !== 'string' ||
      candidate.Arn.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    try {
      assertAwsIamInstanceProfileId(candidate.InstanceProfileId);
    } catch {
      throw new ProviderResponseUnknownError();
    }
  }
}

/**
 * Bind one exact directly owned IAM role to the fixed AWS single-node graph.
 * The factory never owns or closes the caller's narrow IAM/EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeRuntimeRoleResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeRuntimeRole options must be an object.');
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeRuntimeRole options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRuntimeRole options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeRuntimeRole client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeRuntimeRole client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeRuntimeRole providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRuntimeRole maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRuntimeRole waitForRetry must be a function.',
    );
  }
  /** @type {Set<string>} */
  const claimedCreateAttempts = new Set();

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readRole(authority) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: authority.roleName }),
      );
    } catch (error) {
      if (errorNamed(error, 'NoSuchEntity')) return null;
      throw new ProviderResponseUnknownError();
    }
    const role = roleFromResponse(response);
    validateRoleEvidence(role, authority);

    const tags = await readIamList(
      client,
      'listRoleTags',
      'Tags',
      deepFreeze({ RoleName: authority.roleName }),
    );
    validateExactTags(
      tags,
      requiredTags(authority),
      authority.action.action !== 'noop',
    );

    const inlinePolicies = validatePolicyNames(
      await readIamList(
        client,
        'listRolePolicies',
        'PolicyNames',
        deepFreeze({ RoleName: authority.roleName }),
      ),
    );
    const attachedPolicies = await readIamList(
      client,
      'listAttachedRolePolicies',
      'AttachedPolicies',
      deepFreeze({ RoleName: authority.roleName }),
    );
    validateAttachedPolicies(attachedPolicies);

    if (authority.action.action === 'delete') {
      const profiles = await readIamList(
        client,
        'listInstanceProfilesForRole',
        'InstanceProfiles',
        deepFreeze({ RoleName: authority.roleName }),
      );
      validateInstanceProfiles(profiles);
      if (
        inlinePolicies.length !== 0 ||
        attachedPolicies.length !== 0 ||
        profiles.length !== 0
      ) {
        throw new RuntimeRoleDeleteBlockedError();
      }
    } else if (
      (inlinePolicies.length === 1 &&
        inlinePolicies[0] !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME) ||
      inlinePolicies.length > 1 ||
      attachedPolicies.length !== 0
    ) {
      throw new RuntimeRoleEvidenceConflictError();
    }
    return role;
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let role;
    try {
      role = await readRole(authority);
    } catch (error) {
      if (error instanceof RuntimeRoleEvidenceConflictError) {
        throw new AwsSingleNodeRuntimeRoleResourceConflictError();
      }
      if (
        authority.action.action === 'create' &&
        error instanceof RuntimeRoleEvidenceTransientError
      ) {
        return;
      }
      if (
        authority.action.action === 'delete' &&
        (error instanceof RuntimeRoleDeleteBlockedError ||
          error instanceof RuntimeRoleEvidenceTransientError)
      ) {
        return;
      }
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (role === null) return;
      try {
        await client.deleteRole(deepFreeze({ RoleName: authority.roleName }));
      } catch (error) {
        if (errorNamed(error, 'NoSuchEntity')) return;
        if (
          errorNamed(error, 'DeleteConflict') ||
          errorNamed(error, 'ConcurrentModification')
        ) {
          return;
        }
        // DeleteRole is deterministic and safely replayable. Recover an
        // ambiguous response through exact ownership readback so a lost
        // success does not turn an already-absent role into an unknown action.
        try {
          await readRole(authority);
        } catch (readError) {
          if (
            readError instanceof RuntimeRoleEvidenceConflictError ||
            readError instanceof RuntimeRoleEvidenceTransientError ||
            readError instanceof RuntimeRoleDeleteBlockedError
          ) {
            return;
          }
          throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
        }
        return;
      }
      return;
    }
    if (role !== null) return;

    const createAttemptKey = `${authority.action.actionId}\0${authority.ownershipNonce}`;
    if (claimedCreateAttempts.has(createAttemptKey)) {
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
    claimedCreateAttempts.add(createAttemptKey);

    let createFailed = false;
    try {
      await client.createRole(createRoleRequest(authority));
    } catch {
      createFailed = true;
    }

    // CreateRole has no idempotency token. Whether the response was returned,
    // lost, or classified as EntityAlreadyExists, only exact named readback and
    // the atomic ownership tags may prove that this durable intent took effect.
    try {
      const recovered = await readRole(authority);
      if (recovered !== null) return;
    } catch (error) {
      if (error instanceof RuntimeRoleEvidenceConflictError) {
        throw new AwsSingleNodeRuntimeRoleResourceConflictError();
      }
      if (error instanceof RuntimeRoleEvidenceTransientError) return;
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
    if (createFailed) {
      throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const role = await readRole(authority);
        if (role !== null) {
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
              providerType: 'iam-role',
              providerResourceId: role.RoleId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          return deepFreeze({ status: 'converged', binding });
        }
        if (authority.action.action === 'delete') {
          return deepFreeze({ status: 'converged', binding: null });
        }
        if (authority.action.action === 'noop') {
          return Object.freeze({ status: 'blocked' });
        }
      } catch (error) {
        if (
          error instanceof RuntimeRoleEvidenceConflictError ||
          error instanceof RuntimeRoleDeleteBlockedError
        ) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof RuntimeRoleEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeRuntimeRoleResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
    return Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
  AwsSingleNodeRuntimeRoleResourceConflictError,
  AwsSingleNodeRuntimeRoleResourceUnknownError,
  createAwsSingleNodeRuntimeRoleResource,
};
