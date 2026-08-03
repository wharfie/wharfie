/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- TypeScript assertion signatures and compact internal helpers are not understood cleanly by the current JSDoc lint parser. */

import { createHash } from 'node:crypto';

import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from './application-revision.js';
import { assertArtifactId } from './artifact-record.js';
import { validateBuildTarget } from './build-target.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import { validateOwnershipNonce } from './deployment-resource-binding.js';
import { cloneBoundedJsonObject } from './json-value.js';
import { assertLogicalId } from './logical-id.js';
import { assertManifestIsSecretFree } from './manifest-security.js';

export const DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION = 1;
export const DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND =
  'deploymentArtifactStageIntent';
export const DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN =
  'wharfie:deployment-artifact-stage-intent:v1';
export const DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX = 'wsi1';
export const DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION = 1;
export const DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND =
  'deploymentArtifactStageReceipt';
export const DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN =
  'wharfie:deployment-artifact-stage-receipt:v1';
export const DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX = 'wsr1';

// Artifact staging deliberately uses one conditional PutObject, never a
// multipart upload: 5 GiB is therefore the exact upper protocol bound.
export const DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES = 5 * 1024 ** 3;
export const DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES = 32 * 1024;
export const DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES = 1024;

const INTENT_CREATE_KEYS = new Set([
  'providerScope',
  'artifact',
  'ownershipNonce',
]);
const INTENT_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'providerScope',
  'artifact',
  'object',
  'ownershipNonce',
]);
const INTENT_DOCUMENT_KEYS = new Set(['stageIntentId', ...INTENT_PAYLOAD_KEYS]);
const INTENT_CONTEXT_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
]);
const ARTIFACT_KEYS = new Set([
  'artifactId',
  'byteDigest',
  'size',
  'appId',
  'revisionId',
  'target',
]);
const STAGE_OBJECT_KEYS = new Set(['bucketName', 'key']);
const RECEIPT_CREATE_KEYS = new Set(['intent', 'object']);
const RECEIPT_PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'stageIntentId',
  'artifactId',
  'object',
]);
const RECEIPT_DOCUMENT_KEYS = new Set([
  'stageReceiptId',
  ...RECEIPT_PAYLOAD_KEYS,
]);
const RECEIPT_CONTEXT_KEYS = new Set(['intent']);
const RECEIPT_OBJECT_KEYS = new Set([
  'bucketName',
  'key',
  'versionId',
  'contentLength',
  'checksum',
  'serverSideEncryption',
  'storageClass',
]);
const CONTROL_BUCKET_PATTERN = /^wharfie-dc-v1-[0-9]{12}-[a-f0-9]{20}$/;

/**
 * @typedef DeploymentArtifactStageIntent
 * @property {1} schemaVersion - Schema version.
 * @property {'deploymentArtifactStageIntent'} kind - Document kind.
 * @property {string} stageIntentId - Immutable content identity.
 * @property {import('./deployment-provider-scope.js').AwsProviderScope} providerScope - Exact credential scope without credentials.
 * @property {{artifactId: string, byteDigest: import('./application-revision.js').Sha256Digest, size: number, appId: string, revisionId: string, target: import('./build-target.js').BuildTarget}} artifact - Exact staged artifact identity.
 * @property {{bucketName: string, key: string}} object - Deterministic staging location.
 * @property {string} ownershipNonce - Unpredictable ownership envelope.
 */

/**
 * @typedef DeploymentArtifactStageReceipt
 * @property {1} schemaVersion - Schema version.
 * @property {'deploymentArtifactStageReceipt'} kind - Document kind.
 * @property {string} stageReceiptId - Immutable content identity.
 * @property {string} stageIntentId - Exact intent satisfied.
 * @property {string} artifactId - Exact artifact stored.
 * @property {{bucketName: string, key: string, versionId: string, contentLength: number, checksum: import('./application-revision.js').Sha256Digest, serverSideEncryption: 'AES256', storageClass: 'STANDARD'}} object - Exact provider object-version evidence.
 */

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertAllKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
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

