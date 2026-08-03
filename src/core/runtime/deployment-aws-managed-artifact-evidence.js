/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  sha256Base64Url,
} from './content-id.js';
import {
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
  getDeploymentArtifactStageObjectLocation,
} from './deployment-artifact-stage.js';
import {
  DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE,
  DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA,
} from './deployment-artifact-stager.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from './deployment-aws-runtime-identity-contract.js';
import {
  DEPLOYMENT_REVISION_ID_PREFIX,
  validateDeploymentRevision,
} from './deployment-revision.js';
import {
  DEPLOYMENT_PROFILE_ID_PREFIX,
  validateDeploymentProfile,
} from './deployment-profile.js';
import {
  assertDeploymentInstanceId,
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import {
  DEPLOYMENT_ACTION_ID_PREFIX,
  assertDeploymentIncarnationId,
  validateOwnershipNonce,
} from './deployment-resource-binding.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS = 3;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS = 10;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES = 16;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS = 16_000;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE = 1000;
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN =
  'wharfie:aws-single-node-managed-artifact-state:v1';
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE =
  'application/octet-stream';
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL = 'no-store';
export const AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA =
  'deployment-managed-artifact-v1';

const STATE_AUTHORITY_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'deploymentInstanceId',
  'incarnationId',
]);
const EVIDENCE_AUTHORITY_KEYS = new Set([
  'providerScope',
  'artifactStorage',
  'deploymentInstanceId',
  'incarnationId',
  'createdByActionId',
  'ownershipNonce',
  'appId',
]);
const MANAGED_HEAD_EVIDENCE_KEYS = new Set([
  'versionId',
  'etag',
  'contentLength',
  'metadata',
  'stateDigest',
  'artifactId',
  'deploymentRevisionId',
  'revisionId',
  'stageIntentId',
  'stageReceiptId',
]);
const MANAGED_HEAD_EVIDENCE_MAX_BYTES = 32 * 1024;
const HISTORY_KERNEL_KEYS = new Set(['readHistoryPage', 'readHead']);
const HISTORY_KERNEL_REQUIRED_KEYS = new Set(['readHistoryPage', 'readHead']);
const HISTORY_AUTHORITY_KEYS = new Set(['location', 'accountId']);
const MANAGED_METADATA_KEYS = new Set([
  'wharfie-schema',
  'wharfie-managed-by',
  'wharfie-resource-kind',
  'wharfie-retention',
  'wharfie-capability',
  'wharfie-role',
  'wharfie-provider-scope-id',
  'wharfie-deployment-instance-id',
  'wharfie-incarnation-id',
  'wharfie-resource-key',
  'wharfie-created-by-action-id',
  'wharfie-ownership-nonce',
  'wharfie-state-digest',
  'wharfie-deployment-revision-id',
  'wharfie-profile-revision-id',
  'wharfie-app-id',
  'wharfie-revision-id',
  'wharfie-artifact-id',
  'wharfie-content-length',
  'wharfie-stage-intent-id',
  'wharfie-stage-receipt-id',
]);
const STAGE_METADATA_KEYS = new Set([
  'wharfie-schema',
  'wharfie-intent',
  'wharfie-nonce',
  'wharfie-artifact',
  'wharfie-digest',
]);
const ARTIFACT_STORAGE_KEYS = new Set([
  'contractVersion',
  'storage',
  'encryption',
  'onDestroy',
]);

/** Provider evidence is malformed, incomplete, or unreadable. */
export class AwsSingleNodeManagedArtifactEvidenceUnknownError extends Error {
  constructor() {
    super('AWS single-node managed artifact evidence is unknown.');
    this.name = 'AwsSingleNodeManagedArtifactEvidenceUnknownError';
    this.code = 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_EVIDENCE_UNKNOWN';
  }
}

/** Well-formed provider evidence contradicts exact namespace authority. */
export class AwsSingleNodeManagedArtifactEvidenceConflictError extends Error {
  constructor() {
    super(
      'AWS single-node managed artifact evidence conflicts with authority.',
    );
    this.name = 'AwsSingleNodeManagedArtifactEvidenceConflictError';
    this.code = 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_EVIDENCE_CONFLICT';
  }
}

