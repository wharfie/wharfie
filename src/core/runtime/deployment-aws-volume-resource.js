/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact controller/provider port contracts are clearer than parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import { sha256Base64Url } from './content-id.js';
import {
  validateAwsSingleNodeProviderSpec,
  validateAwsSingleNodeProviderSpecContext,
} from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  createDeploymentResourceBinding,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';

export const AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES = 16;
export const AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS = 500;
export const AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-ebs-volume-state:v1';

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'maxAttempts',
  'waitForRetry',
]);
const FACTORY_REQUIRED_KEYS = new Set(['client', 'providerScope']);
const ACTION_CONTEXT_KEYS = new Set([
  'operation',
  'plan',
  'action',
  'actionIndex',
  'ownershipNonce',
  'head',
  'profile',
  'artifactStage',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'createVolume',
  'describeVolumes',
]);
const VOLUME_CAPABILITIES = new Set(['application-state', 'control-state']);
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/;
const INSTANCE_ID_PATTERN = /^i-[0-9a-f]{8,32}$/;
const MAX_VOLUME_TAGS = 50;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'single-node-state-volume',
  'wharfie:retention': 'retain',
  'wharfie:schema-version': '1',
});

/** Exact controller authority or present provider evidence is contradictory. */
export class AwsSingleNodeVolumeResourceConflictError extends Error {
  constructor() {
    super('AWS single-node volume resource conflicts with its exact contract.');
    this.name = 'AwsSingleNodeVolumeResourceConflictError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_RESOURCE_CONFLICT';
  }
}

/** A bounded provider read or mutation could not establish safe state. */
export class AwsSingleNodeVolumeResourceUnknownError extends Error {
  constructor() {
    super('AWS single-node volume resource state is unknown.');
    this.name = 'AwsSingleNodeVolumeResourceUnknownError';
    this.code = 'AWS_SINGLE_NODE_VOLUME_RESOURCE_UNKNOWN';
  }
}

