/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description, jsdoc/tag-lines -- This pure durable-media contract keeps its exact schemas and transition rules together. */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
  createDomainSeparatedSha256Id,
} from './content-id.js';
import { AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX } from './deployment-aws-host-agent-contract.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
} from './deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
  AWS_SINGLE_NODE_HOST_RETAINED_FILESYSTEM_UUID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  validateAwsSingleNodeHostRetainedStorageDesired,
} from './deployment-aws-host-retained-storage.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from './deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
} from './deployment-aws-host-runtime-account.js';
import {
  assertDeploymentInstanceId,
  PROVIDER_SCOPE_ID_PREFIX,
} from './deployment-provider-scope.js';
import { assertDeploymentIncarnationId } from './deployment-resource-binding.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_KIND =
  'awsSingleNodeHostRetainedStorageFormatTarget';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_DOMAIN =
  'wharfie:aws-single-node-host-retained-storage-format-target:v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_PREFIX =
  'whft1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_MAX_BYTES =
  8 * 1024;

export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_KIND =
  'awsSingleNodeHostRetainedStorageBlankFormatProof';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_DOMAIN =
  'wharfie:aws-single-node-host-retained-storage-blank-format-proof:v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX =
  'whfb1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_KIND =
  'awsSingleNodeHostRetainedStorageExactProfileFormatProof';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_DOMAIN =
  'wharfie:aws-single-node-host-retained-storage-exact-profile-format-proof:v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX =
  'whfe1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES =
  16 * 1024;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_DOMAIN =
  'wharfie:aws-single-node-host-retained-storage-profile-marker:v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_PREFIX =
  'whpm1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL = 'wharfie-v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES =
  Object.freeze([
    '64bit',
    'dir_index',
    'dir_nlink',
    'ext_attr',
    'extent',
    'extra_isize',
    'filetype',
    'flex_bg',
    'has_journal',
    'huge_file',
    'large_file',
    'metadata_csum',
    'sparse_super',
  ]);

export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION = 1;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND =
  'awsSingleNodeHostRetainedStorageFormatJournal';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_DOMAIN =
  'wharfie:aws-single-node-host-retained-storage-format-journal:v1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX =
  'whfj1';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_MAX_BYTES =
  32 * 1024;

const TARGET_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
  'appId',
  'capabilityKind',
  'volumeProviderResourceId',
  'sizeBytes',
  'createdWithoutSnapshot',
  'filesystem',
]);
const TARGET_DOCUMENT_KEYS = new Set(['targetId', ...TARGET_PAYLOAD_KEYS]);
const FILESYSTEM_KEYS = new Set(['type', 'uuid', 'profileId']);
const FORMAT_PROOF_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'targetId',
  'classification',
  'device',
  'safety',
  'profile',
]);
const FORMAT_PROOF_DOCUMENT_KEYS = new Set([
  'proofId',
  ...FORMAT_PROOF_PAYLOAD_KEYS,
]);
const PROOF_DEVICE_KEYS = new Set([
  'path',
  'major',
  'minor',
  'nvmeModel',
  'nvmeSerialVolumeId',
  'byIdPath',
  'byIdTarget',
]);
const PROOF_SAFETY_KEYS = new Set([
  'stableObservationCount',
  'partitionCount',
  'holderCount',
  'mounted',
  'bootEnabled',
  'mountNamespace',
]);
const BLANK_PROOF_CREATE_KEYS = new Set([
  'desired',
  'device',
  'mountNamespace',
]);
const PROFILE_PROOF_CREATE_KEYS = new Set([
  ...BLANK_PROOF_CREATE_KEYS,
  'profile',
]);
const PROFILE_KEYS = new Set([
  'profileId',
  'markerId',
  'filesystem',
  'journal',
  'root',
  'initialization',
]);
const PROFILE_FILESYSTEM_KEYS = new Set([
  'type',
  'uuid',
  'label',
  'blockSizeBytes',
  'inodeSizeBytes',
  'reservedBlockCount',
  'creatorOs',
  'revision',
  'errorsBehavior',
  'defaultMountOptions',
  'directoryHashAlgorithm',
  'directoryHashSeed',
  'features',
]);
const PROFILE_JOURNAL_KEYS = new Set(['kind', 'inode', 'sizeBytes']);
const PROFILE_ROOT_KEYS = new Set(['inode', 'type', 'uid', 'gid', 'mode']);
const PROFILE_INITIALIZATION_KEYS = new Set([
  'filesystemState',
  'fullReadOnlyCheck',
  'completionMarkerXattr',
]);
const ATTEMPT_KEYS = new Set(['requestId', 'intentId', 'attemptGeneration']);
const PREPARED_CREATE_KEYS = new Set([
  'desired',
  'intentId',
  'attemptGeneration',
  'blankProof',
]);
const ADOPTED_CREATE_KEYS = new Set([
  'desired',
  'intentId',
  'attemptGeneration',
  'profileProof',
]);
const ADVANCE_KEYS = new Set(['journal', 'profileProof']);
const JOURNAL_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'recordVersion',
  'previousJournalId',
  'phase',
  'origin',
  'target',
  'attempt',
  'blankProof',
  'profileProof',
]);
const JOURNAL_DOCUMENT_KEYS = new Set(['journalId', ...JOURNAL_PAYLOAD_KEYS]);
const CAPABILITY_KINDS = new Set(['application-state', 'control-state']);
const VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const FILESYSTEM_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const NVME_DEVICE_PATTERN =
  /^\/dev\/nvme(0|[1-9][0-9]{0,9})n([1-9][0-9]{0,9})$/u;
