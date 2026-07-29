/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This strict read-only planner keeps its AWS evidence protocol adjacent to its validators. */

import { isIPv4, isIPv6 } from 'node:net';

import { sortCanonicalJsonValue } from '../../canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../content-id.js';
import { cloneBoundedJsonObject } from '../../json-value.js';
import { assertManifestIsSecretFree } from '../../manifest-security.js';
import { validateProviderScope } from '../../deployment-provider-scope.js';
import { validateSingleNodeDeploymentDesired } from '../../single-node-deployment-desired.js';
import { getAwsSingleNodeDeploymentInventoryFilters } from './ownership.js';

export const AWS_SINGLE_NODE_PLAN_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_PLAN_KIND = 'awsSingleNodeDeploymentPlan';
export const AWS_SINGLE_NODE_PLAN_ID_PREFIX = 'wsap1';
export const AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX = 'wsas1';
export const AWS_SINGLE_NODE_ACTION_ID_PREFIX = 'wsna1';
export const AWS_SINGLE_NODE_INSTANCE_TYPE = 't3.small';
export const AWS_SINGLE_NODE_UBUNTU_PARAMETER =
  '/aws/service/canonical/ubuntu/server/noble/stable/current/amd64/hvm/ebs-gp3/ami-id';

const PLAN_ID_DOMAIN = 'wharfie:aws-single-node-plan:v1';
const PROVIDER_SPEC_ID_DOMAIN = 'wharfie:aws-single-node-provider-spec:v1';
const ACTION_ID_DOMAIN = 'wharfie:single-node-deployment-action:v1';
const EXPECTED_OWNED_RESOURCE_COUNT = 3;
const MAX_PAGES = 16;
const MAX_RECORDS = 4096;
const PLAN_MAX_BYTES = 256 * 1024;
const INPUT_KEYS = new Set(['desired', 'providerScope', 'api']);
const API_METHODS = Object.freeze([
  'getParameter',
  'describeImages',
  'describeInstanceTypeOfferings',
  'describeInstances',
  'describeInternetGateways',
  'describeNetworkAcls',
  'describeRouteTables',
  'describeSecurityGroups',
  'describeSubnets',
  'describeVolumes',
  'describeVpcs',
]);
const PLAN_KEYS = new Set([
  'schemaVersion',
  'kind',
  'planId',
  'deploymentInstanceId',
  'desired',
  'providerSpec',
  'inspection',
  'status',
  'blockedReason',
  'actions',
]);
const PROVIDER_SPEC_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerSpecId',
  'providerScope',
  'vpc',
  'subnet',
  'networkAcl',
  'routeTable',
  'internetGateway',
  'image',
  'instanceType',
  'ownedResourceCount',
]);
const PROVIDER_SPEC_PAYLOAD_KEYS = new Set(
  [...PROVIDER_SPEC_KEYS].filter((key) => key !== 'providerSpecId'),
);
const VPC_KEYS = new Set(['vpcId']);
const SUBNET_KEYS = new Set([
  'subnetId',
  'vpcId',
  'availabilityZone',
  'availabilityZoneId',
  'mapPublicIpOnLaunch',
]);
const ROUTE_TABLE_KEYS = new Set([
  'routeTableId',
  'vpcId',
  'destinationCidrBlock',
  'internetGatewayId',
]);
const INTERNET_GATEWAY_KEYS = new Set(['internetGatewayId', 'vpcId']);
const NETWORK_ACL_KEYS = new Set([
  'networkAclId',
  'vpcId',
  'subnetId',
  'associationId',
  'ipv4Ingress',
  'ipv4Egress',
]);
const NETWORK_ACL_RULE_RECEIPT_KEYS = new Set([
  'allowRuleNumber',
  'terminalDenyRuleNumber',
]);
const NETWORK_ACL_ASSOCIATION_KEYS = new Set([
  'NetworkAclAssociationId',
  'NetworkAclId',
  'SubnetId',
]);
const NETWORK_ACL_ENTRY_REQUIRED_KEYS = new Set([
  'RuleNumber',
  'Protocol',
  'RuleAction',
  'Egress',
]);
const NETWORK_ACL_ENTRY_KEYS = new Set([
  ...NETWORK_ACL_ENTRY_REQUIRED_KEYS,
  'CidrBlock',
  'Ipv6CidrBlock',
  'PortRange',
  'IcmpTypeCode',
]);
const PORT_RANGE_KEYS = new Set(['From', 'To']);
const ICMP_TYPE_CODE_KEYS = new Set(['Code', 'Type']);
const IMAGE_KEYS = new Set([
  'sourceParameter',
  'imageId',
  'ownerAccountId',
  'architecture',
  'rootDeviceType',
  'virtualizationType',
  'enaSupport',
  'rootDeviceName',
  'rootBlockDevice',
]);
const SOURCE_PARAMETER_KEYS = new Set(['name', 'version']);
const ROOT_BLOCK_DEVICE_KEYS = new Set([
  'snapshotId',
  'volumeType',
  'sizeGiB',
  'encrypted',
  'deleteOnTermination',
]);
const INSPECTION_KEYS = new Set(['status', 'observedOwnedResourceCount']);
const ACTION_KEYS = new Set(['actionId', 'kind', 'dependsOn']);
const ACTION_KINDS = Object.freeze([
  'provision-managed-node',
  'activate-application',
]);
const VPC_ID_PATTERN = /^vpc-[0-9a-f]{8,32}$/u;
const SUBNET_ID_PATTERN = /^subnet-[0-9a-f]{8,32}$/u;
const ROUTE_TABLE_ID_PATTERN = /^rtb-[0-9a-f]{8,32}$/u;
const INTERNET_GATEWAY_ID_PATTERN = /^igw-[0-9a-f]{8,32}$/u;
const NETWORK_ACL_ID_PATTERN = /^acl-[0-9a-f]{8,32}$/u;
const NETWORK_ACL_ASSOCIATION_ID_PATTERN = /^aclassoc-[0-9a-f]{8,32}$/u;
const AMI_ID_PATTERN = /^ami-[0-9a-f]{8,32}$/u;
const SNAPSHOT_ID_PATTERN = /^snap-[0-9a-f]{8,32}$/u;
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/u;
const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8,32}$/u;
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/u;
const AVAILABILITY_ZONE_PATTERN = /^[a-z][a-z0-9-]+[a-z0-9]$/u;
const AVAILABILITY_ZONE_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*-az[1-9][0-9]*$/u;
const ROOT_DEVICE_NAME_PATTERN =
  /^\/dev\/(?:xvd|sd|nvme)[a-z0-9]+(?:p[1-9][0-9]*)?$/u;
