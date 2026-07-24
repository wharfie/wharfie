/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamAttachedPolicies,
  decodeAwsIamPolicyNames,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTags,
} from './deployment-aws-iam-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
  decodeAwsSingleNodeRuntimeRoleEvidence,
  decodeAwsSingleNodeRuntimeRoleInstanceProfiles,
  decodeAwsSingleNodeRuntimeRoleResponse,
  getAwsSingleNodeRuntimeRoleOwnershipTags,
  validateAwsSingleNodeRuntimeRoleId,
} from './deployment-aws-runtime-role-evidence.js';
import {
  AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
  AWS_SINGLE_NODE_RUNTIME_ROLE_PATH,
  assertAwsIamInstanceProfileId,
  getAwsSingleNodeRuntimeInstanceProfileName,
  getAwsSingleNodeRuntimeRoleName,
  getAwsSingleNodeRuntimeRoleStateDigest,
} from './deployment-aws-runtime-identity-contract.js';
import {
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
  AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
} from './deployment-aws-runtime-role-resource.js';

export {
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
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
const RESOURCE_KEY = 'runtime-role';
const PROFILE_RESOURCE_KEY = 'runtime-identity';
const PROVIDER_TYPE = 'iam-role';
const PROFILE_PROVIDER_TYPE = 'instance-profile';
const AUTHORITY_ERROR =
  'AWS single-node runtime-role observation authority does not match the exact managed role contract.';

/** Exact durable authority cannot select this managed runtime-role read mode. */
export class AwsSingleNodeRuntimeRoleResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeRuntimeRoleResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_RUNTIME_ROLE_RESOURCE_OBSERVER_AUTHORITY';
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
function roleNotFound(error) {
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
      'awsSingleNodeRuntimeRoleResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeRuntimeRoleResourceObserver context',
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
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function roleNameAuthority(authority) {
  return {
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  };
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>|null} */
function profileBinding(authority) {
  const matches = authority.head.resourceBindings.filter(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === PROFILE_RESOURCE_KEY,
  );
  if (matches.length > 1) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  const binding = matches[0] ?? null;
  if (binding === null) return null;
  if (
    binding.capability.kind !== 'runtime-identity' ||
    binding.capability.version !== 1 ||
    binding.role.kind !== 'instance-profile' ||
    binding.role.version !== 1 ||
    binding.management !== 'managed' ||
    binding.ownershipMode !== 'direct' ||
    binding.onDestroy !== 'purge' ||
    binding.dependencyBindings.length !== 0 ||
    binding.providerType !== PROFILE_PROVIDER_TYPE ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  try {
    assertAwsIamInstanceProfileId(binding.providerResourceId);
  } catch {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  return binding;
}

/**
 * Re-prove the direct role contract and deterministic name before provider I/O.
 * @param {Readonly<Record<string, any>>} authority - Revalidated V48 authority.
 * @returns {Readonly<Record<string, any>>}
 */
function assertRuntimeRoleAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'runtime-identity' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'role' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    target.dependsOn.length !== 0 ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  if (binding !== null) {
    try {
      validateAwsSingleNodeRuntimeRoleId(binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
    }
  }
  const nameAuthority = roleNameAuthority(authority);
  const roleName = getAwsSingleNodeRuntimeRoleName(nameAuthority);
  const desiredDigest = getAwsSingleNodeRuntimeRoleStateDigest(nameAuthority);
  if (!sameJson(target.target.stateDigest, desiredDigest)) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  return deepFreeze({
    binding,
    currentAction,
    roleName,
    desiredDigest,
    profileBinding: profileBinding(authority),
  });
}

/** @param {Readonly<Record<string, any>>} action @param {Readonly<Record<string, any>>} target @returns {void} */
function assertHistoricalActionRole(action, target) {
  if (
    action.resourceKey !== target.resourceKey ||
    !sameJson(action.capability, target.capability) ||
    !sameJson(action.role, target.role) ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function historicalBoundStateDigest(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  let action = null;
  if (authority.plan !== null) {
    const actionIndex = authority.plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === RESOURCE_KEY &&
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
          candidate.resourceKey === RESOURCE_KEY,
      ) ?? null;
  }
  if (action === null) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  assertHistoricalActionRole(action, authority.target);
  const state = action.after;
  if (
    state === null ||
    state.providerType !== PROVIDER_TYPE ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId) ||
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string'
  ) {
    throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
  }
  return state.stateDigest;
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>|null} */
function expectedOwnershipTags(authority, dependencies) {
  const input = {
    capabilityKind: authority.target.capability.kind,
    roleKind: authority.target.role.kind,
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    resourceKey: RESOURCE_KEY,
  };
  if (dependencies.binding !== null) {
    return getAwsSingleNodeRuntimeRoleOwnershipTags({
      ...input,
      createdByActionId: dependencies.binding.createdByActionId,
      ownershipNonce: dependencies.binding.ownershipNonce,
      stateDigest: historicalBoundStateDigest(authority),
    });
  }
  if (dependencies.currentAction?.action === 'create') {
    return getAwsSingleNodeRuntimeRoleOwnershipTags({
      ...input,
      createdByActionId: dependencies.currentAction.actionId,
      ownershipNonce: authority.currentAction.ownershipNonce,
      stateDigest: dependencies.currentAction.after.stateDigest,
    });
  }
  return null;
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
 * Bind a read-only managed runtime-role observer to one exact IAM credential
 * scope. The caller owns the five-method IAM read port.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeRuntimeRoleResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRoleResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeRuntimeRoleResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRuntimeRoleResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeRuntimeRoleResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeRuntimeRoleResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeRuntimeRoleResourceObserver client.${method} is required.`,
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
    'awsSingleNodeRuntimeRoleResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRuntimeRoleResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRuntimeRoleResourceObserver waitForRetry must be a function.',
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

  /** @param {string} method @param {string} itemKey @param {(items: unknown[]) => readonly unknown[]} decodeItems @param {Readonly<Record<string, any>>} baseRequest @returns {Promise<unknown[]>} */
  async function readList(method, itemKey, decodeItems, baseRequest) {
    return readAwsIamListPages({
      readPage: async (
        /** @type {Readonly<Record<string, any>>} */ request,
      ) => {
        try {
          return await client[method](request);
        } catch (error) {
          if (roleNotFound(error)) {
            throw new AwsIamEvidenceTransientError();
          }
          throw new AwsIamEvidenceUnknownError();
        }
      },
      decodeItems,
      itemKey,
      baseRequest,
      maxPages: AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_READ_PAGES,
      maxItems: AWS_SINGLE_NODE_RUNTIME_ROLE_READ_MAX_ITEMS,
    });
  }

  /** @param {readonly Readonly<Record<string, any>>[]} profiles @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {void} */
  function validateProfiles(profiles, authority, dependencies) {
    if (profiles.length === 0) return;
    if (profiles.length > 1) throw new AwsIamEvidenceConflictError();
    const profile = profiles[0];
    const profileName = getAwsSingleNodeRuntimeInstanceProfileName(
      roleNameAuthority(authority),
    );
    const expectedArn = `arn:${providerScope.partition}:iam::${providerScope.accountId}:instance-profile${AWS_SINGLE_NODE_RUNTIME_ROLE_PATH}${profileName}`;
    if (
      profile.instanceProfileName !== profileName ||
      profile.path !== AWS_SINGLE_NODE_RUNTIME_ROLE_PATH ||
      profile.arn !== expectedArn ||
      dependencies.profileBinding === null ||
      profile.instanceProfileId !==
        dependencies.profileBinding.providerResourceId
    ) {
      throw new AwsIamEvidenceConflictError();
    }
  }

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>|null} expectedTags @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function observeAttempt(authority, dependencies, expectedTags) {
    let response;
    try {
      response = await client.getRole(
        deepFreeze({ RoleName: dependencies.roleName }),
      );
    } catch (error) {
      if (roleNotFound(error)) return null;
      throw new AwsIamEvidenceUnknownError();
    }
    let candidateId = dependencies.binding?.providerResourceId ?? null;
    try {
      if (isPlainObject(response) && isPlainObject(response.Role)) {
        try {
          candidateId = validateAwsSingleNodeRuntimeRoleId(
            response.Role.RoleId,
          );
        } catch {
          // The strict response/evidence decoder owns the final taxonomy.
        }
      }
      const role = decodeAwsSingleNodeRuntimeRoleResponse(
        response,
        dependencies.roleName,
      );
      const evidence = decodeAwsSingleNodeRuntimeRoleEvidence(role, {
        providerScope,
        roleName: dependencies.roleName,
        providerResourceId: dependencies.binding?.providerResourceId ?? null,
      });
      candidateId = evidence.providerResourceId;
      if (
        dependencies.currentAction?.action === 'create' &&
        !sameJson(evidence.observedDigest, dependencies.desiredDigest)
      ) {
        throw new AwsIamEvidenceConflictError();
      }

      const roleRequest = deepFreeze({ RoleName: dependencies.roleName });
      const seenTagKeys = new Set();
      const tags = await readList(
        'listRoleTags',
        'Tags',
        (items) => {
          const decoded = decodeAwsIamTags(items);
          for (const tag of decoded) {
            if (seenTagKeys.has(tag.Key)) {
              throw new AwsIamEvidenceConflictError();
            }
            seenTagKeys.add(tag.Key);
          }
          if (expectedTags !== null) {
            for (const tag of decoded) {
              const expected = expectedTags.find(
                (candidate) => candidate.Key === tag.Key,
              );
              if (expected === undefined || expected.Value !== tag.Value) {
                throw new AwsIamEvidenceConflictError();
              }
            }
          }
          return [...decoded];
        },
        roleRequest,
      );
      if (expectedTags !== null) {
        validateAwsIamTags(tags, expectedTags, {
          allowIncomplete:
            dependencies.currentAction?.action === 'create' ||
            dependencies.currentAction?.action === 'delete',
        });
      } else {
        decodeAwsIamTags(tags);
      }

      const inlinePolicies = decodeAwsIamPolicyNames(
        await readList(
          'listRolePolicies',
          'PolicyNames',
          (items) => {
            const decoded = decodeAwsIamPolicyNames(items);
            if (
              decoded.some(
                (name) => name !== AWS_SINGLE_NODE_RUNTIME_POLICY_NAME,
              )
            ) {
              throw new AwsIamEvidenceConflictError();
            }
            return [...decoded];
          },
          roleRequest,
        ),
      );
      if (
        inlinePolicies.length > 1 ||
        (dependencies.currentAction?.action === 'delete' &&
          inlinePolicies.length !== 0)
      ) {
        throw new AwsIamEvidenceConflictError();
      }

      const attachedPolicies = decodeAwsIamAttachedPolicies(
        await readList(
          'listAttachedRolePolicies',
          'AttachedPolicies',
          (items) => {
            const decoded = decodeAwsIamAttachedPolicies(items);
            if (decoded.length !== 0) {
              throw new AwsIamEvidenceConflictError();
            }
            return [...decoded];
          },
          roleRequest,
        ),
      );
      if (attachedPolicies.length !== 0) {
        throw new AwsIamEvidenceConflictError();
      }

      /** @type {Readonly<Record<string, any>>[]} */
      const observedProfiles = [];
      const profiles = /** @type {readonly Readonly<Record<string, any>>[]} */ (
        await readList(
          'listInstanceProfilesForRole',
          'InstanceProfiles',
          (items) => {
            const decoded =
              decodeAwsSingleNodeRuntimeRoleInstanceProfiles(items);
            observedProfiles.push(...decoded);
            validateProfiles(observedProfiles, authority, dependencies);
            return [...decoded];
          },
          roleRequest,
        )
      );
      validateProfiles(profiles, authority, dependencies);
      if (expectedTags === null) {
        throw new AwsIamEvidenceConflictError();
      }
      return evidence;
    } catch (error) {
      if (
        error instanceof AwsIamEvidenceConflictError &&
        candidateId !== null
      ) {
        return deepFreeze({ conflict: true, providerResourceId: candidateId });
      }
      throw error;
    }
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeRuntimeRoleResourceObserverAuthorityError();
    }
    const dependencies = assertRuntimeRoleAuthority(authority);
    const expectedTags = expectedOwnershipTags(authority, dependencies);
    const isCurrentCreate =
      dependencies.binding === null &&
      dependencies.currentAction?.action === 'create';
    const canConcludeAbsent =
      dependencies.binding === null && dependencies.currentAction === null;

    let allAttemptsCleanAbsent = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await observeAttempt(
          authority,
          dependencies,
          expectedTags,
        );
        if (result === null) {
          if (attempt === maxAttempts) {
            return !isCurrentCreate &&
              canConcludeAbsent &&
              allAttemptsCleanAbsent
              ? absentObservation()
              : unknownObservation();
          }
        } else {
          allAttemptsCleanAbsent = false;
          if (result.conflict === true) {
            return conflictObservation(result.providerResourceId);
          }
          return verifiedObservation(
            result.providerResourceId,
            result.observedDigest,
          );
        }
      } catch (error) {
        allAttemptsCleanAbsent = false;
        if (error instanceof AwsIamEvidenceConflictError) {
          return unknownObservation();
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
  AWS_SINGLE_NODE_RUNTIME_ROLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_RUNTIME_ROLE_MAX_ATTEMPTS,
  AwsSingleNodeRuntimeRoleResourceObserverAuthorityError,
  createAwsSingleNodeRuntimeRoleResourceObserver,
};