const MOUNT_NAMESPACE_PATTERN = /^mnt:\[([1-9][0-9]{0,19})\]$/u;
const MAX_LINUX_UINT32 = 4_294_967_295n;
const MAX_LINUX_INODE = 18_446_744_073_709_551_615n;

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Apply the same exact encoded-JSON cap used by the public validator after a
 * factory has added its content ID and all enclosing fields.
 *
 * @template T
 * @param {T} value - Complete canonical document.
 * @param {number} maxBytes - Advertised final serialized byte cap.
 * @param {string} valuePath - Safe document label.
 * @returns {T} - The original deeply frozen document.
 */
function assertBoundedFactoryDocument(value, maxBytes, valuePath) {
  cloneBoundedJsonObject(value, maxBytes, valuePath);
  return value;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} valuePath @returns {void} */
function assertExactKeys(value, keys, valuePath) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${valuePath} must contain only its exact fields.`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(`${valuePath}.${key} must be an own data property.`);
    }
  }
}

/** @param {unknown} value @param {Set<string>} keys @param {string} valuePath @returns {Record<string, any>} */
function exactDataObject(value, keys, valuePath) {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${valuePath} must be one exact object.`);
  }
  const object = /** @type {Record<string, any>} */ (value);
  assertExactKeys(object, keys, valuePath);
  return object;
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function positiveSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${valuePath} must be a positive safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} value @param {string} valuePath @returns {number} */
function nonnegativeSafeInteger(value, valuePath) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Independently derive the UUIDv8 carried by a context-free journal target.
 * This deliberately mirrors the public desired contract's stable authority
 * projection instead of trusting UUID syntax or a caller-provided desired
 * document.
 *
 * @param {Readonly<Record<string, any>>} authority - Stable media authority.
 * @returns {string} - Lowercase RFC-variant UUIDv8.
 */
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

/** @param {Readonly<Record<string, any>>} payload @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function createTargetDocument(payload, valuePath) {
  const canonicalPayload = deepFreeze(sortCanonicalJsonValue(payload));
  const targetId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_PREFIX,
    value: canonicalPayload,
    valuePath,
  });
  return assertBoundedFactoryDocument(
    deepFreeze(sortCanonicalJsonValue({ ...canonicalPayload, targetId })),
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_MAX_BYTES,
    valuePath,
  );
}

/**
 * Project only stable physical-media authority. Request/head/artifact, node,
 * attachment, mount, boot wiring, and host-local UID/GID deliberately remain
 * outside this format-history identity.
 *
 * @param {unknown} desiredValue - Exact retained-storage desired document.
 * @returns {Readonly<Record<string, any>>} - Stable content-addressed target.
 */
export function getAwsSingleNodeHostRetainedStorageFormatTarget(desiredValue) {
  const desired = validateAwsSingleNodeHostRetainedStorageDesired(desiredValue);
  if (
    desired.directory.uid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID ||
    desired.directory.gid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID
  ) {
    throw new TypeError(
      'awsSingleNodeHostRetainedStorageFormatTarget requires the pinned runtime UID and GID.',
    );
  }
  return createTargetDocument(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_KIND,
      providerScopeId: desired.providerScopeId,
      deploymentInstanceId: desired.deploymentInstanceId,
      incarnationId: desired.incarnationId,
      appId: desired.appId,
      capabilityKind: desired.capabilityKind,
      volumeProviderResourceId: desired.volumeProviderResourceId,
      sizeBytes: desired.sizeBytes,
      createdWithoutSnapshot: true,
      filesystem: desired.filesystem,
    },
    'awsSingleNodeHostRetainedStorageFormatTarget',
  );
}

/**
 * Validate one bounded stable format target independently of a volatile
 * activation request.
 *
 * @param {unknown} value - Candidate target.
 * @param {string} [valuePath] - Safe path label.
 * @returns {Readonly<Record<string, any>>} - Canonical target.
 */
