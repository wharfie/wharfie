/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { isIPv4, isIPv6 } from 'node:net';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
} from './deployment-aws-tagged-ec2-evidence.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';

export const AWS_SINGLE_NODE_SECURITY_GROUP_NAME = 'wharfie-single-node';
export const AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION =
  'Wharfie single-node application security group.';
export const AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS = 1000;
export const AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-security-group-state:v1';
export const AWS_SINGLE_NODE_SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_SECURITY_GROUP_VPC_ID_PATTERN =
  /^vpc-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_SECURITY_GROUP_MAX_TAGS = 50;
export const AWS_SINGLE_NODE_SECURITY_GROUP_BASE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-security-group',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});

const EVIDENCE_FACTORY_KEYS = new Set(['readDiscoveryPage', 'readExact']);
const NATURAL_SLOT_KEYS = new Set(['expectedOwnerId', 'vpcId']);
const STATE_DESCRIPTOR_KEYS = new Set([
  'groupName',
  'description',
  'ingressRules',
  'egressRules',
  'onDestroy',
]);
const ACTUAL_STATE_OPTIONS_KEYS = new Set([
  'providerScope',
  'vpcId',
  'egressCidr',
  'allowPropagation',
]);
const PROVIDER_SCOPE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'partition',
  'accountId',
  'provider',
  'region',
  'providerScopeId',
]);
const PERMISSION_KEYS = new Set([
  'IpProtocol',
  'FromPort',
  'ToPort',
  'IpRanges',
  'Ipv6Ranges',
  'PrefixListIds',
  'UserIdGroupPairs',
]);
const IPV4_RANGE_KEYS = new Set(['CidrIp', 'Description']);
const IPV6_RANGE_KEYS = new Set(['CidrIpv6', 'Description']);
const PREFIX_LIST_KEYS = new Set(['PrefixListId', 'Description']);
const GROUP_PAIR_KEYS = new Set([
  'Description',
  'GroupId',
  'GroupName',
  'PeeringStatus',
  'UserId',
  'VpcId',
  'VpcPeeringConnectionId',
]);
const DESIRED_STATE_RULE_KEYS = new Set(['protocol', 'ports', 'destination']);
const NORMALIZED_STATE_RULE_KEYS = new Set([
  'protocol',
  'ports',
  'destinations',
]);
const STATE_PORT_KEYS = new Set(['from', 'to']);
const STATE_RANGE_DESTINATION_KEYS = new Set(['kind', 'value', 'description']);
const STATE_GROUP_DESTINATION_KEYS = new Set([
  'kind',
  'groupId',
  'groupName',
  'peeringStatus',
  'userId',
  'vpcId',
  'vpcPeeringConnectionId',
  'description',
]);
const PREFIX_LIST_ID_PATTERN = /^pl-[0-9a-f]{8,32}$/;
const VPC_PEERING_CONNECTION_ID_PATTERN = /^pcx-[0-9a-f]{8,32}$/;
const AWS_ACCOUNT_ID_PATTERN = /^[0-9]{12}$/;
const SECURITY_GROUP_ARN_PATTERN =
  /^arn:([a-z0-9-]+):ec2:([a-z0-9-]+):([0-9]{12}):security-group\/(sg-[0-9a-f]{8,32})$/;

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

/** @param {Record<string, any>} value @param {Set<string>} keys @returns {void} */
function assertProviderKeys(value, keys) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new AwsTaggedEc2EvidenceUnknownError();
  }
}

