/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider routing contracts are clearer than repeated parser-specific expansions. */

import { createAwsSingleNodeDefaultIpv4RouteResource } from './deployment-aws-default-ipv4-route-resource.js';
import { createAwsSingleNodeInstanceProfileResource } from './deployment-aws-instance-profile-resource.js';
import { createAwsSingleNodeInstanceProfileRoleAssociationResource } from './deployment-aws-instance-profile-role-association-resource.js';
import { createAwsSingleNodeInternetGatewayResource } from './deployment-aws-internet-gateway-resource.js';
import { createAwsSingleNodeInternetGatewayAttachmentResource } from './deployment-aws-internet-gateway-attachment-resource.js';
import { createAwsSingleNodeManagedArtifactResource } from './deployment-aws-managed-artifact-resource.js';
import { createAwsSingleNodeNodeResource } from './deployment-aws-node-resource.js';
import { createAwsSingleNodeRouteTableResource } from './deployment-aws-route-table-resource.js';
import { createAwsSingleNodeRuntimeRoleResource } from './deployment-aws-runtime-role-resource.js';
import { createAwsSingleNodeRuntimeRolePolicyResource } from './deployment-aws-runtime-role-policy-resource.js';
import { createAwsSingleNodeSecurityGroupResource } from './deployment-aws-security-group-resource.js';
import { createAwsSingleNodeSubnetResource } from './deployment-aws-subnet-resource.js';
import { createAwsSingleNodeSubnetRouteTableAssociationResource } from './deployment-aws-subnet-route-table-association-resource.js';
import { createAwsSingleNodeVolumeResource } from './deployment-aws-volume-resource.js';
import { createAwsSingleNodeVolumeAttachmentResource } from './deployment-aws-volume-attachment-resource.js';
import { createAwsSingleNodeVpcResource } from './deployment-aws-vpc-resource.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { getAwsSingleNodeResourceApplyOrder } from './deployment-resource-graph.js';

export const AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED =
  'AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED';