export function validateAwsSingleNodeHostRetainedStorageFormatTarget(
  value,
  valuePath = 'awsSingleNodeHostRetainedStorageFormatTarget',
) {
  const target = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(target, TARGET_DOCUMENT_KEYS, valuePath);
  if (
    target.schemaVersion !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_SCHEMA_VERSION ||
    target.kind !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_KIND
  ) {
    throw new TypeError(`${valuePath} uses an unsupported schema.`);
  }
  assertDomainSeparatedSha256Id(
    target.providerScopeId,
    PROVIDER_SCOPE_ID_PREFIX,
    `${valuePath}.providerScopeId`,
  );
  assertDeploymentInstanceId(
    target.deploymentInstanceId,
    `${valuePath}.deploymentInstanceId`,
  );
  assertDeploymentIncarnationId(
    target.incarnationId,
    `${valuePath}.incarnationId`,
  );
  assertLogicalId(target.appId, `${valuePath}.appId`);
  if (!CAPABILITY_KINDS.has(target.capabilityKind)) {
    throw new TypeError(`${valuePath}.capabilityKind is not supported.`);
  }
  if (
    typeof target.volumeProviderResourceId !== 'string' ||
    !VOLUME_ID_PATTERN.test(target.volumeProviderResourceId)
  ) {
    throw new TypeError(
      `${valuePath}.volumeProviderResourceId must be a canonical EBS volume ID.`,
    );
  }
  const sizeBytes = positiveSafeInteger(
    target.sizeBytes,
    `${valuePath}.sizeBytes`,
  );
  if (target.createdWithoutSnapshot !== true) {
    throw new TypeError(
      `${valuePath}.createdWithoutSnapshot must be literal true.`,
    );
  }
  const filesystem = exactDataObject(
    target.filesystem,
    FILESYSTEM_KEYS,
    `${valuePath}.filesystem`,
  );
  if (
    filesystem.type !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE ||
    filesystem.profileId !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID ||
    typeof filesystem.uuid !== 'string' ||
    !FILESYSTEM_UUID_PATTERN.test(filesystem.uuid)
  ) {
    throw new TypeError(
      `${valuePath}.filesystem must name the fixed retained ext4 profile.`,
    );
  }
  const expectedFilesystemUuid = deriveRetainedFilesystemUuid({
    providerScopeId: target.providerScopeId,
    deploymentInstanceId: target.deploymentInstanceId,
    incarnationId: target.incarnationId,
    capabilityKind: target.capabilityKind,
    volumeProviderResourceId: target.volumeProviderResourceId,
  });
  if (filesystem.uuid !== expectedFilesystemUuid) {
    throw new Error(
      `${valuePath}.filesystem.uuid does not match its stable media authority.`,
    );
  }
  const payload = {
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_KIND,
    providerScopeId: target.providerScopeId,
    deploymentInstanceId: target.deploymentInstanceId,
    incarnationId: target.incarnationId,
    appId: target.appId,
    capabilityKind: target.capabilityKind,
    volumeProviderResourceId: target.volumeProviderResourceId,
    sizeBytes,
    createdWithoutSnapshot: true,
    filesystem: {
      type: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
      uuid: expectedFilesystemUuid,
      profileId: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
    },
  };
  assertManifestIsSecretFree(payload, valuePath);
  const expected = createTargetDocument(payload, valuePath);
  assertDomainSeparatedSha256Id(
    target.targetId,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_PREFIX,
    `${valuePath}.targetId`,
  );
  if (target.targetId !== expected.targetId) {
    throw new Error(`${valuePath}.targetId does not match its exact target.`);
  }
  return expected;
}

/** @param {Readonly<Record<string, any>>} payload @param {string} domain @param {string} prefix @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function createProofDocument(payload, domain, prefix, valuePath) {
  const canonicalPayload = deepFreeze(sortCanonicalJsonValue(payload));
  const proofId = createCanonicalJsonSha256Id({
    domain,
    prefix,
    value: canonicalPayload,
    valuePath,
  });
  return assertBoundedFactoryDocument(
    deepFreeze(sortCanonicalJsonValue({ ...canonicalPayload, proofId })),
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
    valuePath,
  );
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} target @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateProofDevice(value, target, valuePath) {
  const device = exactDataObject(value, PROOF_DEVICE_KEYS, valuePath);
  const deviceMatch =
    typeof device.path === 'string'
      ? NVME_DEVICE_PATTERN.exec(device.path)
      : null;
  if (
    deviceMatch === null ||
    BigInt(deviceMatch[1]) > MAX_LINUX_UINT32 ||
    BigInt(deviceMatch[2]) > MAX_LINUX_UINT32 ||
    path.posix.normalize(device.path) !== device.path
  ) {
    throw new TypeError(`${valuePath}.path is not a canonical NVMe device.`);
  }
  const major = positiveSafeInteger(device.major, `${valuePath}.major`);
  const minor = nonnegativeSafeInteger(device.minor, `${valuePath}.minor`);
  if (
    device.nvmeModel !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL ||
    device.nvmeSerialVolumeId !== target.volumeProviderResourceId
  ) {
    throw new Error(`${valuePath} does not match the exact EBS target.`);
  }
  const byIdPath = getAwsSingleNodeHostRetainedStorageByIdPath(
    target.volumeProviderResourceId,
  );
  if (device.byIdPath !== byIdPath) {
    throw new Error(`${valuePath}.byIdPath does not match the EBS target.`);
  }
  const expectedByIdTarget = path.posix.relative(
    path.posix.dirname(byIdPath),
    device.path,
  );
  if (device.byIdTarget !== expectedByIdTarget) {
    throw new TypeError(
      `${valuePath}.byIdTarget must be the exact canonical readlink target for its NVMe device.`,
    );
  }
  return deepFreeze({
    path: device.path,
    major,
    minor,
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: target.volumeProviderResourceId,
    byIdPath,
    byIdTarget: expectedByIdTarget,
  });
}

/**
 * Project the canonical completion-marker xattr text from exact stable media
 * authority. UTF-8 encoding these bytes adds no newline or terminator.
 *
 * @param {unknown} targetValue - Exact stable format target.
 * @returns {string} - Canonical marker text.
 */
export function getAwsSingleNodeHostRetainedStorageProfileMarkerText(
  targetValue,
) {
  const target =
    validateAwsSingleNodeHostRetainedStorageFormatTarget(targetValue);
  return JSON.stringify(
    sortCanonicalJsonValue({
      schemaVersion: 1,
      kind: 'awsSingleNodeHostRetainedStorageProfileMarker',
      filesystemProfileId:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
      filesystemUuid: target.filesystem.uuid,
      formatTargetId: target.targetId,
      runtimeUid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
      runtimeGid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
    }),
  );
}

/**
 * Return fresh exact UTF-8 bytes for the completion-marker xattr.
 *
 * @param {unknown} targetValue - Exact stable format target.
 * @returns {Buffer} - Marker bytes without newline or NUL terminator.
 */
export function getAwsSingleNodeHostRetainedStorageProfileMarkerBytes(
  targetValue,
) {
  return Buffer.from(
    getAwsSingleNodeHostRetainedStorageProfileMarkerText(targetValue),
    'utf8',
  );
}

