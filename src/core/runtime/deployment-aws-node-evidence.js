/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { isIPv4 } from 'node:net';

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  sha256Base64Url,
} from './content-id.js';
import { getAwsSingleNodeBootstrapBase64 } from './deployment-aws-node-bootstrap-contract.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';
import {
  AWS_EC2_INSTANCE_ID_PATTERN,
  getAwsSingleNodeRuntimeInstanceProfileName,
} from './deployment-aws-runtime-identity-contract.js';
import {
  AwsTaggedEc2EvidenceConflictError as AwsSingleNodeNodeEvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError as AwsSingleNodeNodeEvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError as AwsSingleNodeNodeEvidenceUnknownError,
} from './deployment-aws-tagged-ec2-evidence.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export {
  AwsSingleNodeNodeEvidenceConflictError,
  AwsSingleNodeNodeEvidenceTransientError,
  AwsSingleNodeNodeEvidenceUnknownError,
};

export const AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS = 1000;
export const AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS = 500;
export const AWS_SINGLE_NODE_NODE_MAX_TAGS = 50;
export const AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ec2-instance-state:v1';
export const AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN =
  'wharfie:aws-single-node-ec2-instance-create-client-token:v1';
export const AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
export const AWS_SINGLE_NODE_NODE_NETWORK_INTERFACE_ID_PATTERN =
  /^eni-[0-9a-f]{8,32}$/;
const AWS_SINGLE_NODE_NODE_CAPACITY_RESERVATION_ID_PATTERN =
  /^cr-[0-9a-f]{8,32}$/;
const AWS_SINGLE_NODE_NODE_CAPACITY_RESERVATION_GROUP_ARN_PATTERN =
  /^arn:[a-z0-9-]+:resource-groups:[a-z0-9-]+:[0-9]{12}:group\/[A-Za-z0-9_.-]{1,128}$/;
export const AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-substrate',
  'wharfie:retention': 'purge',
  'wharfie:schema-version': '2',
});
export const AWS_SINGLE_NODE_NODE_BASE_ROOT_VOLUME_TAGS = Object.freeze({
  ...AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS,
  'wharfie:resource-kind': 'single-node-substrate-root-volume',
});

/** @type {Readonly<Record<string, number>>} */
const INSTANCE_STATES = Object.freeze({
  pending: 0,
  running: 16,
  'shutting-down': 32,
  terminated: 48,
  stopping: 64,
  stopped: 80,
});
const NAME_AUTHORITY_KEYS = new Set([
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
]);
const IDENTITY_OPTIONS_KEYS = new Set([
  'providerScopeAccountId',
  'expectedClientToken',
  'expectedInstanceId',
  'expectedTags',
  'allowTagPropagation',
]);
const INSTANCE_OPTIONS_KEYS = new Set([
  'providerSpec',
  'providerScopeAccountId',
  'vpcId',
  'subnetId',
  'securityGroupId',
  'instanceProfileId',
  'instanceProfileArn',
]);
const ROOT_OPTIONS_KEYS = new Set([
  'providerSpec',
  'expectedTags',
  'allowTagPropagation',
  'instanceId',
]);
const PURGE_OPTIONS_KEYS = new Set([
  'providerSpec',
  'expectedTags',
  'instanceId',
]);
const OBSERVED_STATE_KEYS = new Set([
  'instance',
  'attributes',
  'cpuCredits',
  'rootVolume',
]);
const ATTRIBUTE_KEYS = new Set([
  'userData',
  'disableApiTermination',
  'disableApiStop',
  'instanceInitiatedShutdownBehavior',
]);

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