const FACTORY_KEYS = new Set([
  'providerScope',
  'clients',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['providerScope', 'clients']);
const CLIENT_KEYS = new Set([
  'managedArtifact',
  'volume',
  'network',
  'runtimeIdentity',
  'node',
  'volumeAttachment',
]);
/** @type {Readonly<Record<string, readonly string[]>>} */
const CLIENT_METHODS = Object.freeze({
  managedArtifact: Object.freeze([
    'copyObject',
    'close',
    'headObject',
    'listObjectVersions',
    'deleteObjectVersion',
  ]),
  volume: Object.freeze(['close', 'createVolume', 'describeVolumes']),
  network: Object.freeze([
    'associateRouteTable',
    'attachInternetGateway',
    'createInternetGateway',
    'createRoute',
    'createRouteTable',
    'createSecurityGroup',
    'createSubnet',
    'createVpc',
    'close',
    'deleteInternetGateway',
    'deleteRoute',
    'deleteRouteTable',
    'deleteSecurityGroup',
    'deleteSubnet',
    'deleteVpc',
    'describeInternetGateways',
    'describeRouteTables',
    'describeSecurityGroups',
    'describeSubnets',
    'describeVpcAttribute',
    'describeVpcs',
    'detachInternetGateway',
    'disassociateRouteTable',
  ]),
  runtimeIdentity: Object.freeze([
    'addRoleToInstanceProfile',
    'createInstanceProfile',
    'createRole',
    'close',
    'deleteInstanceProfile',
    'deleteRole',
    'deleteRolePolicy',
    'describeInstances',
    'getInstanceProfile',
    'getRole',
    'getRolePolicy',
    'listAttachedRolePolicies',
    'listInstanceProfilesForRole',
    'listInstanceProfileTags',
    'listRolePolicies',
    'listRoleTags',
    'putRolePolicy',
    'removeRoleFromInstanceProfile',
  ]),
  node: Object.freeze([
    'close',
    'runInstances',
    'startInstances',
    'describeInstances',
    'describeInstanceAttribute',
    'describeInstanceCreditSpecifications',
    'describeVolumes',
    'terminateInstances',
  ]),
  volumeAttachment: Object.freeze([
    'attachVolume',
    'close',
    'describeInstances',
    'describeVolumes',
    'detachVolume',
    'modifyInstanceAttribute',
  ]),
});
const RESOURCE_PORT_KEYS = new Set(['executeAction', 'verifySettlement']);
const ROUTER_MAX_ATTEMPTS = 10;
const ROUTER_MIN_ATTEMPTS = 2;
const ROUTE_COVERAGE_ERROR =
  'AWS single-node resource router coverage is invalid.';

/** A controller action cannot be routed to one exact graph resource. */
export class AwsSingleNodeResourceRouteUnsupportedError extends Error {
  constructor() {
    super('AWS single-node resource action route is unsupported.');
    this.name = 'AwsSingleNodeResourceRouteUnsupportedError';
    this.code = AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED;
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

/** @param {unknown} value @param {string} clientKey @param {readonly string[]} methods @returns {Record<string, any>} */
function validateClient(value, clientKey, methods) {
  const path = `awsSingleNodeResourceRouter clients.${clientKey}`;
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  assertExactKeys(value, new Set(methods), path);
  for (const method of methods) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${path}.${method} is required.`);
    }
  }
  return value;
}

/** @param {unknown} value @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function validateResource(value, resourceKey) {
  const path = `awsSingleNodeResourceRouter resources.${resourceKey}`;
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  assertExactKeys(value, RESOURCE_PORT_KEYS, path);
  for (const method of RESOURCE_PORT_KEYS) {
    if (typeof value[method] !== 'function') {
      throw new TypeError(`${path}.${method} must be a function.`);
    }
  }
  return value;
}

/** @param {Map<string, Readonly<Record<string, any>>>} routes @returns {void} */
function assertRouteCoverage(routes) {
  const applyOrder = getAwsSingleNodeResourceApplyOrder();
  const routeKeys = [...routes.keys()];
  if (
    routeKeys.length !== applyOrder.length ||
    routeKeys.some((resourceKey, index) => resourceKey !== applyOrder[index])
  ) {
    throw new Error(ROUTE_COVERAGE_ERROR);
  }
}

/** @param {unknown} context @param {Map<string, Readonly<Record<string, any>>>} routes @returns {Readonly<Record<string, any>>} */
function resolveRoute(context, routes) {
  try {
    if (!isPlainObject(context) || !Object.hasOwn(context, 'action')) {
      throw new AwsSingleNodeResourceRouteUnsupportedError();
    }
    const action = context.action;
    if (!isPlainObject(action) || !Object.hasOwn(action, 'resourceKey')) {
      throw new AwsSingleNodeResourceRouteUnsupportedError();
    }
    const resourceKey = action.resourceKey;
    if (typeof resourceKey !== 'string') {
      throw new AwsSingleNodeResourceRouteUnsupportedError();
    }
    const route = routes.get(resourceKey);
    if (route === undefined) {
      throw new AwsSingleNodeResourceRouteUnsupportedError();
    }
    return route;
  } catch {
    throw new AwsSingleNodeResourceRouteUnsupportedError();
  }
}

/**
 * Compose the complete fixed AWS single-node mutation surface. The caller
 * retains ownership of every narrow client and closes them outside the router.
 * @param {unknown} options - Exact provider scope, clients, and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>}
 */
export function createAwsSingleNodeResourceRouter(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeResourceRouter options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    FACTORY_KEYS,
    'awsSingleNodeResourceRouter options',
  );
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeResourceRouter options',
  );
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeResourceRouter providerScope',
  );
  if (!isPlainObject(options.clients)) {
    throw new TypeError(
      'awsSingleNodeResourceRouter clients must be an object.',
    );
  }
  assertExactKeys(
    options.clients,
    CLIENT_KEYS,
    'awsSingleNodeResourceRouter clients',
  );
  /** @type {Record<string, Record<string, any>>} */
  const clients = {};
  for (const clientKey of CLIENT_KEYS) {
    clients[clientKey] = validateClient(
      options.clients[clientKey],
      clientKey,
      CLIENT_METHODS[clientKey],
    );
  }
  const maxAttempts = Object.hasOwn(options, 'maxAttempts')
    ? options.maxAttempts
    : undefined;
  const waitForRetry = Object.hasOwn(options, 'waitForRetry')
    ? options.waitForRetry
    : undefined;
  if (
    maxAttempts !== undefined &&
    (!Number.isSafeInteger(maxAttempts) ||
      maxAttempts < ROUTER_MIN_ATTEMPTS ||
      maxAttempts > ROUTER_MAX_ATTEMPTS)
  ) {
    throw new TypeError(
      `awsSingleNodeResourceRouter maxAttempts must be an integer from ${ROUTER_MIN_ATTEMPTS} through ${ROUTER_MAX_ATTEMPTS}.`,
    );
  }
  if (waitForRetry !== undefined && typeof waitForRetry !== 'function') {
    throw new TypeError(
      'awsSingleNodeResourceRouter waitForRetry must be a function.',
    );
  }

  const retryOptions = {
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(waitForRetry === undefined ? {} : { waitForRetry }),
  };
  const artifact = createAwsSingleNodeManagedArtifactResource({
    client: clients.managedArtifact,
    providerScope,
    ...retryOptions,
  });
  const volume = createAwsSingleNodeVolumeResource({
    client: clients.volume,
    providerScope,
    ...retryOptions,
  });
  const vpc = createAwsSingleNodeVpcResource({
    client: clients.network,
    providerScope,
    ...retryOptions,
  });
  const internetGateway = createAwsSingleNodeInternetGatewayResource({
    client: clients.network,
    providerScope,
    ...retryOptions,
  });
  const internetGatewayAttachment =
    createAwsSingleNodeInternetGatewayAttachmentResource({
      client: clients.network,
      providerScope,
      ...retryOptions,
    });
  const subnet = createAwsSingleNodeSubnetResource({
    client: clients.network,
    providerScope,
    ...retryOptions,
  });
  const routeTable = createAwsSingleNodeRouteTableResource({
    client: clients.network,
    providerScope,
    ...retryOptions,
  });
  const defaultIpv4Route = createAwsSingleNodeDefaultIpv4RouteResource({
    client: clients.network,
    providerScope,
    ...retryOptions,
  });
  const subnetRouteTableAssociation =
    createAwsSingleNodeSubnetRouteTableAssociationResource({
      client: clients.network,
      providerScope,
      ...retryOptions,
    });
  const securityGroup = createAwsSingleNodeSecurityGroupResource({
    client: clients.network,
    providerScope,
    ...retryOptions,
  });
  const runtimeRole = createAwsSingleNodeRuntimeRoleResource({
    client: clients.runtimeIdentity,
    providerScope,
    ...retryOptions,
  });
  const runtimeRolePolicy = createAwsSingleNodeRuntimeRolePolicyResource({
    client: clients.runtimeIdentity,
    providerScope,
    ...retryOptions,
  });
  const runtimeIdentity = createAwsSingleNodeInstanceProfileResource({
    client: clients.runtimeIdentity,
    providerScope,
    ...retryOptions,
  });
  const runtimeIdentityRoleAssociation =
    createAwsSingleNodeInstanceProfileRoleAssociationResource({
      client: clients.runtimeIdentity,
      providerScope,
      ...retryOptions,
    });
  const substrate = createAwsSingleNodeNodeResource({
    client: clients.node,
    providerScope,
    ...retryOptions,
  });
  const volumeAttachment = createAwsSingleNodeVolumeAttachmentResource({
    client: clients.volumeAttachment,
    providerScope,
    ...retryOptions,
  });

  for (const [resourceKey, resource] of Object.entries({
    artifact,
    volume,
    vpc,
    internetGateway,
    internetGatewayAttachment,
    subnet,
    routeTable,
    defaultIpv4Route,
    subnetRouteTableAssociation,
    securityGroup,
    runtimeRole,
    runtimeRolePolicy,
    runtimeIdentity,
    runtimeIdentityRoleAssociation,
    substrate,
    volumeAttachment,
  })) {
    validateResource(resource, resourceKey);
  }

  const routes = new Map([
    ['artifact', artifact],
    ['application-state', volume],
    ['control-state', volume],
    ['network-vpc', vpc],
    ['network-internet-gateway', internetGateway],
    ['network-internet-gateway-attachment', internetGatewayAttachment],
    ['network-subnet', subnet],
    ['network-route-table', routeTable],
    ['network-default-ipv4-route', defaultIpv4Route],
    ['network-subnet-route-table-association', subnetRouteTableAssociation],
    ['network-security-group', securityGroup],
    ['runtime-role', runtimeRole],
    ['runtime-role-policy', runtimeRolePolicy],
    ['runtime-identity', runtimeIdentity],
    ['runtime-identity-role-association', runtimeIdentityRoleAssociation],
    ['substrate', substrate],
    ['application-state-attachment', volumeAttachment],
    ['control-state-attachment', volumeAttachment],
  ]);
  assertRouteCoverage(routes);

  /** @param {unknown} context @returns {Promise<void>} */
  function executeAction(context) {
    return resolveRoute(context, routes).executeAction(context);
  }

  /** @param {unknown} context @returns {Promise<Record<string, any>>} */
  function verifySettlement(context) {
    return resolveRoute(context, routes).verifySettlement(context);
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_RESOURCE_ROUTE_UNSUPPORTED,
  AwsSingleNodeResourceRouteUnsupportedError,
  createAwsSingleNodeResourceRouter,
};
