/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { createCanonicalJsonSha256Id, sha256Base64Url } from './content-id.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';
import { AWS_EC2_INSTANCE_ID_PATTERN } from './deployment-aws-runtime-identity-contract.js';
import { validateProviderScope } from './deployment-provider-scope.js';

export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX = 0;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION = false;
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-attachment-state:v1';
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-attachment:v1';
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX =
  'wva1';
export const AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN =
  /^vol-[0-9a-f]{8,32}$/;

const DEVICE_NAME_PATTERN = /^\/dev\/(?:xvd|sd)[a-z](?:[1-9][0-9]*)?$/;
/** @type {Readonly<Record<string, number>>} */
const INSTANCE_STATES = Object.freeze({
  pending: 0,
  running: 16,
  'shutting-down': 32,
  terminated: 48,
  stopping: 64,
  stopped: 80,
});
const ATTACHMENT_STATES = new Set([
  'attaching',
  'attached',
  'detaching',
  'detached',
  'busy',
]);
const RESPONSE_OPTIONS_KEYS = new Set([
  'providerScope',
  'availabilityZoneId',
  'instanceId',
  'volumeId',
  'deviceName',
]);
const RECONCILE_KEYS = new Set(['action', 'instanceView', 'volumeView']);

/** Raw EC2 evidence is malformed or incomplete. */
export class AwsSingleNodeVolumeAttachmentEvidenceUnknownError extends Error {
  constructor() {
    super('AWS single-node volume attachment evidence is unknown.');
    this.name = 'AwsSingleNodeVolumeAttachmentEvidenceUnknownError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EVIDENCE_UNKNOWN';
  }
}

/** Raw EC2 evidence conclusively contradicts the exact relationship. */
export class AwsSingleNodeVolumeAttachmentEvidenceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node volume attachment evidence conflicts with its exact contract.',
    );
    this.name = 'AwsSingleNodeVolumeAttachmentEvidenceConflictError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EVIDENCE_CONFLICT';
  }
}

