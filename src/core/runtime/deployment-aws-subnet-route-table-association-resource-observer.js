/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable observer contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { getAwsSingleNodeDefaultIpv4RouteProviderResourceId } from './deployment-aws-default-ipv4-route-resource.js';
import { getAwsSingleNodeInternetGatewayAttachmentProviderResourceId } from './deployment-aws-internet-gateway-attachment-resource.js';
import { createAwsSingleNodeResourceObservationAuthority } from './deployment-aws-resource-observation-authority.js';
import { validateAwsSingleNodeResourceObservation } from './deployment-aws-resource-observation.js';
import {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES,
  getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId,
  getAwsSingleNodeSubnetRouteTableAssociationStateDigest,
} from './deployment-aws-subnet-route-table-association-resource.js';
import {
  AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError,
  AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError,
  decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage,
  decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse,
  decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse,
  reconcileAwsSingleNodeSubnetRouteTableAssociationViews,
  validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId,
  validateAwsSingleNodeSubnetRouteTableAssociationSubnetId,
  validateAwsSingleNodeSubnetRouteTableAssociationVpcId,
} from './deployment-aws-subnet-route-table-association-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export {
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS,
};

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const CLIENT_KEYS = new Set(['describeRouteTables', 'describeSubnets']);
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
const RESOURCE_KEY = 'network-subnet-route-table-association';
const PROVIDER_TYPE = 'ec2-subnet-route-table-association';
const DEPENDENCY_KEYS = Object.freeze([
  'network-subnet',
  'network-route-table',
  'network-default-ipv4-route',
]);
const VPC_RESOURCE_KEY = 'network-vpc';
const INTERNET_GATEWAY_RESOURCE_KEY = 'network-internet-gateway';
const ATTACHMENT_RESOURCE_KEY = 'network-internet-gateway-attachment';
const SUBNET_RESOURCE_KEY = 'network-subnet';
const ROUTE_TABLE_RESOURCE_KEY = 'network-route-table';
const DEFAULT_ROUTE_RESOURCE_KEY = 'network-default-ipv4-route';
const AUTHORITY_ERROR =
  'AWS single-node subnet route-table association observation authority does not match the exact derived relationship.';

