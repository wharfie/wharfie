/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This strict provider-evidence boundary keeps its exact normalized protocol beside the implementation. */

import { isIPv4 } from 'node:net';

import {
  compareCanonicalStrings,
  sortCanonicalJsonValue,
} from '../../canonical-order.js';
import {
  AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION,
  createAwsSingleNodeResourceIdentity,
  createAwsSingleNodeRunInstancesClientToken,
} from './resource-identity.js';
import {
  AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION,
  AWS_SINGLE_NODE_ROOT_VOLUME_IOPS,
  AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT,
} from './single-node-requests.js';
import { validateAwsSingleNodeProvisioningIntent } from './single-node-provisioning-intent.js';

const MAX_PAGES = 16;
const MAX_RECORDS = 4096;
const READ_METHODS = Object.freeze([
  'describeSecurityGroups',
  'describeInstanceAttribute',
  'describeInstances',
  'describeVolumes',
  'describeInstanceCreditSpecifications',
]);
const SECURITY_GROUP_INPUT_KEYS = new Set([
  'intent',
  'storedResourceId',
  'api',
]);
const INSTANCE_INPUT_KEYS = new Set([
  'intent',
  'securityGroupId',
  'storedResourceId',
  'api',
]);
const ROOT_VOLUME_INPUT_KEYS = new Set([
  'intent',
  'instanceId',
  'rootVolumeId',
  'api',
]);
const IP_PERMISSION_KEYS = new Set([
  'IpProtocol',
  'FromPort',
  'ToPort',
  'UserIdGroupPairs',
  'IpRanges',
  'Ipv6Ranges',
  'PrefixListIds',
]);
const SECURITY_GROUP_ID_PATTERN = /^sg-[0-9a-f]{8,32}$/u;
const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8,32}$/u;
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const NETWORK_INTERFACE_ID_PATTERN = /^eni-[0-9a-f]{8,32}$/u;
const RESERVATION_ID_PATTERN = /^r-[0-9a-f]{8,32}$/u;
const ACCOUNT_ID_PATTERN = /^[0-9]{12}$/u;
const ACTIVE_INSTANCE_STATES = new Set([
  'pending',
  'running',
  'stopping',
  'stopped',
]);
const TERMINAL_INSTANCE_STATES = new Set(['shutting-down', 'terminated']);
const ALL_INSTANCE_STATES = Object.freeze([
  'pending',
  'running',
  'shutting-down',
  'stopping',
  'stopped',
  'terminated',
]);
const INSTANCE_ATTRIBUTE_VALUE_KEYS = new Set(['Value']);
const INSTANCE_ATTRIBUTE_SPECS = Object.freeze([
  Object.freeze({
    requestName: 'disableApiStop',
    responseKey: 'DisableApiStop',
    expectedValue: false,
  }),
  Object.freeze({
    requestName: 'disableApiTermination',
    responseKey: 'DisableApiTermination',
    expectedValue: false,
  }),
  Object.freeze({
    requestName: 'instanceInitiatedShutdownBehavior',
    responseKey: 'InstanceInitiatedShutdownBehavior',
    expectedValue: 'stop',
  }),
]);

/** A natural slot or stored identity belongs to an unexpected resource. */
export class AwsSingleNodeEvidenceConflictError extends Error {
  constructor() {
    super('AWS single-node resource ownership evidence conflicts.');
    this.name = 'AwsSingleNodeEvidenceConflictError';
    this.code = 'AWS_SINGLE_NODE_EVIDENCE_CONFLICT';
  }
}

/** A provider read failed before trustworthy evidence could be collected. */
export class AwsSingleNodeEvidenceTransientError extends Error {
  constructor() {
    super('AWS single-node resource evidence read failed.');
    this.name = 'AwsSingleNodeEvidenceTransientError';
    this.code = 'AWS_SINGLE_NODE_EVIDENCE_TRANSIENT';
  }
}

/** A provider response or local evidence envelope could not be normalized. */
export class AwsSingleNodeEvidenceUnknownError extends Error {
  constructor() {
    super('AWS single-node resource evidence is unknown.');
    this.name = 'AwsSingleNodeEvidenceUnknownError';
    this.code = 'AWS_SINGLE_NODE_EVIDENCE_UNKNOWN';
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
 * @returns {Record<string, any>}
 */
function exactDataObject(value, expected) {
  if (!isPlainObject(value)) throw new AwsSingleNodeEvidenceUnknownError();
  const object = /** @type {Record<string, any>} */ (value);
  const keys = Reflect.ownKeys(object);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== 'string' || !expected.has(key))
  ) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
  }
  return object;
}

/**
 * Project only owned read capabilities. Unknown mutation methods are never
 * inspected, retained, or made reachable as a receiver.
 * @param {unknown} value
 * @returns {Readonly<Record<string, Function>>}
 */
function snapshotReadApi(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  const object = /** @type {Record<string, any>} */ (value);
  /** @type {Record<string, Function>} */
  const result = {};
  for (const method of READ_METHODS) {
    const descriptor = Object.getOwnPropertyDescriptor(object, method);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    result[method] = descriptor.value;
  }
  return Object.freeze(result);
}

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 * @returns {string}
 */
function evidenceId(value, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  return value;
}

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 * @returns {string|null}
 */
