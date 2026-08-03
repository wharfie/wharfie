/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { compareCanonicalStrings } from './canonical-order.js';
import {
  AWS_IAM_EVIDENCE_MAX_READ_PAGES,
  AWS_IAM_EVIDENCE_MAX_TAGS,
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTags,
} from './deployment-aws-iam-evidence.js';
import {
  corroborateAwsSingleNodeInstanceProfileRoleAssociationViews,
  decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView,
  decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView,
} from './deployment-aws-instance-profile-role-association-evidence.js';
import {
  createAwsSingleNodeInstanceProfileOwnershipTags,
  decodeAwsSingleNodeInstanceProfileResponse,
  validateAwsSingleNodeInstanceProfileId,
} from './deployment-aws-instance-profile-evidence.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import {
  corroborateAwsSingleNodeRuntimeRolePolicyEvidence,
  decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
  decodeAwsSingleNodeRuntimeRolePolicyInventory,
  decodeAwsSingleNodeRuntimeRolePolicyNamesPage,
  decodeAwsSingleNodeRuntimeRolePolicyResponse,
} from './deployment-aws-runtime-role-policy-evidence.js';
import {
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleInstanceProfiles,
  decodeAwsSingleNodeRuntimeRoleResponse,
  getAwsSingleNodeRuntimeRoleOwnershipTags,
  validateAwsSingleNodeRuntimeRoleId,
} from './deployment-aws-runtime-role-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimeAssociationProviderResourceId,
  getAwsSingleNodeRuntimeAssociationStateDigest,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeInstanceProfileStateDigest,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
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
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES =
  AWS_IAM_EVIDENCE_MAX_READ_PAGES;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE =
  AWS_IAM_EVIDENCE_MAX_TAGS;