/** Exact durable authority cannot select this derived relationship read mode. */
export class AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError extends Error {
  constructor() {
    super(AUTHORITY_ERROR);
    this.name =
      'AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError';
    this.code =
      'AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_RESOURCE_OBSERVER_AUTHORITY';
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

/** @param {unknown} authority @returns {Readonly<Record<string, any>>} */
function revalidateAuthority(authority) {
  if (!isPlainObject(authority)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociationResourceObserver context must be an object.',
    );
  }
  assertExactKeys(
    authority,
    AUTHORITY_KEYS,
    'awsSingleNodeSubnetRouteTableAssociationResourceObserver context',
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
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
  if (
    !sameJson(authority.binding, canonical.binding) ||
    !sameJson(authority.currentAction, canonical.currentAction)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
  return canonical;
}

/** @param {Readonly<Record<string, any>>} binding @param {Readonly<Record<string, any>>} authority @param {string} resourceKey @param {string} providerType @param {string} roleKind @param {'direct'|'derived'} ownershipMode @param {readonly string[]} dependencyKeys @returns {void} */
function assertBindingContract(
  binding,
  authority,
  resourceKey,
  providerType,
  roleKind,
  ownershipMode,
  dependencyKeys,
) {
  const expectedDependencies = dependencyKeys
    .map((dependencyKey) => {
      const dependency = authority.head.resourceBindings.find(
        (/** @type {Readonly<Record<string, any>>} */ candidate) =>
          candidate.resourceKey === dependencyKey,
      );
      if (dependency === undefined) {
        throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
      }
      return {
        bindingId: dependency.bindingId,
        resourceKey: dependencyKey,
      };
    })
    .sort((left, right) =>
      left.resourceKey < right.resourceKey
        ? -1
        : left.resourceKey > right.resourceKey
          ? 1
          : 0,
    );
  if (
    binding.resourceKey !== resourceKey ||
    binding.capability.kind !== 'networking' ||
    binding.capability.version !== 1 ||
    binding.role.kind !== roleKind ||
    binding.role.version !== 1 ||
    binding.management !== 'managed' ||
    binding.ownershipMode !== ownershipMode ||
    binding.onDestroy !== 'purge' ||
    binding.providerType !== providerType ||
    binding.providerScopeId !== authority.providerScope.providerScopeId ||
    binding.deploymentInstanceId !== authority.deploymentInstanceId ||
    binding.incarnationId !== authority.incarnationId ||
    !sameJson(binding.dependencyBindings, expectedDependencies)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, any>>|null} */
function assertRelationshipAuthority(authority) {
  const target = authority.target;
  if (
    target.resourceKey !== RESOURCE_KEY ||
    target.capability.kind !== 'networking' ||
    target.capability.version !== 1 ||
    target.role.kind !== 'subnet-route-table-association' ||
    target.role.version !== 1 ||
    target.management !== 'managed' ||
    target.ownershipMode !== 'derived' ||
    target.onDestroy !== 'purge' ||
    !sameJson(target.dependsOn, DEPENDENCY_KEYS) ||
    target.target.providerType !== PROVIDER_TYPE
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }

  const bindingByKey = new Map(
    authority.head.resourceBindings.map(
      (/** @type {Readonly<Record<string, any>>} */ binding) => [
        binding.resourceKey,
        binding,
      ],
    ),
  );
  const subnetBinding = bindingByKey.get(SUBNET_RESOURCE_KEY) ?? null;
  const routeTableBinding = bindingByKey.get(ROUTE_TABLE_RESOURCE_KEY) ?? null;
  const defaultRouteBinding =
    bindingByKey.get(DEFAULT_ROUTE_RESOURCE_KEY) ?? null;
  const ready =
    subnetBinding !== null &&
    routeTableBinding !== null &&
    defaultRouteBinding !== null;
  if (!ready) {
    if (authority.binding !== null || authority.currentAction !== null) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
    }
    return null;
  }

  const vpcBinding = bindingByKey.get(VPC_RESOURCE_KEY);
  const internetGatewayBinding = bindingByKey.get(
    INTERNET_GATEWAY_RESOURCE_KEY,
  );
  const attachmentBinding = bindingByKey.get(ATTACHMENT_RESOURCE_KEY);
  if (
    vpcBinding === undefined ||
    internetGatewayBinding === undefined ||
    attachmentBinding === undefined
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
  assertBindingContract(
    vpcBinding,
    authority,
    VPC_RESOURCE_KEY,
    'ec2-vpc',
    'vpc',
    'direct',
    [],
  );
  assertBindingContract(
    internetGatewayBinding,
    authority,
    INTERNET_GATEWAY_RESOURCE_KEY,
    'ec2-internet-gateway',
    'internet-gateway',
    'direct',
    [],
  );
  assertBindingContract(
    attachmentBinding,
    authority,
    ATTACHMENT_RESOURCE_KEY,
    'ec2-internet-gateway-attachment',
    'internet-gateway-attachment',
    'derived',
    [VPC_RESOURCE_KEY, INTERNET_GATEWAY_RESOURCE_KEY],
  );
  assertBindingContract(
    subnetBinding,
    authority,
    SUBNET_RESOURCE_KEY,
    'ec2-subnet',
    'subnet',
    'direct',
    [VPC_RESOURCE_KEY],
  );
  assertBindingContract(
    routeTableBinding,
    authority,
    ROUTE_TABLE_RESOURCE_KEY,
    'ec2-route-table',
    'route-table',
    'direct',
    [VPC_RESOURCE_KEY],
  );
  assertBindingContract(
    defaultRouteBinding,
    authority,
    DEFAULT_ROUTE_RESOURCE_KEY,
    'ec2-ipv4-route',
    'default-ipv4-route',
    'derived',
    [ATTACHMENT_RESOURCE_KEY, ROUTE_TABLE_RESOURCE_KEY],
  );

  let subnetId;
  let routeTableId;
  let vpcId;
  try {
    subnetId = validateAwsSingleNodeSubnetRouteTableAssociationSubnetId(
      subnetBinding.providerResourceId,
    );
    routeTableId = validateAwsSingleNodeSubnetRouteTableAssociationRouteTableId(
      routeTableBinding.providerResourceId,
    );
    vpcId = validateAwsSingleNodeSubnetRouteTableAssociationVpcId(
      vpcBinding.providerResourceId,
    );
  } catch {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
  const expectedAttachmentId =
    getAwsSingleNodeInternetGatewayAttachmentProviderResourceId(
      internetGatewayBinding.providerResourceId,
      vpcId,
    );
  const expectedDefaultRouteId =
    getAwsSingleNodeDefaultIpv4RouteProviderResourceId(
      authority.providerSpec.capabilities.networking.egressCidr,
      internetGatewayBinding.providerResourceId,
      routeTableId,
    );
  const providerResourceId =
    getAwsSingleNodeSubnetRouteTableAssociationProviderResourceId(
      routeTableId,
      subnetId,
    );
  if (
    attachmentBinding.providerResourceId !== expectedAttachmentId ||
    defaultRouteBinding.providerResourceId !== expectedDefaultRouteId ||
    (authority.binding !== null &&
      authority.binding.providerResourceId !== providerResourceId)
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
  if (authority.binding !== null) {
    assertBindingContract(
      authority.binding,
      authority,
      RESOURCE_KEY,
      PROVIDER_TYPE,
      'subnet-route-table-association',
      'derived',
      DEPENDENCY_KEYS,
    );
  }
  if (
    (authority.binding !== null &&
      authority.currentAction?.action.action === 'create') ||
    (authority.binding === null &&
      authority.currentAction !== null &&
      authority.currentAction.action.action !== 'create')
  ) {
    throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
  }
  return deepFreeze({
    providerResourceId,
    routeTableId,
    subnetId,
    vpcId,
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
 * Bind the read-only derived relationship observer to one exact credential
 * scope. The provider-allocated association ID remains raw evidence only.
 * @param {unknown} options - Exact read dependencies, scope, and retry policy.
 * @returns {Readonly<{observe: (context: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeSubnetRouteTableAssociationResourceObserver(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociationResourceObserver options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeSubnetRouteTableAssociationResourceObserver options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeSubnetRouteTableAssociationResourceObserver options',
  );
  if (!isPlainObject(options.client)) {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociationResourceObserver client must be an object.',
    );
  }
  assertExactKeys(
    options.client,
    CLIENT_KEYS,
    'awsSingleNodeSubnetRouteTableAssociationResourceObserver client',
  );
  if (typeof options.client.describeRouteTables !== 'function') {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociationResourceObserver client.describeRouteTables is required.',
    );
  }
  if (typeof options.client.describeSubnets !== 'function') {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociationResourceObserver client.describeSubnets is required.',
    );
  }
  const client = Object.freeze({
    describeRouteTables: options.client.describeRouteTables,
    describeSubnets: options.client.describeSubnets,
  });
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeSubnetRouteTableAssociationResourceObserver providerScope',
  );
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeSubnetRouteTableAssociationResourceObserver maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeSubnetRouteTableAssociationResourceObserver waitForRetry must be a function.',
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

  /** @param {Readonly<Record<string, any>>} endpoints @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readSubnet(endpoints) {
    let response;
    try {
      response = await client.describeSubnets(
        deepFreeze({ SubnetIds: [endpoints.subnetId] }),
      );
    } catch (error) {
      if (subnetNotFound(error)) return null;
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    return decodeAwsSingleNodeSubnetRouteTableAssociationSubnetResponse(
      response,
      endpoints.subnetId,
    );
  }

  /** @param {Readonly<Record<string, any>>} endpoints @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readRouteTable(endpoints) {
    let response;
    try {
      response = await client.describeRouteTables(
        deepFreeze({ RouteTableIds: [endpoints.routeTableId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidRouteTableID.NotFound')) return null;
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    return decodeAwsSingleNodeSubnetRouteTableAssociationRouteTableResponse(
      response,
      endpoints.routeTableId,
      endpoints.subnetId,
    );
  }

  /** @param {Readonly<Record<string, any>>} endpoints @param {boolean} isCurrentDelete @returns {Promise<ReadonlyArray<Readonly<Record<string, any>>>>} */
  async function discoverSlot(endpoints, isCurrentDelete) {
    const associations = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <=
      AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeRouteTables(
          deepFreeze({
            Filters: [
              {
                Name: 'association.subnet-id',
                Values: [endpoints.subnetId],
              },
            ],
            MaxResults:
              AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
      }
      const observed =
        decodeAwsSingleNodeSubnetRouteTableAssociationDiscoveryPage(
          response,
          endpoints.subnetId,
        );
      if (!isCurrentDelete && observed.otherAssociations.length > 0) {
        throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
      }
      for (const association of observed.associations) {
        if (
          association.ownerId !== providerScope.accountId ||
          association.vpcId !== endpoints.vpcId ||
          association.routeTableId !== endpoints.routeTableId ||
          association.state === 'failed'
        ) {
          throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
        }
        if (associations.has(association.associationId)) {
          throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
        }
        associations.set(association.associationId, association);
        if (associations.size > 1) {
          throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
        }
      }
      if (observed.nextToken === null) break;
      if (
        page ===
          AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return Object.freeze([...associations.values()]);
  }

  /** @param {Readonly<Record<string, any>>} endpoints @param {boolean} isCurrentDelete @returns {Promise<Readonly<Record<string, any>>>} */
  async function readLogicalState(endpoints, isCurrentDelete) {
    const [subnetResult, routeTableResult, slotResult] =
      await Promise.allSettled([
        readSubnet(endpoints),
        readRouteTable(endpoints),
        discoverSlot(endpoints, isCurrentDelete),
      ]);
    const errors = [subnetResult, routeTableResult, slotResult]
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason);
    const subnet =
      subnetResult.status === 'fulfilled' ? subnetResult.value : null;
    const routeTable =
      routeTableResult.status === 'fulfilled' ? routeTableResult.value : null;
    const slotAssociations =
      slotResult.status === 'fulfilled' ? slotResult.value : [];
    if (
      (subnet !== null &&
        (subnet.ownerId !== providerScope.accountId ||
          subnet.vpcId !== endpoints.vpcId)) ||
      (routeTable !== null &&
        (routeTable.ownerId !== providerScope.accountId ||
          routeTable.vpcId !== endpoints.vpcId ||
          (!isCurrentDelete && routeTable.otherAssociations.length > 0))) ||
      slotAssociations.some(
        (association) =>
          association.ownerId !== providerScope.accountId ||
          association.vpcId !== endpoints.vpcId ||
          association.routeTableId !== endpoints.routeTableId ||
          association.state === 'failed',
      ) ||
      routeTable?.association?.state === 'failed' ||
      (!isCurrentDelete &&
        subnet !== null &&
        (subnet.state === 'failed' ||
          subnet.state === 'failed-insufficient-capacity'))
    ) {
      errors.push(
        new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError(),
      );
    } else if (
      !isCurrentDelete &&
      subnet !== null &&
      subnet.state !== 'available'
    ) {
      errors.push(
        new AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError(),
      );
    }
    if (
      errors.some(
        (error) =>
          error instanceof
          AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError,
      )
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError();
    }
    if (
      errors.some(
        (error) =>
          error instanceof
          AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError,
      )
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    if (
      errors.some(
        (error) =>
          error instanceof
          AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError,
      )
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError();
    }
    if (errors.length > 0) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    if (
      subnetResult.status !== 'fulfilled' ||
      routeTableResult.status !== 'fulfilled' ||
      slotResult.status !== 'fulfilled'
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError();
    }
    const logical = reconcileAwsSingleNodeSubnetRouteTableAssociationViews({
      exactAssociation: routeTable?.association ?? null,
      slotAssociations,
      routeTableId: endpoints.routeTableId,
    });
    if (
      logical.state === 'present' &&
      (subnet === null || routeTable === null)
    ) {
      throw new AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError();
    }
    return logical;
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function observe(value) {
    const authority = revalidateAuthority(value);
    if (!sameJson(authority.providerScope, providerScope)) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
    }
    const endpoints = assertRelationshipAuthority(authority);
    if (endpoints === null) return unknownObservation();
    const expectedDigest =
      getAwsSingleNodeSubnetRouteTableAssociationStateDigest(
        authority.providerSpec,
      );
    if (!sameJson(authority.target.target.stateDigest, expectedDigest)) {
      throw new AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError();
    }
    const isCurrentCreate =
      authority.binding === null &&
      authority.currentAction?.action.action === 'create';
    const isCurrentDelete = authority.currentAction?.action.action === 'delete';
    let allAttemptsCleanEmpty = true;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const logical = await readLogicalState(endpoints, isCurrentDelete);
        if (logical.state === 'present') {
          if (authority.binding === null && !isCurrentCreate) {
            return conflictObservation(endpoints.providerResourceId);
          }
          return verifiedObservation(
            endpoints.providerResourceId,
            expectedDigest,
          );
        }
        if (attempt === maxAttempts) {
          return !isCurrentCreate && allAttemptsCleanEmpty
            ? absentObservation()
            : unknownObservation();
        }
      } catch (error) {
        allAttemptsCleanEmpty = false;
        if (
          error instanceof
          AwsSingleNodeSubnetRouteTableAssociationEvidenceConflictError
        ) {
          return conflictObservation(endpoints.providerResourceId);
        }
        if (
          !(
            error instanceof
            AwsSingleNodeSubnetRouteTableAssociationEvidenceUnknownError
          ) &&
          !(
            error instanceof
            AwsSingleNodeSubnetRouteTableAssociationEvidenceTransientError
          )
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
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_ROUTE_TABLE_ASSOCIATION_MAX_ATTEMPTS,
  AwsSingleNodeSubnetRouteTableAssociationResourceObserverAuthorityError,
  createAwsSingleNodeSubnetRouteTableAssociationResourceObserver,
};