/**
 * Address the exact completion-marker xattr bytes in their own semantic
 * domain.
 *
 * @param {unknown} targetValue - Exact stable format target.
 * @returns {string} - Content-addressed marker ID.
 */
export function getAwsSingleNodeHostRetainedStorageProfileMarkerId(
  targetValue,
) {
  const markerBytes =
    getAwsSingleNodeHostRetainedStorageProfileMarkerBytes(targetValue);
  return createDomainSeparatedSha256Id({
    domain: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_PREFIX,
    payload: markerBytes,
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} target @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateExactProfile(value, target, valuePath) {
  const profile = exactDataObject(value, PROFILE_KEYS, valuePath);
  if (
    profile.profileId !==
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID
  ) {
    throw new TypeError(`${valuePath}.profileId is not supported.`);
  }
  assertDomainSeparatedSha256Id(
    profile.markerId,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_PREFIX,
    `${valuePath}.markerId`,
  );
  const expectedMarkerId =
    getAwsSingleNodeHostRetainedStorageProfileMarkerId(target);
  if (profile.markerId !== expectedMarkerId) {
    throw new Error(`${valuePath}.markerId does not match its exact marker.`);
  }

  const filesystem = exactDataObject(
    profile.filesystem,
    PROFILE_FILESYSTEM_KEYS,
    `${valuePath}.filesystem`,
  );
  if (
    filesystem.type !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE ||
    filesystem.uuid !== target.filesystem.uuid ||
    filesystem.label !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL ||
    filesystem.blockSizeBytes !== 4096 ||
    filesystem.inodeSizeBytes !== 256 ||
    filesystem.reservedBlockCount !== 0 ||
    filesystem.creatorOs !== 'Linux' ||
    filesystem.revision !== 'dynamic' ||
    filesystem.errorsBehavior !== 'remount-ro' ||
    !Array.isArray(filesystem.defaultMountOptions) ||
    filesystem.defaultMountOptions.length !== 0 ||
    filesystem.directoryHashAlgorithm !== 'half_md4' ||
    filesystem.directoryHashSeed !== target.filesystem.uuid ||
    !Array.isArray(filesystem.features) ||
    filesystem.features.length !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES.length ||
    filesystem.features.some(
      (feature, index) =>
        feature !==
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES[index],
    )
  ) {
    throw new TypeError(
      `${valuePath}.filesystem does not match the exact retained ext4 profile.`,
    );
  }

  const journal = exactDataObject(
    profile.journal,
    PROFILE_JOURNAL_KEYS,
    `${valuePath}.journal`,
  );
  if (
    journal.kind !== 'internal' ||
    journal.inode !== 8 ||
    journal.sizeBytes !== 134_217_728
  ) {
    throw new TypeError(
      `${valuePath}.journal does not match the exact internal journal.`,
    );
  }

  const root = exactDataObject(
    profile.root,
    PROFILE_ROOT_KEYS,
    `${valuePath}.root`,
  );
  if (
    root.inode !== 2 ||
    root.type !== 'directory' ||
    root.uid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID ||
    root.gid !== AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID ||
    root.mode !== 0o700
  ) {
    throw new TypeError(
      `${valuePath}.root does not match the exact runtime-owned root inode.`,
    );
  }

  const initialization = exactDataObject(
    profile.initialization,
    PROFILE_INITIALIZATION_KEYS,
    `${valuePath}.initialization`,
  );
  if (
    initialization.filesystemState !== 'clean' ||
    initialization.fullReadOnlyCheck !== 'clean' ||
    initialization.completionMarkerXattr !== 'trusted.wharfie.profile'
  ) {
    throw new TypeError(
      `${valuePath}.initialization does not prove the exact completed offline profile.`,
    );
  }

  const canonical = deepFreeze(
    sortCanonicalJsonValue({
      profileId: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_PROFILE_ID,
      markerId: expectedMarkerId,
      filesystem: {
        type: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
        uuid: target.filesystem.uuid,
        label: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL,
        blockSizeBytes: 4096,
        inodeSizeBytes: 256,
        reservedBlockCount: 0,
        creatorOs: 'Linux',
        revision: 'dynamic',
        errorsBehavior: 'remount-ro',
        defaultMountOptions: [],
        directoryHashAlgorithm: 'half_md4',
        directoryHashSeed: target.filesystem.uuid,
        features: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES,
      },
      journal: {
        kind: 'internal',
        inode: 8,
        sizeBytes: 134_217_728,
      },
      root: {
        inode: 2,
        type: 'directory',
        uid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
        gid: AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
        mode: 0o700,
      },
      initialization: {
        filesystemState: 'clean',
        fullReadOnlyCheck: 'clean',
        completionMarkerXattr: 'trusted.wharfie.profile',
      },
    }),
  );
  assertManifestIsSecretFree(canonical, valuePath);
  return canonical;
}

/** @param {unknown} value @param {string} valuePath @returns {string} */
function validateMountNamespace(value, valuePath) {
  if (typeof value !== 'string') {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  const match = MOUNT_NAMESPACE_PATTERN.exec(value);
  if (match === null || BigInt(match[1]) > MAX_LINUX_INODE) {
    throw new TypeError(`${valuePath} is invalid.`);
  }
  return value;
}

/** @param {string} mountNamespace @returns {Readonly<Record<string, any>>} */
function createSafety(mountNamespace) {
  return deepFreeze({
    stableObservationCount: 2,
    partitionCount: 0,
    holderCount: 0,
    mounted: false,
    bootEnabled: false,
    mountNamespace,
  });
}

/** @param {unknown} value @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateSafety(value, valuePath) {
  const safety = exactDataObject(value, PROOF_SAFETY_KEYS, valuePath);
  if (
    safety.stableObservationCount !== 2 ||
    safety.partitionCount !== 0 ||
    safety.holderCount !== 0 ||
    safety.mounted !== false ||
    safety.bootEnabled !== false
  ) {
    throw new TypeError(
      `${valuePath} must describe two stable, offline, unwired observations.`,
    );
  }
  return createSafety(
    validateMountNamespace(
      safety.mountNamespace,
      `${valuePath}.mountNamespace`,
    ),
  );
}

/**
 * Create the normalized blank-media assertion emitted after two identical
 * closed-host observations.
 *
 * The proof ID provides integrity and historical correlation only. It is not
 * host provenance, controller authorization, or permission to run a
 * formatter. The mutator must still hold the deployment lock, reauthorize the
 * current request, and immediately reobserve the exact physical media.
 *
 * @param {unknown} value - Exact desired state, device, and mount namespace.
 * @returns {Readonly<Record<string, any>>} - Blank proof.
 */
export function createAwsSingleNodeHostRetainedStorageBlankFormatProof(value) {
  const input = exactDataObject(
    value,
    BLANK_PROOF_CREATE_KEYS,
    'awsSingleNodeHostRetainedStorageBlankFormatProof input',
  );
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(input.desired);
  const mountNamespace = validateMountNamespace(
    input.mountNamespace,
    'awsSingleNodeHostRetainedStorageBlankFormatProof input.mountNamespace',
  );
  const device = validateProofDevice(
    cloneBoundedJsonObject(
      input.device,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
      'awsSingleNodeHostRetainedStorageBlankFormatProof input.device',
    ),
    target,
    'awsSingleNodeHostRetainedStorageBlankFormatProof input.device',
  );
  return createProofDocument(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_KIND,
      targetId: target.targetId,
      classification: 'blank',
      device,
      safety: createSafety(mountNamespace),
      profile: null,
    },
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_DOMAIN,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX,
    'awsSingleNodeHostRetainedStorageBlankFormatProof',
  );
}

/**
 * Create a normalized exact-profile assertion from a complete semantic
 * projection produced by the future closed offline verifier. A bare
 * `exact-profile` label cannot construct this proof.
 *
 * Like the blank proof, its ID authenticates exact historical bytes, not the
 * observer, current controller authority, or live physical state.
 *
 * @param {unknown} value - Exact desired, device, namespace, and profile.
 * @returns {Readonly<Record<string, any>>} - Exact-profile proof.
 */
export function createAwsSingleNodeHostRetainedStorageExactProfileFormatProof(
  value,
) {
  const input = exactDataObject(
    value,
    PROFILE_PROOF_CREATE_KEYS,
    'awsSingleNodeHostRetainedStorageExactProfileFormatProof input',
  );
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(input.desired);
  const mountNamespace = validateMountNamespace(
    input.mountNamespace,
    'awsSingleNodeHostRetainedStorageExactProfileFormatProof input.mountNamespace',
  );
  const device = validateProofDevice(
    cloneBoundedJsonObject(
      input.device,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
      'awsSingleNodeHostRetainedStorageExactProfileFormatProof input.device',
    ),
    target,
    'awsSingleNodeHostRetainedStorageExactProfileFormatProof input.device',
  );
  const profile = validateExactProfile(
    cloneBoundedJsonObject(
      input.profile,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
      'awsSingleNodeHostRetainedStorageExactProfileFormatProof input.profile',
    ),
    target,
    'awsSingleNodeHostRetainedStorageExactProfileFormatProof input.profile',
  );
  return createProofDocument(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_KIND,
      targetId: target.targetId,
      classification: 'exact-profile',
      device,
      safety: createSafety(mountNamespace),
      profile,
    },
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_DOMAIN,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX,
    'awsSingleNodeHostRetainedStorageExactProfileFormatProof',
  );
}

/**
 * Validate a blank-media proof. This checks exact claimed history, not the
 * provenance of the closed observer that must eventually emit it.
 *
 * @param {unknown} value - Candidate blank proof.
 * @param {unknown} targetValue - Exact stable target.
 * @param {string} [valuePath] - Safe path label.
 * @returns {Readonly<Record<string, any>>} - Canonical blank proof.
 */
export function validateAwsSingleNodeHostRetainedStorageBlankFormatProof(
  value,
  targetValue,
  valuePath = 'awsSingleNodeHostRetainedStorageBlankFormatProof',
) {
  const target =
    validateAwsSingleNodeHostRetainedStorageFormatTarget(targetValue);
  const proof = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(proof, FORMAT_PROOF_DOCUMENT_KEYS, valuePath);
  if (
    proof.schemaVersion !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_SCHEMA_VERSION ||
    proof.kind !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_KIND ||
    proof.classification !== 'blank' ||
    proof.profile !== null
  ) {
    throw new TypeError(`${valuePath} is not a blank-media proof.`);
  }
  if (proof.targetId !== target.targetId) {
    throw new Error(`${valuePath}.targetId does not match its format target.`);
  }
  const device = validateProofDevice(
    proof.device,
    target,
    `${valuePath}.device`,
  );
  const safety = validateSafety(proof.safety, `${valuePath}.safety`);
  const payload = {
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_KIND,
    targetId: target.targetId,
    classification: 'blank',
    device,
    safety,
    profile: null,
  };
  assertManifestIsSecretFree(payload, valuePath);
  const expected = createProofDocument(
    payload,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_DOMAIN,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX,
    valuePath,
  );
  assertDomainSeparatedSha256Id(
    proof.proofId,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX,
    `${valuePath}.proofId`,
  );
  if (proof.proofId !== expected.proofId) {
    throw new Error(`${valuePath}.proofId does not match its exact proof.`);
  }
  return expected;
}

/**
 * Validate the complete exact-profile proof. This checks every semantic
 * profile literal and recomputes its completion marker and proof IDs.
 *
 * @param {unknown} value - Candidate profile proof.
 * @param {unknown} targetValue - Exact stable target.
 * @param {string} [valuePath] - Safe path label.
 * @returns {Readonly<Record<string, any>>} - Canonical profile proof.
 */
export function validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof(
  value,
  targetValue,
  valuePath = 'awsSingleNodeHostRetainedStorageExactProfileFormatProof',
) {
  const target =
    validateAwsSingleNodeHostRetainedStorageFormatTarget(targetValue);
  const proof = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(proof, FORMAT_PROOF_DOCUMENT_KEYS, valuePath);
  if (
    proof.schemaVersion !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_SCHEMA_VERSION ||
    proof.kind !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_KIND ||
    proof.classification !== 'exact-profile' ||
    proof.profile === null
  ) {
    throw new TypeError(`${valuePath} is not an exact-profile proof.`);
  }
  if (proof.targetId !== target.targetId) {
    throw new Error(`${valuePath}.targetId does not match its format target.`);
  }
  const device = validateProofDevice(
    proof.device,
    target,
    `${valuePath}.device`,
  );
  const safety = validateSafety(proof.safety, `${valuePath}.safety`);
  const profile = validateExactProfile(
    proof.profile,
    target,
    `${valuePath}.profile`,
  );
  const payload = {
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_KIND,
    targetId: target.targetId,
    classification: 'exact-profile',
    device,
    safety,
    profile,
  };
  assertManifestIsSecretFree(payload, valuePath);
  const expected = createProofDocument(
    payload,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_DOMAIN,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX,
    valuePath,
  );
  assertDomainSeparatedSha256Id(
    proof.proofId,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX,
    `${valuePath}.proofId`,
  );
  if (proof.proofId !== expected.proofId) {
    throw new Error(`${valuePath}.proofId does not match its exact proof.`);
  }
  return expected;
}

/** @param {string} capabilityKind @returns {'application-storage'|'control-storage'} */
function storageStepKindForCapability(capabilityKind) {
  if (capabilityKind === 'application-state') return 'application-storage';
  if (capabilityKind === 'control-state') return 'control-storage';
  throw new TypeError(
    'awsSingleNodeHostRetainedStorageFormatJournal target role is invalid.',
  );
}

/** @param {unknown} requestId @param {unknown} intentId @param {unknown} attemptGeneration @param {Readonly<Record<string, any>>} target @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function createAttempt(
  requestId,
  intentId,
  attemptGeneration,
  target,
  valuePath,
) {
  assertDomainSeparatedSha256Id(
    requestId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_REQUEST_ID_PREFIX,
    `${valuePath}.requestId`,
  );
  assertDomainSeparatedSha256Id(
    intentId,
    AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
    `${valuePath}.intentId`,
  );
  const expectedIntentId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_ACTIVATION_INTENT_ID_PREFIX,
    value: {
      requestId,
      kind: storageStepKindForCapability(target.capabilityKind),
    },
    valuePath: `${valuePath}.intent`,
  });
  if (intentId !== expectedIntentId) {
    throw new Error(
      `${valuePath}.intentId does not match its exact request and retained-storage role.`,
    );
  }
  return deepFreeze({
    requestId,
    intentId,
    attemptGeneration: nonnegativeSafeInteger(
      attemptGeneration,
      `${valuePath}.attemptGeneration`,
    ),
  });
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} target @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function validateAttempt(value, target, valuePath) {
  const attempt = exactDataObject(value, ATTEMPT_KEYS, valuePath);
  return createAttempt(
    attempt.requestId,
    attempt.intentId,
    attempt.attemptGeneration,
    target,
    valuePath,
  );
}

/** @param {Readonly<Record<string, any>>} payload @param {string} valuePath @returns {Readonly<Record<string, any>>} */
function createJournalDocument(payload, valuePath) {
  const canonicalPayload = deepFreeze(sortCanonicalJsonValue(payload));
  assertManifestIsSecretFree(canonicalPayload, valuePath);
  const journalId = createCanonicalJsonSha256Id({
    domain: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_DOMAIN,
    prefix: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX,
    value: canonicalPayload,
    valuePath,
  });
  return assertBoundedFactoryDocument(
    deepFreeze(sortCanonicalJsonValue({ ...canonicalPayload, journalId })),
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_MAX_BYTES,
    valuePath,
  );
}

/**
 * Persistable phase-one journal created only after stable blank-media proof.
 * This is the durable prerequisite for any future destructive formatter.
 *
 * @param {unknown} value - Exact desired, attempt, and blank proof.
 * @returns {Readonly<Record<string, any>>} - Prepared journal.
 */
export function createAwsSingleNodeHostRetainedStoragePreparedFormatJournal(
  value,
) {
  const input = exactDataObject(
    value,
    PREPARED_CREATE_KEYS,
    'awsSingleNodeHostRetainedStoragePreparedFormatJournal input',
  );
  const desired = validateAwsSingleNodeHostRetainedStorageDesired(
    input.desired,
  );
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
  const blankProof = validateAwsSingleNodeHostRetainedStorageBlankFormatProof(
    input.blankProof,
    target,
  );
  return createJournalDocument(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND,
      recordVersion: 1,
      previousJournalId: null,
      phase: 'prepared',
      origin: 'blank-format',
      target,
      attempt: createAttempt(
        desired.requestId,
        input.intentId,
        input.attemptGeneration,
        target,
        'awsSingleNodeHostRetainedStoragePreparedFormatJournal attempt',
      ),
      blankProof,
      profileProof: null,
    },
    'awsSingleNodeHostRetainedStorageFormatJournal',
  );
}