class ProviderResponseUnknownError extends Error {}
class VolumeEvidenceConflictError extends Error {}
class VolumeEvidenceTransientError extends Error {}

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

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} error @param {string} name @returns {boolean} */
function errorNamed(error, name) {
  return (
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {number} attempt @returns {Promise<void>} */
async function defaultWaitForRetry(attempt) {
  const delay = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/** @param {Readonly<Record<string, any>>} providerSpec @param {string} capabilityKind @returns {Readonly<Record<string, any>>} */
function volumeConfiguration(providerSpec, capabilityKind) {
  if (!VOLUME_CAPABILITIES.has(capabilityKind)) {
    throw new TypeError('AWS single-node volume capability is not supported.');
  }
  return capabilityKind === 'application-state'
    ? providerSpec.capabilities.applicationState
    : providerSpec.capabilities.controlState;
}

/**
 * Derive the provider-observable volume configuration digest. Attachment is a
 * later independently recoverable effect, so device and instance identity are
 * deliberately excluded from this physical-volume state.
 * @param {unknown} value - Provider specification.
 * @param {unknown} capabilityKind - Application or control state capability.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>} - Exact state digest.
 */
export function getAwsSingleNodeVolumeStateDigest(value, capabilityKind) {
  const providerSpec = validateAwsSingleNodeProviderSpec(
    value,
    'awsSingleNodeVolumeState providerSpec',
  );
  if (typeof capabilityKind !== 'string') {
    throw new TypeError(
      'awsSingleNodeVolumeState capabilityKind must be a string.',
    );
  }
  const volume = volumeConfiguration(providerSpec, capabilityKind);
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeEbsVolumeState',
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    kmsKeyArn: providerSpec.storage.ebsKmsKeyArn,
    volumeType: volume.volumeType,
    sizeGiB: volume.sizeGiB,
    iops: volume.iops,
    throughputMiBps: volume.throughputMiBps,
    multiAttach: volume.multiAttach,
    encrypted: volume.encrypted,
    onDestroy: volume.onDestroy,
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function requiredTags(authority) {
  return deepFreeze({
    ...BASE_RESERVED_TAGS,
    'wharfie:capability': authority.action.capability.kind,
    'wharfie:provider-scope-id': authority.plan.providerScope.providerScopeId,
    'wharfie:deployment-instance-id': authority.plan.deploymentInstanceId,
    'wharfie:incarnation-id': authority.plan.incarnationId,
    'wharfie:resource-key': authority.action.resourceKey,
    'wharfie:created-by-action-id':
      authority.priorBinding?.createdByActionId ?? authority.action.actionId,
    'wharfie:ownership-nonce': authority.ownershipNonce,
    'wharfie:state-digest': authority.stateDigest.value,
  });
}

/** @param {Readonly<Record<string, string>>} tags @returns {Readonly<Array<{Key: string, Value: string}>>} */
function sortedTags(tags) {
  return deepFreeze(
    Object.entries(tags)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([Key, Value]) => ({ Key, Value })),
  );
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<import('@aws-sdk/client-ec2').CreateVolumeCommandInput>} */
function createVolumeRequest(authority) {
  const configuration = authority.volumeConfiguration;
  return deepFreeze({
    AvailabilityZoneId:
      authority.plan.providerSpec.placement.availabilityZoneId,
    ClientToken: authority.action.actionId,
    Encrypted: configuration.encrypted,
    Iops: configuration.iops,
    KmsKeyId: authority.plan.providerSpec.storage.ebsKmsKeyArn,
    Size: configuration.sizeGiB,
    TagSpecifications: [
      {
        ResourceType: 'volume',
        Tags: sortedTags(requiredTags(authority)),
      },
    ],
    Throughput: configuration.throughputMiBps,
    VolumeType: configuration.volumeType,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<{Name: string, Values: string[]}>>} */
function discoveryFilters(authority) {
  const tags = requiredTags(authority);
  const locatorKeys = [
    'wharfie:managed-by',
    'wharfie:resource-kind',
    'wharfie:capability',
    'wharfie:provider-scope-id',
    'wharfie:deployment-instance-id',
    'wharfie:incarnation-id',
    'wharfie:resource-key',
  ];
  return deepFreeze(
    locatorKeys.map((key) => ({ Name: `tag:${key}`, Values: [tags[key]] })),
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, any>>} */
function validateActionContext(value, providerScope) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeVolume action context must be an object.',
    );
  }
  assertExactKeys(value, ACTION_CONTEXT_KEYS, 'awsSingleNodeVolume context');
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeVolume context.profile',
  );
  const plan = validateDeploymentPlanContext(value.plan, { profile });
  const canonicalProviderSpec = validateAwsSingleNodeProviderSpecContext(
    plan.providerSpec,
    { profile, providerScope: plan.providerScope },
  );
  const head = validateDeploymentHead(
    value.head,
    'awsSingleNodeVolume context.head',
  );
  const expectedOperationKind =
    plan.operation === 'destroy'
      ? 'destroy'
      : head.settledDeploymentRevisionId === null
        ? 'create'
        : head.settledDeploymentRevisionId ===
            plan.deploymentRevision.deploymentRevisionId
          ? 'reconcile'
          : 'update';
  if (
    value.operation !== plan.operation ||
    plan.providerScope.providerScopeId !== providerScope.providerScopeId ||
    canonicalProviderSpec.providerSpecId !== plan.providerSpec.providerSpecId ||
    head.deploymentInstanceId !== plan.deploymentInstanceId ||
    head.incarnationId !== plan.incarnationId ||
    head.providerScope.providerScopeId !== providerScope.providerScopeId ||
    head.activeOperation === null ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.kind !== expectedOperationKind ||
    plan.basis.headGeneration >= head.generation ||
    plan.basis.settledDeploymentRevisionId !==
      head.settledDeploymentRevisionId ||
    head.targetDeploymentRevisionId !==
      (expectedOperationKind === 'destroy'
        ? null
        : plan.deploymentRevision.deploymentRevisionId) ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (
        /** @type {Readonly<Record<string, any>>} */ candidate,
        /** @type {number} */ index,
      ) => candidate.actionId !== plan.actions[index].actionId,
    )
  ) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  if (
    !Number.isSafeInteger(value.actionIndex) ||
    value.actionIndex < 0 ||
    value.actionIndex >= plan.actions.length ||
    value.actionIndex !== head.activeOperation.nextActionIndex
  ) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const action = plan.actions[value.actionIndex];
  const intent = head.activeOperation.intents[value.actionIndex];
  if (
    !sameJson(value.action, action) ||
    intent?.actionId !== action.actionId ||
    intent.status !== 'intended' ||
    action.management !== 'managed' ||
    action.after?.providerType !== 'ebs-volume' ||
    !VOLUME_CAPABILITIES.has(action.capability.kind)
  ) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const ownershipNonce = validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeVolume context.ownershipNonce',
  );
  if (intent.ownershipNonce !== ownershipNonce) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const stateDigest = getAwsSingleNodeVolumeStateDigest(
    canonicalProviderSpec,
    action.capability.kind,
  );
  if (!sameJson(action.after.stateDigest, stateDigest)) {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  const configuration = volumeConfiguration(
    canonicalProviderSpec,
    action.capability.kind,
  );
  const priorBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.resourceKey === action.resourceKey,
  );
  if (action.action === 'create') {
    if (
      plan.operation !== 'apply' ||
      action.before !== null ||
      action.after.providerResourceId !== null ||
      priorBinding !== undefined
    ) {
      throw new AwsSingleNodeVolumeResourceConflictError();
    }
  } else if (action.action === 'noop') {
    if (
      priorBinding === undefined ||
      action.before === null ||
      action.before.providerType !== 'ebs-volume' ||
      action.before.providerResourceId !== priorBinding.providerResourceId ||
      action.after.providerResourceId !== priorBinding.providerResourceId ||
      !sameJson(action.before.stateDigest, stateDigest) ||
      priorBinding.management !== 'managed' ||
      priorBinding.providerType !== 'ebs-volume' ||
      priorBinding.deploymentInstanceId !== plan.deploymentInstanceId ||
      priorBinding.resourceKey !== action.resourceKey ||
      priorBinding.providerScopeId !== providerScope.providerScopeId ||
      priorBinding.incarnationId !== plan.incarnationId ||
      !sameJson(priorBinding.capability, action.capability) ||
      priorBinding.ownershipNonce !== ownershipNonce
    ) {
      throw new AwsSingleNodeVolumeResourceConflictError();
    }
  } else {
    throw new AwsSingleNodeVolumeResourceConflictError();
  }
  return deepFreeze({
    operation: plan.operation,
    plan,
    action,
    actionIndex: value.actionIndex,
    ownershipNonce,
    head,
    profile,
    providerSpec: canonicalProviderSpec,
    volumeConfiguration: configuration,
    stateDigest,
    priorBinding: priorBinding ?? null,
  });
}

