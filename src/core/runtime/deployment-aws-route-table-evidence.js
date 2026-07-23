/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { isIPv4 } from 'node:net';

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';

export const AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-route-table-state:v1';
export const AWS_SINGLE_NODE_ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_ROUTE_TABLE_VPC_ID_PATTERN =
  /^vpc-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_ROUTE_TABLE_MAX_TAGS = 50;
export const AWS_SINGLE_NODE_ROUTE_TABLE_BASE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-route-table',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const ROUTE_TABLE_ASSOCIATION_ID_PATTERN = /^rtbassoc-[0-9a-f]{8,32}$/;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/;
const VIRTUAL_PRIVATE_GATEWAY_ID_PATTERN = /^vgw-[0-9a-f]{8,32}$/;
const GATEWAY_ASSOCIATION_ID_PATTERN = /^(?:igw|vgw)-[0-9a-f]{8,32}$/;
const ROUTE_ASSOCIATION_STATES = new Set([
  'associating',
  'associated',
  'disassociating',
  'disassociated',
  'failed',
]);
const ROUTE_STATES = new Set(['active', 'blackhole']);
const ROUTE_ORIGINS = new Set([
  'Advertisement',
  'CreateRoute',
  'CreateRouteTable',
  'EnableVgwRoutePropagation',
]);
const ROUTE_DESTINATION_KEYS = Object.freeze([
  'DestinationCidrBlock',
  'DestinationIpv6CidrBlock',
  'DestinationPrefixListId',
]);
const ROUTE_TARGET_KEYS = Object.freeze([
  'CarrierGatewayId',
  'CoreNetworkArn',
  'EgressOnlyInternetGatewayId',
  'GatewayId',
  'InstanceId',
  'IpAddress',
  'LocalGatewayId',
  'NatGatewayId',
  'NetworkInterfaceId',
  'OdbNetworkArn',
  'TransitGatewayId',
  'VpcPeeringConnectionId',
]);
const EVIDENCE_FACTORY_KEYS = new Set(['readDiscoveryPage', 'readExact']);
const STATE_DESCRIPTOR_KEYS = new Set([
  'localIpv4Route',
  'main',
  'propagatingVirtualGateways',
  'onDestroy',
]);
const LOCAL_ROUTE_KEYS = new Set([
  'destinationCidrBlock',
  'gatewayId',
  'origin',
  'state',
]);
const ACTUAL_STATE_OPTIONS_KEYS = new Set(['allowDescendants']);

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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @returns {boolean} */
function isCanonicalIpv4Cidr(value) {
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (
    parts.length !== 2 ||
    !isIPv4(parts[0]) ||
    !/^(?:[0-9]|[12][0-9]|3[0-2])$/u.test(parts[1])
  ) {
    return false;
  }
  const prefix = Number(parts[1]);
  const address = parts[0]
    .split('.')
    .reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
  const hostBits = 32n - BigInt(prefix);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  return (address & hostMask) === 0n;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeRouteTableId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_ROUTE_TABLE_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeRouteTableVpcId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_ROUTE_TABLE_VPC_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/**
 * Decode one replay-correlated CreateRouteTable response. The response remains
 * only an ephemeral exact-read locator; it is never ownership evidence.
 * @param {unknown} value - Raw CreateRouteTable response.
 * @param {unknown} expectedClientToken - Replay-stable create token.
 * @returns {string} - Strict candidate route-table ID.
 */
export function decodeAwsSingleNodeCreateRouteTableCandidateId(
  value,
  expectedClientToken,
) {
  if (
    typeof expectedClientToken !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(expectedClientToken)
  ) {
    throw new TypeError(
      'awsSingleNodeRouteTable expectedClientToken must be a lowercase SHA-256 token.',
    );
  }
  if (!isPlainObject(value) || typeof value.ClientToken !== 'string') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (value.ClientToken !== expectedClientToken) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (!isPlainObject(value.RouteTable)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return validateAwsSingleNodeRouteTableId(value.RouteTable.RouteTableId);
}

/** @param {unknown} response @param {unknown} exactRouteTableId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeExactRouteTableResponse(
  response,
  exactRouteTableId,
) {
  const expectedId = validateAwsSingleNodeRouteTableId(exactRouteTableId);
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (response.RouteTables.length === 0) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.RouteTables.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const routeTable = response.RouteTables[0];
  if (!isPlainObject(routeTable)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (
    validateAwsSingleNodeRouteTableId(routeTable.RouteTableId) !== expectedId
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return routeTable;
}

/** @param {unknown} response @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
export function decodeAwsSingleNodeRouteTableDiscoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.RouteTables)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    nextToken = response.NextToken;
  }
  const records = [];
  const ids = new Set();
  for (const routeTable of response.RouteTables) {
    if (!isPlainObject(routeTable)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    const id = validateAwsSingleNodeRouteTableId(routeTable.RouteTableId);
    if (ids.has(id)) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    ids.add(id);
    records.push(routeTable);
  }
  return { records, nextToken };
}

/**
 * Bind the shared tagged-EC2 evidence mechanics to route-table identity,
 * pagination, tags, and read adapters.
 * @param {unknown} options - Exact discovery-page and exact-ID read adapters.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeRouteTableEvidenceKernel(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRouteTableEvidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    EVIDENCE_FACTORY_KEYS,
    'awsSingleNodeRouteTableEvidence options',
  );
  return createAwsTaggedEc2EvidenceKernel({
    baseTags: AWS_SINGLE_NODE_ROUTE_TABLE_BASE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
    idKey: 'RouteTableId',
    idPattern: AWS_SINGLE_NODE_ROUTE_TABLE_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_ROUTE_TABLE_MAX_TAGS,
    readDiscoveryPage: options.readDiscoveryPage,
    readExact: options.readExact,
  });
}

/**
 * Hash one normalized provider-observable route-table base configuration.
 * Child default-route and subnet-association state is deliberately excluded.
 * @param {unknown} value - Exact normalized base-state descriptor.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function createAwsSingleNodeRouteTableStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeRouteTable state must be an object.');
  }
  assertExactKeys(
    value,
    STATE_DESCRIPTOR_KEYS,
    'awsSingleNodeRouteTable state',
  );
  if (!isPlainObject(value.localIpv4Route)) {
    throw new TypeError(
      'awsSingleNodeRouteTable state.localIpv4Route must be an object.',
    );
  }
  assertExactKeys(
    value.localIpv4Route,
    LOCAL_ROUTE_KEYS,
    'awsSingleNodeRouteTable state.localIpv4Route',
  );
  if (
    !isCanonicalIpv4Cidr(value.localIpv4Route.destinationCidrBlock) ||
    value.localIpv4Route.gatewayId !== 'local' ||
    typeof value.localIpv4Route.origin !== 'string' ||
    !ROUTE_ORIGINS.has(value.localIpv4Route.origin) ||
    typeof value.localIpv4Route.state !== 'string' ||
    !ROUTE_STATES.has(value.localIpv4Route.state) ||
    typeof value.main !== 'boolean' ||
    !Array.isArray(value.propagatingVirtualGateways) ||
    value.onDestroy !== 'purge'
  ) {
    throw new TypeError(
      'awsSingleNodeRouteTable state does not match a supported provider-observable route-table configuration.',
    );
  }
  const propagatingVirtualGateways = [];
  const gatewayIds = new Set();
  for (const gatewayId of value.propagatingVirtualGateways) {
    if (
      typeof gatewayId !== 'string' ||
      !VIRTUAL_PRIVATE_GATEWAY_ID_PATTERN.test(gatewayId)
    ) {
      throw new TypeError(
        'awsSingleNodeRouteTable state propagatingVirtualGateways must contain virtual-private-gateway IDs.',
      );
    }
    if (gatewayIds.has(gatewayId)) {
      throw new TypeError(
        'awsSingleNodeRouteTable state propagatingVirtualGateways must not contain duplicates.',
      );
    }
    gatewayIds.add(gatewayId);
    propagatingVirtualGateways.push(gatewayId);
  }
  propagatingVirtualGateways.sort();
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2RouteTableState',
    localIpv4Route: {
      destinationCidrBlock: value.localIpv4Route.destinationCidrBlock,
      gatewayId: value.localIpv4Route.gatewayId,
      origin: value.localIpv4Route.origin,
      state: value.localIpv4Route.state,
    },
    main: value.main,
    propagatingVirtualGateways,
    onDestroy: value.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive the exact desired base state from the fixed provider specification.
 * The dynamically allocated parent VPC ID belongs to dependency lineage.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeRouteTableStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeRouteTableState providerSpec',
  );
  return createAwsSingleNodeRouteTableStateDigest({
    localIpv4Route: {
      destinationCidrBlock: providerSpec.capabilities.networking.vpcCidr,
      gatewayId: 'local',
      origin: 'CreateRouteTable',
      state: 'active',
    },
    main: false,
    propagatingVirtualGateways: [],
    onDestroy: 'purge',
  });
}

/**
 * Decode provider identity and credential-scope fields without applying
 * durable controller authority.
 * @param {unknown} value - One DescribeRouteTables record.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeRouteTableIdentity(value) {
  if (
    !isPlainObject(value) ||
    typeof value.OwnerId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(value.OwnerId)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return Object.freeze({
    providerResourceId: validateAwsSingleNodeRouteTableId(value.RouteTableId),
    ownerId: value.OwnerId,
    vpcId: validateAwsSingleNodeRouteTableVpcId(value.VpcId),
  });
}

/** @param {Readonly<Record<string, any>>} value @param {readonly string[]} keys @returns {string[]} */
function populatedStringFields(value, keys) {
  const populated = [];
  for (const key of keys) {
    if (value[key] === undefined || value[key] === null) continue;
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    populated.push(key);
  }
  return populated;
}

/** @param {unknown} value @param {string} routeTableId @returns {Readonly<Record<string, any>>} */
function decodeAssociationState(value, routeTableId) {
  if (
    !isPlainObject(value) ||
    typeof value.Main !== 'boolean' ||
    typeof value.RouteTableAssociationId !== 'string' ||
    !ROUTE_TABLE_ASSOCIATION_ID_PATTERN.test(value.RouteTableAssociationId) ||
    typeof value.RouteTableId !== 'string' ||
    !AWS_SINGLE_NODE_ROUTE_TABLE_ID_PATTERN.test(value.RouteTableId) ||
    !isPlainObject(value.AssociationState) ||
    typeof value.AssociationState.State !== 'string' ||
    !ROUTE_ASSOCIATION_STATES.has(value.AssociationState.State)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (
    value.AssociationState.StatusMessage !== undefined &&
    value.AssociationState.StatusMessage !== null &&
    typeof value.AssociationState.StatusMessage !== 'string'
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (value.RouteTableId !== routeTableId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const subnetPresent = value.SubnetId !== undefined && value.SubnetId !== null;
  const gatewayPresent =
    value.GatewayId !== undefined && value.GatewayId !== null;
  if (
    (subnetPresent &&
      (typeof value.SubnetId !== 'string' ||
        !SUBNET_ID_PATTERN.test(value.SubnetId))) ||
    (gatewayPresent &&
      (typeof value.GatewayId !== 'string' ||
        !GATEWAY_ASSOCIATION_ID_PATTERN.test(value.GatewayId)))
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (
    (value.PublicIpv4Pool !== undefined && value.PublicIpv4Pool !== null) ||
    (value.Main && (subnetPresent || gatewayPresent)) ||
    (!value.Main && Number(subnetPresent) + Number(gatewayPresent) !== 1)
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return deepFreeze({
    associationState: {
      state: value.AssociationState.State,
      ...(value.AssociationState.StatusMessage === undefined ||
      value.AssociationState.StatusMessage === null
        ? {}
        : { statusMessage: value.AssociationState.StatusMessage }),
    },
    main: value.Main,
    routeTableAssociationId: value.RouteTableAssociationId,
    routeTableId: value.RouteTableId,
    ...(subnetPresent ? { subnetId: value.SubnetId } : {}),
    ...(gatewayPresent ? { gatewayId: value.GatewayId } : {}),
  });
}

/** @param {unknown} value @param {string} routeTableId @returns {Readonly<Record<string, any>>} */
function decodeAssociations(value, routeTableId) {
  if (!Array.isArray(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const ids = new Set();
  const mainAssociations = [];
  const subnetAssociations = [];
  const otherAssociations = [];
  for (const rawAssociation of value) {
    const association = decodeAssociationState(rawAssociation, routeTableId);
    if (ids.has(association.routeTableAssociationId)) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    ids.add(association.routeTableAssociationId);
    if (association.main) {
      mainAssociations.push(association);
    } else if (association.subnetId !== undefined) {
      subnetAssociations.push(association);
    } else {
      otherAssociations.push(association);
    }
  }
  if (mainAssociations.length > 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  /** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {number} */
  const compareAssociation = (left, right) =>
    left.routeTableAssociationId < right.routeTableAssociationId
      ? -1
      : left.routeTableAssociationId > right.routeTableAssociationId
        ? 1
        : 0;
  subnetAssociations.sort(compareAssociation);
  otherAssociations.sort(compareAssociation);
  return deepFreeze({
    main: mainAssociations.length === 1,
    subnetAssociations,
    otherAssociations,
  });
}

/** @param {unknown} value @returns {Readonly<string[]>} */
function decodePropagatingVirtualGateways(value) {
  if (!Array.isArray(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const gatewayIds = new Set();
  for (const propagation of value) {
    if (
      !isPlainObject(propagation) ||
      typeof propagation.GatewayId !== 'string' ||
      !VIRTUAL_PRIVATE_GATEWAY_ID_PATTERN.test(propagation.GatewayId)
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (gatewayIds.has(propagation.GatewayId)) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    gatewayIds.add(propagation.GatewayId);
  }
  return Object.freeze([...gatewayIds].sort());
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function decodeRouteState(value) {
  if (
    !isPlainObject(value) ||
    typeof value.Origin !== 'string' ||
    !ROUTE_ORIGINS.has(value.Origin) ||
    typeof value.State !== 'string' ||
    !ROUTE_STATES.has(value.State)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  let instanceOwnerId = null;
  if (value.InstanceOwnerId !== undefined && value.InstanceOwnerId !== null) {
    if (
      typeof value.InstanceOwnerId !== 'string' ||
      value.InstanceOwnerId.length === 0
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    instanceOwnerId = value.InstanceOwnerId;
  }
  const destinations = populatedStringFields(value, ROUTE_DESTINATION_KEYS);
  const targets = populatedStringFields(value, ROUTE_TARGET_KEYS);
  if (destinations.length !== 1 || targets.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const destinationKey = destinations[0];
  const targetKey = targets[0];
  if (targetKey === 'GatewayId' && value.GatewayId === 'local') {
    if (
      destinationKey !== 'DestinationCidrBlock' ||
      !isCanonicalIpv4Cidr(value.DestinationCidrBlock) ||
      instanceOwnerId !== null
    ) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    return deepFreeze({
      kind: 'local',
      descriptor: {
        destinationCidrBlock: value.DestinationCidrBlock,
        gatewayId: 'local',
        origin: value.Origin,
        state: value.State,
      },
    });
  }
  if (
    destinationKey === 'DestinationCidrBlock' &&
    value.DestinationCidrBlock === '0.0.0.0/0' &&
    targetKey === 'GatewayId' &&
    INTERNET_GATEWAY_ID_PATTERN.test(value.GatewayId) &&
    value.Origin === 'CreateRoute' &&
    instanceOwnerId === null
  ) {
    return deepFreeze({
      kind: 'default',
      descriptor: {
        destinationCidrBlock: value.DestinationCidrBlock,
        gatewayId: value.GatewayId,
        origin: value.Origin,
        state: value.State,
      },
    });
  }
  return deepFreeze({
    kind: 'other',
    descriptor: {
      destination: {
        field: destinationKey,
        value: value[destinationKey],
      },
      target: { field: targetKey, value: value[targetKey] },
      origin: value.Origin,
      state: value.State,
      ...(instanceOwnerId === null ? {} : { instanceOwnerId }),
    },
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function decodeRoutes(value) {
  if (!Array.isArray(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const localIpv4Routes = [];
  const defaultIpv4Routes = [];
  const otherRoutes = [];
  const descriptors = new Set();
  for (const rawRoute of value) {
    const route = decodeRouteState(rawRoute);
    const descriptorKey = JSON.stringify(
      sortCanonicalJsonValue(route.descriptor),
    );
    if (descriptors.has(descriptorKey)) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    descriptors.add(descriptorKey);
    if (route.kind === 'local') {
      localIpv4Routes.push(route.descriptor);
    } else if (route.kind === 'default') {
      defaultIpv4Routes.push(route.descriptor);
    } else {
      otherRoutes.push(route.descriptor);
    }
  }
  if (localIpv4Routes.length > 1 || defaultIpv4Routes.length > 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  /** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {number} */
  const compareDescriptor = (left, right) => {
    const leftJson = JSON.stringify(sortCanonicalJsonValue(left));
    const rightJson = JSON.stringify(sortCanonicalJsonValue(right));
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  };
  defaultIpv4Routes.sort(compareDescriptor);
  otherRoutes.sort(compareDescriptor);
  return deepFreeze({
    localIpv4Route: localIpv4Routes[0] ?? null,
    defaultIpv4Routes,
    otherRoutes,
  });
}

/**
 * Decode complete readable route-table state and classify separately owned
 * child slots without applying desired policy.
 * @param {unknown} value - One DescribeRouteTables record.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeRouteTableRecordState(value) {
  const identity = decodeAwsSingleNodeRouteTableIdentity(value);
  const associations = decodeAssociations(
    /** @type {Readonly<Record<string, any>>} */ (value).Associations,
    identity.providerResourceId,
  );
  const propagatingVirtualGateways = decodePropagatingVirtualGateways(
    /** @type {Readonly<Record<string, any>>} */ (value).PropagatingVgws,
  );
  const routes = decodeRoutes(
    /** @type {Readonly<Record<string, any>>} */ (value).Routes,
  );
  return deepFreeze({
    ...identity,
    localIpv4Route: routes.localIpv4Route,
    main: associations.main,
    propagatingVirtualGateways,
    defaultIpv4Routes: routes.defaultIpv4Routes,
    subnetAssociations: associations.subnetAssociations,
    otherAssociations: associations.otherAssociations,
    otherRoutes: routes.otherRoutes,
  });
}

/**
 * Decode the route-table base digest. Supported child slots are excluded only
 * for resident reads; a current create receipt must prove pristine base state.
 * @param {unknown} value - One DescribeRouteTables record.
 * @param {unknown} options - Exact descendant-read policy.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeRouteTableActualState(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeRouteTable actual-state options must be an object.',
    );
  }
  assertExactKeys(
    options,
    ACTUAL_STATE_OPTIONS_KEYS,
    'awsSingleNodeRouteTable actual-state options',
  );
  if (typeof options.allowDescendants !== 'boolean') {
    throw new TypeError(
      'awsSingleNodeRouteTable actual-state allowDescendants must be a boolean.',
    );
  }
  const state = decodeAwsSingleNodeRouteTableRecordState(value);
  if (
    state.otherAssociations.length !== 0 ||
    state.otherRoutes.length !== 0 ||
    state.subnetAssociations.length > 1 ||
    state.defaultIpv4Routes.length > 1 ||
    (!options.allowDescendants &&
      (state.main ||
        state.propagatingVirtualGateways.length !== 0 ||
        state.subnetAssociations.length !== 0 ||
        state.defaultIpv4Routes.length !== 0))
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (state.localIpv4Route === null) {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  return deepFreeze({
    providerResourceId: state.providerResourceId,
    ownerId: state.ownerId,
    vpcId: state.vpcId,
    observedDigest: createAwsSingleNodeRouteTableStateDigest({
      localIpv4Route: state.localIpv4Route,
      main: state.main,
      propagatingVirtualGateways: state.propagatingVirtualGateways,
      onDestroy: 'purge',
    }),
  });
}

export default {
  AWS_SINGLE_NODE_ROUTE_TABLE_BASE_TAGS,
  AWS_SINGLE_NODE_ROUTE_TABLE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_ID_PATTERN,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_ROUTE_TABLE_MAX_TAGS,
  AWS_SINGLE_NODE_ROUTE_TABLE_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_ROUTE_TABLE_VPC_ID_PATTERN,
  createAwsSingleNodeRouteTableEvidenceKernel,
  createAwsSingleNodeRouteTableStateDigest,
  decodeAwsSingleNodeCreateRouteTableCandidateId,
  decodeAwsSingleNodeExactRouteTableResponse,
  decodeAwsSingleNodeRouteTableActualState,
  decodeAwsSingleNodeRouteTableDiscoveryPage,
  decodeAwsSingleNodeRouteTableIdentity,
  decodeAwsSingleNodeRouteTableRecordState,
  getAwsSingleNodeRouteTableStateDigest,
  validateAwsSingleNodeRouteTableId,
  validateAwsSingleNodeRouteTableVpcId,
};