const IP_PROTOCOL_PATTERN = /^(?:-1|0|[1-9][0-9]{0,2})$/u;
const TERMINAL_NETWORK_ACL_RULE_NUMBER = 32767;
const ACTIVE_INSTANCE_STATES = Object.freeze([
  'pending',
  'running',
  'shutting-down',
  'stopping',
  'stopped',
]);

/** A provider read failed without exposing the raw SDK failure. */
export class AwsSingleNodePlanReadError extends Error {
  constructor() {
    super('AWS single-node planning read failed.');
    this.name = 'AwsSingleNodePlanReadError';
    this.code = 'AWS_SINGLE_NODE_PLAN_READ_FAILED';
  }
}

/** Provider evidence is missing, ambiguous, or contradicts the fixed plan. */
export class AwsSingleNodePlanEvidenceError extends Error {
  constructor() {
    super('AWS single-node planning evidence is invalid.');
    this.name = 'AwsSingleNodePlanEvidenceError';
    this.code = 'AWS_SINGLE_NODE_PLAN_EVIDENCE_INVALID';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value
 * @param {Set<string>} expected
 * @param {string} valuePath
 * @returns {Record<string, any>}
 */
function exactDataObject(value, expected, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new TypeError(`${valuePath} fields are invalid.`);
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data field.`);
    }
  }
  return object;
}

/** @param {unknown} value @param {RegExp} pattern @returns {string} */
function providerId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
function accountId(value) {
  if (typeof value !== 'string' || !ACCOUNT_ID_PATTERN.test(value)) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return value;
}

/**
 * Project only the ten read methods this planner owns. Unknown mutation
 * capabilities are neither inspected nor retained.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('awsSingleNodePlan.api must be an object.');
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of API_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `awsSingleNodePlan.api.${method} must be an own read method.`,
      );
    }
    /** @param {Readonly<Record<string, any>>} request */
    const invoke = (request) =>
      Reflect.apply(descriptor.value, undefined, [request]);
    result[method] = invoke;
  }
  return Object.freeze(result);
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} method
 * @param {Readonly<Record<string, any>>} request
 * @returns {Promise<unknown>}
 */
async function read(api, method, request) {
  try {
    return await api[method](request);
  } catch {
    throw new AwsSingleNodePlanReadError();
  }
}

/**
 * @param {unknown} value
 * @param {string} recordsKey
 * @returns {{records: Record<string, any>[], nextToken: string|null}}
 */
function decodePage(value, recordsKey) {
  if (!isPlainObject(value) || !Array.isArray(value[recordsKey])) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  let nextToken = null;
  if (value.NextToken !== undefined && value.NextToken !== null) {
    if (
      typeof value.NextToken !== 'string' ||
      value.NextToken.length === 0 ||
      value.NextToken.length > 4096
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    nextToken = value.NextToken;
  }
  return { records: value[recordsKey], nextToken };
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} method
 * @param {Readonly<Record<string, any>>} request
 * @param {string} recordsKey
 * @returns {Promise<Readonly<Record<string, any>[]>>}
 */
async function readAll(api, method, request, recordsKey) {
  const records = [];
  const seenTokens = new Set();
  let nextToken = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = decodePage(
      await read(
        api,
        method,
        deepFreeze({
          ...request,
          ...(nextToken === null ? {} : { NextToken: nextToken }),
        }),
      ),
      recordsKey,
    );
    records.push(...response.records);
    if (records.length > MAX_RECORDS) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    if (response.nextToken === null) return Object.freeze(records);
    if (
      page === MAX_PAGES ||
      seenTokens.has(response.nextToken) ||
      response.nextToken === nextToken
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    seenTokens.add(response.nextToken);
    nextToken = response.nextToken;
  }
  throw new AwsSingleNodePlanEvidenceError();
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} expectedOwnerId
 * @returns {Promise<Readonly<{vpcId: string}>>}
 */
async function resolveDefaultVpc(api, expectedOwnerId) {
  const records = await readAll(
    api,
    'describeVpcs',
    {
      Filters: [{ Name: 'is-default', Values: ['true'] }],
      MaxResults: 100,
    },
    'Vpcs',
  );
  if (records.length !== 1) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const vpc = records[0];
  if (
    !isPlainObject(vpc) ||
    vpc.OwnerId !== expectedOwnerId ||
    vpc.IsDefault !== true ||
    vpc.State !== 'available'
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze({ vpcId: providerId(vpc.VpcId, VPC_ID_PATTERN) });
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} vpcId
 * @param {string} expectedOwnerId
 * @param {Readonly<Set<string>>} offeredZoneIds
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function resolveDefaultSubnet(
  api,
  vpcId,
  expectedOwnerId,
  offeredZoneIds,
) {
  const records = await readAll(
    api,
    'describeSubnets',
    {
      Filters: [
        { Name: 'vpc-id', Values: [vpcId] },
        { Name: 'default-for-az', Values: ['true'] },
        { Name: 'state', Values: ['available'] },
      ],
      MaxResults: 1000,
    },
    'Subnets',
  );
  const candidates = [];
  for (const subnet of records) {
    if (
      !isPlainObject(subnet) ||
      subnet.VpcId !== vpcId ||
      subnet.OwnerId !== expectedOwnerId ||
      subnet.State !== 'available' ||
      subnet.DefaultForAz !== true ||
      typeof subnet.MapPublicIpOnLaunch !== 'boolean' ||
      typeof subnet.Ipv6Native !== 'boolean' ||
      !Number.isSafeInteger(subnet.AvailableIpAddressCount) ||
      subnet.AvailableIpAddressCount < 0 ||
      typeof subnet.AvailabilityZone !== 'string' ||
      !AVAILABILITY_ZONE_PATTERN.test(subnet.AvailabilityZone) ||
      typeof subnet.AvailabilityZoneId !== 'string' ||
      !AVAILABILITY_ZONE_ID_PATTERN.test(subnet.AvailabilityZoneId)
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    const subnetId = providerId(subnet.SubnetId, SUBNET_ID_PATTERN);
    if (
      subnet.MapPublicIpOnLaunch !== true ||
      subnet.Ipv6Native === true ||
      subnet.AvailableIpAddressCount === 0
    ) {
      continue;
    }
    candidates.push({
      subnetId,
      vpcId,
      availabilityZone: subnet.AvailabilityZone,
      availabilityZoneId: subnet.AvailabilityZoneId,
      mapPublicIpOnLaunch: true,
    });
  }
  const offered = candidates
    .filter((candidate) => offeredZoneIds.has(candidate.availabilityZoneId))
    .sort(
      (left, right) =>
        left.availabilityZoneId.localeCompare(right.availabilityZoneId) ||
        left.subnetId.localeCompare(right.subnetId),
    );
  if (offered.length === 0) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze(offered[0]);
}

/**
 * Validate one provider-returned network ACL entry without admitting hidden
 * fields or malformed CIDRs.
 * @param {unknown} value
 * @returns {Readonly<Record<string, any>>}
 */
function decodeNetworkAclEntry(value) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const entry = /** @type {Record<string, any>} */ (value);
  const keys = Reflect.ownKeys(entry);
  if (
    keys.some(
      (key) => typeof key !== 'string' || !NETWORK_ACL_ENTRY_KEYS.has(key),
    ) ||
    [...NETWORK_ACL_ENTRY_REQUIRED_KEYS].some(
      (key) => !Object.hasOwn(entry, key),
    )
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(entry, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
  }
  if (
    !Number.isSafeInteger(entry.RuleNumber) ||
    entry.RuleNumber < 1 ||
    entry.RuleNumber > TERMINAL_NETWORK_ACL_RULE_NUMBER ||
    typeof entry.Protocol !== 'string' ||
    !IP_PROTOCOL_PATTERN.test(entry.Protocol) ||
    Number(entry.Protocol) > 255 ||
    !['allow', 'deny'].includes(entry.RuleAction) ||
    typeof entry.Egress !== 'boolean'
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const ipv4 = typeof entry.CidrBlock === 'string';
  const ipv6 = typeof entry.Ipv6CidrBlock === 'string';
  if (ipv4 === ipv6) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const cidr = ipv4 ? entry.CidrBlock : entry.Ipv6CidrBlock;
  const parts = cidr.split('/');
  const prefixPattern = /^(?:0|[1-9][0-9]{0,2})$/u;
  if (
    parts.length !== 2 ||
    !(ipv4 ? isIPv4(parts[0]) : isIPv6(parts[0])) ||
    !prefixPattern.test(parts[1]) ||
    Number(parts[1]) > (ipv4 ? 32 : 128)
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  if (entry.PortRange !== undefined) {
    let range;
    try {
      range = exactDataObject(
        entry.PortRange,
        PORT_RANGE_KEYS,
        'awsSingleNodePlan.networkAclEntry.PortRange',
      );
    } catch {
      throw new AwsSingleNodePlanEvidenceError();
    }
    if (
      !['6', '17'].includes(entry.Protocol) ||
      !Number.isSafeInteger(range.From) ||
      !Number.isSafeInteger(range.To) ||
      range.From < 0 ||
      range.To > 65535 ||
      range.From > range.To
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
  }
  if (entry.IcmpTypeCode !== undefined) {
    let icmp;
    try {
      icmp = exactDataObject(
        entry.IcmpTypeCode,
        ICMP_TYPE_CODE_KEYS,
        'awsSingleNodePlan.networkAclEntry.IcmpTypeCode',
      );
    } catch {
      throw new AwsSingleNodePlanEvidenceError();
    }
    if (
      !['1', '58'].includes(entry.Protocol) ||
      !Number.isSafeInteger(icmp.Code) ||
      !Number.isSafeInteger(icmp.Type) ||
      icmp.Code < -1 ||
      icmp.Code > 255 ||
      icmp.Type < -1 ||
      icmp.Type > 255
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
  }
  return entry;
}

/**
 * @param {unknown} value
 * @param {string} expectedNetworkAclId
 * @returns {Readonly<Record<string, string>>}
 */
function decodeNetworkAclAssociation(value, expectedNetworkAclId) {
  let association;
  try {
    association = exactDataObject(
      value,
      NETWORK_ACL_ASSOCIATION_KEYS,
      'awsSingleNodePlan.networkAclAssociation',
    );
  } catch {
    throw new AwsSingleNodePlanEvidenceError();
  }
  if (association.NetworkAclId !== expectedNetworkAclId) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze({
    associationId: providerId(
      association.NetworkAclAssociationId,
      NETWORK_ACL_ASSOCIATION_ID_PATTERN,
    ),
    networkAclId: expectedNetworkAclId,
    subnetId: providerId(association.SubnetId, SUBNET_ID_PATTERN),
  });
}

/**
 * Require the exact effective IPv4 rule pair AWS installs on a default ACL.
 * IPv6 rules are independently evaluated by AWS and cannot satisfy this
 * receipt.
 * @param {Readonly<Record<string, any>[]>} entries
 * @param {boolean} egress
 * @returns {Readonly<Record<string, number>>}
 */
function resolveNetworkAclIpv4Rules(entries, egress) {
  const ipv4Entries = entries
    .filter((entry) => entry.Egress === egress && entry.CidrBlock !== undefined)
    .sort((left, right) => left.RuleNumber - right.RuleNumber);
  if (ipv4Entries.length !== 2) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const [allow, terminalDeny] = ipv4Entries;
  if (
    allow.RuleNumber >= TERMINAL_NETWORK_ACL_RULE_NUMBER ||
    allow.Protocol !== '-1' ||
    allow.RuleAction !== 'allow' ||
    allow.CidrBlock !== '0.0.0.0/0' ||
    allow.Ipv6CidrBlock !== undefined ||
    allow.PortRange !== undefined ||
    allow.IcmpTypeCode !== undefined ||
    terminalDeny.RuleNumber !== TERMINAL_NETWORK_ACL_RULE_NUMBER ||
    terminalDeny.Protocol !== '-1' ||
    terminalDeny.RuleAction !== 'deny' ||
    terminalDeny.CidrBlock !== '0.0.0.0/0' ||
    terminalDeny.Ipv6CidrBlock !== undefined ||
    terminalDeny.PortRange !== undefined ||
    terminalDeny.IcmpTypeCode !== undefined
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze({
    allowRuleNumber: allow.RuleNumber,
    terminalDenyRuleNumber: TERMINAL_NETWORK_ACL_RULE_NUMBER,
  });
}

/**
 * Resolve the one network ACL association effective for the selected subnet.
 * @param {Readonly<Record<string, Function>>} api
 * @param {Readonly<Record<string, any>>} vpc
 * @param {Readonly<Record<string, any>>} subnet
 * @param {string} expectedOwnerId
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function resolveNetworkAcl(api, vpc, subnet, expectedOwnerId) {
  const records = await readAll(
    api,
    'describeNetworkAcls',
    {
      Filters: [
        { Name: 'association.subnet-id', Values: [subnet.subnetId] },
        { Name: 'vpc-id', Values: [vpc.vpcId] },
      ],
      MaxResults: 100,
    },
    'NetworkAcls',
  );
  if (records.length !== 1) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const networkAcl = records[0];
  if (
    !isPlainObject(networkAcl) ||
    networkAcl.OwnerId !== expectedOwnerId ||
    networkAcl.VpcId !== vpc.vpcId ||
    !Array.isArray(networkAcl.Associations) ||
    !Array.isArray(networkAcl.Entries)
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const networkAclId = providerId(
    networkAcl.NetworkAclId,
    NETWORK_ACL_ID_PATTERN,
  );
  for (let index = 0; index < networkAcl.Associations.length; index += 1) {
    if (!Object.hasOwn(networkAcl.Associations, index)) {
      throw new AwsSingleNodePlanEvidenceError();
    }
  }
  for (let index = 0; index < networkAcl.Entries.length; index += 1) {
    if (!Object.hasOwn(networkAcl.Entries, index)) {
      throw new AwsSingleNodePlanEvidenceError();
    }
  }
  const associations = networkAcl.Associations.map((association) =>
    decodeNetworkAclAssociation(association, networkAclId),
  ).filter((association) => association.subnetId === subnet.subnetId);
  if (associations.length !== 1) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const association = associations[0];
  const entries = networkAcl.Entries.map(decodeNetworkAclEntry);
  const ipv4Ingress = resolveNetworkAclIpv4Rules(entries, false);
  const ipv4Egress = resolveNetworkAclIpv4Rules(entries, true);
  return deepFreeze({
    networkAclId,
    vpcId: vpc.vpcId,
    subnetId: subnet.subnetId,
    associationId: association.associationId,
    ipv4Ingress,
    ipv4Egress,
  });
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @returns {Promise<Readonly<Set<string>>>}
 */
async function resolveInstanceTypeOfferings(api) {
  const records = await readAll(
    api,
    'describeInstanceTypeOfferings',
    {
      LocationType: 'availability-zone-id',
      Filters: [
        { Name: 'instance-type', Values: [AWS_SINGLE_NODE_INSTANCE_TYPE] },
      ],
      MaxResults: 1000,
    },
    'InstanceTypeOfferings',
  );
  const locations = new Set();
  for (const offering of records) {
    if (
      !isPlainObject(offering) ||
      offering.InstanceType !== AWS_SINGLE_NODE_INSTANCE_TYPE ||
      typeof offering.Location !== 'string' ||
      !AVAILABILITY_ZONE_ID_PATTERN.test(offering.Location)
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    if (locations.has(offering.Location)) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    locations.add(offering.Location);
  }
  if (locations.size === 0) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return Object.freeze(locations);
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {Readonly<Record<string, any>>} vpc
 * @param {Readonly<Record<string, any>>} subnet
 * @param {string} expectedOwnerId
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function resolveInternetRoute(api, vpc, subnet, expectedOwnerId) {
  const routeTables = await readAll(
    api,
    'describeRouteTables',
    {
      Filters: [{ Name: 'vpc-id', Values: [vpc.vpcId] }],
      MaxResults: 200,
    },
    'RouteTables',
  );
  const normalized = routeTables.map((table) => {
    if (
      !isPlainObject(table) ||
      table.VpcId !== vpc.vpcId ||
      table.OwnerId !== expectedOwnerId ||
      !Array.isArray(table.Associations) ||
      !Array.isArray(table.Routes)
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    return {
      raw: table,
      routeTableId: providerId(table.RouteTableId, ROUTE_TABLE_ID_PATTERN),
      explicit: table.Associations.some(
        (association) =>
          isPlainObject(association) &&
          association.SubnetId === subnet.subnetId &&
          association.Main === false &&
          (association.AssociationState === undefined ||
            (isPlainObject(association.AssociationState) &&
              association.AssociationState.State === 'associated')),
      ),
      main: table.Associations.some(
        (association) =>
          isPlainObject(association) &&
          association.Main === true &&
          (association.AssociationState === undefined ||
            (isPlainObject(association.AssociationState) &&
              association.AssociationState.State === 'associated')),
      ),
    };
  });
  const explicit = normalized.filter((table) => table.explicit);
  const selected =
    explicit.length === 1
      ? explicit[0]
      : explicit.length === 0
        ? normalized.filter((table) => table.main)[0]
        : null;
  if (
    selected === null ||
    (explicit.length === 0 &&
      normalized.filter((table) => table.main).length !== 1)
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const routes = selected.raw.Routes.filter(
    (/** @type {unknown} */ route) =>
      isPlainObject(route) && route.DestinationCidrBlock === '0.0.0.0/0',
  );
  if (routes.length !== 1) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const route = routes[0];
  if (
    route.State !== 'active' ||
    (route.Origin !== undefined && route.Origin !== 'CreateRoute')
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const internetGatewayId = providerId(
    route.GatewayId,
    INTERNET_GATEWAY_ID_PATTERN,
  );
  const gateways = await readAll(
    api,
    'describeInternetGateways',
    {
      Filters: [
        { Name: 'internet-gateway-id', Values: [internetGatewayId] },
        { Name: 'attachment.vpc-id', Values: [vpc.vpcId] },
      ],
      MaxResults: 100,
    },
    'InternetGateways',
  );
  if (gateways.length !== 1) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const gateway = gateways[0];
  if (
    !isPlainObject(gateway) ||
    gateway.InternetGatewayId !== internetGatewayId ||
    gateway.OwnerId !== expectedOwnerId ||
    !Array.isArray(gateway.Attachments) ||
    gateway.Attachments.length !== 1 ||
    !isPlainObject(gateway.Attachments[0]) ||
    gateway.Attachments[0].VpcId !== vpc.vpcId ||
    gateway.Attachments[0].State !== 'available'
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze({
    routeTable: {
      routeTableId: selected.routeTableId,
      vpcId: vpc.vpcId,
      destinationCidrBlock: '0.0.0.0/0',
      internetGatewayId,
    },
    internetGateway: {
      internetGatewayId,
      vpcId: vpc.vpcId,
    },
  });
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} providerScope
 * @returns {Readonly<{name: string, version: number, imageId: string}>}
 */
function decodeUbuntuParameter(value, providerScope) {
  if (!isPlainObject(value) || !isPlainObject(value.Parameter)) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const parameter = value.Parameter;
  const expectedArn = `arn:${providerScope.partition}:ssm:${providerScope.region}::parameter${AWS_SINGLE_NODE_UBUNTU_PARAMETER}`;
  if (
    parameter.Name !== AWS_SINGLE_NODE_UBUNTU_PARAMETER ||
    parameter.Type !== 'String' ||
    parameter.DataType !== 'text' ||
    parameter.ARN !== expectedArn ||
    typeof parameter.Value !== 'string' ||
    !AMI_ID_PATTERN.test(parameter.Value) ||
    !Number.isSafeInteger(parameter.Version) ||
    parameter.Version < 1 ||
    (parameter.Selector !== undefined && parameter.Selector !== null) ||
    parameter.SourceResult !== undefined
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze({
    name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
    version: parameter.Version,
    imageId: parameter.Value,
  });
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} selection
 * @returns {Readonly<Record<string, any>>}
 */
function decodeUbuntuImage(value, selection) {
  if (
    !isPlainObject(value) ||
    !Array.isArray(value.Images) ||
    value.Images.length !== 1 ||
    (value.NextToken !== undefined && value.NextToken !== null)
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const image = value.Images[0];
  if (
    !isPlainObject(image) ||
    image.ImageId !== selection.imageId ||
    image.State !== 'available' ||
    image.Public !== true ||
    image.Architecture !== 'x86_64' ||
    image.ImageType !== 'machine' ||
    image.RootDeviceType !== 'ebs' ||
    image.VirtualizationType !== 'hvm' ||
    image.EnaSupport !== true ||
    image.Platform !== undefined ||
    image.PlatformDetails !== 'Linux/UNIX' ||
    image.PublicSsmParameterName !== selection.name.slice(1) ||
    image.ImageAllowed === false ||
    !Array.isArray(image.BlockDeviceMappings) ||
    image.BlockDeviceMappings.length !== 1 ||
    !isPlainObject(image.BlockDeviceMappings[0])
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const rootDeviceName =
    typeof image.RootDeviceName === 'string' &&
    ROOT_DEVICE_NAME_PATTERN.test(image.RootDeviceName)
      ? image.RootDeviceName
      : null;
  const mapping = image.BlockDeviceMappings[0];
  if (
    rootDeviceName === null ||
    mapping.DeviceName !== rootDeviceName ||
    mapping.VirtualName !== undefined ||
    mapping.NoDevice !== undefined ||
    !isPlainObject(mapping.Ebs)
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const ebs = mapping.Ebs;
  if (
    ebs.VolumeType !== 'gp3' ||
    !Number.isSafeInteger(ebs.VolumeSize) ||
    ebs.VolumeSize < 8 ||
    ebs.VolumeSize > 64 ||
    typeof ebs.Encrypted !== 'boolean' ||
    ebs.DeleteOnTermination !== true
  ) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  return deepFreeze({
    sourceParameter: {
      name: selection.name,
      version: selection.version,
    },
    imageId: selection.imageId,
    ownerAccountId: accountId(image.OwnerId),
    architecture: 'x86_64',
    rootDeviceType: 'ebs',
    virtualizationType: 'hvm',
    enaSupport: true,
    rootDeviceName,
    rootBlockDevice: {
      snapshotId: providerId(ebs.SnapshotId, SNAPSHOT_ID_PATTERN),
      volumeType: 'gp3',
      sizeGiB: ebs.VolumeSize,
      encrypted: ebs.Encrypted,
      deleteOnTermination: true,
    },
  });
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {Readonly<Record<string, any>>} providerScope
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function resolveUbuntuImage(api, providerScope) {
  const selection = decodeUbuntuParameter(
    await read(
      api,
      'getParameter',
      deepFreeze({
        Name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
        WithDecryption: false,
      }),
    ),
    providerScope,
  );
  return decodeUbuntuImage(
    await read(
      api,
      'describeImages',
      deepFreeze({
        ImageIds: [selection.imageId],
        IncludeDeprecated: false,
        IncludeDisabled: false,
      }),
    ),
    selection,
  );
}

/**
 * @param {unknown} value
 * @param {RegExp} idPattern
 * @param {string} idKey
 * @returns {number}
 */
function countFlatInventory(value, idPattern, idKey) {
  if (!Array.isArray(value)) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const ids = new Set();
  for (const record of value) {
    if (!isPlainObject(record)) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    const id = providerId(record[idKey], idPattern);
    ids.add(id);
  }
  return ids.size;
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {Readonly<Record<string, any>>} request
 * @returns {Promise<Readonly<Record<string, any>[]>>}
 */
async function readAllInstances(api, request) {
  const instances = [];
  const seenTokens = new Set();
  let reservationCount = 0;
  let nextToken = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const response = decodePage(
      await read(
        api,
        'describeInstances',
        deepFreeze({
          ...request,
          ...(nextToken === null ? {} : { NextToken: nextToken }),
        }),
      ),
      'Reservations',
    );
    reservationCount += response.records.length;
    if (reservationCount > MAX_RECORDS) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    for (const reservation of response.records) {
      if (
        !isPlainObject(reservation) ||
        !Array.isArray(reservation.Instances)
      ) {
        throw new AwsSingleNodePlanEvidenceError();
      }
      instances.push(...reservation.Instances);
      if (instances.length > MAX_RECORDS) {
        throw new AwsSingleNodePlanEvidenceError();
      }
    }
    if (response.nextToken === null) return Object.freeze(instances);
    if (
      page === MAX_PAGES ||
      seenTokens.has(response.nextToken) ||
      response.nextToken === nextToken
    ) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    seenTokens.add(response.nextToken);
    nextToken = response.nextToken;
  }
  throw new AwsSingleNodePlanEvidenceError();
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function countInstanceInventory(value) {
  if (!Array.isArray(value)) {
    throw new AwsSingleNodePlanEvidenceError();
  }
  const ids = new Set();
  for (const instance of value) {
    if (!isPlainObject(instance)) {
      throw new AwsSingleNodePlanEvidenceError();
    }
    ids.add(providerId(instance.InstanceId, INSTANCE_ID_PATTERN));
  }
  return ids.size;
}

/**
 * Inventory only deployment-wide tags. A fresh plan has no local incarnation
 * authority with which it could safely adopt any match.
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} deploymentInstanceId
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function inspectOwnedResources(api, deploymentInstanceId) {
  const filters =
    getAwsSingleNodeDeploymentInventoryFilters(deploymentInstanceId);
  const [groups, instances, volumes] = await Promise.all([
    readAll(
      api,
      'describeSecurityGroups',
      { Filters: filters, MaxResults: 1000 },
      'SecurityGroups',
    ),
    readAllInstances(api, {
      Filters: [
        ...filters,
        {
          Name: 'instance-state-name',
          Values: ACTIVE_INSTANCE_STATES,
        },
      ],
      MaxResults: 1000,
    }),
    readAll(
      api,
      'describeVolumes',
      { Filters: filters, MaxResults: 500 },
      'Volumes',
    ),
  ]);
  const observedOwnedResourceCount =
    countFlatInventory(groups, SECURITY_GROUP_ID_PATTERN, 'GroupId') +
    countInstanceInventory(instances) +
    countFlatInventory(volumes, VOLUME_ID_PATTERN, 'VolumeId');
  return deepFreeze({
    status: observedOwnedResourceCount === 0 ? 'absent' : 'unbound-conflict',
    observedOwnedResourceCount,
  });
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {Readonly<Record<string, number>>}
 */
function validateNetworkAclRuleReceipt(value, valuePath) {
  const receipt = exactDataObject(
    value,
    NETWORK_ACL_RULE_RECEIPT_KEYS,
    valuePath,
  );
  if (
    !Number.isSafeInteger(receipt.allowRuleNumber) ||
    receipt.allowRuleNumber < 1 ||
    receipt.allowRuleNumber >= TERMINAL_NETWORK_ACL_RULE_NUMBER ||
    receipt.terminalDenyRuleNumber !== TERMINAL_NETWORK_ACL_RULE_NUMBER
  ) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return deepFreeze({
    allowRuleNumber: receipt.allowRuleNumber,
    terminalDenyRuleNumber: TERMINAL_NETWORK_ACL_RULE_NUMBER,
  });
}

/**
 * @param {unknown} value
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>>}
 */
function validateProviderSpec(value, valuePath) {
  const spec = cloneBoundedJsonObject(value, 64 * 1024, valuePath);
  exactDataObject(spec, PROVIDER_SPEC_KEYS, valuePath);
  if (spec.schemaVersion !== 1 || spec.kind !== 'awsSingleNodeProviderSpec') {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  assertDomainSeparatedSha256Id(
    spec.providerSpecId,
    AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    `${valuePath}.providerSpecId`,
  );
  const providerScope = validateProviderScope(
    spec.providerScope,
    `${valuePath}.providerScope`,
  );
  const vpc = exactDataObject(spec.vpc, VPC_KEYS, `${valuePath}.vpc`);
  const vpcId = providerId(vpc.vpcId, VPC_ID_PATTERN);
  const subnet = exactDataObject(
    spec.subnet,
    SUBNET_KEYS,
    `${valuePath}.subnet`,
  );
  if (
    subnet.vpcId !== vpcId ||
    typeof subnet.availabilityZone !== 'string' ||
    !AVAILABILITY_ZONE_PATTERN.test(subnet.availabilityZone) ||
    typeof subnet.availabilityZoneId !== 'string' ||
    !AVAILABILITY_ZONE_ID_PATTERN.test(subnet.availabilityZoneId) ||
    subnet.mapPublicIpOnLaunch !== true
  ) {
    throw new TypeError(`${valuePath}.subnet is invalid.`);
  }
  const networkAcl = exactDataObject(
    spec.networkAcl,
    NETWORK_ACL_KEYS,
    `${valuePath}.networkAcl`,
  );
  const networkAclId = providerId(
    networkAcl.networkAclId,
    NETWORK_ACL_ID_PATTERN,
  );
  const associationId = providerId(
    networkAcl.associationId,
    NETWORK_ACL_ASSOCIATION_ID_PATTERN,
  );
  if (networkAcl.vpcId !== vpcId || networkAcl.subnetId !== subnet.subnetId) {
    throw new TypeError(`${valuePath}.networkAcl references conflict.`);
  }
  const ipv4Ingress = validateNetworkAclRuleReceipt(
    networkAcl.ipv4Ingress,
    `${valuePath}.networkAcl.ipv4Ingress`,
  );
  const ipv4Egress = validateNetworkAclRuleReceipt(
    networkAcl.ipv4Egress,
    `${valuePath}.networkAcl.ipv4Egress`,
  );
  const routeTable = exactDataObject(
    spec.routeTable,
    ROUTE_TABLE_KEYS,
    `${valuePath}.routeTable`,
  );
  const internetGateway = exactDataObject(
    spec.internetGateway,
    INTERNET_GATEWAY_KEYS,
    `${valuePath}.internetGateway`,
  );
  const internetGatewayId = providerId(
    internetGateway.internetGatewayId,
    INTERNET_GATEWAY_ID_PATTERN,
  );
  if (
    routeTable.vpcId !== vpcId ||
    routeTable.destinationCidrBlock !== '0.0.0.0/0' ||
    routeTable.internetGatewayId !== internetGatewayId ||
    internetGateway.vpcId !== vpcId
  ) {
    throw new TypeError(`${valuePath} network references conflict.`);
  }
  const image = exactDataObject(spec.image, IMAGE_KEYS, `${valuePath}.image`);
  const sourceParameter = exactDataObject(
    image.sourceParameter,
    SOURCE_PARAMETER_KEYS,
    `${valuePath}.image.sourceParameter`,
  );
  const root = exactDataObject(
    image.rootBlockDevice,
    ROOT_BLOCK_DEVICE_KEYS,
    `${valuePath}.image.rootBlockDevice`,
  );
  if (
    sourceParameter.name !== AWS_SINGLE_NODE_UBUNTU_PARAMETER ||
    !Number.isSafeInteger(sourceParameter.version) ||
    sourceParameter.version < 1 ||
    image.architecture !== 'x86_64' ||
    image.rootDeviceType !== 'ebs' ||
    image.virtualizationType !== 'hvm' ||
    image.enaSupport !== true ||
    typeof image.rootDeviceName !== 'string' ||
    !ROOT_DEVICE_NAME_PATTERN.test(image.rootDeviceName) ||
    root.volumeType !== 'gp3' ||
    !Number.isSafeInteger(root.sizeGiB) ||
    root.sizeGiB < 8 ||
    root.sizeGiB > 64 ||
    typeof root.encrypted !== 'boolean' ||
    root.deleteOnTermination !== true
  ) {
    throw new TypeError(`${valuePath}.image is invalid.`);
  }
  providerId(image.imageId, AMI_ID_PATTERN);
  accountId(image.ownerAccountId);
  providerId(root.snapshotId, SNAPSHOT_ID_PATTERN);
  providerId(subnet.subnetId, SUBNET_ID_PATTERN);
  providerId(routeTable.routeTableId, ROUTE_TABLE_ID_PATTERN);
  if (
    spec.instanceType !== AWS_SINGLE_NODE_INSTANCE_TYPE ||
    spec.ownedResourceCount !== EXPECTED_OWNED_RESOURCE_COUNT
  ) {
    throw new TypeError(`${valuePath} fixed substrate is invalid.`);
  }
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeProviderSpec',
      providerScope,
      vpc: { vpcId },
      subnet: {
        subnetId: subnet.subnetId,
        vpcId,
        availabilityZone: subnet.availabilityZone,
        availabilityZoneId: subnet.availabilityZoneId,
        mapPublicIpOnLaunch: true,
      },
      networkAcl: {
        networkAclId,
        vpcId,
        subnetId: subnet.subnetId,
        associationId,
        ipv4Ingress,
        ipv4Egress,
      },
      routeTable: {
        routeTableId: routeTable.routeTableId,
        vpcId,
        destinationCidrBlock: '0.0.0.0/0',
        internetGatewayId,
      },
      internetGateway: { internetGatewayId, vpcId },
      image: {
        sourceParameter: {
          name: AWS_SINGLE_NODE_UBUNTU_PARAMETER,
          version: sourceParameter.version,
        },
        imageId: image.imageId,
        ownerAccountId: image.ownerAccountId,
        architecture: 'x86_64',
        rootDeviceType: 'ebs',
        virtualizationType: 'hvm',
        enaSupport: true,
        rootDeviceName: image.rootDeviceName,
        rootBlockDevice: {
          snapshotId: root.snapshotId,
          volumeType: 'gp3',
          sizeGiB: root.sizeGiB,
          encrypted: root.encrypted,
          deleteOnTermination: true,
        },
      },
      instanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
      ownedResourceCount: EXPECTED_OWNED_RESOURCE_COUNT,
    }),
  );
  exactDataObject(payload, PROVIDER_SPEC_PAYLOAD_KEYS, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: PROVIDER_SPEC_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (spec.providerSpecId !== expectedId) {
    throw new Error(
      `${valuePath}.providerSpecId does not match the exact AWS selection.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, providerSpecId: expectedId }),
  );
}

