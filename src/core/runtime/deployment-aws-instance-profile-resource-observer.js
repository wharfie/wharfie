/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  isAwsIamErrorNamed,
} from './deployment-aws-iam-evidence.js';
import {
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
} from './deployment-aws-instance-profile-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { getAwsSingleNodeRuntimeInstanceProfileName } from './deployment-aws-runtime-identity-contract.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set([
  'getInstanceProfile',
  'listInstanceProfileTags',
  'describeInstances',
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
const RESOURCE_KEY = 'runtime-identity';
const PROVIDER_TYPE = 'instance-profile';
const AUTHORITY_ERROR =
  'AWS single-node instance-profile observation authority does not match the exact managed profile contract.';

/** Exact durable authority cannot select this managed profile read mode. */
export class AwsSingleNodeInstanceProfileResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeInstanceProfileResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_INSTANCE_PROFILE_RESOURCE_OBSERVER_AUTHORITY';
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
function instanceProfileNotFound(error) {
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

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function nameAuthority(authority) {
  return deepFreeze({
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
  });
}

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeInstanceProfileResourceObserver context',
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
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {void} */
function assertInstanceProfileAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'runtime-identity' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'instance-profile' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    target.dependsOn.length !== 0 ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  if (binding !== null) {
    if (
      binding.resourceKey !== RESOURCE_KEY ||
      binding.capability.kind !== 'runtime-identity' ||
      binding.capability.version !== 1 ||
      binding.role.kind !== 'instance-profile' ||
      binding.role.version !== 1 ||
      binding.management !== 'managed' ||
      binding.ownershipMode !== 'direct' ||
      binding.onDestroy !== 'purge' ||
      binding.dependencyBindings.length !== 0 ||
      binding.providerType !== PROVIDER_TYPE ||
      binding.providerScopeId !== authority.providerScope.providerScopeId ||
      binding.deploymentInstanceId !== authority.deploymentInstanceId ||
      binding.incarnationId !== authority.incarnationId
    ) {
      throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
    }
    try {
      validateAwsSingleNodeInstanceProfileId(binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
    }
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
  }
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
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
  }
  return state.stateDigest.value;
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
 * Bind a read-only direct instance-profile observer to one exact IAM and
 * regional EC2 credential scope. The caller owns all three narrow read ports.
 * @param {unknown} options - Exact reads, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeInstanceProfileResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInstanceProfileResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInstanceProfileResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeInstanceProfileResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeInstanceProfileResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeInstanceProfileResourceObserver client.${method} is required.`,
      );
    }
  }
  const client = Object.freeze({
    getInstanceProfile: options.client.getInstanceProfile,
    listInstanceProfileTags: options.client.listInstanceProfileTags,
    describeInstances: options.client.describeInstances,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInstanceProfileResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_INSTANCE_PROFILE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInstanceProfileResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInstanceProfileResourceObserver waitForRetry must be a function.',
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

  /** @param {string} instanceProfileName @param {Readonly<Array<Readonly<{Key: string, Value: string}>>>} expectedTags @param {boolean} allowIncomplete @returns {Promise<void>} */
  async function readExactTags(
    instanceProfileName,
    expectedTags,
    allowIncomplete,
  ) {
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
          throw new AwsIamEvidenceTransientError();
        }
        throw new AwsIamEvidenceUnknownError();
      }
      const observed = decodeAwsSingleNodeInstanceProfileTagPage(response);
      tags.push(...observed.tags);
      if (tags.length > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAGS) {
        throw new AwsIamEvidenceConflictError();
      }
      if (observed.marker === null) {
        validateAwsSingleNodeInstanceProfileTags(
          tags,
          expectedTags,
          allowIncomplete,
        );
        return;
      }
      try {
        validateAwsSingleNodeInstanceProfileTags(tags, expectedTags, true);
      } catch (error) {
        if (!(error instanceof AwsIamEvidenceTransientError)) throw error;
      }
      if (
        page === AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_TAG_PAGES ||
        seenMarkers.has(observed.marker)
      ) {
        throw new AwsIamEvidenceUnknownError();
      }
      seenMarkers.add(observed.marker);
      marker = observed.marker;
    }
    throw new AwsIamEvidenceUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} instanceProfile @returns {Promise<void>} */
  async function assertNoCurrentRegionInstanceUse(instanceProfile) {
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
        throw new AwsIamEvidenceUnknownError();
      }
      const observed = decodeAwsSingleNodeInstanceProfileInstancePage(response);
      totalInstances += observed.instances.length;
      if (totalInstances > AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCES) {
        throw new AwsIamEvidenceUnknownError();
      }
      for (const instance of observed.instances) {
        validateAwsSingleNodeInstanceProfileFencedInstance(
          instance,
          instanceProfile,
          providerScope,
        );
      }
      if (observed.nextToken === null) return;
      if (
        page === AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_INSTANCE_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsIamEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    throw new AwsIamEvidenceUnknownError();
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
    }
    assertInstanceProfileAuthority(authority);
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    const isCurrentDelete =
      binding !== null && currentAction?.action.action === 'delete';
    const identityAuthority = nameAuthority(authority);
    const instanceProfileName =
      getAwsSingleNodeRuntimeInstanceProfileName(identityAuthority);
    const expectedTags =
      binding !== null
        ? createAwsSingleNodeInstanceProfileOwnershipTags({
            ...identityAuthority,
            createdByActionId: binding.createdByActionId,
            ownershipNonce: binding.ownershipNonce,
            stateDigest: {
              algorithm: 'sha256',
              value: historicalBoundStateDigestValue(authority),
            },
          })
        : isCurrentCreate
          ? createAwsSingleNodeInstanceProfileOwnershipTags({
              ...identityAuthority,
              createdByActionId: currentAction.action.actionId,
              ownershipNonce: currentAction.ownershipNonce,
              stateDigest: currentAction.action.after.stateDigest,
            })
          : null;

    let allAttemptsCleanAbsent = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response;
      try {
        try {
          response = await client.getInstanceProfile(
            deepFreeze({ InstanceProfileName: instanceProfileName }),
          );
        } catch (error) {
          if (instanceProfileNotFound(error)) {
            if (attempt === maxAttempts) {
              return binding === null &&
                !isCurrentCreate &&
                allAttemptsCleanAbsent
                ? absentObservation()
                : unknownObservation();
            }
            if (!(await wait(attempt))) return unknownObservation();
            continue;
          }
          throw new AwsIamEvidenceUnknownError();
        }
        allAttemptsCleanAbsent = false;
        const candidateId =
          decodeAwsSingleNodeInstanceProfileCandidateId(response);
        let instanceProfile;
        try {
          instanceProfile = decodeAwsSingleNodeInstanceProfileResponse(
            response,
            {
              providerScope,
              instanceProfileName,
              expectedInstanceProfileId: binding?.providerResourceId ?? null,
            },
          );
        } catch (error) {
          if (error instanceof AwsIamEvidenceConflictError) {
            return conflictObservation(
              binding?.providerResourceId ?? candidateId,
            );
          }
          throw error;
        }

        if (binding === null && !isCurrentCreate) {
          return conflictObservation(candidateId);
        }
        if (expectedTags === null) {
          throw new AwsSingleNodeInstanceProfileResourceObserverAuthorityError();
        }
        try {
          await readExactTags(
            instanceProfileName,
            expectedTags,
            isCurrentCreate || isCurrentDelete,
          );
          if (isCurrentDelete) {
            if (instanceProfile.Roles.length !== 0) {
              return conflictObservation(candidateId);
            }
            await assertNoCurrentRegionInstanceUse(instanceProfile);
          }
        } catch (error) {
          if (error instanceof AwsIamEvidenceConflictError) {
            return conflictObservation(candidateId);
          }
          throw error;
        }
        const actual = decodeAwsSingleNodeInstanceProfileActualState(
          instanceProfile,
          identityAuthority,
        );
        return verifiedObservation(
          actual.providerResourceId,
          actual.observedDigest,
        );
      } catch (error) {
        allAttemptsCleanAbsent = false;
        if (
          !(error instanceof AwsIamEvidenceUnknownError) &&
          !(error instanceof AwsIamEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) return unknownObservation();
        if (!(await wait(attempt))) return unknownObservation();
      }
    }
    return unknownObservation();
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_INSTANCE_PROFILE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INSTANCE_PROFILE_MAX_ATTEMPTS,
  AwsSingleNodeInstanceProfileResourceObserverAuthorityError,
  createAwsSingleNodeInstanceProfileResourceObserver,
};