export const AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE =
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS;

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
  return isAwsIamErrorNamed(error, name);
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
    validateAwsSingleNodeRuntimeRoleId(roleBinding.providerResourceId);
    validateAwsSingleNodeInstanceProfileId(profileBinding.providerResourceId);
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
  const tagAuthority = {
    providerScopeId: authority.plan.providerScope.providerScopeId,
    deploymentInstanceId: authority.plan.deploymentInstanceId,
    incarnationId: authority.plan.incarnationId,
    createdByActionId: binding.createdByActionId,
    ownershipNonce: binding.ownershipNonce,
    stateDigest: roleEndpoint
      ? authority.roleStateDigest
      : authority.profileStateDigest,
  };
  return roleEndpoint
    ? getAwsSingleNodeRuntimeRoleOwnershipTags({
        capabilityKind: 'runtime-identity',
        roleKind: 'role',
        resourceKey: 'runtime-role',
        ...tagAuthority,
      })
    : createAwsSingleNodeInstanceProfileOwnershipTags(tagAuthority);
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateRoleEnvelope(value, authority) {
  const role = decodeAwsSingleNodeRuntimeRoleResponse(
    value,
    authority.roleName,
  );
  if (
    role.PermissionsBoundary !== undefined &&
    role.PermissionsBoundary !== null
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(role, {
    providerScope: authority.plan.providerScope,
    roleName: authority.roleName,
    providerResourceId: authority.runtimeRoleId,
  });
  if (!sameJson(evidence.observedDigest, authority.roleStateDigest)) {
    throw new AwsIamEvidenceConflictError();
  }
  return evidence;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validateInstanceProfileEnvelope(value, authority) {
  return decodeAwsSingleNodeInstanceProfileResponse(value, {
    providerScope: authority.plan.providerScope,
    instanceProfileName: authority.instanceProfileName,
    expectedInstanceProfileId: authority.instanceProfileId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function membershipAuthority(authority) {
  return deepFreeze({
    providerScope: authority.plan.providerScope,
    roleName: authority.roleName,
    runtimeRoleId: authority.runtimeRoleId,
    instanceProfileName: authority.instanceProfileName,
    instanceProfileId: authority.instanceProfileId,
  });
}

/** @param {Readonly<Record<string, any>>} client @param {string} method @param {string} itemKey @param {Readonly<Record<string, any>>} baseRequest @param {number} maxItems @param {(items: unknown[]) => ReadonlyArray<unknown>} decodeItems @returns {Promise<unknown[]>} */
async function readAllPages(
  client,
  method,
  itemKey,
  baseRequest,
  maxItems,
  decodeItems,
) {
  return readAwsIamListPages({
    readPage: async (/** @type {Readonly<Record<string, any>>} */ request) => {
      try {
        return await client[method](request);
      } catch (error) {
        if (noSuchEntity(error)) throw new AwsIamEvidenceTransientError();
        throw new AwsIamEvidenceUnknownError();
      }
    },
    decodeItems,
    itemKey,
    baseRequest,
    maxPages: AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES,
    maxItems,
  });
}

/** @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expected @returns {(items: unknown[]) => ReadonlyArray<unknown>} */
function exactTagPageDecoder(expected) {
  const expectedValues = new Map(expected.map((tag) => [tag.Key, tag.Value]));
  const seen = new Set();
  return (items) => {
    const tags = decodeAwsIamTags(items);
    for (const tag of tags) {
      if (seen.has(tag.Key) || expectedValues.get(tag.Key) !== tag.Value) {
        throw new AwsIamEvidenceConflictError();
      }
      seen.add(tag.Key);
    }
    return tags;
  };
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
    const expected = expectedEndpointTags(authority, kind);
    const tags = await readAllPages(
      client,
      roleEndpoint ? 'listRoleTags' : 'listInstanceProfileTags',
      'Tags',
      roleEndpoint
        ? deepFreeze({ RoleName: authority.roleName })
        : deepFreeze({ InstanceProfileName: authority.instanceProfileName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE,
      exactTagPageDecoder(expected),
    );
    validateAwsIamTags(tags, expected, { allowIncomplete: false });
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<void>} */
  async function readRoleEndpoint(authority) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: authority.roleName }),
      );
    } catch (error) {
      if (noSuchEntity(error)) throw new AwsIamEvidenceTransientError();
      throw new AwsIamEvidenceUnknownError();
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
      if (noSuchEntity(error)) throw new AwsIamEvidenceTransientError();
      throw new AwsIamEvidenceUnknownError();
    }
    const policy = decodeAwsSingleNodeRuntimeRolePolicyResponse(response, {
      roleName: authority.roleName,
      policyAuthority: policyAuthority(authority.plan),
    });
    if (!policy.desired) {
      throw new AwsIamEvidenceConflictError();
    }
    let seenPolicy = false;
    const inlinePolicies = await readAllPages(
      client,
      'listRolePolicies',
      'PolicyNames',
      deepFreeze({ RoleName: authority.roleName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
      (items) => {
        const names = decodeAwsSingleNodeRuntimeRolePolicyNamesPage(items);
        if (names.length === 1) {
          if (seenPolicy) throw new AwsIamEvidenceConflictError();
          seenPolicy = true;
        }
        return names;
      },
    );
    const attachedPolicies = await readAllPages(
      client,
      'listAttachedRolePolicies',
      'AttachedPolicies',
      deepFreeze({ RoleName: authority.roleName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
      decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
    );
    const inventory = decodeAwsSingleNodeRuntimeRolePolicyInventory(
      inlinePolicies,
      attachedPolicies,
    );
    const corroborated = corroborateAwsSingleNodeRuntimeRolePolicyEvidence(
      inventory,
      policy,
    );
    if (corroborated.presence !== 'present') {
      throw new AwsIamEvidenceTransientError();
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
      if (noSuchEntity(error)) throw new AwsIamEvidenceTransientError();
      throw new AwsIamEvidenceUnknownError();
    }
    const profile = validateInstanceProfileEnvelope(response, authority);
    await readEndpointTags(authority, 'profile');
    return decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
      profile,
      membershipAuthority(authority),
    ).membership;
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readRoleMembership(authority) {
    let seenProfile = false;
    const profiles = await readAllPages(
      client,
      'listInstanceProfilesForRole',
      'InstanceProfiles',
      deepFreeze({ RoleName: authority.roleName }),
      AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
      (items) => {
        const decoded = decodeAwsSingleNodeRuntimeRoleInstanceProfiles(items);
        const view = decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
          decoded,
          membershipAuthority(authority),
        );
        if (view.membership === 'present') {
          if (seenProfile) throw new AwsIamEvidenceConflictError();
          seenProfile = true;
        }
        return decoded;
      },
    );
    return decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
      profiles,
      membershipAuthority(authority),
    ).membership;
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readLogicalState(authority) {
    await readRoleEndpoint(authority);
    await readPolicyEffect(authority);
    const profileState = await readProfileMembership(authority);
    const roleState = await readRoleMembership(authority);
    return corroborateAwsSingleNodeInstanceProfileRoleAssociationViews({
      profileView: { membership: profileState },
      roleView: { membership: roleState },
    }).presence;
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
        if (error instanceof AwsIamEvidenceConflictError) {
          throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
        }
        if (error instanceof AwsIamEvidenceTransientError) {
          if (attempt === maxAttempts) return;
        } else if (error instanceof AwsIamEvidenceUnknownError) {
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
      if (error instanceof AwsIamEvidenceConflictError) {
        throw new AwsSingleNodeInstanceProfileRoleAssociationResourceConflictError();
      }
      if (error instanceof AwsIamEvidenceTransientError) return;
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
        if (error instanceof AwsIamEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof AwsIamEvidenceUnknownError) &&
          !(error instanceof AwsIamEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof AwsIamEvidenceUnknownError) {
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