/** @param {unknown} value @param {string} path @returns {Record<string, any>} */
function cloneDocument(value, path) {
  return cloneBoundedJsonObject(
    value,
    DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES,
    path,
  );
}

/**
 * Derive the only retained control-bucket name admitted for a provider scope.
 * The 12-digit account keeps the name operationally recognizable; 80 bits of
 * lowercase hex bind the complete content-addressed scope, including partition
 * and region, while keeping the name well below S3's 63-character ceiling.
 * @param {unknown} value - Full provider scope.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - Canonical globally suitable S3 bucket name.
 */
export function getDeploymentControlBucketName(
  value,
  valuePath = 'providerScope',
) {
  const providerScope = validateProviderScope(value, valuePath);
  const scopeHash = createHash('sha256')
    .update(providerScope.providerScopeId, 'utf8')
    .digest('hex')
    .slice(0, 20);
  return `wharfie-dc-v1-${providerScope.accountId}-${scopeHash}`;
}

/**
 * Derive the immutable content-addressed object key for one artifact.
 * @param {unknown} value - Artifact ID.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - Canonical stage key.
 */
export function getDeploymentArtifactStageObjectKey(
  value,
  valuePath = 'artifactId',
) {
  assertArtifactId(value, valuePath);
  return `stage/v1/${value}`;
}

/**
 * Derive the complete deterministic staging lookup without accepting names
 * from ambient configuration.
 * @param {unknown} providerScope - Full provider scope.
 * @param {unknown} artifactId - Artifact identity.
 * @returns {Readonly<{bucketName: string, key: string}>} - Staging location.
 */
export function getDeploymentArtifactStageObjectLocation(
  providerScope,
  artifactId,
) {
  return deepFreeze({
    bucketName: getDeploymentControlBucketName(providerScope, 'providerScope'),
    key: getDeploymentArtifactStageObjectKey(artifactId, 'artifactId'),
  });
}

/** @param {unknown} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validateArtifact(value, path) {
  const artifact = cloneDocument(value, path);
  assertAllKeys(artifact, ARTIFACT_KEYS, path);
  assertArtifactId(artifact.artifactId, `${path}.artifactId`);
  const byteDigest = validateSha256Digest(
    artifact.byteDigest,
    `${path}.byteDigest`,
  );
  if (artifact.artifactId !== `waf1_${byteDigest.value}`) {
    throw new Error(`${path}.artifactId must name its exact byteDigest.`);
  }
  if (
    !Number.isSafeInteger(artifact.size) ||
    artifact.size < 0 ||
    artifact.size > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES
  ) {
    throw new TypeError(
      `${path}.size must be a nonnegative safe integer no larger than ${DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES}.`,
    );
  }
  assertLogicalId(artifact.appId, `${path}.appId`);
  assertApplicationRevisionId(artifact.revisionId, `${path}.revisionId`);
  const normalized = {
    artifactId: artifact.artifactId,
    byteDigest,
    size: artifact.size,
    appId: artifact.appId,
    revisionId: artifact.revisionId,
    target: validateBuildTarget(artifact.target, `${path}.target`),
  };
  assertManifestIsSecretFree(normalized, path);
  return deepFreeze(sortCanonicalJsonValue(normalized));
}

/** @param {unknown} value @param {Readonly<Record<string, any>>} providerScope @param {Readonly<Record<string, any>>} artifact @param {string} path @returns {Readonly<{bucketName: string, key: string}>} */
function validateStageObject(value, providerScope, artifact, path) {
  const object = cloneDocument(value, path);
  assertAllKeys(object, STAGE_OBJECT_KEYS, path);
  const expected = getDeploymentArtifactStageObjectLocation(
    providerScope,
    artifact.artifactId,
  );
  if (object.bucketName !== expected.bucketName) {
    throw new Error(
      `${path}.bucketName must be the canonical control bucket for providerScope.`,
    );
  }
  if (object.key !== expected.key) {
    throw new Error(`${path}.key must be '${expected.key}'.`);
  }
  return expected;
}

