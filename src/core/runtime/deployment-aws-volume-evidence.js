/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { validateSha256Digest } from './application-revision.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';

export const AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS = 500;
export const AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-state:v1';

const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
const AVAILABILITY_ZONE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*-az[1-9][0-9]*$/;
const KMS_KEY_ARN_PATTERN =
  /^arn:([a-z0-9-]+):kms:([a-z0-9-]+):([0-9]{12}):key\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|mrk-[0-9a-f]{32})$/;
const EBS_VOLUME_TYPES = new Set([
  'standard',
  'io1',
  'io2',
  'gp2',
  'gp3',
  'sc1',
  'st1',
]);
const MAX_VOLUME_TAGS = 50;
const STATE_DESCRIPTOR_KEYS = new Set([
  'availabilityZoneId',
  'kmsKeyArn',
  'volumeType',
  'sizeGiB',
  'iops',
  'throughputMiBps',
  'multiAttach',
  'encrypted',
  'onDestroy',
]);
const TAG_LOCATOR_KEYS = new Set([
  'capabilityKind',
  'roleKind',
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
  'resourceKey',
]);
const TAG_OWNERSHIP_KEYS = new Set([
  ...TAG_LOCATOR_KEYS,
  'createdByActionId',
  'ownershipNonce',
]);
const EVIDENCE_OPTION_KEYS = new Set([
  'allowTagPropagation',
  'expectedOwnershipTags',
  'expectedStateDigestValue',
  'region',
]);
const LOCATOR_TAG_KEYS = Object.freeze([
  'wharfie:managed-by',
  'wharfie:resource-kind',
  'wharfie:capability',
  'wharfie:role',
  'wharfie:provider-scope-id',
  'wharfie:deployment-instance-id',
  'wharfie:incarnation-id',
  'wharfie:resource-key',
]);
const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-state-volume',
  'wharfie:retention': 'retain',
  'wharfie:schema-version': '2',
});
const EXACT_LOCATOR_TAG_KEYS = new Set([
  ...Object.keys(BASE_RESERVED_TAGS),
  'wharfie:capability',
  'wharfie:role',
  'wharfie:provider-scope-id',
  'wharfie:deployment-instance-id',
  'wharfie:incarnation-id',
  'wharfie:resource-key',
]);
const EXACT_OWNERSHIP_TAG_KEYS = new Set([
  ...EXACT_LOCATOR_TAG_KEYS,
  'wharfie:created-by-action-id',
  'wharfie:ownership-nonce',
]);
const COLLISION_RECEIPT_TAG_KEYS = new Set([
  'wharfie:created-by-action-id',
  'wharfie:ownership-nonce',
  'wharfie:state-digest',
]);

/** Provider evidence contradicts one exact retained volume identity. */
export class AwsSingleNodeVolumeEvidenceConflictError extends Error {}

/** Well-formed create evidence may still be propagating. */
export class AwsSingleNodeVolumeEvidenceTransientError extends Error {}

/** Provider access or a malformed response could not establish safe evidence. */
export class AwsSingleNodeVolumeEvidenceUnknownError extends Error {}

/** A real volume is in a lifecycle state without stable readable evidence. */
export class AwsSingleNodeVolumeLifecycleUnknownError extends Error {}

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

/** @param {unknown} value @param {string} path @returns {string} */
function requiredString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function exactObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value;
}