/** @param {unknown} value @returns {string|null} */
function candidateVolumeId(value) {
  if (!isPlainObject(value)) return null;
  return typeof value.VolumeId === 'string' &&
    VOLUME_ID_PATTERN.test(value.VolumeId)
    ? value.VolumeId
    : null;
}

/** @param {unknown} response @param {string|null} exactVolumeId @returns {Readonly<Record<string, any>>|null} */
function oneVolumeFromResponse(response, exactVolumeId) {
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new ProviderResponseUnknownError();
  }
  if (response.NextToken !== undefined && response.NextToken !== null) {
    throw new VolumeEvidenceConflictError();
  }
  if (response.Volumes.length === 0) return null;
  if (response.Volumes.length !== 1) throw new VolumeEvidenceConflictError();
  const volume = response.Volumes[0];
  if (!isPlainObject(volume)) throw new ProviderResponseUnknownError();
  if (
    typeof volume.VolumeId !== 'string' ||
    !VOLUME_ID_PATTERN.test(volume.VolumeId)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (exactVolumeId !== null && volume.VolumeId !== exactVolumeId) {
    throw new VolumeEvidenceConflictError();
  }
  return volume;
}

/** @param {unknown} response @returns {{volumes: Readonly<Record<string, any>>[], nextToken: string|null}} */
function discoveryPage(response) {
  if (!isPlainObject(response) || !Array.isArray(response.Volumes)) {
    throw new ProviderResponseUnknownError();
  }
  let nextToken = null;
  if (response.NextToken !== undefined && response.NextToken !== null) {
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0
    ) {
      throw new ProviderResponseUnknownError();
    }
    nextToken = response.NextToken;
  }
  const volumes = [];
  for (const volume of response.Volumes) {
    if (!isPlainObject(volume)) throw new ProviderResponseUnknownError();
    if (
      typeof volume.VolumeId !== 'string' ||
      !VOLUME_ID_PATTERN.test(volume.VolumeId)
    ) {
      throw new ProviderResponseUnknownError();
    }
    volumes.push(volume);
  }
  return { volumes, nextToken };
}