/** @param {unknown} value @param {string} path @returns {Omit<DeploymentArtifactStageIntent, 'stageIntentId'>} */
function validateIntentPayload(value, path) {
  const intent = cloneDocument(value, path);
  assertAllKeys(intent, INTENT_PAYLOAD_KEYS, path);
  if (
    intent.schemaVersion !== DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION
  ) {
    throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
  }
  if (intent.kind !== DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND) {
    throw new TypeError(
      `${path}.kind must be '${DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND}'.`,
    );
  }
  const providerScope = validateProviderScope(
    intent.providerScope,
    `${path}.providerScope`,
  );
  const artifact = validateArtifact(intent.artifact, `${path}.artifact`);
  const normalized = {
    schemaVersion: DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION,
    kind: DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND,
    providerScope,
    artifact,
    object: validateStageObject(
      intent.object,
      providerScope,
      artifact,
      `${path}.object`,
    ),
    ownershipNonce: validateOwnershipNonce(
      intent.ownershipNonce,
      `${path}.ownershipNonce`,
    ),
  };
  assertManifestIsSecretFree(normalized, path);
  return /** @type {Omit<DeploymentArtifactStageIntent, 'stageIntentId'>} */ (
    deepFreeze(sortCanonicalJsonValue(normalized))
  );
}

/**
 * Create the immutable intent that must be durable before artifact upload.
 * The object location is derived rather than accepted from configuration.
 * @param {unknown} value - Provider scope, exact artifact, and fresh nonce.
 * @returns {Readonly<DeploymentArtifactStageIntent>} - Canonical intent.
 */
export function createDeploymentArtifactStageIntent(value) {
  const input = cloneDocument(value, 'deploymentArtifactStageIntent');
  assertAllKeys(input, INTENT_CREATE_KEYS, 'deploymentArtifactStageIntent');
  const artifact = validateArtifact(
    input.artifact,
    'deploymentArtifactStageIntent.artifact',
  );
  const payload = validateIntentPayload(
    {
      schemaVersion: DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION,
      kind: DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND,
      providerScope: input.providerScope,
      artifact,
      object: getDeploymentArtifactStageObjectLocation(
        input.providerScope,
        artifact.artifactId,
      ),
      ownershipNonce: input.ownershipNonce,
    },
    'deploymentArtifactStageIntent',
  );
  const stageIntentId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN,
    prefix: DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentArtifactStageIntent',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, stageIntentId }));
}

/**
 * Validate a serialized stage intent and recompute its complete identity.
 * @param {unknown} value - Candidate intent.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentArtifactStageIntent>} - Canonical intent.
 */
export function validateDeploymentArtifactStageIntent(
  value,
  valuePath = 'deploymentArtifactStageIntent',
) {
  const document = cloneDocument(value, valuePath);
  assertAllKeys(document, INTENT_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.stageIntentId,
    DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
    `${valuePath}.stageIntentId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of INTENT_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validateIntentPayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN,
    prefix: DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.stageIntentId !== expectedId) {
    throw new Error(
      `${valuePath}.stageIntentId does not match its exact staging intent.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, stageIntentId: expectedId }),
  );
}

/**
 * Validate an intent against the exact deployment authority. The immutable
 * deployment revision binds artifact/app/revision/profile, the profile binds
 * target and requested region, and the resolved provider scope binds the
 * credential account/partition/region used for staging.
 * @param {unknown} value - Candidate serialized intent.
 * @param {unknown} context - Deployment revision, profile, and full provider scope.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentArtifactStageIntent>} - Canonical intent.
 */
