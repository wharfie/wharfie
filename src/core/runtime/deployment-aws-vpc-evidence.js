/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal provider-evidence contracts are clearer than repeated parser-specific expansions. */

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

export const AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS = 100;
export const AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-vpc-state:v1';

const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/;
const VPC_CIDR_ASSOCIATION_ID_PATTERN = /^vpc-cidr-assoc-[0-9a-f]{8,32}$/;
const DHCP_OPTIONS_ID_PATTERN = /^dopt-[0-9a-f]{8,32}$/;
const INSTANCE_TENANCIES = new Set(['default', 'dedicated', 'host']);
const INTERNET_GATEWAY_BLOCK_MODES = new Set([
  'off',
  'block-ingress',
  'block-bidirectional',
]);
const MAX_VPC_TAGS = 50;
const EVIDENCE_KERNEL_KEYS = new Set(['readDiscoveryPage', 'readExact']);
const STATE_DESCRIPTOR_KEYS = new Set([
  'cidrBlock',
  'instanceTenancy',
  'isDefault',
  'ipv6',
  'enableDnsSupport',
  'enableDnsHostnames',
  'internetGatewayBlockMode',
  'onDestroy',
]);
const ACTUAL_STATE_OPTIONS_KEYS = new Set([
  'allowPropagation',
  'enableDnsSupport',
  'enableDnsHostnames',
]);
const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-vpc',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

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

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeVpcId(value) {
  if (typeof value !== 'string' || !VPC_ID_PATTERN.test(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/**
 * Decode one exact-ID DescribeVpcs envelope.
 * @param {unknown} response - Raw provider response.
 * @param {unknown} exactVpcId - Exact requested VPC ID.
 * @returns {Readonly<Record<string, any>>} - Sole corroborated VPC record.
 */
export function decodeAwsSingleNodeExactVpcResponse(response, exactVpcId) {
  const expectedVpcId = validateAwsSingleNodeVpcId(exactVpcId);
  if (!isPlainObject(response) || !Array.isArray(response.Vpcs)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (response.Vpcs.length === 0) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.Vpcs.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const vpc = response.Vpcs[0];
  if (!isPlainObject(vpc)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const observedVpcId = validateAwsSingleNodeVpcId(vpc.VpcId);
  if (observedVpcId !== expectedVpcId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return vpc;
}

/**
 * Decode one paginated DescribeVpcs discovery envelope.
 * @param {unknown} response - Raw provider response.
 * @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} - Normalized page.
 */
export function decodeAwsSingleNodeVpcDiscoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Vpcs)) {
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
  for (const vpc of response.Vpcs) {
    if (!isPlainObject(vpc)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    validateAwsSingleNodeVpcId(vpc.VpcId);
    records.push(vpc);
  }
  return { records, nextToken };
}

/** @param {unknown} value @returns {string} */
function validateIpv4Cidr(value) {
  if (typeof value !== 'string') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const parts = value.split('/');
  if (
    parts.length !== 2 ||
    !isIPv4(parts[0]) ||
    !/^(?:[0-9]|[12][0-9]|3[0-2])$/u.test(parts[1])
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const prefix = Number(parts[1]);
  const address = parts[0]
    .split('.')
    .reduce((result, octet) => (result << 8n) | BigInt(octet), 0n);
  const hostBits = 32n - BigInt(prefix);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  if ((address & hostMask) !== 0n) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
function validateIpv6Cidr(value) {
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
  const address = parts[0];
  const separator = address.indexOf('::');
  if (separator !== address.lastIndexOf('::')) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const leftText = separator === -1 ? address : address.slice(0, separator);
  const rightText = separator === -1 ? '' : address.slice(separator + 2);
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
  let numericAddress = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/iu.test(group)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    numericAddress = (numericAddress << 16n) | BigInt(`0x${group}`);
  }
  const hostBits = 128n - BigInt(parts[1]);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  if ((numericAddress & hostMask) !== 0n) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/**
 * Bind the generic stateless tagged-EC2 evidence mechanics to the VPC
 * response shape and bounded locator policy.
 * @param {unknown} options - Exact VPC discovery and exact-read adapters.
 * @returns {Readonly<Record<string, any>>} - Stateless VPC evidence kernel.
 */
export function createAwsSingleNodeVpcEvidenceKernel(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeVpcEvidence options must be an object.');
  }
  assertExactKeys(
    options,
    EVIDENCE_KERNEL_KEYS,
    'awsSingleNodeVpcEvidence options',
  );
  return createAwsTaggedEc2EvidenceKernel({
    baseTags: BASE_RESERVED_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
    idKey: 'VpcId',
    idPattern: VPC_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
    maxTags: MAX_VPC_TAGS,
    readDiscoveryPage: options.readDiscoveryPage,
    readExact: options.readExact,
  });
}

/**
 * Hash one normalized provider-observable VPC configuration.
 * @param {unknown} value - Exact normalized VPC state descriptor.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function createAwsSingleNodeVpcStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeVpc state must be an object.');
  }
  assertExactKeys(value, STATE_DESCRIPTOR_KEYS, 'awsSingleNodeVpc state');
  const cidrBlock = validateIpv4Cidr(value.cidrBlock);
  if (
    typeof value.instanceTenancy !== 'string' ||
    !INSTANCE_TENANCIES.has(value.instanceTenancy) ||
    typeof value.isDefault !== 'boolean' ||
    typeof value.ipv6 !== 'boolean' ||
    typeof value.enableDnsSupport !== 'boolean' ||
    typeof value.enableDnsHostnames !== 'boolean' ||
    typeof value.internetGatewayBlockMode !== 'string' ||
    !INTERNET_GATEWAY_BLOCK_MODES.has(value.internetGatewayBlockMode) ||
    value.onDestroy !== 'purge'
  ) {
    throw new TypeError(
      'awsSingleNodeVpc state does not match a supported provider-observable VPC configuration.',
    );
  }
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2VpcState',
    cidrBlock,
    instanceTenancy: value.instanceTenancy,
    isDefault: value.isDefault,
    ipv6: value.ipv6,
    enableDnsSupport: value.enableDnsSupport,
    enableDnsHostnames: value.enableDnsHostnames,
    internetGatewayBlockMode: value.internetGatewayBlockMode,
    onDestroy: value.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive the exact desired VPC state from the fixed provider specification.
 * @param {unknown} value - Exact AWS single-node provider specification.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function getAwsSingleNodeVpcStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeVpcState providerSpec',
  );
  return createAwsSingleNodeVpcStateDigest({
    cidrBlock: providerSpec.capabilities.networking.vpcCidr,
    instanceTenancy: 'default',
    isDefault: false,
    ipv6: false,
    enableDnsSupport: true,
    enableDnsHostnames: false,
    internetGatewayBlockMode: 'off',
    onDestroy: 'purge',
  });
}

/**
 * Decode identity, account, and lifecycle fields common to base and deletion
 * evidence without requiring configuration fields that deletion ignores.
 * @param {unknown} value - One DescribeVpcs record.
 * @returns {Readonly<{providerResourceId: string, ownerId: string, state: string}>}
 */
export function decodeAwsSingleNodeVpcIdentity(value) {
  if (
    !isPlainObject(value) ||
    typeof value.OwnerId !== 'string' ||
    value.OwnerId.length === 0 ||
    typeof value.State !== 'string' ||
    value.State.length === 0
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return Object.freeze({
    providerResourceId: validateAwsSingleNodeVpcId(value.VpcId),
    ownerId: value.OwnerId,
    state: value.State,
  });
}

/** @param {unknown} value @param {boolean} allowPropagation @returns {string} */
function decodeIpv4Association(value, allowPropagation) {
  if (!Array.isArray(value)) {
    if (allowPropagation && (value === undefined || value === null)) {
      throw new AwsTaggedEc2EvidenceTransientError();
    }
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (value.length === 0 && allowPropagation) {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  if (value.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const association = value[0];
  if (
    !isPlainObject(association) ||
    typeof association.AssociationId !== 'string' ||
    !VPC_CIDR_ASSOCIATION_ID_PATTERN.test(association.AssociationId) ||
    !isPlainObject(association.CidrBlockState) ||
    typeof association.CidrBlockState.State !== 'string'
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const cidrBlock = validateIpv4Cidr(association.CidrBlock);
  const statusMessage = association.CidrBlockState.StatusMessage;
  if (
    statusMessage !== undefined &&
    statusMessage !== null &&
    typeof statusMessage !== 'string'
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (association.CidrBlockState.State === 'associating') {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  if (
    association.CidrBlockState.State !== 'associated' ||
    (statusMessage !== undefined && statusMessage !== null)
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return cidrBlock;
}

/** @param {unknown} value @returns {boolean} */
function decodeIpv6(value) {
  if (value === undefined) return false;
  if (!Array.isArray(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  for (const association of value) {
    if (
      !isPlainObject(association) ||
      typeof association.AssociationId !== 'string' ||
      !VPC_CIDR_ASSOCIATION_ID_PATTERN.test(association.AssociationId) ||
      !isPlainObject(association.Ipv6CidrBlockState) ||
      typeof association.Ipv6CidrBlockState.State !== 'string' ||
      (association.Ipv6CidrBlockState.StatusMessage !== undefined &&
        association.Ipv6CidrBlockState.StatusMessage !== null &&
        typeof association.Ipv6CidrBlockState.StatusMessage !== 'string')
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    validateIpv6Cidr(association.Ipv6CidrBlock);
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
  }
  return value.length > 0;
}

/**
 * Decode the provider-observable VPC fields present in DescribeVpcs. DNS
 * attributes are supplied by the two separate exact attribute reads.
 * @param {unknown} value - One DescribeVpcs record.
 * @param {boolean} allowPropagation - Whether initial CIDR propagation is transient.
 * @returns {Readonly<Record<string, any>>} - Normalized record state.
 */
export function decodeAwsSingleNodeVpcRecordState(value, allowPropagation) {
  if (typeof allowPropagation !== 'boolean') {
    throw new TypeError('awsSingleNodeVpc allowPropagation must be a boolean.');
  }
  const identity = decodeAwsSingleNodeVpcIdentity(value);
  if (!isPlainObject(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const cidrBlock = validateIpv4Cidr(value.CidrBlock);
  const associatedCidr = decodeIpv4Association(
    value.CidrBlockAssociationSet,
    allowPropagation,
  );
  if (associatedCidr !== cidrBlock) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (
    typeof value.InstanceTenancy !== 'string' ||
    !INSTANCE_TENANCIES.has(value.InstanceTenancy) ||
    typeof value.IsDefault !== 'boolean' ||
    typeof value.DhcpOptionsId !== 'string' ||
    !DHCP_OPTIONS_ID_PATTERN.test(value.DhcpOptionsId) ||
    !isPlainObject(value.BlockPublicAccessStates) ||
    typeof value.BlockPublicAccessStates.InternetGatewayBlockMode !== 'string'
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const internetGatewayBlockMode =
    value.BlockPublicAccessStates.InternetGatewayBlockMode;
  if (!INTERNET_GATEWAY_BLOCK_MODES.has(internetGatewayBlockMode)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return deepFreeze({
    ...identity,
    cidrBlock,
    instanceTenancy: value.InstanceTenancy,
    isDefault: value.IsDefault,
    ipv6: decodeIpv6(value.Ipv6CidrBlockAssociationSet),
    internetGatewayBlockMode,
  });
}

/**
 * Decode one strict DescribeVpcAttribute response and return its boolean.
 * @param {unknown} response - Raw attribute response.
 * @param {unknown} vpcId - Exact requested VPC identity.
 * @param {'enableDnsSupport'|'enableDnsHostnames'} attribute - Requested attribute.
 * @returns {boolean} - Provider-observed attribute value.
 */
export function decodeAwsSingleNodeVpcAttributeResponse(
  response,
  vpcId,
  attribute,
) {
  const exactVpcId = validateAwsSingleNodeVpcId(vpcId);
  const responseKey =
    attribute === 'enableDnsSupport'
      ? 'EnableDnsSupport'
      : attribute === 'enableDnsHostnames'
        ? 'EnableDnsHostnames'
        : null;
  if (responseKey === null) {
    throw new TypeError('awsSingleNodeVpc attribute is not supported.');
  }
  if (
    !isPlainObject(response) ||
    typeof response.VpcId !== 'string' ||
    !isPlainObject(response[responseKey]) ||
    typeof response[responseKey].Value !== 'boolean'
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  validateAwsSingleNodeVpcId(response.VpcId);
  if (response.VpcId !== exactVpcId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const otherKey =
    responseKey === 'EnableDnsSupport'
      ? 'EnableDnsHostnames'
      : 'EnableDnsSupport';
  if (response[otherKey] !== undefined && response[otherKey] !== null) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return response[responseKey].Value;
}

/**
 * Decode complete readable provider state and derive its actual digest.
 * @param {unknown} value - One DescribeVpcs record.
 * @param {unknown} options - Exact DNS attributes and propagation policy.
 * @returns {Readonly<Record<string, any>>} - Identity and observed state digest.
 */
export function decodeAwsSingleNodeVpcActualState(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeVpc actual-state options must be an object.',
    );
  }
  assertExactKeys(
    options,
    ACTUAL_STATE_OPTIONS_KEYS,
    'awsSingleNodeVpc actual-state options',
  );
  if (
    typeof options.enableDnsSupport !== 'boolean' ||
    typeof options.enableDnsHostnames !== 'boolean'
  ) {
    throw new TypeError(
      'awsSingleNodeVpc actual-state DNS attributes must be booleans.',
    );
  }
  const state = decodeAwsSingleNodeVpcRecordState(
    value,
    options.allowPropagation,
  );
  if (state.state === 'pending') {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  if (state.state !== 'available') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return deepFreeze({
    providerResourceId: state.providerResourceId,
    ownerId: state.ownerId,
    observedDigest: createAwsSingleNodeVpcStateDigest({
      cidrBlock: state.cidrBlock,
      instanceTenancy: state.instanceTenancy,
      isDefault: state.isDefault,
      ipv6: state.ipv6,
      enableDnsSupport: options.enableDnsSupport,
      enableDnsHostnames: options.enableDnsHostnames,
      internetGatewayBlockMode: state.internetGatewayBlockMode,
      onDestroy: 'purge',
    }),
  });
}

export default {
  AWS_SINGLE_NODE_VPC_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VPC_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VPC_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VPC_STATE_DIGEST_DOMAIN,
  createAwsSingleNodeVpcEvidenceKernel,
  createAwsSingleNodeVpcStateDigest,
  decodeAwsSingleNodeExactVpcResponse,
  decodeAwsSingleNodeVpcActualState,
  decodeAwsSingleNodeVpcAttributeResponse,
  decodeAwsSingleNodeVpcDiscoveryPage,
  decodeAwsSingleNodeVpcIdentity,
  decodeAwsSingleNodeVpcRecordState,
  getAwsSingleNodeVpcStateDigest,
  validateAwsSingleNodeVpcId,
};