/**
 * Persistable non-destructive adoption journal created only after a closed
 * offline verifier has proved the complete pinned filesystem profile.
 *
 * @param {unknown} value - Exact desired, attempt, and profile proof.
 * @returns {Readonly<Record<string, any>>} - Direct formatted journal.
 */
export function createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal(
  value,
) {
  const input = exactDataObject(
    value,
    ADOPTED_CREATE_KEYS,
    'awsSingleNodeHostRetainedStorageAdoptedFormatJournal input',
  );
  const desired = validateAwsSingleNodeHostRetainedStorageDesired(
    input.desired,
  );
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desired);
  const profileProof =
    validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof(
      input.profileProof,
      target,
    );
  return createJournalDocument(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND,
      recordVersion: 1,
      previousJournalId: null,
      phase: 'formatted',
      origin: 'adopted-profile',
      target,
      attempt: createAttempt(
        desired.requestId,
        input.intentId,
        input.attemptGeneration,
        target,
        'awsSingleNodeHostRetainedStorageAdoptedFormatJournal attempt',
      ),
      blankProof: null,
      profileProof,
    },
    'awsSingleNodeHostRetainedStorageFormatJournal',
  );
}

/**
 * Advance the one legal destructive path from its durable blank proof to a
 * terminal formatted marker while retaining all original history unchanged.
 *
 * @param {unknown} value - Exact prepared journal and profile proof.
 * @returns {Readonly<Record<string, any>>} - Formatted successor.
 */