/** Complete EC2 views have not yet converged on one relationship state. */
export class AwsSingleNodeVolumeAttachmentEvidenceTransientError extends Error {
  constructor() {
    super('AWS single-node volume attachment evidence is transient.');
    this.name = 'AwsSingleNodeVolumeAttachmentEvidenceTransientError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EVIDENCE_TRANSIENT';
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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @returns {boolean} */
function absent(value) {
  return value === undefined || value === null;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeVolumeAttachmentInstanceId(value) {
  if (typeof value !== 'string' || !AWS_EC2_INSTANCE_ID_PATTERN.test(value)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeVolumeAttachmentVolumeId(value) {
  if (
    typeof value !== 'string' ||
    !AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN.test(value)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} value @returns {string} */
export function validateAwsSingleNodeVolumeAttachmentDeviceName(value) {
  if (typeof value !== 'string' || !DEVICE_NAME_PATTERN.test(value)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  return value;
}

/** @param {unknown} providerSpec @param {unknown} capabilityKind @returns {Readonly<Record<string, any>>} */
function attachmentStateDescriptor(providerSpec, capabilityKind) {
  const exactProviderSpec = validateAwsSingleNodeProviderSpec(
    providerSpec,
    'awsSingleNodeVolumeAttachment providerSpec',
  );
  if (typeof capabilityKind !== 'string') {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment capabilityKind must be a string.',
    );
  }
  const configuration =
    capabilityKind === 'application-state'
      ? exactProviderSpec.capabilities.applicationState
      : capabilityKind === 'control-state'
        ? exactProviderSpec.capabilities.controlState
        : null;
  if (configuration === null) {
    throw new TypeError(
      'AWS single-node volume attachment capability is not supported.',
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeEbsVolumeAttachmentState',
      capability: { kind: capabilityKind, version: 1 },
      role: { kind: 'attachment', version: 1 },
      deviceName: configuration.deviceName,
      attachmentState: 'attached',
      ebsCardIndex: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
      deleteOnTermination:
        AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
      onDestroy: 'purge',
    }),
  );
}

/** @param {Readonly<Record<string, any>>} descriptor @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function stateDigest(descriptor) {
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        sortCanonicalJsonValue(descriptor),
      )}`,
    ),
  });
}

/**
 * Derive plan-time retained attachment state without provider-allocated IDs.
 * @param {unknown} providerSpec - Exact AWS single-node provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeVolumeAttachmentStateDigest(
  providerSpec,
  capabilityKind,
) {
  const descriptor = attachmentStateDescriptor(providerSpec, capabilityKind);
  return stateDigest(descriptor);
}

/**
 * Hash the readable dual-view relationship state. Desired false/false
 * retention reproduces the plan-time digest; every other readable retention
 * projection remains a stable, unequal drift digest.
 * @param {unknown} providerSpec - Exact AWS single-node provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @param {unknown} logicalState - Reconciled attached relationship evidence.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeVolumeAttachmentObservedStateDigest(
  providerSpec,
  capabilityKind,
  logicalState,
) {
  const descriptor = attachmentStateDescriptor(providerSpec, capabilityKind);
  if (
    !isPlainObject(logicalState) ||
    !['attached', 'needs-retention'].includes(logicalState.state) ||
    ![null, true, false].includes(logicalState.instanceDeleteOnTermination) ||
    ![null, true, false].includes(logicalState.volumeDeleteOnTermination)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    logicalState.state === 'attached' &&
    logicalState.instanceDeleteOnTermination === false &&
    logicalState.volumeDeleteOnTermination === false
  ) {
    return stateDigest(descriptor);
  }
  return stateDigest({
    ...descriptor,
    deleteOnTermination: {
      instance: logicalState.instanceDeleteOnTermination,
      volume: logicalState.volumeDeleteOnTermination,
    },
  });
}

/**
 * Derive the provider-independent identity of one exact EBS relationship.
 * @param {unknown} providerSpec - Exact AWS single-node provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @param {unknown} instanceId - Exact settled substrate instance ID.
 * @param {unknown} volumeId - Exact settled retained volume ID.
 * @returns {string}
 */
export function getAwsSingleNodeVolumeAttachmentProviderResourceId(
  providerSpec,
  capabilityKind,
  instanceId,
  volumeId,
) {
  const state = attachmentStateDescriptor(providerSpec, capabilityKind);
  try {
    validateAwsSingleNodeVolumeAttachmentInstanceId(instanceId);
  } catch {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment instanceId must be a canonical EC2 instance ID.',
    );
  }
  try {
    validateAwsSingleNodeVolumeAttachmentVolumeId(volumeId);
  } catch {
    throw new TypeError(
      'awsSingleNodeVolumeAttachment volumeId must be a canonical EBS volume ID.',
    );
  }
  return createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    value: sortCanonicalJsonValue({
      ...state,
      instanceId,
      volumeId,
    }),
    valuePath: 'awsSingleNodeVolumeAttachment provider identity',
  });
}

/** @param {unknown} value @returns {string} */
function validateInstanceState(value) {
  if (
    !isPlainObject(value) ||
    typeof value.Name !== 'string' ||
    !Number.isSafeInteger(value.Code) ||
    value.Code < 0
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    !Object.hasOwn(INSTANCE_STATES, value.Name) ||
    (value.Code & 0xff) !== INSTANCE_STATES[value.Name]
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  return value.Name;
}

/** @param {unknown} value @param {string} expectedVolumeId @returns {Readonly<Record<string, any>>} */
function decodeInstanceMapping(value, expectedVolumeId) {
  if (
    !isPlainObject(value) ||
    typeof value.DeviceName !== 'string' ||
    !DEVICE_NAME_PATTERN.test(value.DeviceName) ||
    !isPlainObject(value.Ebs) ||
    typeof value.Ebs.VolumeId !== 'string' ||
    !AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN.test(
      value.Ebs.VolumeId,
    ) ||
    typeof value.Ebs.Status !== 'string'
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (!ATTACHMENT_STATES.has(value.Ebs.Status)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    !absent(value.Ebs.AssociatedResource) ||
    !absent(value.Ebs.VolumeOwnerId) ||
    (value.Ebs.EbsCardIndex !== undefined &&
      value.Ebs.EbsCardIndex !==
        AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    value.Ebs.DeleteOnTermination !== undefined &&
    typeof value.Ebs.DeleteOnTermination !== 'boolean'
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (value.Ebs.Operator !== undefined && value.Ebs.Operator !== null) {
    if (
      !isPlainObject(value.Ebs.Operator) ||
      typeof value.Ebs.Operator.Managed !== 'boolean'
    ) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
    }
    if (value.Ebs.Operator.Managed || !absent(value.Ebs.Operator.Principal)) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
    }
  }
  return deepFreeze({
    deviceName: value.DeviceName,
    volumeId: value.Ebs.VolumeId,
    state: value.Ebs.Status,
    deleteOnTermination: value.Ebs.DeleteOnTermination ?? null,
    ebsCardIndex:
      value.Ebs.EbsCardIndex ??
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
    intendedVolume: value.Ebs.VolumeId === expectedVolumeId,
  });
}

/** @param {unknown} options @returns {Readonly<Record<string, any>>} */
function validateResponseOptions(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentEvidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    RESPONSE_OPTIONS_KEYS,
    'awsSingleNodeVolumeAttachmentEvidence options',
  );
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVolumeAttachmentEvidence providerScope',
  );
  if (
    typeof options.availabilityZoneId !== 'string' ||
    options.availabilityZoneId.length === 0
  ) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentEvidence availabilityZoneId must be a non-empty string.',
    );
  }
  try {
    validateAwsSingleNodeVolumeAttachmentInstanceId(options.instanceId);
    validateAwsSingleNodeVolumeAttachmentVolumeId(options.volumeId);
    validateAwsSingleNodeVolumeAttachmentDeviceName(options.deviceName);
  } catch {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentEvidence exact endpoint options are invalid.',
    );
  }
  return deepFreeze({
    providerScope,
    availabilityZoneId: options.availabilityZoneId,
    instanceId: options.instanceId,
    volumeId: options.volumeId,
    deviceName: options.deviceName,
  });
}

