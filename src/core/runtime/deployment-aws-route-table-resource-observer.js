/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS,
  createAwsSingleNodeRouteTableEvidenceKernel,
  decodeAwsSingleNodeExactRouteTableResponse,
  decodeAwsSingleNodeRouteTableActualState,
  decodeAwsSingleNodeRouteTableDiscoveryPage,
  decodeAwsSingleNodeRouteTableIdentity,
  validateAwsSingleNodeRouteTableId,
  validateAwsSingleNodeRouteTableVpcId,
} from './deployment-aws-route-table-evidence.js';
import { getAwsSingleNodeRouteTableCreateClientToken } from './deployment-aws-route-table-resource.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeRouteTables']);
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
const RESOURCE_KEY = 'network-route-table';
const PROVIDER_TYPE = 'ec2-route-table';
const VPC_RESOURCE_KEY = 'network-vpc';
const VPC_PROVIDER_TYPE = 'ec2-vpc';
const CREATE_CLIENT_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const AUTHORITY_ERROR =
  'AWS single-node route-table observation authority does not match the exact managed route-table contract.';

/** Exact durable authority cannot select this managed route-table read mode. */
export class AwsSingleNodeRouteTableResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeRouteTableResourceObserverAuthorityError';
    this.code = 'AWS_SINGLE_NODE_ROUTE_TABLE_RESOURCE_OBSERVER_AUTHORITY';
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
      'awsSingleNodeRouteTableResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeRouteTableResourceObserver context',
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
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
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
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
  try {
    return validateAwsSingleNodeRouteTableVpcId(binding.providerResourceId);
  } catch {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {{binding: Readonly<Record<string, any>>|null, vpcId: string|null}} */
function assertRouteTableAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'route-table' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'direct' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, [VPC_RESOURCE_KEY]) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
  const vpcBindings = authority.head.resourceBindings.filter(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === VPC_RESOURCE_KEY,
  );
  if (vpcBindings.length > 1) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    vpcBindings.length === 0 &&
    (binding !== null || currentAction?.action === 'create')
  ) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
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
      binding.role.kind !== 'route-table' ||
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
      throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
    }
    try {
      validateAwsSingleNodeRouteTableId(binding.providerResourceId);
    } catch {
      throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
    }
  }
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
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
    !sameJson(action.dependsOn, [VPC_RESOURCE_KEY])
  ) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {string} */