export function advanceAwsSingleNodeHostRetainedStorageFormatJournal(value) {
  const input = exactDataObject(
    value,
    ADVANCE_KEYS,
    'advanceAwsSingleNodeHostRetainedStorageFormatJournal input',
  );
  const journal = validateAwsSingleNodeHostRetainedStorageFormatJournal(
    input.journal,
  );
  if (journal.phase !== 'prepared') {
    throw new TypeError(
      'Only a prepared retained-storage format journal can advance.',
    );
  }
  const profileProof =
    validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof(
      input.profileProof,
      journal.target,
    );
  return createJournalDocument(
    {
      schemaVersion:
        AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND,
      recordVersion: 2,
      previousJournalId: journal.journalId,
      phase: 'formatted',
      origin: 'blank-format',
      target: journal.target,
      attempt: journal.attempt,
      blankProof: journal.blankProof,
      profileProof,
    },
    'awsSingleNodeHostRetainedStorageFormatJournal',
  );
}

/**
 * Validate the three and only three durable journal shapes:
 * prepared-from-blank v1, formatted-from-blank v2, or adopted-profile v1.
 *
 * Content IDs authenticate exact history bytes, not their writer. Root-owned
 * storage, current controller authority, the deployment host lock, and live
 * physical re-observation remain separate mandatory trust boundaries.
 *
 * @param {unknown} value - Candidate journal.
 * @param {string} [valuePath] - Safe path label.
 * @returns {Readonly<Record<string, any>>} - Canonical journal.
 */