/** @param {unknown} tagsValue @param {Readonly<Record<string, string>>} expected @param {boolean} allowPropagation @returns {void} */
function validateTags(tagsValue, expected, allowPropagation) {
  if (!Array.isArray(tagsValue)) {
    if (allowPropagation && (tagsValue === undefined || tagsValue === null)) {
      throw new VolumeEvidenceTransientError();
    }
    throw new ProviderResponseUnknownError();
  }
  if (tagsValue.length > MAX_VOLUME_TAGS) {
    throw new VolumeEvidenceConflictError();
  }
  const observed = new Map();
  for (const tag of tagsValue) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      typeof tag.Value !== 'string'
    ) {
      throw new ProviderResponseUnknownError();
    }
    if (observed.has(tag.Key)) {
      throw new VolumeEvidenceConflictError();
    }
    observed.set(tag.Key, tag.Value);
  }
  for (const [key, value] of observed) {
    const reserved = Object.hasOwn(expected, key);
    if (key.startsWith('wharfie:') && !reserved) {
      throw new VolumeEvidenceConflictError();
    }
    if (reserved && expected[key] !== value) {
      throw new VolumeEvidenceConflictError();
    }
  }
  const complete = Object.entries(expected).every(
    ([key, value]) => observed.get(key) === value,
  );
  if (!complete) {
    if (allowPropagation) throw new VolumeEvidenceTransientError();
    throw new VolumeEvidenceConflictError();
  }
}

/** @param {unknown} operator @returns {void} */
function validateOperator(operator) {
  if (operator === undefined || operator === null) return;
  if (!isPlainObject(operator) || typeof operator.Managed !== 'boolean') {
    throw new ProviderResponseUnknownError();
  }
  if (operator.Managed || operator.Principal !== undefined) {
    throw new VolumeEvidenceConflictError();
  }
}

/** @param {unknown} value @param {string} expectedInstanceId @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} configuration @returns {string} */
function validateAttachment(value, expectedInstanceId, volume, configuration) {
  if (!isPlainObject(value)) {
    throw new ProviderResponseUnknownError();
  }
  if (
    typeof value.State !== 'string' ||
    typeof value.VolumeId !== 'string' ||
    typeof value.InstanceId !== 'string' ||
    typeof value.Device !== 'string' ||
    typeof value.DeleteOnTermination !== 'boolean' ||
    !(value.AttachTime instanceof Date) ||
    !Number.isFinite(value.AttachTime.getTime())
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    value.VolumeId !== volume.VolumeId ||
    value.InstanceId !== expectedInstanceId ||
    value.Device !== configuration.deviceName ||
    value.DeleteOnTermination !== configuration.deleteOnTermination
  ) {
    throw new VolumeEvidenceConflictError();
  }
  return value.State;
}