/** Multiple S3 views can still converge to one valid history. */
export class AwsSingleNodeManagedArtifactEvidenceTransientError extends Error {
  constructor() {
    super('AWS single-node managed artifact evidence is transient.');
    this.name = 'AwsSingleNodeManagedArtifactEvidenceTransientError';
    this.code = 'AWS_SINGLE_NODE_MANAGED_ARTIFACT_EVIDENCE_TRANSIENT';
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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameCanonicalJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameStringMap(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        typeof left[key] === 'string' &&
        typeof right[key] === 'string' &&
        left[key] === right[key],
    )
  );
}

/** @param {unknown} error @param {string} name @returns {boolean} */
export function isAwsSingleNodeManagedArtifactErrorNamed(error, name) {
  return (
    typeof name === 'string' &&
    name.length !== 0 &&
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/** @param {unknown} error @returns {boolean} */
export function isAwsSingleNodeManagedArtifactCurrentMissingError(error) {
  return (
    isAwsSingleNodeManagedArtifactErrorNamed(error, 'NoSuchKey') ||
    isAwsSingleNodeManagedArtifactErrorNamed(error, 'NotFound')
  );
}

/** @param {string} value @returns {boolean} */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = value.charCodeAt(index + 1);
      if (!(low >= 0xdc00 && low <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** @param {unknown} value @returns {value is string} */
function isUsableVersionId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value !== 'null' &&
    isWellFormedUnicode(value) &&
    Buffer.byteLength(value, 'utf8') <= 1024
  );
}

/** @param {unknown} value @returns {value is string} */
function isUsableOpaqueEtag(value) {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value[0] !== '"' ||
    value[value.length - 1] !== '"' ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, 'utf8') > 1024
  ) {
    return false;
  }
  const opaque = value.slice(1, -1);
  if (opaque === '*') return false;
  for (const character of opaque) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint === undefined ||
      codePoint <= 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint > 0xff ||
      character === '"' ||
      character === ','
    ) {
      return false;
    }
  }
  return true;
}

/** @param {unknown} value @returns {string} */
function decodeListedKey(value) {
  if (typeof value !== 'string' || !isWellFormedUnicode(value)) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  if (!isWellFormedUnicode(decoded)) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  return decoded;
}

/** @param {string} artifactId @returns {string} */
function artifactChecksumBase64(artifactId) {
  assertArtifactId(artifactId, 'managedArtifact artifactId');
  return Buffer.from(artifactId.slice('waf1_'.length), 'base64url').toString(
    'base64',
  );
}

/** @param {unknown} value @returns {number} */
function parseCanonicalContentLength(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  const contentLength = Number(value);
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 0 ||
    contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES ||
    String(contentLength) !== value
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  return contentLength;
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} deploymentInstanceId @param {string} incarnationId @param {{deploymentRevisionId: string, profileRevisionId: string, appId: string, revisionId: string, artifactId: string}} artifact @param {Readonly<Record<string, any>>} artifactStorage @returns {Readonly<{algorithm: 'sha256', value: string}>} */
function stateDigestFromReferences(
  providerScope,
  deploymentInstanceId,
  incarnationId,
  artifact,
  artifactStorage,
) {
  const location = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope,
    deploymentInstanceId,
    incarnationId,
  });
  const source = getDeploymentArtifactStageObjectLocation(
    providerScope,
    artifact.artifactId,
  );
  const descriptor = sortCanonicalJsonValue({
    schemaVersion: 1,
    kind: 'awsSingleNodeManagedArtifactState',
    location,
    source,
    artifact: {
      deploymentRevisionId: artifact.deploymentRevisionId,
      profileRevisionId: artifact.profileRevisionId,
      appId: artifact.appId,
      revisionId: artifact.revisionId,
      artifactId: artifact.artifactId,
      checksumAlgorithm: 'SHA256',
      checksum: artifact.artifactId.slice('waf1_'.length),
    },
    object: {
      storage: artifactStorage.storage,
      encryption: artifactStorage.encryption,
      storageClass: 'STANDARD',
      contentType: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
      cacheControl: AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
      metadataSchema: AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
      onDestroy: artifactStorage.onDestroy,
    },
  });
  return deepFreeze({
    algorithm: 'sha256',
    value: sha256Base64Url(
      `${AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN}\0${JSON.stringify(
        descriptor,
      )}`,
    ),
  });
}

/**
 * Derive exact plan-time managed object state.
 * @param {unknown} value - Complete deterministic deployment authority.
 * @returns {Readonly<{algorithm: 'sha256', value: string}>}
 */
