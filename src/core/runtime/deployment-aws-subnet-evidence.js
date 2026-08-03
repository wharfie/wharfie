/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { isIPv4, isIPv6 } from 'node:net';

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';

export const AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-subnet-state:v1';
export const AWS_SINGLE_NODE_SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_SUBNET_VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_SUBNET_MAX_TAGS = 50;
export const AWS_SINGLE_NODE_SUBNET_BASE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-subnet',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const AVAILABILITY_ZONE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-az[1-9][0-9]*$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const SUBNET_CIDR_ASSOCIATION_ID_PATTERN = /^subnet-cidr-assoc-[0-9a-f]{8,32}$/;
const SUBNET_STATES = new Set([
  'pending',
  'available',
  'unavailable',
  'failed',
  'failed-insufficient-capacity',
]);
const INTERNET_GATEWAY_BLOCK_MODES = new Set([
  'off',
  'block-ingress',
  'block-bidirectional',
]);
const EVIDENCE_FACTORY_KEYS = new Set(['readDiscoveryPage', 'readExact']);
const STATE_DESCRIPTOR_KEYS = new Set([
  'cidrBlock',
  'availabilityZoneId',
  'defaultForAz',
  'ipv6Native',
  'assignIpv6AddressOnCreation',
  'mapPublicIpOnLaunch',
  'internetGatewayBlockMode',
  'onDestroy',
]);
const NATURAL_SLOT_KEYS = new Set(['vpcId', 'availabilityZoneId', 'cidrBlock']);

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
function decodeIpv4Cidr(value) {
  if (!isCanonicalIpv4Cidr(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return /** @type {string} */ (value);
}

/** @param {unknown} value @returns {string} */
function normalizeIpv6Cidr(value) {
  if (typeof value !== 'string') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const parts = value.split('/');
  if (
    parts.length !== 2 ||
    !isIPv6(parts[0]) ||
    parts[0].includes('.') ||
    !/^(?:0|[1-9][0-9]?|1[01][0-9]|12[0-8])$/u.test(parts[1])
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const separator = parts[0].indexOf('::');
  if (separator !== parts[0].lastIndexOf('::')) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const leftText = separator === -1 ? parts[0] : parts[0].slice(0, separator);
  const rightText = separator === -1 ? '' : parts[0].slice(separator + 2);
  const left = leftText === '' ? [] : leftText.split(':');
  const right = rightText === '' ? [] : rightText.split(':');
  let groups;
  if (separator === -1) {
    if (left.length !== 8) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    groups = left;
  } else {
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    groups = [...left, ...Array(omitted).fill('0'), ...right];
  }
  let address = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/iu.test(group)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    address = (address << 16n) | BigInt(`0x${group}`);
  }
  const prefix = Number(parts[1]);
  const hostBits = 128n - BigInt(prefix);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  if ((address & hostMask) !== 0n) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const normalizedGroups = [];
  for (let offset = 112n; offset >= 0n; offset -= 16n) {
    normalizedGroups.push(
      ((address >> offset) & 0xffffn).toString(16).padStart(4, '0'),
    );
  }
  return `${normalizedGroups.join(':')}/${prefix}`;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_SUBNET_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetVpcId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_SUBNET_VPC_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSubnetAvailabilityZoneId(value) {
  if (typeof value !== 'string' || !AVAILABILITY_ZONE_ID_PATTERN.test(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/**
 * A CreateSubnet response is only an ephemeral locator. A missing or malformed
 * candidate is not provider absence and therefore decodes to null.
 * @param {unknown} value - Raw CreateSubnet response.
 * @returns {string|null} - Candidate subnet ID, if strictly readable.
 */
export function decodeAwsSingleNodeCreateSubnetCandidateId(value) {
  if (!isPlainObject(value) || !isPlainObject(value.Subnet)) return null;
  try {
    return validateAwsSingleNodeSubnetId(value.Subnet.SubnetId);
  } catch {
    return null;
  }
}

/** @param {unknown} response @param {unknown} exactSubnetId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeExactSubnetResponse(
  response,
  exactSubnetId,
) {
  const expectedId = validateAwsSingleNodeSubnetId(exactSubnetId);
  if (!isPlainObject(response) || !Array.isArray(response.Subnets)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (response.Subnets.length === 0) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.Subnets.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const subnet = response.Subnets[0];
  if (!isPlainObject(subnet)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (validateAwsSingleNodeSubnetId(subnet.SubnetId) !== expectedId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return subnet;
}

/** @param {unknown} response @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
export function decodeAwsSingleNodeSubnetDiscoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Subnets)) {
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
  for (const subnet of response.Subnets) {
    if (!isPlainObject(subnet)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    validateAwsSingleNodeSubnetId(subnet.SubnetId);
    records.push(subnet);
  }
  return { records, nextToken };
}

/**
 * Bind the pure shared tagged-EC2 evidence mechanics to subnet identity,
 * pagination, tags, and read adapters.
 * @param {unknown} options - Exact discovery-page and exact-ID read adapters.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeSubnetEvidenceKernel(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSubnetEvidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    EVIDENCE_FACTORY_KEYS,
    'awsSingleNodeSubnetEvidence options',
  );
  return createAwsTaggedEc2EvidenceKernel({
    baseTags: AWS_SINGLE_NODE_SUBNET_BASE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
    idKey: 'SubnetId',
    idPattern: AWS_SINGLE_NODE_SUBNET_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_SUBNET_MAX_TAGS,
    readDiscoveryPage: options.readDiscoveryPage,
    readExact: options.readExact,
  });
}

/**
 * Normalize the full intended natural subnet slot. The provider query remains
 * intentionally broad at VPC+CIDR so a same-CIDR wrong-AZ collision cannot be
 * hidden; record corroboration below proves the exact AZ ID as well.
 * @param {unknown} value - Exact natural-slot identity.
 * @returns {Readonly<Record<string, any>>} - Slot plus broad collision filters.
 */
export function createAwsSingleNodeSubnetNaturalSlot(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeSubnet natural slot must be an object.');
  }
  assertExactKeys(value, NATURAL_SLOT_KEYS, 'awsSingleNodeSubnet natural slot');
  let vpcId;
  let availabilityZoneId;
  try {
    vpcId = validateAwsSingleNodeSubnetVpcId(value.vpcId);
    availabilityZoneId = validateAwsSingleNodeSubnetAvailabilityZoneId(
      value.availabilityZoneId,
    );
  } catch {
    throw new TypeError(
      'awsSingleNodeSubnet natural slot identity is invalid.',
    );
  }
  if (!isCanonicalIpv4Cidr(value.cidrBlock)) {
    throw new TypeError(
      'awsSingleNodeSubnet natural slot cidrBlock must be a canonical IPv4 CIDR.',
    );
  }
  return deepFreeze({
    vpcId,
    availabilityZoneId,
    cidrBlock: value.cidrBlock,
    filters: [
      { Name: 'vpc-id', Values: [vpcId] },
      { Name: 'cidr-block', Values: [value.cidrBlock] },
    ],
  });
}

/**
 * Hash one normalized provider-observable subnet configuration.
 * @param {unknown} value - Exact normalized subnet state descriptor.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function createAwsSingleNodeSubnetStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeSubnet state must be an object.');
  }
  assertExactKeys(value, STATE_DESCRIPTOR_KEYS, 'awsSingleNodeSubnet state');
  if (
    !isCanonicalIpv4Cidr(value.cidrBlock) ||
    typeof value.availabilityZoneId !== 'string' ||
    !AVAILABILITY_ZONE_ID_PATTERN.test(value.availabilityZoneId) ||
    typeof value.defaultForAz !== 'boolean' ||
    typeof value.ipv6Native !== 'boolean' ||
    typeof value.assignIpv6AddressOnCreation !== 'boolean' ||
    typeof value.mapPublicIpOnLaunch !== 'boolean' ||
    typeof value.internetGatewayBlockMode !== 'string' ||
    !INTERNET_GATEWAY_BLOCK_MODES.has(value.internetGatewayBlockMode) ||
    value.onDestroy !== 'purge'
  ) {
    throw new TypeError(
      'awsSingleNodeSubnet state does not match a supported provider-observable subnet configuration.',
    );
  }
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2SubnetState',
    cidrBlock: value.cidrBlock,
    availabilityZoneId: value.availabilityZoneId,
    defaultForAz: value.defaultForAz,
    ipv6Native: value.ipv6Native,
    assignIpv6AddressOnCreation: value.assignIpv6AddressOnCreation,
    mapPublicIpOnLaunch: value.mapPublicIpOnLaunch,
    internetGatewayBlockMode: value.internetGatewayBlockMode,
    onDestroy: value.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive the exact desired subnet state from the fixed provider specification.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeSubnetStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeSubnetState providerSpec',
  );
  return createAwsSingleNodeSubnetStateDigest({
    cidrBlock: providerSpec.capabilities.networking.subnetCidr,
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    defaultForAz: false,
    ipv6Native: false,
    assignIpv6AddressOnCreation: false,
    mapPublicIpOnLaunch: false,
    internetGatewayBlockMode: 'off',
    onDestroy: 'purge',
  });
}

/**
 * Decode identity, account, VPC lineage, and lifecycle fields common to all
 * subnet evidence modes.
 * @param {unknown} value - One DescribeSubnets record.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetIdentity(value) {
  if (
    !isPlainObject(value) ||
    typeof value.OwnerId !== 'string' ||
    !AWS_ACCOUNT_ID_PATTERN.test(value.OwnerId) ||
    typeof value.State !== 'string' ||
    !SUBNET_STATES.has(value.State)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return Object.freeze({
    providerResourceId: validateAwsSingleNodeSubnetId(value.SubnetId),
    ownerId: value.OwnerId,
    vpcId: validateAwsSingleNodeSubnetVpcId(value.VpcId),
    state: value.State,
  });
}

/** @param {unknown} value @returns {Readonly<string[]>} */
function decodeIpv6Associations(value) {
  if (!Array.isArray(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const cidrBlocks = [];
  const associationIds = new Set();
  for (const association of value) {
    if (
      !isPlainObject(association) ||
      typeof association.AssociationId !== 'string' ||
      !SUBNET_CIDR_ASSOCIATION_ID_PATTERN.test(association.AssociationId) ||
      typeof association.Ipv6CidrBlock !== 'string' ||
      association.Ipv6CidrBlock.length === 0 ||
      !isPlainObject(association.Ipv6CidrBlockState) ||
      typeof association.Ipv6CidrBlockState.State !== 'string' ||
      (association.Ipv6CidrBlockState.StatusMessage !== undefined &&
        association.Ipv6CidrBlockState.StatusMessage !== null &&
        typeof association.Ipv6CidrBlockState.StatusMessage !== 'string')
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (associationIds.has(association.AssociationId)) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    associationIds.add(association.AssociationId);
    const state = association.Ipv6CidrBlockState.State;
    const statusMessage = association.Ipv6CidrBlockState.StatusMessage;
    if (state === 'associating' || state === 'disassociating') {
      throw new AwsTaggedEc2EvidenceTransientError();
    }
    if (
      state !== 'associated' ||
      (statusMessage !== undefined && statusMessage !== null)
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    cidrBlocks.push(normalizeIpv6Cidr(association.Ipv6CidrBlock));
  }
  cidrBlocks.sort();
  for (let index = 1; index < cidrBlocks.length; index += 1) {
    if (cidrBlocks[index - 1] === cidrBlocks[index]) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
  }
  return Object.freeze(cidrBlocks);
}

/**
 * Decode provider-observable subnet configuration without applying desired
 * policy. Readable supported drift remains digestible.
 * @param {unknown} value - One DescribeSubnets record.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetRecordState(value) {
  const identity = decodeAwsSingleNodeSubnetIdentity(value);
  if (
    !isPlainObject(value) ||
    typeof value.DefaultForAz !== 'boolean' ||
    typeof value.Ipv6Native !== 'boolean' ||
    typeof value.AssignIpv6AddressOnCreation !== 'boolean' ||
    typeof value.MapPublicIpOnLaunch !== 'boolean' ||
    !isPlainObject(value.BlockPublicAccessStates) ||
    typeof value.BlockPublicAccessStates.InternetGatewayBlockMode !== 'string'
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const availabilityZoneId = validateAwsSingleNodeSubnetAvailabilityZoneId(
    value.AvailabilityZoneId,
  );
  const cidrBlock = decodeIpv4Cidr(value.CidrBlock);
  const internetGatewayBlockMode =
    value.BlockPublicAccessStates.InternetGatewayBlockMode;
  if (!INTERNET_GATEWAY_BLOCK_MODES.has(internetGatewayBlockMode)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const ipv6CidrAssociations = decodeIpv6Associations(
    value.Ipv6CidrBlockAssociationSet,
  );
  return deepFreeze({
    ...identity,
    cidrBlock,
    availabilityZoneId,
    defaultForAz: value.DefaultForAz,
    ipv6Native: value.Ipv6Native,
    assignIpv6AddressOnCreation: value.AssignIpv6AddressOnCreation,
    mapPublicIpOnLaunch: value.MapPublicIpOnLaunch,
    internetGatewayBlockMode,
    ipv6CidrAssociations,
  });
}

/** @param {Readonly<Record<string, any>>} state @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function createAwsSingleNodeSubnetIpv6DriftStateDigest(state) {
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 2,
    kind: 'awsSingleNodeEc2SubnetObservedState',
    cidrBlock: state.cidrBlock,
    availabilityZoneId: state.availabilityZoneId,
    defaultForAz: state.defaultForAz,
    ipv6Native: state.ipv6Native,
    ipv6CidrAssociations: state.ipv6CidrAssociations,
    assignIpv6AddressOnCreation: state.assignIpv6AddressOnCreation,
    mapPublicIpOnLaunch: state.mapPublicIpOnLaunch,
    internetGatewayBlockMode: state.internetGatewayBlockMode,
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Decode complete readable provider state and derive its actual digest.
 * @param {unknown} value - One DescribeSubnets record.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeSubnetActualState(value) {
  const state = decodeAwsSingleNodeSubnetRecordState(value);
  if (state.state === 'pending' || state.state === 'unavailable') {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  if (state.state !== 'available') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const observedDigest =
    state.ipv6CidrAssociations.length === 0
      ? createAwsSingleNodeSubnetStateDigest({
          cidrBlock: state.cidrBlock,
          availabilityZoneId: state.availabilityZoneId,
          defaultForAz: state.defaultForAz,
          ipv6Native: state.ipv6Native,
          assignIpv6AddressOnCreation: state.assignIpv6AddressOnCreation,
          mapPublicIpOnLaunch: state.mapPublicIpOnLaunch,
          internetGatewayBlockMode: state.internetGatewayBlockMode,
          onDestroy: 'purge',
        })
      : createAwsSingleNodeSubnetIpv6DriftStateDigest(state);
  return deepFreeze({
    providerResourceId: state.providerResourceId,
    ownerId: state.ownerId,
    vpcId: state.vpcId,
    observedDigest,
  });
}

export default {
  AWS_SINGLE_NODE_SUBNET_BASE_TAGS,
  AWS_SINGLE_NODE_SUBNET_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SUBNET_ID_PATTERN,
  AWS_SINGLE_NODE_SUBNET_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SUBNET_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SUBNET_MAX_TAGS,
  AWS_SINGLE_NODE_SUBNET_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_SUBNET_VPC_ID_PATTERN,
  createAwsSingleNodeSubnetEvidenceKernel,
  createAwsSingleNodeSubnetNaturalSlot,
  createAwsSingleNodeSubnetStateDigest,
  decodeAwsSingleNodeCreateSubnetCandidateId,
  decodeAwsSingleNodeExactSubnetResponse,
  decodeAwsSingleNodeSubnetActualState,
  decodeAwsSingleNodeSubnetDiscoveryPage,
  decodeAwsSingleNodeSubnetIdentity,
  decodeAwsSingleNodeSubnetRecordState,
  getAwsSingleNodeSubnetStateDigest,
  validateAwsSingleNodeSubnetAvailabilityZoneId,
  validateAwsSingleNodeSubnetId,
  validateAwsSingleNodeSubnetVpcId,
};
