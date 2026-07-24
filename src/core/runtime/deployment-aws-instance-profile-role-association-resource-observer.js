/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTags,
} from './deployment-aws-iam-evidence.js';
import {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE,
} from './deployment-aws-instance-profile-role-association-resource.js';
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
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
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
  getAwsSingleNodeRuntimePolicyProviderResourceId,
  getAwsSingleNodeRuntimePolicyStateDigest,
  getAwsSingleNodeRuntimeRoleName,
} from './deployment-aws-runtime-identity-contract.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS,
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
  'getInstanceProfile',
  'listInstanceProfileTags',
  'listInstanceProfilesForRole',
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
const RESOURCE_KEY = 'runtime-identity-role-association';
const PROVIDER_TYPE = 'iam-instance-profile-role-association';
const ARTIFACT_KEY = 'artifact';
const RUNTIME_ROLE_KEY = 'runtime-role';
const RUNTIME_ROLE_POLICY_KEY = 'runtime-role-policy';
const INSTANCE_PROFILE_KEY = 'runtime-identity';
const DEPENDENCY_KEYS = Object.freeze([
  RUNTIME_ROLE_KEY,
  RUNTIME_ROLE_POLICY_KEY,
  INSTANCE_PROFILE_KEY,
]);
const AUTHORITY_ERROR =
  'AWS single-node instance-profile/role association observation authority does not match the exact derived relationship.';

/** Exact durable authority cannot select this derived relationship read mode. */
export class AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name =
      'AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError';
    this.code =
      'AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_RESOURCE_OBSERVER_AUTHORITY';
  }
}

