/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  decodeAwsSingleNodeDefaultIpv4RouteEvidence,
  decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence,
} from './deployment-aws-default-ipv4-route-evidence.js';
import {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS,
  getAwsSingleNodeDefaultIpv4RouteProviderResourceId,
} from './deployment-aws-default-ipv4-route-resource.js';
import {
  createAwsSingleNodeInternetGatewayEvidenceKernel,
  decodeAwsSingleNodeExactInternetGatewayResponse,
  decodeAwsSingleNodeInternetGatewayDiscoveryPage,
  validateAwsSingleNodeInternetGatewayId,
} from './deployment-aws-internet-gateway-evidence.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from './deployment-aws-internet-gateway-attachment-resource.js';
import {
  createAwsSingleNodeRouteTableEvidenceKernel,
  decodeAwsSingleNodeExactRouteTableResponse,
  decodeAwsSingleNodeRouteTableDiscoveryPage,
  decodeAwsSingleNodeRouteTableIdentity,
  validateAwsSingleNodeRouteTableId,
  validateAwsSingleNodeRouteTableVpcId,
} from './deployment-aws-route-table-evidence.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set([
  'describeInternetGateways',
  'describeRouteTables',
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
const RESOURCE_KEY = 'network-default-ipv4-route';
const PROVIDER_TYPE = 'ec2-ipv4-route';
const VPC_KEY = 'network-vpc';
const INTERNET_GATEWAY_KEY = 'network-internet-gateway';
const ATTACHMENT_KEY = 'network-internet-gateway-attachment';
const ROUTE_TABLE_KEY = 'network-route-table';
const AUTHORITY_ERROR =
  'AWS single-node default IPv4 route observation authority does not match the exact managed derived-route contract.';

/** Exact durable authority cannot select this managed derived-route read mode. */
export class AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name = 'AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError';
    this.code =
      'AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_RESOURCE_OBSERVER_AUTHORITY';
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

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4RouteResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeDefaultIpv4RouteResourceObserver context',
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
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
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
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }
  return matches[0] ?? null;
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} expected @returns {void} */
function assertBindingBase(binding, authority, expected) {
  if (
    binding.resourceKey !== expected.resourceKey ||
    binding.capability.kind !== 'networking' ||
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
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
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
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }
}

/**
 * Re-prove both direct endpoints and the transitive VPC/attachment lineage.
 * Early unbound authority cannot select an untaggable provider relationship.
 * @param {Readonly<Record<string, any>>} authority - Revalidated V48 authority.
 * @returns {Readonly<Record<string, any>>|null}
 */
function assertDefaultRouteAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'default-ipv4-route' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'derived' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, [ATTACHMENT_KEY, ROUTE_TABLE_KEY]) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }
  const binding = authority.binding;
  const currentAction = authority.currentAction?.action ?? null;
  if (
    (binding !== null && currentAction?.action === 'create') ||
    (binding === null &&
      currentAction !== null &&
      currentAction.action !== 'create')
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }

  const vpcBinding = oneBinding(authority, VPC_KEY);
  const internetGatewayBinding = oneBinding(authority, INTERNET_GATEWAY_KEY);
  const attachmentBinding = oneBinding(authority, ATTACHMENT_KEY);
  const routeTableBinding = oneBinding(authority, ROUTE_TABLE_KEY);
  const hasAllDependencies =
    vpcBinding !== null &&
    internetGatewayBinding !== null &&
    attachmentBinding !== null &&
    routeTableBinding !== null;
  if (!hasAllDependencies) {
    if (binding !== null || currentAction?.action === 'create') {
      throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
    }
    return null;
  }

  assertBindingBase(vpcBinding, authority, {
    resourceKey: VPC_KEY,
    roleKind: 'vpc',
    ownershipMode: 'direct',
    providerType: 'ec2-vpc',
  });
  assertDependencyBindings(vpcBinding, []);
  assertBindingBase(internetGatewayBinding, authority, {
    resourceKey: INTERNET_GATEWAY_KEY,
    roleKind: 'internet-gateway',
    ownershipMode: 'direct',
    providerType: 'ec2-internet-gateway',
  });
  assertDependencyBindings(internetGatewayBinding, []);
  assertBindingBase(attachmentBinding, authority, {
    resourceKey: ATTACHMENT_KEY,
    roleKind: 'internet-gateway-attachment',
    ownershipMode: 'derived',
    providerType: 'ec2-internet-gateway-attachment',
  });
  assertDependencyBindings(attachmentBinding, [
    vpcBinding,
    internetGatewayBinding,
  ]);
  assertBindingBase(routeTableBinding, authority, {
    resourceKey: ROUTE_TABLE_KEY,
    roleKind: 'route-table',
    ownershipMode: 'direct',
    providerType: 'ec2-route-table',
  });
  assertDependencyBindings(routeTableBinding, [vpcBinding]);

  let vpcId;
  let internetGatewayId;
  let routeTableId;
  try {
    vpcId = validateAwsSingleNodeRouteTableVpcId(vpcBinding.providerResourceId);
    internetGatewayId = validateAwsSingleNodeInternetGatewayId(
      internetGatewayBinding.providerResourceId,
    );
    routeTableId = validateAwsSingleNodeRouteTableId(
      routeTableBinding.providerResourceId,
    );
  } catch {
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }
  if (
    attachmentBinding.providerResourceId !==
    getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      internetGatewayId,
      vpcId,
    )
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }
  const destinationCidrBlock =
    authority.providerSpec.capabilities.networking.egressCidr;
  const providerResourceId = getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
    destinationCidrBlock,
    internetGatewayId,
    routeTableId,
  );
  if (binding !== null) {
    assertBindingBase(binding, authority, {
      resourceKey: RESOURCE_KEY,
      roleKind: 'default-ipv4-route',
      ownershipMode: 'derived',
      providerType: PROVIDER_TYPE,
    });
    assertDependencyBindings(binding, [attachmentBinding, routeTableBinding]);
    if (binding.providerResourceId !== providerResourceId) {
      throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
    }
  }
  return deepFreeze({
    vpcBinding,
    internetGatewayBinding,
    attachmentBinding,
    routeTableBinding,
    vpcId,
    internetGatewayId,
    routeTableId,
    destinationCidrBlock,
    providerResourceId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} binding @returns {string} */
function historicalStateDigestValue(authority, binding) {
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
    action.capability.kind !== 'networking' ||
    action.capability.version !== 1 ||
    action.role.kind !== binding.role.kind ||
    action.role.version !== 1 ||
    action.management !== 'managed' ||
    action.ownershipMode !== 'direct' ||
    action.onDestroy !== 'purge' ||
    state === null ||
    state.providerType !== binding.providerType ||
    (state.providerResourceId !== null &&
      state.providerResourceId !== binding.providerResourceId) ||
    state.stateDigest?.algorithm !== 'sha256' ||
    typeof state.stateDigest.value !== 'string'
  ) {
    throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
  }
  return state.stateDigest.value;
}

/** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} binding @returns {Readonly<Record<string, any>>} */
function parentLocator(authority, binding) {
  return {
    capabilityKind: binding.capability.kind,
    roleKind: binding.role.kind,
    providerScopeId: authority.providerScope.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    resourceKey: binding.resourceKey,
  };
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
 * Bind one read-only default IPv4 route observer to an exact credential scope.
 * The caller owns the two-method EC2 read port.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeDefaultIpv4RouteResourceObserver(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4RouteResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeDefaultIpv4RouteResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeDefaultIpv4RouteResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4RouteResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeDefaultIpv4RouteResourceObserver client',
  );
  for (const method of CLIENT_KEYS) {
    if (typeof options.client[method] !== 'function') {
      throw new TypeError(
        `awsSingleNodeDefaultIpv4RouteResourceObserver client.${method} is required.`,
      );
    }
  }
  const client = Object.freeze({
    describeInternetGateways: options.client.describeInternetGateways,
    describeRouteTables: options.client.describeRouteTables,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeDefaultIpv4RouteResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeDefaultIpv4RouteResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeDefaultIpv4RouteResourceObserver waitForRetry must be a function.',
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
  async function readExactRouteTable(routeTableId) {
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
  async function readRouteTableDiscoveryPage(request) {
    let response;
    try {
      response = await client.describeRouteTables(request);
    } catch {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return decodeAwsSingleNodeRouteTableDiscoveryPage(response);
  }

  /** @param {string} internetGatewayId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExactInternetGateway(internetGatewayId) {
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

  const routeTableEvidence = createAwsSingleNodeRouteTableEvidenceKernel({
    readDiscoveryPage: readRouteTableDiscoveryPage,
    readExact: readExactRouteTable,
  });
  const internetGatewayEvidence =
    createAwsSingleNodeInternetGatewayEvidenceKernel({
      readDiscoveryPage: async (
        /** @type {Readonly<Record<string, any>>} */ request,
      ) => {
        let response;
        try {
          response = await client.describeInternetGateways(request);
        } catch {
          throw new AwsTaggedEc2EvidenceUnknownError();
        }
        return decodeAwsSingleNodeInternetGatewayDiscoveryPage(response);
      },
      readExact: readExactInternetGateway,
    });

  /** @param {Readonly<Record<string, any>>} authority @param {Readonly<Record<string, any>>} dependencies @returns {Promise<Readonly<Record<string, any>>>} */
  async function observeAttempt(authority, dependencies) {
    const routeTableLocator = parentLocator(
      authority,
      dependencies.routeTableBinding,
    );
    const routeTableTags = routeTableEvidence.ownershipTags({
      ...routeTableLocator,
      createdByActionId: dependencies.routeTableBinding.createdByActionId,
      ownershipNonce: dependencies.routeTableBinding.ownershipNonce,
      stateDigestValue: historicalStateDigestValue(
        authority,
        dependencies.routeTableBinding,
      ),
    });
    const gatewayLocator = parentLocator(
      authority,
      dependencies.internetGatewayBinding,
    );
    const gatewayTags = internetGatewayEvidence.ownershipTags({
      ...gatewayLocator,
      createdByActionId: dependencies.internetGatewayBinding.createdByActionId,
      ownershipNonce: dependencies.internetGatewayBinding.ownershipNonce,
      stateDigestValue: historicalStateDigestValue(
        authority,
        dependencies.internetGatewayBinding,
      ),
    });

    const isCurrentDelete = authority.currentAction?.action.action === 'delete';
    const reads = [
      routeTableEvidence.readExactSafely(dependencies.routeTableId),
    ];
    if (!isCurrentDelete) {
      reads.push(
        internetGatewayEvidence.readExactSafely(dependencies.internetGatewayId),
      );
    }
    const [routeTableResult, gatewayResult] = await Promise.allSettled(reads);
    const rejected = [];
    for (const result of [routeTableResult, gatewayResult]) {
      if (result?.status === 'rejected') rejected.push(result.reason);
    }
    if (
      rejected.some(
        (error) => error instanceof AwsTaggedEc2EvidenceConflictError,
      )
    ) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    if (rejected.length !== 0) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (
      routeTableResult.status !== 'fulfilled' ||
      (!isCurrentDelete && gatewayResult?.status !== 'fulfilled')
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }

    if (routeTableResult.value === null) {
      const discovered =
        await routeTableEvidence.discoverMany(routeTableLocator);
      if (discovered.length === 0) {
        return Object.freeze({ state: 'parent-absent' });
      }
      if (discovered.length > 1) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      const candidateId = routeTableEvidence.resourceId(discovered[0]);
      if (candidateId !== dependencies.routeTableId) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      throw new AwsTaggedEc2EvidenceTransientError();
    }
    const routeTable = routeTableResult.value;
    const routeTableIdentity =
      decodeAwsSingleNodeRouteTableIdentity(routeTable);
    if (
      routeTableIdentity.ownerId !== providerScope.accountId ||
      routeTableIdentity.vpcId !== dependencies.vpcId
    ) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    routeTableEvidence.validateTags(routeTable.Tags, routeTableTags, false);
    const route = decodeAwsSingleNodeDefaultIpv4RouteEvidence(routeTable, {
      destinationCidrBlock: dependencies.destinationCidrBlock,
      internetGatewayId: dependencies.internetGatewayId,
      routeTableId: dependencies.routeTableId,
      vpcCidr: authority.providerSpec.capabilities.networking.vpcCidr,
      allowSubnetAssociation: authority.binding !== null,
    });

    if (!isCurrentDelete) {
      if (gatewayResult === undefined || gatewayResult.status !== 'fulfilled') {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      const gateway = gatewayResult.value;
      if (gateway === null) {
        throw new AwsTaggedEc2EvidenceTransientError();
      }
      internetGatewayEvidence.validateTags(gateway.Tags, gatewayTags, false);
      const gatewayState = decodeAwsSingleNodeDefaultIpv4RouteGatewayEvidence(
        gateway,
        {
          internetGatewayId: dependencies.internetGatewayId,
          ownerId: providerScope.accountId,
          vpcId: dependencies.vpcId,
        },
      );
      if (gatewayState.attachment !== 'available') {
        throw new AwsTaggedEc2EvidenceTransientError();
      }
    }
    if (route.presence === 'absent') {
      return Object.freeze({ state: 'absent' });
    }
    return Object.freeze({
      state: 'present',
      observedDigest: route.observedDigest,
    });
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError();
    }
    const dependencies = assertDefaultRouteAuthority(authority);
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
          if (isUnboundNoAction) {
            return conflictObservation(dependencies.providerResourceId);
          }
          const desiredDigest =
            authority.currentAction?.action.after?.stateDigest ?? null;
          if (
            isCurrentCreate &&
            !sameJson(evidence.observedDigest, desiredDigest)
          ) {
            if (attempt === maxAttempts) return unknownObservation();
          } else {
            return verifiedObservation(
              dependencies.providerResourceId,
              evidence.observedDigest,
            );
          }
        } else {
          allAttemptsCleanAbsent = false;
          throw new AwsTaggedEc2EvidenceUnknownError();
        }
      } catch (error) {
        allAttemptsCleanAbsent = false;
        if (error instanceof AwsTaggedEc2EvidenceConflictError) {
          return conflictObservation(dependencies.providerResourceId);
        }
        if (
          !(error instanceof AwsTaggedEc2EvidenceUnknownError) &&
          !(error instanceof AwsTaggedEc2EvidenceTransientError)
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
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_DEFAULT_IPV4_ROUTE_MAX_ATTEMPTS,
  AwsSingleNodeDefaultIpv4RouteResourceObserverAuthorityError,
  createAwsSingleNodeDefaultIpv4RouteResourceObserver,
};