function optionalStoredId(value, pattern) {
  if (value === null) return null;
  return evidenceId(value, pattern);
}

/**
 * @param {unknown} value
 * @param {RegExp} pattern
 * @returns {boolean}
 */
function isProviderId(value, pattern) {
  return typeof value === 'string' && pattern.test(value);
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} method
 * @param {Readonly<Record<string, any>>} request
 * @returns {Promise<unknown>}
 */
async function read(api, method, request) {
  try {
    return await Reflect.apply(api[method], undefined, [request]);
  } catch {
    throw new AwsSingleNodeEvidenceTransientError();
  }
}

/**
 * @param {unknown} value
 * @param {string} recordsKey
 * @returns {{records: Record<string, any>[], nextToken: string|null}}
 */
function decodePage(value, recordsKey) {
  if (!isPlainObject(value) || !Array.isArray(value[recordsKey])) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  let nextToken = null;
  if (value.NextToken !== undefined && value.NextToken !== null) {
    if (
      typeof value.NextToken !== 'string' ||
      value.NextToken.length === 0 ||
      value.NextToken.length > 4096
    ) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    nextToken = value.NextToken;
  }
  return { records: value[recordsKey], nextToken };
}

/**
 * @returns {{pages: number, records: number}}
 */
function createReadBudget() {
  return { pages: 0, records: 0 };
}

/**
 * @param {{pages: number, records: number}} budget
 * @param {number} recordCount
 */
function consumeBudget(budget, recordCount) {
  budget.pages += 1;
  budget.records += recordCount;
  if (budget.pages > MAX_PAGES || budget.records > MAX_RECORDS) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} method
 * @param {Readonly<Record<string, any>>} request
 * @param {string} recordsKey
 * @param {string} idKey
 * @param {RegExp} idPattern
 * @param {{pages: number, records: number}} budget
 * @returns {Promise<Readonly<Record<string, any>[]>>}
 */
async function readAllFlat(
  api,
  method,
  request,
  recordsKey,
  idKey,
  idPattern,
  budget,
) {
  /** @type {Record<string, any>[]} */
  const records = [];
  const seenIds = new Set();
  const seenTokens = new Set();
  let nextToken = null;
  while (budget.pages < MAX_PAGES) {
    const page = decodePage(
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
    consumeBudget(budget, page.records.length);
    for (const record of page.records) {
      if (!isPlainObject(record)) {
        throw new AwsSingleNodeEvidenceUnknownError();
      }
      const id = evidenceId(record[idKey], idPattern);
      if (seenIds.has(id)) throw new AwsSingleNodeEvidenceUnknownError();
      seenIds.add(id);
      records.push(record);
    }
    if (page.nextToken === null) return Object.freeze(records);
    if (
      seenTokens.has(page.nextToken) ||
      page.nextToken === nextToken ||
      budget.pages === MAX_PAGES
    ) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    seenTokens.add(page.nextToken);
    nextToken = page.nextToken;
  }
  throw new AwsSingleNodeEvidenceUnknownError();
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {Readonly<Record<string, any>>} request
 * @param {{pages: number, records: number}} budget
 * @returns {Promise<Readonly<Array<Readonly<{reservation: Record<string, any>, instance: Record<string, any>}>>>>}
 */
async function readAllInstances(api, request, budget) {
  /** @type {Array<Readonly<{reservation: Record<string, any>, instance: Record<string, any>}>>} */
  const records = [];
  const seenIds = new Set();
  const seenReservationIds = new Set();
  const seenTokens = new Set();
  let nextToken = null;
  while (budget.pages < MAX_PAGES) {
    const page = decodePage(
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
    let instanceCount = 0;
    for (const reservation of page.records) {
      if (
        !isPlainObject(reservation) ||
        !Array.isArray(reservation.Instances) ||
        reservation.Instances.length === 0
      ) {
        throw new AwsSingleNodeEvidenceUnknownError();
      }
      const reservationId = evidenceId(
        reservation.ReservationId,
        RESERVATION_ID_PATTERN,
      );
      if (seenReservationIds.has(reservationId)) {
        throw new AwsSingleNodeEvidenceUnknownError();
      }
      seenReservationIds.add(reservationId);
      if (
        typeof reservation.OwnerId !== 'string' ||
        !ACCOUNT_ID_PATTERN.test(reservation.OwnerId)
      ) {
        throw new AwsSingleNodeEvidenceUnknownError();
      }
      instanceCount += reservation.Instances.length;
      for (const instance of reservation.Instances) {
        if (!isPlainObject(instance)) {
          throw new AwsSingleNodeEvidenceUnknownError();
        }
        const id = evidenceId(instance.InstanceId, INSTANCE_ID_PATTERN);
        if (seenIds.has(id)) throw new AwsSingleNodeEvidenceUnknownError();
        seenIds.add(id);
        records.push(Object.freeze({ reservation, instance }));
      }
    }
    consumeBudget(budget, instanceCount);
    if (page.nextToken === null) return Object.freeze(records);
    if (
      seenTokens.has(page.nextToken) ||
      page.nextToken === nextToken ||
      budget.pages === MAX_PAGES
    ) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    seenTokens.add(page.nextToken);
    nextToken = page.nextToken;
  }
  throw new AwsSingleNodeEvidenceUnknownError();
}

/**
 * Merge repeated cross-check reads by provider ID. Duplicates within one
 * paginator were already rejected.
 * @param {readonly (readonly Record<string, any>[])[]} batches
 * @param {string} idKey
 * @returns {Record<string, any>[]}
 */
function unionFlat(batches, idKey) {
  const records = new Map();
  for (const batch of batches) {
    for (const record of batch) {
      if (!records.has(record[idKey])) records.set(record[idKey], record);
    }
  }
  return [...records.values()];
}

/**
 * @param {readonly (readonly Readonly<{reservation: Record<string, any>, instance: Record<string, any>}>[])[]} batches
 * @returns {Array<Readonly<{reservation: Record<string, any>, instance: Record<string, any>}>>}
 */
function unionInstances(batches) {
  const records = new Map();
  for (const batch of batches) {
    for (const record of batch) {
      if (!records.has(record.instance.InstanceId)) {
        records.set(record.instance.InstanceId, record);
      }
    }
  }
  return [...records.values()];
}

/**
 * @param {unknown} actual
 * @param {readonly Readonly<{Key: string, Value: string}>[]} expected
 */
function assertExactOwnershipTags(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    throw new AwsSingleNodeEvidenceConflictError();
  }
  const tags = new Map();
  for (const tag of actual) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      typeof tag.Value !== 'string' ||
      tags.has(tag.Key)
    ) {
      throw new AwsSingleNodeEvidenceConflictError();
    }
    tags.set(tag.Key, tag.Value);
  }
  for (const tag of expected) {
    if (tags.get(tag.Key) !== tag.Value) {
      throw new AwsSingleNodeEvidenceConflictError();
    }
  }
}