export function validateAwsSingleNodeHostRetainedStorageFormatJournal(
  value,
  valuePath = 'awsSingleNodeHostRetainedStorageFormatJournal',
) {
  const journal = cloneBoundedJsonObject(
    value,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_MAX_BYTES,
    valuePath,
  );
  assertExactKeys(journal, JOURNAL_DOCUMENT_KEYS, valuePath);
  if (
    journal.schemaVersion !==
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION ||
    journal.kind !== AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND
  ) {
    throw new TypeError(`${valuePath} uses an unsupported schema.`);
  }
  const target = validateAwsSingleNodeHostRetainedStorageFormatTarget(
    journal.target,
    `${valuePath}.target`,
  );
  const attempt = validateAttempt(
    journal.attempt,
    target,
    `${valuePath}.attempt`,
  );
  if (journal.previousJournalId !== null) {
    assertDomainSeparatedSha256Id(
      journal.previousJournalId,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX,
      `${valuePath}.previousJournalId`,
    );
  }
  const blankProof =
    journal.blankProof === null
      ? null
      : validateAwsSingleNodeHostRetainedStorageBlankFormatProof(
          journal.blankProof,
          target,
          `${valuePath}.blankProof`,
        );
  const profileProof =
    journal.profileProof === null
      ? null
      : validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof(
          journal.profileProof,
          target,
          `${valuePath}.profileProof`,
        );
  const prepared =
    journal.recordVersion === 1 &&
    journal.previousJournalId === null &&
    journal.phase === 'prepared' &&
    journal.origin === 'blank-format' &&
    blankProof?.classification === 'blank' &&
    profileProof === null;
  const formattedFromBlank =
    journal.recordVersion === 2 &&
    journal.previousJournalId !== null &&
    journal.phase === 'formatted' &&
    journal.origin === 'blank-format' &&
    blankProof?.classification === 'blank' &&
    profileProof?.classification === 'exact-profile';
  const adoptedProfile =
    journal.recordVersion === 1 &&
    journal.previousJournalId === null &&
    journal.phase === 'formatted' &&
    journal.origin === 'adopted-profile' &&
    blankProof === null &&
    profileProof?.classification === 'exact-profile';
  if (!prepared && !formattedFromBlank && !adoptedProfile) {
    throw new TypeError(`${valuePath} is not one allowed journal state.`);
  }
  if (formattedFromBlank) {
    const predecessor = createJournalDocument(
      {
        schemaVersion:
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION,
        kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND,
        recordVersion: 1,
        previousJournalId: null,
        phase: 'prepared',
        origin: 'blank-format',
        target,
        attempt,
        blankProof,
        profileProof: null,
      },
      `${valuePath}.previous`,
    );
    if (journal.previousJournalId !== predecessor.journalId) {
      throw new Error(
        `${valuePath}.previousJournalId does not match its exact prepared predecessor.`,
      );
    }
  }
  const payload = {
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND,
    recordVersion: journal.recordVersion,
    previousJournalId: journal.previousJournalId,
    phase: journal.phase,
    origin: journal.origin,
    target,
    attempt,
    blankProof,
    profileProof,
  };
  const expected = createJournalDocument(payload, valuePath);
  assertDomainSeparatedSha256Id(
    journal.journalId,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX,
    `${valuePath}.journalId`,
  );
  if (journal.journalId !== expected.journalId) {
    throw new Error(`${valuePath}.journalId does not match its exact journal.`);
  }
  return expected;
}

