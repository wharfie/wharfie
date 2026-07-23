/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES,
  createAwsSingleNodeSubnetEvidenceKernel,
  createAwsSingleNodeSubnetNaturalSlot,
  decodeAwsSingleNodeExactSubnetResponse,
  decodeAwsSingleNodeSubnetActualState,
  decodeAwsSingleNodeSubnetDiscoveryPage,
  decodeAwsSingleNodeSubnetIdentity,
  decodeAwsSingleNodeSubnetRecordState,
  validateAwsSingleNodeSubnetId,
  validateAwsSingleNodeSubnetVpcId,
} from './deployment-aws-subnet-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeSubnets']);
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
const RESOURCE_KEY = 'network-subnet';
const PROVIDER_TYPE = 'ec2-subnet';
const VPC_RESOURCE_KEY = 'network-vpc';
const VPC_PROVIDER_TYPE = 'ec2-vpc';
const AUTHORITY_ERROR =
  'AWS single-node subnet observation authority does not match the exact managed subnet contract.';

/** Exact durable authority cannot select this managed-subnet read mode. */
export class AwsSingleNodeSubnetResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeSubnetResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_SUBNET_RESOURCE_OBSERVER_AUTHORITY';
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

/** @param {unknown} error @returns {boolean} */
function subnetNotFound(error) {
  return (
    errorNamed(error, 'InvalidSubnetID.NotFound') ||
    errorNamed(error, 'InvalidSubnetId.NotFound')
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
      'awsSingleNodeSubnetResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeSubnetResourceObserver context',
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
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} authority @returns {void} */
function assertSubnetAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'subnet' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, [VPC_RESOURCE_KEY]) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
  if (authority.binding !== null) {
    try {
      validateAwsSingleNodeSubnetId(authority.binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
    }
  }
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (authority.binding !== null && currentAction?.action === 'create') ||
    (authority.binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>|null} */
function resolveVpcBinding(authority) {
  const matches = authority.head.resourceBindings.filter(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === VPC_RESOURCE_KEY,
  );
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
  const binding = matches[0];
  try {
    validateAwsSingleNodeSubnetVpcId(binding.providerResourceId);
  } catch {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
  if (
    binding.management !== 'managed' ||
    binding.providerType !== VPC_PROVIDER_TYPE ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    !sameJson(binding.capability, { kind: 'networking', version: 1 }) ||
    !sameJson(binding.role, { kind: 'vpc', version: 1 }) ||
    binding.ownershipMode !== 'direct' ||
    binding.onDestroy !== 'purge' ||
    binding.dependencyBindings.length !== 0
  ) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
  if (
    authority.binding !== null &&
    !sameJson(authority.binding.dependencyBindings, [
      { resourceKey: VPC_RESOURCE_KEY, bindingId: binding.bindingId },
    ])
  ) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
  return binding;
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
    !sameJson(action.dependsOn, [VPC_RESOURCE_KEY])
  ) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
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
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
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
    throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
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
 * Bind a read-only managed subnet observer to one exact credential scope. The
 * caller owns the narrow DescribeSubnets port.
 * @param {unknown} options - Exact read dependency, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeSubnetResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSubnetResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeSubnetResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeSubnetResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeSubnetResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeSubnetResourceObserver client',
  );
  if (typeof options.client.describeSubnets !== 'function') {
    throw new TypeError(
      'awsSingleNodeSubnetResourceObserver client.describeSubnets is required.',
    );
  }
  const client = Object.freeze({
    describeSubnets: options.client.describeSubnets,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeSubnetResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeSubnetResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeSubnetResourceObserver waitForRetry must be a function.',
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

  /** @param {string} subnetId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExact(subnetId) {
    let response;
    try {
      response = await client.describeSubnets(
        deepFreeze({ SubnetIds: [subnetId] }),
      );
    } catch (error) {
      if (subnetNotFound(error)) return null;
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactSubnetResponse(response, subnetId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeSubnets(request);
    } catch {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeSubnetDiscoveryPage(response);
  }

  const evidence = createAwsSingleNodeSubnetEvidenceKernel({
    readDiscoveryPage,
    readExact,
  });

  /** @param {Readonly<Record<string, any>>} slot @returns {Promise<Readonly<Readonly<Record<string, any>>[]>>} */
  async function discoverNaturalSlot(slot) {
    const records = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      const request = deepFreeze({
        Filters: slot.filters,
        MaxResults: AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
        ...(nextToken === null ? {} : { NextToken: nextToken }),
      });
      const observed = await readDiscoveryPage(request);
      for (const record of observed.records) {
        const id = evidence.resourceId(record);
        if (records.has(id)) {
          throw new AwsTaggedEc2EvidenceConflictError();
        }
        records.set(id, record);
        if (records.size > 1) {
          return Object.freeze([...records.values()]);
        }
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return Object.freeze([...records.values()]);
  }

  /** @param {Readonly<Record<string, any>>} subnet @param {string|null} expectedVpcId @returns {Readonly<Record<string, any>>} */
  function validateAccountAndVpc(subnet, expectedVpcId) {
    const identity = decodeAwsSingleNodeSubnetIdentity(subnet);
    if (
      identity.ownerId !== providerScope.accountId ||
      (expectedVpcId !== null && identity.vpcId !== expectedVpcId)
    ) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    return identity;
  }

  /** @param {Readonly<Record<string, any>>} subnet @returns {Readonly<Record<string, any>>} */
  function decodePhysicalEvidence(subnet) {
    try {
      return decodeAwsSingleNodeSubnetActualState(subnet);
    } catch (error) {
      if (error instanceof AwsTaggedEc2EvidenceConflictError) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      throw error;
    }
  }

  /** @param {Readonly<Record<string, any>>} subnet @param {Readonly<Record<string, any>>} slot @returns {void} */
  function assertExactNaturalSlot(subnet, slot) {
    const state = decodeAwsSingleNodeSubnetRecordState(subnet);
    if (
      state.vpcId !== slot.vpcId ||
      state.availabilityZoneId !== slot.availabilityZoneId ||
      state.cidrBlock !== slot.cidrBlock
    ) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
    }
    assertSubnetAuthority(authority);
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    const vpcBinding = resolveVpcBinding(authority);
    if ((binding !== null || isCurrentCreate) && vpcBinding === null) {
      throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
    }
    const authorityLocator = locator(authority);
    const locatorTags = evidence.locatorTags(authorityLocator);
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
          : locatorTags;
    const slot =
      vpcBinding === null
        ? null
        : createAwsSingleNodeSubnetNaturalSlot({
            vpcId: vpcBinding.providerResourceId,
            availabilityZoneId:
              authority.providerSpec.placement.availabilityZoneId,
            cidrBlock:
              authority.providerSpec.capabilities.networking.subnetCidr,
          });

    let allAttemptsCleanEmpty = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (binding !== null) {
          if (vpcBinding === null) {
            throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
          }
          const exact = await evidence.readExactSafely(
            binding.providerResourceId,
          );
          if (exact === null) {
            allAttemptsCleanEmpty = false;
            if (attempt === maxAttempts) return unknownObservation();
          } else {
            try {
              validateAccountAndVpc(exact, vpcBinding.providerResourceId);
              evidence.validateTags(exact.Tags, expectedTags, false);
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(binding.providerResourceId);
              }
              throw error;
            }
            const actual = decodePhysicalEvidence(exact);
            return verifiedObservation(
              actual.providerResourceId,
              actual.observedDigest,
            );
          }
        } else {
          /** @type {Readonly<Readonly<Record<string, any>>[]>} */
          let logical = Object.freeze([]);
          const viewErrors = [];
          try {
            logical = await evidence.discoverMany(authorityLocator);
          } catch (error) {
            allAttemptsCleanEmpty = false;
            viewErrors.push(error);
          }
          if (logical.length > 1) {
            const firstId = logical
              .map((/** @type {Readonly<Record<string, any>>} */ subnet) =>
                evidence.resourceId(subnet),
              )
              .sort()[0];
            return conflictObservation(firstId);
          }
          /** @type {Readonly<Readonly<Record<string, any>>[]>} */
          let natural = Object.freeze([]);
          if (slot !== null) {
            try {
              natural = await discoverNaturalSlot(slot);
            } catch (error) {
              allAttemptsCleanEmpty = false;
              viewErrors.push(error);
            }
          }
          if (logical.length !== 0 || natural.length !== 0) {
            allAttemptsCleanEmpty = false;
          }
          if (natural.length > 1) {
            const firstId = natural
              .map((/** @type {Readonly<Record<string, any>>} */ subnet) =>
                evidence.resourceId(subnet),
              )
              .sort()[0];
            return conflictObservation(firstId);
          }
          const logicalSubnet = logical[0] ?? null;
          const naturalSubnet = natural[0] ?? null;
          if (isCurrentCreate) {
            if (viewErrors.length !== 0) {
              throw new AwsTaggedEc2EvidenceUnknownError();
            }
            if (vpcBinding === null || slot === null) {
              throw new AwsSingleNodeSubnetResourceObserverAuthorityError();
            }
            if (logicalSubnet === null && naturalSubnet === null) {
              if (attempt === maxAttempts) return unknownObservation();
            } else if (logicalSubnet === null || naturalSubnet === null) {
              throw new AwsTaggedEc2EvidenceTransientError();
            } else {
              const logicalId = evidence.resourceId(logicalSubnet);
              const naturalId = evidence.resourceId(naturalSubnet);
              if (logicalId !== naturalId) {
                return conflictObservation([logicalId, naturalId].sort()[0]);
              }
              const exact = await evidence.readExactSafely(logicalId);
              if (exact === null) {
                throw new AwsTaggedEc2EvidenceTransientError();
              }
              try {
                validateAccountAndVpc(
                  logicalSubnet,
                  vpcBinding.providerResourceId,
                );
                validateAccountAndVpc(
                  naturalSubnet,
                  vpcBinding.providerResourceId,
                );
                validateAccountAndVpc(exact, vpcBinding.providerResourceId);
                evidence.validateTags(logicalSubnet.Tags, expectedTags, true);
                evidence.validateTags(naturalSubnet.Tags, expectedTags, true);
                evidence.validateTags(exact.Tags, expectedTags, true);
                assertExactNaturalSlot(logicalSubnet, slot);
                assertExactNaturalSlot(naturalSubnet, slot);
                assertExactNaturalSlot(exact, slot);
              } catch (error) {
                if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                  return conflictObservation(logicalId);
                }
                throw error;
              }
              const logicalActual = decodePhysicalEvidence(logicalSubnet);
              const naturalActual = decodePhysicalEvidence(naturalSubnet);
              const exactActual = decodePhysicalEvidence(exact);
              if (
                !sameJson(
                  logicalActual.observedDigest,
                  naturalActual.observedDigest,
                ) ||
                !sameJson(
                  logicalActual.observedDigest,
                  exactActual.observedDigest,
                )
              ) {
                throw new AwsTaggedEc2EvidenceTransientError();
              }
              return verifiedObservation(
                exactActual.providerResourceId,
                exactActual.observedDigest,
              );
            }
          } else if (logicalSubnet !== null || naturalSubnet !== null) {
            const logicalId =
              logicalSubnet === null
                ? null
                : evidence.resourceId(logicalSubnet);
            const naturalId =
              naturalSubnet === null
                ? null
                : evidence.resourceId(naturalSubnet);
            if (
              logicalId !== null &&
              naturalId !== null &&
              logicalId !== naturalId
            ) {
              return conflictObservation([logicalId, naturalId].sort()[0]);
            }
            const collisionId = /** @type {string} */ (logicalId ?? naturalId);
            const exact = await evidence.readExactSafely(collisionId);
            if (exact === null) {
              throw new AwsTaggedEc2EvidenceTransientError();
            }
            try {
              validateAccountAndVpc(
                exact,
                vpcBinding?.providerResourceId ?? null,
              );
              if (logicalSubnet !== null && naturalSubnet === null) {
                validateAccountAndVpc(
                  logicalSubnet,
                  vpcBinding?.providerResourceId ?? null,
                );
                evidence.validateCollisionTags(logicalSubnet.Tags, locatorTags);
                evidence.validateCollisionTags(exact.Tags, locatorTags);
              }
              if (naturalSubnet !== null && slot !== null) {
                validateAccountAndVpc(naturalSubnet, slot.vpcId);
                assertExactNaturalSlot(naturalSubnet, slot);
                assertExactNaturalSlot(exact, slot);
              }
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(collisionId);
              }
              throw error;
            }
            return conflictObservation(collisionId);
          } else if (viewErrors.length !== 0) {
            throw new AwsTaggedEc2EvidenceUnknownError();
          } else if (attempt === maxAttempts) {
            return slot !== null && allAttemptsCleanEmpty
              ? absentObservation()
              : unknownObservation();
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
  AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS,
  AwsSingleNodeSubnetResourceObserverAuthorityError,
  createAwsSingleNodeSubnetResourceObserver,
};
