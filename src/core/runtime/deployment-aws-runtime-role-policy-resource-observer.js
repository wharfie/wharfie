/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTags,
} from './deployment-aws-iam-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  getAwsSingleNodeManagedArtifactObjectLocation,
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimeRoleName,
} from './deployment-aws-runtime-identity-contract.js';
import {
  corroborateAwsSingleNodeRuntimeRolePolicyEvidence,
  decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
  decodeAwsSingleNodeRuntimeRolePolicyInventory,
  decodeAwsSingleNodeRuntimeRolePolicyNamesPage,
  decodeAwsSingleNodeRuntimeRolePolicyResponse,
} from './deployment-aws-runtime-role-policy-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_READ_MAX_ITEMS,
} from './deployment-aws-runtime-role-policy-resource.js';
import {
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleResponse,
  getAwsSingleNodeRuntimeRoleOwnershipTags,
  validateAwsSingleNodeRuntimeRoleId,
} from './deployment-aws-runtime-role-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set([
  'getRole',
  'listRoleTags',
  'listRolePolicies',
  'listAttachedRolePolicies',
  'getRolePolicy',
]);
const AUTHORITY_KEYS = new Set([
  'operation',
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
  'head',
  'plan',
  'settledPlan',
  'target',
  'binding',
  'currentAction',
]);
const RESOURCE_KEY = 'runtime-role-policy';
const PROVIDER_TYPE = 'iam-role-inline-policy';
const ARTIFACT_KEY = 'artifact';
const RUNTIME_ROLE_KEY = 'runtime-role';
const AUTHORITY_ERROR =
  'AWS single-node runtime role policy observation authority does not match the exact managed derived-policy contract.';

class AwsIamParentAbsentEvidenceError extends Error {}