export function getAwsSingleNodeManagedArtifactStateDigest(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact state must be an object.',
    );
  }
  assertExactKeys(
    value,
    STATE_AUTHORITY_KEYS,
    'awsSingleNodeManagedArtifact state',
  );
  const deploymentRevision = validateDeploymentRevision(
    value.deploymentRevision,
    'awsSingleNodeManagedArtifact state.deploymentRevision',
  );
  const profile = validateDeploymentProfile(
    value.profile,
    'awsSingleNodeManagedArtifact state.profile',
  );
  const providerScope = validateProviderScope(
    value.providerScope,
    'awsSingleNodeManagedArtifact state.providerScope',
  );
  const providerSpec = validateAwsSingleNodeProviderSpecContext(
    value.providerSpec,
    { profile, providerScope },
  );
  assertDeploymentInstanceId(
    value.deploymentInstanceId,
    'awsSingleNodeManagedArtifact state.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    value.incarnationId,
    'awsSingleNodeManagedArtifact state.incarnationId',
  );
  if (
    deploymentRevision.profileRevisionId !== profile.profileRevisionId ||
    deploymentRevision.appId !== profile.appId ||
    value.deploymentInstanceId !==
      getDeploymentInstanceId({ deploymentRevision, providerScope })
  ) {
    throw new Error(
      'awsSingleNodeManagedArtifact state deployment revision, profile, scope, and instance identity do not match.',
    );
  }
  return stateDigestFromReferences(
    providerScope,
    value.deploymentInstanceId,
    value.incarnationId,
    deploymentRevision,
    providerSpec.capabilities.artifactStorage,
  );
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateEvidenceAuthority(value) {
  if (!isPlainObject(value)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact evidence authority must be an object.',
    );
  }
  assertExactKeys(
    value,
    EVIDENCE_AUTHORITY_KEYS,
    'awsSingleNodeManagedArtifact evidence authority',
  );
  const providerScope = validateProviderScope(
    value.providerScope,
    'awsSingleNodeManagedArtifact evidence authority.providerScope',
  );
  if (!isPlainObject(value.artifactStorage)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact evidence authority.artifactStorage must be an object.',
    );
  }
  assertExactKeys(
    value.artifactStorage,
    ARTIFACT_STORAGE_KEYS,
    'awsSingleNodeManagedArtifact evidence authority.artifactStorage',
  );
  if (
    value.artifactStorage.contractVersion !== 1 ||
    value.artifactStorage.storage !== 's3-object' ||
    value.artifactStorage.encryption !== 'AES256' ||
    value.artifactStorage.onDestroy !== 'purge'
  ) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact evidence authority.artifactStorage does not match the fixed contract.',
    );
  }
  assertDeploymentInstanceId(
    value.deploymentInstanceId,
    'awsSingleNodeManagedArtifact evidence authority.deploymentInstanceId',
  );
  assertDeploymentIncarnationId(
    value.incarnationId,
    'awsSingleNodeManagedArtifact evidence authority.incarnationId',
  );
  assertDomainSeparatedSha256Id(
    value.createdByActionId,
    DEPLOYMENT_ACTION_ID_PREFIX,
    'awsSingleNodeManagedArtifact evidence authority.createdByActionId',
  );
  validateOwnershipNonce(
    value.ownershipNonce,
    'awsSingleNodeManagedArtifact evidence authority.ownershipNonce',
  );
  assertLogicalId(
    value.appId,
    'awsSingleNodeManagedArtifact evidence authority.appId',
  );
  return deepFreeze({
    providerScope,
    artifactStorage: { ...value.artifactStorage },
    deploymentInstanceId: value.deploymentInstanceId,
    incarnationId: value.incarnationId,
    createdByActionId: value.createdByActionId,
    ownershipNonce: value.ownershipNonce,
    appId: value.appId,
  });
}

/** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
function ownershipCore(authority) {
  return deepFreeze({
    'wharfie-schema': AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
    'wharfie-managed-by': 'wharfie',
    'wharfie-resource-kind': 'single-node-managed-artifact',
    'wharfie-retention': 'purge',
    'wharfie-capability': 'artifact-storage',
    'wharfie-role': 'object',
    'wharfie-provider-scope-id': authority.providerScope.providerScopeId,
    'wharfie-deployment-instance-id': authority.deploymentInstanceId,
    'wharfie-incarnation-id': authority.incarnationId,
    'wharfie-resource-key': 'artifact',
    'wharfie-created-by-action-id': authority.createdByActionId,
    'wharfie-ownership-nonce': authority.ownershipNonce,
    'wharfie-app-id': authority.appId,
  });
}

/**
 * Decode exact immutable metadata and derive its actual state digest from
 * normalized references rather than trusting the metadata digest field.
 * @param {unknown} value - Raw S3 user metadata.
 * @param {unknown} authorityValue - Stable namespace ownership authority.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeManagedArtifactMetadata(
  value,
  authorityValue,
) {
  const authority = validateEvidenceAuthority(authorityValue);
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  const keys = Object.keys(value);
  if (
    keys.length !== MANAGED_METADATA_KEYS.size ||
    keys.some((key) => !MANAGED_METADATA_KEYS.has(key))
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  for (const [key, expected] of Object.entries(ownershipCore(authority))) {
    if (value[key] !== expected) {
      throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
    }
  }
  try {
    assertDomainSeparatedSha256Id(
      value['wharfie-created-by-action-id'],
      DEPLOYMENT_ACTION_ID_PREFIX,
      'managedArtifact metadata createdByActionId',
    );
    validateOwnershipNonce(
      value['wharfie-ownership-nonce'],
      'managedArtifact metadata ownershipNonce',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-deployment-revision-id'],
      DEPLOYMENT_REVISION_ID_PREFIX,
      'managedArtifact metadata deploymentRevisionId',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-profile-revision-id'],
      DEPLOYMENT_PROFILE_ID_PREFIX,
      'managedArtifact metadata profileRevisionId',
    );
    assertLogicalId(value['wharfie-app-id'], 'managedArtifact metadata appId');
    assertApplicationRevisionId(
      value['wharfie-revision-id'],
      'managedArtifact metadata revisionId',
    );
    assertArtifactId(
      value['wharfie-artifact-id'],
      'managedArtifact metadata artifactId',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-stage-intent-id'],
      DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
      'managedArtifact metadata stageIntentId',
    );
    assertDomainSeparatedSha256Id(
      value['wharfie-stage-receipt-id'],
      DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
      'managedArtifact metadata stageReceiptId',
    );
  } catch {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  const contentLength = parseCanonicalContentLength(
    value['wharfie-content-length'],
  );
  let claimedStateDigest;
  try {
    claimedStateDigest = validateSha256Digest(
      {
        algorithm: 'sha256',
        value: value['wharfie-state-digest'],
      },
      'managedArtifact metadata stateDigest',
    );
  } catch {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  const observedDigest = stateDigestFromReferences(
    authority.providerScope,
    authority.deploymentInstanceId,
    authority.incarnationId,
    {
      deploymentRevisionId: value['wharfie-deployment-revision-id'],
      profileRevisionId: value['wharfie-profile-revision-id'],
      appId: value['wharfie-app-id'],
      revisionId: value['wharfie-revision-id'],
      artifactId: value['wharfie-artifact-id'],
    },
    authority.artifactStorage,
  );
  if (!sameJson(claimedStateDigest, observedDigest)) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  return deepFreeze({
    metadata: { ...value },
    contentLength,
    stateDigest: observedDigest,
    artifactId: value['wharfie-artifact-id'],
    deploymentRevisionId: value['wharfie-deployment-revision-id'],
    revisionId: value['wharfie-revision-id'],
    stageIntentId: value['wharfie-stage-intent-id'],
    stageReceiptId: value['wharfie-stage-receipt-id'],
  });
}

/**
 * Decode one exact destination HeadObject response.
 * @param {unknown} response - Raw S3 response.
 * @param {unknown} authority - Stable namespace authority.
 * @param {string|undefined} exactVersionId - Optional listed VersionId.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeManagedArtifactHead(
  response,
  authority,
  exactVersionId,
) {
  if (!isPlainObject(response)) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  if (!isUsableVersionId(response.VersionId)) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  if (exactVersionId !== undefined && response.VersionId !== exactVersionId) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  if (!isUsableOpaqueEtag(response.ETag)) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  const parsed = decodeAwsSingleNodeManagedArtifactMetadata(
    response.Metadata,
    authority,
  );
  if (
    response.ContentLength !== parsed.contentLength ||
    response.ChecksumSHA256 !== artifactChecksumBase64(parsed.artifactId) ||
    response.ServerSideEncryption !== 'AES256' ||
    (response.StorageClass ?? 'STANDARD') !== 'STANDARD' ||
    response.ContentType !== AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE ||
    response.CacheControl !== AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL ||
    response.DeleteMarker === true ||
    (response.ChecksumType !== undefined &&
      response.ChecksumType !== 'FULL_OBJECT') ||
    (response.TagCount !== undefined && response.TagCount !== 0) ||
    response.ContentDisposition !== undefined ||
    response.ContentEncoding !== undefined ||
    response.ContentLanguage !== undefined ||
    response.WebsiteRedirectLocation !== undefined ||
    response.SSECustomerAlgorithm !== undefined ||
    response.SSEKMSKeyId !== undefined ||
    response.ReplicationStatus !== undefined ||
    response.ObjectLockMode !== undefined ||
    response.ObjectLockRetainUntilDate !== undefined ||
    response.ObjectLockLegalHoldStatus !== undefined ||
    response.PartsCount !== undefined
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  return deepFreeze({
    versionId: response.VersionId,
    etag: response.ETag,
    contentLength: response.ContentLength,
    ...parsed,
  });
}

/**
 * Revalidate one serialized decoded destination head before it crosses another
 * durable boundary. Opaque VersionId and ETag values are syntax-checked but are
 * deliberately not interpreted or scanned as user-authored credential
 * material.
 * @param {unknown} value - Candidate decoded managed-artifact head.
 * @param {unknown} authority - Stable namespace ownership authority.
 * @returns {Readonly<Record<string, any>>} - Fresh canonical head evidence.
 */
