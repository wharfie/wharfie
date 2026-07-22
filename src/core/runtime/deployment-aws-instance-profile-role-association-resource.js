/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { compareCanonicalStrings } from './canonical-order.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsIamInstanceProfileId,
  assertAwsIamRoleId,
  createAwsSingleNodeRuntimeIdentityTags,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
  validateAwsSingleNodeRuntimePolicy,
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

export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES = 16;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE = 50;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE = 1000;

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
  'getRole',
  'listRoleTags',
  'listRolePolicies',
  'listAttachedRolePolicies',
  'getRolePolicy',
  'getInstanceProfile',
  'listInstanceProfileTags',
  'listInstanceProfilesForRole',
  'addRoleToInstanceProfile',
  'removeRoleFromInstanceProfile',
]);
const RESOURCE_KEY = 'runtime-identity-role-association';
const PROVIDER_TYPE = 'iam-instance-profile-role-association';
const DECLARED_DEPENDENCY_KEYS = Object.freeze([
  'runtime-role',
  'runtime-role-policy',
  'runtime-identity',
]);
const TAG_KEYS = new Set(['Key', 'Value']);
const ATTACHED_POLICY_KEYS = new Set(['PolicyName', 'PolicyArn']);
const IAM_POLICY_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;
const IAM_PAGINATION_MARKER_MAX_LENGTH = 4096;

const ARTIFACT_DEFINITION = Object.freeze({
  resourceKey: 'artifact',
  providerType: 's3-object',
  capability: Object.freeze({ kind: 'artifact-storage', version: 1 }),
  role: Object.freeze({ kind: 'object', version: 1 }),
  ownershipMode: 'direct',
  dependsOn: Object.freeze([]),
});
const ROLE_DEFINITION = Object.freeze({
  resourceKey: 'runtime-role',
  providerType: 'iam-role',
  capability: Object.freeze({ kind: 'runtime-identity', version: 1 }),
  role: Object.freeze({ kind: 'role', version: 1 }),
  ownershipMode: 'direct',
  dependsOn: Object.freeze([]),
});
const POLICY_DEFINITION = Object.freeze({
  resourceKey: 'runtime-role-policy',
  providerType: 'iam-role-inline-policy',
  capability: Object.freeze({ kind: 'runtime-identity', version: 1 }),
  role: Object.freeze({ kind: 'inline-policy', version: 1 }),
  ownershipMode: 'derived',
  dependsOn: Object.freeze(['artifact', 'runtime-role']),
});
const PROFILE_DEFINITION = Object.freeze({
  resourceKey: 'runtime-identity',
  providerType: 'instance-profile',
  capability: Object.freeze({ kind: 'runtime-identity', version: 1 }),
  role: Object.freeze({ kind: 'instance-profile', version: 1 }),
  ownershipMode: 'direct',
  dependsOn: Object.freeze([]),
});

