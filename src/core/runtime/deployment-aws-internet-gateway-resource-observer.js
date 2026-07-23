/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS,
  createAwsSingleNodeInternetGatewayEvidenceKernel,
  decodeAwsSingleNodeExactInternetGatewayResponse,
  decodeAwsSingleNodeInternetGatewayDiscoveryPage,
  decodeAwsSingleNodeInternetGatewayIntrinsicEvidence,
  validateAwsSingleNodeInternetGatewayId,
} from './deployment-aws-internet-gateway-evidence.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeInternetGateways']);
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
const RESOURCE_KEY = 'network-internet-gateway';
const PROVIDER_TYPE = 'ec2-internet-gateway';
const AUTHORITY_ERROR =
  'AWS single-node internet-gateway observation authority does not match the exact managed gateway contract.';

/** Exact durable authority cannot select this managed internet-gateway read mode. */
export class AwsSingleNodeInternetGatewayResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeInternetGatewayResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_INTERNET_GATEWAY_RESOURCE_OBSERVER_AUTHORITY';
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
      'awsSingleNodeInternetGatewayResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeInternetGatewayResourceObserver context',
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
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {void} */
function assertInternetGatewayAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'internet-gateway' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    target.dependsOn.length !== 0 ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
  }
  if (authority.binding !== null) {
    try {
      validateAwsSingleNodeInternetGatewayId(
        authority.binding.providerResourceId,
      );
    } catch {
      throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
    }
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (authority.binding !== null && currentAction?.action === 'create') ||
    (authority.binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
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
    throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
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
 * Bind a read-only managed internet-gateway observer to one exact credential
 * scope. The caller owns the narrow DescribeInternetGateways port.
 * @param {unknown} options - Exact read dependency, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Read-only observer port.
 */
export function createAwsSingleNodeInternetGatewayResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeInternetGatewayResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeInternetGatewayResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeInternetGatewayResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeInternetGatewayResourceObserver client',
  );
  if (typeof options.client.describeInternetGateways !== 'function') {
    throw new TypeError(
      'awsSingleNodeInternetGatewayResourceObserver client.describeInternetGateways is required.',
    );
  }
  const client = Object.freeze({
    describeInternetGateways: options.client.describeInternetGateways,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeInternetGatewayResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeInternetGatewayResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeInternetGatewayResourceObserver waitForRetry must be a function.',
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
      response = await client.describeInternetGateways(request);
    } catch {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeInternetGatewayDiscoveryPage(response);
  }

  /** @param {string} internetGatewayId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExact(internetGatewayId) {
    let response;
    try {
      response = await client.describeInternetGateways(
        deepFreeze({ InternetGatewayIds: [internetGatewayId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidInternetGatewayID.NotFound')) return null;
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactInternetGatewayResponse(
      response,
      internetGatewayId,
    );
  }

  const evidence = createAwsSingleNodeInternetGatewayEvidenceKernel({
    readDiscoveryPage,
    readExact,
  });

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeInternetGatewayResourceObserverAuthorityError();
    }
    assertInternetGatewayAuthority(authority);
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
          const exact = await evidence.readExactSafely(
            binding.providerResourceId,
          );
          if (exact === null) {
            if (attempt === maxAttempts) {
              return unknownObservation(resourceKey);
            }
          } else {
            try {
              const intrinsic =
                decodeAwsSingleNodeInternetGatewayIntrinsicEvidence(
                  exact,
                  providerScope.accountId,
                );
              evidence.validateTags(exact.Tags, expectedTags, false);
              return verifiedObservation(
                resourceKey,
                intrinsic.providerResourceId,
                intrinsic.observedDigest,
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
          const discovered = await evidence.discoverMany(authorityLocator);
          if (discovered.length !== 0) allAttemptsCleanEmpty = false;
          if (discovered.length > 1) {
            if (!isCurrentCreate) return unknownObservation(resourceKey);
            const firstId = discovered
              .map((/** @type {Readonly<Record<string, any>>} */ gateway) =>
                evidence.resourceId(gateway),
              )
              .sort()[0];
            return conflictObservation(resourceKey, firstId);
          }
          const discoveredGateway = discovered[0] ?? null;
          if (discoveredGateway === null) {
            if (attempt === maxAttempts) {
              return isCurrentCreate || !allAttemptsCleanEmpty
                ? unknownObservation(resourceKey)
                : absentObservation(resourceKey);
            }
          } else {
            const discoveredId = evidence.resourceId(discoveredGateway);
            const exact = await evidence.readExactSafely(discoveredId);
            if (exact === null) {
              throw new AwsTaggedEc2EvidenceTransientError();
            }
            if (evidence.resourceId(exact) !== discoveredId) {
              return conflictObservation(resourceKey, discoveredId);
            }
            try {
              decodeAwsSingleNodeInternetGatewayIntrinsicEvidence(
                discoveredGateway,
                providerScope.accountId,
              );
              const intrinsic =
                decodeAwsSingleNodeInternetGatewayIntrinsicEvidence(
                  exact,
                  providerScope.accountId,
                );
              if (isCurrentCreate) {
                evidence.validateTags(
                  discoveredGateway.Tags,
                  expectedTags,
                  true,
                );
                evidence.validateTags(exact.Tags, expectedTags, true);
                return verifiedObservation(
                  resourceKey,
                  intrinsic.providerResourceId,
                  intrinsic.observedDigest,
                );
              }
              evidence.validateCollisionTags(
                discoveredGateway.Tags,
                expectedTags,
              );
              evidence.validateCollisionTags(exact.Tags, expectedTags);
              return conflictObservation(resourceKey, discoveredId);
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(resourceKey, discoveredId);
              }
              throw error;
            }
          }
        }
      } catch (error) {
        allAttemptsCleanEmpty = false;
        if (error instanceof AwsTaggedEc2EvidenceConflictError) {
          return unknownObservation(resourceKey);
        }
        if (
          !(error instanceof AwsTaggedEc2EvidenceUnknownError) &&
          !(error instanceof AwsTaggedEc2EvidenceTransientError)
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
  AWS_SINGLE_NODE_INTERNET_GATEWAY_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_INTERNET_GATEWAY_MAX_ATTEMPTS,
  AwsSingleNodeInternetGatewayResourceObserverAuthorityError,
  createAwsSingleNodeInternetGatewayResourceObserver,
};
