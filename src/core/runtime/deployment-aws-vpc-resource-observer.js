/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  createAwsSingleNodeVpcEvidenceKernel,
  decodeAwsSingleNodeExactVpcResponse,
  decodeAwsSingleNodeVpcActualState,
  decodeAwsSingleNodeVpcAttributeResponse,
  decodeAwsSingleNodeVpcDiscoveryPage,
  decodeAwsSingleNodeVpcIdentity,
  decodeAwsSingleNodeVpcRecordState,
  validateAwsSingleNodeVpcId,
} from './deployment-aws-vpc-evidence.js';

export {
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeVpcAttribute', 'describeVpcs']);
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
const AUTHORITY_ERROR =
  'AWS single-node VPC observation authority does not match the exact managed VPC contract.';

/** Exact durable authority cannot select this managed-VPC read mode. */
export class AwsSingleNodeVpcResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeVpcResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_VPC_RESOURCE_OBSERVER_AUTHORITY';
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
      'awsSingleNodeVpcResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeVpcResourceObserver context',
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
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {void} */
function assertVpcAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== 'network-vpc' ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'vpc' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    target.dependsOn.length !== 0 ||
    target.target.providerType !== 'ec2-vpc'
  ) {
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
  }
  if (authority.binding !== null) {
    try {
      validateAwsSingleNodeVpcId(authority.binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeVpcResourceObserverAuthorityError();
    }
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (authority.binding !== null && currentAction?.action === 'create') ||
    (authority.binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
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
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
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
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
  }
  assertHistoricalActionRole(action, authority.target);
  const state = action.after;
  if (
    state === null ||
    state.providerType !== 'ec2-vpc' ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId) ||
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string'
  ) {
    throw new AwsSingleNodeVpcResourceObserverAuthorityError();
  }
  return state.stateDigest.value;
}

/** @returns {Readonly<Record<string, any>>} */
function absentObservation() {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: 'network-vpc',
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
    resourceKey: 'network-vpc',
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
    resourceKey: 'network-vpc',
    presence: 'present',
    ownership: 'verified',
    providerIdentity: {
      providerType: 'ec2-vpc',
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
    resourceKey: 'network-vpc',
    presence: 'present',
    ownership: 'conflict',
    providerIdentity: {
      providerType: 'ec2-vpc',
      providerResourceId,
    },
    observedDigest: null,
    health: 'not-applicable',
    execution: 'none',
  });
}

/**
 * Bind a read-only managed-VPC observer to one exact credential scope. The
 * caller owns the two-method EC2 read port and its lifecycle.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Read-only observer port.
 */
export function createAwsSingleNodeVpcResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeVpcResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeVpcResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVpcResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeVpcResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeVpcResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeVpcResourceObserver client.${method} must be a function.`,
      );
    }
  }
  const client = Object.freeze({
    describeVpcAttribute: options.client.describeVpcAttribute,
    describeVpcs: options.client.describeVpcs,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVpcResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVpcResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeVpcResourceObserver waitForRetry must be a function.',
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

  /** @param {string} exactVpcId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExact(exactVpcId) {
    let response;
    try {
      response = await client.describeVpcs(
        deepFreeze({ VpcIds: [exactVpcId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVpcID.NotFound')) return null;
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactVpcResponse(response, exactVpcId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeVpcs(request);
    } catch {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeVpcDiscoveryPage(response);
  }

  const evidence = createAwsSingleNodeVpcEvidenceKernel({
    readDiscoveryPage,
    readExact,
  });

  /** @param {string} vpcId @param {'enableDnsSupport'|'enableDnsHostnames'} attribute @returns {Promise<boolean>} */
  async function readAttribute(vpcId, attribute) {
    let response;
    try {
      response = await client.describeVpcAttribute(
        deepFreeze({ Attribute: attribute, VpcId: vpcId }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVpcID.NotFound')) {
        throw new AwsTaggedEc2EvidenceTransientError();
      }
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeVpcAttributeResponse(response, vpcId, attribute);
  }

  /** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, string>>} expectedTags @param {boolean} allowTagPropagation @returns {Readonly<Record<string, any>>} */
  function validateOwnershipEvidence(vpc, expectedTags, allowTagPropagation) {
    const identity = decodeAwsSingleNodeVpcIdentity(vpc);
    if (identity.ownerId !== providerScope.accountId) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    evidence.validateTags(vpc.Tags, expectedTags, allowTagPropagation);
    return identity;
  }

  /** @param {Readonly<Record<string, any>>} vpc @param {Readonly<Record<string, any>>} identity @param {boolean} allowPropagation @returns {Promise<Readonly<Record<string, any>>>} */
  async function decodePhysicalEvidence(vpc, identity, allowPropagation) {
    if (identity.state === 'pending') {
      throw new AwsTaggedEc2EvidenceTransientError();
    }
    if (identity.state !== 'available') {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    try {
      decodeAwsSingleNodeVpcRecordState(vpc, allowPropagation);
      const enableDnsSupport = await readAttribute(
        identity.providerResourceId,
        'enableDnsSupport',
      );
      const enableDnsHostnames = await readAttribute(
        identity.providerResourceId,
        'enableDnsHostnames',
      );
      return decodeAwsSingleNodeVpcActualState(vpc, {
        allowPropagation,
        enableDnsSupport,
        enableDnsHostnames,
      });
    } catch (error) {
      if (error instanceof AwsTaggedEc2EvidenceConflictError) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      throw error;
    }
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeVpcResourceObserverAuthorityError();
    }
    assertVpcAuthority(authority);
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    const stableLocator = locator(authority);
    const locatorTags = evidence.locatorTags(stableLocator);
    const historicalStateDigestValue =
      binding === null ? null : historicalBoundStateDigestValue(authority);
    let allAttemptsCleanEmpty = true;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (binding !== null) {
          const vpc = await evidence.readExactSafely(
            binding.providerResourceId,
          );
          if (vpc !== null) {
            let identity;
            try {
              identity = validateOwnershipEvidence(
                vpc,
                evidence.ownershipTags({
                  ...stableLocator,
                  createdByActionId: binding.createdByActionId,
                  ownershipNonce: binding.ownershipNonce,
                  stateDigestValue: historicalStateDigestValue,
                }),
                false,
              );
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(binding.providerResourceId);
              }
              throw error;
            }
            const actual = await decodePhysicalEvidence(vpc, identity, false);
            return verifiedObservation(
              actual.providerResourceId,
              actual.observedDigest,
            );
          }
          if (attempt === maxAttempts) return unknownObservation();
        } else {
          let vpcs;
          try {
            vpcs = await evidence.discoverMany(stableLocator);
          } catch (error) {
            allAttemptsCleanEmpty = false;
            throw error;
          }
          if (vpcs.length !== 0) allAttemptsCleanEmpty = false;
          if (vpcs.length > 1) {
            if (!isCurrentCreate) return unknownObservation();
            const firstId = vpcs
              .map((/** @type {Readonly<Record<string, any>>} */ vpc) =>
                evidence.resourceId(vpc),
              )
              .sort()[0];
            return conflictObservation(firstId);
          }
          const vpc = vpcs[0] ?? null;
          if (vpc !== null) {
            const providerResourceId = evidence.resourceId(vpc);
            if (!isCurrentCreate) {
              try {
                const identity = decodeAwsSingleNodeVpcIdentity(vpc);
                if (identity.ownerId !== providerScope.accountId) {
                  throw new AwsTaggedEc2EvidenceConflictError();
                }
                evidence.validateCollisionTags(vpc.Tags, locatorTags);
              } catch (error) {
                if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                  return conflictObservation(providerResourceId);
                }
                throw error;
              }
              return conflictObservation(providerResourceId);
            }
            let identity;
            try {
              identity = validateOwnershipEvidence(
                vpc,
                evidence.ownershipTags({
                  ...stableLocator,
                  createdByActionId: currentAction.action.actionId,
                  ownershipNonce: currentAction.ownershipNonce,
                  stateDigestValue:
                    currentAction.action.after.stateDigest.value,
                }),
                true,
              );
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(providerResourceId);
              }
              throw error;
            }
            const actual = await decodePhysicalEvidence(vpc, identity, true);
            return verifiedObservation(
              actual.providerResourceId,
              actual.observedDigest,
            );
          }
          if (attempt === maxAttempts) {
            return allAttemptsCleanEmpty && !isCurrentCreate
              ? absentObservation()
              : unknownObservation();
          }
        }
      } catch (error) {
        if (
          !(error instanceof AwsTaggedEc2EvidenceUnknownError) &&
          !(error instanceof AwsTaggedEc2EvidenceTransientError) &&
          !(error instanceof AwsTaggedEc2EvidenceConflictError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) return unknownObservation();
      }
      if (!(await wait(attempt))) return unknownObservation();
    }
    return unknownObservation();
  }

  return Object.freeze({ observe });
}

export default {
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  AwsSingleNodeVpcResourceObserverAuthorityError,
  createAwsSingleNodeVpcResourceObserver,
};
