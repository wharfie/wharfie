/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { compareCanonicalStrings } from './canonical-order.js';
import {
  AWS_IAM_ROLE_ID_PATTERN,
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
  createAwsSingleNodeRuntimePolicy,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
} from './deployment-aws-runtime-identity-contract.js';
import {
  AWS_IAM_EVIDENCE_MAX_READ_PAGES,
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  isAwsIamErrorNamed,
  readAwsIamListPages,
} from './deployment-aws-iam-evidence.js';
import {
  corroborateAwsSingleNodeRuntimeRolePolicyEvidence,
  decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
  decodeAwsSingleNodeRuntimeRolePolicyInventory,
  decodeAwsSingleNodeRuntimeRolePolicyNamesPage,
  decodeAwsSingleNodeRuntimeRolePolicyResponse,
} from './deployment-aws-runtime-role-policy-evidence.js';
import {
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleResponse,
} from './deployment-aws-runtime-role-evidence.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export const AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_READ_PAGES =
  AWS_IAM_EVIDENCE_MAX_READ_PAGES;
export const AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS =
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
  'listRolePolicies',
  'listAttachedRolePolicies',
  'getRolePolicy',
  'putRolePolicy',
  'deleteRolePolicy',
]);
const RESOURCE_KEY = 'runtime-role-policy';
const PROVIDER_TYPE = 'iam-role-inline-policy';
const DEPENDENCY_KEYS = Object.freeze(['artifact', 'runtime-role']);
const DEPENDENCY_DEFINITIONS = Object.freeze([
  Object.freeze({
    resourceKey: 'artifact',
    capability: Object.freeze({ kind: 'artifact-storage', version: 1 }),
    role: Object.freeze({ kind: 'object', version: 1 }),
    providerType: 's3-object',
  }),
  Object.freeze({
    resourceKey: 'runtime-role',
    capability: Object.freeze({ kind: 'runtime-identity', version: 1 }),
    role: Object.freeze({ kind: 'role', version: 1 }),
    providerType: 'iam-role',
  }),
]);