/**
 * Rebind a stored stable journal to a current role-specific desired document.
 * Volatile request/node/attachment/account changes are intentionally ignored;
 * any stable media-target change fails closed.
 *
 * @param {unknown} value - Candidate journal.
 * @param {unknown} desiredValue - Current exact desired state.
 * @returns {Readonly<Record<string, any>>} - Canonical matching journal.
 */
export function validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired(
  value,
  desiredValue,
) {
  const journal = validateAwsSingleNodeHostRetainedStorageFormatJournal(value);
  const target = getAwsSingleNodeHostRetainedStorageFormatTarget(desiredValue);
  if (!sameJson(journal.target, target)) {
    throw new Error(
      'awsSingleNodeHostRetainedStorageFormatJournal does not match the desired media target.',
    );
  }
  return journal;
}

/**
 * Validate an initial publication or the sole legal prepared-to-formatted
 * successor. An already-equal document is not a successor.
 *
 * @param {unknown|null} currentValue - Current journal or null.
 * @param {unknown} nextValue - Candidate initial/successor journal.
 * @returns {Readonly<Record<string, any>>} - Canonical next journal.
 */
export function validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor(
  currentValue,
  nextValue,
) {
  const next = validateAwsSingleNodeHostRetainedStorageFormatJournal(nextValue);
  if (currentValue === null) {
    if (next.recordVersion !== 1) {
      throw new TypeError(
        'An initial retained-storage format journal must be recordVersion 1.',
      );
    }
    return next;
  }
  const current =
    validateAwsSingleNodeHostRetainedStorageFormatJournal(currentValue);
  if (current.phase !== 'prepared') {
    throw new TypeError(
      'A formatted retained-storage format journal has no successor.',
    );
  }
  if (
    next.recordVersion !== 2 ||
    next.previousJournalId !== current.journalId ||
    next.phase !== 'formatted' ||
    next.origin !== 'blank-format' ||
    !sameJson(next.target, current.target) ||
    !sameJson(next.attempt, current.attempt) ||
    !sameJson(next.blankProof, current.blankProof) ||
    next.profileProof?.classification !== 'exact-profile'
  ) {
    throw new TypeError(
      'The retained-storage format journal is not the exact formatted successor.',
    );
  }
  const expected = advanceAwsSingleNodeHostRetainedStorageFormatJournal({
    journal: current,
    profileProof: next.profileProof,
  });
  if (!sameJson(next, expected)) {
    throw new Error(
      'The retained-storage format journal successor changes immutable history.',
    );
  }
  return next;
}

export default {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLANK_FORMAT_PROOF_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EXACT_PROFILE_FORMAT_PROOF_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_JOURNAL_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_PROOF_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_MAX_BYTES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FORMAT_TARGET_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_FEATURES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_LABEL,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PROFILE_MARKER_ID_PREFIX,
  advanceAwsSingleNodeHostRetainedStorageFormatJournal,
  createAwsSingleNodeHostRetainedStorageAdoptedFormatJournal,
  createAwsSingleNodeHostRetainedStorageBlankFormatProof,
  createAwsSingleNodeHostRetainedStorageExactProfileFormatProof,
  createAwsSingleNodeHostRetainedStoragePreparedFormatJournal,
  getAwsSingleNodeHostRetainedStorageFormatTarget,
  getAwsSingleNodeHostRetainedStorageProfileMarkerBytes,
  getAwsSingleNodeHostRetainedStorageProfileMarkerId,
  getAwsSingleNodeHostRetainedStorageProfileMarkerText,
  validateAwsSingleNodeHostRetainedStorageBlankFormatProof,
  validateAwsSingleNodeHostRetainedStorageExactProfileFormatProof,
  validateAwsSingleNodeHostRetainedStorageFormatJournal,
  validateAwsSingleNodeHostRetainedStorageFormatJournalForDesired,
  validateAwsSingleNodeHostRetainedStorageFormatJournalSuccessor,
  validateAwsSingleNodeHostRetainedStorageFormatTarget,
};