/**
 * Decode one exact DescribeInstances projection of the relationship.
 * Successful empty arrays are structurally inconclusive, never absence.
 * @param {unknown} response - Raw exact DescribeInstances response.
 * @param {unknown} options - Exact scope, endpoints, zone, and device.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
  response,
  options,
) {
  const exact = validateResponseOptions(options);
  if (!isPlainObject(response) || !Array.isArray(response.Reservations)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (!absent(response.NextToken)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (response.Reservations.length === 0) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (response.Reservations.length !== 1) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  const reservation = response.Reservations[0];
  if (
    !isPlainObject(reservation) ||
    typeof reservation.OwnerId !== 'string' ||
    !Array.isArray(reservation.Instances)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (reservation.OwnerId !== exact.providerScope.accountId) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (reservation.Instances.length === 0) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    reservation.Instances.length !== 1 ||
    !isPlainObject(reservation.Instances[0])
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  const instance = reservation.Instances[0];
  if (
    typeof instance.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(instance.InstanceId) ||
    !isPlainObject(instance.Placement) ||
    typeof instance.Placement.AvailabilityZoneId !== 'string' ||
    !Array.isArray(instance.BlockDeviceMappings)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    instance.InstanceId !== exact.instanceId ||
    instance.Placement.AvailabilityZoneId !== exact.availabilityZoneId
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  const state = validateInstanceState(instance.State);
  const deviceNames = new Set();
  const volumeIds = new Set();
  let intended = null;
  for (const candidate of instance.BlockDeviceMappings) {
    const mapping = decodeInstanceMapping(candidate, exact.volumeId);
    if (
      deviceNames.has(mapping.deviceName) ||
      volumeIds.has(mapping.volumeId)
    ) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
    }
    deviceNames.add(mapping.deviceName);
    volumeIds.add(mapping.volumeId);
    if (mapping.deviceName === exact.deviceName || mapping.intendedVolume) {
      if (
        mapping.deviceName !== exact.deviceName ||
        !mapping.intendedVolume ||
        intended !== null
      ) {
        throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
      }
      intended = mapping;
    }
  }
  return deepFreeze({ state, attachment: intended });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} exact @returns {Readonly<Record<string, any>>} */