/** Exact controller authority or provider evidence is contradictory. */
export class AwsSingleNodeRuntimeRolePolicyResourceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node runtime role policy conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeRuntimeRolePolicyResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeRuntimeRolePolicyResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node runtime role policy state is unknown.');
    this.name = 'AwsSingleNodeRuntimeRolePolicyResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_RESOURCE_UNKNOWN';
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
function policyMissing(error) {
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

/** @param {Readonly<Record<string, any>>} plan @returns {Readonly<Record<string, any>>} */
function policyAuthority(plan) {
  return deepFreeze({
    providerScope: plan.providerScope,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} plan @returns {Readonly<Record<string, any>>} */
function nameAuthority(plan) {
  return deepFreeze({
    providerScopeId: plan.providerScope.providerScopeId,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>[]} bindings @returns {Readonly<Array<{resourceKey: string, bindingId: string}>>} */
function dependencyReceipts(bindings) {
  return bindings
    .map((binding) => ({
      resourceKey: binding.resourceKey,
      bindingId: binding.bindingId,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} definition @param {Readonly<Record<string, any>>} plan @param {Readonly<Record<string, any>>} providerScope @param {string} expectedArtifactArn @returns {boolean} */
function dependencyBindingMatches(
  binding,
  definition,
  plan,
  providerScope,
  expectedArtifactArn,
) {
  const providerIdentityMatches =
    definition.resourceKey === 'artifact'
      ? binding.providerResourceId === expectedArtifactArn
      : AWS_IAM_ROLE_ID_PATTERN.test(binding.providerResourceId);
  return (
    binding.management === 'managed' &&
    binding.providerType === definition.providerType &&
    providerIdentityMatches &&
    binding.deploymentInstanceId === plan.deploymentInstanceId &&
    binding.resourceKey === definition.resourceKey &&
    binding.providerScopeId === providerScope.providerScopeId &&
    binding.incarnationId === plan.incarnationId &&
    sameJson(binding.capability, definition.capability) &&
    sameJson(binding.role, definition.role) &&
    binding.ownershipMode === 'direct' &&
    binding.onDestroy === 'purge' &&
    binding.dependencyBindings.length === 0
  );
}

/**
 * Resolve the staged artifact and immutable runtime RoleId receipts. Apply
 * dependencies are settled earlier; reverse-destroy dependencies remain
 * pending later and therefore still exist.
 * @param {Readonly<Record<string, any>>} plan - Exact immutable action plan.
 * @param {Readonly<Record<string, any>>} head - Current durable authority.
 * @param {number} actionIndex - Current intended action index.
 * @param {Readonly<Record<string, any>>} providerScope - Fixed AWS scope.
 * @param {Readonly<Record<string, any>>} authority - Fixed policy authority.
 * @returns {Readonly<Record<string, any>>} - Exact dependency authority.
 */
function resolveDependencyAuthority(
  plan,
  head,
  actionIndex,
  providerScope,
  authority,
) {
  const expectedArtifactArn =
    getAwsSingleNodeManagedArtifactObjectLocation(authority).arn;
  const expectedRoleStateDigest = getAwsSingleNodeRuntimeRoleStateDigest(
    nameAuthority(plan),
  );
  const resolved = new Map();
  for (const definition of DEPENDENCY_DEFINITIONS) {
    const dependencyActionIndex = plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === definition.resourceKey,
    );
    const dependencyAction = plan.actions[dependencyActionIndex];
    const dependencyIntent =
      head.activeOperation.intents[dependencyActionIndex];
    const binding = head.resourceBindings.find(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === definition.resourceKey,
    );
    const applyAuthority =
      plan.operation !== 'destroy' &&
      dependencyActionIndex >= 0 &&
      dependencyActionIndex < actionIndex &&
      dependencyIntent?.status === 'settled' &&
      dependencyAction?.after !== null &&
      dependencyAction?.after !== undefined &&
      dependencyAction.after.providerType === definition.providerType &&
      (dependencyAction.after.providerResourceId === null ||
        dependencyAction.after.providerResourceId ===
          binding?.providerResourceId);
    const destroyAuthority =
      plan.operation === 'destroy' &&
      dependencyActionIndex > actionIndex &&
      dependencyIntent?.status === 'pending' &&
      dependencyAction?.action === 'delete' &&
      dependencyAction.before !== null &&
      dependencyAction.before.providerType === definition.providerType &&
      dependencyAction.before.providerResourceId ===
        binding?.providerResourceId;
    const dependencyState =
      plan.operation === 'destroy'
        ? dependencyAction?.before
        : dependencyAction?.after;
    if (
      binding === undefined ||
      dependencyAction === undefined ||
      dependencyIntent === undefined ||
      dependencyState === null ||
      dependencyState === undefined ||
      dependencyState.stateDigest === null ||
      (!applyAuthority && !destroyAuthority) ||
      dependencyIntent.actionId !== dependencyAction.actionId ||
      dependencyIntent.ownershipNonce !== binding.ownershipNonce ||
      dependencyAction.resourceKey !== definition.resourceKey ||
      !sameJson(dependencyAction.capability, definition.capability) ||
      !sameJson(dependencyAction.role, definition.role) ||
      dependencyAction.management !== 'managed' ||
      dependencyAction.ownershipMode !== 'direct' ||
      dependencyAction.onDestroy !== 'purge' ||
      dependencyAction.dependsOn.length !== 0 ||
      !dependencyBindingMatches(
        binding,
        definition,
        plan,
        providerScope,
        expectedArtifactArn,
      ) ||
      (dependencyAction.action === 'create' &&
        binding.createdByActionId !== dependencyAction.actionId) ||
      (definition.resourceKey === 'runtime-role' &&
        !sameJson(dependencyState.stateDigest, expectedRoleStateDigest))
    ) {
      throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
    }
    resolved.set(definition.resourceKey, binding);
  }
  const artifactBinding = resolved.get('artifact');
  const runtimeRoleBinding = resolved.get('runtime-role');
  if (artifactBinding === undefined || runtimeRoleBinding === undefined) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
  }
  const dependencyBindings = dependencyReceipts([
    artifactBinding,
    runtimeRoleBinding,
  ]);
  const runtimeRoleId = runtimeRoleBinding.providerResourceId;
  return deepFreeze({
    artifactBinding,
    runtimeRoleBinding,
    dependencyBindings,
    runtimeRoleId,
    providerResourceId: getAwsSingleNodeRuntimePolicyProviderResourceId({
      runtimeRoleId,
    }),
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
      'awsSingleNodeRuntimeRolePolicy action context must be an object.',
    );
  }
  assertExactKeys(
    value,
    ACTION_CONTEXT_KEYS,
    'awsSingleNodeRuntimeRolePolicy context',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeRuntimeRolePolicy context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeRuntimeRolePolicy context.head',
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
    !sameJson(
      canonicalProviderSpec.capabilities.runtimeIdentity.policyDigest,
      AWS_SINGLE_NODE_RUNTIME_POLICY_TEMPLATE_DIGEST,
    ) ||
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
    throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.resourceKey !== RESOURCE_KEY ||
    !sameJson(action.capability, { kind: 'runtime-identity', version: 1 }) ||
    !sameJson(action.role, { kind: 'inline-policy', version: 1 }) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'derived' ||
    action.onDestroy !== 'purge' ||
    !sameJson(action.dependsOn, DEPENDENCY_KEYS)
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeRuntimeRolePolicy context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
  }
  const authority = policyAuthority(plan);
  const dependencies = resolveDependencyAuthority(
    plan,
    head,
    value.actionIndex,
    providerScope,
    authority,
  );
  const stateDigest = getAwsSingleNodeRuntimePolicyStateDigest(authority);
  const policyDocument = createAwsSingleNodeRuntimePolicy(authority);
  const roleName = getAwsSingleNodeRuntimeRoleName(nameAuthority(plan));
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
      throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
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
      !sameJson(action.before.stateDigest, stateDigest) ||
      action.after.providerType !== PROVIDER_TYPE ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.after.stateDigest, stateDigest)
    ) {
      throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
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
      throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
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
    policyDocument,
    roleName,
    priorBinding: priorBinding ?? null,
    ...dependencies,
  });
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function validatePolicyResponse(response, authority) {
  const evidence = decodeAwsSingleNodeRuntimeRolePolicyResponse(response, {
    roleName: authority.roleName,
    policyAuthority: policyAuthority(authority.plan),
  });
  if (!evidence.desired) throw new AwsIamEvidenceConflictError();
  return evidence;
}

/** @param {unknown} response @param {Readonly<Record<string, any>>} authority @returns {void} */
function validateRoleResponse(response, authority) {
  const role = decodeAwsSingleNodeRuntimeRoleResponse(
    response,
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
  if (
    !sameJson(
      evidence.observedDigest,
      getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority(authority.plan)),
    )
  ) {
    throw new AwsIamEvidenceConflictError();
  }
}

/**
 * Manage the one exact inline policy installed on the bound runtime RoleId.
 * The factory never owns or closes the caller's narrow IAM client.
 * @param {unknown} options - Exact IAM client, AWS scope, and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeRuntimeRolePolicyResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeRuntimeRolePolicy options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRuntimeRolePolicy options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeRuntimeRolePolicy client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeRuntimeRolePolicy providerScope',
  );
  const maxAttempts =
    options.maxAttempts ??
    AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRuntimeRolePolicy maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicy waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeRuntimeRolePolicyResourceUnknownError();
    }
  }

  /** @param {string} method @param {string} itemKey @param {Readonly<Record<string, any>>} baseRequest @param {(items: unknown[]) => ReadonlyArray<unknown>} decodeItems @returns {Promise<unknown[]>} */
  async function readIamList(method, itemKey, baseRequest, decodeItems) {
    return readAwsIamListPages({
      readPage: async (
        /** @type {Readonly<Record<string, any>>} */ request,
      ) => {
        try {
          return await client[method](request);
        } catch (error) {
          if (policyMissing(error)) {
            throw new AwsIamEvidenceTransientError();
          }
          throw new AwsIamEvidenceUnknownError();
        }
      },
      itemKey,
      baseRequest,
      maxPages: AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_READ_PAGES,
      maxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
      decodeItems,
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<{listed: 'present'|'absent'}>>} */
  async function readRoleOnce(authority) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: authority.roleName }),
      );
    } catch (error) {
      if (policyMissing(error)) {
        throw new AwsIamEvidenceConflictError();
      }
      throw new AwsIamEvidenceUnknownError();
    }
    validateRoleResponse(response, authority);
    const request = deepFreeze({ RoleName: authority.roleName });
    const inlinePolicies = await readIamList(
      'listRolePolicies',
      'PolicyNames',
      request,
      decodeAwsSingleNodeRuntimeRolePolicyNamesPage,
    );
    const attachedPolicies = await readIamList(
      'listAttachedRolePolicies',
      'AttachedPolicies',
      request,
      decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
    );
    return decodeAwsSingleNodeRuntimeRolePolicyInventory(
      inlinePolicies,
      attachedPolicies,
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readPolicyOnce(authority) {
    let response;
    try {
      response = await client.getRolePolicy(
        deepFreeze({
          RoleName: authority.roleName,
          PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
        }),
      );
    } catch (error) {
      if (policyMissing(error)) return null;
      throw new AwsIamEvidenceUnknownError();
    }
    return validatePolicyResponse(response, authority);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<'present'|'absent'>} */
  async function readLogicalState(authority) {
    const inventory = await readRoleOnce(authority);
    const policy = await readPolicyOnce(authority);
    return corroborateAwsSingleNodeRuntimeRolePolicyEvidence(inventory, policy)
      .presence;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {'present'|'absent'} expectedState @returns {Promise<void>} */
  async function settleAmbiguousMutation(authority, expectedState) {
    let state;
    try {
      state = await readLogicalState(authority);
    } catch (error) {
      if (error instanceof AwsIamEvidenceConflictError) {
        throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
      }
      throw new AwsSingleNodeRuntimeRolePolicyResourceUnknownError();
    }
    if (state !== expectedState) {
      throw new AwsSingleNodeRuntimeRolePolicyResourceUnknownError();
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
        throw new AwsSingleNodeRuntimeRolePolicyResourceConflictError();
      }
      throw new AwsSingleNodeRuntimeRolePolicyResourceUnknownError();
    }
    if (authority.action.action === 'delete') {
      if (state === 'absent') return;
      try {
        await client.deleteRolePolicy(
          deepFreeze({
            RoleName: authority.roleName,
            PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
          }),
        );
      } catch {
        await settleAmbiguousMutation(authority, 'absent');
      }
      return;
    }
    if (state === 'present') return;
    try {
      await client.putRolePolicy(
        deepFreeze({
          RoleName: authority.roleName,
          PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
          PolicyDocument: JSON.stringify(authority.policyDocument),
        }),
      );
    } catch {
      await settleAmbiguousMutation(authority, 'present');
    }
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>|null}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let state;
      try {
        state = await readLogicalState(authority);
      } catch (error) {
        if (error instanceof AwsIamEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (attempt === maxAttempts) {
          throw new AwsSingleNodeRuntimeRolePolicyResourceUnknownError();
        }
        await wait(attempt);
        continue;
      }
      if (state === 'present' && authority.action.action !== 'delete') {
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
      if (state === 'absent' && authority.action.action === 'delete') {
        return deepFreeze({ status: 'converged', binding: null });
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
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
  AwsSingleNodeRuntimeRolePolicyResourceConflictError,
  AwsSingleNodeRuntimeRolePolicyResourceUnknownError,
  createAwsSingleNodeRuntimeRolePolicyResource,
};