/** Exact controller authority or provider evidence is contradictory. */
export class AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node instance profile role association conflicts with its exact contract.',
    );
    this.name =
      'AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError';
    this.code =
      'AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError extends Error {
  constructor() {
    super(
      'AWS single-node instance profile role association state is unknown.',
    );
    this.name =
      'AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError';
    this.code =
      'AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class AssociationEvidenceConflictError extends Error {}
class AssociationEvidenceTransientError extends Error {}

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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameDependencyBindings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every(
      (dependency, index) =>
        dependency.resourceKey === right[index]?.resourceKey &&
        dependency.bindingId === right[index]?.bindingId,
    )
  );
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
function noSuchEntity(error) {
  return (
    errorNamed(error, 'NoSuchEntity') ||
    errorNamed(error, 'NoSuchEntityException')
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} plan @returns {Readonly<Record<string, string>>} */
function nameAuthority(plan) {
  return deepFreeze({
    providerScopeId: plan.providerScope.providerScopeId,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} plan @returns {Readonly<Record<string, any>>} */
function policyAuthority(plan) {
  return deepFreeze({
    providerScope: plan.providerScope,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} binding @returns {{resourceKey: string, bindingId: string}} */
function bindingReceipt(binding) {
  return { resourceKey: binding.resourceKey, bindingId: binding.bindingId };
}

/** @param {Readonly<Array<Readonly<Record<string, any>>>>} bindings @returns {Readonly<Array<Readonly<{resourceKey: string, bindingId: string}>>>} */
function sortedBindingReceipts(bindings) {
  return deepFreeze(
    bindings
      .map(bindingReceipt)
      .sort((left, right) =>
        compareCanonicalStrings(left.resourceKey, right.resourceKey),
      ),
  );
}

/** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @param {number} currentActionIndex @param {Readonly<Record<string, any>>} definition @param {Readonly<Record<string, any>>} binding @returns {Readonly<Record<string, any>>} */
function validateDependencyAction(
  plan,
  head,
  currentActionIndex,
  definition,
  binding,
) {
  const dependencyActionIndex = plan.actions.findIndex(
    (/** @type {Readonly<Record<string, any>>} */ action) =>
      action.resourceKey === definition.resourceKey,
  );
  const action = plan.actions[dependencyActionIndex];
  const intent = head.activeOperation.intents[dependencyActionIndex];
  const applyAuthority =
    plan.operation !== 'destroy' &&
    dependencyActionIndex >= 0 &&
    dependencyActionIndex < currentActionIndex &&
    intent?.status === 'settled' &&
    action?.after !== null &&
    action?.after !== undefined &&
    action.after.providerType === definition.providerType &&
    (action.after.providerResourceId === null ||
      action.after.providerResourceId === binding.providerResourceId);
  const destroyAuthority =
    plan.operation === 'destroy' &&
    dependencyActionIndex > currentActionIndex &&
    intent?.status === 'pending' &&
    action?.action === 'delete' &&
    action.before !== null &&
    action.before.providerType === definition.providerType &&
    action.before.providerResourceId === binding.providerResourceId;
  if (
    action === undefined ||
    intent === undefined ||
    (!applyAuthority && !destroyAuthority) ||
    intent.actionId !== action.actionId ||
    intent.ownershipNonce !== binding.ownershipNonce ||
    action.resourceKey !== definition.resourceKey ||
    !sameJson(action.capability, definition.capability) ||
    !sameJson(action.role, definition.role) ||
    action.management !== 'managed' ||
    action.ownershipMode !== definition.ownershipMode ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, definition.dependsOn) ||
    binding.deploymentInstanceId !== plan.deploymentInstanceId ||
    binding.incarnationId !== plan.incarnationId ||
    binding.providerScopeId !== plan.providerScope.providerScopeId ||
    binding.resourceKey !== definition.resourceKey ||
    !sameJson(binding.capability, definition.capability) ||
    !sameJson(binding.role, definition.role) ||
    binding.management !== 'managed' ||
    binding.providerType !== definition.providerType ||
    binding.ownershipMode !== definition.ownershipMode ||
    binding.onDestroy !== 'purge' ||
    (action.action === 'create' &&
      binding.createdByActionId !== action.actionId)
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  return action;
}

/** @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} head @param {number} actionIndex @returns {Readonly<Record<string, any>>} */
function resolveDependencyAuthority(plan, head, actionIndex) {
  const byKey = new Map(
    head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const artifactBinding = byKey.get(ARTIFACT_DEFINITION.resourceKey);
  const roleBinding = byKey.get(ROLE_DEFINITION.resourceKey);
  const policyBinding = byKey.get(POLICY_DEFINITION.resourceKey);
  const profileBinding = byKey.get(PROFILE_DEFINITION.resourceKey);
  if (
    artifactBinding === undefined ||
    roleBinding === undefined ||
    policyBinding === undefined ||
    profileBinding === undefined
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  validateDependencyAction(
    plan,
    head,
    actionIndex,
    ARTIFACT_DEFINITION,
    artifactBinding,
  );
  const roleAction = validateDependencyAction(
    plan,
    head,
    actionIndex,
    ROLE_DEFINITION,
    roleBinding,
  );
  const policyAction = validateDependencyAction(
    plan,
    head,
    actionIndex,
    POLICY_DEFINITION,
    policyBinding,
  );
  const profileAction = validateDependencyAction(
    plan,
    head,
    actionIndex,
    PROFILE_DEFINITION,
    profileBinding,
  );
  try {
    assertAwsIamRoleId(roleBinding.providerResourceId);
    assertAwsIamInstanceProfileId(profileBinding.providerResourceId);
  } catch {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  if (
    artifactBinding.ownershipMode !== 'direct' ||
    artifactBinding.dependencyBindings.length !== 0 ||
    typeof artifactBinding.providerResourceId !== 'string' ||
    artifactBinding.providerResourceId.length === 0 ||
    roleBinding.dependencyBindings.length !== 0 ||
    profileBinding.dependencyBindings.length !== 0
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  const policyDependencyBindings = sortedBindingReceipts([
    artifactBinding,
    roleBinding,
  ]);
  const expectedPolicyId = getAwsSingleNodeRuntimePolicyProviderResourceId({
    runtimeRoleId: roleBinding.providerResourceId,
  });
  const expectedRoleState = getAwsSingleNodeRuntimeRoleStateDigest(
    nameAuthority(plan),
  );
  const expectedProfileState =
    getAwsSingleNodeRuntimeInstanceProfileStateDigest(nameAuthority(plan));
  const expectedPolicyState = getAwsSingleNodeRuntimePolicyStateDigest(
    policyAuthority(plan),
  );
  const expectedArtifactArn = getAwsSingleNodeManagedArtifactObjectLocation(
    policyAuthority(plan),
  ).arn;
  const stateFor = (/** @type {Readonly<Record<string, any>>} */ action) =>
    plan.operation === 'destroy'
      ? action.before?.stateDigest
      : action.after?.stateDigest;
  if (
    policyBinding.providerResourceId !== expectedPolicyId ||
    artifactBinding.providerResourceId !== expectedArtifactArn ||
    !sameDependencyBindings(
      policyBinding.dependencyBindings,
      policyDependencyBindings,
    ) ||
    !sameJson(stateFor(roleAction), expectedRoleState) ||
    !sameJson(stateFor(profileAction), expectedProfileState) ||
    !sameJson(stateFor(policyAction), expectedPolicyState)
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  const dependencyBindings = sortedBindingReceipts([
    roleBinding,
    policyBinding,
    profileBinding,
  ]);
  const runtimeRoleId = roleBinding.providerResourceId;
  const instanceProfileId = profileBinding.providerResourceId;
  return deepFreeze({
    artifactBinding,
    roleBinding,
    policyBinding,
    profileBinding,
    dependencyBindings,
    runtimeRoleId,
    instanceProfileId,
    roleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(plan)),
    instanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(
      nameAuthority(plan),
    ),
    providerResourceId: getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId,
      instanceProfileId,
    }),
    stateDigest: getAwsSingleNodeRuntimeAssociationStateDigest(
      nameAuthority(plan),
    ),
    roleStateDigest: expectedRoleState,
    profileStateDigest: expectedProfileState,
    policyStateDigest: expectedPolicyState,
  });
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @param {string} ownershipNonce @param {Readonly<Record<string, any>>} dependencies @returns {boolean} */
function bindingMatchesAuthority(
  binding,
  action,
  plan,
  providerScope,
  ownershipNonce,
  dependencies,
) {
  return (
    binding.management === 'managed' &&
    binding.providerType === PROVIDER_TYPE &&
    binding.providerResourceId === dependencies.providerResourceId &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === RESOURCE_KEY &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, action.capability) &&
    sameJson(binding.role, action.role) &&
    binding.ownershipMode === 'derived' &&
    binding.onDestroy === 'purge' &&
    sameDependencyBindings(
      binding.dependencyBindings,
      dependencies.dependencyBindings,
    ) &&
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
      'awsSingleNodeInstanceProfileRoleAssociation action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociation context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeInstanceProfileRoleAssociation context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeInstanceProfileRoleAssociation context.head',
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
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'runtime-identity', version: 1 }) ||
    !sameJson(action.role, {
      kind: 'instance-profile-role-association',
      version: 1,
    }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'derived' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, DECLARED_DEPENDENCY_KEYS)
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeInstanceProfileRoleAssociation context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
  }
  const dependencies = resolveDependencyAuthority(
    plan,
    head,
    value.actionIndex,
  );
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
      !sameJson(action.after.stateDigest, dependencies.stateDigest) ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      plan.operation === 'destroy' ||
      action.before === null ||
      action.after === null ||
      priorBinding === undefined ||
      !bindingMatchesAuthority(
        priorBinding,
        action,
        plan,
        providerScope,
        ownershipNonce,
        dependencies,
      ) ||
      !sameJson(action.before.stateDigest, dependencies.stateDigest) ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, dependencies.stateDigest)
    ) {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
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
        dependencies,
      ) ||
      action.before.stateDigest === null
    ) {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
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
    priorBinding: priorBinding ?? null,
    ...dependencies,
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {'role'|'profile'} kind @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
function expectedEndpointTags(authority, kind) {
  const roleEndpoint = kind === 'role';
  const binding = roleEndpoint
    ? authority.roleBinding
    : authority.profileBinding;
  return createAwsSingleNodeRuntimeIdentityTags({
    resourceKind: roleEndpoint
      ? 'single-node-runtime-role'
      : 'single-node-runtime-instance-profile',
    capabilityKind: 'runtime-identity',
    roleKind: roleEndpoint ? 'role' : 'instance-profile',
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    resourceKey: roleEndpoint ? 'runtime-role' : 'runtime-identity',
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: roleEndpoint
      ? authority.roleStateDigest
      : authority.profileStateDigest,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateRoleEnvelope(value, authority) {
  if (!isPlainObject(value) || !isPlainObject(value.Role)) {
    throw new ProviderResponseUnknownError();
  }
  const role = value.Role;
  for (const key of [
    'Path',
    'RoleName',
    'RoleId',
    'Arn',
    'Description',
    'AssumeRolePolicyDocument',
  ]) {
    if (typeof role[key] !== 'string' || role[key].length === 0) {
      throw new ProviderResponseUnknownError();
    }
  }
  if (typeof role.MaxSessionDuration !== 'number') {
    throw new ProviderResponseUnknownError();
  }
  try {
    assertAwsIamRoleId(role.RoleId);
  } catch {
    throw new ProviderResponseUnknownError();
  }
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.roleName}`;
  if (
    role.RoleId !== authority.runtimeRoleId ||
    role.RoleName !== authority.roleName ||
    role.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    role.Arn !== expectedArn ||
    role.Description !== AWS_SINGLE_NODE_RUNTIME_ROLE_DESCRIPTION ||
    role.MaxSessionDuration !==
      AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_SESSION_DURATION ||
    (role.PermissionsBoundary !== undefined &&
      role.PermissionsBoundary !== null)
  ) {
    throw new AssociationEvidenceConflictError();
  }
  try {
    validateAwsSingleNodeRuntimeRoleTrustPolicy(role.AssumeRolePolicyDocument);
  } catch (error) {
    if (error instanceof TypeError) throw new ProviderResponseUnknownError();
    throw new AssociationEvidenceConflictError();
  }
  return role;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateInstanceProfileEnvelope(value, authority) {
  if (!isPlainObject(value) || !isPlainObject(value.InstanceProfile)) {
    throw new ProviderResponseUnknownError();
  }
  const profile = value.InstanceProfile;
  for (const key of [
    'Path',
    'InstanceProfileName',
    'InstanceProfileId',
    'Arn',
  ]) {
    if (typeof profile[key] !== 'string' || profile[key].length === 0) {
      throw new ProviderResponseUnknownError();
    }
  }
  try {
    assertAwsIamInstanceProfileId(profile.InstanceProfileId);
  } catch {
    throw new ProviderResponseUnknownError();
  }
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.instanceProfileName}`;
  if (
    profile.InstanceProfileId !== authority.instanceProfileId ||
    profile.InstanceProfileName !== authority.instanceProfileName ||
    profile.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    profile.Arn !== expectedArn
  ) {
    throw new AssociationEvidenceConflictError();
  }
  if (!Array.isArray(profile.Roles)) {
    throw new ProviderResponseUnknownError();
  }
  return profile;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateExactRoleReference(value, authority) {
  if (!isPlainObject(value)) throw new ProviderResponseUnknownError();
  for (const key of ['Path', 'RoleName', 'RoleId', 'Arn']) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new ProviderResponseUnknownError();
    }
  }
  try {
    assertAwsIamRoleId(value.RoleId);
  } catch {
    throw new ProviderResponseUnknownError();
  }
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:role${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.roleName}`;
  if (
    value.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    value.RoleName !== authority.roleName ||
    value.RoleId !== authority.runtimeRoleId ||
    value.Arn !== expectedArn
  ) {
    throw new AssociationEvidenceConflictError();
  }
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateExactProfileReference(value, authority) {
  if (!isPlainObject(value)) throw new ProviderResponseUnknownError();
  for (const key of [
    'Path',
    'InstanceProfileName',
    'InstanceProfileId',
    'Arn',
  ]) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new ProviderResponseUnknownError();
    }
  }
  try {
    assertAwsIamInstanceProfileId(value.InstanceProfileId);
  } catch {
    throw new ProviderResponseUnknownError();
  }
  const expectedArn = `arn:${authority.plan.providerScope.partition}:iam::${authority.plan.providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${authority.instanceProfileName}`;
  if (
    value.Path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
    value.InstanceProfileName !== authority.instanceProfileName ||
    value.InstanceProfileId !== authority.instanceProfileId ||
    value.Arn !== expectedArn
  ) {
    throw new AssociationEvidenceConflictError();
  }
}

/** @param {unknown} response @param {string} itemKey @param {number} maxItems @returns {{items: unknown[], marker: string|null}} */
function parseIamPage(response, itemKey, maxItems) {
  if (
    !isPlainObject(response) ||
    !Array.isArray(response[itemKey]) ||
    response[itemKey].length > maxItems ||
    typeof response.IsTruncated !== 'boolean'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (response.IsTruncated === true) {
    if (
      typeof response.Marker !== 'string' ||
      response.Marker.length === 0 ||
      response.Marker.length > IAM_PAGINATION_MARKER_MAX_LENGTH
    ) {
      throw new ProviderResponseUnknownError();
    }
    return { items: response[itemKey], marker: response.Marker };
  }
  if (response.Marker !== undefined && response.Marker !== null) {
    throw new ProviderResponseUnknownError();
  }
  return { items: response[itemKey], marker: null };
}

/** @param {Readonly<Record<string, any>>} client @param {string} method @param {string} itemKey @param {Readonly<Record<string, any>>} baseRequest @param {number} maxItems @returns {Promise<unknown[]>} */
async function readAllPages(client, method, itemKey, baseRequest, maxItems) {
  const items = [];
  const seenMarkers = new Set();
  let marker = null;
  for (
    let page = 1;
    page <= AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES;
    page += 1
  ) {
    let response;
    try {
      response = await client[method](
        deepFreeze({
          ...baseRequest,
          MaxItems: maxItems,
          ...(marker === null ? {} : { Marker: marker }),
        }),
      );
    } catch (error) {
      if (noSuchEntity(error)) throw new AssociationEvidenceTransientError();
      throw new ProviderResponseUnknownError();
    }
    const observed = parseIamPage(response, itemKey, maxItems);
    items.push(...observed.items);
    if (observed.marker === null) return items;
    if (
      page ===
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES ||
      seenMarkers.has(observed.marker)
    ) {
      throw new ProviderResponseUnknownError();
    }
    seenMarkers.add(observed.marker);
    marker = observed.marker;
  }
  throw new ProviderResponseUnknownError();
}

/** @param {unknown[]} observed @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expected @returns {void} */
function validateExactTags(observed, expected) {
  const expectedValues = new Map(expected.map((tag) => [tag.Key, tag.Value]));
  const seen = new Set();
  for (const candidate of observed) {
    if (!isPlainObject(candidate)) throw new ProviderResponseUnknownError();
    if (
      Object.keys(candidate).length !== TAG_KEYS.size ||
      ![...TAG_KEYS].every((key) => Object.hasOwn(candidate, key)) ||
      typeof candidate.Key !== 'string' ||
      candidate.Key.length === 0 ||
      typeof candidate.Value !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      seen.has(candidate.Key) ||
      expectedValues.get(candidate.Key) !== candidate.Value
    ) {
      throw new AssociationEvidenceConflictError();
    }
    seen.add(candidate.Key);
  }
  if (observed.length !== expected.length) {
    throw new AssociationEvidenceConflictError();
  }
}

/**
 * Bind the exact dependency-derived runtime role/profile relationship. The
 * factory never owns or closes the caller's narrow IAM/EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeInstanceProfileRoleAssociationResource(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociation options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociation options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeInstanceProfileRoleAssociation client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInstanceProfileRoleAssociation providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInstanceProfileRoleAssociation maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociation waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @param {'role'|'profile'} kind @returns {Promise<void>} */
  async function readEndpointTags(authority, kind) {
    const roleEndpoint = kind === 'role';
    const tags = await readAllPages(
      client,
      roleEndpoint ? 'listRoleTags' : 'listInstanceProfileTags',
      'Tags',
      roleEndpoint
        ? deepFreeze({ RoleName: authority.roleName })
        : deepFreeze({ InstanceProfileName: authority.instanceProfileName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE,
    );
    validateExactTags(tags, expectedEndpointTags(authority, kind));
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<void>} */
  async function readRoleEndpoint(authority) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: authority.roleName }),
      );
    } catch (error) {
      if (noSuchEntity(error)) throw new AssociationEvidenceTransientError();
      throw new ProviderResponseUnknownError();
    }
    validateRoleEnvelope(response, authority);
    await readEndpointTags(authority, 'role');
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<void>} */
  async function readPolicyEffect(authority) {
    let response;
    try {
      response = await client.getRolePolicy(
        deepFreeze({
          RoleName: authority.roleName,
          PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
        }),
      );
    } catch (error) {
      if (noSuchEntity(error)) throw new AssociationEvidenceTransientError();
      throw new ProviderResponseUnknownError();
    }
    if (
      !isPlainObject(response) ||
      typeof response.RoleName !== 'string' ||
      typeof response.PolicyName !== 'string' ||
      typeof response.PolicyDocument !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (
      response.RoleName !== authority.roleName ||
      response.PolicyName !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME
    ) {
      throw new AssociationEvidenceConflictError();
    }
    try {
      validateAwsSingleNodeRuntimePolicy(
        response.PolicyDocument,
        policyAuthority(authority.plan),
      );
    } catch (error) {
      if (error instanceof TypeError) throw new ProviderResponseUnknownError();
      throw new AssociationEvidenceConflictError();
    }
    const inlinePolicies = await readAllPages(
      client,
      'listRolePolicies',
      'PolicyNames',
      deepFreeze({ RoleName: authority.roleName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
    );
    for (const policyName of inlinePolicies) {
      if (
        typeof policyName !== 'string' ||
        !IAM_POLICY_NAME_PATTERN.test(policyName)
      ) {
        throw new ProviderResponseUnknownError();
      }
    }
    if (inlinePolicies.length === 0) {
      throw new AssociationEvidenceTransientError();
    }
    if (
      inlinePolicies.length !== 1 ||
      inlinePolicies[0] !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME
    ) {
      throw new AssociationEvidenceConflictError();
    }
    const attachedPolicies = await readAllPages(
      client,
      'listAttachedRolePolicies',
      'AttachedPolicies',
      deepFreeze({ RoleName: authority.roleName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
    );
    for (const policy of attachedPolicies) {
      if (
        !isPlainObject(policy) ||
        Object.keys(policy).length !== ATTACHED_POLICY_KEYS.size ||
        ![...ATTACHED_POLICY_KEYS].every((key) => Object.hasOwn(policy, key)) ||
        typeof policy.PolicyName !== 'string' ||
        !IAM_POLICY_NAME_PATTERN.test(policy.PolicyName) ||
        typeof policy.PolicyArn !== 'string' ||
        policy.PolicyArn.length === 0
      ) {
        throw new ProviderResponseUnknownError();
      }
    }
    if (attachedPolicies.length !== 0) {
      throw new AssociationEvidenceConflictError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readProfileMembership(authority) {
    let response;
    try {
      response = await client.getInstanceProfile(
        deepFreeze({ InstanceProfileName: authority.instanceProfileName }),
      );
    } catch (error) {
      if (noSuchEntity(error)) throw new AssociationEvidenceTransientError();
      throw new ProviderResponseUnknownError();
    }
    const profile = validateInstanceProfileEnvelope(response, authority);
    await readEndpointTags(authority, 'profile');
    if (profile.Roles.length === 0) return 'absent';
    if (profile.Roles.length !== 1) {
      for (const role of profile.Roles) {
        validateExactRoleReference(role, authority);
      }
      throw new AssociationEvidenceConflictError();
    }
    validateExactRoleReference(profile.Roles[0], authority);
    return 'present';
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readRoleMembership(authority) {
    const profiles = await readAllPages(
      client,
      'listInstanceProfilesForRole',
      'InstanceProfiles',
      deepFreeze({ RoleName: authority.roleName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
    );
    if (profiles.length === 0) return 'absent';
    if (profiles.length !== 1) {
      for (const profile of profiles) {
        validateExactProfileReference(profile, authority);
      }
      throw new AssociationEvidenceConflictError();
    }
    validateExactProfileReference(profiles[0], authority);
    return 'present';
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readLogicalState(authority) {
    await readRoleEndpoint(authority);
    await readPolicyEffect(authority);
    const profileState = await readProfileMembership(authority);
    const roleState = await readRoleMembership(authority);
    if (profileState !== roleState) {
      throw new AssociationEvidenceTransientError();
    }
    return profileState;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {'present'|'absent'} expectedState @param {boolean} mutationFailed @returns {Promise<void>} */
  async function recoverMutation(authority, expectedState, mutationFailed) {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const state = await readLogicalState(authority);
        if (state === expectedState) return;
        if (attempt === maxAttempts) {
          if (mutationFailed) {
            throw new AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError();
          }
          return;
        }
      } catch (error) {
        if (error instanceof AssociationEvidenceConflictError) {
          throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
        }
        if (error instanceof AssociationEvidenceTransientError) {
          if (attempt === maxAttempts) return;
        } else if (error instanceof ProviderResponseUnknownError) {
          if (attempt === maxAttempts) {
            throw new AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError();
          }
        } else {
          throw error;
        }
      }
      if (attempt < maxAttempts) await wait(attempt);
    }
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let state;
    try {
      state = await readLogicalState(authority);
    } catch (error) {
      if (error instanceof AssociationEvidenceConflictError) {
        throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
      }
      if (error instanceof AssociationEvidenceTransientError) return;
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError();
    }
    const deleting = authority.action.action === 'delete';
    const desiredState = deleting ? 'absent' : 'present';
    if (state === desiredState) return;
    let mutationFailed = false;
    try {
      if (deleting) {
        await client.removeRoleFromInstanceProfile(
          deepFreeze({
            InstanceProfileName: authority.instanceProfileName,
            RoleName: authority.roleName,
          }),
        );
      } else {
        await client.addRoleToInstanceProfile(
          deepFreeze({
            InstanceProfileName: authority.instanceProfileName,
            RoleName: authority.roleName,
          }),
        );
      }
    } catch {
      mutationFailed = true;
    }
    await recoverMutation(authority, desiredState, mutationFailed);
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    const deleting = authority.action.action === 'delete';
    const desiredState = deleting ? 'absent' : 'present';
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const state = await readLogicalState(authority);
        if (state === desiredState) {
          if (deleting) {
            return deepFreeze({ status: 'converged', binding: null });
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
              ownershipMode: 'derived',
              onDestroy: 'purge',
              dependencyBindings: authority.dependencyBindings,
              providerType: PROVIDER_TYPE,
              providerResourceId: authority.providerResourceId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          return deepFreeze({ status: 'converged', binding });
        }
      } catch (error) {
        if (error instanceof AssociationEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof AssociationEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
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
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE,
  AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError,
  AwsSingleNodeInstanceProfileRoleAssociationResourceUnknownError,
  createAwsSingleNodeInstanceProfileRoleAssociationResource,
};