/** @param {Readonly<Record<string, any>>} volume @param {Readonly<Record<string, any>>} authority @returns {'ready'|'transient'} */
function validateVolumeEvidence(volume, authority) {
  const configuration = authority.volumeConfiguration;
  const expectedTags = requiredTags(authority);
  if (
    typeof volume.AvailabilityZoneId !== 'string' ||
    typeof volume.VolumeType !== 'string' ||
    !Number.isSafeInteger(volume.Size) ||
    !Number.isSafeInteger(volume.Iops) ||
    !Number.isSafeInteger(volume.Throughput) ||
    typeof volume.MultiAttachEnabled !== 'boolean' ||
    typeof volume.Encrypted !== 'boolean' ||
    typeof volume.KmsKeyId !== 'string' ||
    typeof volume.State !== 'string' ||
    !(volume.CreateTime instanceof Date) ||
    !Number.isFinite(volume.CreateTime.getTime()) ||
    !Array.isArray(volume.Attachments)
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    volume.AvailabilityZoneId !==
      authority.providerSpec.placement.availabilityZoneId ||
    volume.VolumeType !== configuration.volumeType ||
    volume.Size !== configuration.sizeGiB ||
    volume.Iops !== configuration.iops ||
    volume.Throughput !== configuration.throughputMiBps ||
    volume.MultiAttachEnabled !== configuration.multiAttach ||
    volume.Encrypted !== configuration.encrypted ||
    volume.KmsKeyId !== authority.providerSpec.storage.ebsKmsKeyArn ||
    (volume.SnapshotId !== undefined &&
      volume.SnapshotId !== null &&
      volume.SnapshotId !== '') ||
    (volume.SourceVolumeId !== undefined && volume.SourceVolumeId !== null) ||
    (volume.OutpostArn !== undefined && volume.OutpostArn !== null) ||
    (volume.FastRestored !== undefined && volume.FastRestored !== false) ||
    (volume.VolumeInitializationRate !== undefined &&
      volume.VolumeInitializationRate !== null) ||
    (volume.SseType !== undefined && volume.SseType !== 'sse-kms')
  ) {
    throw new VolumeEvidenceConflictError();
  }
  if (
    volume.AvailabilityZone !== undefined &&
    typeof volume.AvailabilityZone !== 'string'
  ) {
    throw new ProviderResponseUnknownError();
  }
  if (
    volume.AvailabilityZone !== undefined &&
    !new RegExp(`^${authority.plan.providerScope.region}[a-z]$`, 'u').test(
      volume.AvailabilityZone,
    )
  ) {
    throw new VolumeEvidenceConflictError();
  }
  validateOperator(volume.Operator);
  validateTags(volume.Tags, expectedTags, authority.action.action === 'create');

  if (volume.State === 'creating') {
    throw new VolumeEvidenceTransientError();
  }
  if (
    volume.State === 'deleting' ||
    volume.State === 'deleted' ||
    volume.State === 'error'
  ) {
    throw new VolumeEvidenceConflictError();
  }

  const nodeBinding = authority.head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.capability.kind === 'resident-node',
  );
  if (authority.action.action === 'create') {
    if (volume.State !== 'available' || volume.Attachments.length !== 0) {
      throw new VolumeEvidenceConflictError();
    }
    return 'ready';
  }

  if (nodeBinding === undefined) {
    if (volume.State === 'available' && volume.Attachments.length === 0) {
      return 'ready';
    }
    const retiredNodeState = authority.plan.actions.find(
      (/** @type {Readonly<Record<string, any>>} */ action) =>
        action.capability.kind === 'resident-node',
    )?.before;
    if (
      authority.head.activeOperation.kind !== 'destroy' ||
      retiredNodeState?.providerType !== 'ec2-instance' ||
      typeof retiredNodeState.providerResourceId !== 'string' ||
      !INSTANCE_ID_PATTERN.test(retiredNodeState.providerResourceId) ||
      (volume.State !== 'in-use' && volume.State !== 'available') ||
      volume.Attachments.length !== 1
    ) {
      throw new VolumeEvidenceConflictError();
    }
    const attachmentState = validateAttachment(
      volume.Attachments[0],
      retiredNodeState.providerResourceId,
      volume,
      configuration,
    );
    if (
      attachmentState === 'attaching' ||
      attachmentState === 'attached' ||
      attachmentState === 'detaching' ||
      attachmentState === 'detached' ||
      attachmentState === 'busy'
    ) {
      throw new VolumeEvidenceTransientError();
    }
    throw new VolumeEvidenceConflictError();
  }

  if (
    !INSTANCE_ID_PATTERN.test(nodeBinding.providerResourceId) ||
    volume.Attachments.length !== 1
  ) {
    throw new VolumeEvidenceConflictError();
  }
  const attachmentState = validateAttachment(
    volume.Attachments[0],
    nodeBinding.providerResourceId,
    volume,
    configuration,
  );
  if (
    attachmentState === 'attaching' ||
    attachmentState === 'detaching' ||
    attachmentState === 'busy'
  ) {
    throw new VolumeEvidenceTransientError();
  }
  if (volume.State !== 'in-use' || attachmentState !== 'attached') {
    throw new VolumeEvidenceConflictError();
  }
  return 'ready';
}

