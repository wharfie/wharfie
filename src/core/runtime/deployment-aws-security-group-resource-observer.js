/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS,
  createAwsSingleNodeSecurityGroupEvidenceKernel,
  decodeAwsSingleNodeExactSecurityGroupResponse,
  decodeAwsSingleNodeSecurityGroupActualState,
  decodeAwsSingleNodeSecurityGroupDiscoveryPage,
  decodeAwsSingleNodeSecurityGroupIdentity,
  validateAwsSingleNodeSecurityGroupId,
  validateAwsSingleNodeSecurityGroupVpcId,
} from './deployment-aws-security-group-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeSecurityGroups']);
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
const RESOURCE_KEY = 'network-security-group';
const PROVIDER_TYPE = 'ec2-security-group';
const VPC_RESOURCE_KEY = 'network-vpc';
const VPC_PROVIDER_TYPE = 'ec2-vpc';
const AUTHORITY_ERROR =
  'AWS single-node security-group observation authority does not match the exact managed security-group contract.';

/** Exact durable authority cannot select this managed security-group read mode. */
export class AwsSingleNodeSecurityGroupResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeSecurityGroupResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_SECURITY_GROUP_RESOURCE_OBSERVER_AUTHORITY';
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

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>} */
function locator(authority) {
  return {
    capabilityKind: authority.target.capability.kind,
    roleKind: authority.target.role.kind,
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    resourceKey: authority.target.resourceKey,
  };
}

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeSecurityGroupResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeSecurityGroupResourceObserver context',
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
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} authority @returns {string} */
function assertVpcDependencyBinding(binding, authority) {
  if (
    binding.resourceKey !== VPC_RESOURCE_KEY ||
    binding.capability.kind !== 'networking' ||
    binding.capability.version !== 1 ||
    binding.role.kind !== 'vpc' ||
    binding.role.version !== 1 ||
    binding.management !== 'managed' ||
    binding.ownershipMode !== 'direct' ||
    binding.onDestroy !== 'purge' ||
    binding.dependencyBindings.length !== 0 ||
    binding.providerType !== VPC_PROVIDER_TYPE ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId
  ) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  try {
    return validateAwsSingleNodeSecurityGroupVpcId(binding.providerResourceId);
  } catch {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {{binding: Readonly<Record<string, any>>|null, vpcId: string|null}} */
function assertSecurityGroupAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'security-group' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    target.dependsOn.length !== 1 ||
    target.dependsOn[0] !== VPC_RESOURCE_KEY ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  const vpcBindings = authority.head.resourceBindings.filter(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === VPC_RESOURCE_KEY,
  );
  if (vpcBindings.length > 1) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    vpcBindings.length === 0 &&
    (binding !== null || currentAction?.action === 'create')
  ) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  const vpcBinding = vpcBindings[0] ?? null;
  const vpcId =
    vpcBinding === null
      ? null
      : assertVpcDependencyBinding(vpcBinding, authority);
  if (binding !== null) {
    if (
      binding.resourceKey !== RESOURCE_KEY ||
      binding.capability.kind !== 'networking' ||
      binding.capability.version !== 1 ||
      binding.role.kind !== 'security-group' ||
      binding.role.version !== 1 ||
      binding.management !== 'managed' ||
      binding.ownershipMode !== 'direct' ||
      binding.onDestroy !== 'purge' ||
      binding.providerType !== PROVIDER_TYPE ||
      binding.providerScopeId !== authority.providerScope.providerScopeId ||
      binding.deploymentInstanceId !== authority.deploymentInstanceId ||
      binding.incarnationId !== authority.incarnationId ||
      binding.dependencyBindings.length !== 1 ||
      binding.dependencyBindings[0].resourceKey !== VPC_RESOURCE_KEY ||
      vpcBinding === null ||
      binding.dependencyBindings[0].bindingId !== vpcBinding.bindingId
    ) {
      throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
    }
    try {
      validateAwsSingleNodeSecurityGroupId(binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
    }
  }
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  return { binding: vpcBinding, vpcId };
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
    action.dependsOn.length !== 1 ||
    action.dependsOn[0] !== VPC_RESOURCE_KEY
  ) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  let action = null;
  if (authority.plan !== null) {
    const actionIndex = authority.plan.actions.findIndex(
      (/** @type {Readonly<Record<string, any>>} */ candidate) =>
        candidate.resourceKey === authority.target.resourceKey &&
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
          candidate.resourceKey === authority.target.resourceKey,
      ) ?? null;
  }
  if (action === null) {
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
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
    throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
  }
  return state.stateDigest.value;
}