/** @param {Record<string, any>} value @param {Set<string>} supported @param {Set<string>} required @param {string} path @returns {void} */
function assertStateKeys(value, supported, required, path) {
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) {
      throw new TypeError(`${path}.${key} is not supported.`);
    }
  }
  for (const key of required) {
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
function requiredProviderString(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
function validateOwnerId(value) {
  if (typeof value !== 'string' || !AWS_ACCOUNT_ID_PATTERN.test(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {number} */
function compareCanonicalRecords(left, right) {
  return compareCanonicalStrings(
    JSON.stringify(sortCanonicalJsonValue(left)),
    JSON.stringify(sortCanonicalJsonValue(right)),
  );
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSecurityGroupId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_SECURITY_GROUP_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeSecurityGroupVpcId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_SECURITY_GROUP_VPC_ID_PATTERN.test(value)
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} response @param {unknown} exactSecurityGroupId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeExactSecurityGroupResponse(
  response,
  exactSecurityGroupId,
) {
  const expectedId = validateAwsSingleNodeSecurityGroupId(exactSecurityGroupId);
  if (!isPlainObject(response) || !Array.isArray(response.SecurityGroups)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (response.SecurityGroups.length === 0) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (response.SecurityGroups.length !== 1) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  const securityGroup = response.SecurityGroups[0];
  if (!isPlainObject(securityGroup)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (
    validateAwsSingleNodeSecurityGroupId(securityGroup.GroupId) !== expectedId
  ) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  return securityGroup;
}

/** @param {unknown} response @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
export function decodeAwsSingleNodeSecurityGroupDiscoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.SecurityGroups)) {
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
  for (const securityGroup of response.SecurityGroups) {
    if (!isPlainObject(securityGroup)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    validateAwsSingleNodeSecurityGroupId(securityGroup.GroupId);
    records.push(securityGroup);
  }
  return { records, nextToken };
}

/** @param {unknown} value @param {4|6} family @returns {string} */
function validateCidr(value, family) {
  if (typeof value !== 'string') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const parts = value.split('/');
  const maxPrefix = family === 4 ? 32 : 128;
  if (
    parts.length !== 2 ||
    (family === 4 ? !isIPv4(parts[0]) : !isIPv6(parts[0])) ||
    (family === 6 && parts[0].includes('.')) ||
    !/^(?:0|[1-9][0-9]{0,2})$/u.test(parts[1])
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const prefix = Number(parts[1]);
  if (prefix > maxPrefix) throw new AwsTaggedEc2EvidenceUnknownError();
  if (family === 4) {
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
    if (left.length !== 8) throw new AwsTaggedEc2EvidenceUnknownError();
    groups = left;
  } else {
    const omitted = 8 - left.length - right.length;
    if (omitted < 1) throw new AwsTaggedEc2EvidenceUnknownError();
    groups = [...left, ...Array(omitted).fill('0'), ...right];
  }
  let address = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/iu.test(group)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    address = (address << 16n) | BigInt(`0x${group}`);
  }
  const hostBits = 128n - BigInt(prefix);
  const hostMask = hostBits === 0n ? 0n : (1n << hostBits) - 1n;
  if ((address & hostMask) !== 0n) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return `${groups
    .map((group) => Number.parseInt(group, 16).toString(16).padStart(4, '0'))
    .join(':')}/${prefix}`;
}

/** @param {unknown} value @returns {string|undefined} */
function optionalDescription(value) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @param {Set<string>} keys @param {string} sourceKey @param {string} kind @param {(candidate: unknown) => string} validate @returns {Readonly<Record<string, any>>[]} */
function normalizeRangeArray(value, keys, sourceKey, kind, validate) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AwsTaggedEc2EvidenceUnknownError();
  return value.map((candidate) => {
    if (!isPlainObject(candidate)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    assertProviderKeys(candidate, keys);
    const description = optionalDescription(candidate.Description);
    return {
      kind,
      value: validate(candidate[sourceKey]),
      ...(description === undefined ? {} : { description }),
    };
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>[]} */
function normalizeGroupPairs(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AwsTaggedEc2EvidenceUnknownError();
  return value.map((candidate) => {
    if (!isPlainObject(candidate)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    assertProviderKeys(candidate, GROUP_PAIR_KEYS);
    const description = optionalDescription(candidate.Description);
    const groupId =
      candidate.GroupId === undefined
        ? undefined
        : validateAwsSingleNodeSecurityGroupId(candidate.GroupId);
    const groupName =
      candidate.GroupName === undefined
        ? undefined
        : requiredProviderString(candidate.GroupName);
    const peeringStatus =
      candidate.PeeringStatus === undefined
        ? undefined
        : requiredProviderString(candidate.PeeringStatus);
    const userId =
      candidate.UserId === undefined
        ? undefined
        : validateOwnerId(candidate.UserId);
    const vpcId =
      candidate.VpcId === undefined
        ? undefined
        : validateAwsSingleNodeSecurityGroupVpcId(candidate.VpcId);
    const vpcPeeringConnectionId =
      candidate.VpcPeeringConnectionId === undefined
        ? undefined
        : requiredProviderString(candidate.VpcPeeringConnectionId);
    if (
      vpcPeeringConnectionId !== undefined &&
      !VPC_PEERING_CONNECTION_ID_PATTERN.test(vpcPeeringConnectionId)
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (
      groupId === undefined &&
      groupName === undefined &&
      userId === undefined &&
      vpcId === undefined &&
      vpcPeeringConnectionId === undefined
    ) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return {
      kind: 'security-group',
      ...(groupId === undefined ? {} : { groupId }),
      ...(groupName === undefined ? {} : { groupName }),
      ...(peeringStatus === undefined ? {} : { peeringStatus }),
      ...(userId === undefined ? {} : { userId }),
      ...(vpcId === undefined ? {} : { vpcId }),
      ...(vpcPeeringConnectionId === undefined
        ? {}
        : { vpcPeeringConnectionId }),
      ...(description === undefined ? {} : { description }),
    };
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function normalizePermission(value) {
  if (!isPlainObject(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  assertProviderKeys(value, PERMISSION_KEYS);
  const protocol = requiredProviderString(value.IpProtocol);
  if (!/^(?:-1|[a-z0-9][a-z0-9-]{0,31})$/u.test(protocol)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const hasFrom = value.FromPort !== undefined && value.FromPort !== null;
  const hasTo = value.ToPort !== undefined && value.ToPort !== null;
  if (
    hasFrom !== hasTo ||
    (hasFrom &&
      (!Number.isSafeInteger(value.FromPort) ||
        !Number.isSafeInteger(value.ToPort) ||
        value.FromPort < -1 ||
        value.FromPort > 65535 ||
        value.ToPort < -1 ||
        value.ToPort > 65535 ||
        value.FromPort > value.ToPort))
  ) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const destinations = [
    ...normalizeRangeArray(
      value.IpRanges,
      IPV4_RANGE_KEYS,
      'CidrIp',
      'ipv4-cidr',
      (candidate) => validateCidr(candidate, 4),
    ),
    ...normalizeRangeArray(
      value.Ipv6Ranges,
      IPV6_RANGE_KEYS,
      'CidrIpv6',
      'ipv6-cidr',
      (candidate) => validateCidr(candidate, 6),
    ),
    ...normalizeRangeArray(
      value.PrefixListIds,
      PREFIX_LIST_KEYS,
      'PrefixListId',
      'prefix-list',
      (candidate) => {
        const prefixListId = requiredProviderString(candidate);
        if (!PREFIX_LIST_ID_PATTERN.test(prefixListId)) {
          throw new AwsTaggedEc2EvidenceUnknownError();
        }
        return prefixListId;
      },
    ),
    ...normalizeGroupPairs(value.UserIdGroupPairs),
  ].sort(compareCanonicalRecords);
  for (let index = 1; index < destinations.length; index += 1) {
    if (sameJson(destinations[index - 1], destinations[index])) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
  }
  return deepFreeze({
    protocol,
    ports: hasFrom ? { from: value.FromPort, to: value.ToPort } : 'all',
    destinations,
  });
}

/** @param {unknown} value @param {boolean} allowEmpty @returns {Readonly<Record<string, any>>[]} */
function normalizePermissions(value, allowEmpty) {
  if (!Array.isArray(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  if (value.length === 0 && !allowEmpty) {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  const permissions = value
    .map(normalizePermission)
    .sort(compareCanonicalRecords);
  for (let index = 1; index < permissions.length; index += 1) {
    if (sameJson(permissions[index - 1], permissions[index])) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
  }
  return permissions;
}

/** @param {unknown} value @param {4|6} family @param {string} path @returns {string} */
function normalizeStateCidr(value, family, path) {
  try {
    return validateCidr(value, family);
  } catch {
    throw new TypeError(`${path} must be a canonical IPv${family} CIDR.`);
  }
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function normalizeStateDestination(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  if (value.kind === 'security-group') {
    assertStateKeys(
      value,
      STATE_GROUP_DESTINATION_KEYS,
      new Set(['kind']),
      path,
    );
    /** @type {Record<string, any>} */
    const normalized = { kind: 'security-group' };
    if (Object.hasOwn(value, 'groupId')) {
      try {
        normalized.groupId = validateAwsSingleNodeSecurityGroupId(
          value.groupId,
        );
      } catch {
        throw new TypeError(`${path}.groupId is invalid.`);
      }
    }
    for (const key of ['groupName', 'peeringStatus']) {
      if (Object.hasOwn(value, key)) {
        if (typeof value[key] !== 'string' || value[key].length === 0) {
          throw new TypeError(`${path}.${key} must be a non-empty string.`);
        }
        normalized[key] = value[key];
      }
    }
    if (Object.hasOwn(value, 'userId')) {
      try {
        normalized.userId = validateOwnerId(value.userId);
      } catch {
        throw new TypeError(`${path}.userId is invalid.`);
      }
    }
    if (Object.hasOwn(value, 'vpcId')) {
      try {
        normalized.vpcId = validateAwsSingleNodeSecurityGroupVpcId(value.vpcId);
      } catch {
        throw new TypeError(`${path}.vpcId is invalid.`);
      }
    }
    if (Object.hasOwn(value, 'vpcPeeringConnectionId')) {
      if (
        typeof value.vpcPeeringConnectionId !== 'string' ||
        !VPC_PEERING_CONNECTION_ID_PATTERN.test(value.vpcPeeringConnectionId)
      ) {
        throw new TypeError(`${path}.vpcPeeringConnectionId is invalid.`);
      }
      normalized.vpcPeeringConnectionId = value.vpcPeeringConnectionId;
    }
    if (
      normalized.groupId === undefined &&
      normalized.groupName === undefined &&
      normalized.userId === undefined &&
      normalized.vpcId === undefined &&
      normalized.vpcPeeringConnectionId === undefined
    ) {
      throw new TypeError(
        `${path} must contain a security-group identity field.`,
      );
    }
    if (Object.hasOwn(value, 'description')) {
      if (typeof value.description !== 'string') {
        throw new TypeError(`${path}.description must be a string.`);
      }
      normalized.description = value.description;
    }
    return deepFreeze(normalized);
  }

  assertStateKeys(
    value,
    STATE_RANGE_DESTINATION_KEYS,
    new Set(['kind', 'value']),
    path,
  );
  let normalizedValue;
  if (value.kind === 'ipv4-cidr') {
    normalizedValue = normalizeStateCidr(value.value, 4, `${path}.value`);
  } else if (value.kind === 'ipv6-cidr') {
    normalizedValue = normalizeStateCidr(value.value, 6, `${path}.value`);
  } else if (value.kind === 'prefix-list') {
    if (
      typeof value.value !== 'string' ||
      !PREFIX_LIST_ID_PATTERN.test(value.value)
    ) {
      throw new TypeError(`${path}.value is not a prefix-list ID.`);
    }
    normalizedValue = value.value;
  } else {
    throw new TypeError(`${path}.kind is not supported.`);
  }
  if (
    Object.hasOwn(value, 'description') &&
    typeof value.description !== 'string'
  ) {
    throw new TypeError(`${path}.description must be a string.`);
  }
  return deepFreeze({
    kind: value.kind,
    value: normalizedValue,
    ...(Object.hasOwn(value, 'description')
      ? { description: value.description }
      : {}),
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>|'all'} */
function normalizeStatePorts(value, path) {
  if (value === 'all') return 'all';
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be 'all' or an object.`);
  }
  assertExactKeys(value, STATE_PORT_KEYS, path);
  if (
    !Number.isSafeInteger(value.from) ||
    !Number.isSafeInteger(value.to) ||
    value.from < -1 ||
    value.from > 65535 ||
    value.to < -1 ||
    value.to > 65535 ||
    value.from > value.to
  ) {
    throw new TypeError(`${path} is not a supported port range.`);
  }
  return deepFreeze({ from: value.from, to: value.to });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function normalizeStateRule(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  if (Object.hasOwn(value, 'destination')) {
    assertExactKeys(value, DESIRED_STATE_RULE_KEYS, path);
    if (value.protocol !== 'all' || value.ports !== 'all') {
      throw new TypeError(`${path} is not a supported desired-state rule.`);
    }
    const destination = normalizeStateDestination(
      value.destination,
      `${path}.destination`,
    );
    if (destination.kind !== 'ipv4-cidr') {
      throw new TypeError(`${path}.destination must be an IPv4 CIDR.`);
    }
    return deepFreeze({
      protocol: 'all',
      ports: 'all',
      destination,
    });
  }
  assertExactKeys(value, NORMALIZED_STATE_RULE_KEYS, path);
  if (
    typeof value.protocol !== 'string' ||
    !/^(?:-1|[a-z0-9][a-z0-9-]{0,31})$/u.test(value.protocol) ||
    !Array.isArray(value.destinations)
  ) {
    throw new TypeError(`${path} is not a normalized provider rule.`);
  }
  const destinations = value.destinations
    .map((destination, index) =>
      normalizeStateDestination(destination, `${path}.destinations[${index}]`),
    )
    .sort(compareCanonicalRecords);
  for (let index = 1; index < destinations.length; index += 1) {
    if (sameJson(destinations[index - 1], destinations[index])) {
      throw new TypeError(`${path}.destinations contains a duplicate.`);
    }
  }
  return deepFreeze({
    protocol: value.protocol,
    ports: normalizeStatePorts(value.ports, `${path}.ports`),
    destinations,
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>[]} */
function normalizeStateRules(value, path) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  const rules = value
    .map((rule, index) => normalizeStateRule(rule, `${path}[${index}]`))
    .sort(compareCanonicalRecords);
  for (let index = 1; index < rules.length; index += 1) {
    if (sameJson(rules[index - 1], rules[index])) {
      throw new TypeError(`${path} contains a duplicate rule.`);
    }
  }
  return rules;
}

/** @param {unknown} value @returns {Readonly<{algorithm: 'sha256', value: string}>} */
export function createAwsSingleNodeSecurityGroupStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsSingleNodeSecurityGroup state must be an object.');
  }
  assertExactKeys(
    value,
    STATE_DESCRIPTOR_KEYS,
    'awsSingleNodeSecurityGroup state',
  );
  if (
    typeof value.groupName !== 'string' ||
    value.groupName.length === 0 ||
    typeof value.description !== 'string' ||
    value.description.length === 0 ||
    value.onDestroy !== 'purge'
  ) {
    throw new TypeError(
      'awsSingleNodeSecurityGroup state does not match a provider-observable security-group configuration.',
    );
  }
  const ingressRules = normalizeStateRules(
    value.ingressRules,
    'awsSingleNodeSecurityGroup state.ingressRules',
  );
  const egressRules = normalizeStateRules(
    value.egressRules,
    'awsSingleNodeSecurityGroup state.egressRules',
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2SecurityGroupState',
    groupName: value.groupName,
    description: value.description,
    ingressRules,
    egressRules,
    onDestroy: 'purge',
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {unknown} value @returns {Readonly<{algorithm: 'sha256', value: string}>} */
export function getAwsSingleNodeSecurityGroupStateDigest(value) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeSecurityGroupState providerSpec',
  );
  return createAwsSingleNodeSecurityGroupStateDigest({
    groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
    description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
    ingressRules: [],
    egressRules: [
      {
        protocol: 'all',
        ports: 'all',
        destination: {
          kind: 'ipv4-cidr',
          value: providerSpec.capabilities.networking.egressCidr,
        },
      },
    ],
    onDestroy: 'purge',
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @param {unknown} expectedVpcId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeSecurityGroupIdentity(
  value,
  providerScope,
  expectedVpcId,
) {
  if (!isPlainObject(value) || !isPlainObject(providerScope)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  assertExactKeys(
    providerScope,
    PROVIDER_SCOPE_KEYS,
    'awsSingleNodeSecurityGroup providerScope',
  );
  const providerResourceId = validateAwsSingleNodeSecurityGroupId(
    value.GroupId,
  );
  const ownerId = validateOwnerId(value.OwnerId);
  const vpcId = validateAwsSingleNodeSecurityGroupVpcId(value.VpcId);
  const groupName = requiredProviderString(value.GroupName);
  const description = requiredProviderString(value.Description);
  const canonicalVpcId = validateAwsSingleNodeSecurityGroupVpcId(expectedVpcId);
  if (ownerId !== providerScope.accountId || vpcId !== canonicalVpcId) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (value.SecurityGroupArn !== undefined && value.SecurityGroupArn !== null) {
    if (typeof value.SecurityGroupArn !== 'string') {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (!SECURITY_GROUP_ARN_PATTERN.test(value.SecurityGroupArn)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    const expectedArn = `arn:${providerScope.partition}:ec2:${providerScope.region}:${providerScope.accountId}:security-group/${providerResourceId}`;
    if (value.SecurityGroupArn !== expectedArn) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
  }
  return deepFreeze({
    providerResourceId,
    ownerId,
    vpcId,
    groupName,
    description,
  });
}

/** @param {unknown} value @param {unknown} options @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeSecurityGroupActualState(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSecurityGroup actual-state options must be an object.',
    );
  }
  assertExactKeys(
    options,
    ACTUAL_STATE_OPTIONS_KEYS,
    'awsSingleNodeSecurityGroup actual-state options',
  );
  if (typeof options.allowPropagation !== 'boolean') {
    throw new TypeError(
      'awsSingleNodeSecurityGroup allowPropagation must be a boolean.',
    );
  }
  if (!isPlainObject(value)) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  const identity = decodeAwsSingleNodeSecurityGroupIdentity(
    value,
    options.providerScope,
    options.vpcId,
  );
  const egressCidr = validateCidr(options.egressCidr, 4);
  const ingressRules = normalizePermissions(value.IpPermissions, true);
  const egressRules = normalizePermissions(
    value.IpPermissionsEgress,
    !options.allowPropagation,
  );
  const expectedEgress = {
    protocol: '-1',
    ports: 'all',
    destinations: [{ kind: 'ipv4-cidr', value: egressCidr }],
  };
  const isDesired =
    identity.groupName === AWS_SINGLE_NODE_SECURITY_GROUP_NAME &&
    identity.description === AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION &&
    ingressRules.length === 0 &&
    egressRules.length === 1 &&
    sameJson(egressRules[0], expectedEgress);
  const observedDigest = isDesired
    ? createAwsSingleNodeSecurityGroupStateDigest({
        groupName: AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
        description: AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
        ingressRules: [],
        egressRules: [
          {
            protocol: 'all',
            ports: 'all',
            destination: {
              kind: 'ipv4-cidr',
              value: egressCidr,
            },
          },
        ],
        onDestroy: 'purge',
      })
    : createAwsSingleNodeSecurityGroupStateDigest({
        groupName: identity.groupName,
        description: identity.description,
        ingressRules,
        egressRules,
        onDestroy: 'purge',
      });
  return deepFreeze({
    ...identity,
    observedDigest,
  });
}

/** @param {unknown} options @returns {Readonly<Record<string, any>>} */
export function createAwsSingleNodeSecurityGroupEvidenceKernel(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeSecurityGroupEvidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    EVIDENCE_FACTORY_KEYS,
    'awsSingleNodeSecurityGroupEvidence options',
  );
  const readDiscoveryPage = options.readDiscoveryPage;
  const readExact = options.readExact;
  if (
    typeof readDiscoveryPage !== 'function' ||
    typeof readExact !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeSecurityGroupEvidence read adapters must be functions.',
    );
  }
  const evidence = createAwsTaggedEc2EvidenceKernel({
    baseTags: AWS_SINGLE_NODE_SECURITY_GROUP_BASE_TAGS,
    discoveryMaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
    idKey: 'GroupId',
    idPattern: AWS_SINGLE_NODE_SECURITY_GROUP_ID_PATTERN,
    maxDiscoveryPages: AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
    maxTags: AWS_SINGLE_NODE_SECURITY_GROUP_MAX_TAGS,
    readDiscoveryPage,
    readExact,
  });

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverNaturalSlot(value) {
    if (!isPlainObject(value)) {
      throw new TypeError(
        'awsSingleNodeSecurityGroup natural slot must be an object.',
      );
    }
    assertExactKeys(
      value,
      NATURAL_SLOT_KEYS,
      'awsSingleNodeSecurityGroup natural slot',
    );
    const expectedOwnerId = validateOwnerId(value.expectedOwnerId);
    const vpcId = validateAwsSingleNodeSecurityGroupVpcId(value.vpcId);
    const filters = deepFreeze([{ Name: 'vpc-id', Values: [vpcId] }]);
    const seenIds = new Set();
    const matches = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      const request = deepFreeze({
        Filters: filters,
        MaxResults: AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
        ...(nextToken === null ? {} : { NextToken: nextToken }),
      });
      let rawPage;
      try {
        rawPage = await readDiscoveryPage(request);
      } catch (error) {
        if (error instanceof AwsTaggedEc2EvidenceConflictError) {
          throw new AwsTaggedEc2EvidenceConflictError();
        }
        if (error instanceof AwsTaggedEc2EvidenceTransientError) {
          throw new AwsTaggedEc2EvidenceTransientError();
        }
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      if (!isPlainObject(rawPage) || !Array.isArray(rawPage.records)) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      const observed = {
        records: rawPage.records,
        nextToken:
          rawPage.nextToken === undefined || rawPage.nextToken === null
            ? null
            : rawPage.nextToken,
      };
      if (
        observed.nextToken !== null &&
        (typeof observed.nextToken !== 'string' ||
          observed.nextToken.length === 0)
      ) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      for (const securityGroup of observed.records) {
        if (!isPlainObject(securityGroup)) {
          throw new AwsTaggedEc2EvidenceUnknownError();
        }
        const id = validateAwsSingleNodeSecurityGroupId(securityGroup.GroupId);
        const ownerId = validateOwnerId(securityGroup.OwnerId);
        const observedVpcId = validateAwsSingleNodeSecurityGroupVpcId(
          securityGroup.VpcId,
        );
        const groupName = requiredProviderString(securityGroup.GroupName);
        if (ownerId !== expectedOwnerId || observedVpcId !== vpcId) {
          throw new AwsTaggedEc2EvidenceConflictError();
        }
        if (seenIds.has(id)) {
          throw new AwsTaggedEc2EvidenceConflictError();
        }
        seenIds.add(id);
        if (
          groupName.toLowerCase() ===
          AWS_SINGLE_NODE_SECURITY_GROUP_NAME.toLowerCase()
        ) {
          matches.set(id, securityGroup);
          if (matches.size > 1) {
            throw new AwsTaggedEc2EvidenceConflictError();
          }
        }
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return /** @type {Readonly<Record<string, any>>|null} */ (
      [...matches.values()][0] ?? null
    );
  }

  return Object.freeze({ ...evidence, discoverNaturalSlot });
}

export default {
  AWS_SINGLE_NODE_SECURITY_GROUP_BASE_TAGS,
  AWS_SINGLE_NODE_SECURITY_GROUP_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  AWS_SINGLE_NODE_SECURITY_GROUP_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_ID_PATTERN,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_SECURITY_GROUP_MAX_TAGS,
  AWS_SINGLE_NODE_SECURITY_GROUP_NAME,
  AWS_SINGLE_NODE_SECURITY_GROUP_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_SECURITY_GROUP_VPC_ID_PATTERN,
  createAwsSingleNodeSecurityGroupEvidenceKernel,
  createAwsSingleNodeSecurityGroupStateDigest,
  decodeAwsSingleNodeExactSecurityGroupResponse,
  decodeAwsSingleNodeSecurityGroupActualState,
  decodeAwsSingleNodeSecurityGroupDiscoveryPage,
  decodeAwsSingleNodeSecurityGroupIdentity,
  getAwsSingleNodeSecurityGroupStateDigest,
  validateAwsSingleNodeSecurityGroupId,
  validateAwsSingleNodeSecurityGroupVpcId,
};