/**
 * @param {Readonly<Record<string, any>>} payload
 * @returns {Readonly<Record<string, any>>}
 */
function createProviderSpec(payload) {
  const providerSpecId = createCanonicalJsonSha256Id({
    domain: PROVIDER_SPEC_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
    value: payload,
    valuePath: 'awsSingleNodePlan.providerSpec',
  });
  return validateProviderSpec(
    { ...payload, providerSpecId },
    'awsSingleNodePlan.providerSpec',
  );
}

/**
 * @param {string} kind
 * @param {string[]} dependsOn
 * @param {Readonly<Record<string, any>>} desired
 * @param {Readonly<Record<string, any>>} providerSpec
 * @returns {Readonly<Record<string, any>>}
 */
function createAction(kind, dependsOn, desired, providerSpec) {
  const payload = {
    kind,
    dependsOn: [...dependsOn],
    deploymentInstanceId: desired.deploymentInstanceId,
    desiredRevisionId: desired.desiredRevisionId,
    providerSpecId: providerSpec.providerSpecId,
  };
  return deepFreeze({
    actionId: createCanonicalJsonSha256Id({
      domain: ACTION_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_ACTION_ID_PREFIX,
      value: payload,
      valuePath: 'awsSingleNodePlan.action',
    }),
    kind,
    dependsOn: [...dependsOn],
  });
}