export function validateDeploymentArtifactStageIntentContext(
  value,
  context,
  valuePath = 'deploymentArtifactStageIntent',
) {
  const intent = validateDeploymentArtifactStageIntent(value, valuePath);
  const trusted = cloneDocument(context, `${valuePath}.context`);
  assertAllKeys(trusted, INTENT_CONTEXT_KEYS, `${valuePath}.context`);
  const deploymentRevision = validateDeploymentRevision(
    trusted.deploymentRevision,
    `${valuePath}.context.deploymentRevision`,
  );
  const profile = validateDeploymentProfile(
    trusted.profile,
    `${valuePath}.context.profile`,
  );
  const providerScope = validateProviderScope(
    trusted.providerScope,
    `${valuePath}.context.providerScope`,
  );
  if (intent.providerScope.providerScopeId !== providerScope.providerScopeId) {
    throw new Error(`${valuePath}.providerScope does not match context.`);
  }
  if (JSON.stringify(intent.providerScope) !== JSON.stringify(providerScope)) {
    throw new Error(`${valuePath}.providerScope does not match context.`);
  }
  if (profile.profileRevisionId !== deploymentRevision.profileRevisionId) {
    throw new Error(
      `${valuePath}.context deploymentRevision and profile do not match.`,
    );
  }
  if (
    profile.appId !== deploymentRevision.appId ||
    intent.artifact.appId !== deploymentRevision.appId
  ) {
    throw new Error(`${valuePath}.artifact.appId does not match context.`);
  }
  if (intent.artifact.revisionId !== deploymentRevision.revisionId) {
    throw new Error(`${valuePath}.artifact.revisionId does not match context.`);
  }
  if (intent.artifact.artifactId !== deploymentRevision.artifactId) {
    throw new Error(`${valuePath}.artifact.artifactId does not match context.`);
  }
  if (
    JSON.stringify(intent.artifact.target) !== JSON.stringify(profile.target)
  ) {
    throw new Error(`${valuePath}.artifact.target does not match context.`);
  }
  if (
    profile.provider.kind !== providerScope.provider ||
    profile.provider.scope.region !== providerScope.region
  ) {
    throw new Error(
      `${valuePath}.context profile and providerScope do not match.`,
    );
  }
  return intent;
}