/** @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function absentObservation(resourceKey) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'absent',
    ownership: 'missing',
    providerIdentity: null,
    observedDigest: null,
    health: 'absent',
    execution: 'none',
  });
}

/** @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function unknownObservation(resourceKey) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution: 'none',
  });
}

/** @param {string} resourceKey @param {string} providerResourceId @param {Readonly<Record<string, any>>} observedDigest @returns {Readonly<Record<string, any>>} */
function verifiedObservation(resourceKey, providerResourceId, observedDigest) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
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

/** @param {string} resourceKey @param {string} providerResourceId @returns {Readonly<Record<string, any>>} */
function conflictObservation(resourceKey, providerResourceId) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
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
 * Bind a read-only managed security-group observer to one exact credential
 * scope. The caller owns the narrow DescribeSecurityGroups port.
 * @param {unknown} options - Exact read dependency, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Read-only observer port.
 */
export function createAwsSingleNodeSecurityGroupResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSecurityGroupResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeSecurityGroupResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeSecurityGroupResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeSecurityGroupResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeSecurityGroupResourceObserver client',
  );
  if (typeof options.client.describeSecurityGroups !== 'function') {
    throw new TypeError(
      'awsSingleNodeSecurityGroupResourceObserver client.describeSecurityGroups is required.',
    );
  }
  const client = Object.freeze({
    describeSecurityGroups: options.client.describeSecurityGroups,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeSecurityGroupResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeSecurityGroupResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeSecurityGroupResourceObserver waitForRetry must be a function.',
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

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeSecurityGroups(request);
    } catch {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeSecurityGroupDiscoveryPage(response);
  }

  /** @param {string} securityGroupId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExact(securityGroupId) {
    let response;
    try {
      response = await client.describeSecurityGroups(
        deepFreeze({ GroupIds: [securityGroupId] }),
      );
    } catch (error) {
      if (
        errorNamed(error, 'InvalidGroup.NotFound') ||
        errorNamed(error, 'InvalidSecurityGroupID.NotFound')
      ) {
        return null;
      }
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactSecurityGroupResponse(
      response,
      securityGroupId,
    );
  }

  const evidence = createAwsSingleNodeSecurityGroupEvidenceKernel({
    readDiscoveryPage,
    readExact,
  });

  /** @param {Readonly<Record<string, any>>} authority @param {string} vpcId @param {Readonly<Record<string, any>>} securityGroup @param {Readonly<Record<string, string>>} expectedTags @param {boolean} allowPropagation @returns {Readonly<Record<string, any>>} */
  function decodeOwnedPhysicalEvidence(
    authority,
    vpcId,
    securityGroup,
    expectedTags,
    allowPropagation,
  ) {
    evidence.validateTags(securityGroup.Tags, expectedTags, allowPropagation);
    return decodeAwsSingleNodeSecurityGroupActualState(securityGroup, {
      providerScope,
      vpcId,
      egressCidr: authority.providerSpec.capabilities.networking.egressCidr,
      allowPropagation,
    });
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string} vpcId @param {Readonly<Record<string, any>>} securityGroup @returns {Readonly<Record<string, any>>} */
  function decodeCollisionIdentity(authority, vpcId, securityGroup) {
    const identity = decodeAwsSingleNodeSecurityGroupIdentity(
      securityGroup,
      providerScope,
      vpcId,
    );
    evidence.validateCollisionTags(
      securityGroup.Tags,
      evidence.locatorTags(locator(authority)),
    );
    return identity;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string} vpcId @returns {Promise<{discovered: Readonly<Readonly<Record<string, any>>[]>|null, discoveredError: unknown, natural: Readonly<Record<string, any>>|null, naturalError: unknown}>} */
  async function readIndependentViews(authority, vpcId) {
    let discovered = null;
    let discoveredError = null;
    try {
      discovered = await evidence.discoverMany(locator(authority));
    } catch (error) {
      discoveredError = error;
    }
    let natural = null;
    let naturalError = null;
    try {
      natural = await evidence.discoverNaturalSlot({
        expectedOwnerId: providerScope.accountId,
        vpcId,
      });
    } catch (error) {
      naturalError = error;
    }
    return { discovered, discoveredError, natural, naturalError };
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
    }
    const { vpcId } = assertSecurityGroupAuthority(authority);
    const resourceKey = authority.target.resourceKey;
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    const authorityLocator = locator(authority);
    const expectedTags =
      binding !== null
        ? evidence.ownershipTags({
            ...authorityLocator,
            createdByActionId: binding.createdByActionId,
            ownershipNonce: binding.ownershipNonce,
            stateDigestValue: historicalBoundStateDigestValue(authority),
          })
        : isCurrentCreate
          ? evidence.ownershipTags({
              ...authorityLocator,
              createdByActionId: currentAction.action.actionId,
              ownershipNonce: currentAction.ownershipNonce,
              stateDigestValue: currentAction.action.after.stateDigest.value,
            })
          : evidence.locatorTags(authorityLocator);

    let allAttemptsCleanEmpty = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (binding !== null) {
          if (vpcId === null) {
            throw new AwsSingleNodeSecurityGroupResourceObserverAuthorityError();
          }
          const exact = await evidence.readExactSafely(
            binding.providerResourceId,
          );
          if (exact === null) {
            allAttemptsCleanEmpty = false;
            if (attempt === maxAttempts) {
              return unknownObservation(resourceKey);
            }
          } else {
            try {
              const actual = decodeOwnedPhysicalEvidence(
                authority,
                vpcId,
                exact,
                expectedTags,
                false,
              );
              return verifiedObservation(
                resourceKey,
                actual.providerResourceId,
                actual.observedDigest,
              );
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(
                  resourceKey,
                  binding.providerResourceId,
                );
              }
              throw error;
            }
          }
        } else {
          if (vpcId === null) {
            const discovered = await evidence.discoverMany(authorityLocator);
            allAttemptsCleanEmpty = false;
            if (discovered.length !== 0) {
              const firstId = discovered
                .map((/** @type {Readonly<Record<string, any>>} */ candidate) =>
                  evidence.resourceId(candidate),
                )
                .sort()[0];
              try {
                for (const candidate of discovered) {
                  evidence.validateCollisionTags(candidate.Tags, expectedTags);
                }
              } catch (error) {
                if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                  return conflictObservation(resourceKey, firstId);
                }
                throw error;
              }
              return conflictObservation(resourceKey, firstId);
            }
            if (attempt === maxAttempts) {
              return unknownObservation(resourceKey);
            }
            if (!(await wait(attempt))) {
              return unknownObservation(resourceKey);
            }
            continue;
          }
          const views = await readIndependentViews(authority, vpcId);
          const discovered =
            /** @type {Readonly<Readonly<Record<string, any>>[]>} */ (
              views.discovered ?? []
            );
          const natural = views.natural;
          const viewError = views.discoveredError ?? views.naturalError;
          const cleanEmpty =
            viewError === null && discovered.length === 0 && natural === null;
          if (!cleanEmpty) allAttemptsCleanEmpty = false;

          if (!isCurrentCreate) {
            if (natural !== null) {
              return conflictObservation(
                resourceKey,
                evidence.resourceId(natural),
              );
            }
            if (discovered.length !== 0) {
              const ids = discovered
                .map((/** @type {Readonly<Record<string, any>>} */ candidate) =>
                  evidence.resourceId(candidate),
                )
                .sort();
              const providerResourceId = ids[0];
              try {
                for (const candidate of discovered) {
                  decodeCollisionIdentity(authority, vpcId, candidate);
                }
              } catch (error) {
                if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                  return conflictObservation(resourceKey, providerResourceId);
                }
                throw error;
              }
              return conflictObservation(resourceKey, providerResourceId);
            }
            if (viewError !== null) {
              if (viewError instanceof AwsTaggedEc2EvidenceConflictError) {
                throw new AwsTaggedEc2EvidenceConflictError();
              }
              if (viewError instanceof AwsTaggedEc2EvidenceTransientError) {
                throw new AwsTaggedEc2EvidenceTransientError();
              }
              throw new AwsTaggedEc2EvidenceUnknownError();
            }
            if (attempt === maxAttempts) {
              return allAttemptsCleanEmpty
                ? absentObservation(resourceKey)
                : unknownObservation(resourceKey);
            }
          } else {
            if (viewError !== null) {
              if (viewError instanceof AwsTaggedEc2EvidenceConflictError) {
                throw new AwsTaggedEc2EvidenceConflictError();
              }
              if (viewError instanceof AwsTaggedEc2EvidenceTransientError) {
                throw new AwsTaggedEc2EvidenceTransientError();
              }
              throw new AwsTaggedEc2EvidenceUnknownError();
            }
            if (discovered.length > 1) {
              const firstId = discovered
                .map((/** @type {Readonly<Record<string, any>>} */ candidate) =>
                  evidence.resourceId(candidate),
                )
                .sort()[0];
              return conflictObservation(resourceKey, firstId);
            }
            const discoveredGroup = discovered[0] ?? null;
            if (discoveredGroup === null && natural === null) {
              if (attempt === maxAttempts) {
                return unknownObservation(resourceKey);
              }
            } else if (discoveredGroup === null || natural === null) {
              throw new AwsTaggedEc2EvidenceTransientError();
            } else {
              const discoveredId = evidence.resourceId(discoveredGroup);
              const naturalId = evidence.resourceId(natural);
              if (discoveredId !== naturalId) {
                return conflictObservation(
                  resourceKey,
                  [discoveredId, naturalId].sort()[0],
                );
              }
              const exact = await evidence.readExactSafely(discoveredId);
              if (exact === null) {
                throw new AwsTaggedEc2EvidenceTransientError();
              }
              try {
                const discoveredIdentity =
                  decodeAwsSingleNodeSecurityGroupIdentity(
                    discoveredGroup,
                    providerScope,
                    vpcId,
                  );
                const naturalIdentity =
                  decodeAwsSingleNodeSecurityGroupIdentity(
                    natural,
                    providerScope,
                    vpcId,
                  );
                const exactIdentity = decodeAwsSingleNodeSecurityGroupIdentity(
                  exact,
                  providerScope,
                  vpcId,
                );
                if (
                  !sameJson(discoveredIdentity, naturalIdentity) ||
                  !sameJson(discoveredIdentity, exactIdentity)
                ) {
                  throw new AwsTaggedEc2EvidenceTransientError();
                }
                evidence.validateTags(discoveredGroup.Tags, expectedTags, true);
                evidence.validateTags(natural.Tags, expectedTags, true);
                const actual = decodeOwnedPhysicalEvidence(
                  authority,
                  vpcId,
                  exact,
                  expectedTags,
                  true,
                );
                return verifiedObservation(
                  resourceKey,
                  actual.providerResourceId,
                  actual.observedDigest,
                );
              } catch (error) {
                if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                  return conflictObservation(resourceKey, discoveredId);
                }
                throw error;
              }
            }
          }
        }
      } catch (error) {
        allAttemptsCleanEmpty = false;
        if (
          !(error instanceof AwsTaggedEc2EvidenceUnknownError) &&
          !(error instanceof AwsTaggedEc2EvidenceTransientError) &&
          !(error instanceof AwsTaggedEc2EvidenceConflictError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          return unknownObservation(resourceKey);
        }
      }
      if (attempt < maxAttempts && !(await wait(attempt))) {
        return unknownObservation(resourceKey);
      }
    }
    return unknownObservation(resourceKey);
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS,
  AwsSingleNodeSecurityGroupResourceObserverAuthorityError,
  createAwsSingleNodeSecurityGroupResourceObserver,
};
