/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This boundary deliberately keeps one compact immutable evidence schema beside its strict decoders. */

import { validateSha256Digest } from './application-revision.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import {
  getAwsSingleNodeRetainedStorageProviderExperimentTags,
  validateAwsSingleNodeRetainedStorageProviderExperiment,
  validateAwsSingleNodeRetainedStorageProviderExperimentWindow,
} from './deployment-aws-host-retained-storage-provider-experiment.js';
import {
  AwsSingleNodeMachineImageEvidenceConflictError,
  AwsSingleNodeMachineImageEvidenceTransientError,
  AwsSingleNodeMachineImageEvidenceUnknownError,
  decodeAwsSingleNodeExactMachineImageParameterResponse,
  decodeAwsSingleNodeExactMachineImageResponse,
} from './deployment-aws-machine-image-evidence.js';
import {
  AwsSingleNodeNodeEvidenceConflictError,
  AwsSingleNodeNodeEvidenceTransientError,
  AwsSingleNodeNodeEvidenceUnknownError,
  decodeAwsSingleNodeNodeExactInstanceResponse,
  decodeAwsSingleNodeNodeExactRootVolumeResponse,
  decodeAwsSingleNodeNodeLifecycle,
  decodeAwsSingleNodeNodeRootVolumeState,
  decodeAwsSingleNodeNodeTerminalRootVolumeId,
} from './deployment-aws-node-evidence.js';
import { validateAwsSingleNodeProviderSpec } from './deployment-aws-provider-spec.js';
import {
  AwsSingleNodeVolumeAttachmentEvidenceConflictError,
  AwsSingleNodeVolumeAttachmentEvidenceTransientError,
  AwsSingleNodeVolumeAttachmentEvidenceUnknownError,
  decodeAwsSingleNodeVolumeAttachmentInstanceResponse,
  decodeAwsSingleNodeVolumeAttachmentVolumeResponse,
  getAwsSingleNodeVolumeAttachmentObservedStateDigest,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  reconcileAwsSingleNodeVolumeAttachmentViews,
  validateAwsSingleNodeVolumeAttachmentInstanceId,
  validateAwsSingleNodeVolumeAttachmentVolumeId,
} from './deployment-aws-volume-attachment-evidence.js';
import {
  AwsSingleNodeVolumeEvidenceConflictError,
  AwsSingleNodeVolumeEvidenceTransientError,
  AwsSingleNodeVolumeEvidenceUnknownError,
  createAwsSingleNodeVolumeStateDigest,
  decodeAwsSingleNodeExactVolumeResponse,
  decodeAwsSingleNodeVolumeActualState,
} from './deployment-aws-volume-evidence.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_KIND =
  'awsSingleNodeRetainedStorageProviderEvidence';
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_DOMAIN =
  'wharfie:aws-single-node:retained-storage-provider-evidence:v1';
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_PREFIX =
  'wpe1';
export const AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_MAX_BYTES =
  256 * 1024;

const CLASSIFICATION = 'read-only-provider-no-host';
const PURPOSE = 'retained-storage-provider-qualification';
const MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024;
const MAX_PROVIDER_RESPONSE_DEPTH = 64;
const LIMITATIONS = Object.freeze([
  'AWS reads are not an atomic snapshot; this receipt records two identical normalized observations.',
  'This receipt does not authorize AWS calls, resource creation, deletion, attachment changes, or formatting.',
  'Provider evidence does not prove Linux device identity, blank media, filesystem state, or host tool behavior.',
  'Provider identity and experiment tags do not prove current controller authority or a local host fence.',
  'The experiment source commit is caller-asserted; this receipt does not attest the running collector or deployed bytes.',
  'The disposable evidence volume is tagged for purge while its physical profile is compared with the selected retained application/control capability.',
  'The injected read clients are assumed to use the recorded provider scope; this receipt does not independently attest their credentials.',
]);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'classification',
  'authority',
  'experiment',
  'providerScope',
  'providerSpec',
  'tagContract',
  'observation',
  'conclusion',
  'limitations',
]);
const DOCUMENT_KEYS = new Set(['evidenceId', ...PAYLOAD_KEYS]);
const FACTORY_KEYS = new Set(['providerScope', 'clients', 'now']);
const CLIENT_KEYS = new Set(['ssm', 'ec2']);
const SSM_CLIENT_KEYS = new Set(['getParameter']);
const EC2_CLIENT_KEYS = new Set([
  'describeImages',
  'describeInstances',
  'describeVolumes',
]);
const COLLECT_KEYS = new Set([
  'experiment',
  'providerSpec',
  'instanceId',
  'volumeId',
]);
const TAG_CONTRACT_KEYS = new Set(['instance', 'rootVolume', 'evidenceVolume']);
const OBSERVATION_KEYS = new Set([
  'machineImage',
  'instance',
  'rootVolume',
  'evidenceVolume',
  'attachment',
  'exclusion',
]);
const INSTANCE_KEYS = new Set([
  'instanceId',
  'lifecycle',
  'imageId',
  'architecture',
  'instanceType',
  'availabilityZoneId',
  'rootDeviceName',
  'rootDeviceType',
  'rootVolumeId',
  'evidenceDeviceName',
  'evidenceVolumeId',
]);
const ROOT_VOLUME_KEYS = new Set(['providerResourceId', 'lifecycle', 'state']);
const EVIDENCE_VOLUME_KEYS = new Set([
  'providerResourceId',
  'resourceKey',
  'deviceName',
  'lifecycle',
  'createTime',
  'profile',
  'origin',
  'observedDigest',
]);
const ORIGIN_KEYS = new Set([
  'snapshotId',
  'sourceVolumeId',
  'outpostArn',
  'fastRestored',
  'volumeInitializationRate',
]);
const ATTACHMENT_KEYS = new Set([
  'providerResourceId',
  'state',
  'instanceState',
  'instanceDeleteOnTermination',
  'volumeDeleteOnTermination',
  'observedDigest',
]);
const EXCLUSION_KEYS = new Set([
  'rootVolumeId',
  'evidenceVolumeId',
  'rootDeviceName',
  'evidenceDeviceName',
  'distinctVolume',
  'distinctDevice',
]);
const CONCLUSION_KEYS = new Set([
  'authoritative',
  'observations',
  'stable',
  'machineImagePinned',
  'instanceStorageProjectionMatchesProviderSpec',
  'experimentTagsVerified',
  'rootVolumeExcluded',
  'evidenceVolumeMatchesProviderSpec',
  'attachmentViewsAgree',
]);