class EndpointAbsentError extends Error {}

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
function noSuchEntity(error) {
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
      'awsSingleNodeInstanceProfileRoleAssociationResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociationResourceObserver context',
  );
  let canonical;
  try {
    canonical = createAwsSingleNodeResourceObservationAuthority({
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
  } catch {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
  if (
    !sameJson(authority.binding, canonical.binding) ||
    !sameJson(authority.currentAction, canonical.currentAction)
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Array<Readonly<Record<string, any>>>>} dependencies @returns {void} */
function assertDependencyBindings(binding, dependencies) {
  const expected = dependencies
    .map((dependency) => ({
      bindingId: dependency.bindingId,
      resourceKey: dependency.resourceKey,
    }))
    .sort((left, right) =>
      compareCanonicalStrings(left.resourceKey, right.resourceKey),
    );
  if (!sameJson(binding.dependencyBindings, expected)) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function nameAuthority(authority) {
  return deepFreeze({
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function policyAuthority(authority) {
  return deepFreeze({
    providerScope: authority.providerScope,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} binding @param {string} roleKind @param {string} providerType @returns {Readonly<Record<string, any>>} */
function historicalStateDigest(authority, binding, roleKind, providerType) {
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
    action.resourceKey !== binding.resourceKey ||
    action.capability.kind !== 'runtime-identity' ||
    action.capability.version !== 1 ||
    action.role.kind !== roleKind ||
    action.role.version !== 1 ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0 ||
    state === null ||
    state.providerType !== providerType ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId) ||
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string'
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
  return state.stateDigest;
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>|null} */
function assertRelationshipAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'runtime-identity' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'instance-profile-role-association' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'derived' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, DEPENDENCY_KEYS) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }

  const artifactBinding = oneBinding(authority, ARTIFACT_KEY);
  const roleBinding = oneBinding(authority, RUNTIME_ROLE_KEY);
  const policyBinding = oneBinding(authority, RUNTIME_ROLE_POLICY_KEY);
  const profileBinding = oneBinding(authority, INSTANCE_PROFILE_KEY);
  if (
    artifactBinding === null ||
    roleBinding === null ||
    policyBinding === null ||
    profileBinding === null
  ) {
    if (binding !== null || currentAction?.action === 'create') {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
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
  assertBindingBase(roleBinding, authority, {
    resourceKey: RUNTIME_ROLE_KEY,
    capabilityKind: 'runtime-identity',
    roleKind: 'role',
    ownershipMode: 'direct',
    providerType: 'iam-role',
  });
  assertDependencyBindings(roleBinding, []);
  assertBindingBase(policyBinding, authority, {
    resourceKey: RUNTIME_ROLE_POLICY_KEY,
    capabilityKind: 'runtime-identity',
    roleKind: 'inline-policy',
    ownershipMode: 'derived',
    providerType: 'iam-role-inline-policy',
  });
  assertDependencyBindings(policyBinding, [artifactBinding, roleBinding]);
  assertBindingBase(profileBinding, authority, {
    resourceKey: INSTANCE_PROFILE_KEY,
    capabilityKind: 'runtime-identity',
    roleKind: 'instance-profile',
    ownershipMode: 'direct',
    providerType: 'instance-profile',
  });
  assertDependencyBindings(profileBinding, []);

  let runtimeRoleId;
  let instanceProfileId;
  try {
    runtimeRoleId = validateAwsSingleNodeRuntimeRoleId(
      roleBinding.providerResourceId,
    );
    instanceProfileId = validateAwsSingleNodeInstanceProfileId(
      profileBinding.providerResourceId,
    );
  } catch {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
  const expectedArtifactArn = getAwsSingleNodeManagedArtifactObjectLocation(
    policyAuthority(authority),
  ).arn;
  const expectedPolicyId = getAwsSingleNodeRuntimePolicyProviderResourceId({
    runtimeRoleId,
  });
  const providerResourceId =
    getAwsSingleNodeRuntimeAssociationProviderResourceId({
      runtimeRoleId,
      instanceProfileId,
    });
  if (
    artifactBinding.providerResourceId !== expectedArtifactArn ||
    policyBinding.providerResourceId !== expectedPolicyId
  ) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
  if (binding !== null) {
    assertBindingBase(binding, authority, {
      resourceKey: RESOURCE_KEY,
      capabilityKind: 'runtime-identity',
      roleKind: 'instance-profile-role-association',
      ownershipMode: 'derived',
      providerType: PROVIDER_TYPE,
    });
    assertDependencyBindings(binding, [
      roleBinding,
      policyBinding,
      profileBinding,
    ]);
    if (binding.providerResourceId !== providerResourceId) {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
    }
  }
  const names = nameAuthority(authority);
  const policies = policyAuthority(authority);
  const expectedDigest = getAwsSingleNodeRuntimeAssociationStateDigest(names);
  if (!sameJson(target.target.stateDigest, expectedDigest)) {
    throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
  }
  return deepFreeze({
    artifactBinding,
    roleBinding,
    policyBinding,
    profileBinding,
    runtimeRoleId,
    instanceProfileId,
    roleName: getAwsSingleNodeRuntimeRoleName(names),
    instanceProfileName: getAwsSingleNodeRuntimeInstanceProfileName(names),
    roleStateDigest: historicalStateDigest(
      authority,
      roleBinding,
      'role',
      'iam-role',
    ),
    policyStateDigest: getAwsSingleNodeRuntimePolicyStateDigest(policies),
    profileStateDigest: historicalStateDigest(
      authority,
      profileBinding,
      'instance-profile',
      'instance-profile',
    ),
    expectedDigest,
    providerResourceId,
  });
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
    providerIdentity: { providerType: PROVIDER_TYPE, providerResourceId },
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
    providerIdentity: { providerType: PROVIDER_TYPE, providerResourceId },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind the read-only derived role/profile relationship observer to one exact
 * credential scope. It owns no mutation or client lifecycle capability.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociationResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociationResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociationResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociationResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeInstanceProfileRoleAssociationResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeInstanceProfileRoleAssociationResourceObserver client.${method} is required.`,
      );
    }
  }
  const client = Object.freeze(
    Object.fromEntries(
      [...CLIENT_KEYS].map((method) => [method, options.client[method]]),
    ),
  );
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInstanceProfileRoleAssociationResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInstanceProfileRoleAssociationResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInstanceProfileRoleAssociationResourceObserver waitForRetry must be a function.',
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

  /**
   * Read a complete bounded IAM Marker list. A first-page endpoint NotFound
   * remains distinguishable from malformed evidence, while NotFound after a
   * successful page is propagation disagreement.
   * @param {'listRoleTags'|'listRolePolicies'|'listAttachedRolePolicies'|'listInstanceProfileTags'|'listInstanceProfilesForRole'} method - Exact narrow client method.
   * @param {string} itemKey - Exact IAM response array field.
   * @param {Readonly<Record<string, any>>} baseRequest - Immutable request fields.
   * @param {number} maxItems - Per-page result bound.
   * @param {(items: unknown[]) => Readonly<Array<unknown>>} decodeItems - Page-local evidence decoder.
   * @returns {Promise<Readonly<Record<string, any>>>}
   */
  async function readList(method, itemKey, baseRequest, maxItems, decodeItems) {
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
            if (noSuchEntity(error)) {
              if (successfulPages === 0) throw new EndpointAbsentError();
              throw new AwsIamEvidenceTransientError();
            }
            throw new AwsIamEvidenceUnknownError();
          }
        },
        decodeItems,
        itemKey,
        baseRequest,
        maxPages:
          AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_READ_PAGES,
        maxItems,
      });
      return deepFreeze({ state: 'present', items });
    } catch (error) {
      if (error instanceof EndpointAbsentError) {
        return Object.freeze({ state: 'endpoint-absent', items: [] });
      }
      if (
        error instanceof TypeError ||
        error instanceof AwsIamEvidenceConflictError ||
        error instanceof AwsIamEvidenceTransientError ||
        error instanceof AwsIamEvidenceUnknownError
      ) {
        throw error;
      }
      throw new AwsIamEvidenceUnknownError();
    }
  }

  /** @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expected @returns {(items: unknown[]) => ReadonlyArray<unknown>} */
  function exactTagPageDecoder(expected) {
    const expectedByKey = new Map(expected.map((tag) => [tag.Key, tag.Value]));
    const seen = new Set();
    return (items) => {
      const tags = decodeAwsIamTags(items);
      for (const tag of tags) {
        if (seen.has(tag.Key) || expectedByKey.get(tag.Key) !== tag.Value) {
          throw new AwsIamEvidenceConflictError();
        }
        seen.add(tag.Key);
      }
      if (seen.size > expected.length) {
        throw new AwsIamEvidenceConflictError();
      }
      return [...tags];
    };
  }

  /** @returns {(items: unknown[]) => Readonly<Array<unknown>>} */
  function policyNamePageDecoder() {
    let seenPolicy = false;
    return (items) => {
      const names = decodeAwsSingleNodeRuntimeRolePolicyNamesPage(items);
      if (names.length === 1) {
        if (seenPolicy) throw new AwsIamEvidenceConflictError();
        seenPolicy = true;
      }
      return [...names];
    };
  }

  /** @param {Readonly<Record<string, any>>} endpoints @returns {(items: unknown[]) => ReadonlyArray<unknown>} */
  function profilePageDecoder(endpoints) {
    let seenProfile = false;
    return (items) => {
      const profiles = decodeAwsSingleNodeRuntimeRoleInstanceProfiles(items);
      const view = decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
        profiles,
        membershipAuthority(endpoints),
      );
      if (view.membership === 'present') {
        if (seenProfile) throw new AwsIamEvidenceConflictError();
        seenProfile = true;
      }
      return [...profiles];
    };
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} endpoints @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
  function expectedRoleTags(authority, endpoints) {
    return getAwsSingleNodeRuntimeRoleOwnershipTags({
      capabilityKind: endpoints.roleBinding.capability.kind,
      roleKind: endpoints.roleBinding.role.kind,
      providerScopeId: authority.providerScope.providerScopeId,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
      resourceKey: endpoints.roleBinding.resourceKey,
      createdByActionId: endpoints.roleBinding.createdByActionId,
      ownershipNonce: endpoints.roleBinding.ownershipNonce,
      stateDigest: endpoints.roleStateDigest,
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} endpoints @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
  function expectedProfileTags(authority, endpoints) {
    return createAwsSingleNodeInstanceProfileOwnershipTags({
      providerScopeId: authority.providerScope.providerScopeId,
      deploymentInstanceId: authority.deploymentInstanceId,
      incarnationId: authority.incarnationId,
      createdByActionId: endpoints.profileBinding.createdByActionId,
      ownershipNonce: endpoints.profileBinding.ownershipNonce,
      stateDigest: endpoints.profileStateDigest,
    });
  }

  /** @param {Readonly<Record<string, any>>} endpoints @returns {Readonly<Record<string, any>>} */
  function membershipAuthority(endpoints) {
    return deepFreeze({
      providerScope,
      roleName: endpoints.roleName,
      runtimeRoleId: endpoints.runtimeRoleId,
      instanceProfileName: endpoints.instanceProfileName,
      instanceProfileId: endpoints.instanceProfileId,
    });
  }

  /** @param {Readonly<Record<string, any>>} endpoints @returns {Promise<Readonly<Record<string, any>>>} */
  async function readRole(endpoints) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: endpoints.roleName }),
      );
    } catch (error) {
      if (noSuchEntity(error)) {
        return Object.freeze({ state: 'endpoint-absent', evidence: null });
      }
      throw new AwsIamEvidenceUnknownError();
    }
    const role = decodeAwsSingleNodeRuntimeRoleResponse(
      response,
      endpoints.roleName,
    );
    const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(role, {
      providerScope,
      roleName: endpoints.roleName,
      providerResourceId: endpoints.runtimeRoleId,
    });
    return deepFreeze({ state: 'present', evidence });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} endpoints @returns {Promise<Readonly<Record<string, any>>>} */
  async function readPolicy(authority, endpoints) {
    let response;
    try {
      response = await client.getRolePolicy(
        deepFreeze({
          RoleName: endpoints.roleName,
          PolicyName: AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
        }),
      );
    } catch (error) {
      if (noSuchEntity(error)) {
        return Object.freeze({ state: 'absent', evidence: null });
      }
      throw new AwsIamEvidenceUnknownError();
    }
    const evidence = decodeAwsSingleNodeRuntimeRolePolicyResponse(response, {
      roleName: endpoints.roleName,
      policyAuthority: policyAuthority(authority),
    });
    return deepFreeze({ state: 'present', evidence });
  }

  /** @param {Readonly<Record<string, any>>} endpoints @returns {Promise<Readonly<Record<string, any>>>} */
  async function readProfile(endpoints) {
    let response;
    try {
      response = await client.getInstanceProfile(
        deepFreeze({
          InstanceProfileName: endpoints.instanceProfileName,
        }),
      );
    } catch (error) {
      if (noSuchEntity(error)) {
        return Object.freeze({
          state: 'endpoint-absent',
          profile: null,
          membership: null,
        });
      }
      throw new AwsIamEvidenceUnknownError();
    }
    const profile = decodeAwsSingleNodeInstanceProfileResponse(response, {
      providerScope,
      instanceProfileName: endpoints.instanceProfileName,
      expectedInstanceProfileId: endpoints.instanceProfileId,
    });
    const membership =
      decodeAwsSingleNodeInstanceProfileRoleAssociationProfileView(
        profile,
        membershipAuthority(endpoints),
      );
    return deepFreeze({ state: 'present', profile, membership });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} endpoints @returns {Promise<Readonly<Record<string, any>>>} */
  async function observeAttempt(authority, endpoints) {
    const roleTags = expectedRoleTags(authority, endpoints);
    const profileTags = expectedProfileTags(authority, endpoints);
    const roleRequest = deepFreeze({ RoleName: endpoints.roleName });
    const profileRequest = deepFreeze({
      InstanceProfileName: endpoints.instanceProfileName,
    });
    const results = await Promise.allSettled([
      readRole(endpoints),
      readList(
        'listRoleTags',
        'Tags',
        roleRequest,
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE,
        exactTagPageDecoder(roleTags),
      ),
      readList(
        'listRolePolicies',
        'PolicyNames',
        roleRequest,
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
        policyNamePageDecoder(),
      ),
      readList(
        'listAttachedRolePolicies',
        'AttachedPolicies',
        roleRequest,
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
        (items) => [
          ...decodeAwsSingleNodeRuntimeRoleAttachedPoliciesPage(items),
        ],
      ),
      readPolicy(authority, endpoints),
      readProfile(endpoints),
      readList(
        'listInstanceProfileTags',
        'Tags',
        profileRequest,
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_TAG_PAGE_SIZE,
        exactTagPageDecoder(profileTags),
      ),
      readList(
        'listInstanceProfilesForRole',
        'InstanceProfiles',
        roleRequest,
        AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_PROFILE_PAGE_SIZE,
        profilePageDecoder(endpoints),
      ),
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
    if (
      rejected.some((error) => error instanceof AwsIamEvidenceTransientError)
    ) {
      throw new AwsIamEvidenceTransientError();
    }
    if (rejected.length !== 0) {
      const unexpected = rejected.find((error) => error instanceof TypeError);
      if (unexpected !== undefined) throw unexpected;
      throw new AwsIamEvidenceUnknownError();
    }
    const [
      roleResult,
      roleTagsResult,
      inlineResult,
      attachedResult,
      policyResult,
      profileResult,
      profileTagsResult,
      roleProfilesResult,
    ] = results;
    if (
      roleResult.status !== 'fulfilled' ||
      roleTagsResult.status !== 'fulfilled' ||
      inlineResult.status !== 'fulfilled' ||
      attachedResult.status !== 'fulfilled' ||
      policyResult.status !== 'fulfilled' ||
      profileResult.status !== 'fulfilled' ||
      profileTagsResult.status !== 'fulfilled' ||
      roleProfilesResult.status !== 'fulfilled'
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    const roleEndpointPresent =
      roleResult.value.state === 'present' &&
      roleTagsResult.value.state === 'present' &&
      inlineResult.value.state === 'present' &&
      attachedResult.value.state === 'present' &&
      policyResult.value.state === 'present' &&
      roleProfilesResult.value.state === 'present';
    const roleEndpointAbsent =
      roleResult.value.state === 'endpoint-absent' &&
      roleTagsResult.value.state === 'endpoint-absent' &&
      inlineResult.value.state === 'endpoint-absent' &&
      attachedResult.value.state === 'endpoint-absent' &&
      policyResult.value.state === 'absent' &&
      roleProfilesResult.value.state === 'endpoint-absent';
    const profileEndpointPresent =
      profileResult.value.state === 'present' &&
      profileTagsResult.value.state === 'present';
    const profileEndpointAbsent =
      profileResult.value.state === 'endpoint-absent' &&
      profileTagsResult.value.state === 'endpoint-absent';
    if (
      (!roleEndpointPresent && !roleEndpointAbsent) ||
      (!profileEndpointPresent && !profileEndpointAbsent)
    ) {
      throw new AwsIamEvidenceTransientError();
    }
    if (roleEndpointAbsent && profileEndpointAbsent) {
      return deepFreeze({ state: 'absent', dependenciesDesired: false });
    }
    if (roleEndpointPresent) {
      validateAwsIamTags(roleTagsResult.value.items, roleTags, {
        allowIncomplete: true,
      });
      const inventory = decodeAwsSingleNodeRuntimeRolePolicyInventory(
        inlineResult.value.items,
        attachedResult.value.items,
      );
      const policy = corroborateAwsSingleNodeRuntimeRolePolicyEvidence(
        inventory,
        policyResult.value.evidence,
      );
      if (policy.presence !== 'present') {
        throw new AwsIamEvidenceTransientError();
      }
      const roleView =
        decodeAwsSingleNodeInstanceProfileRoleAssociationRoleView(
          roleProfilesResult.value.items,
          membershipAuthority(endpoints),
        );
      if (profileEndpointAbsent) {
        if (roleView.membership !== 'absent') {
          throw new AwsIamEvidenceTransientError();
        }
        return deepFreeze({
          state: 'absent',
          dependenciesDesired: false,
        });
      }
      validateAwsIamTags(profileTagsResult.value.items, profileTags, {
        allowIncomplete: true,
      });
      const relationship =
        corroborateAwsSingleNodeInstanceProfileRoleAssociationViews({
          profileView: profileResult.value.membership,
          roleView,
        });
      return deepFreeze({
        state: relationship.presence,
        dependenciesDesired:
          sameJson(
            roleResult.value.evidence.observedDigest,
            endpoints.roleStateDigest,
          ) && policy.desired,
      });
    }
    validateAwsIamTags(profileTagsResult.value.items, profileTags, {
      allowIncomplete: true,
    });
    if (profileResult.value.membership.membership !== 'absent') {
      throw new AwsIamEvidenceTransientError();
    }
    return deepFreeze({
      state: 'absent',
      dependenciesDesired: false,
    });
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError();
    }
    const endpoints = assertRelationshipAuthority(authority);
    if (endpoints === null) return unknownObservation();
    const isCurrentCreate =
      authority.binding === null &&
      authority.currentAction?.action.action === 'create';
    const isUnboundNoAction =
      authority.binding === null && authority.currentAction === null;
    let allAttemptsCleanAbsent = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const evidence = await observeAttempt(authority, endpoints);
        if (evidence.state === 'present') {
          allAttemptsCleanAbsent = false;
          if (
            isUnboundNoAction ||
            (isCurrentCreate && !evidence.dependenciesDesired)
          ) {
            return conflictObservation(endpoints.providerResourceId);
          }
          return verifiedObservation(
            endpoints.providerResourceId,
            endpoints.expectedDigest,
          );
        }
        if (evidence.state !== 'absent') {
          allAttemptsCleanAbsent = false;
          throw new AwsIamEvidenceUnknownError();
        }
        if (attempt === maxAttempts) {
          return !isCurrentCreate && allAttemptsCleanAbsent
            ? absentObservation()
            : unknownObservation();
        }
      } catch (error) {
        allAttemptsCleanAbsent = false;
        if (error instanceof AwsIamEvidenceConflictError) {
          return conflictObservation(endpoints.providerResourceId);
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
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_ROLE_ASSOCIATION_MAX_ATTEMPTS,
  AwsSingleNodeInstanceProfileRoleAssociationResourceObserverAuthorityError,
  createAwsSingleNodeInstanceProfileRoleAssociationResourceObserver,
};