/** @param {unknown} value @returns {string} */
function volumeId(value) {
  if (typeof value !== 'string' || !VOLUME_ID_PATTERN.test(value)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeVolumeId(value) {
  return volumeId(value);
}

/**
 * Build the stable locator tags shared by mutation recovery and read-only
 * collision discovery.
 * @param {unknown} value - Exact deployment and resource locator tuple.
 * @returns {Readonly<Record<string, string>>} - Canonical locator tag values.
 */
export function getAwsSingleNodeVolumeLocatorTags(value) {
  const input = exactObject(value, 'awsSingleNodeVolume locator');
  assertExactKeys(input, TAG_LOCATOR_KEYS, 'awsSingleNodeVolume locator');
  return deepFreeze({
    ...BASE_RESERVED_TAGS,
    'wharfie:capability': requiredString(
      input.capabilityKind,
      'awsSingleNodeVolume locator.capabilityKind',
    ),
    'wharfie:role': requiredString(
      input.roleKind,
      'awsSingleNodeVolume locator.roleKind',
    ),
    'wharfie:provider-scope-id': requiredString(
      input.providerScopeId,
      'awsSingleNodeVolume locator.providerScopeId',
    ),
    'wharfie:deployment-instance-id': requiredString(
      input.deploymentInstanceId,
      'awsSingleNodeVolume locator.deploymentInstanceId',
    ),
    'wharfie:incarnation-id': requiredString(
      input.incarnationId,
      'awsSingleNodeVolume locator.incarnationId',
    ),
    'wharfie:resource-key': requiredString(
      input.resourceKey,
      'awsSingleNodeVolume locator.resourceKey',
    ),
  });
}

/**
 * Extend stable locator tags with the durable creation receipt and ownership
 * nonce. The historical state-digest tag is handled separately because a
 * bound volume may be observed against a newer prospective desired state.
 * @param {unknown} value - Exact ownership tag tuple.
 * @returns {Readonly<Record<string, string>>} - Canonical ownership tags.
 */
export function getAwsSingleNodeVolumeOwnershipTags(value) {
  const input = exactObject(value, 'awsSingleNodeVolume ownership tags');
  assertExactKeys(
    input,
    TAG_OWNERSHIP_KEYS,
    'awsSingleNodeVolume ownership tags',
  );
  return deepFreeze({
    ...getAwsSingleNodeVolumeLocatorTags({
      capabilityKind: input.capabilityKind,
      roleKind: input.roleKind,
      providerScopeId: input.providerScopeId,
      deploymentInstanceId: input.deploymentInstanceId,
      incarnationId: input.incarnationId,
      resourceKey: input.resourceKey,
    }),
    'wharfie:created-by-action-id': requiredString(
      input.createdByActionId,
      'awsSingleNodeVolume ownership tags.createdByActionId',
    ),
    'wharfie:ownership-nonce': requiredString(
      input.ownershipNonce,
      'awsSingleNodeVolume ownership tags.ownershipNonce',
    ),
  });
}

/** @param {unknown} value @returns {Readonly<Array<Readonly<{Name: string, Values: readonly string[]}>>>} */
export function getAwsSingleNodeVolumeDiscoveryFilters(value) {
  const tags = getAwsSingleNodeVolumeLocatorTags(value);
  return deepFreeze(
    LOCATOR_TAG_KEYS.map((key) => ({
      Name: `tag:${key}`,
      Values: [tags[key]],
    })),
  );
}

/**
 * Hash one normalized provider-observable retained-volume configuration.
 * Nullable IOPS, throughput, or KMS identity preserve readable drift from a
 * supported non-gp3 or unencrypted state without mistaking it for desired
 * configuration.
 * @param {unknown} descriptor - Normalized state.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - State digest.
 */
export function createAwsSingleNodeVolumeStateDigest(descriptor) {
  const input = exactObject(descriptor, 'awsSingleNodeVolume state');
  assertExactKeys(input, STATE_DESCRIPTOR_KEYS, 'awsSingleNodeVolume state');
  if (
    typeof input.availabilityZoneId !== 'string' ||
    !AVAILABILITY_ZONE_ID_PATTERN.test(input.availabilityZoneId) ||
    typeof input.volumeType !== 'string' ||
    !EBS_VOLUME_TYPES.has(input.volumeType) ||
    !Number.isSafeInteger(input.sizeGiB) ||
    input.sizeGiB < 1 ||
    (input.iops !== null &&
      (!Number.isSafeInteger(input.iops) || input.iops < 1)) ||
    (input.throughputMiBps !== null &&
      (!Number.isSafeInteger(input.throughputMiBps) ||
        input.throughputMiBps < 1)) ||
    typeof input.multiAttach !== 'boolean' ||
    typeof input.encrypted !== 'boolean' ||
    input.onDestroy !== 'retain' ||
    (input.kmsKeyArn !== null &&
      (typeof input.kmsKeyArn !== 'string' ||
        !KMS_KEY_ARN_PATTERN.test(input.kmsKeyArn))) ||
    (input.encrypted ? input.kmsKeyArn === null : input.kmsKeyArn !== null) ||
    (input.volumeType === 'gp3' &&
      (input.iops === null || input.throughputMiBps === null))
  ) {
    throw new TypeError(
      'awsSingleNodeVolume state does not match the exact readable EBS configuration schema.',
    );
  }
  const canonical = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEbsVolumeState',
    availabilityZoneId: input.availabilityZoneId,
    kmsKeyArn: input.kmsKeyArn,
    volumeType: input.volumeType,
    sizeGiB: input.sizeGiB,
    iops: input.iops,
    throughputMiBps: input.throughputMiBps,
    multiAttach: input.multiAttach,
    encrypted: input.encrypted,
    onDestroy: input.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        canonical,
      )}`,
    ),
  });
}

/** @param {unknown} response @param {string} exactVolumeId @returns {Readonly<Record<string, any>>|null} */
export function decodeAwsSingleNodeExactVolumeResponse(
  response,
  exactVolumeId,
) {
  const expectedId = volumeId(exactVolumeId);
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  if (response.Volumes.length === 0) return null;
  if (response.Volumes.length !== 1) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  const volume = response.Volumes[0];
  if (!isPlainObject(volume)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (volumeId(volume.VolumeId) !== expectedId) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  return volume;
}

/** @param {unknown} response @returns {{volumes: Readonly<Record<string, any>>[], nextToken: string|null}} */
export function decodeAwsSingleNodeVolumeDiscoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    nextToken = response.NextToken;
  }
  const volumes = [];
  for (const volume of response.Volumes) {
    if (!isPlainObject(volume)) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    volumeId(volume.VolumeId);
    volumes.push(volume);
  }
  return { volumes, nextToken };
}

/** @param {unknown} operator @returns {void} */
function validateOperator(operator) {
  if (operator === undefined || operator === null) return;
  if (!isPlainObject(operator) || typeof operator.Managed !== 'boolean') {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (operator.Managed || operator.Principal !== undefined) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
}

/** @param {unknown} tagsValue @param {Readonly<Record<string, string>>} expected @param {string|null} expectedStateDigestValue @param {boolean} allowPropagation @returns {void} */
function validateTags(
  tagsValue,
  expected,
  expectedStateDigestValue,
  allowPropagation,
) {
  if (!Array.isArray(tagsValue)) {
    if (allowPropagation && (tagsValue === undefined || tagsValue === null)) {
      throw new AwsSingleNodeVolumeEvidenceTransientError();
    }
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (tagsValue.length > MAX_VOLUME_TAGS) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  const observed = new Map();
  for (const tag of tagsValue) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      typeof tag.Value !== 'string'
    ) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    if (observed.has(tag.Key)) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    observed.set(tag.Key, tag.Value);
  }
  const allowed = new Set([...Object.keys(expected), 'wharfie:state-digest']);
  for (const [key, value] of observed) {
    if (key.startsWith('wharfie:') && !allowed.has(key)) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    if (Object.hasOwn(expected, key) && expected[key] !== value) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
  }
  const observedStateDigest = observed.get('wharfie:state-digest');
  if (observedStateDigest !== undefined) {
    try {
      validateSha256Digest(
        { algorithm: 'sha256', value: observedStateDigest },
        'awsSingleNodeVolume evidence state digest tag',
      );
    } catch {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    if (
      expectedStateDigestValue !== null &&
      observedStateDigest !== expectedStateDigestValue
    ) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
  }
  const complete =
    Object.entries(expected).every(
      ([key, value]) => observed.get(key) === value,
    ) && observedStateDigest !== undefined;
  if (!complete) {
    if (allowPropagation) {
      throw new AwsSingleNodeVolumeEvidenceTransientError();
    }
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
}

/** @param {unknown} tagsValue @param {Readonly<Record<string, string>>} expected @returns {void} */
function validateCollisionTags(tagsValue, expected) {
  if (!Array.isArray(tagsValue)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (tagsValue.length > MAX_VOLUME_TAGS) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  const observed = new Map();
  for (const tag of tagsValue) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      typeof tag.Value !== 'string'
    ) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    if (observed.has(tag.Key)) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    observed.set(tag.Key, tag.Value);
    if (
      tag.Key.startsWith('wharfie:') &&
      !Object.hasOwn(expected, tag.Key) &&
      !COLLISION_RECEIPT_TAG_KEYS.has(tag.Key)
    ) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
    if (Object.hasOwn(expected, tag.Key) && expected[tag.Key] !== tag.Value) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
  }
  if (
    Object.entries(expected).some(([key, value]) => observed.get(key) !== value)
  ) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
}

/** @param {unknown} value @param {string} field @returns {number|null} */
function optionalSafeInteger(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError(
      `AWS volume ${field} is malformed.`,
    );
  }
  return value;
}

/**
 * Decode only provider identity and intrinsic retained-volume configuration.
 * Ownership tags and lifecycle propagation are deliberately excluded so a
 * mutation verifier can reject definite physical drift before considering
 * recoverable tag or lifecycle uncertainty.
 * @param {unknown} value - One DescribeVolumes item.
 * @param {unknown} regionValue - Exact factory region.
 * @returns {Readonly<{providerResourceId: string, observedDigest: Readonly<{algorithm: 'sha256', value: string}>}>} - Readable actual state.
 */
export function decodeAwsSingleNodeVolumeActualState(value, regionValue) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  const region = requiredString(
    regionValue,
    'awsSingleNodeVolume actual state region',
  );
  const providerResourceId = volumeId(value.VolumeId);
  if (
    typeof value.AvailabilityZoneId !== 'string' ||
    value.AvailabilityZoneId.length === 0 ||
    typeof value.VolumeType !== 'string' ||
    value.VolumeType.length === 0 ||
    !Number.isSafeInteger(value.Size) ||
    value.Size < 1 ||
    typeof value.MultiAttachEnabled !== 'boolean' ||
    typeof value.Encrypted !== 'boolean' ||
    typeof value.State !== 'string' ||
    !(value.CreateTime instanceof Date) ||
    !Number.isFinite(value.CreateTime.getTime())
  ) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  const iops = optionalSafeInteger(value.Iops, 'Iops');
  const throughputMiBps = optionalSafeInteger(value.Throughput, 'Throughput');
  if (
    value.VolumeType === 'gp3' &&
    (iops === null || throughputMiBps === null)
  ) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  let kmsKeyArn = null;
  if (value.KmsKeyId !== undefined && value.KmsKeyId !== null) {
    if (typeof value.KmsKeyId !== 'string' || value.KmsKeyId.length === 0) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    kmsKeyArn = value.KmsKeyId;
  } else if (value.Encrypted) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (value.SnapshotId !== undefined && value.SnapshotId !== null) {
    if (typeof value.SnapshotId !== 'string') {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    if (value.SnapshotId !== '') {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
  }
  if (value.SourceVolumeId !== undefined && value.SourceVolumeId !== null) {
    if (
      typeof value.SourceVolumeId !== 'string' ||
      !VOLUME_ID_PATTERN.test(value.SourceVolumeId)
    ) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  if (value.OutpostArn !== undefined && value.OutpostArn !== null) {
    if (typeof value.OutpostArn !== 'string' || value.OutpostArn.length === 0) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  if (value.FastRestored !== undefined) {
    if (typeof value.FastRestored !== 'boolean') {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    if (value.FastRestored) {
      throw new AwsSingleNodeVolumeEvidenceConflictError();
    }
  }
  if (
    value.VolumeInitializationRate !== undefined &&
    value.VolumeInitializationRate !== null
  ) {
    if (
      typeof value.VolumeInitializationRate !== 'number' ||
      !Number.isFinite(value.VolumeInitializationRate) ||
      value.VolumeInitializationRate < 0
    ) {
      throw new AwsSingleNodeVolumeEvidenceUnknownError();
    }
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  if (
    value.SseType !== undefined &&
    (typeof value.SseType !== 'string' || value.SseType.length === 0)
  ) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (
    (value.Encrypted &&
      (kmsKeyArn === null ||
        (value.SseType !== undefined && value.SseType !== 'sse-kms'))) ||
    (!value.Encrypted &&
      (kmsKeyArn !== null ||
        (value.SseType !== undefined && value.SseType !== 'none')))
  ) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  if (
    value.AvailabilityZone !== undefined &&
    (typeof value.AvailabilityZone !== 'string' ||
      value.AvailabilityZone.length === 0)
  ) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  if (
    value.AvailabilityZone !== undefined &&
    !new RegExp(`^${region}[a-z]$`, 'u').test(value.AvailabilityZone)
  ) {
    throw new AwsSingleNodeVolumeEvidenceConflictError();
  }
  validateOperator(value.Operator);
  let observedDigest;
  try {
    observedDigest = createAwsSingleNodeVolumeStateDigest({
      availabilityZoneId: value.AvailabilityZoneId,
      kmsKeyArn,
      volumeType: value.VolumeType,
      sizeGiB: value.Size,
      iops,
      throughputMiBps,
      multiAttach: value.MultiAttachEnabled,
      encrypted: value.Encrypted,
      onDestroy: 'retain',
    });
  } catch {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  return deepFreeze({ providerResourceId, observedDigest });
}

/**
 * Decode exact retained-volume ownership, lifecycle, and intrinsic state. The
 * returned digest is derived from provider configuration rather than from the
 * historical tag or a prospective target.
 * @param {unknown} value - One DescribeVolumes item.
 * @param {unknown} options - Exact tag and factory-region expectations.
 * @returns {Readonly<{providerResourceId: string, observedDigest: Readonly<{algorithm: 'sha256', value: string}>}>} - Verified readable evidence.
 */
export function decodeAwsSingleNodeVolumeEvidence(value, options) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeVolumeEvidenceUnknownError();
  }
  const input = exactObject(options, 'awsSingleNodeVolume evidence options');
  assertExactKeys(
    input,
    EVIDENCE_OPTION_KEYS,
    'awsSingleNodeVolume evidence options',
  );
  if (!isPlainObject(input.expectedOwnershipTags)) {
    throw new TypeError(
      'awsSingleNodeVolume evidence expectedOwnershipTags must be an object.',
    );
  }
  const expectsOwnershipReceipt = Object.hasOwn(
    input.expectedOwnershipTags,
    'wharfie:created-by-action-id',
  );
  assertExactKeys(
    input.expectedOwnershipTags,
    expectsOwnershipReceipt ? EXACT_OWNERSHIP_TAG_KEYS : EXACT_LOCATOR_TAG_KEYS,
    'awsSingleNodeVolume evidence expectedOwnershipTags',
  );
  for (const [key, tagValue] of Object.entries(input.expectedOwnershipTags)) {
    requiredString(
      tagValue,
      `awsSingleNodeVolume evidence expectedOwnershipTags.${key}`,
    );
  }
  if (
    input.expectedStateDigestValue !== null &&
    typeof input.expectedStateDigestValue !== 'string'
  ) {
    throw new TypeError(
      'awsSingleNodeVolume evidence expectedStateDigestValue must be a string or null.',
    );
  }
  if (!expectsOwnershipReceipt && input.expectedStateDigestValue !== null) {
    throw new TypeError(
      'awsSingleNodeVolume collision evidence cannot claim an expected state digest.',
    );
  }
  if (typeof input.allowTagPropagation !== 'boolean') {
    throw new TypeError(
      'awsSingleNodeVolume evidence allowTagPropagation must be a boolean.',
    );
  }
  const region = requiredString(
    input.region,
    'awsSingleNodeVolume evidence region',
  );
  if (!expectsOwnershipReceipt) {
    validateCollisionTags(value.Tags, input.expectedOwnershipTags);
  } else {
    validateTags(
      value.Tags,
      input.expectedOwnershipTags,
      input.expectedStateDigestValue,
      input.allowTagPropagation,
    );
  }
  if (value.State === 'creating') {
    throw new AwsSingleNodeVolumeEvidenceTransientError();
  }
  if (value.State !== 'available' && value.State !== 'in-use') {
    throw new AwsSingleNodeVolumeLifecycleUnknownError();
  }
  return decodeAwsSingleNodeVolumeActualState(value, region);
}

export default {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeEvidenceConflictError,
  AwsSingleNodeVolumeEvidenceTransientError,
  AwsSingleNodeVolumeEvidenceUnknownError,
  AwsSingleNodeVolumeLifecycleUnknownError,
  createAwsSingleNodeVolumeStateDigest,
  decodeAwsSingleNodeVolumeActualState,
  decodeAwsSingleNodeExactVolumeResponse,
  decodeAwsSingleNodeVolumeDiscoveryPage,
  decodeAwsSingleNodeVolumeEvidence,
  getAwsSingleNodeVolumeDiscoveryFilters,
  getAwsSingleNodeVolumeLocatorTags,
  getAwsSingleNodeVolumeOwnershipTags,
  validateAwsSingleNodeVolumeId,
};