export function validateAwsSingleNodeManagedArtifactHeadEvidence(
  value,
  authority,
) {
  /** @type {Record<string, any>} */
  let evidence;
  try {
    evidence = cloneBoundedJsonObject(
      value,
      MANAGED_HEAD_EVIDENCE_MAX_BYTES,
      'awsSingleNodeManagedArtifact head evidence',
    );
  } catch {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  try {
    assertExactKeys(
      evidence,
      MANAGED_HEAD_EVIDENCE_KEYS,
      'awsSingleNodeManagedArtifact head evidence',
    );
  } catch {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  if (
    !isUsableVersionId(evidence.versionId) ||
    !isUsableOpaqueEtag(evidence.etag)
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  const parsed = decodeAwsSingleNodeManagedArtifactMetadata(
    evidence.metadata,
    authority,
  );
  if (
    !Number.isSafeInteger(evidence.contentLength) ||
    evidence.contentLength < 0 ||
    evidence.contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES ||
    evidence.contentLength !== parsed.contentLength ||
    !sameCanonicalJson(evidence.stateDigest, parsed.stateDigest) ||
    evidence.artifactId !== parsed.artifactId ||
    evidence.deploymentRevisionId !== parsed.deploymentRevisionId ||
    evidence.revisionId !== parsed.revisionId ||
    evidence.stageIntentId !== parsed.stageIntentId ||
    evidence.stageReceiptId !== parsed.stageReceiptId
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      versionId: evidence.versionId,
      etag: evidence.etag,
      contentLength: parsed.contentLength,
      metadata: parsed.metadata,
      stateDigest: parsed.stateDigest,
      artifactId: parsed.artifactId,
      deploymentRevisionId: parsed.deploymentRevisionId,
      revisionId: parsed.revisionId,
      stageIntentId: parsed.stageIntentId,
      stageReceiptId: parsed.stageReceiptId,
    }),
  );
}

/**
 * Decode one exact immutable staged source HeadObject response.
 * @param {unknown} response - Raw S3 response.
 * @param {Readonly<Record<string, any>>} artifactStage - Validated stage pair.
 * @returns {Readonly<{versionId: string, etag: string}>}
 */
export function decodeAwsSingleNodeManagedArtifactStageHead(
  response,
  artifactStage,
) {
  if (!isPlainObject(response)) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  const expectedMetadata = {
    'wharfie-schema': DEPLOYMENT_ARTIFACT_STAGE_METADATA_SCHEMA,
    'wharfie-intent': artifactStage.intent.stageIntentId,
    'wharfie-nonce': artifactStage.intent.ownershipNonce,
    'wharfie-artifact': artifactStage.intent.artifact.artifactId,
    'wharfie-digest': artifactStage.intent.artifact.byteDigest.value,
  };
  if (
    !isUsableVersionId(response.VersionId) ||
    response.VersionId !== artifactStage.receipt.object.versionId ||
    !isUsableOpaqueEtag(response.ETag) ||
    response.ContentLength !== artifactStage.receipt.object.contentLength ||
    response.ChecksumSHA256 !==
      artifactChecksumBase64(artifactStage.intent.artifact.artifactId) ||
    response.ServerSideEncryption !== 'AES256' ||
    (response.StorageClass ?? 'STANDARD') !== 'STANDARD' ||
    response.ContentType !== DEPLOYMENT_ARTIFACT_STAGE_CONTENT_TYPE ||
    response.DeleteMarker === true ||
    !isPlainObject(response.Metadata) ||
    Object.keys(response.Metadata).length !== STAGE_METADATA_KEYS.size ||
    Object.keys(response.Metadata).some(
      (key) => !STAGE_METADATA_KEYS.has(key),
    ) ||
    Object.entries(expectedMetadata).some(
      ([key, expected]) => response.Metadata[key] !== expected,
    )
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  return deepFreeze({ versionId: response.VersionId, etag: response.ETag });
}

/** @param {unknown} value @returns {Readonly<{key: string, versionId: string, isLatest: boolean, etag: string, size: number}>} */
function decodeListedVersion(value) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  if (
    !isUsableVersionId(value.VersionId) ||
    typeof value.IsLatest !== 'boolean' ||
    !isUsableOpaqueEtag(value.ETag) ||
    !Number.isSafeInteger(value.Size) ||
    value.Size < 0 ||
    value.Size > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES ||
    (value.StorageClass ?? 'STANDARD') !== 'STANDARD' ||
    (value.ChecksumType !== undefined &&
      value.ChecksumType !== 'FULL_OBJECT') ||
    (value.ChecksumAlgorithm !== undefined &&
      (!Array.isArray(value.ChecksumAlgorithm) ||
        value.ChecksumAlgorithm.length !== 1 ||
        value.ChecksumAlgorithm[0] !== 'SHA256'))
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  return deepFreeze({
    key: decodeListedKey(value.Key),
    versionId: value.VersionId,
    isLatest: value.IsLatest,
    etag: value.ETag,
    size: value.Size,
  });
}

/** @param {unknown} value @returns {Readonly<{key: string, versionId: string, isLatest: boolean}>} */
function decodeListedMarker(value) {
  if (!isPlainObject(value)) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  if (
    !isUsableVersionId(value.VersionId) ||
    typeof value.IsLatest !== 'boolean'
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  return deepFreeze({
    key: decodeListedKey(value.Key),
    versionId: value.VersionId,
    isLatest: value.IsLatest,
  });
}

/**
 * Decode one ListObjectVersions page and retain only the exact managed key.
 * @param {unknown} response - Raw S3 page.
 * @param {Readonly<{bucketName: string, key: string}>} location - Exact namespace.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsSingleNodeManagedArtifactHistoryPage(
  response,
  location,
) {
  if (
    !isPlainObject(response) ||
    typeof response.IsTruncated !== 'boolean' ||
    (response.Name !== undefined && response.Name !== location.bucketName) ||
    (response.Prefix !== undefined &&
      decodeListedKey(response.Prefix) !== location.key) ||
    response.EncodingType !== 'url' ||
    (response.MaxKeys !== undefined &&
      (!Number.isSafeInteger(response.MaxKeys) ||
        response.MaxKeys < 0 ||
        response.MaxKeys > AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE)) ||
    (response.Versions !== undefined && !Array.isArray(response.Versions)) ||
    (response.DeleteMarkers !== undefined &&
      !Array.isArray(response.DeleteMarkers))
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  const listedVersions = (response.Versions ?? []).map(decodeListedVersion);
  const listedMarkers = (response.DeleteMarkers ?? []).map(decodeListedMarker);
  if (
    listedVersions.length + listedMarkers.length >
    AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  const versions = listedVersions.filter(
    (/** @type {Readonly<Record<string, any>>} */ entry) =>
      entry.key === location.key,
  );
  const markers = listedMarkers.filter(
    (/** @type {Readonly<Record<string, any>>} */ entry) =>
      entry.key === location.key,
  );
  const exactEntries = [...versions, ...markers];
  const exactVersionIds = new Set(
    exactEntries.map(
      (/** @type {Readonly<Record<string, any>>} */ entry) => entry.versionId,
    ),
  );
  if (
    exactVersionIds.size !== exactEntries.length ||
    exactEntries.filter(
      (/** @type {Readonly<Record<string, any>>} */ entry) => entry.isLatest,
    ).length > 1
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
  }
  if (!response.IsTruncated) {
    return deepFreeze({
      versions,
      markers,
      nextKeyMarker: null,
      nextVersionIdMarker: null,
    });
  }
  if (
    typeof response.NextKeyMarker !== 'string' ||
    response.NextKeyMarker.length === 0 ||
    !isUsableVersionId(response.NextVersionIdMarker)
  ) {
    throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
  }
  return deepFreeze({
    versions,
    markers,
    nextKeyMarker: decodeListedKey(response.NextKeyMarker),
    nextVersionIdMarker: response.NextVersionIdMarker,
  });
}