function decodeVolumeAttachment(value, exact) {
  if (
    !isPlainObject(value) ||
    typeof value.VolumeId !== 'string' ||
    !AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN.test(value.VolumeId) ||
    typeof value.InstanceId !== 'string' ||
    !AWS_EC2_INSTANCE_ID_PATTERN.test(value.InstanceId) ||
    typeof value.Device !== 'string' ||
    !DEVICE_NAME_PATTERN.test(value.Device) ||
    typeof value.State !== 'string'
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (!ATTACHMENT_STATES.has(value.State)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    value.VolumeId !== exact.volumeId ||
    value.InstanceId !== exact.instanceId ||
    value.Device !== exact.deviceName ||
    !absent(value.AssociatedResource) ||
    !absent(value.InstanceOwningService) ||
    (value.EbsCardIndex !== undefined &&
      value.EbsCardIndex !== AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    value.DeleteOnTermination !== undefined &&
    typeof value.DeleteOnTermination !== 'boolean'
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  return deepFreeze({
    state: value.State,
    deleteOnTermination: value.DeleteOnTermination ?? null,
    ebsCardIndex:
      value.EbsCardIndex ?? AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  });
}

/**
 * Decode one exact DescribeVolumes projection of the relationship.
 * Successful empty arrays are structurally inconclusive, never absence.
 * @param {unknown} response - Raw exact DescribeVolumes response.
 * @param {unknown} options - Exact scope, endpoints, zone, and device.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
  response,
  options,
) {
  const exact = validateResponseOptions(options);
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (!absent(response.NextToken)) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (response.Volumes.length === 0) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (response.Volumes.length !== 1 || !isPlainObject(response.Volumes[0])) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  const volume = response.Volumes[0];
  if (
    typeof volume.VolumeId !== 'string' ||
    !AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN.test(
      volume.VolumeId,
    ) ||
    typeof volume.AvailabilityZoneId !== 'string' ||
    typeof volume.State !== 'string' ||
    typeof volume.MultiAttachEnabled !== 'boolean' ||
    !Array.isArray(volume.Attachments)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    volume.VolumeId !== exact.volumeId ||
    volume.AvailabilityZoneId !== exact.availabilityZoneId ||
    volume.MultiAttachEnabled !== false
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    volume.Operator !== undefined &&
    volume.Operator !== null &&
    (!isPlainObject(volume.Operator) ||
      volume.Operator.Managed !== false ||
      !absent(volume.Operator.Principal))
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    ![
      'creating',
      'available',
      'in-use',
      'deleting',
      'deleted',
      'error',
    ].includes(volume.State)
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (volume.Attachments.length > 1) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  const attachment =
    volume.Attachments.length === 0
      ? null
      : decodeVolumeAttachment(volume.Attachments[0], exact);
  return deepFreeze({ state: volume.State, attachment });
}

/**
 * Reconcile exact instance and volume projections into one relationship state.
 * Typed endpoint absence is only meaningful while executing delete.
 * @param {unknown} value - Decoded views and exact action intent.
 * @returns {Readonly<Record<string, any>>}
 */
export function reconcileAwsSingleNodeVolumeAttachmentViews(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentEvidence reconcile value must be an object.',
    );
  }
  assertExactKeys(
    value,
    RECONCILE_KEYS,
    'awsSingleNodeVolumeAttachmentEvidence reconcile value',
  );
  if (!['create', 'noop', 'delete'].includes(value.action)) {
    throw new TypeError(
      'awsSingleNodeVolumeAttachmentEvidence reconcile action is invalid.',
    );
  }
  const instanceView = value.instanceView;
  const volumeView = value.volumeView;
  if (instanceView === null || volumeView === null) {
    const remainingAttachment =
      instanceView?.attachment ?? volumeView?.attachment ?? null;
    if (value.action !== 'delete') {
      throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
    }
    if (remainingAttachment !== null) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
    }
    return deepFreeze({
      state: 'endpoint-absent',
      signature:
        instanceView === null && volumeView === null
          ? 'instance-and-volume'
          : instanceView === null
            ? 'instance'
            : 'volume',
    });
  }
  if (value.action !== 'delete') {
    if (instanceView.state === 'pending' || instanceView.state === 'stopping') {
      throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
    }
    if (
      instanceView.state === 'shutting-down' ||
      instanceView.state === 'terminated'
    ) {
      throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
    }
    if (volumeView.state === 'deleting' || volumeView.state === 'deleted') {
      throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
    }
  }
  if (volumeView.state === 'error') {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  const instanceAttachment = instanceView.attachment;
  const volumeAttachment = volumeView.attachment;
  if (instanceAttachment === null && volumeAttachment === null) {
    if (volumeView.state === 'creating' || volumeView.state === 'in-use') {
      throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
    }
    if (volumeView.state !== 'available') {
      if (
        value.action === 'delete' &&
        (volumeView.state === 'deleting' || volumeView.state === 'deleted')
      ) {
        return deepFreeze({ state: 'absent' });
      }
      throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
    }
    return deepFreeze({ state: 'absent', instanceState: instanceView.state });
  }
  if (instanceAttachment === null || volumeAttachment === null) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
  }
  if (
    instanceAttachment.ebsCardIndex !==
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX ||
    volumeAttachment.ebsCardIndex !==
      AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    instanceAttachment.state === 'busy' ||
    volumeAttachment.state === 'busy'
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
  }
  if (
    instanceAttachment.state !== 'attached' ||
    volumeAttachment.state !== 'attached' ||
    volumeView.state !== 'in-use' ||
    instanceView.state === 'pending' ||
    instanceView.state === 'stopping' ||
    instanceView.state === 'shutting-down'
  ) {
    throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
  }
  if (instanceView.state === 'terminated') {
    throw new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
  }
  return deepFreeze({
    state:
      instanceAttachment.deleteOnTermination === false &&
      volumeAttachment.deleteOnTermination === false
        ? 'attached'
        : 'needs-retention',
    instanceState: instanceView.state,
    instanceDeleteOnTermination: instanceAttachment.deleteOnTermination,
    volumeDeleteOnTermination: volumeAttachment.deleteOnTermination,
  });
}