/** Exact durable authority cannot select this managed derived-policy read mode. */
export class AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError';
    this.code =
      'AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_RESOURCE_OBSERVER_AUTHORITY';
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
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} error @returns {boolean} */
function isNoSuchEntity(error) {
  return (
    isAwsIamErrorNamed(error, 'NoSuchEntity') ||
    isAwsIamErrorNamed(error, 'NoSuchEntityException')
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicyResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeRuntimeRolePolicyResourceObserver context',
  );
  const canonical = createAwsSingleNodeResourceObservationAuthority({
    operation: authority.operation,
    deploymentRevision: authority.deploymentRevision,
    profile: authority.profile,
    providerScope: authority.providerScope,
    providerSpec: authority.providerSpec,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    head: authority.head,
    plan: authority.plan,
    settledPlan: authority.settledPlan,
    target: authority.target,
  });
  if (
    !sameJson(authority.binding, canonical.binding) ||
    !sameJson(authority.currentAction, canonical.currentAction)
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @param {string} resourceKey @returns {Readonly<Record<string, any>>|null} */
function oneBinding(authority, resourceKey) {
  const matches = authority.head.resourceBindings.filter(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === resourceKey,
  );
  if (matches.length > 1) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
  return matches[0] ?? null;
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} expected @returns {void} */
function assertBindingBase(binding, authority, expected) {
  if (
    binding.resourceKey !== expected.resourceKey ||
    binding.capability.kind !== expected.capabilityKind ||
    binding.capability.version !== 1 ||
    binding.role.kind !== expected.roleKind ||
    binding.role.version !== 1 ||
    binding.management !== 'managed' ||
    binding.ownershipMode !== expected.ownershipMode ||
    binding.onDestroy !== 'purge' ||
    binding.providerType !== expected.providerType ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>[]} dependencies @returns {void} */
function assertDependencyBindings(binding, dependencies) {
  const expected = dependencies
    .map((dependency) => ({
      resourceKey: dependency.resourceKey,
      bindingId: dependency.bindingId,
    }))
    .sort((left, right) =>
      left.resourceKey < right.resourceKey
        ? -1
        : left.resourceKey > right.resourceKey
          ? 1
          : 0,
    );
  if (!sameJson(binding.dependencyBindings, expected)) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function policyAuthority(authority) {
  return deepFreeze({
    providerScope: authority.providerScope,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function nameAuthority(authority) {
  return deepFreeze({
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/**
 * Re-prove the direct artifact/role receipts before selecting one untaggable
 * derived policy slot.
 * @param {Readonly<Record<string, any>>} authority - Revalidated V48 authority.
 * @returns {Readonly<Record<string, any>>|null}
 */
function assertRuntimeRolePolicyAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'runtime-identity' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'inline-policy' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'derived' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, [ARTIFACT_KEY, RUNTIME_ROLE_KEY]) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }

  const artifactBinding = oneBinding(authority, ARTIFACT_KEY);
  const runtimeRoleBinding = oneBinding(authority, RUNTIME_ROLE_KEY);
  if (artifactBinding === null || runtimeRoleBinding === null) {
    if (binding !== null || currentAction?.action === 'create') {
      throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
    }
    return null;
  }
  assertBindingBase(artifactBinding, authority, {
    resourceKey: ARTIFACT_KEY,
    capabilityKind: 'artifact-storage',
    roleKind: 'object',
    ownershipMode: 'direct',
    providerType: 's3-object',
  });
  assertDependencyBindings(artifactBinding, []);
  assertBindingBase(runtimeRoleBinding, authority, {
    resourceKey: RUNTIME_ROLE_KEY,
    capabilityKind: 'runtime-identity',
    roleKind: 'role',
    ownershipMode: 'direct',
    providerType: 'iam-role',
  });
  assertDependencyBindings(runtimeRoleBinding, []);

  const expectedArtifactArn = getAwsSingleNodeManagedArtifactObjectLocation(
    policyAuthority(authority),
  ).arn;
  if (artifactBinding.providerResourceId !== expectedArtifactArn) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
  let runtimeRoleId;
  try {
    runtimeRoleId = validateAwsSingleNodeRuntimeRoleId(
      runtimeRoleBinding.providerResourceId,
    );
  } catch {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
  const providerResourceId = getAwsSingleNodeRuntimePolicyProviderResourceId({
    runtimeRoleId,
  });
  if (binding !== null) {
    assertBindingBase(binding, authority, {
      resourceKey: RESOURCE_KEY,
      capabilityKind: 'runtime-identity',
      roleKind: 'inline-policy',
      ownershipMode: 'derived',
      providerType: PROVIDER_TYPE,
    });
    assertDependencyBindings(binding, [artifactBinding, runtimeRoleBinding]);
    if (binding.providerResourceId !== providerResourceId) {
      throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
    }
  }
  return deepFreeze({
    artifactBinding,
    runtimeRoleBinding,
    runtimeRoleId,
    roleName: getAwsSingleNodeRuntimeRoleName(nameAuthority(authority)),
    providerResourceId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} binding @returns {Readonly<Record<string, any>>} */
function historicalStateDigest(authority, binding) {
  let action = null;
  if (authority.plan !== null) {
    const actionIndex = authority.plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === binding.resourceKey &&
        candidate.actionId === binding.createdByActionId,
    );
    const candidate = authority.plan.actions[actionIndex];
    const intent = authority.head.activeOperation?.intents[actionIndex];
    if (
      candidate !== undefined &&
      intent?.status === 'settled' &&
      candidate.action === 'create'
    ) {
      action = candidate;
    }
  }
  if (action === null && authority.settledPlan !== null) {
    action =
      authority.settledPlan.actions.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === binding.resourceKey,
      ) ?? null;
  }
  const state = action?.after ?? action?.before ?? null;
  if (
    action === null ||
    action.resourceKey !== RUNTIME_ROLE_KEY ||
    action.capability.kind !== 'runtime-identity' ||
    action.capability.version !== 1 ||
    action.role.kind !== 'role' ||
    action.role.version !== 1 ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0 ||
    state === null ||
    state.providerType !== 'iam-role' ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId) ||
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string'
  ) {
    throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
  }
  return state.stateDigest;
}

/** @returns {Readonly<Record<string, any>>} */
function absentObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  });
}

/** @returns {Readonly<Record<string, any>>} */
function unknownObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
  });
}

/** @param {string} providerResourceId @param {Readonly<Record<string, any>>} observedDigest @returns {Readonly<Record<string, any>>} */
function verifiedObservation(providerResourceId, observedDigest) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: {
      providerType: PROVIDER_TYPE,
      providerResourceId,
    },
    observedDigest,
    health: 'not-applicable',
    execution: 'none',
  });
}