/**
 * Bind complete bounded history reconciliation to caller-owned read adapters.
 * @param {unknown} options - History-page and decoded-head adapters.
 * @returns {Readonly<{readHistory: (authority: unknown) => Promise<Readonly<{versions: Readonly<Record<string, any>>[], markers: Readonly<Record<string, any>>[], current: Readonly<Record<string, any>>|null}>>}>}
 */
export function createAwsSingleNodeManagedArtifactHistoryEvidence(options) {
  if (!isPlainObject(options)) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact history evidence options must be an object.',
    );
  }
  assertSupportedKeys(
    options,
    HISTORY_KERNEL_KEYS,
    'awsSingleNodeManagedArtifact history evidence options',
  );
  assertRequiredKeys(
    options,
    HISTORY_KERNEL_REQUIRED_KEYS,
    'awsSingleNodeManagedArtifact history evidence options',
  );
  if (
    typeof options.readHistoryPage !== 'function' ||
    typeof options.readHead !== 'function'
  ) {
    throw new TypeError(
      'awsSingleNodeManagedArtifact history evidence read adapters are required.',
    );
  }
  const adapters =
    /** @type {{readHistoryPage: (request: Readonly<Record<string, any>>) => Promise<unknown>, readHead: (versionId: string|undefined) => Promise<Readonly<Record<string, any>>|null>}} */ (
      options
    );

  /** @param {unknown} authorityValue @returns {Promise<Readonly<{versions: Readonly<Record<string, any>>[], markers: Readonly<Record<string, any>>[], current: Readonly<Record<string, any>>|null}>>} */
  async function readHistory(authorityValue) {
    if (!isPlainObject(authorityValue)) {
      throw new TypeError(
        'awsSingleNodeManagedArtifact history authority must be an object.',
      );
    }
    assertExactKeys(
      authorityValue,
      HISTORY_AUTHORITY_KEYS,
      'awsSingleNodeManagedArtifact history authority',
    );
    if (
      !isPlainObject(authorityValue.location) ||
      typeof authorityValue.location.bucketName !== 'string' ||
      typeof authorityValue.location.key !== 'string' ||
      typeof authorityValue.accountId !== 'string' ||
      !/^[0-9]{12}$/u.test(authorityValue.accountId)
    ) {
      throw new TypeError(
        'awsSingleNodeManagedArtifact history authority is invalid.',
      );
    }
    const location = deepFreeze({
      bucketName: authorityValue.location.bucketName,
      key: authorityValue.location.key,
    });
    /** @type {Readonly<Record<string, any>>[]} */
    const versions = [];
    /** @type {Readonly<Record<string, any>>[]} */
    const markers = [];
    const cursorPairs = new Set();
    const versionIds = new Set();
    let keyMarker;
    let versionIdMarker;
    let totalEntries = 0;
    let complete = false;
    for (
      let pageIndex = 0;
      pageIndex < AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES;
      pageIndex += 1
    ) {
      const request = deepFreeze({
        Bucket: location.bucketName,
        Prefix: location.key,
        MaxKeys: AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE,
        EncodingType: 'url',
        ExpectedBucketOwner: authorityValue.accountId,
        ...(keyMarker === undefined ? {} : { KeyMarker: keyMarker }),
        ...(versionIdMarker === undefined
          ? {}
          : { VersionIdMarker: versionIdMarker }),
      });
      const response = await adapters.readHistoryPage(request);
      const page = decodeAwsSingleNodeManagedArtifactHistoryPage(
        response,
        location,
      );
      totalEntries += page.versions.length + page.markers.length;
      if (
        totalEntries > AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS
      ) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
      for (const entry of [...page.versions, ...page.markers]) {
        if (versionIds.has(entry.versionId)) {
          throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
        }
        versionIds.add(entry.versionId);
      }
      versions.push(...page.versions);
      markers.push(...page.markers);
      const latestCount = [...versions, ...markers].filter(
        (entry) => entry.isLatest,
      ).length;
      if (latestCount > 1) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
      if (page.nextKeyMarker === null) {
        complete = true;
        break;
      }
      const pair = JSON.stringify([
        page.nextKeyMarker,
        page.nextVersionIdMarker,
      ]);
      if (cursorPairs.has(pair)) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
      cursorPairs.add(pair);
      keyMarker = page.nextKeyMarker;
      versionIdMarker = page.nextVersionIdMarker;
      if (
        pageIndex + 1 ===
        AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES
      ) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
    }
    if (!complete) {
      throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
    }
    const all = [...versions, ...markers];
    const latest = all.filter((entry) => entry.isLatest);
    if (all.length > 0 && latest.length !== 1) {
      throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
    }

    /** @type {Readonly<Record<string, any>>[]} */
    const auditedVersions = [];
    for (const version of versions) {
      const head = await adapters.readHead(version.versionId);
      if (head === null) {
        throw new AwsSingleNodeManagedArtifactEvidenceTransientError();
      }
      if (head.etag !== version.etag || head.contentLength !== version.size) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
      auditedVersions.push(deepFreeze({ ...version, head }));
    }

    const latestEntry = latest[0] ?? null;
    const current = await adapters.readHead(undefined);
    if (latestEntry === null) {
      if (current !== null) {
        throw new AwsSingleNodeManagedArtifactEvidenceTransientError();
      }
    } else {
      const latestIsMarker = markers.some(
        (marker) => marker.versionId === latestEntry.versionId,
      );
      if (latestIsMarker) {
        if (current !== null) {
          throw new AwsSingleNodeManagedArtifactEvidenceTransientError();
        }
      } else if (
        current === null ||
        current.versionId !== latestEntry.versionId ||
        current.etag !== latestEntry.etag ||
        current.contentLength !== latestEntry.size
      ) {
        throw new AwsSingleNodeManagedArtifactEvidenceTransientError();
      } else {
        const auditedLatest = auditedVersions.find(
          (version) => version.versionId === latestEntry.versionId,
        );
        if (
          auditedLatest === undefined ||
          !sameCanonicalJson(current, auditedLatest.head)
        ) {
          throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
        }
      }
    }
    return deepFreeze({
      versions: auditedVersions,
      markers,
      current,
    });
  }

  return Object.freeze({ readHistory });
}