/**
 * @param {Readonly<Record<string, any>>} desired
 * @param {Readonly<Record<string, any>>} providerSpec
 * @returns {Readonly<Record<string, any>[]>}
 */
function createActions(desired, providerSpec) {
  const provision = createAction(
    'provision-managed-node',
    [],
    desired,
    providerSpec,
  );
  return deepFreeze([
    provision,
    createAction(
      'activate-application',
      [provision.actionId],
      desired,
      providerSpec,
    ),
  ]);
}

/**
 * @param {unknown} value
 * @param {Readonly<Record<string, any>>} desired
 * @param {Readonly<Record<string, any>>} providerSpec
 * @param {string} valuePath
 * @returns {Readonly<Record<string, any>[]>}
 */
function validateActions(value, desired, providerSpec, valuePath) {
  if (!Array.isArray(value) || value.length > ACTION_KINDS.length) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  const actions = value.map((action, index) => {
    const actionPath = `${valuePath}[${index}]`;
    const candidate = exactDataObject(action, ACTION_KEYS, actionPath);
    assertDomainSeparatedSha256Id(
      candidate.actionId,
      AWS_SINGLE_NODE_ACTION_ID_PREFIX,
      `${actionPath}.actionId`,
    );
    if (
      typeof candidate.kind !== 'string' ||
      !ACTION_KINDS.includes(candidate.kind) ||
      !Array.isArray(candidate.dependsOn)
    ) {
      throw new TypeError(`${actionPath} is invalid.`);
    }
    for (const dependency of candidate.dependsOn) {
      assertDomainSeparatedSha256Id(
        dependency,
        AWS_SINGLE_NODE_ACTION_ID_PREFIX,
        `${actionPath}.dependsOn`,
      );
    }
    return deepFreeze({
      actionId: candidate.actionId,
      kind: candidate.kind,
      dependsOn: [...candidate.dependsOn],
    });
  });
  const expected = createActions(desired, providerSpec);
  if (JSON.stringify(actions) !== JSON.stringify(expected)) {
    throw new Error(`${valuePath} does not match the exact aggregate plan.`);
  }
  return deepFreeze(actions);
}