/** @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function conflictObservation(providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: {
      providerType: PROVIDER_TYPE,
      providerResourceId,
    },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind one read-only inline-policy observer to an exact credential scope.
 * The caller owns the five-method IAM read port.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeRuntimeRolePolicyResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicyResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeRuntimeRolePolicyResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRuntimeRolePolicyResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicyResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeRuntimeRolePolicyResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeRuntimeRolePolicyResourceObserver client.${method} is required.`,
      );
    }
  }
  const client = Object.freeze({
    getRole: options.client.getRole,
    listRoleTags: options.client.listRoleTags,
    listRolePolicies: options.client.listRolePolicies,
    listAttachedRolePolicies: options.client.listAttachedRolePolicies,
    getRolePolicy: options.client.getRolePolicy,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeRuntimeRolePolicyResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRuntimeRolePolicyResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRuntimeRolePolicyResourceObserver waitForRetry must be a function.',
    );
  }

  /** @param {number} attempt @returns {Promise<boolean>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {'listRoleTags'|'listRolePolicies'|'listAttachedRolePolicies'} method @param {string} itemKey @param {Readonly<Record<string, any>>} baseRequest @param {(items: unknown[]) => ReadonlyArray<unknown>} decodeItems @returns {Promise<Readonly<Record<string, any>>>} */
  async function readList(method, itemKey, baseRequest, decodeItems) {
    let successfulPages = 0;
    try {
      const items = await readAwsIamListPages({
        readPage: async (
          /** @type {Readonly<Record<string, any>>} */ request,
        ) => {
          try {
            const response = await /** @type {Record<string, any>} */ (client)[
              method
            ](request);
            successfulPages += 1;
            return response;
          } catch (error) {
            if (isNoSuchEntity(error)) {
              if (successfulPages !== 0) {
                throw new AwsIamEvidenceTransientError();
              }
              throw new AwsIamParentAbsentEvidenceError();
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
      return deepFreeze({ state: 'present', items });
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if (
        error instanceof AwsIamEvidenceConflictError ||
        error instanceof AwsIamEvidenceTransientError ||
        error instanceof AwsIamEvidenceUnknownError
      ) {
        throw error;
      }
      if (error instanceof AwsIamParentAbsentEvidenceError) {
        return Object.freeze({ state: 'parent-absent', items: [] });
      }
      throw new AwsIamEvidenceUnknownError();
    }
  }

  /** @param {Readonly<Record<string, any>>} dependencies @returns {Promise<Readonly<Record<string, any>>>} */
  async function readRole(dependencies) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: dependencies.roleName }),
      );
    } catch (error) {
      if (isNoSuchEntity(error)) {
        return Object.freeze({ state: 'parent-absent', response: null });
      }
      throw new AwsIamEvidenceUnknownError();
    }
    const role = decodeAwsSingleNodeRuntimeRoleResponse(
      response,
      dependencies.roleName,
    );
    const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(role, {
      providerScope,
      roleName: dependencies.roleName,
      providerResourceId: dependencies.runtimeRoleId,
    });
    return deepFreeze({ state: 'present', evidence });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {Promise<Readonly<Record<string, any>>>} */
  async function readPolicy(authority, dependencies) {
    let response;
    try {
      response = await client.getRolePolicy(
        deepFreeze({
          RoleName: dependencies.roleName,
          PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
        }),
      );
    } catch (error) {
      if (isNoSuchEntity(error)) {
        return Object.freeze({ state: 'absent', response: null });
      }
      throw new AwsIamEvidenceUnknownError();
    }
    const evidence = decodeAwsSingleNodeRuntimeRolePolicyResponse(response, {
      roleName: dependencies.roleName,
      policyAuthority: policyAuthority(authority),
    });
    if (
      authority.binding === null &&
      authority.currentAction?.action.action === 'create' &&
      !evidence.desired
    ) {
      throw new AwsIamEvidenceConflictError();
    }
    return deepFreeze({ state: 'present', evidence });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {Promise<Readonly<Record<string, any>>>} */
  async function observeAttempt(authority, dependencies) {
    const expectedRoleTags = getAwsSingleNodeRuntimeRoleOwnershipTags({
      capabilityKind: dependencies.runtimeRoleBinding.capability.kind,
      roleKind: dependencies.runtimeRoleBinding.role.kind,
      providerScopeId: authority.providerScope.providerScopeId,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
      resourceKey: dependencies.runtimeRoleBinding.resourceKey,
      createdByActionId: dependencies.runtimeRoleBinding.createdByActionId,
      ownershipNonce: dependencies.runtimeRoleBinding.ownershipNonce,
      stateDigest: historicalStateDigest(
        authority,
        dependencies.runtimeRoleBinding,
      ),
    });
    /** @param {unknown[]} items @returns {ReadonlyArray<unknown>} */
    const decodeTagPage = (items) => {
      const tags = decodeAwsIamTags(items);
      for (const tag of tags) {
        if (
          !expectedRoleTags.some(
            (candidate) =>
              candidate.Key === tag.Key && candidate.Value === tag.Value,
          )
        ) {
          throw new AwsIamEvidenceConflictError();
        }
      }
      return tags;
    };
    const roleRequest = deepFreeze({ RoleName: dependencies.roleName });
    const results = await Promise.allSettled([
      readRole(dependencies),
      readList('listRoleTags', 'Tags', roleRequest, decodeTagPage),
      readList(
        'listRolePolicies',
        'PolicyNames',
        roleRequest,
        decodeAwsSingleNodeRuntimeRolePolicyNamesPage,
      ),
      readList(
        'listAttachedRolePolicies',
        'AttachedPolicies',
        roleRequest,
        decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage,
      ),
      readPolicy(authority, dependencies),
    ]);
    const rejected = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    if (
      rejected.some((error) => error instanceof AwsIamEvidenceConflictError)
    ) {
      throw new AwsIamEvidenceConflictError();
    }
    if (rejected.some((error) => error instanceof AwsIamEvidenceUnknownError)) {
      throw new AwsIamEvidenceUnknownError();
    }
    if (rejected.length !== 0) throw new AwsIamEvidenceTransientError();
    const [roleResult, tagsResult, inlineResult, attachedResult, policyResult] =
      results;
    if (
      roleResult.status !== 'fulfilled' ||
      tagsResult.status !== 'fulfilled' ||
      inlineResult.status !== 'fulfilled' ||
      attachedResult.status !== 'fulfilled' ||
      policyResult.status !== 'fulfilled'
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    if (
      roleResult.value.state === 'parent-absent' &&
      tagsResult.value.state === 'parent-absent' &&
      inlineResult.value.state === 'parent-absent' &&
      attachedResult.value.state === 'parent-absent' &&
      policyResult.value.state === 'absent'
    ) {
      return Object.freeze({ state: 'parent-absent' });
    }
    if (
      roleResult.value.state !== 'present' ||
      tagsResult.value.state !== 'present' ||
      inlineResult.value.state !== 'present' ||
      attachedResult.value.state !== 'present'
    ) {
      throw new AwsIamEvidenceTransientError();
    }
    validateAwsIamTags(tagsResult.value.items, expectedRoleTags, {
      allowIncomplete: true,
    });
    const inventory = decodeAwsSingleNodeRuntimeRolePolicyInventory(
      inlineResult.value.items,
      attachedResult.value.items,
    );
    const policy =
      policyResult.value.state === 'absent'
        ? null
        : policyResult.value.evidence;
    const evidence = corroborateAwsSingleNodeRuntimeRolePolicyEvidence(
      inventory,
      policy,
    );
    return evidence.presence === 'absent'
      ? Object.freeze({ state: 'absent' })
      : deepFreeze({
          state: 'present',
          desired: evidence.desired,
          observedDigest: evidence.observedDigest,
        });
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError();
    }
    const dependencies = assertRuntimeRolePolicyAuthority(authority);
    if (dependencies === null) return unknownObservation();
    const isCurrentCreate =
      authority.binding === null &&
      authority.currentAction?.action.action === 'create';
    const isUnboundNoAction =
      authority.binding === null && authority.currentAction === null;
    let allAttemptsCleanAbsent = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const evidence = await observeAttempt(authority, dependencies);
        if (evidence.state === 'parent-absent' || evidence.state === 'absent') {
          if (attempt === maxAttempts) {
            return !isCurrentCreate && allAttemptsCleanAbsent
              ? absentObservation()
              : unknownObservation();
          }
        } else if (evidence.state === 'present') {
          allAttemptsCleanAbsent = false;
          if (isUnboundNoAction || (isCurrentCreate && !evidence.desired)) {
            return conflictObservation(dependencies.providerResourceId);
          }
          return verifiedObservation(
            dependencies.providerResourceId,
            evidence.observedDigest,
          );
        } else {
          allAttemptsCleanAbsent = false;
          throw new AwsIamEvidenceUnknownError();
        }
      } catch (error) {
        allAttemptsCleanAbsent = false;
        if (error instanceof AwsIamEvidenceConflictError) {
          return conflictObservation(dependencies.providerResourceId);
        }
        if (
          !(error instanceof AwsIamEvidenceUnknownError) &&
          !(error instanceof AwsIamEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) return unknownObservation();
      }
      if (attempt < maxAttempts && !(await wait(attempt))) {
        return unknownObservation();
      }
    }
    return unknownObservation();
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_POLICY_MAX_ATTEMPTS,
  AwsSingleNodeRuntimeRolePolicyResourceObserverAuthorityError,
  createAwsSingleNodeRuntimeRolePolicyResourceObserver,
};