/** @param {Readonly<Record<string, any>>} current @param {Readonly<Record<string, any>>} desired @returns {boolean} */
export function isAwsSingleNodeManagedArtifactDesiredState(current, desired) {
  return (
    sameJson(current.stateDigest, desired.stateDigest) &&
    sameStringMap(current.metadata, desired.metadata)
  );
}

export default {
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CACHE_CONTROL,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_CONTENT_TYPE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_DEFAULT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_LIST_PAGE_SIZE,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_ATTEMPTS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_PAGES,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_MAX_HISTORY_VERSIONS,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_METADATA_SCHEMA,
  AWS_SINGLE_NODE_MANAGED_ARTIFACT_STATE_DIGEST_DOMAIN,
  AwsSingleNodeManagedArtifactEvidenceConflictError,
  AwsSingleNodeManagedArtifactEvidenceTransientError,
  AwsSingleNodeManagedArtifactEvidenceUnknownError,
  createAwsSingleNodeManagedArtifactHistoryEvidence,
  decodeAwsSingleNodeManagedArtifactHead,
  decodeAwsSingleNodeManagedArtifactHistoryPage,
  decodeAwsSingleNodeManagedArtifactMetadata,
  decodeAwsSingleNodeManagedArtifactStageHead,
  getAwsSingleNodeManagedArtifactStateDigest,
  isAwsSingleNodeManagedArtifactCurrentMissingError,
  isAwsSingleNodeManagedArtifactDesiredState,
  isAwsSingleNodeManagedArtifactErrorNamed,
  validateAwsSingleNodeManagedArtifactHeadEvidence,
};