/** Present provider evidence contradicts the exact experiment contract. */
export class AwsSingleNodeRetainedStorageProviderEvidenceConflictError extends Error {
  constructor() {
    super(
      'AWS retained-storage provider evidence conflicts with its exact experiment contract.',
    );
    this.name = 'AwsSingleNodeRetainedStorageProviderEvidenceConflictError';
    this.code = 'AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_CONFLICT';
  }
}

/** Provider evidence may still be converging toward the exact contract. */
export class AwsSingleNodeRetainedStorageProviderEvidenceTransientError extends Error {
  constructor() {
    super('AWS retained-storage provider evidence is transient.');
    this.name = 'AwsSingleNodeRetainedStorageProviderEvidenceTransientError';
    this.code = 'AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_TRANSIENT';
  }
}

/** Provider access or malformed evidence could not establish a safe result. */
export class AwsSingleNodeRetainedStorageProviderEvidenceUnknownError extends Error {
  constructor() {
    super('AWS retained-storage provider evidence is unknown.');
    this.name = 'AwsSingleNodeRetainedStorageProviderEvidenceUnknownError';
    this.code = 'AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_UNKNOWN';
  }
}

/** Two complete normalized provider observations did not agree. */
export class AwsSingleNodeRetainedStorageProviderEvidenceUnstableError extends Error {
  constructor() {
    super('AWS retained-storage provider evidence changed during collection.');
    this.name = 'AwsSingleNodeRetainedStorageProviderEvidenceUnstableError';
    this.code = 'AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_UNSTABLE';
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

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function exactObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${path} must contain only its exact required keys.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} path @returns {any} */
function ownData(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${path}.${key} must be an own data property.`);
  }
  return descriptor.value;
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
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} value @returns {number} */
function validateNow(value) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
  return /** @type {number} */ (value);
}

/**
 * Capture one exact, own, enumerable data-method surface with its receiver.
 * @param {unknown} value - Narrow client facade.
 * @param {Set<string>} keys - Exact permitted methods.
 * @param {string} path - Boundary path.
 * @returns {Readonly<Record<string, (...args: any[]) => any>>}
 */
function captureClient(value, keys, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  assertExactKeys(value, keys, path);
  /** @type {Record<string, (...args: any[]) => any>} */
  const captured = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`${path}.${key} must be an own data function.`);
    }
    captured[key] = descriptor.value.bind(value);
  }
  return Object.freeze(captured);
}

/** @param {{used: number}} budget @param {number} bytes @returns {void} */
function consumeProviderResponseBytes(budget, bytes) {
  budget.used += bytes;
  if (budget.used > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
}

/**
 * Snapshot one bounded provider value without invoking accessors. Dates are
 * preserved because the AWS SDK uses them for observation timestamps.
 * @param {unknown} value - Candidate provider response value.
 * @param {{used: number}} budget - Shared encoded-size budget.
 * @param {WeakSet<object>} ancestors - Active traversal path.
 * @param {number} depth - Current object depth.
 * @returns {any}
 */
function snapshotProviderValue(value, budget, ancestors, depth) {
  if (depth > MAX_PROVIDER_RESPONSE_DEPTH) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
  if (value === null || value === undefined) {
    consumeProviderResponseBytes(budget, 4);
    return value;
  }
  if (typeof value === 'string') {
    consumeProviderResponseBytes(budget, Buffer.byteLength(value, 'utf8') + 2);
    return value;
  }
  if (typeof value === 'boolean') {
    consumeProviderResponseBytes(budget, value ? 4 : 5);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
    }
    consumeProviderResponseBytes(budget, 16);
    return value;
  }
  if (typeof value !== 'object') {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }

  const objectValue = /** @type {object} */ (value);
  if (ancestors.has(objectValue)) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
  ancestors.add(objectValue);
  try {
    if (value instanceof Date) {
      if (
        Object.getPrototypeOf(value) !== Date.prototype ||
        Reflect.ownKeys(value).length !== 0
      ) {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
      }
      const milliseconds = Date.prototype.getTime.call(value);
      if (!Number.isFinite(milliseconds)) {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
      }
      consumeProviderResponseBytes(budget, 24);
      return Object.freeze(new Date(milliseconds));
    }

    if (Array.isArray(value)) {
      if (
        Object.getPrototypeOf(value) !== Array.prototype ||
        value.length > MAX_PROVIDER_RESPONSE_BYTES
      ) {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
      }
      const ownKeys = Reflect.ownKeys(value);
      const expectedKeyCount = value.length + 1;
      if (
        ownKeys.length !== expectedKeyCount ||
        ownKeys.some(
          (key) =>
            typeof key !== 'string' ||
            (key !== 'length' &&
              (!/^(?:0|[1-9][0-9]*)$/u.test(key) ||
                Number(key) >= value.length)),
        )
      ) {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
      }
      consumeProviderResponseBytes(budget, 2);
      const clone = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
          throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
        }
        clone[index] = snapshotProviderValue(
          descriptor.value,
          budget,
          ancestors,
          depth + 1,
        );
      }
      return Object.freeze(clone);
    }

    if (!isPlainObject(value)) {
      throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
    }
    const clone = {};
    consumeProviderResponseBytes(budget, 2);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
      }
      consumeProviderResponseBytes(budget, Buffer.byteLength(key, 'utf8') + 3);
      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: snapshotProviderValue(
          descriptor.value,
          budget,
          ancestors,
          depth + 1,
        ),
        writable: true,
      });
    }
    return Object.freeze(clone);
  } finally {
    ancestors.delete(objectValue);
  }
}

/** @param {unknown} value @returns {any} */
function snapshotProviderResponse(value) {
  return snapshotProviderValue(value, { used: 0 }, new WeakSet(), 0);
}

/** @param {unknown} error @returns {never} */
function throwEvidenceError(error) {
  if (
    error instanceof
      AwsSingleNodeRetainedStorageProviderEvidenceConflictError ||
    error instanceof AwsSingleNodeMachineImageEvidenceConflictError ||
    error instanceof AwsSingleNodeNodeEvidenceConflictError ||
    error instanceof AwsSingleNodeVolumeEvidenceConflictError ||
    error instanceof AwsSingleNodeVolumeAttachmentEvidenceConflictError
  ) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }
  if (
    error instanceof
      AwsSingleNodeRetainedStorageProviderEvidenceTransientError ||
    error instanceof AwsSingleNodeMachineImageEvidenceTransientError ||
    error instanceof AwsSingleNodeNodeEvidenceTransientError ||
    error instanceof AwsSingleNodeVolumeEvidenceTransientError ||
    error instanceof AwsSingleNodeVolumeAttachmentEvidenceTransientError
  ) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceTransientError();
  }
  if (
    error instanceof AwsSingleNodeMachineImageEvidenceUnknownError ||
    error instanceof AwsSingleNodeNodeEvidenceUnknownError ||
    error instanceof AwsSingleNodeVolumeEvidenceUnknownError ||
    error instanceof AwsSingleNodeVolumeAttachmentEvidenceUnknownError
  ) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
  throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
}

/** @template T @param {() => T} operation @returns {T} */
function decodeEvidence(operation) {
  try {
    return operation();
  } catch (error) {
    throwEvidenceError(error);
  }
}

/** @template T @param {() => T|Promise<T>} operation @returns {Promise<T>} */
async function readProvider(operation) {
  try {
    return snapshotProviderResponse(await operation());
  } catch {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
}

/** @param {unknown} value @param {Readonly<Record<string, string>>} expected @returns {void} */
function validateExactTags(value, expected) {
  if (!Array.isArray(value) || value.length !== Object.keys(expected).length) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }
  const observed = new Map();
  for (const tag of value) {
    if (
      !isPlainObject(tag) ||
      Reflect.ownKeys(tag).length !== 2 ||
      !Object.hasOwn(tag, 'Key') ||
      !Object.hasOwn(tag, 'Value') ||
      typeof tag.Key !== 'string' ||
      typeof tag.Value !== 'string' ||
      observed.has(tag.Key)
    ) {
      throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
    }
    observed.set(tag.Key, tag.Value);
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (observed.get(key) !== expectedValue) {
      throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
    }
  }
}

/** @param {Readonly<Record<string, any>>} providerSpec @param {string} resourceKey @returns {Readonly<Record<string, any>>} */
function expectedEvidenceVolumeProfile(providerSpec, resourceKey) {
  const capability =
    resourceKey === 'application-state'
      ? providerSpec.capabilities.applicationState
      : resourceKey === 'control-state'
        ? providerSpec.capabilities.controlState
        : null;
  if (capability === null) {
    throw new TypeError(
      'AWS retained-storage provider evidence volume role is invalid.',
    );
  }
  return deepFreeze({
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    kmsKeyArn: providerSpec.storage.ebsKmsKeyArn,
    volumeType: capability.volumeType,
    sizeGiB: capability.sizeGiB,
    iops: capability.iops,
    throughputMiBps: capability.throughputMiBps,
    multiAttach: capability.multiAttach,
    encrypted: capability.encrypted,
    onDestroy: capability.onDestroy,
  });
}

/** @param {Readonly<Record<string, any>>} providerSpec @returns {Readonly<Record<string, any>>} */
function expectedRootVolumeState(providerSpec) {
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
    attachment: {
      device: root.deviceName,
      deleteOnTermination: root.deleteOnTermination,
      ebsCardIndex: 0,
    },
  });
}

/** @param {Readonly<Record<string, any>>} context @returns {Promise<Readonly<Record<string, any>>>} */
async function readObservation(context) {
  const {
    ec2,
    experiment,
    instanceId,
    now,
    providerScope,
    providerSpec,
    ssm,
    tagContract,
    volumeId,
  } = context;
  const sourceParameter = providerSpec.machineImage.sourceParameter;
  const parameterResponse = await readProvider(() =>
    ssm.getParameter(
      deepFreeze({
        Name: `${sourceParameter.name}:${sourceParameter.version}`,
        WithDecryption: false,
      }),
    ),
  );
  const selection = decodeEvidence(() =>
    decodeAwsSingleNodeExactMachineImageParameterResponse(
      parameterResponse,
      providerScope,
      sourceParameter.name,
      sourceParameter.version,
    ),
  );
  if (
    !sameJson(selection, {
      name: sourceParameter.name,
      version: sourceParameter.version,
      imageId: providerSpec.machineImage.imageId,
    })
  ) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }

  const imageResponse = await readProvider(() =>
    ec2.describeImages(
      deepFreeze({
        ImageIds: [providerSpec.machineImage.imageId],
        Owners: ['amazon'],
        IncludeDeprecated: true,
        IncludeDisabled: true,
      }),
    ),
  );
  const machineImage = decodeEvidence(() =>
    decodeAwsSingleNodeExactMachineImageResponse(
      imageResponse,
      selection,
      providerSpec.machineImage.architecture,
      now,
    ),
  );
  if (!sameJson(machineImage, providerSpec.machineImage)) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }

  const instanceResponse = await readProvider(() =>
    ec2.describeInstances(deepFreeze({ InstanceIds: [instanceId] })),
  );
  const instance = decodeEvidence(() =>
    decodeAwsSingleNodeNodeExactInstanceResponse(
      instanceResponse,
      instanceId,
      providerScope,
    ),
  );
  decodeEvidence(() => validateExactTags(instance.Tags, tagContract.instance));
  const lifecycle = decodeEvidence(() =>
    decodeAwsSingleNodeNodeLifecycle(instance.State),
  );
  if (lifecycle !== 'running') {
    if (
      lifecycle === 'pending' ||
      lifecycle === 'stopping' ||
      lifecycle === 'stopped'
    ) {
      throw new AwsSingleNodeRetainedStorageProviderEvidenceTransientError();
    }
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }
  if (
    !isPlainObject(instance.Placement) ||
    instance.ImageId !== providerSpec.machineImage.imageId ||
    instance.Architecture !== providerSpec.machineImage.architecture ||
    instance.InstanceType !== providerSpec.node.instanceType ||
    instance.EbsOptimized !== providerSpec.node.ebsOptimized ||
    instance.EnaSupport !== providerSpec.machineImage.enaSupport ||
    instance.VirtualizationType !==
      providerSpec.machineImage.virtualizationType ||
    instance.RootDeviceName !== providerSpec.node.rootVolume.deviceName ||
    instance.RootDeviceType !== providerSpec.machineImage.rootDeviceType ||
    instance.Placement.AvailabilityZoneId !==
      providerSpec.placement.availabilityZoneId ||
    instance.Placement.Tenancy !== providerSpec.node.tenancy ||
    !Array.isArray(instance.BlockDeviceMappings) ||
    instance.BlockDeviceMappings.length !== 2
  ) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }

  const rootVolumeId = decodeEvidence(() =>
    decodeAwsSingleNodeNodeTerminalRootVolumeId(
      instance.BlockDeviceMappings,
      providerSpec.node.rootVolume.deviceName,
    ),
  );
  if (rootVolumeId === null || rootVolumeId === volumeId) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }

  const resourceKey = experiment.volumeRole;
  const capability =
    resourceKey === 'application-state'
      ? providerSpec.capabilities.applicationState
      : providerSpec.capabilities.controlState;
  if (capability.deviceName === providerSpec.node.rootVolume.deviceName) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }
  const attachmentOptions = deepFreeze({
    providerScope,
    availabilityZoneId: providerSpec.placement.availabilityZoneId,
    instanceId,
    volumeId,
    deviceName: capability.deviceName,
  });
  const instanceView = decodeEvidence(() =>
    decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      instanceResponse,
      attachmentOptions,
    ),
  );

  const volumeResponse = await readProvider(() =>
    ec2.describeVolumes(deepFreeze({ VolumeIds: [volumeId] })),
  );
  const volume = decodeEvidence(() =>
    decodeAwsSingleNodeExactVolumeResponse(volumeResponse, volumeId),
  );
  if (volume === null) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
  }
  const volumeMetadata = decodeEvidence(() => {
    validateExactTags(volume.Tags, tagContract.evidenceVolume);
    if (volume.State !== 'in-use') {
      if (volume.State === 'creating' || volume.State === 'available') {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceTransientError();
      }
      throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
    }
    if (!(volume.CreateTime instanceof Date)) {
      throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
    }
    return deepFreeze({
      lifecycle: volume.State,
      createTime: volume.CreateTime.toISOString(),
    });
  });
  const volumeEvidence = decodeEvidence(() =>
    decodeAwsSingleNodeVolumeActualState(volume, providerScope.region),
  );
  const volumeProfile = expectedEvidenceVolumeProfile(
    providerSpec,
    resourceKey,
  );
  const expectedVolumeDigest = decodeEvidence(() =>
    createAwsSingleNodeVolumeStateDigest(volumeProfile),
  );
  if (
    volumeEvidence.providerResourceId !== volumeId ||
    !sameJson(volumeEvidence.observedDigest, expectedVolumeDigest)
  ) {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }
  const volumeView = decodeEvidence(() =>
    decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      volumeResponse,
      attachmentOptions,
    ),
  );
  const attachmentState = decodeEvidence(() =>
    reconcileAwsSingleNodeVolumeAttachmentViews({
      action: 'noop',
      instanceView,
      volumeView,
    }),
  );
  if (attachmentState.state !== 'attached') {
    throw new AwsSingleNodeRetainedStorageProviderEvidenceConflictError();
  }
  const attachmentObservedDigest = decodeEvidence(() =>
    getAwsSingleNodeVolumeAttachmentObservedStateDigest(
      providerSpec,
      resourceKey,
      attachmentState,
    ),
  );
  const attachmentProviderResourceId = decodeEvidence(() =>
    getAwsSingleNodeVolumeAttachmentProviderResourceId(
      providerSpec,
      resourceKey,
      instanceId,
      volumeId,
    ),
  );

  const rootResponse = await readProvider(() =>
    ec2.describeVolumes(deepFreeze({ VolumeIds: [rootVolumeId] })),
  );
  const rootVolume = decodeEvidence(() =>
    decodeAwsSingleNodeNodeExactRootVolumeResponse(rootResponse, rootVolumeId),
  );
  decodeEvidence(() =>
    validateExactTags(rootVolume.Tags, tagContract.rootVolume),
  );
  const rootState = decodeEvidence(() =>
    decodeAwsSingleNodeNodeRootVolumeState(rootVolume, {
      providerSpec,
      expectedTags: tagContract.rootVolume,
      allowTagPropagation: false,
      instanceId,
    }),
  );

  return deepFreeze(
    sortCanonicalJsonValue({
      machineImage,
      instance: {
        instanceId,
        lifecycle,
        imageId: instance.ImageId,
        architecture: instance.Architecture,
        instanceType: instance.InstanceType,
        availabilityZoneId: instance.Placement.AvailabilityZoneId,
        rootDeviceName: instance.RootDeviceName,
        rootDeviceType: instance.RootDeviceType,
        rootVolumeId,
        evidenceDeviceName: capability.deviceName,
        evidenceVolumeId: volumeId,
      },
      rootVolume: {
        providerResourceId: rootVolumeId,
        lifecycle: rootVolume.State,
        state: rootState,
      },
      evidenceVolume: {
        providerResourceId: volumeId,
        resourceKey,
        deviceName: capability.deviceName,
        lifecycle: volumeMetadata.lifecycle,
        createTime: volumeMetadata.createTime,
        profile: volumeProfile,
        origin: {
          snapshotId: null,
          sourceVolumeId: null,
          outpostArn: null,
          fastRestored: false,
          volumeInitializationRate: null,
        },
        observedDigest: volumeEvidence.observedDigest,
      },
      attachment: {
        providerResourceId: attachmentProviderResourceId,
        state: attachmentState.state,
        instanceState: attachmentState.instanceState,
        instanceDeleteOnTermination:
          attachmentState.instanceDeleteOnTermination,
        volumeDeleteOnTermination: attachmentState.volumeDeleteOnTermination,
        observedDigest: attachmentObservedDigest,
      },
      exclusion: {
        rootVolumeId,
        evidenceVolumeId: volumeId,
        rootDeviceName: providerSpec.node.rootVolume.deviceName,
        evidenceDeviceName: capability.deviceName,
        distinctVolume: true,
        distinctDevice: true,
      },
    }),
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} experiment @returns {Readonly<Record<string, any>>} */
function validateTagContract(value, experiment) {
  const input = exactObject(value, 'aws retained-storage evidence tagContract');
  assertExactKeys(
    input,
    TAG_CONTRACT_KEYS,
    'aws retained-storage evidence tagContract',
  );
  const expected =
    getAwsSingleNodeRetainedStorageProviderExperimentTags(experiment);
  if (!sameJson(input, expected)) {
    throw new TypeError(
      'AWS retained-storage evidence tag contract does not match its experiment.',
    );
  }
  return expected;
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} context @returns {Readonly<Record<string, any>>} */
function validateObservation(value, context) {
  const input = exactObject(value, 'aws retained-storage evidence observation');
  assertExactKeys(
    input,
    OBSERVATION_KEYS,
    'aws retained-storage evidence observation',
  );
  const { experiment, providerSpec } = context;
  if (!sameJson(input.machineImage, providerSpec.machineImage)) {
    throw new TypeError(
      'AWS retained-storage evidence machine image does not match the provider specification.',
    );
  }

  const instance = exactObject(
    input.instance,
    'aws retained-storage evidence observation.instance',
  );
  assertExactKeys(
    instance,
    INSTANCE_KEYS,
    'aws retained-storage evidence observation.instance',
  );
  validateAwsSingleNodeVolumeAttachmentInstanceId(instance.instanceId);
  validateAwsSingleNodeVolumeAttachmentVolumeId(instance.rootVolumeId);
  validateAwsSingleNodeVolumeAttachmentVolumeId(instance.evidenceVolumeId);
  const capability =
    experiment.volumeRole === 'application-state'
      ? providerSpec.capabilities.applicationState
      : providerSpec.capabilities.controlState;
  if (
    instance.lifecycle !== 'running' ||
    instance.imageId !== providerSpec.machineImage.imageId ||
    instance.architecture !== providerSpec.machineImage.architecture ||
    instance.instanceType !== providerSpec.node.instanceType ||
    instance.availabilityZoneId !== providerSpec.placement.availabilityZoneId ||
    instance.rootDeviceName !== providerSpec.node.rootVolume.deviceName ||
    instance.rootDeviceType !== providerSpec.machineImage.rootDeviceType ||
    instance.evidenceDeviceName !== capability.deviceName ||
    instance.rootVolumeId === instance.evidenceVolumeId ||
    instance.rootDeviceName === instance.evidenceDeviceName
  ) {
    throw new TypeError(
      'AWS retained-storage evidence instance observation is inconsistent.',
    );
  }

  const rootVolume = exactObject(
    input.rootVolume,
    'aws retained-storage evidence observation.rootVolume',
  );
  assertExactKeys(
    rootVolume,
    ROOT_VOLUME_KEYS,
    'aws retained-storage evidence observation.rootVolume',
  );
  if (
    rootVolume.providerResourceId !== instance.rootVolumeId ||
    rootVolume.lifecycle !== 'in-use' ||
    !sameJson(rootVolume.state, expectedRootVolumeState(providerSpec))
  ) {
    throw new TypeError(
      'AWS retained-storage evidence root-volume observation is inconsistent.',
    );
  }

  const evidenceVolume = exactObject(
    input.evidenceVolume,
    'aws retained-storage evidence observation.evidenceVolume',
  );
  assertExactKeys(
    evidenceVolume,
    EVIDENCE_VOLUME_KEYS,
    'aws retained-storage evidence observation.evidenceVolume',
  );
  const expectedProfile = expectedEvidenceVolumeProfile(
    providerSpec,
    experiment.volumeRole,
  );
  const expectedDigest = createAwsSingleNodeVolumeStateDigest(expectedProfile);
  const observedDigest = validateSha256Digest(
    evidenceVolume.observedDigest,
    'aws retained-storage evidence observation.evidenceVolume.observedDigest',
  );
  const createTime = Date.parse(evidenceVolume.createTime);
  if (
    evidenceVolume.providerResourceId !== instance.evidenceVolumeId ||
    evidenceVolume.resourceKey !== experiment.volumeRole ||
    evidenceVolume.deviceName !== capability.deviceName ||
    evidenceVolume.lifecycle !== 'in-use' ||
    !Number.isFinite(createTime) ||
    new Date(createTime).toISOString() !== evidenceVolume.createTime ||
    !sameJson(evidenceVolume.profile, expectedProfile) ||
    !sameJson(observedDigest, expectedDigest)
  ) {
    throw new TypeError(
      'AWS retained-storage evidence volume observation is inconsistent.',
    );
  }
  const origin = exactObject(
    evidenceVolume.origin,
    'aws retained-storage evidence observation.evidenceVolume.origin',
  );
  assertExactKeys(
    origin,
    ORIGIN_KEYS,
    'aws retained-storage evidence observation.evidenceVolume.origin',
  );
  if (
    origin.snapshotId !== null ||
    origin.sourceVolumeId !== null ||
    origin.outpostArn !== null ||
    origin.fastRestored !== false ||
    origin.volumeInitializationRate !== null
  ) {
    throw new TypeError(
      'AWS retained-storage evidence volume origin is inconsistent.',
    );
  }

  const attachment = exactObject(
    input.attachment,
    'aws retained-storage evidence observation.attachment',
  );
  assertExactKeys(
    attachment,
    ATTACHMENT_KEYS,
    'aws retained-storage evidence observation.attachment',
  );
  const attachmentState = {
    state: 'attached',
    instanceState: 'running',
    instanceDeleteOnTermination: false,
    volumeDeleteOnTermination: false,
  };
  const expectedAttachmentId =
    getAwsSingleNodeVolumeAttachmentProviderResourceId(
      providerSpec,
      experiment.volumeRole,
      instance.instanceId,
      instance.evidenceVolumeId,
    );
  const expectedAttachmentDigest =
    getAwsSingleNodeVolumeAttachmentObservedStateDigest(
      providerSpec,
      experiment.volumeRole,
      attachmentState,
    );
  const attachmentDigest = validateSha256Digest(
    attachment.observedDigest,
    'aws retained-storage evidence observation.attachment.observedDigest',
  );
  if (
    attachment.providerResourceId !== expectedAttachmentId ||
    attachment.state !== attachmentState.state ||
    attachment.instanceState !== attachmentState.instanceState ||
    attachment.instanceDeleteOnTermination !== false ||
    attachment.volumeDeleteOnTermination !== false ||
    !sameJson(attachmentDigest, expectedAttachmentDigest)
  ) {
    throw new TypeError(
      'AWS retained-storage evidence attachment observation is inconsistent.',
    );
  }

  const exclusion = exactObject(
    input.exclusion,
    'aws retained-storage evidence observation.exclusion',
  );
  assertExactKeys(
    exclusion,
    EXCLUSION_KEYS,
    'aws retained-storage evidence observation.exclusion',
  );
  if (
    exclusion.rootVolumeId !== instance.rootVolumeId ||
    exclusion.evidenceVolumeId !== instance.evidenceVolumeId ||
    exclusion.rootDeviceName !== instance.rootDeviceName ||
    exclusion.evidenceDeviceName !== instance.evidenceDeviceName ||
    exclusion.distinctVolume !== true ||
    exclusion.distinctDevice !== true
  ) {
    throw new TypeError(
      'AWS retained-storage evidence root exclusion is inconsistent.',
    );
  }

  return deepFreeze(sortCanonicalJsonValue(input));
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateConclusion(value) {
  const conclusion = exactObject(
    value,
    'aws retained-storage evidence conclusion',
  );
  assertExactKeys(
    conclusion,
    CONCLUSION_KEYS,
    'aws retained-storage evidence conclusion',
  );
  if (
    conclusion.authoritative !== false ||
    conclusion.observations !== 2 ||
    conclusion.stable !== true ||
    conclusion.machineImagePinned !== true ||
    conclusion.instanceStorageProjectionMatchesProviderSpec !== true ||
    conclusion.experimentTagsVerified !== true ||
    conclusion.rootVolumeExcluded !== true ||
    conclusion.evidenceVolumeMatchesProviderSpec !== true ||
    conclusion.attachmentViewsAgree !== true
  ) {
    throw new TypeError(
      'AWS retained-storage evidence conclusion is inconsistent.',
    );
  }
  return deepFreeze({ ...conclusion });
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validatePayload(value) {
  const input = exactObject(value, 'aws retained-storage provider evidence');
  assertExactKeys(
    input,
    PAYLOAD_KEYS,
    'aws retained-storage provider evidence',
  );
  if (
    input.schemaVersion !==
      AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_SCHEMA_VERSION ||
    input.kind !== AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_KIND ||
    input.classification !== CLASSIFICATION ||
    input.authority !== 'none'
  ) {
    throw new TypeError(
      'AWS retained-storage provider evidence header is invalid.',
    );
  }
  const experiment = validateAwsSingleNodeRetainedStorageProviderExperiment(
    input.experiment,
  );
  const providerScope = validateProviderScope(
    input.providerScope,
    'aws retained-storage provider evidence.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpec(
    input.providerSpec,
    'aws retained-storage provider evidence.providerSpec',
  );
  if (
    experiment.purpose !== PURPOSE ||
    experiment.providerScopeId !== providerScope.providerScopeId ||
    experiment.providerSpecId !== providerSpec.providerSpecId ||
    providerSpec.providerScopeId !== providerScope.providerScopeId
  ) {
    throw new TypeError(
      'AWS retained-storage provider evidence authority inputs disagree.',
    );
  }
  const tagContract = validateTagContract(input.tagContract, experiment);
  const observation = validateObservation(input.observation, {
    experiment,
    providerSpec,
  });
  const conclusion = validateConclusion(input.conclusion);
  if (!sameJson(input.limitations, LIMITATIONS)) {
    throw new TypeError(
      'AWS retained-storage provider evidence limitations are invalid.',
    );
  }
  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_KIND,
      classification: CLASSIFICATION,
      authority: 'none',
      experiment,
      providerScope,
      providerSpec,
      tagContract,
      observation,
      conclusion,
      limitations: LIMITATIONS,
    }),
  );
  assertManifestIsSecretFree(payload, 'aws retained-storage provider evidence');
  return payload;
}

/**
 * Validate one bounded deserialized provider-evidence receipt and recompute
 * its semantic identity. This authenticates exact bytes, not issuer or truth.
 * @param {unknown} value - Candidate receipt.
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt(
  value,
) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_MAX_BYTES,
    'aws retained-storage provider evidence receipt',
  );
  assertExactKeys(
    document,
    DOCUMENT_KEYS,
    'aws retained-storage provider evidence receipt',
  );
  assertDomainSeparatedSha256Id(
    document.evidenceId,
    AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_PREFIX,
    'aws retained-storage provider evidence receipt.evidenceId',
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(payloadInput);
  const evidenceId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_PREFIX,
    value: payload,
    valuePath: 'aws retained-storage provider evidence receipt',
  });
  if (document.evidenceId !== evidenceId) {
    throw new Error(
      'AWS retained-storage provider evidence receipt ID does not match its exact payload.',
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      ...payload,
      evidenceId,
    }),
  );
}

/**
 * Bind the read-only SSM/EC2 evidence collector to one exact credential scope.
 * The caller must provide narrow facades; this module exposes no mutation port
 * and owns no client lifecycle.
 * @param {unknown} options - Exact scope, narrow clients, and clock.
 * @returns {Readonly<{collect: (input: unknown) => Promise<Readonly<Record<string, any>>>}>}
 */
export function createAwsSingleNodeRetainedStorageProviderEvidenceCollector(
  options,
) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'AWS retained-storage provider evidence options must be an object.',
    );
  }
  assertExactKeys(
    options,
    FACTORY_KEYS,
    'AWS retained-storage provider evidence options',
  );
  const providerScope = validateProviderScope(
    ownData(
      options,
      'providerScope',
      'AWS retained-storage provider evidence options',
    ),
    'AWS retained-storage provider evidence options.providerScope',
  );
  const clients = exactObject(
    ownData(
      options,
      'clients',
      'AWS retained-storage provider evidence options',
    ),
    'AWS retained-storage provider evidence options.clients',
  );
  assertExactKeys(
    clients,
    CLIENT_KEYS,
    'AWS retained-storage provider evidence options.clients',
  );
  const ssm = captureClient(
    ownData(
      clients,
      'ssm',
      'AWS retained-storage provider evidence options.clients',
    ),
    SSM_CLIENT_KEYS,
    'AWS retained-storage provider evidence options.clients.ssm',
  );
  const ec2 = captureClient(
    ownData(
      clients,
      'ec2',
      'AWS retained-storage provider evidence options.clients',
    ),
    EC2_CLIENT_KEYS,
    'AWS retained-storage provider evidence options.clients.ec2',
  );
  const nowMethod = ownData(
    options,
    'now',
    'AWS retained-storage provider evidence options',
  );
  if (typeof nowMethod !== 'function') {
    throw new TypeError(
      'AWS retained-storage provider evidence options.now must be a function.',
    );
  }
  const now = nowMethod.bind(options);
  const readNow = () => {
    try {
      return validateNow(now());
    } catch (error) {
      if (
        error instanceof
        AwsSingleNodeRetainedStorageProviderEvidenceUnknownError
      ) {
        throw error;
      }
      throw new AwsSingleNodeRetainedStorageProviderEvidenceUnknownError();
    }
  };

  return Object.freeze({
    async collect(value) {
      const input = cloneBoundedJsonObject(
        value,
        AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_MAX_BYTES,
        'AWS retained-storage provider evidence collect input',
      );
      assertExactKeys(
        input,
        COLLECT_KEYS,
        'AWS retained-storage provider evidence collect input',
      );
      const experiment = validateAwsSingleNodeRetainedStorageProviderExperiment(
        input.experiment,
      );
      const providerSpec = validateAwsSingleNodeProviderSpec(
        input.providerSpec,
        'AWS retained-storage provider evidence collect input.providerSpec',
      );
      let instanceId;
      let volumeId;
      try {
        instanceId = validateAwsSingleNodeVolumeAttachmentInstanceId(
          input.instanceId,
        );
        volumeId = validateAwsSingleNodeVolumeAttachmentVolumeId(
          input.volumeId,
        );
      } catch {
        throw new TypeError(
          'AWS retained-storage provider evidence resource IDs are invalid.',
        );
      }
      if (
        experiment.purpose !== PURPOSE ||
        experiment.providerScopeId !== providerScope.providerScopeId ||
        experiment.providerSpecId !== providerSpec.providerSpecId ||
        providerSpec.providerScopeId !== providerScope.providerScopeId
      ) {
        throw new TypeError(
          'AWS retained-storage provider evidence input does not match its credential scope and provider specification.',
        );
      }
      const tagContract =
        getAwsSingleNodeRetainedStorageProviderExperimentTags(experiment);

      const firstNow = readNow();
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        firstNow,
      );
      const first = await readObservation({
        ec2,
        experiment,
        instanceId,
        now: firstNow,
        providerScope,
        providerSpec,
        ssm,
        tagContract,
        volumeId,
      });

      const secondNow = readNow();
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        secondNow,
      );
      const second = await readObservation({
        ec2,
        experiment,
        instanceId,
        now: secondNow,
        providerScope,
        providerSpec,
        ssm,
        tagContract,
        volumeId,
      });
      if (!sameJson(first, second)) {
        throw new AwsSingleNodeRetainedStorageProviderEvidenceUnstableError();
      }
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        readNow(),
      );

      const payload = validatePayload({
        schemaVersion:
          AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_KIND,
        classification: CLASSIFICATION,
        authority: 'none',
        experiment,
        providerScope,
        providerSpec,
        tagContract,
        observation: first,
        conclusion: {
          authoritative: false,
          observations: 2,
          stable: true,
          machineImagePinned: true,
          instanceStorageProjectionMatchesProviderSpec: true,
          experimentTagsVerified: true,
          rootVolumeExcluded: true,
          evidenceVolumeMatchesProviderSpec: true,
          attachmentViewsAgree: true,
        },
        limitations: LIMITATIONS,
      });
      const evidenceId = createCanonicalJsonSha256Id({
        domain: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_DOMAIN,
        prefix: AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EVIDENCE_ID_PREFIX,
        value: payload,
        valuePath: 'aws retained-storage provider evidence',
      });
      return validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt({
        ...payload,
        evidenceId,
      });
    },
  });
}

export default createAwsSingleNodeRetainedStorageProviderEvidenceCollector;
