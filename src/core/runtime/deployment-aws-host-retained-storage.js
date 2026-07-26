/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- The two role-specific V66 adapters deliberately expose their exact injected command and evidence contracts inline. */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { sortCanonicalJsonValue } from './canonical-order.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
  validateAwsSingleNodeHostActivationRequest,
} from './deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from './deployment-aws-host-activation.js';
import {
  getAwsSingleNodeHostRetainedStorageMountUnitName,
  projectAwsSingleNodeHostRetainedStorageBoot,
} from './deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
} from './deployment-aws-host-runtime-account.js';
import { validateAwsSingleNodeHostRuntimeIdentityEvidence } from './deployment-aws-host-runtime-identity.js';
import { AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX } from './deployment-aws-volume-attachment-evidence.js';
import { assertAwsEc2InstanceId } from './deployment-aws-runtime-identity-contract.js';
import {
  assertDeploymentInstanceId,
  PROVIDER_SCOPE_ID_PREFIX,
} from './deployment-provider-scope.js';
import {
  assertDeploymentIncarnationId,
  DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
} from './deployment-resource-binding.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { createLocalAppStorageLayout } from './local-app-storage.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT =
  '/var/lib/wharfie-runtime/.local/share/wharfie-nodejs';
export const AWS_SINGLE_NODE_HOST_RETAINED_FILESYSTEM_UUID_DOMAIN =
  'wharfie:aws-single-node-host-retained-filesystem:v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_MAX_BYTES =
  16 * 1024;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_MAX_BYTES =
  24 * 1024;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_COMMAND_RESULT_MAX_BYTES =
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_MAX_BYTES + 1024;
export const AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_DESIRED_KIND =
  'awsSingleNodeHostApplicationStorageDesired';
export const AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_DESIRED_KIND =
  'awsSingleNodeHostControlStorageDesired';
export const AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND =
  'awsSingleNodeHostApplicationStorageEvidence';
export const AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND =
  'awsSingleNodeHostControlStorageEvidence';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE = 0o700;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE = 'ext4';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID =
  'wharfie-ext4-v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID =
  'wharfie-systemd-retained-storage-v2';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL =
  'Amazon Elastic Block Store';

const APPLICATION_ROLE = Object.freeze({
  capabilityKind: 'application-state',
  stepKind: 'application-storage',
  desiredKind: AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_DESIRED_KIND,
  evidenceKind: AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
});
const CONTROL_ROLE = Object.freeze({
  capabilityKind: 'control-state',
  stepKind: 'control-storage',
  desiredKind: AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_DESIRED_KIND,
  evidenceKind: AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
});
const RUNTIME_IDENTITY_STEP = 'runtime-identity';
const APPLICATION_STORAGE_STEP = 'application-storage';
const FACTORY_KEYS = new Set(['command']);
const COMMAND_KEYS = new Set(['inspect', 'converge']);
const CONTEXT_KEYS = new Set(['request', 'step', 'priorEvidence']);
const STEP_KEYS = new Set(['intentId', 'kind', 'attemptGeneration']);
const APPLICATION_PRIOR_EVIDENCE_KEYS = new Set([RUNTIME_IDENTITY_STEP]);
const CONTROL_PRIOR_EVIDENCE_KEYS = new Set([
  RUNTIME_IDENTITY_STEP,
  APPLICATION_STORAGE_STEP,
]);
const DESIRED_KEYS = new Set([
  'schemaVersion',
  'kind',
  'requestId',
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
  'nodeProviderResourceId',
  'appId',
  'capabilityKind',
  'volumeBindingId',
  'volumeProviderResourceId',
  'sizeBytes',
  'createdWithoutSnapshot',
  'attachmentBindingId',
  'attachmentProviderResourceId',
  'filesystem',
  'mount',
  'directory',
  'bootWiring',
]);
const EVIDENCE_KEYS = new Set([...DESIRED_KEYS, 'device']);
const FILESYSTEM_KEYS = new Set(['type', 'uuid', 'profileId']);
const DESIRED_MOUNT_KEYS = new Set([
  'target',
  'readOnly',
  'nodev',
  'noexec',
  'nosuid',
  'privatePropagation',
]);
const EVIDENCE_MOUNT_KEYS = new Set([
  ...DESIRED_MOUNT_KEYS,
  'sourcePath',
  'mounted',
]);
const DIRECTORY_KEYS = new Set(['user', 'group', 'uid', 'gid', 'mode']);
const BOOT_WIRING_KEYS = new Set([
  'id',
  'projectionId',
  'persistent',
  'enabled',
  'sourceByVolumeIdentity',
  'orderedBeforeRuntimeUserManager',
]);
const DEVICE_KEYS = new Set([
  'nvmeModel',
  'nvmeSerialVolumeId',
  'path',
  'major',
  'minor',
]);
const STATUS_ONLY_KEYS = new Set(['status']);
const SETTLED_RESULT_KEYS = new Set(['status', 'evidence']);
const OBSERVATION_STATUSES = new Set([
  'ready',
  'unknown',
  'conflict',
  'settled',
]);
const NVME_DEVICE_PATTERN = /^\/dev\/nvme[0-9]+n[0-9]+$/u;
const FILESYSTEM_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;