/**
 * Validate one serialized AWS single-node plan and recompute all content IDs.
 * @param {unknown} value
 * @param {string} [valuePath]
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodePlan(
  value,
  valuePath = 'awsSingleNodePlan',
) {
  const plan = cloneBoundedJsonObject(value, PLAN_MAX_BYTES, valuePath);
  exactDataObject(plan, PLAN_KEYS, valuePath);
  if (
    plan.schemaVersion !== AWS_SINGLE_NODE_PLAN_SCHEMA_VERSION ||
    plan.kind !== AWS_SINGLE_NODE_PLAN_KIND
  ) {
    throw new TypeError(`${valuePath} has an unsupported contract.`);
  }
  assertDomainSeparatedSha256Id(
    plan.planId,
    AWS_SINGLE_NODE_PLAN_ID_PREFIX,
    `${valuePath}.planId`,
  );
  const desired = validateSingleNodeDeploymentDesired(
    plan.desired,
    `${valuePath}.desired`,
  );
  if (
    plan.deploymentInstanceId !== desired.deploymentInstanceId ||
    desired.intent.provider.kind !== 'aws'
  ) {
    throw new Error(`${valuePath} does not match an AWS desired state.`);
  }
  const providerSpec = validateProviderSpec(
    plan.providerSpec,
    `${valuePath}.providerSpec`,
  );
  if (providerSpec.providerScope.region !== desired.intent.provider.region) {
    throw new Error(`${valuePath} AWS region authority conflicts.`);
  }
  const inspectionValue = exactDataObject(
    plan.inspection,
    INSPECTION_KEYS,
    `${valuePath}.inspection`,
  );
  if (
    !Number.isSafeInteger(inspectionValue.observedOwnedResourceCount) ||
    inspectionValue.observedOwnedResourceCount < 0 ||
    inspectionValue.observedOwnedResourceCount >
      EXPECTED_OWNED_RESOURCE_COUNT ||
    !['absent', 'unbound-conflict'].includes(inspectionValue.status) ||
    (inspectionValue.observedOwnedResourceCount === 0) !==
      (inspectionValue.status === 'absent')
  ) {
    throw new TypeError(`${valuePath}.inspection is invalid.`);
  }
  const inspection = deepFreeze({
    status: inspectionValue.status,
    observedOwnedResourceCount: inspectionValue.observedOwnedResourceCount,
  });
  const actionable = inspection.status === 'absent';
  if (
    plan.status !== (actionable ? 'actionable' : 'blocked') ||
    plan.blockedReason !== (actionable ? null : 'unbound-provider-resources')
  ) {
    throw new Error(`${valuePath} status conflicts with provider inventory.`);
  }
  const actions = actionable
    ? validateActions(
        plan.actions,
        desired,
        providerSpec,
        `${valuePath}.actions`,
      )
    : (() => {
        if (!Array.isArray(plan.actions) || plan.actions.length !== 0) {
          throw new Error(`${valuePath}.actions must be empty while blocked.`);
        }
        return deepFreeze([]);
      })();
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_PLAN_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_PLAN_KIND,
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec,
      inspection,
      status: actionable ? 'actionable' : 'blocked',
      blockedReason: actionable ? null : 'unbound-provider-resources',
      actions,
    }),
  );
  assertManifestIsSecretFree(payload, valuePath);
  const expectedPlanId = createCanonicalJsonSha256Id({
    domain: PLAN_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_PLAN_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (plan.planId !== expectedPlanId) {
    throw new Error(`${valuePath}.planId does not match its exact contents.`);
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, planId: expectedPlanId }),
  );
}

/**
 * Resolve one strict read-only AWS single-node plan.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function resolveAwsSingleNodePlan(value) {
  const input = exactDataObject(value, INPUT_KEYS, 'awsSingleNodePlan');
  const desired = validateSingleNodeDeploymentDesired(
    input.desired,
    'awsSingleNodePlan.desired',
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'awsSingleNodePlan.providerScope',
  );
  if (
    desired.intent.provider.kind !== 'aws' ||
    desired.intent.provider.region !== providerScope.region
  ) {
    throw new Error(
      'awsSingleNodePlan desired state does not match its credential-bound region.',
    );
  }
  const api = snapshotReadApi(input.api);
  const [vpc, offeredZoneIds, image, inspection] = await Promise.all([
    resolveDefaultVpc(api, providerScope.accountId),
    resolveInstanceTypeOfferings(api),
    resolveUbuntuImage(api, providerScope),
    inspectOwnedResources(api, desired.deploymentInstanceId),
  ]);
  const subnet = await resolveDefaultSubnet(
    api,
    vpc.vpcId,
    providerScope.accountId,
    offeredZoneIds,
  );
  const [route, networkAcl] = await Promise.all([
    resolveInternetRoute(api, vpc, subnet, providerScope.accountId),
    resolveNetworkAcl(api, vpc, subnet, providerScope.accountId),
  ]);
  const providerSpec = createProviderSpec(
    deepFreeze(
      sortCanonicalJsonValue({
        schemaVersion: 1,
        kind: 'awsSingleNodeProviderSpec',
        providerScope,
        vpc,
        subnet,
        networkAcl,
        routeTable: route.routeTable,
        internetGateway: route.internetGateway,
        image,
        instanceType: AWS_SINGLE_NODE_INSTANCE_TYPE,
        ownedResourceCount: EXPECTED_OWNED_RESOURCE_COUNT,
      }),
    ),
  );
  const actionable = inspection.status === 'absent';
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: AWS_SINGLE_NODE_PLAN_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_PLAN_KIND,
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec,
      inspection,
      status: actionable ? 'actionable' : 'blocked',
      blockedReason: actionable ? null : 'unbound-provider-resources',
      actions: actionable ? createActions(desired, providerSpec) : [],
    }),
  );
  const planId = createCanonicalJsonSha256Id({
    domain: PLAN_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_PLAN_ID_PREFIX,
    value: payload,
    valuePath: 'awsSingleNodePlan',
  });
  return validateAwsSingleNodePlan({ ...payload, planId });
}

export default {
  AWS_SINGLE_NODE_ACTION_ID_PREFIX,
  AWS_SINGLE_NODE_INSTANCE_TYPE,
  AWS_SINGLE_NODE_PLAN_ID_PREFIX,
  AWS_SINGLE_NODE_PLAN_KIND,
  AWS_SINGLE_NODE_PLAN_SCHEMA_VERSION,
  AWS_SINGLE_NODE_PROVIDER_SPEC_ID_PREFIX,
  AWS_SINGLE_NODE_UBUNTU_PARAMETER,
  AwsSingleNodePlanEvidenceError,
  AwsSingleNodePlanReadError,
  resolveAwsSingleNodePlan,
  validateAwsSingleNodePlan,
};