/** @param {unknown[]} errors @returns {Error|null} */
export function getAwsSingleNodeVolumeAttachmentStrongestEvidenceError(errors) {
  if (!Array.isArray(errors)) {
    return new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof AwsSingleNodeVolumeAttachmentEvidenceConflictError,
    )
  ) {
    return new AwsSingleNodeVolumeAttachmentEvidenceConflictError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof AwsSingleNodeVolumeAttachmentEvidenceUnknownError,
    )
  ) {
    return new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
  }
  if (
    errors.some(
      (error) =>
        error instanceof AwsSingleNodeVolumeAttachmentEvidenceTransientError,
    )
  ) {
    return new AwsSingleNodeVolumeAttachmentEvidenceTransientError();
  }
  return errors.length === 0
    ? null
    : new AwsSingleNodeVolumeAttachmentEvidenceUnknownError();
}

export default {
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_DELETE_ON_TERMINATION,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_EBS_CARD_INDEX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_STATE_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_VOLUME_ATTACHMENT_VOLUME_ID_PATTERN,
  AwsSingleNodeVolumeAttachmentEvidenceConflictError,
  AwsSingleNodeVolumeAttachmentEvidenceTransientError,
  AwsSingleNodeVolumeAttachmentEvidenceUnknownError,
  decodeAwsSingleNodeVolumeAttachmentInstanceResponse,
  decodeAwsSingleNodeVolumeAttachmentVolumeResponse,
  getAwsSingleNodeVolumeAttachmentObservedStateDigest,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
  getAwsSingleNodeVolumeAttachmentStrongestEvidenceError,
  reconcileAwsSingleNodeVolumeAttachmentViews,
  validateAwsSingleNodeVolumeAttachmentDeviceName,
  validateAwsSingleNodeVolumeAttachmentInstanceId,
  validateAwsSingleNodeVolumeAttachmentVolumeId,
};