/** Exact settled media or wiring contradicts the request-bound contract. */
export class AwsSingleNodeHostRetainedStorageConflictError extends Error {
  /** @param {string} reason - Safe finite conflict reason. */
  constructor(reason) {
    super(
      `AWS single-node host retained storage conflicts with its contract (${reason}).`,
    );
    this.name = 'AwsSingleNodeHostRetainedStorageConflictError';
    this.code = 'AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_CONFLICT';
    this.reason = reason;
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

/** @param {unknown} value @param {string} valuePath @returns {Record<string, any>} */
function exactPlainObject(value, valuePath) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${valuePath} must be an object.`);
  }
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  const ownKeys = Reflect.ownKeys(value);
  for (const key of ownKeys) {
    if (typeof key !== 'string' || !keys.has(key)) {
      throw new TypeError(`${valuePath}.${String(key)} is not supported.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${valuePath}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {unknown} */
function ownDataValue(value, key, valuePath) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined ||
    descriptor.enumerable !== true ||
    !Object.hasOwn(descriptor, 'value')
  ) {
    throw new TypeError(`${valuePath}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** @param {Record<string, any>} value @param {string} key @param {string} valuePath @returns {Function} */
function ownDataFunction(value, key, valuePath) {
  const candidate = ownDataValue(value, key, valuePath);
  if (typeof candidate !== 'function') {
    throw new TypeError(`${valuePath}.${key} must be a function.`);
  }
  return candidate;
}

/** @template T @param {T} value @returns {T} */
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

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function positiveSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function canonicalNvmeDevicePath(value, valuePath) {
  if (
    typeof value !== 'string' ||
    !NVME_DEVICE_PATTERN.test(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(
      `${valuePath} must be an unpartitioned canonical NVMe namespace path.`,
    );
  }
  return value;
}

/** @param {Readonly<Record<string, any>>} request @param {string} capabilityKind @returns {Readonly<Record<string, any>>} */
function volumeFor(request, capabilityKind) {
  const volume = request.volumes.find(
    (/** @type {Readonly<Record<string, any>>} */ candidate) =>
      candidate.capabilityKind === capabilityKind,
  );
  if (volume === undefined) {
    throw new Error(
      `AWS single-node host activation request lacks ${capabilityKind}.`,
    );
  }
  return volume;
}

/** @param {string} kind @returns {Readonly<Record<string, string>>} */
function roleForDesiredKind(kind) {
  if (kind === APPLICATION_ROLE.desiredKind) return APPLICATION_ROLE;
  if (kind === CONTROL_ROLE.desiredKind) return CONTROL_ROLE;
  throw new TypeError(
    'awsSingleNodeHostRetainedStorageDesired.kind is not supported.',
  );
}

/** @param {string} appId @returns {Readonly<{dataRoot: string, applicationMountTarget: string, controlMountTarget: string}>} */
function retainedStorageLayoutForApp(appId) {
  assertLogicalId(appId, 'awsSingleNodeHostRetainedStorage appId');
  const local = createLocalAppStorageLayout({
    appId,
    dataRoot: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
  });
  return Object.freeze({
    dataRoot: local.dataRoot,
    applicationMountTarget: local.applicationStatePath,
    controlMountTarget: local.controlPath,
  });
}

/** @param {{providerScopeId: string, deploymentInstanceId: string, incarnationId: string, capabilityKind: string, volumeProviderResourceId: string}} authority @returns {string} */
function deriveRetainedFilesystemUuid(authority) {
  const stableAuthority = sortCanonicalJsonValue({
    providerScopeId: authority.providerScopeId,
    deploymentInstanceId: authority.deploymentInstanceId,
    incarnationId: authority.incarnationId,
    capabilityKind: authority.capabilityKind,
    volumeProviderResourceId: authority.volumeProviderResourceId,
  });
  const bytes = createHash('sha256')
    .update(AWS_SINGLE_NODE_HOST_RETAINED_FILESYSTEM_UUID_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(JSON.stringify(stableAuthority), 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Derive both retained mount targets through the public local-app layout.
 * Neither the activation request nor a command can choose these paths.
 * @param {unknown} requestValue - Exact V65 activation request.
 * @returns {Readonly<{dataRoot: string, applicationMountTarget: string, controlMountTarget: string}>}
 */
export function getAwsSingleNodeHostRetainedStorageLayout(requestValue) {
  const request = validateAwsSingleNodeHostActivationRequest(requestValue);
  return retainedStorageLayoutForApp(request.appId);
}

/**
 * Derive an RFC-variant UUIDv8 from only stable volume/incarnation authority.
 * Request, head, revision, artifact, and requested device aliases are absent.
 * @param {unknown} requestValue - Exact V65 activation request.
 * @param {unknown} capabilityKindValue - Fixed retained capability.
 * @returns {string} - Lowercase UUIDv8.
 */
export function getAwsSingleNodeHostRetainedFilesystemUuid(
  requestValue,
  capabilityKindValue,
) {
  const request = validateAwsSingleNodeHostActivationRequest(requestValue);
  if (
    capabilityKindValue !== APPLICATION_ROLE.capabilityKind &&
    capabilityKindValue !== CONTROL_ROLE.capabilityKind
  ) {
    throw new TypeError(
      'awsSingleNodeHostRetainedFilesystemUuid capabilityKind is not supported.',
    );
  }
  const capabilityKind = String(capabilityKindValue);
  const volume = volumeFor(request, capabilityKind);
  return deriveRetainedFilesystemUuid({
    providerScopeId: request.providerScope.providerScopeId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
    capabilityKind,
    volumeProviderResourceId: volume.volumeProviderResourceId,
  });
}

/** @param {Readonly<Record<string, any>>} request @returns {Readonly<Record<string, any>>} */
function runtimeIdentityContext(request) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        RUNTIME_IDENTITY_STEP,
      ),
      kind: RUNTIME_IDENTITY_STEP,
      attemptGeneration: 0,
    },
    priorEvidence: {},
  });
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} runtimeEvidence @returns {Readonly<Record<string, any>>} */
function applicationStorageContext(request, runtimeEvidence) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(
        request,
        APPLICATION_STORAGE_STEP,
      ),
      kind: APPLICATION_STORAGE_STEP,
      attemptGeneration: 0,
    },
    priorEvidence: {
      [RUNTIME_IDENTITY_STEP]: runtimeEvidence,
    },
  });
}

/**
 * Revalidate one complete V66 role frontier, including all earlier concrete
 * evidence. Factory-bound account IDs are checked separately.
 * @param {unknown} value - Candidate V66 effect context.
 * @param {Readonly<Record<string, string>>} role - Fixed adapter role.
 * @returns {Readonly<Record<string, any>>}
 */
function validateContext(value, role) {
  const valuePath = `awsSingleNodeHost${role.stepKind} context`;
  const context = exactPlainObject(value, valuePath);
  assertExactKeys(context, CONTEXT_KEYS, valuePath);
  const request = validateAwsSingleNodeHostActivationRequest(
    ownDataValue(context, 'request', valuePath),
    `${valuePath}.request`,
  );
  const step = exactPlainObject(
    ownDataValue(context, 'step', valuePath),
    `${valuePath}.step`,
  );
  assertExactKeys(step, STEP_KEYS, `${valuePath}.step`);
  if (ownDataValue(step, 'kind', `${valuePath}.step`) !== role.stepKind) {
    throw new TypeError(`${valuePath}.step.kind must be '${role.stepKind}'.`);
  }
  const intentId = getAwsSingleNodeHostActivationIntentId(
    request,
    role.stepKind,
  );
  if (ownDataValue(step, 'intentId', `${valuePath}.step`) !== intentId) {
    throw new Error(
      `${valuePath}.step.intentId does not match its exact request.`,
    );
  }
  const attemptGeneration = nonnegativeSafeInteger(
    ownDataValue(step, 'attemptGeneration', `${valuePath}.step`),
    `${valuePath}.step.attemptGeneration`,
  );
  const priorEvidence = exactPlainObject(
    ownDataValue(context, 'priorEvidence', valuePath),
    `${valuePath}.priorEvidence`,
  );
  const expectedPriorKeys =
    role === APPLICATION_ROLE
      ? APPLICATION_PRIOR_EVIDENCE_KEYS
      : CONTROL_PRIOR_EVIDENCE_KEYS;
  assertExactKeys(
    priorEvidence,
    expectedPriorKeys,
    `${valuePath}.priorEvidence`,
  );
  const runtimeEvidence = validateAwsSingleNodeHostRuntimeIdentityEvidence(
    ownDataValue(
      priorEvidence,
      RUNTIME_IDENTITY_STEP,
      `${valuePath}.priorEvidence`,
    ),
    runtimeIdentityContext(request),
    `${valuePath}.priorEvidence.${RUNTIME_IDENTITY_STEP}`,
  );
  let applicationEvidence = null;
  if (role === CONTROL_ROLE) {
    applicationEvidence = validateAwsSingleNodeHostApplicationStorageEvidence(
      ownDataValue(
        priorEvidence,
        APPLICATION_STORAGE_STEP,
        `${valuePath}.priorEvidence`,
      ),
      applicationStorageContext(request, runtimeEvidence),
    );
  }
  return Object.freeze({
    request,
    intentId,
    attemptGeneration,
    runtimeEvidence,
    applicationEvidence,
  });
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, string>>} role @returns {Readonly<Record<string, any>>} */
function createDesired(request, role) {
  const volume = volumeFor(request, role.capabilityKind);
  const layout = getAwsSingleNodeHostRetainedStorageLayout(request);
  const filesystemUuid = getAwsSingleNodeHostRetainedFilesystemUuid(
    request,
    role.capabilityKind,
  );
  const desired = sortCanonicalJsonValue({
    schemaVersion: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_SCHEMA_VERSION,
    kind: role.desiredKind,
    requestId: request.requestId,
    providerScopeId: request.providerScope.providerScopeId,
    deploymentInstanceId: request.deploymentInstanceId,
    incarnationId: request.incarnationId,
    nodeProviderResourceId: request.nodeProviderResourceId,
    appId: request.appId,
    capabilityKind: role.capabilityKind,
    volumeBindingId: volume.volumeBindingId,
    volumeProviderResourceId: volume.volumeProviderResourceId,
    sizeBytes: volume.sizeBytes,
    createdWithoutSnapshot: volume.createdWithoutSnapshot,
    attachmentBindingId: volume.attachmentBindingId,
    attachmentProviderResourceId: volume.attachmentProviderResourceId,
    filesystem: {
      type: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
      uuid: filesystemUuid,
      profileId: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
    },
    mount: {
      target:
        role === APPLICATION_ROLE
          ? layout.applicationMountTarget
          : layout.controlMountTarget,
      readOnly: false,
      nodev: true,
      noexec: true,
      nosuid: true,
      privatePropagation: true,
    },
    directory: {
      user: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
      group: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
      uid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
      gid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
      mode: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE,
    },
    bootWiring: {
      id: `wharfie-retained-${role.capabilityKind}-${filesystemUuid}`,
      projectionId: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID,
      persistent: true,
      enabled: true,
      sourceByVolumeIdentity: true,
      orderedBeforeRuntimeUserManager: true,
    },
  });
  return validateAwsSingleNodeHostRetainedStorageDesired(desired);
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateDirectory(value, valuePath) {
  const directory = exactPlainObject(value, valuePath);
  assertExactKeys(directory, DIRECTORY_KEYS, valuePath);
  if (
    directory.user !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER ||
    directory.group !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP ||
    directory.uid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID ||
    directory.gid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID ||
    directory.mode !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DIRECTORY_MODE
  ) {
    throw new TypeError(
      `${valuePath} must use the exact fixed wharfie-runtime account and 0700 mode.`,
    );
  }
  return Object.freeze({
    user: directory.user,
    group: directory.group,
    uid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
    gid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
    mode: directory.mode,
  });
}

/**
 * Validate one complete role-specific desired retained-storage document
 * independently of a V66 context. The filesystem UUID and mount target are
 * recomputed from stable authority; callers cannot choose either path.
 * @param {unknown} value - Candidate desired document.
 * @returns {Readonly<Record<string, any>>} - Canonical frozen desired state.
 */
export function validateAwsSingleNodeHostRetainedStorageDesired(value) {
  const valuePath = 'awsSingleNodeHostRetainedStorageDesired';
  const desired = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(desired, DESIRED_KEYS, valuePath);
  if (
    desired.schemaVersion !==
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_SCHEMA_VERSION
  ) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  const role = roleForDesiredKind(desired.kind);
  if (desired.capabilityKind !== role.capabilityKind) {
    throw new TypeError(
      `${valuePath}.capabilityKind does not match its role-specific kind.`,
    );
  }
  assertDomainSeparatedSha256Id(
    desired.requestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    `${valuePath}.requestId`,
  );
  assertDomainSeparatedSha256Id(
    desired.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${valuePath}.providerScopeId`,
  );
  assertDeploymentInstanceId(
    desired.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(
    desired.incarnationId,
    `${valuePath}.incarnationId`,
  );
  assertAwsEc2InstanceId(
    desired.nodeProviderResourceId,
    `${valuePath}.nodeProviderResourceId`,
  );
  assertLogicalId(desired.appId, `${valuePath}.appId`);
  assertDomainSeparatedSha256Id(
    desired.volumeBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${valuePath}.volumeBindingId`,
  );
  if (
    typeof desired.volumeProviderResourceId !== 'string' ||
    !VOLUME_ID_PATTERN.test(desired.volumeProviderResourceId)
  ) {
    throw new TypeError(
      `${valuePath}.volumeProviderResourceId must be a canonical EBS volume ID.`,
    );
  }
  const sizeBytes = positiveSafeInteger(
    desired.sizeBytes,
    `${valuePath}.sizeBytes`,
  );
  if (desired.createdWithoutSnapshot !== true) {
    throw new TypeError(
      `${valuePath}.createdWithoutSnapshot must be literal true.`,
    );
  }
  assertDomainSeparatedSha256Id(
    desired.attachmentBindingId,
    DEPLOYMENT_RESOURCE_BINDING_ID_PREFIX,
    `${valuePath}.attachmentBindingId`,
  );
  if (desired.attachmentBindingId === desired.volumeBindingId) {
    throw new TypeError(
      `${valuePath} volume and attachment binding IDs must be distinct.`,
    );
  }
  assertDomainSeparatedSha256Id(
    desired.attachmentProviderResourceId,
    AWS_SINGLE_NODE_VOLUME_ATTACHMENT_PROVIDER_RESOURCE_ID_PREFIX,
    `${valuePath}.attachmentProviderResourceId`,
  );

  const filesystem = exactPlainObject(
    desired.filesystem,
    `${valuePath}.filesystem`,
  );
  assertExactKeys(filesystem, FILESYSTEM_KEYS, `${valuePath}.filesystem`);
  if (
    filesystem.type !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE ||
    filesystem.profileId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID ||
    typeof filesystem.uuid !== 'string' ||
    !FILESYSTEM_UUID_PATTERN.test(filesystem.uuid)
  ) {
    throw new TypeError(
      `${valuePath}.filesystem must use the fixed ext4 UUIDv8 contract.`,
    );
  }
  const expectedFilesystemUuid = deriveRetainedFilesystemUuid({
    providerScopeId: desired.providerScopeId,
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId: desired.incarnationId,
    capabilityKind: role.capabilityKind,
    volumeProviderResourceId: desired.volumeProviderResourceId,
  });
  if (filesystem.uuid !== expectedFilesystemUuid) {
    throw new Error(
      `${valuePath}.filesystem.uuid does not match its stable volume authority.`,
    );
  }

  const mount = exactPlainObject(desired.mount, `${valuePath}.mount`);
  assertExactKeys(mount, DESIRED_MOUNT_KEYS, `${valuePath}.mount`);
  const layout = retainedStorageLayoutForApp(desired.appId);
  const expectedMountTarget =
    role === APPLICATION_ROLE
      ? layout.applicationMountTarget
      : layout.controlMountTarget;
  getAwsSingleNodeHostRetainedStorageMountUnitName(expectedMountTarget);
  if (
    mount.target !== expectedMountTarget ||
    mount.readOnly !== false ||
    mount.nodev !== true ||
    mount.noexec !== true ||
    mount.nosuid !== true ||
    mount.privatePropagation !== true
  ) {
    throw new TypeError(
      `${valuePath}.mount does not match the fixed secure role-specific mount contract.`,
    );
  }
  const directory = validateDirectory(
    desired.directory,
    `${valuePath}.directory`,
  );
  const bootWiring = exactPlainObject(
    desired.bootWiring,
    `${valuePath}.bootWiring`,
  );
  assertExactKeys(bootWiring, BOOT_WIRING_KEYS, `${valuePath}.bootWiring`);
  if (
    bootWiring.id !==
      `wharfie-retained-${role.capabilityKind}-${expectedFilesystemUuid}` ||
    bootWiring.projectionId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID ||
    bootWiring.persistent !== true ||
    bootWiring.enabled !== true ||
    bootWiring.sourceByVolumeIdentity !== true ||
    bootWiring.orderedBeforeRuntimeUserManager !== true
  ) {
    throw new TypeError(
      `${valuePath}.bootWiring does not match the fixed persistent mount contract.`,
    );
  }

  const canonical = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DESIRED_SCHEMA_VERSION,
      kind: role.desiredKind,
      requestId: desired.requestId,
      providerScopeId: desired.providerScopeId,
      deploymentInstanceId: desired.deploymentInstanceId,
      incarnationId: desired.incarnationId,
      nodeProviderResourceId: desired.nodeProviderResourceId,
      appId: desired.appId,
      capabilityKind: role.capabilityKind,
      volumeBindingId: desired.volumeBindingId,
      volumeProviderResourceId: desired.volumeProviderResourceId,
      sizeBytes,
      createdWithoutSnapshot: true,
      attachmentBindingId: desired.attachmentBindingId,
      attachmentProviderResourceId: desired.attachmentProviderResourceId,
      filesystem: {
        type: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
        uuid: expectedFilesystemUuid,
        profileId: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
      },
      mount: {
        target: expectedMountTarget,
        readOnly: false,
        nodev: true,
        noexec: true,
        nosuid: true,
        privatePropagation: true,
      },
      directory,
      bootWiring: {
        id: bootWiring.id,
        projectionId: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BOOT_PROJECTION_ID,
        persistent: true,
        enabled: true,
        sourceByVolumeIdentity: true,
        orderedBeforeRuntimeUserManager: true,
      },
    }),
  );
  assertManifestIsSecretFree(canonical, valuePath);
  return canonical;
}

/**
 * Validate and project the exact persistent mount plus the one shared
 * fail-closed user-manager gate requiring both retained mounts.
 * @param {unknown} desiredValue - Strict role-specific desired state.
 * @returns {Readonly<Record<string, any>>} Exact immutable boot projection.
 */
export function getAwsSingleNodeHostRetainedStorageBootProjection(
  desiredValue,
) {
  return projectAwsSingleNodeHostRetainedStorageBoot(
    validateAwsSingleNodeHostRetainedStorageDesired(desiredValue),
  );
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateDevice(value, valuePath) {
  const device = exactPlainObject(value, valuePath);
  assertExactKeys(device, DEVICE_KEYS, valuePath);
  if (device.nvmeModel !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL) {
    throw new TypeError(
      `${valuePath}.nvmeModel must be the fixed Amazon EBS model.`,
    );
  }
  if (
    typeof device.nvmeSerialVolumeId !== 'string' ||
    !/^vol-[0-9a-f]{8,32}$/u.test(device.nvmeSerialVolumeId)
  ) {
    throw new TypeError(
      `${valuePath}.nvmeSerialVolumeId must be a canonical EBS volume ID.`,
    );
  }
  return Object.freeze({
    nvmeModel: device.nvmeModel,
    nvmeSerialVolumeId: device.nvmeSerialVolumeId,
    path: canonicalNvmeDevicePath(device.path, `${valuePath}.path`),
    major: positiveSafeInteger(device.major, `${valuePath}.major`),
    minor: nonnegativeSafeInteger(device.minor, `${valuePath}.minor`),
  });
}

/** @param {Readonly<Record<string, any>>} evidence @param {Readonly<Record<string, any>>} expected @param {Readonly<Record<string, any>>} device @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function canonicalEvidence(evidence, expected, device, valuePath) {
  const filesystem = exactPlainObject(
    evidence.filesystem,
    `${valuePath}.filesystem`,
  );
  assertExactKeys(filesystem, FILESYSTEM_KEYS, `${valuePath}.filesystem`);
  const mount = exactPlainObject(evidence.mount, `${valuePath}.mount`);
  assertExactKeys(mount, EVIDENCE_MOUNT_KEYS, `${valuePath}.mount`);
  const bootWiring = exactPlainObject(
    evidence.bootWiring,
    `${valuePath}.bootWiring`,
  );
  assertExactKeys(bootWiring, BOOT_WIRING_KEYS, `${valuePath}.bootWiring`);
  const candidate = deepFreeze(
    sortCanonicalJsonValue({
      ...expected,
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
      kind: evidence.kind,
      device,
      mount: {
        ...expected.mount,
        sourcePath: device.path,
        mounted: true,
      },
    }),
  );
  if (!sameJson(evidence, candidate)) {
    throw new AwsSingleNodeHostRetainedStorageConflictError(
      'settled-evidence-mismatch',
    );
  }
  assertManifestIsSecretFree(candidate, valuePath);
  return candidate;
}

/**
 * Validate role-specific evidence against the stable request and V66 frontier.
 * The desired document and settled evidence both bind the fixed host account.
 * @param {unknown} value - Candidate evidence.
 * @param {unknown} context - Exact role-specific V66 context.
 * @param {Readonly<Record<string, string>>} role - Fixed adapter role.
 * @returns {Readonly<Record<string, any>>}
 */
function validateEvidence(value, context, role) {
  const validated = validateContext(context, role);
  const valuePath =
    role === APPLICATION_ROLE
      ? 'awsSingleNodeHostApplicationStorageEvidence'
      : 'awsSingleNodeHostControlStorageEvidence';
  const evidence = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(evidence, EVIDENCE_KEYS, valuePath);
  if (
    evidence.schemaVersion !==
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION
  ) {
    throw new TypeError(`${valuePath}.schemaVersion must be the integer 1.`);
  }
  if (evidence.kind !== role.evidenceKind) {
    throw new TypeError(`${valuePath}.kind must be '${role.evidenceKind}'.`);
  }
  validateDirectory(evidence.directory, `${valuePath}.directory`);
  const device = validateDevice(evidence.device, `${valuePath}.device`);
  const expected = createDesired(validated.request, role);
  const canonical = canonicalEvidence(evidence, expected, device, valuePath);
  if (
    canonical.device.nvmeSerialVolumeId !== canonical.volumeProviderResourceId
  ) {
    throw new AwsSingleNodeHostRetainedStorageConflictError(
      'nvme-volume-identity-mismatch',
    );
  }
  if (role === CONTROL_ROLE) {
    const application = validated.applicationEvidence;
    if (
      application === null ||
      application.volumeProviderResourceId ===
        canonical.volumeProviderResourceId ||
      application.filesystem.uuid === canonical.filesystem.uuid ||
      application.mount.target === canonical.mount.target
    ) {
      throw new AwsSingleNodeHostRetainedStorageConflictError(
        'cross-role-stable-alias',
      );
    }
    if (
      application.directory.uid !== canonical.directory.uid ||
      application.directory.gid !== canonical.directory.gid
    ) {
      throw new AwsSingleNodeHostRetainedStorageConflictError(
        'cross-role-runtime-account-mismatch',
      );
    }
    if (
      application.device.path === canonical.device.path ||
      (application.device.major === canonical.device.major &&
        application.device.minor === canonical.device.minor)
    ) {
      throw new AwsSingleNodeHostRetainedStorageConflictError(
        'cross-role-device-alias',
      );
    }
  }
  return canonical;
}

/**
 * Validate application-storage evidence against its exact request and runtime
 * identity frontier.
 * @param {unknown} value - Candidate settled evidence.
 * @param {unknown} context - Exact V66 application-storage context.
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodeHostApplicationStorageEvidence(
  value,
  context,
) {
  return validateEvidence(value, context, APPLICATION_ROLE);
}

/**
 * Validate control-storage evidence against its runtime plus independently
 * revalidated application-storage frontier.
 * @param {unknown} value - Candidate settled evidence.
 * @param {unknown} context - Exact V66 control-storage context.
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsSingleNodeHostControlStorageEvidence(
  value,
  context,
) {
  return validateEvidence(value, context, CONTROL_ROLE);
}

/** @param {unknown} value @param {Function} validateFactoryEvidence @returns {Readonly<Record<string, any>>} */
function normalizeCommandResult(value, validateFactoryEvidence) {
  const result = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_COMMAND_RESULT_MAX_BYTES,
    'awsSingleNodeHostRetainedStorage command result',
  );
  const resultObject = exactPlainObject(
    result,
    'awsSingleNodeHostRetainedStorage command result',
  );
  if (!OBSERVATION_STATUSES.has(resultObject.status)) {
    throw new TypeError(
      'awsSingleNodeHostRetainedStorage command result.status is not supported.',
    );
  }
  if (resultObject.status !== 'settled') {
    assertExactKeys(
      resultObject,
      STATUS_ONLY_KEYS,
      'awsSingleNodeHostRetainedStorage command result',
    );
    return Object.freeze({ status: resultObject.status });
  }
  assertExactKeys(
    resultObject,
    SETTLED_RESULT_KEYS,
    'awsSingleNodeHostRetainedStorage command result',
  );
  return deepFreeze({
    status: 'settled',
    evidence: validateFactoryEvidence(resultObject.evidence),
  });
}

/** @param {unknown} optionsValue @param {Readonly<Record<string, string>>} role @returns {Readonly<Record<string, any>>} */
function createAdapter(optionsValue, role) {
  const valuePath =
    role === APPLICATION_ROLE
      ? 'awsSingleNodeHostApplicationStorage options'
      : 'awsSingleNodeHostControlStorage options';
  const options = exactPlainObject(optionsValue, valuePath);
  assertExactKeys(options, FACTORY_KEYS, valuePath);
  const command = exactPlainObject(
    ownDataValue(options, 'command', valuePath),
    `${valuePath}.command`,
  );
  assertExactKeys(command, COMMAND_KEYS, `${valuePath}.command`);
  const inspect = ownDataFunction(
    command,
    'inspect',
    `${valuePath}.command`,
  ).bind(command);
  const converge = ownDataFunction(
    command,
    'converge',
    `${valuePath}.command`,
  ).bind(command);

  /** @param {unknown} context @returns {Readonly<{validated: Readonly<Record<string, any>>, desired: Readonly<Record<string, any>>}>} */
  function operation(context) {
    const validated = validateContext(context, role);
    assertBoundApplicationAccount(validated);
    return Object.freeze({
      validated,
      desired: createDesired(validated.request, role),
    });
  }

  /** @param {Readonly<Record<string, any>>} validated @returns {void} */
  function assertBoundApplicationAccount(validated) {
    if (
      validated.applicationEvidence !== null &&
      (validated.applicationEvidence.directory.uid !==
        AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID ||
        validated.applicationEvidence.directory.gid !==
          AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID)
    ) {
      throw new AwsSingleNodeHostRetainedStorageConflictError(
        'cross-role-runtime-account-mismatch',
      );
    }
  }

  /** @param {unknown} evidence @param {unknown} context @returns {Readonly<Record<string, any>>} */
  function validateFactoryEvidence(evidence, context) {
    assertBoundApplicationAccount(validateContext(context, role));
    const canonical = validateEvidence(evidence, context, role);
    if (
      canonical.directory.uid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID ||
      canonical.directory.gid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID
    ) {
      throw new AwsSingleNodeHostRetainedStorageConflictError(
        'runtime-account-mismatch',
      );
    }
    return canonical;
  }

  return Object.freeze({
    /** @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
    async observe(context) {
      const { desired } = operation(context);
      let result;
      try {
        result = await inspect(desired);
      } catch {
        return Object.freeze({ status: 'unknown' });
      }
      try {
        return normalizeCommandResult(
          result,
          (/** @type {unknown} */ evidence) =>
            validateFactoryEvidence(evidence, context),
        );
      } catch (error) {
        return Object.freeze({
          status:
            error instanceof AwsSingleNodeHostRetainedStorageConflictError
              ? 'conflict'
              : 'unknown',
        });
      }
    },

    /** @param {unknown} context @returns {Promise<void>} */
    async converge(context) {
      const { validated, desired } = operation(context);
      const attemptGeneration = positiveSafeInteger(
        validated.attemptGeneration,
        `${valuePath} context.step.attemptGeneration`,
      );
      await converge(
        deepFreeze({
          desired,
          intentId: validated.intentId,
          attemptGeneration,
        }),
      );
    },

    /** @param {unknown} value @param {unknown} context @returns {Readonly<Record<string, any>>} */
    validateEvidence(value, context) {
      operation(context);
      return validateFactoryEvidence(value, context);
    },
  });
}

/**
 * Create the application-state V66 adapter. The role is fixed by this public
 * factory and cannot be supplied or changed by its caller.
 * @param {unknown} options - Exact command port.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeHostApplicationStorageAdapter(options) {
  return createAdapter(options, APPLICATION_ROLE);
}

/**
 * Create the control-state V66 adapter. It revalidates and excludes aliases
 * with the settled application-state evidence before accepting settlement.
 * @param {unknown} options - Exact command port.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsSingleNodeHostControlStorageAdapter(options) {
  return createAdapter(options, CONTROL_ROLE);
}

export default createAwsSingleNodeHostApplicationStorageAdapter;
