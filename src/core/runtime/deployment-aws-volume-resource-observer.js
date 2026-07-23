/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AwsSingleNodeVolumeEvidenceConflictError,
  AwsSingleNodeVolumeEvidenceTransientError,
  AwsSingleNodeVolumeEvidenceUnknownError,
  AwsSingleNodeVolumeLifecycleUnknownError,
  decodeAwsSingleNodeExactVolumeResponse,
  decodeAwsSingleNodeVolumeDiscoveryPage,
  decodeAwsSingleNodeVolumeEvidence,
  getAwsSingleNodeVolumeDiscoveryFilters,
  getAwsSingleNodeVolumeLocatorTags,
  getAwsSingleNodeVolumeOwnershipTags,
  validateAwsSingleNodeVolumeId,
} from './deployment-aws-volume-evidence.js';
import { getAwsSingleNodeVolumeCreateClientToken } from './deployment-aws-volume-resource.js';

export {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeVolumes']);
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
const VOLUME_RESOURCE_KEYS = new Set(['application-state', 'control-state']);
const AUTHORITY_ERROR =
  'AWS single-node volume observation authority does not match the exact retained-volume contract.';

/** Exact durable authority cannot select this retained-volume read mode. */
export class AwsSingleNodeVolumeResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeVolumeResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_RESOURCE_OBSERVER_AUTHORITY';
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

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} receipt @returns {Readonly<Record<string, string>>} */
function ownershipTags(authority, receipt) {
  return getAwsSingleNodeVolumeOwnershipTags({
    ...locator(authority),
    createdByActionId: receipt.createdByActionId,
    ownershipNonce: receipt.ownershipNonce,
  });
}

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeVolumeResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeVolumeResourceObserver context',
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
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {void} */
function assertVolumeAuthority(authority) {
  const target = authority.target;
  if (
    !VOLUME_RESOURCE_KEYS.has(target.resourceKey) ||
    target.capability.kind !== target.resourceKey ||
    target.role.kind !== 'volume' ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'retain' ||
    target.dependsOn.length !== 0 ||
    target.target.providerType !== 'ebs-volume'
  ) {
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
  }
  if (authority.binding !== null) {
    try {
      validateAwsSingleNodeVolumeId(authority.binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
    }
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (authority.binding !== null && currentAction?.action === 'create') ||
    (authority.binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
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
    action.onDestroy !== 'retain' ||
    action.dependsOn.length !== 0
  ) {
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
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
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
  }
  assertHistoricalActionRole(action, authority.target);
  const state = action.after;
  if (
    state === null ||
    state.providerType !== 'ebs-volume' ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId) ||
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string'
  ) {
    throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
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

/** @param {string} resourceKey @param {'none'|'replay-safe-create'} [execution] @returns {Readonly<Record<string, any>>} */
function unknownObservation(resourceKey, execution = 'none') {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution,
  });
}

/** @param {string} resourceKey @param {string} providerResourceId @param {Readonly<Record<string, any>>} observedDigest @returns {Readonly<Record<string, any>>} */
function verifiedObservation(resourceKey, providerResourceId, observedDigest) {
  return validateAwsSingleNodeResourceObservation({
    resourceKey,
    presence: 'present',
    ownership: 'verified',
    providerIdentity: {
      providerType: 'ebs-volume',
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
      providerType: 'ebs-volume',
      providerResourceId,
    },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind a read-only retained-volume observer to one exact credential scope. The
 * caller owns the narrow DescribeVolumes port and its lifecycle.
 * @param {unknown} options - Exact read dependency, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Read-only observer port.
 */
export function createAwsSingleNodeVolumeResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeVolumeResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeVolumeResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVolumeResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeVolumeResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeVolumeResourceObserver client',
  );
  if (typeof options.client.describeVolumes !== 'function') {
    throw new TypeError(
      'awsSingleNodeVolumeResourceObserver client.describeVolumes must be a function.',
    );
  }
  const client = Object.freeze({
    describeVolumes: options.client.describeVolumes,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVolumeResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVolumeResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeVolumeResourceObserver waitForRetry must be a function.',
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

  /** @param {string} exactVolumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(exactVolumeId) {
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [exactVolumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactVolumeResponse(response, exactVolumeId);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Array<Readonly<Record<string, any>>>>>} */
  async function discoverOnce(authority) {
    const filters = getAwsSingleNodeVolumeDiscoveryFilters(locator(authority));
    const volumes = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeVolumes(
          deepFreeze({
            Filters: filters,
            MaxResults: AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new AwsSingleNodeVolumeEvidenceUnknownError();
      }
      const observed = decodeAwsSingleNodeVolumeDiscoveryPage(response);
      for (const volume of observed.volumes) {
        if (volumes.has(volume.VolumeId)) {
          throw new AwsSingleNodeVolumeEvidenceConflictError();
        }
        volumes.set(volume.VolumeId, volume);
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsSingleNodeVolumeEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return [...volumes.values()];
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeVolumeResourceObserverAuthorityError();
    }
    assertVolumeAuthority(authority);
    const resourceKey = authority.target.resourceKey;
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    const historicalStateDigestValue =
      binding === null ? null : historicalBoundStateDigestValue(authority);
    if (isCurrentCreate) {
      getAwsSingleNodeVolumeCreateClientToken(
        currentAction.action.actionId,
        currentAction.ownershipNonce,
      );
    }

    let allAttemptsCleanEmpty = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (binding !== null) {
          const volume = await describeExactOnce(binding.providerResourceId);
          if (volume !== null) {
            try {
              const evidence = decodeAwsSingleNodeVolumeEvidence(volume, {
                allowTagPropagation: false,
                expectedOwnershipTags: ownershipTags(authority, {
                  createdByActionId: binding.createdByActionId,
                  ownershipNonce: binding.ownershipNonce,
                }),
                expectedStateDigestValue: historicalStateDigestValue,
                region: providerScope.region,
              });
              return verifiedObservation(
                resourceKey,
                evidence.providerResourceId,
                evidence.observedDigest,
              );
            } catch (error) {
              if (error instanceof AwsSingleNodeVolumeEvidenceConflictError) {
                return conflictObservation(
                  resourceKey,
                  binding.providerResourceId,
                );
              }
              throw error;
            }
          }
          if (attempt === maxAttempts) {
            return unknownObservation(resourceKey);
          }
        } else {
          let volumes;
          try {
            volumes = await discoverOnce(authority);
          } catch (error) {
            allAttemptsCleanEmpty = false;
            throw error;
          }
          if (volumes.length !== 0) allAttemptsCleanEmpty = false;
          if (volumes.length > 1) {
            if (!isCurrentCreate) return unknownObservation(resourceKey);
            const firstId = volumes
              .map(
                (/** @type {Readonly<Record<string, any>>} */ volume) =>
                  volume.VolumeId,
              )
              .sort()[0];
            return conflictObservation(resourceKey, firstId);
          }
          const volume = volumes[0] ?? null;
          if (volume !== null) {
            if (!isCurrentCreate) {
              try {
                decodeAwsSingleNodeVolumeEvidence(volume, {
                  allowTagPropagation: false,
                  expectedOwnershipTags: getAwsSingleNodeVolumeLocatorTags(
                    locator(authority),
                  ),
                  expectedStateDigestValue: null,
                  region: providerScope.region,
                });
              } catch (error) {
                if (error instanceof AwsSingleNodeVolumeEvidenceConflictError) {
                  return conflictObservation(resourceKey, volume.VolumeId);
                }
                throw error;
              }
              return conflictObservation(resourceKey, volume.VolumeId);
            }
            try {
              const evidence = decodeAwsSingleNodeVolumeEvidence(volume, {
                allowTagPropagation: true,
                expectedOwnershipTags: ownershipTags(authority, {
                  createdByActionId: currentAction.action.actionId,
                  ownershipNonce: currentAction.ownershipNonce,
                }),
                expectedStateDigestValue:
                  currentAction.action.after.stateDigest.value,
                region: providerScope.region,
              });
              return verifiedObservation(
                resourceKey,
                evidence.providerResourceId,
                evidence.observedDigest,
              );
            } catch (error) {
              if (error instanceof AwsSingleNodeVolumeEvidenceConflictError) {
                return conflictObservation(resourceKey, volume.VolumeId);
              }
              throw error;
            }
          }
          if (attempt === maxAttempts) {
            if (!allAttemptsCleanEmpty) {
              return unknownObservation(resourceKey);
            }
            return isCurrentCreate
              ? unknownObservation(resourceKey, 'replay-safe-create')
              : absentObservation(resourceKey);
          }
        }
      } catch (error) {
        if (error instanceof AwsSingleNodeVolumeEvidenceConflictError) {
          return unknownObservation(resourceKey);
        }
        if (
          !(error instanceof AwsSingleNodeVolumeEvidenceUnknownError) &&
          !(error instanceof AwsSingleNodeVolumeEvidenceTransientError) &&
          !(error instanceof AwsSingleNodeVolumeLifecycleUnknownError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          return unknownObservation(resourceKey);
        }
      }
      if (!(await wait(attempt))) {
        return unknownObservation(resourceKey);
      }
    }
    return unknownObservation(resourceKey);
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AwsSingleNodeVolumeResourceObserverAuthorityError,
  createAwsSingleNodeVolumeResourceObserver,
};