/** @param {unknown} value @param {string} path @returns {DeploymentArtifactStageReceipt['object']} */
function validateReceiptObject(value, path) {
  const object = cloneDocument(value, path);
  assertAllKeys(object, RECEIPT_OBJECT_KEYS, path);
  if (
    typeof object.bucketName !== 'string' ||
    !CONTROL_BUCKET_PATTERN.test(object.bucketName)
  ) {
    throw new TypeError(
      `${path}.bucketName must be a canonical Wharfie deployment-control bucket name.`,
    );
  }
  if (typeof object.key !== 'string') {
    throw new TypeError(`${path}.key must be a string.`);
  }
  if (
    typeof object.versionId !== 'string' ||
    object.versionId === 'null' ||
    object.versionId.length === 0 ||
    !isWellFormedUnicode(object.versionId) ||
    Buffer.byteLength(object.versionId, 'utf8') >
      DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES
  ) {
    throw new TypeError(
      `${path}.versionId must be a nonempty, non-'null', well-formed opaque Unicode version ID no longer than ${DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  if (
    !Number.isSafeInteger(object.contentLength) ||
    object.contentLength < 0 ||
    object.contentLength > DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES
  ) {
    throw new TypeError(
      `${path}.contentLength must be a nonnegative safe integer no larger than ${DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES}.`,
    );
  }
  const checksum = validateSha256Digest(object.checksum, `${path}.checksum`);
  if (object.serverSideEncryption !== 'AES256') {
    throw new TypeError(`${path}.serverSideEncryption must be 'AES256'.`);
  }
  if (object.storageClass !== 'STANDARD') {
    throw new TypeError(`${path}.storageClass must be 'STANDARD'.`);
  }
  const normalized = {
    bucketName: object.bucketName,
    key: object.key,
    versionId: object.versionId,
    contentLength: object.contentLength,
    checksum,
    serverSideEncryption: 'AES256',
    storageClass: 'STANDARD',
  };
  const { versionId: _opaqueProviderVersionId, ...inspectable } = normalized;
  assertManifestIsSecretFree(inspectable, path);
  return /** @type {DeploymentArtifactStageReceipt['object']} */ (
    deepFreeze(sortCanonicalJsonValue(normalized))
  );
}

/** @param {unknown} value @param {string} path @returns {Omit<DeploymentArtifactStageReceipt, 'stageReceiptId'>} */
function validateReceiptPayload(value, path) {
  const receipt = cloneDocument(value, path);
  assertAllKeys(receipt, RECEIPT_PAYLOAD_KEYS, path);
  if (
    receipt.schemaVersion !== DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION
  ) {
    throw new TypeError(`${path}.schemaVersion must be the integer 1.`);
  }
  if (receipt.kind !== DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND) {
    throw new TypeError(
      `${path}.kind must be '${DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND}'.`,
    );
  }
  assertDomainSeparatedSha256Id(
    receipt.stageIntentId,
    DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
    `${path}.stageIntentId`,
  );
  assertArtifactId(receipt.artifactId, `${path}.artifactId`);
  const object = validateReceiptObject(receipt.object, `${path}.object`);
  const expectedKey = getDeploymentArtifactStageObjectKey(
    receipt.artifactId,
    `${path}.artifactId`,
  );
  if (object.key !== expectedKey) {
    throw new Error(`${path}.object.key must be '${expectedKey}'.`);
  }
  const normalized = {
    schemaVersion: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION,
    kind: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND,
    stageIntentId: receipt.stageIntentId,
    artifactId: receipt.artifactId,
    object,
  };
  assertManifestIsSecretFree(
    {
      ...normalized,
      object: {
        ...normalized.object,
        // Opaque provider identifiers are not user-authored secret material.
        versionId: 'opaque-provider-version-id',
      },
    },
    path,
  );
  return /** @type {Omit<DeploymentArtifactStageReceipt, 'stageReceiptId'>} */ (
    deepFreeze(sortCanonicalJsonValue(normalized))
  );
}

/**
 * Create exact object-version evidence and require it to satisfy a full intent.
 * @param {unknown} value - Full stage intent and exact provider evidence.
 * @returns {Readonly<DeploymentArtifactStageReceipt>} - Canonical receipt.
 */
export function createDeploymentArtifactStageReceipt(value) {
  const input = cloneDocument(value, 'deploymentArtifactStageReceipt');
  assertAllKeys(input, RECEIPT_CREATE_KEYS, 'deploymentArtifactStageReceipt');
  const stageIntent = validateDeploymentArtifactStageIntent(
    input.intent,
    'deploymentArtifactStageReceipt.intent',
  );
  const payload = validateReceiptPayload(
    {
      schemaVersion: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION,
      kind: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND,
      stageIntentId: stageIntent.stageIntentId,
      artifactId: stageIntent.artifact.artifactId,
      object: input.object,
    },
    'deploymentArtifactStageReceipt',
  );
  assertReceiptMatchesIntent(
    payload,
    stageIntent,
    'deploymentArtifactStageReceipt',
  );
  const stageReceiptId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
    prefix: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath: 'deploymentArtifactStageReceipt',
  });
  return deepFreeze(sortCanonicalJsonValue({ ...payload, stageReceiptId }));
}

/**
 * Validate a serialized receipt and recompute its content identity.
 * Trusted callers must additionally use the context validator before treating
 * the receipt as evidence for an intent.
 * @param {unknown} value - Candidate receipt.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentArtifactStageReceipt>} - Canonical receipt.
 */
export function validateDeploymentArtifactStageReceipt(
  value,
  valuePath = 'deploymentArtifactStageReceipt',
) {
  const document = cloneDocument(value, valuePath);
  assertAllKeys(document, RECEIPT_DOCUMENT_KEYS, valuePath);
  assertDomainSeparatedSha256Id(
    document.stageReceiptId,
    DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
    `${valuePath}.stageReceiptId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of RECEIPT_PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validateReceiptPayload(payloadInput, valuePath);
  const expectedId = createCanonicalJsonSha256Id({
    domain: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
    prefix: DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath,
  });
  if (document.stageReceiptId !== expectedId) {
    throw new Error(
      `${valuePath}.stageReceiptId does not match its exact object-version receipt.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({ ...payload, stageReceiptId: expectedId }),
  );
}

/** @param {Omit<DeploymentArtifactStageReceipt, 'stageReceiptId'>|DeploymentArtifactStageReceipt} receipt @param {DeploymentArtifactStageIntent} intent @param {string} path @returns {void} */
function assertReceiptMatchesIntent(receipt, intent, path) {
  if (receipt.stageIntentId !== intent.stageIntentId) {
    throw new Error(`${path}.stageIntentId does not match context.`);
  }
  if (receipt.artifactId !== intent.artifact.artifactId) {
    throw new Error(`${path}.artifactId does not match context.`);
  }
  if (
    receipt.object.bucketName !== intent.object.bucketName ||
    receipt.object.key !== intent.object.key
  ) {
    throw new Error(`${path}.object location does not match context.`);
  }
  if (receipt.object.contentLength !== intent.artifact.size) {
    throw new Error(`${path}.object.contentLength does not match context.`);
  }
  if (
    receipt.object.checksum.algorithm !==
      intent.artifact.byteDigest.algorithm ||
    receipt.object.checksum.value !== intent.artifact.byteDigest.value
  ) {
    throw new Error(`${path}.object.checksum does not match context.`);
  }
}

/**
 * Validate exact object-version evidence against the complete persisted intent.
 * @param {unknown} value - Candidate receipt.
 * @param {unknown} context - Exact stage intent context.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<DeploymentArtifactStageReceipt>} - Canonical receipt.
 */
export function validateDeploymentArtifactStageReceiptContext(
  value,
  context,
  valuePath = 'deploymentArtifactStageReceipt',
) {
  const receipt = validateDeploymentArtifactStageReceipt(value, valuePath);
  const trusted = cloneDocument(context, `${valuePath}.context`);
  assertAllKeys(trusted, RECEIPT_CONTEXT_KEYS, `${valuePath}.context`);
  const stageIntent = validateDeploymentArtifactStageIntent(
    trusted.intent,
    `${valuePath}.context.intent`,
  );
  assertReceiptMatchesIntent(receipt, stageIntent, valuePath);
  return receipt;
}

export default {
  DEPLOYMENT_ARTIFACT_STAGE_DOCUMENT_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_DOMAIN,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_KIND,
  DEPLOYMENT_ARTIFACT_STAGE_INTENT_SCHEMA_VERSION,
  DEPLOYMENT_ARTIFACT_STAGE_MAX_BYTES,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_DOMAIN,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_ID_PREFIX,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_KIND,
  DEPLOYMENT_ARTIFACT_STAGE_RECEIPT_SCHEMA_VERSION,
  DEPLOYMENT_ARTIFACT_STAGE_VERSION_ID_MAX_BYTES,
  createDeploymentArtifactStageIntent,
  createDeploymentArtifactStageReceipt,
  getDeploymentArtifactStageObjectKey,
  getDeploymentArtifactStageObjectLocation,
  getDeploymentControlBucketName,
  validateDeploymentArtifactStageIntent,
  validateDeploymentArtifactStageIntentContext,
  validateDeploymentArtifactStageReceipt,
  validateDeploymentArtifactStageReceiptContext,
};