/** @param {any} value @param {WeakSet<object>} [seen] @returns {any} */
function cloneEvidenceValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (seen.has(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  seen.add(value);
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((child) => cloneEvidenceValue(child, seen));
  }
  if (
    !isPlainObject(value) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  /** @type {Record<string, any>} */
  const clone = {};
  for (const [key, child] of Object.entries(value)) {
    clone[key] = cloneEvidenceValue(child, seen);
  }
  return clone;
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} value @returns {boolean} */
function absent(value) {
  return value === undefined || value === null;
}

/** @param {unknown} value @returns {boolean} */
function emptyArray(value) {
  return (
    value === undefined ||
    value === null ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** @param {Readonly<Record<string, any>>} descriptor @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function stateDigest(descriptor) {
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        sortCanonicalJsonValue(descriptor),
      )}`,
    ),
  });
}

/** @param {unknown} value @param {unknown} nameAuthority @returns {Readonly<Record<string, any>>} */
function desiredStateDescriptor(value, nameAuthority) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeNodeState providerSpec',
  );
  if (!isPlainObject(nameAuthority)) {
    throw new TypeError(
      'awsSingleNodeNodeState nameAuthority must be an object.',
    );
  }
  assertExactKeys(
    nameAuthority,
    NAME_AUTHORITY_KEYS,
    'awsSingleNodeNodeState nameAuthority',
  );
  if (nameAuthority.providerScopeId !== providerSpec.providerScopeId) {
    throw new Error(
      'awsSingleNodeNodeState nameAuthority does not match the provider specification.',
    );
  }
  return deepFreeze({
    schemaVersion: 1,
    kind: 'awsSingleNodeEc2InstanceState',
    machineImage: providerSpec.machineImage,
    placement: providerSpec.placement,
    ebsKmsKeyArn: providerSpec.storage.ebsKmsKeyArn,
    node: providerSpec.node,
    instanceProfileName:
      getAwsSingleNodeRuntimeInstanceProfileName(nameAuthority),
    onDestroy: 'purge',
  });
}

/**
 * Derive exact intrinsic launch state. Provider-allocated identities and
 * lifecycle remain outside this digest.
 * @param {unknown} value - Exact provider specification.
 * @param {unknown} nameAuthority - Exact deterministic runtime-name authority.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeNodeStateDigest(value, nameAuthority) {
  return stateDigest(desiredStateDescriptor(value, nameAuthority));
}

/**
 * Derive a stable digest from complete readable provider state. Exact desired
 * state reproduces the plan digest; readable drift is hashed as a stable
 * unequal extension while lifecycle remains health evidence.
 * @param {unknown} providerSpec - Exact desired provider authority.
 * @param {unknown} nameAuthority - Exact deterministic runtime-name authority.
 * @param {unknown} observedState - Complete normalized readable state.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeNodeObservedStateDigest(
  providerSpec,
  nameAuthority,
  observedState,
) {
  if (!isPlainObject(observedState)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  assertExactKeys(
    observedState,
    OBSERVED_STATE_KEYS,
    'awsSingleNodeNode observed state',
  );
  const desired = getAwsSingleNodeNodeDesiredReadableState(
    providerSpec,
    nameAuthority,
  );
  const descriptor = desiredStateDescriptor(providerSpec, nameAuthority);
  return sameJson(observedState, desired)
    ? stateDigest(descriptor)
    : stateDigest({ ...descriptor, readableState: observedState });
}

/** @param {unknown} actionId @param {unknown} ownershipNonce @returns {string} */
export function getAwsSingleNodeNodeCreateClientToken(
  actionId,
  ownershipNonce,
) {
  assertDomainSeparatedSha256Id(
    actionId,
    DEPLOYMENT_ACTION_ID_PREFIX,
    'awsSingleNodeNode clientToken actionId',
  );
  const nonce = validateOwnershipNonce(
    ownershipNonce,
    'awsSingleNodeNode clientToken ownershipNonce',
  );
  const payload = JSON.stringify(
    sortCanonicalJsonValue({ actionId, ownershipNonce: nonce }),
  );
  return Buffer.from(
    sha256Base64Url(
      `${AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN}\0${payload}`,
    ),
    'base64url',
  ).toString('hex');
}

/** @param {Readonly<Record<string, string>>} instanceTags @returns {Readonly<Record<string, string>>} */
export function getAwsSingleNodeNodeRootVolumeTags(instanceTags) {
  if (!isPlainObject(instanceTags)) {
    throw new TypeError('awsSingleNodeNode instance tags must be an object.');
  }
  return deepFreeze({
    ...instanceTags,
    'wharfie:resource-kind': 'single-node-substrate-root-volume',
  });
}

/** @param {unknown} value @param {Readonly<Record<string, string>>} expected @param {boolean} allowPropagation @returns {void} */
export function validateAwsSingleNodeNodeManagedTags(
  value,
  expected,
  allowPropagation,
) {
  if (!isPlainObject(expected) || typeof allowPropagation !== 'boolean') {
    throw new TypeError('awsSingleNodeNode tag authority is invalid.');
  }
  if (!Array.isArray(value)) {
    if (allowPropagation && (value === undefined || value === null)) {
      throw new AwsSingleNodeNodeEvidenceTransientError();
    }
    if (value === undefined || value === null) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (value.length > AWS_SINGLE_NODE_NODE_MAX_TAGS) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const observed = new Map();
  for (const tag of value) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      typeof tag.Value !== 'string'
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (observed.has(tag.Key)) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    observed.set(tag.Key, tag.Value);
  }
  for (const [key, observedValue] of observed) {
    const reserved = Object.hasOwn(expected, key);
    if (key.startsWith('wharfie:') && !reserved) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    if (reserved && expected[key] !== observedValue) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
  }
  if (
    !Object.entries(expected).every(
      ([key, expectedValue]) => observed.get(key) === expectedValue,
    )
  ) {
    if (allowPropagation) {
      throw new AwsSingleNodeNodeEvidenceTransientError();
    }
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
}

/** @param {unknown} value @returns {'pending'|'running'|'shutting-down'|'terminated'|'stopping'|'stopped'} */
export function decodeAwsSingleNodeNodeLifecycle(value) {
  if (
    !isPlainObject(value) ||
    typeof value.Name !== 'string' ||
    !Number.isSafeInteger(value.Code) ||
    !Object.hasOwn(INSTANCE_STATES, value.Name)
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (value.Code < 0 || (value.Code & 0xff) !== INSTANCE_STATES[value.Name]) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return /** @type {'pending'|'running'|'shutting-down'|'terminated'|'stopping'|'stopped'} */ (
    value.Name
  );
}

/** @param {unknown} lifecycle @returns {'starting'|'degraded'|'stopped'|'failed'} */
export function getAwsSingleNodeNodeLifecycleHealth(lifecycle) {
  if (lifecycle === 'pending') return 'starting';
  if (lifecycle === 'running') return 'degraded';
  if (lifecycle === 'stopping' || lifecycle === 'stopped') return 'stopped';
  if (lifecycle === 'shutting-down' || lifecycle === 'terminated') {
    return 'failed';
  }
  throw new TypeError('awsSingleNodeNode lifecycle is invalid.');
}

/**
 * Decode one exact or discovery DescribeInstances page.
 * @param {unknown} response - Raw DescribeInstances response.
 * @param {unknown} providerScope - Exact provider scope.
 * @param {boolean} exact - Whether pagination is forbidden.
 * @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}}
 */
export function decodeAwsSingleNodeNodeInstancePage(
  response,
  providerScope,
  exact,
) {
  if (
    !isPlainObject(providerScope) ||
    typeof providerScope.accountId !== 'string' ||
    typeof exact !== 'boolean'
  ) {
    throw new TypeError(
      'awsSingleNodeNode instance page authority is invalid.',
    );
  }
  if (!isPlainObject(response) || !Array.isArray(response.Reservations)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (exact) throw new AwsSingleNodeNodeEvidenceConflictError();
    nextToken = response.NextToken;
  }
  const records = [];
  for (const reservation of response.Reservations) {
    if (
      !isPlainObject(reservation) ||
      typeof reservation.OwnerId !== 'string' ||
      !Array.isArray(reservation.Instances)
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (reservation.OwnerId !== providerScope.accountId) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    for (const instance of reservation.Instances) {
      if (
        !isPlainObject(instance) ||
        typeof instance.InstanceId !== 'string' ||
        !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId)
      ) {
        throw new AwsSingleNodeNodeEvidenceUnknownError();
      }
      records.push(
        deepFreeze(
          cloneEvidenceValue({
            ...instance,
            __wharfieReservationOwnerId: reservation.OwnerId,
          }),
        ),
      );
    }
  }
  return deepFreeze({ records, nextToken });
}

/** @param {unknown} response @param {string} instanceId @param {unknown} providerScope @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeNodeExactInstanceResponse(
  response,
  instanceId,
  providerScope,
) {
  if (
    typeof instanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instanceId)
  ) {
    throw new TypeError('awsSingleNodeNode exact instance ID is invalid.');
  }
  const page = decodeAwsSingleNodeNodeInstancePage(
    response,
    providerScope,
    true,
  );
  if (page.records.length === 0) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (page.records.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  if (page.records[0].InstanceId !== instanceId) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return page.records[0];
}

/** @param {unknown} response @param {string} expectedClientToken @param {string} accountId @returns {string} */
export function decodeAwsSingleNodeNodeRunCandidateId(
  response,
  expectedClientToken,
  accountId,
) {
  if (!isPlainObject(response) || !Array.isArray(response.Instances)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (response.Instances.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const instance = response.Instances[0];
  if (
    !isPlainObject(instance) ||
    typeof instance.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId)
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    (response.OwnerId !== undefined &&
      (typeof response.OwnerId !== 'string' ||
        response.OwnerId.length === 0)) ||
    (instance.ClientToken !== undefined &&
      (typeof instance.ClientToken !== 'string' ||
        instance.ClientToken.length === 0))
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    (response.OwnerId !== undefined && response.OwnerId !== accountId) ||
    (instance.ClientToken !== undefined &&
      instance.ClientToken !== expectedClientToken)
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return instance.InstanceId;
}

/** @param {unknown} value @param {unknown} options @returns {Readonly<{providerResourceId: string, lifecycle: string}>} */
export function decodeAwsSingleNodeNodeIdentityEvidence(value, options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeNode identity options must be an object.',
    );
  }
  assertExactKeys(
    options,
    IDENTITY_OPTIONS_KEYS,
    'awsSingleNodeNode identity options',
  );
  if (
    !isPlainObject(value) ||
    typeof value.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(value.InstanceId) ||
    typeof value.ClientToken !== 'string' ||
    typeof options.expectedClientToken !== 'string' ||
    (options.expectedInstanceId !== null &&
      (typeof options.expectedInstanceId !== 'string' ||
        !AWS_EC2_INSTANCE_ID_PATTERN.test(options.expectedInstanceId))) ||
    !isPlainObject(options.expectedTags) ||
    typeof options.allowTagPropagation !== 'boolean'
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    value.__wharfieReservationOwnerId !== options.providerScopeAccountId ||
    value.ClientToken !== options.expectedClientToken ||
    (options.expectedInstanceId !== null &&
      value.InstanceId !== options.expectedInstanceId)
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  validateAwsSingleNodeNodeManagedTags(
    value.Tags,
    options.expectedTags,
    options.allowTagPropagation,
  );
  return deepFreeze({
    providerResourceId: value.InstanceId,
    lifecycle: decodeAwsSingleNodeNodeLifecycle(value.State),
  });
}

/**
 * Decode one exact or discovery DescribeVolumes page.
 * @param {unknown} response - Raw DescribeVolumes response.
 * @param {boolean} exact - Whether pagination is forbidden.
 * @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}}
 */
export function decodeAwsSingleNodeNodeRootVolumePage(response, exact) {
  if (typeof exact !== 'boolean') {
    throw new TypeError('awsSingleNodeNode root page mode is invalid.');
  }
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (exact) throw new AwsSingleNodeNodeEvidenceConflictError();
    nextToken = response.NextToken;
  }
  const records = [];
  for (const volume of response.Volumes) {
    if (
      !isPlainObject(volume) ||
      typeof volume.VolumeId !== 'string' ||
      !AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN.test(volume.VolumeId)
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    records.push(deepFreeze(cloneEvidenceValue(volume)));
  }
  return deepFreeze({ records, nextToken });
}

/** @param {unknown} response @param {string} volumeId @returns {Readonly<Record<string, any>>} */
export function decodeAwsSingleNodeNodeExactRootVolumeResponse(
  response,
  volumeId,
) {
  if (
    typeof volumeId !== 'string' ||
    !AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN.test(volumeId)
  ) {
    throw new TypeError('awsSingleNodeNode exact root volume ID is invalid.');
  }
  const page = decodeAwsSingleNodeNodeRootVolumePage(response, true);
  if (page.records.length === 0) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (page.records.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  if (page.records[0].VolumeId !== volumeId) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return page.records[0];
}

/** @param {unknown} value @param {string} _path @returns {string} */
function requiredString(value, _path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @param {string} _path @returns {boolean} */
function requiredBoolean(value, _path) {
  if (typeof value !== 'boolean') {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @param {string} _path @returns {number} */
function requiredInteger(value, _path) {
  if (!Number.isSafeInteger(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return /** @type {number} */ (value);
}

/** @param {unknown} value @param {string} _path @returns {string|null} */
function nullableString(value, _path) {
  if (absent(value)) return null;
  if (typeof value !== 'string') {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {Readonly<Record<string, string>>|null} */
function decodeCapacityReservationTarget(value) {
  if (absent(value)) return null;
  if (
    !isPlainObject(value) ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const key = keys[0];
  const target = value[key];
  const valid =
    typeof target === 'string' &&
    target.length !== 0 &&
    ((key === 'CapacityReservationId' &&
      AWS_SINGLE_NODE_NODE_CAPACITY_RESERVATION_ID_PATTERN.test(target)) ||
      (key === 'CapacityReservationResourceGroupArn' &&
        AWS_SINGLE_NODE_NODE_CAPACITY_RESERVATION_GROUP_ARN_PATTERN.test(
          target,
        )));
  if (!valid) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return deepFreeze({ [key]: target });
}

/** @param {unknown} value @param {string} expectedVolumeId @param {string} expectedDeviceName @returns {Readonly<Record<string, any>>} */
function decodeInstanceBlockDeviceMappings(
  value,
  expectedVolumeId,
  expectedDeviceName,
) {
  if (!Array.isArray(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const deviceNames = new Set();
  const volumeIds = new Set();
  let root = null;
  for (const mapping of value) {
    if (
      !isPlainObject(mapping) ||
      typeof mapping.DeviceName !== 'string' ||
      mapping.DeviceName.length === 0 ||
      !isPlainObject(mapping.Ebs) ||
      typeof mapping.Ebs.VolumeId !== 'string' ||
      !AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN.test(mapping.Ebs.VolumeId) ||
      typeof mapping.Ebs.DeleteOnTermination !== 'boolean' ||
      typeof mapping.Ebs.Status !== 'string'
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (
      deviceNames.has(mapping.DeviceName) ||
      volumeIds.has(mapping.Ebs.VolumeId)
    ) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    deviceNames.add(mapping.DeviceName);
    volumeIds.add(mapping.Ebs.VolumeId);
    if (
      mapping.Ebs.Status === 'attaching' ||
      mapping.Ebs.Status === 'detaching'
    ) {
      throw new AwsSingleNodeNodeEvidenceTransientError();
    }
    if (mapping.Ebs.Status !== 'attached') {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    if (
      !absent(mapping.Ebs.AssociatedResource) ||
      !absent(mapping.Ebs.VolumeOwnerId)
    ) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    const ebsCardIndex = mapping.Ebs.EbsCardIndex ?? 0;
    if (!Number.isSafeInteger(ebsCardIndex) || ebsCardIndex < 0) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (ebsCardIndex !== 0) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    if (
      mapping.DeviceName === expectedDeviceName ||
      mapping.Ebs.VolumeId === expectedVolumeId
    ) {
      if (
        mapping.DeviceName !== expectedDeviceName ||
        mapping.Ebs.VolumeId !== expectedVolumeId ||
        root !== null
      ) {
        throw new AwsSingleNodeNodeEvidenceConflictError();
      }
      root = deepFreeze({
        deviceName: mapping.DeviceName,
        deleteOnTermination: mapping.Ebs.DeleteOnTermination,
        ebsCardIndex,
        status: mapping.Ebs.Status,
      });
    } else if (mapping.Ebs.DeleteOnTermination !== false) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
  }
  if (root === null) throw new AwsSingleNodeNodeEvidenceConflictError();
  return root;
}

/** @param {unknown} value @param {string} expectedDeviceName @returns {string|null} */
export function decodeAwsSingleNodeNodeTerminalRootVolumeId(
  value,
  expectedDeviceName,
) {
  if (
    typeof expectedDeviceName !== 'string' ||
    expectedDeviceName.length === 0
  ) {
    throw new TypeError(
      'awsSingleNodeNode terminal root device name is invalid.',
    );
  }
  if (absent(value)) return null;
  if (!Array.isArray(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const deviceNames = new Set();
  const volumeIds = new Set();
  let rootVolumeId = null;
  for (const mapping of value) {
    if (
      !isPlainObject(mapping) ||
      typeof mapping.DeviceName !== 'string' ||
      mapping.DeviceName.length === 0 ||
      !isPlainObject(mapping.Ebs) ||
      typeof mapping.Ebs.VolumeId !== 'string' ||
      !AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN.test(mapping.Ebs.VolumeId) ||
      typeof mapping.Ebs.DeleteOnTermination !== 'boolean' ||
      typeof mapping.Ebs.Status !== 'string'
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (
      deviceNames.has(mapping.DeviceName) ||
      volumeIds.has(mapping.Ebs.VolumeId)
    ) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    deviceNames.add(mapping.DeviceName);
    volumeIds.add(mapping.Ebs.VolumeId);
    if (
      !['attaching', 'attached', 'detaching', 'detached'].includes(
        mapping.Ebs.Status,
      ) ||
      (mapping.Ebs.EbsCardIndex !== undefined &&
        mapping.Ebs.EbsCardIndex !== 0) ||
      !absent(mapping.Ebs.AssociatedResource) ||
      !absent(mapping.Ebs.VolumeOwnerId)
    ) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    if (mapping.DeviceName === expectedDeviceName) {
      if (mapping.Ebs.DeleteOnTermination !== true) {
        throw new AwsSingleNodeNodeEvidenceConflictError();
      }
      rootVolumeId = mapping.Ebs.VolumeId;
    } else if (mapping.Ebs.DeleteOnTermination !== false) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
  }
  return rootVolumeId;
}

/** @param {unknown} value @param {string} publicIp @returns {void} */
function validateAutoPublicIpv4Association(value, publicIp) {
  if (
    !isPlainObject(value) ||
    typeof value.PublicIp !== 'string' ||
    !isIPv4(value.PublicIp) ||
    typeof value.IpOwnerId !== 'string'
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    value.PublicIp !== publicIp ||
    value.IpOwnerId !== 'amazon' ||
    !absent(value.AllocationId) ||
    !absent(value.AssociationId) ||
    !absent(value.CarrierIp) ||
    !absent(value.CustomerOwnedIp)
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateInstanceOptions(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeNode instance options must be an object.',
    );
  }
  assertExactKeys(
    value,
    INSTANCE_OPTIONS_KEYS,
    'awsSingleNodeNode instance options',
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value.providerSpec,
    'awsSingleNodeNode instance options.providerSpec',
  );
  for (const key of [
    'providerScopeAccountId',
    'vpcId',
    'subnetId',
    'securityGroupId',
    'instanceProfileId',
    'instanceProfileArn',
  ]) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new TypeError(
        `awsSingleNodeNode instance options.${key} must be a non-empty string.`,
      );
    }
  }
  return deepFreeze({ ...value, providerSpec });
}

/**
 * Decode topology and every provider-readable static instance field while
 * keeping lifecycle outside the returned state descriptor.
 * @param {unknown} value - Exact owned instance record.
 * @param {unknown} optionsValue - Exact provider and dependency authority.
 * @returns {Readonly<{rootVolumeId: string, readableState: Readonly<Record<string, any>>}>}
 */
export function decodeAwsSingleNodeNodeInstanceState(value, optionsValue) {
  const options = validateInstanceOptions(optionsValue);
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const spec = options.providerSpec;
  const node = spec.node;
  const lifecycle = decodeAwsSingleNodeNodeLifecycle(value.State);
  if (!Array.isArray(value.SecurityGroups)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    typeof value.VpcId !== 'string' ||
    value.VpcId.length === 0 ||
    typeof value.SubnetId !== 'string' ||
    value.SubnetId.length === 0 ||
    value.SecurityGroups.some(
      (group) =>
        !isPlainObject(group) ||
        typeof group.GroupId !== 'string' ||
        group.GroupId.length === 0,
    )
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    value.VpcId !== options.vpcId ||
    value.SubnetId !== options.subnetId ||
    value.SecurityGroups.length !== 1 ||
    value.SecurityGroups[0].GroupId !== options.securityGroupId
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  for (const key of [
    'Placement',
    'Monitoring',
    'CapacityReservationSpecification',
    'HibernationOptions',
    'EnclaveOptions',
    'MetadataOptions',
    'PrivateDnsNameOptions',
    'MaintenanceOptions',
    'IamInstanceProfile',
  ]) {
    if (!isPlainObject(value[key])) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
  }
  if (
    typeof value.IamInstanceProfile.Id !== 'string' ||
    value.IamInstanceProfile.Id.length === 0 ||
    typeof value.IamInstanceProfile.Arn !== 'string' ||
    value.IamInstanceProfile.Arn.length === 0
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    value.IamInstanceProfile.Id !== options.instanceProfileId ||
    value.IamInstanceProfile.Arn !== options.instanceProfileArn
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  if (!Array.isArray(value.NetworkInterfaces)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (value.NetworkInterfaces.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const network = value.NetworkInterfaces[0];
  if (
    !isPlainObject(network) ||
    typeof network.NetworkInterfaceId !== 'string' ||
    !AWS_SINGLE_NODE_NODE_NETWORK_INTERFACE_ID_PATTERN.test(
      network.NetworkInterfaceId,
    ) ||
    !isPlainObject(network.Attachment) ||
    !Array.isArray(network.Groups) ||
    !Array.isArray(network.PrivateIpAddresses)
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    typeof network.OwnerId !== 'string' ||
    network.OwnerId.length === 0 ||
    typeof network.VpcId !== 'string' ||
    network.VpcId.length === 0 ||
    typeof network.SubnetId !== 'string' ||
    network.SubnetId.length === 0 ||
    typeof network.Status !== 'string' ||
    typeof network.Attachment.Status !== 'string' ||
    !Number.isSafeInteger(network.Attachment.DeviceIndex) ||
    !Number.isSafeInteger(network.Attachment.NetworkCardIndex) ||
    typeof network.Attachment.DeleteOnTermination !== 'boolean' ||
    typeof value.PrivateIpAddress !== 'string' ||
    typeof network.PrivateIpAddress !== 'string' ||
    network.Groups.some(
      (group) =>
        !isPlainObject(group) ||
        typeof group.GroupId !== 'string' ||
        group.GroupId.length === 0,
    ) ||
    network.PrivateIpAddresses.some(
      (address) =>
        !isPlainObject(address) ||
        typeof address.Primary !== 'boolean' ||
        typeof address.PrivateIpAddress !== 'string',
    )
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    network.OwnerId !== options.providerScopeAccountId ||
    network.VpcId !== options.vpcId ||
    network.SubnetId !== options.subnetId ||
    network.Groups.length !== 1 ||
    network.Groups[0]?.GroupId !== options.securityGroupId ||
    network.Status !== 'in-use' ||
    network.Attachment.Status !== 'attached' ||
    network.PrivateIpAddresses.length !== 1 ||
    network.PrivateIpAddresses[0]?.Primary !== true ||
    !isIPv4(value.PrivateIpAddress) ||
    !isIPv4(network.PrivateIpAddress) ||
    network.PrivateIpAddress !== value.PrivateIpAddress ||
    typeof network.PrivateIpAddresses[0]?.PrivateIpAddress !== 'string' ||
    !isIPv4(network.PrivateIpAddresses[0].PrivateIpAddress) ||
    network.PrivateIpAddresses[0].PrivateIpAddress !== value.PrivateIpAddress
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const capacityTarget = decodeCapacityReservationTarget(
    value.CapacityReservationSpecification.CapacityReservationTarget,
  );
  const association = network.Association;
  const privateAssociation = network.PrivateIpAddresses[0].Association;
  const noPublicAssociation =
    absent(association) &&
    absent(privateAssociation) &&
    absent(value.PublicIpAddress);
  if (!noPublicAssociation) {
    const publicIp =
      typeof value.PublicIpAddress === 'string' && isIPv4(value.PublicIpAddress)
        ? value.PublicIpAddress
        : isPlainObject(association) &&
            typeof association.PublicIp === 'string' &&
            isIPv4(association.PublicIp)
          ? association.PublicIp
          : isPlainObject(privateAssociation) &&
              typeof privateAssociation.PublicIp === 'string' &&
              isIPv4(privateAssociation.PublicIp)
            ? privateAssociation.PublicIp
            : null;
    if (publicIp === null) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (!absent(association)) {
      validateAutoPublicIpv4Association(association, publicIp);
    }
    if (!absent(privateAssociation)) {
      validateAutoPublicIpv4Association(privateAssociation, publicIp);
    }
    if (
      absent(value.PublicIpAddress) ||
      absent(association) ||
      absent(privateAssociation)
    ) {
      throw new AwsSingleNodeNodeEvidenceTransientError();
    }
  }
  if (lifecycle === 'stopped' && !noPublicAssociation) {
    throw new AwsSingleNodeNodeEvidenceTransientError();
  }
  if (lifecycle === 'running' && noPublicAssociation) {
    throw new AwsSingleNodeNodeEvidenceTransientError();
  }
  const rootMapping = decodeInstanceBlockDeviceMappings(
    value.BlockDeviceMappings,
    value.BlockDeviceMappings?.find(
      (/** @type {Readonly<Record<string, any>>} */ mapping) =>
        mapping?.DeviceName === node.rootVolume.deviceName,
    )?.Ebs?.VolumeId,
    node.rootVolume.deviceName,
  );
  const rootRecord = value.BlockDeviceMappings.find(
    (/** @type {Readonly<Record<string, any>>} */ mapping) =>
      mapping?.DeviceName === node.rootVolume.deviceName,
  );
  if (
    !isPlainObject(rootRecord) ||
    !isPlainObject(rootRecord.Ebs) ||
    typeof rootRecord.Ebs.VolumeId !== 'string'
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const readableState = deepFreeze({
    imageId: requiredString(value.ImageId, 'ImageId'),
    architecture: requiredString(value.Architecture, 'Architecture'),
    instanceType: requiredString(value.InstanceType, 'InstanceType'),
    amiLaunchIndex: requiredInteger(value.AmiLaunchIndex, 'AmiLaunchIndex'),
    ebsOptimized: requiredBoolean(value.EbsOptimized, 'EbsOptimized'),
    enaSupport: requiredBoolean(value.EnaSupport, 'EnaSupport'),
    virtualizationType: requiredString(
      value.VirtualizationType,
      'VirtualizationType',
    ),
    rootDeviceName: requiredString(value.RootDeviceName, 'RootDeviceName'),
    rootDeviceType: requiredString(value.RootDeviceType, 'RootDeviceType'),
    sourceDestCheck: requiredBoolean(value.SourceDestCheck, 'SourceDestCheck'),
    keyName: nullableString(value.KeyName, 'KeyName'),
    instanceLifecycle: nullableString(
      value.InstanceLifecycle,
      'InstanceLifecycle',
    ),
    spotInstanceRequestId: nullableString(
      value.SpotInstanceRequestId,
      'SpotInstanceRequestId',
    ),
    capacityBlockId: nullableString(value.CapacityBlockId, 'CapacityBlockId'),
    placement: {
      availabilityZoneId: requiredString(
        value.Placement.AvailabilityZoneId,
        'Placement.AvailabilityZoneId',
      ),
      tenancy: requiredString(value.Placement.Tenancy, 'Placement.Tenancy'),
    },
    monitoringState: requiredString(value.Monitoring.State, 'Monitoring.State'),
    capacityReservation: {
      preference: requiredString(
        value.CapacityReservationSpecification.CapacityReservationPreference,
        'CapacityReservationSpecification.CapacityReservationPreference',
      ),
      target: capacityTarget,
      id: nullableString(value.CapacityReservationId, 'CapacityReservationId'),
    },
    hibernation: requiredBoolean(
      value.HibernationOptions.Configured,
      'HibernationOptions.Configured',
    ),
    enclave: requiredBoolean(
      value.EnclaveOptions.Enabled,
      'EnclaveOptions.Enabled',
    ),
    metadata: {
      state: requiredString(
        value.MetadataOptions.State,
        'MetadataOptions.State',
      ),
      httpEndpoint: requiredString(
        value.MetadataOptions.HttpEndpoint,
        'MetadataOptions.HttpEndpoint',
      ),
      httpTokens: requiredString(
        value.MetadataOptions.HttpTokens,
        'MetadataOptions.HttpTokens',
      ),
      httpPutResponseHopLimit: requiredInteger(
        value.MetadataOptions.HttpPutResponseHopLimit,
        'MetadataOptions.HttpPutResponseHopLimit',
      ),
      httpProtocolIpv6: requiredString(
        value.MetadataOptions.HttpProtocolIpv6,
        'MetadataOptions.HttpProtocolIpv6',
      ),
      instanceMetadataTags: requiredString(
        value.MetadataOptions.InstanceMetadataTags,
        'MetadataOptions.InstanceMetadataTags',
      ),
    },
    privateDns: {
      hostnameType: requiredString(
        value.PrivateDnsNameOptions.HostnameType,
        'PrivateDnsNameOptions.HostnameType',
      ),
      enableResourceNameDnsARecord: requiredBoolean(
        value.PrivateDnsNameOptions.EnableResourceNameDnsARecord,
        'PrivateDnsNameOptions.EnableResourceNameDnsARecord',
      ),
      enableResourceNameDnsAaaaRecord: requiredBoolean(
        value.PrivateDnsNameOptions.EnableResourceNameDnsAAAARecord,
        'PrivateDnsNameOptions.EnableResourceNameDnsAAAARecord',
      ),
    },
    maintenanceAutoRecovery: requiredString(
      value.MaintenanceOptions.AutoRecovery,
      'MaintenanceOptions.AutoRecovery',
    ),
    network: {
      interfaceType: requiredString(
        network.InterfaceType,
        'NetworkInterfaces.InterfaceType',
      ),
      description:
        typeof network.Description === 'string'
          ? network.Description
          : requiredString(
              network.Description,
              'NetworkInterfaces.Description',
            ),
      sourceDestCheck: requiredBoolean(
        network.SourceDestCheck,
        'NetworkInterfaces.SourceDestCheck',
      ),
      deviceIndex: requiredInteger(
        network.Attachment.DeviceIndex,
        'NetworkInterfaces.Attachment.DeviceIndex',
      ),
      networkCardIndex: requiredInteger(
        network.Attachment.NetworkCardIndex,
        'NetworkInterfaces.Attachment.NetworkCardIndex',
      ),
      deleteOnTermination: requiredBoolean(
        network.Attachment.DeleteOnTermination,
        'NetworkInterfaces.Attachment.DeleteOnTermination',
      ),
      ipv6AddressCount: Array.isArray(network.Ipv6Addresses)
        ? network.Ipv6Addresses.length
        : emptyArray(network.Ipv6Addresses)
          ? 0
          : (() => {
              throw new AwsSingleNodeNodeEvidenceUnknownError();
            })(),
      ipv4PrefixCount: Array.isArray(network.Ipv4Prefixes)
        ? network.Ipv4Prefixes.length
        : emptyArray(network.Ipv4Prefixes)
          ? 0
          : (() => {
              throw new AwsSingleNodeNodeEvidenceUnknownError();
            })(),
      ipv6PrefixCount: Array.isArray(network.Ipv6Prefixes)
        ? network.Ipv6Prefixes.length
        : emptyArray(network.Ipv6Prefixes)
          ? 0
          : (() => {
              throw new AwsSingleNodeNodeEvidenceUnknownError();
            })(),
    },
    rootMapping,
  });
  return deepFreeze({
    rootVolumeId: rootRecord.Ebs.VolumeId,
    readableState,
  });
}

/** @param {unknown} response @param {string} instanceId @param {string} attribute @returns {unknown} */
export function decodeAwsSingleNodeNodeInstanceAttribute(
  response,
  instanceId,
  attribute,
) {
  /** @type {Readonly<Record<string, string>>} */
  const responseKeys = Object.freeze({
    userData: 'UserData',
    disableApiTermination: 'DisableApiTermination',
    disableApiStop: 'DisableApiStop',
    instanceInitiatedShutdownBehavior: 'InstanceInitiatedShutdownBehavior',
  });
  const responseKey = responseKeys[attribute];
  if (typeof responseKey !== 'string') {
    throw new TypeError(
      'awsSingleNodeNode instance attribute is not supported.',
    );
  }
  if (
    !isPlainObject(response) ||
    response.InstanceId !== instanceId ||
    !isPlainObject(response[responseKey]) ||
    !Object.hasOwn(response[responseKey], 'Value')
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const observed = response[responseKey].Value;
  if (
    (attribute === 'userData' && typeof observed !== 'string') ||
    ((attribute === 'disableApiTermination' ||
      attribute === 'disableApiStop') &&
      typeof observed !== 'boolean') ||
    (attribute === 'instanceInitiatedShutdownBehavior' &&
      typeof observed !== 'string')
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return observed;
}

/** @param {unknown} response @param {string} instanceId @returns {string} */
export function decodeAwsSingleNodeNodeCreditSpecification(
  response,
  instanceId,
) {
  if (
    !isPlainObject(response) ||
    !Array.isArray(response.InstanceCreditSpecifications)
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    response.NextToken !== undefined &&
    response.NextToken !== null &&
    (typeof response.NextToken !== 'string' || response.NextToken.length === 0)
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (typeof response.NextToken === 'string') {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  if (response.InstanceCreditSpecifications.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const credit = response.InstanceCreditSpecifications[0];
  if (
    !isPlainObject(credit) ||
    typeof credit.InstanceId !== 'string' ||
    typeof credit.CpuCredits !== 'string'
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (credit.InstanceId !== instanceId) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return credit.CpuCredits;
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateRootOptions(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeNode root volume options must be an object.',
    );
  }
  assertExactKeys(
    value,
    ROOT_OPTIONS_KEYS,
    'awsSingleNodeNode root volume options',
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value.providerSpec,
    'awsSingleNodeNode root volume options.providerSpec',
  );
  if (
    !isPlainObject(value.expectedTags) ||
    typeof value.allowTagPropagation !== 'boolean' ||
    typeof value.instanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(value.instanceId)
  ) {
    throw new TypeError('awsSingleNodeNode root volume options are invalid.');
  }
  return deepFreeze({
    ...value,
    providerSpec,
    expectedTags: cloneEvidenceValue(value.expectedTags),
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validatePurgeOptions(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeNode root purge options must be an object.',
    );
  }
  assertExactKeys(
    value,
    PURGE_OPTIONS_KEYS,
    'awsSingleNodeNode root purge options',
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value.providerSpec,
    'awsSingleNodeNode root purge options.providerSpec',
  );
  if (
    !isPlainObject(value.expectedTags) ||
    typeof value.instanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(value.instanceId)
  ) {
    throw new TypeError('awsSingleNodeNode root purge options are invalid.');
  }
  return deepFreeze({
    ...value,
    providerSpec,
    expectedTags: cloneEvidenceValue(value.expectedTags),
  });
}

/**
 * Decode immutable intrinsic root-volume state and exact Wharfie ownership.
 * @param {unknown} value - Exact DescribeVolumes record.
 * @param {Readonly<Record<string, any>>} options - Provider and tag authority.
 * @returns {Readonly<Record<string, any>>}
 */
function decodeRootVolumeIntrinsic(value, options) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  for (const key of [
    'VolumeId',
    'AvailabilityZoneId',
    'VolumeType',
    'KmsKeyId',
    'State',
  ]) {
    requiredString(value[key], key);
  }
  if (!AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN.test(value.VolumeId)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  for (const key of ['Size', 'Iops', 'Throughput']) {
    requiredInteger(value[key], key);
  }
  if (
    typeof value.Encrypted !== 'boolean' ||
    typeof value.MultiAttachEnabled !== 'boolean' ||
    !Array.isArray(value.Attachments)
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (value.Operator !== undefined && value.Operator !== null) {
    if (
      !isPlainObject(value.Operator) ||
      typeof value.Operator.Managed !== 'boolean'
    ) {
      throw new AwsSingleNodeNodeEvidenceUnknownError();
    }
    if (value.Operator.Managed || !absent(value.Operator.Principal)) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
  }
  validateAwsSingleNodeNodeManagedTags(
    value.Tags,
    options.expectedTags,
    options.allowTagPropagation,
  );
  return deepFreeze({
    availabilityZoneId: value.AvailabilityZoneId,
    snapshotId: nullableString(value.SnapshotId, 'SnapshotId'),
    volumeType: value.VolumeType,
    size: value.Size,
    iops: value.Iops,
    throughput: value.Throughput,
    encrypted: value.Encrypted,
    kmsKeyId: value.KmsKeyId,
    multiAttach: value.MultiAttachEnabled,
    sourceVolumeId: nullableString(value.SourceVolumeId, 'SourceVolumeId'),
    outpostArn: nullableString(value.OutpostArn, 'OutpostArn'),
    volumeInitializationRate: absent(value.VolumeInitializationRate)
      ? null
      : requiredInteger(
          value.VolumeInitializationRate,
          'VolumeInitializationRate',
        ),
    sseType: absent(value.SseType)
      ? 'sse-kms'
      : requiredString(value.SseType, 'SseType'),
  });
}

/** @param {Readonly<Record<string, any>>} providerSpec @returns {Readonly<Record<string, any>>} */
function desiredRootVolumeIntrinsic(providerSpec) {
  const root = providerSpec.node.rootVolume;
  return deepFreeze({
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    snapshotId: root.snapshotId,
    volumeType: root.volumeType,
    size: root.sizeGiB,
    iops: root.iops,
    throughput: root.throughputMiBps,
    encrypted: root.encrypted,
    kmsKeyId: providerSpec.storage.ebsKmsKeyArn,
    multiAttach: root.multiAttach,
    sourceVolumeId: null,
    outpostArn: null,
    volumeInitializationRate: null,
    sseType: 'sse-kms',
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} options @returns {Readonly<Record<string, any>>} */
function decodeRootVolumeAttachment(value, volume, options) {
  if (!isPlainObject(value) || typeof value.State !== 'string') {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    value.VolumeId !== volume.VolumeId ||
    value.InstanceId !== options.instanceId ||
    !absent(value.AssociatedResource) ||
    !absent(value.InstanceOwningService)
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const ebsCardIndex = value.EbsCardIndex ?? 0;
  if (!Number.isSafeInteger(ebsCardIndex) || ebsCardIndex < 0) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  if (
    !['attaching', 'attached', 'detaching', 'detached', 'busy'].includes(
      value.State,
    )
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return deepFreeze({
    state: value.State,
    device: requiredString(value.Device, 'Attachments.Device'),
    deleteOnTermination: requiredBoolean(
      value.DeleteOnTermination,
      'Attachments.DeleteOnTermination',
    ),
    ebsCardIndex,
  });
}

/**
 * Decode a live root volume. Provider lifecycle is proved but excluded from
 * readable state so ordinary convergence does not alter the state digest.
 * @param {unknown} value - Exact root volume.
 * @param {unknown} optionsValue - Exact provider, ownership, and instance authority.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeNodeRootVolumeState(value, optionsValue) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const options = validateRootOptions(optionsValue);
  const intrinsic = decodeRootVolumeIntrinsic(value, options);
  if (value.State === 'creating') {
    throw new AwsSingleNodeNodeEvidenceTransientError();
  }
  if (value.State !== 'in-use') {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  if (value.Attachments.length !== 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const attachment = decodeRootVolumeAttachment(
    value.Attachments[0],
    value,
    options,
  );
  if (attachment.state === 'attaching') {
    throw new AwsSingleNodeNodeEvidenceTransientError();
  }
  if (attachment.state !== 'attached') {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  return deepFreeze({
    ...intrinsic,
    attachment: {
      device: attachment.device,
      deleteOnTermination: attachment.deleteOnTermination,
      ebsCardIndex: attachment.ebsCardIndex,
    },
  });
}

/**
 * Decode root-volume terminal evidence used only after the exact bound
 * instance is terminal or absent.
 * @param {unknown} value - Exact root volume.
 * @param {unknown} optionsValue - Exact provider, ownership, and instance authority.
 * @returns {'deleted'|'not-converged'}
 */
export function decodeAwsSingleNodeNodeRootVolumePurgeEvidence(
  value,
  optionsValue,
) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  const options = validatePurgeOptions(optionsValue);
  const rootOptions = { ...options, allowTagPropagation: false };
  decodeRootVolumeIntrinsic(value, rootOptions);
  if (value.Attachments.length > 1) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  const attachment =
    value.Attachments.length === 0
      ? null
      : decodeRootVolumeAttachment(value.Attachments[0], value, rootOptions);
  if (
    attachment !== null &&
    (attachment.device !== options.providerSpec.node.rootVolume.deviceName ||
      attachment.deleteOnTermination !==
        options.providerSpec.node.rootVolume.deleteOnTermination ||
      attachment.ebsCardIndex !== 0)
  ) {
    throw new AwsSingleNodeNodeEvidenceConflictError();
  }
  if (value.State === 'deleted') {
    if (attachment !== null) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    return 'deleted';
  }
  if (value.State === 'deleting') return 'not-converged';
  if (value.State === 'in-use') {
    if (
      attachment === null ||
      !['attached', 'detaching', 'busy'].includes(attachment.state)
    ) {
      throw new AwsSingleNodeNodeEvidenceConflictError();
    }
    return 'not-converged';
  }
  throw new AwsSingleNodeNodeEvidenceConflictError();
}

/**
 * Assemble the complete normalized readable state only after all independent
 * exact reads have been decoded.
 * @param {unknown} instance - Normalized instance state.
 * @param {unknown} attributes - Four exact instance attributes.
 * @param {unknown} cpuCredits - Exact credit mode.
 * @param {unknown} rootVolume - Normalized root volume state.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeNodeReadableState(
  instance,
  attributes,
  cpuCredits,
  rootVolume,
) {
  if (
    !isPlainObject(instance) ||
    !isPlainObject(attributes) ||
    !isPlainObject(rootVolume) ||
    typeof cpuCredits !== 'string'
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  assertExactKeys(
    attributes,
    ATTRIBUTE_KEYS,
    'awsSingleNodeNode observed attributes',
  );
  if (
    typeof attributes.userData !== 'string' ||
    typeof attributes.disableApiTermination !== 'boolean' ||
    typeof attributes.disableApiStop !== 'boolean' ||
    typeof attributes.instanceInitiatedShutdownBehavior !== 'string'
  ) {
    throw new AwsSingleNodeNodeEvidenceUnknownError();
  }
  return deepFreeze({
    instance: cloneEvidenceValue(instance),
    attributes: cloneEvidenceValue(attributes),
    cpuCredits,
    rootVolume: cloneEvidenceValue(rootVolume),
  });
}

/**
 * Materialize the normalized desired readable state. This is intentionally
 * separate from provider decoding so observed drift remains evidence rather
 * than being rewritten into the desired contract.
 * @param {unknown} value - Exact provider specification.
 * @param {unknown} nameAuthority - Exact deterministic runtime-name authority.
 * @returns {Readonly<Record<string, any>>}
 */
export function getAwsSingleNodeNodeDesiredReadableState(value, nameAuthority) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeNode desired readable providerSpec',
  );
  // Reuse the state descriptor's exact name/scope validation even though the
  // generated profile name itself is represented by the separately-proved
  // instance-profile topology.
  desiredStateDescriptor(providerSpec, nameAuthority);
  const node = providerSpec.node;
  const network = node.primaryNetworkInterface;
  const root = node.rootVolume;
  return createAwsSingleNodeNodeReadableState(
    {
      imageId: providerSpec.machineImage.imageId,
      architecture: providerSpec.machineImage.architecture,
      instanceType: node.instanceType,
      amiLaunchIndex: 0,
      ebsOptimized: node.ebsOptimized,
      enaSupport: providerSpec.machineImage.enaSupport,
      virtualizationType: providerSpec.machineImage.virtualizationType,
      rootDeviceName: root.deviceName,
      rootDeviceType: providerSpec.machineImage.rootDeviceType,
      sourceDestCheck: network.sourceDestCheck,
      keyName: null,
      instanceLifecycle: null,
      spotInstanceRequestId: null,
      capacityBlockId: null,
      placement: {
        availabilityZoneId: providerSpec.placement.availabilityZoneId,
        tenancy: node.tenancy,
      },
      monitoringState: node.monitoring ? 'enabled' : 'disabled',
      capacityReservation: {
        preference: node.capacityReservationPreference,
        target: null,
        id: null,
      },
      hibernation: node.hibernation,
      enclave: node.enclave,
      metadata: {
        state: 'applied',
        httpEndpoint: node.metadataOptions.httpEndpoint,
        httpTokens: node.metadataOptions.httpTokens,
        httpPutResponseHopLimit: node.metadataOptions.httpPutResponseHopLimit,
        httpProtocolIpv6: node.metadataOptions.httpProtocolIpv6,
        instanceMetadataTags: node.metadataOptions.instanceMetadataTags,
      },
      privateDns: {
        hostnameType: node.privateDnsNameOptions.hostnameType,
        enableResourceNameDnsARecord:
          node.privateDnsNameOptions.enableResourceNameDnsARecord,
        enableResourceNameDnsAaaaRecord:
          node.privateDnsNameOptions.enableResourceNameDnsAaaaRecord,
      },
      maintenanceAutoRecovery: node.maintenanceAutoRecovery,
      network: {
        interfaceType: network.interfaceType,
        description: network.description,
        sourceDestCheck: network.sourceDestCheck,
        deviceIndex: network.deviceIndex,
        networkCardIndex: network.networkCardIndex,
        deleteOnTermination: network.deleteOnTermination,
        ipv6AddressCount: network.ipv6AddressCount,
        ipv4PrefixCount: 0,
        ipv6PrefixCount: 0,
      },
      rootMapping: {
        deviceName: root.deviceName,
        deleteOnTermination: root.deleteOnTermination,
        ebsCardIndex: 0,
        status: 'attached',
      },
    },
    {
      userData: getAwsSingleNodeBootstrapBase64(),
      disableApiTermination: node.terminationProtection,
      disableApiStop: node.stopProtection,
      instanceInitiatedShutdownBehavior: node.instanceInitiatedShutdownBehavior,
    },
    node.cpuCredits,
    {
      ...desiredRootVolumeIntrinsic(providerSpec),
      attachment: {
        device: root.deviceName,
        deleteOnTermination: root.deleteOnTermination,
        ebsCardIndex: 0,
      },
    },
  );
}

export default {
  AWS_SINGLE_NODE_NODE_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_NODE_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_NODE_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_ROOT_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_NODE_MAX_TAGS,
  AWS_SINGLE_NODE_NODE_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_NODE_CREATE_CLIENT_TOKEN_DOMAIN,
  AWS_SINGLE_NODE_NODE_VOLUME_ID_PATTERN,
  AWS_SINGLE_NODE_NODE_NETWORK_INTERFACE_ID_PATTERN,
  AWS_SINGLE_NODE_NODE_BASE_INSTANCE_TAGS,
  AWS_SINGLE_NODE_NODE_BASE_ROOT_VOLUME_TAGS,
  AwsSingleNodeNodeEvidenceConflictError,
  AwsSingleNodeNodeEvidenceTransientError,
  AwsSingleNodeNodeEvidenceUnknownError,
  getAwsSingleNodeNodeStateDigest,
  getAwsSingleNodeNodeObservedStateDigest,
  getAwsSingleNodeNodeCreateClientToken,
  getAwsSingleNodeNodeRootVolumeTags,
  validateAwsSingleNodeNodeManagedTags,
  decodeAwsSingleNodeNodeLifecycle,
  getAwsSingleNodeNodeLifecycleHealth,
  decodeAwsSingleNodeNodeInstancePage,
  decodeAwsSingleNodeNodeExactInstanceResponse,
  decodeAwsSingleNodeNodeRunCandidateId,
  decodeAwsSingleNodeNodeIdentityEvidence,
  decodeAwsSingleNodeNodeRootVolumePage,
  decodeAwsSingleNodeNodeExactRootVolumeResponse,
  decodeAwsSingleNodeNodeTerminalRootVolumeId,
  decodeAwsSingleNodeNodeInstanceState,
  decodeAwsSingleNodeNodeInstanceAttribute,
  decodeAwsSingleNodeNodeCreditSpecification,
  decodeAwsSingleNodeNodeRootVolumeState,
  decodeAwsSingleNodeNodeRootVolumePurgeEvidence,
  createAwsSingleNodeNodeReadableState,
  getAwsSingleNodeNodeDesiredReadableState,
};