/**
 * Bind exact retained gp3 volume effects to one credential scope. The factory
 * never owns or closes the caller's narrow EC2 client.
 * @param {unknown} options - Exact dependencies and retry policy.
 * @returns {Readonly<{executeAction: (context: unknown) => Promise<void>, verifySettlement: (context: unknown) => Promise<Record<string, any>>}>} - Controller action ports.
 */
export function createAwsSingleNodeVolumeResource(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsSingleNodeVolume options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'awsSingleNodeVolume options');
  assertRequiredKeys(
    options,
    FACTORY_REQUIRED_KEYS,
    'awsSingleNodeVolume options',
  );
  const client = options.client;
  if (client === null || typeof client !== 'object' || Array.isArray(client)) {
    throw new TypeError('awsSingleNodeVolume client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(`awsSingleNodeVolume client.${method} is required.`);
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'awsSingleNodeVolume providerScope',
  );
  const maxAttempts =
    options.maxAttempts ?? AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `awsSingleNodeVolume maxAttempts must be an integer from 1 through ${AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS}.`,
    );
  }
  const waitForRetry = options.waitForRetry ?? defaultWaitForRetry;
  if (typeof waitForRetry !== 'function') {
    throw new TypeError('awsSingleNodeVolume waitForRetry must be a function.');
  }
  /** Successful create responses are only ephemeral candidate locators. */
  const candidateIds = new Map();

  /** @param {number} attempt @returns {Promise<void>} */
  async function wait(attempt) {
    try {
      await waitForRetry(attempt);
    } catch {
      throw new AwsSingleNodeVolumeResourceUnknownError();
    }
  }

  /** @param {string} volumeId @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function describeExactOnce(volumeId) {
    let response;
    try {
      response = await client.describeVolumes(
        deepFreeze({ VolumeIds: [volumeId] }),
      );
    } catch (error) {
      if (errorNamed(error, 'InvalidVolume.NotFound')) return null;
      throw new ProviderResponseUnknownError();
    }
    return oneVolumeFromResponse(response, volumeId);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverOnce(authority) {
    const filters = discoveryFilters(authority);
    const volumes = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (
      let page = 1;
      page <= AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES;
      page += 1
    ) {
      let response;
      try {
        response = await client.describeVolumes(
          deepFreeze({
            Filters: filters,
            MaxResults: AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
            ...(nextToken === null ? {} : { NextToken: nextToken }),
          }),
        );
      } catch {
        throw new ProviderResponseUnknownError();
      }
      const observed = discoveryPage(response);
      for (const volume of observed.volumes) {
        if (volumes.has(volume.VolumeId)) {
          throw new VolumeEvidenceConflictError();
        }
        volumes.set(volume.VolumeId, volume);
      }
      if (observed.nextToken === null) break;
      if (
        page === AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES ||
        seenTokens.has(observed.nextToken)
      ) {
        throw new ProviderResponseUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    if (volumes.size === 0) return null;
    if (volumes.size !== 1) throw new VolumeEvidenceConflictError();
    return [...volumes.values()][0];
  }

  /** @param {unknown} value @returns {Promise<void>} */
  async function executeAction(value) {
    const authority = validateActionContext(value, providerScope);
    if (authority.action.action === 'noop') return;
    let response;
    try {
      response = await client.createVolume(createVolumeRequest(authority));
    } catch (error) {
      if (errorNamed(error, 'IdempotentParameterMismatch')) {
        throw new AwsSingleNodeVolumeResourceConflictError();
      }
      throw new AwsSingleNodeVolumeResourceUnknownError();
    }
    const volumeId = candidateVolumeId(response);
    if (volumeId === null) {
      throw new AwsSingleNodeVolumeResourceUnknownError();
    }
    const priorCandidateId = candidateIds.get(authority.action.actionId);
    if (priorCandidateId !== undefined && priorCandidateId !== volumeId) {
      throw new AwsSingleNodeVolumeResourceConflictError();
    }
    candidateIds.set(authority.action.actionId, volumeId);
  }

  /** @param {unknown} value @returns {Promise<{status: 'converged', binding: Readonly<Record<string, any>>}|{status: 'not-converged'}|{status: 'blocked'}>} */
  async function verifySettlement(value) {
    const authority = validateActionContext(value, providerScope);
    const exactVolumeId =
      authority.priorBinding?.providerResourceId ??
      candidateIds.get(authority.action.actionId) ??
      null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const volume =
          exactVolumeId === null
            ? await discoverOnce(authority)
            : await describeExactOnce(exactVolumeId);
        if (volume !== null) {
          validateVolumeEvidence(volume, authority);
          const binding =
            authority.priorBinding ??
            createDeploymentResourceBinding({
              schemaVersion: 1,
              kind: 'deploymentResourceBinding',
              deploymentInstanceId: authority.plan.deploymentInstanceId,
              incarnationId: authority.plan.incarnationId,
              resourceKey: authority.action.resourceKey,
              capability: authority.action.capability,
              management: 'managed',
              providerType: 'ebs-volume',
              providerResourceId: volume.VolumeId,
              providerScopeId: providerScope.providerScopeId,
              ownershipNonce: authority.ownershipNonce,
              createdByActionId: authority.action.actionId,
            });
          candidateIds.delete(authority.action.actionId);
          return deepFreeze({ status: 'converged', binding });
        }
      } catch (error) {
        if (error instanceof VolumeEvidenceConflictError) {
          return Object.freeze({ status: 'blocked' });
        }
        if (
          !(error instanceof ProviderResponseUnknownError) &&
          !(error instanceof VolumeEvidenceTransientError)
        ) {
          throw error;
        }
        if (attempt === maxAttempts) {
          if (error instanceof ProviderResponseUnknownError) {
            throw new AwsSingleNodeVolumeResourceUnknownError();
          }
          return Object.freeze({ status: 'not-converged' });
        }
        await wait(attempt);
        continue;
      }
      if (attempt < maxAttempts) {
        await wait(attempt);
      }
    }
    return authority.action.action === 'noop'
      ? Object.freeze({ status: 'blocked' })
      : Object.freeze({ status: 'not-converged' });
  }

  return Object.freeze({ executeAction, verifySettlement });
}

export default {
  AWS_SINGLE_NODE_VOLUME_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_DISCOVERY_MAX_RESULTS,
  AWS_SINGLE_NODE_VOLUME_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_VOLUME_MAX_DISCOVERY_PAGES,
  AWS_SINGLE_NODE_VOLUME_STATE_DIGEST_DOMAIN,
  AwsSingleNodeVolumeResourceConflictError,
  AwsSingleNodeVolumeResourceUnknownError,
  createAwsSingleNodeVolumeResource,
  getAwsSingleNodeVolumeStateDigest,
};