/**
 * @param {unknown} value
 * @returns {Record<string, any>[]}
 */
function optionalArray(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [];
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isEmptyArrayOrMissing(value) {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * @param {Record<string, any>} value
 * @param {Readonly<Set<string>>} allowed
 * @returns {boolean}
 */
function hasOnlyOwnStringKeys(value, allowed) {
  return Reflect.ownKeys(value).every(
    (key) => typeof key === 'string' && allowed.has(key),
  );
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function exactDefaultEgress(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  /** @type {string[]} */
  const ipv4 = [];
  /** @type {string[]} */
  const ipv6 = [];
  for (const permission of value) {
    if (
      !isPlainObject(permission) ||
      !hasOnlyOwnStringKeys(permission, IP_PERMISSION_KEYS) ||
      permission.IpProtocol !== '-1' ||
      permission.FromPort !== undefined ||
      permission.ToPort !== undefined ||
      !isEmptyArrayOrMissing(permission.UserIdGroupPairs) ||
      !isEmptyArrayOrMissing(permission.PrefixListIds)
    ) {
      return false;
    }
    const ipv4Ranges = optionalArray(permission.IpRanges);
    const ipv6Ranges = optionalArray(permission.Ipv6Ranges);
    if (ipv4Ranges.length + ipv6Ranges.length === 0) return false;
    for (const range of ipv4Ranges) {
      if (
        !isPlainObject(range) ||
        Reflect.ownKeys(range).length !== 1 ||
        range.CidrIp !== '0.0.0.0/0'
      ) {
        return false;
      }
      ipv4.push(range.CidrIp);
    }
    for (const range of ipv6Ranges) {
      if (
        !isPlainObject(range) ||
        Reflect.ownKeys(range).length !== 1 ||
        range.CidrIpv6 !== '::/0'
      ) {
        return false;
      }
      ipv6.push(range.CidrIpv6);
    }
  }
  return (
    ipv4.length === 1 &&
    ipv4[0] === '0.0.0.0/0' &&
    (ipv6.length === 0 || (ipv6.length === 1 && ipv6[0] === '::/0'))
  );
}

/**
 * @param {unknown} value
 * @param {readonly string[]} expected
 * @returns {{conflict: boolean, missingIpv4: string[]}}
 */
function inspectIngress(value, expected) {
  if (value === undefined) {
    return { conflict: false, missingIpv4: [...expected] };
  }
  if (!Array.isArray(value)) {
    return { conflict: true, missingIpv4: [...expected] };
  }
  const observed = new Set();
  let conflict = false;
  for (const permission of value) {
    if (
      !isPlainObject(permission) ||
      !hasOnlyOwnStringKeys(permission, IP_PERMISSION_KEYS) ||
      permission.IpProtocol !== 'tcp' ||
      permission.FromPort !== 22 ||
      permission.ToPort !== 22 ||
      !isEmptyArrayOrMissing(permission.UserIdGroupPairs) ||
      !isEmptyArrayOrMissing(permission.PrefixListIds) ||
      !isEmptyArrayOrMissing(permission.Ipv6Ranges)
    ) {
      conflict = true;
      continue;
    }
    const ranges = optionalArray(permission.IpRanges);
    if (ranges.length === 0) conflict = true;
    for (const range of ranges) {
      if (
        !isPlainObject(range) ||
        Reflect.ownKeys(range).length !== 1 ||
        typeof range.CidrIp !== 'string' ||
        !expected.includes(range.CidrIp) ||
        observed.has(range.CidrIp)
      ) {
        conflict = true;
        continue;
      }
      observed.add(range.CidrIp);
    }
  }
  return {
    conflict,
    missingIpv4: expected
      .filter((cidr) => !observed.has(cidr))
      .sort(compareCanonicalStrings),
  };
}

/**
 * @param {Record<string, any>} group
 * @param {Readonly<Record<string, any>>} intent
 * @param {Readonly<Record<string, any>>} identity
 * @param {string|null} storedId
 */
function assertSecurityGroupIdentity(group, intent, identity, storedId) {
  const spec = intent.plan.providerSpec;
  const id = evidenceId(group.GroupId, SECURITY_GROUP_ID_PATTERN);
  if (
    (storedId !== null && id !== storedId) ||
    group.OwnerId !== spec.providerScope.accountId ||
    group.VpcId !== spec.vpc.vpcId ||
    group.GroupName !== identity.name
  ) {
    throw new AwsSingleNodeEvidenceConflictError();
  }
  assertExactOwnershipTags(group.Tags, identity.tags);
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string|null} storedId
 * @param {Readonly<Record<string, Function>>} api
 */
async function inspectSecurityGroupInternal(intent, storedId, api) {
  const identity = createAwsSingleNodeResourceIdentity(intent, 'securityGroup');
  const budget = createReadBudget();
  const natural = await readAllFlat(
    api,
    'describeSecurityGroups',
    {
      Filters: [
        { Name: 'group-name', Values: [identity.name] },
        { Name: 'vpc-id', Values: [intent.plan.providerSpec.vpc.vpcId] },
      ],
      MaxResults: 1000,
    },
    'SecurityGroups',
    'GroupId',
    SECURITY_GROUP_ID_PATTERN,
    budget,
  );
  const stored =
    storedId === null
      ? []
      : await readAllFlat(
          api,
          'describeSecurityGroups',
          {
            Filters: [{ Name: 'group-id', Values: [storedId] }],
            MaxResults: 1000,
          },
          'SecurityGroups',
          'GroupId',
          SECURITY_GROUP_ID_PATTERN,
          budget,
        );
  for (const group of [...natural, ...stored]) {
    assertSecurityGroupIdentity(group, intent, identity, storedId);
  }
  const groups = unionFlat([natural, stored], 'GroupId');
  if (groups.length > 1) throw new AwsSingleNodeEvidenceConflictError();
  const expectedIpv4 = [...intent.plan.desired.intent.access.allowedIpv4].sort(
    compareCanonicalStrings,
  );
  if (groups.length === 0) {
    return deepFreeze(
      sortCanonicalJsonValue({
        status: 'absent',
        ownershipStatus: 'absent',
        specStatus: 'absent',
        securityGroupId: null,
        missingIpv4: expectedIpv4,
      }),
    );
  }
  const group = groups[0];
  const ingress = inspectIngress(group.IpPermissions, expectedIpv4);
  const specConflict =
    group.Description !== AWS_SINGLE_NODE_SECURITY_GROUP_DESCRIPTION ||
    !exactDefaultEgress(group.IpPermissionsEgress) ||
    ingress.conflict;
  return deepFreeze(
    sortCanonicalJsonValue({
      status: 'present',
      ownershipStatus: 'owned',
      specStatus: specConflict
        ? 'conflict'
        : ingress.missingIpv4.length > 0
          ? 'incomplete'
          : 'exact',
      securityGroupId: group.GroupId,
      missingIpv4: ingress.missingIpv4,
    }),
  );
}

/**
 * Inspect one deterministic security-group slot without retaining provider
 * blobs or mutation capabilities.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function inspectAwsSingleNodeSecurityGroup(value) {
  try {
    const input = exactDataObject(value, SECURITY_GROUP_INPUT_KEYS);
    const intent = validateAwsSingleNodeProvisioningIntent(input.intent);
    return await inspectSecurityGroupInternal(
      intent,
      optionalStoredId(input.storedResourceId, SECURITY_GROUP_ID_PATTERN),
      snapshotReadApi(input.api),
    );
  } catch (error) {
    if (
      error instanceof AwsSingleNodeEvidenceConflictError ||
      error instanceof AwsSingleNodeEvidenceTransientError ||
      error instanceof AwsSingleNodeEvidenceUnknownError
    ) {
      throw error;
    }
    throw new AwsSingleNodeEvidenceUnknownError();
  }
}

/**
 * @param {Record<string, any>} instance
 * @param {string} expectedGroupId
 * @param {string} expectedGroupName
 * @returns {boolean}
 */
function exactSecurityGroups(instance, expectedGroupId, expectedGroupName) {
  if (!Array.isArray(instance.SecurityGroups)) return false;
  return (
    instance.SecurityGroups.length === 1 &&
    isPlainObject(instance.SecurityGroups[0]) &&
    instance.SecurityGroups[0].GroupId === expectedGroupId &&
    instance.SecurityGroups[0].GroupName === expectedGroupName
  );
}

/**
 * @param {Record<string, any>} record
 * @param {Readonly<Record<string, any>>} intent
 * @param {Readonly<Record<string, any>>} identity
 * @param {string} expectedClientToken
 * @param {string|null} storedId
 */
function assertInstanceIdentity(
  record,
  intent,
  identity,
  expectedClientToken,
  storedId,
) {
  const instance = record.instance;
  const spec = intent.plan.providerSpec;
  const id = evidenceId(instance.InstanceId, INSTANCE_ID_PATTERN);
  if (
    (storedId !== null && id !== storedId) ||
    record.reservation.OwnerId !== spec.providerScope.accountId ||
    instance.ClientToken !== expectedClientToken ||
    instance.SubnetId !== spec.subnet.subnetId
  ) {
    throw new AwsSingleNodeEvidenceConflictError();
  }
  assertExactOwnershipTags(instance.Tags, identity.tags);
}

/**
 * @param {Record<string, any>} instance
 * @returns {{conflict: boolean, incomplete: boolean}}
 */
function inspectMetadata(instance) {
  if (!isPlainObject(instance.MetadataOptions)) {
    return { conflict: false, incomplete: true };
  }
  const metadata = instance.MetadataOptions;
  const conflict =
    metadata.HttpEndpoint !== 'enabled' ||
    metadata.HttpTokens !== 'required' ||
    metadata.HttpPutResponseHopLimit !== 1 ||
    metadata.HttpProtocolIpv6 !== 'disabled' ||
    metadata.InstanceMetadataTags !== 'disabled' ||
    !['pending', 'applied'].includes(metadata.State);
  return {
    conflict,
    incomplete: !conflict && metadata.State === 'pending',
  };
}

/**
 * @param {Record<string, any>} instance
 * @param {Readonly<Record<string, any>>} spec
 * @param {string} securityGroupId
 * @param {string} securityGroupName
 * @param {boolean} terminal
 * @returns {{conflict: boolean, incomplete: boolean, publicIpv4: string|null}}
 */
function inspectPrimaryNetworkInterface(
  instance,
  spec,
  securityGroupId,
  securityGroupName,
  terminal,
) {
  if (
    !Array.isArray(instance.NetworkInterfaces) ||
    instance.NetworkInterfaces.length === 0
  ) {
    return { conflict: false, incomplete: true, publicIpv4: null };
  }
  if (instance.NetworkInterfaces.length !== 1) {
    return { conflict: true, incomplete: false, publicIpv4: null };
  }
  const networkInterface = instance.NetworkInterfaces[0];
  if (
    !isPlainObject(networkInterface) ||
    !isProviderId(
      networkInterface.NetworkInterfaceId,
      NETWORK_INTERFACE_ID_PATTERN,
    ) ||
    !isPlainObject(networkInterface.Attachment)
  ) {
    return { conflict: true, incomplete: false, publicIpv4: null };
  }
  const attachment = networkInterface.Attachment;
  let conflict =
    networkInterface.Description !==
      AWS_SINGLE_NODE_PRIMARY_NETWORK_INTERFACE_DESCRIPTION ||
    networkInterface.InterfaceType !== 'interface' ||
    networkInterface.SubnetId !== spec.subnet.subnetId ||
    networkInterface.VpcId !== spec.vpc.vpcId ||
    attachment.DeviceIndex !== 0 ||
    attachment.NetworkCardIndex !== 0 ||
    attachment.DeleteOnTermination !== true ||
    !['attaching', 'attached'].includes(attachment.Status) ||
    !exactSecurityGroups(
      { SecurityGroups: networkInterface.Groups },
      securityGroupId,
      securityGroupName,
    ) ||
    !isEmptyArrayOrMissing(networkInterface.Ipv6Addresses) ||
    networkInterface.Ipv6Native === true;
  let incomplete = attachment.Status === 'attaching';
  let eniPublic = null;
  if (networkInterface.Association === undefined) {
    incomplete = true;
  } else if (
    !isPlainObject(networkInterface.Association) ||
    !isIPv4(networkInterface.Association.PublicIp)
  ) {
    conflict = true;
  } else {
    eniPublic = networkInterface.Association.PublicIp;
  }
  let topPublic = null;
  if (instance.PublicIpAddress === undefined) {
    incomplete = true;
  } else if (!isIPv4(instance.PublicIpAddress)) {
    conflict = true;
  } else {
    topPublic = instance.PublicIpAddress;
  }
  if (eniPublic !== null && topPublic !== null && eniPublic !== topPublic) {
    conflict = true;
  }
  if (terminal && eniPublic === null && topPublic === null) {
    incomplete = true;
  }
  return {
    conflict,
    incomplete,
    publicIpv4: eniPublic ?? topPublic,
  };
}

/**
 * @param {Record<string, any>} instance
 * @param {Readonly<Record<string, any>>} spec
 * @returns {{conflict: boolean, incomplete: boolean, rootVolumeId: string|null}}
 */
function inspectRootMapping(instance, spec) {
  if (
    !Array.isArray(instance.BlockDeviceMappings) ||
    instance.BlockDeviceMappings.length === 0
  ) {
    return { conflict: false, incomplete: true, rootVolumeId: null };
  }
  if (instance.BlockDeviceMappings.length !== 1) {
    return { conflict: true, incomplete: false, rootVolumeId: null };
  }
  const mapping = instance.BlockDeviceMappings[0];
  if (
    !isPlainObject(mapping) ||
    !isPlainObject(mapping.Ebs) ||
    !isProviderId(mapping.Ebs.VolumeId, VOLUME_ID_PATTERN)
  ) {
    return { conflict: true, incomplete: false, rootVolumeId: null };
  }
  return {
    conflict:
      mapping.DeviceName !== spec.image.rootDeviceName ||
      mapping.Ebs.DeleteOnTermination !== true ||
      !['attaching', 'attached'].includes(mapping.Ebs.Status),
    incomplete: mapping.Ebs.Status === 'attaching',
    rootVolumeId: mapping.Ebs.VolumeId,
  };
}

/**
 * @param {Record<string, any>} instance
 * @param {Readonly<Record<string, any>>} spec
 * @returns {boolean}
 */
function exactInstanceFixedSpec(instance, spec) {
  return (
    instance.ImageId === spec.image.imageId &&
    instance.InstanceType === spec.instanceType &&
    instance.VpcId === spec.vpc.vpcId &&
    instance.Architecture === 'x86_64' &&
    instance.RootDeviceType === 'ebs' &&
    instance.RootDeviceName === spec.image.rootDeviceName &&
    instance.VirtualizationType === 'hvm' &&
    instance.EnaSupport === true &&
    instance.EbsOptimized === true &&
    isPlainObject(instance.Monitoring) &&
    instance.Monitoring.State === 'disabled' &&
    isPlainObject(instance.HibernationOptions) &&
    instance.HibernationOptions.Configured === false &&
    isPlainObject(instance.EnclaveOptions) &&
    instance.EnclaveOptions.Enabled === false &&
    instance.IamInstanceProfile === undefined &&
    instance.KeyName === undefined &&
    instance.SpotInstanceRequestId === undefined &&
    instance.InstanceLifecycle === undefined &&
    isPlainObject(instance.Placement) &&
    instance.Placement.AvailabilityZone === spec.subnet.availabilityZone &&
    instance.Placement.Tenancy === 'default'
  );
}

/**
 * Decode three non-listable launch attributes through their only supported
 * EC2 read boundary. Successful SDK outputs contain the selected attribute,
 * the instance ID, and optional Smithy metadata.
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} instanceId
 * @param {{pages: number, records: number}} budget
 * @returns {Promise<{conflict: boolean, incomplete: boolean}>}
 */
async function inspectInstanceAttributes(api, instanceId, budget) {
  let conflict = false;
  for (const spec of INSTANCE_ATTRIBUTE_SPECS) {
    if (budget.pages >= MAX_PAGES) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    const response = await read(
      api,
      'describeInstanceAttribute',
      deepFreeze({
        InstanceId: instanceId,
        Attribute: spec.requestName,
      }),
    );
    consumeBudget(budget, 1);
    if (!isPlainObject(response)) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    const keys = Reflect.ownKeys(response);
    if (
      keys.length < 2 ||
      keys.length > 3 ||
      !Object.hasOwn(response, 'InstanceId') ||
      !Object.hasOwn(response, spec.responseKey) ||
      keys.some(
        (key) =>
          typeof key !== 'string' ||
          !['$metadata', 'InstanceId', spec.responseKey].includes(key),
      )
    ) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(response, key);
      if (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new AwsSingleNodeEvidenceUnknownError();
      }
    }
    const attribute = exactDataObject(
      response[spec.responseKey],
      INSTANCE_ATTRIBUTE_VALUE_KEYS,
    );
    conflict ||=
      response.InstanceId !== instanceId ||
      attribute.Value !== spec.expectedValue;
  }
  return { conflict, incomplete: false };
}

/**
 * @param {Readonly<Record<string, Function>>} api
 * @param {string} instanceId
 * @param {{pages: number, records: number}} budget
 * @returns {Promise<'exact'|'incomplete'|'conflict'>}
 */
async function inspectCpuCredits(api, instanceId, budget) {
  if (budget.pages >= MAX_PAGES) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  const page = decodePage(
    await read(
      api,
      'describeInstanceCreditSpecifications',
      deepFreeze({ InstanceIds: [instanceId] }),
    ),
    'InstanceCreditSpecifications',
  );
  consumeBudget(budget, page.records.length);
  if (page.nextToken !== null) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  const seenIds = new Set();
  for (const record of page.records) {
    if (!isPlainObject(record)) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    const id = evidenceId(record.InstanceId, INSTANCE_ID_PATTERN);
    if (seenIds.has(id)) {
      throw new AwsSingleNodeEvidenceUnknownError();
    }
    seenIds.add(id);
  }
  const records = page.records;
  if (records.length === 0) return 'incomplete';
  if (records.length !== 1 || records[0].InstanceId !== instanceId) {
    return 'conflict';
  }
  return records[0].CpuCredits === 'standard' ? 'exact' : 'conflict';
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string} securityGroupId
 * @param {string|null} storedId
 * @param {Readonly<Record<string, Function>>} api
 */
async function inspectInstanceInternal(intent, securityGroupId, storedId, api) {
  const identity = createAwsSingleNodeResourceIdentity(intent, 'instance');
  const securityGroupIdentity = createAwsSingleNodeResourceIdentity(
    intent,
    'securityGroup',
  );
  const clientToken = createAwsSingleNodeRunInstancesClientToken(intent);
  const spec = intent.plan.providerSpec;
  const budget = createReadBudget();
  const natural = await readAllInstances(
    api,
    {
      Filters: [
        { Name: 'client-token', Values: [clientToken] },
        { Name: 'subnet-id', Values: [spec.subnet.subnetId] },
        { Name: 'instance-state-name', Values: ALL_INSTANCE_STATES },
      ],
      MaxResults: 1000,
    },
    budget,
  );
  const stored =
    storedId === null
      ? []
      : await readAllInstances(
          api,
          {
            Filters: [{ Name: 'instance-id', Values: [storedId] }],
            MaxResults: 1000,
          },
          budget,
        );
  for (const record of [...natural, ...stored]) {
    assertInstanceIdentity(record, intent, identity, clientToken, storedId);
  }
  const records = unionInstances([natural, stored]);
  if (records.length > 1) throw new AwsSingleNodeEvidenceConflictError();
  if (records.length === 0) {
    return deepFreeze(
      sortCanonicalJsonValue({
        status: 'absent',
        ownershipStatus: 'absent',
        specStatus: 'absent',
        instanceId: null,
        instanceState: null,
        rootVolumeId: null,
        publicIpv4: null,
      }),
    );
  }
  const record = records[0];
  const instance = record.instance;
  const state =
    isPlainObject(instance.State) && typeof instance.State.Name === 'string'
      ? instance.State.Name
      : null;
  if (state === null) throw new AwsSingleNodeEvidenceUnknownError();
  const knownState =
    ACTIVE_INSTANCE_STATES.has(state) || TERMINAL_INSTANCE_STATES.has(state);
  const terminal = TERMINAL_INSTANCE_STATES.has(state);
  const metadata = inspectMetadata(instance);
  const network = inspectPrimaryNetworkInterface(
    instance,
    spec,
    securityGroupId,
    securityGroupIdentity.name,
    terminal,
  );
  const root = inspectRootMapping(instance, spec);
  const attributes = terminal
    ? { conflict: false, incomplete: true }
    : await inspectInstanceAttributes(api, instance.InstanceId, budget);
  const credit = terminal
    ? 'incomplete'
    : await inspectCpuCredits(api, instance.InstanceId, budget);
  const conflict =
    !knownState ||
    ['stopping', 'stopped'].includes(state) ||
    !exactInstanceFixedSpec(instance, spec) ||
    !exactSecurityGroups(
      instance,
      securityGroupId,
      securityGroupIdentity.name,
    ) ||
    metadata.conflict ||
    network.conflict ||
    root.conflict ||
    attributes.conflict ||
    credit === 'conflict';
  const incomplete =
    state === 'pending' ||
    metadata.incomplete ||
    network.incomplete ||
    root.incomplete ||
    attributes.incomplete ||
    credit === 'incomplete';
  const specStatus = conflict
    ? 'conflict'
    : incomplete
      ? 'incomplete'
      : 'exact';
  const status = terminal
    ? 'terminal'
    : state === 'pending' || specStatus === 'incomplete'
      ? 'settling'
      : 'present';
  return deepFreeze(
    sortCanonicalJsonValue({
      status,
      ownershipStatus: 'owned',
      specStatus,
      instanceId: instance.InstanceId,
      instanceState: knownState ? state : 'unknown',
      rootVolumeId: root.rootVolumeId,
      publicIpv4: network.publicIpv4,
    }),
  );
}

/**
 * Inspect one deterministic RunInstances slot and its independently read CPU
 * credit setting.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function inspectAwsSingleNodeInstance(value) {
  try {
    const input = exactDataObject(value, INSTANCE_INPUT_KEYS);
    const intent = validateAwsSingleNodeProvisioningIntent(input.intent);
    return await inspectInstanceInternal(
      intent,
      evidenceId(input.securityGroupId, SECURITY_GROUP_ID_PATTERN),
      optionalStoredId(input.storedResourceId, INSTANCE_ID_PATTERN),
      snapshotReadApi(input.api),
    );
  } catch (error) {
    if (
      error instanceof AwsSingleNodeEvidenceConflictError ||
      error instanceof AwsSingleNodeEvidenceTransientError ||
      error instanceof AwsSingleNodeEvidenceUnknownError
    ) {
      throw error;
    }
    throw new AwsSingleNodeEvidenceUnknownError();
  }
}

/**
 * @param {Record<string, any>} attachment
 * @param {string} instanceId
 * @param {string} volumeId
 * @param {string} deviceName
 * @returns {{conflict: boolean, incomplete: boolean, expected: boolean}}
 */
function inspectVolumeAttachment(attachment, instanceId, volumeId, deviceName) {
  if (!isPlainObject(attachment)) {
    return { conflict: true, incomplete: false, expected: false };
  }
  const state = attachment.State;
  const expected =
    attachment.InstanceId === instanceId &&
    attachment.VolumeId === volumeId &&
    attachment.Device === deviceName &&
    attachment.DeleteOnTermination === true;
  return {
    conflict:
      !expected || !['attaching', 'attached', 'detaching'].includes(state),
    incomplete: state === 'attaching' || state === 'detaching',
    expected,
  };
}

/**
 * @param {Readonly<Record<string, any>>} intent
 * @param {string} instanceId
 * @param {string} volumeId
 * @param {Readonly<Record<string, Function>>} api
 */
async function inspectRootVolumeInternal(intent, instanceId, volumeId, api) {
  const identity = createAwsSingleNodeResourceIdentity(intent, 'rootVolume');
  const spec = intent.plan.providerSpec;
  const budget = createReadBudget();
  const natural = await readAllFlat(
    api,
    'describeVolumes',
    {
      Filters: identity.tags.map(
        (/** @type {{Key: string, Value: string}} */ tag) => ({
          Name: `tag:${tag.Key}`,
          Values: [tag.Value],
        }),
      ),
      MaxResults: 500,
    },
    'Volumes',
    'VolumeId',
    VOLUME_ID_PATTERN,
    budget,
  );
  const mapped = await readAllFlat(
    api,
    'describeVolumes',
    {
      Filters: [{ Name: 'volume-id', Values: [volumeId] }],
      MaxResults: 500,
    },
    'Volumes',
    'VolumeId',
    VOLUME_ID_PATTERN,
    budget,
  );
  for (const volume of [...natural, ...mapped]) {
    assertExactOwnershipTags(volume.Tags, identity.tags);
  }
  const volumes = unionFlat([natural, mapped], 'VolumeId');
  if (volumes.length === 0) {
    return deepFreeze(
      sortCanonicalJsonValue({
        status: 'absent',
        ownershipStatus: 'absent',
        specStatus: 'absent',
        volumeId: null,
        volumeState: null,
        attachmentStatus: null,
      }),
    );
  }
  if (volumes.length !== 1 || volumes[0].VolumeId !== volumeId) {
    throw new AwsSingleNodeEvidenceConflictError();
  }
  const volume = volumes[0];
  const root = spec.image.rootBlockDevice;
  let conflict =
    volume.AvailabilityZone !== spec.subnet.availabilityZone ||
    volume.SnapshotId !== root.snapshotId ||
    volume.VolumeType !== 'gp3' ||
    volume.Size !== root.sizeGiB ||
    volume.Iops !== AWS_SINGLE_NODE_ROOT_VOLUME_IOPS ||
    volume.Throughput !== AWS_SINGLE_NODE_ROOT_VOLUME_THROUGHPUT ||
    volume.Encrypted !== true ||
    volume.MultiAttachEnabled !== false;
  let incomplete = false;
  if (!Array.isArray(volume.Attachments)) {
    throw new AwsSingleNodeEvidenceUnknownError();
  }
  if (volume.Attachments.length > 1) {
    conflict = true;
  }
  const attachment =
    volume.Attachments.length === 1
      ? inspectVolumeAttachment(
          volume.Attachments[0],
          instanceId,
          volumeId,
          spec.image.rootDeviceName,
        )
      : null;
  const attachmentStatus =
    volume.Attachments.length === 0
      ? 'none'
      : attachment?.expected === true
        ? 'expected'
        : 'unexpected';
  if (attachment !== null) {
    conflict ||= attachment.conflict;
    incomplete ||= attachment.incomplete;
  }
  const providerState =
    typeof volume.State === 'string' ? volume.State : 'unknown';
  let status;
  if (providerState === 'creating') {
    status = 'settling';
    incomplete = true;
    if (volume.Attachments.length > 0 && attachment?.incomplete !== true) {
      conflict = true;
    }
  } else if (providerState === 'in-use') {
    status = attachment?.incomplete === true ? 'settling' : 'present';
    if (volume.Attachments.length !== 1) conflict = true;
  } else if (providerState === 'available') {
    status = 'available';
    if (volume.Attachments.length !== 0) conflict = true;
  } else if (providerState === 'deleting') {
    status = 'deleting';
  } else {
    status = 'present';
    conflict = true;
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      status,
      ownershipStatus: 'owned',
      specStatus: conflict ? 'conflict' : incomplete ? 'incomplete' : 'exact',
      volumeId,
      volumeState: ['creating', 'in-use', 'available', 'deleting'].includes(
        providerState,
      )
        ? providerState
        : 'unknown',
      attachmentStatus,
    }),
  );
}

/**
 * Inspect one exact root-volume identifier and its ownership/spec state.
 * @param {unknown} value
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function inspectAwsSingleNodeRootVolume(value) {
  try {
    const input = exactDataObject(value, ROOT_VOLUME_INPUT_KEYS);
    const intent = validateAwsSingleNodeProvisioningIntent(input.intent);
    return await inspectRootVolumeInternal(
      intent,
      evidenceId(input.instanceId, INSTANCE_ID_PATTERN),
      evidenceId(input.rootVolumeId, VOLUME_ID_PATTERN),
      snapshotReadApi(input.api),
    );
  } catch (error) {
    if (
      error instanceof AwsSingleNodeEvidenceConflictError ||
      error instanceof AwsSingleNodeEvidenceTransientError ||
      error instanceof AwsSingleNodeEvidenceUnknownError
    ) {
      throw error;
    }
    throw new AwsSingleNodeEvidenceUnknownError();
  }
}

export default {
  AwsSingleNodeEvidenceConflictError,
  AwsSingleNodeEvidenceTransientError,
  AwsSingleNodeEvidenceUnknownError,
  inspectAwsSingleNodeInstance,
  inspectAwsSingleNodeRootVolume,
  inspectAwsSingleNodeSecurityGroup,
};