function historicalBoundStateDigestValue(authority) {
  const binding = authority.binding;
  if (binding === null) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
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
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
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
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
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

/** @param {'none'|'replay-safe-create'} [execution] @returns {Readonly<Record<string, any>>} */
function unknownObservation(execution = 'none') {
  return validateAwsSingleNodeResourceObservation({
    resourceKey: RESOURCE_KEY,
    presence: 'unknown',
    ownership: 'unknown',
    providerIdentity: null,
    observedDigest: null,
    health: 'unknown',
    execution,
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

/** @param {Readonly<Record<string, any>>} authority @returns {void} */
function assertReplayClientToken(authority) {
  const currentAction = authority.currentAction;
  if (currentAction?.action.action !== 'create') {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
  const token = getAwsSingleNodeRouteTableCreateClientToken(
    currentAction.action.actionId,
    currentAction.ownershipNonce,
  );
  if (!CREATE_CLIENT_TOKEN_PATTERN.test(token)) {
    throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
  }
}

/**
 * Bind a read-only managed route-table observer to one exact credential scope.
 * The caller owns the narrow DescribeRouteTables port.
 * @param {unknown} options - Exact read dependency, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeRouteTableResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRouteTableResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeRouteTableResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeRouteTableResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeRouteTableResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeRouteTableResourceObserver client',
  );
  if (typeof options.client.describeRouteTables !== 'function') {
    throw new TypeError(
      'awsSingleNodeRouteTableResourceObserver client.describeRouteTables is required.',
    );
  }
  const client = Object.freeze({
    describeRouteTables: options.client.describeRouteTables,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeRouteTableResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeRouteTableResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeRouteTableResourceObserver waitForRetry must be a function.',
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

  /** @param {string} routeTableId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExact(routeTableId) {
    let response;
    try {
      response = await client.describeRouteTables(
        deepFreeze({ RouteTableIds: [routeTableId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidRouteTableID.NotFound')) return null;
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeExactRouteTableResponse(response, routeTableId);
  }

  /** @param {Readonly<Record<string, any>>} request @returns {Promise<{records: Readonly<Record<string, any>>[], nextToken: string|null}>} */
  async function readDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeRouteTables(request);
    } catch {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeRouteTableDiscoveryPage(response);
  }

  const evidence = createAwsSingleNodeRouteTableEvidenceKernel({
    readDiscoveryPage,
    readExact,
  });

  /** @param {Readonly<Record<string, any>>} routeTable @param {string|null} expectedVpcId @returns {Readonly<Record<string, any>>} */
  function validateAccountAndVpc(routeTable, expectedVpcId) {
    const identity = decodeAwsSingleNodeRouteTableIdentity(routeTable);
    if (
      identity.ownerId !== providerScope.accountId ||
      (expectedVpcId !== null && identity.vpcId !== expectedVpcId)
    ) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    return identity;
  }

  /** @param {Readonly<Record<string, any>>} routeTable @returns {Readonly<Record<string, any>>} */
  function decodeResidentPhysicalEvidence(routeTable) {
    try {
      return decodeAwsSingleNodeRouteTableActualState(routeTable, {
        allowDescendants: true,
      });
    } catch (error) {
      if (error instanceof AwsTaggedEc2EvidenceConflictError) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      throw error;
    }
  }

  /** @param {Readonly<Record<string, any>>} routeTable @param {Readonly<Record<string, any>>} expectedDigest @returns {Readonly<Record<string, any>>} */
  function decodePristineCreateEvidence(routeTable, expectedDigest) {
    const actual = decodeAwsSingleNodeRouteTableActualState(routeTable, {
      allowDescendants: false,
    });
    if (!sameJson(actual.observedDigest, expectedDigest)) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    return actual;
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
    }
    const { vpcId } = assertRouteTableAuthority(authority);
    const binding = authority.binding;
    const currentAction = authority.currentAction;
    const isCurrentCreate =
      binding === null && currentAction?.action.action === 'create';
    if (isCurrentCreate) assertReplayClientToken(authority);
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

    let allAttemptsCleanEmpty = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        if (binding !== null) {
          if (vpcId === null) {
            throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
          }
          let exact;
          try {
            exact = await evidence.readExactSafely(binding.providerResourceId);
          } catch (error) {
            if (error instanceof AwsTaggedEc2EvidenceConflictError) {
              return conflictObservation(binding.providerResourceId);
            }
            throw error;
          }
          if (exact === null) {
            allAttemptsCleanEmpty = false;
            if (attempt === maxAttempts) return unknownObservation();
          } else {
            try {
              validateAccountAndVpc(exact, vpcId);
              evidence.validateTags(exact.Tags, expectedTags, false);
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(binding.providerResourceId);
              }
              throw error;
            }
            const actual = decodeResidentPhysicalEvidence(exact);
            return verifiedObservation(
              actual.providerResourceId,
              actual.observedDigest,
            );
          }
        } else {
          let discovered;
          try {
            discovered = await evidence.discoverMany(authorityLocator);
          } catch (error) {
            allAttemptsCleanEmpty = false;
            throw error;
          }
          if (discovered.length !== 0) allAttemptsCleanEmpty = false;
          if (discovered.length > 1) {
            const firstId = discovered
              .map((/** @type {Readonly<Record<string, any>>} */ record) =>
                evidence.resourceId(record),
              )
              .sort()[0];
            return conflictObservation(firstId);
          }
          const candidate = discovered[0] ?? null;
          if (!isCurrentCreate) {
            if (candidate !== null) {
              const candidateId = evidence.resourceId(candidate);
              try {
                validateAccountAndVpc(candidate, vpcId);
                evidence.validateCollisionTags(candidate.Tags, locatorTags);
              } catch (error) {
                if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                  return conflictObservation(candidateId);
                }
                throw error;
              }
              return conflictObservation(candidateId);
            }
            if (attempt === maxAttempts) {
              return allAttemptsCleanEmpty
                ? absentObservation()
                : unknownObservation();
            }
          } else if (candidate === null) {
            if (attempt === maxAttempts) {
              return allAttemptsCleanEmpty
                ? unknownObservation('replay-safe-create')
                : unknownObservation();
            }
          } else {
            if (vpcId === null) {
              throw new AwsSingleNodeRouteTableResourceObserverAuthorityError();
            }
            const candidateId = evidence.resourceId(candidate);
            let candidateIdentity;
            try {
              candidateIdentity = validateAccountAndVpc(candidate, vpcId);
              evidence.validateTags(candidate.Tags, expectedTags, true);
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(candidateId);
              }
              throw error;
            }
            let exact;
            try {
              exact = await evidence.readExactSafely(candidateId);
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(candidateId);
              }
              throw error;
            }
            if (exact === null) {
              throw new AwsTaggedEc2EvidenceTransientError();
            }
            try {
              const exactIdentity = validateAccountAndVpc(exact, vpcId);
              evidence.validateTags(exact.Tags, expectedTags, true);
              if (!sameJson(candidateIdentity, exactIdentity)) {
                throw new AwsTaggedEc2EvidenceTransientError();
              }
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(candidateId);
              }
              throw error;
            }
            let candidateActual;
            let exactActual;
            try {
              candidateActual = decodePristineCreateEvidence(
                candidate,
                currentAction.action.after.stateDigest,
              );
              exactActual = decodePristineCreateEvidence(
                exact,
                currentAction.action.after.stateDigest,
              );
            } catch (error) {
              if (error instanceof AwsTaggedEc2EvidenceConflictError) {
                return conflictObservation(candidateId);
              }
              throw error;
            }
            if (
              !sameJson(
                candidateActual.observedDigest,
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
  AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS,
  AwsSingleNodeRouteTableResourceObserverAuthorityError,
  createAwsSingleNodeRouteTableResourceObserver,
};
