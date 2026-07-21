/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal boundary helpers are clearer than expanded parser-specific annotations. */

import { getDeploymentControlBucketName } from './deployment-artifact-stage.js';
import { validateProviderScope } from './deployment-provider-scope.js';
import {
  DEPLOYMENT_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS,
  DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX,
} from './deployment-service-health-contract.js';

export { getDeploymentControlBucketName };

export const DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS = 30;
export const DEPLOYMENT_CONTROL_BUCKET_VERSIONING_PROPAGATION_MS =
  15 * 60 * 1000;
export const DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_KEY =
  'control/v1/versioning-ready';
export const DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_CHECKSUM_SHA256 =
  '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=';
export const DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_PREFIX =
  DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX;
export const DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_LIFECYCLE_RULE_ID =
  'wharfie-expire-noncurrent-service-health-v2';
export const DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS =
  DEPLOYMENT_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS;

const FACTORY_KEYS = new Set([
  'client',
  'providerScope',
  'waitForReady',
  'waitForVersioningPropagation',
]);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'createBucket',
  'getBucketEncryption',
  'getBucketLifecycleConfiguration',
  'getBucketLocation',
  'getBucketOwnershipControls',
  'getBucketPolicy',
  'getBucketReplication',
  'getBucketTagging',
  'getBucketVersioning',
  'getPublicAccessBlock',
  'headBucket',
  'headObject',
  'putBucketEncryption',
  'putBucketLifecycleConfiguration',
  'putBucketOwnershipControls',
  'putBucketVersioning',
  'putPublicAccessBlock',
  'putObject',
]);
const PUBLIC_ACCESS_KEYS = new Set([
  'BlockPublicAcls',
  'BlockPublicPolicy',
  'IgnorePublicAcls',
  'RestrictPublicBuckets',
]);
const LIFECYCLE_RULE_KEYS = new Set([
  'ID',
  'Status',
  'Filter',
  'NoncurrentVersionExpiration',
]);
const LIFECYCLE_FILTER_KEYS = new Set(['Prefix']);
const NONCURRENT_VERSION_EXPIRATION_KEYS = new Set(['NoncurrentDays']);
const MAX_BUCKET_TAGS = 50;
const MAX_VERSION_ID_UTF8_BYTES = 1024;

const BASE_RESERVED_TAGS = Object.freeze({
  'wharfie:managed-by': 'wharfie',
  'wharfie:resource-kind': 'deployment-control-bucket',
  'wharfie:retention': 'retain',
  'wharfie:storage-schema-version': '1',
});

const BASE_VERSIONING_READY_METADATA = Object.freeze({
  'wharfie-kind': 'deployment-control-versioning-ready',
  'wharfie-retention': 'retain',
  'wharfie-schema-version': '1',
});

/**
 * @typedef DeploymentControlBucketClient
 * @property {(input: import('@aws-sdk/client-s3').CreateBucketCommandInput) => Promise<any>} createBucket - Create the retained bucket.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketEncryptionCommandInput) => Promise<any>} getBucketEncryption - Read default encryption.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketLifecycleConfigurationCommandInput) => Promise<any>} getBucketLifecycleConfiguration - Read exact service-health retention.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketLocationCommandInput) => Promise<any>} getBucketLocation - Read the bucket region.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketOwnershipControlsCommandInput) => Promise<any>} getBucketOwnershipControls - Read object ownership.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketPolicyCommandInput) => Promise<any>} getBucketPolicy - Prove bucket-policy absence.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketReplicationCommandInput) => Promise<any>} getBucketReplication - Prove replication absence.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketTaggingCommandInput) => Promise<any>} getBucketTagging - Read bucket tags.
 * @property {(input: import('@aws-sdk/client-s3').GetBucketVersioningCommandInput) => Promise<any>} getBucketVersioning - Read versioning state.
 * @property {(input: import('@aws-sdk/client-s3').GetPublicAccessBlockCommandInput) => Promise<any>} getPublicAccessBlock - Read public-access blocking.
 * @property {(input: import('@aws-sdk/client-s3').HeadBucketCommandInput) => Promise<any>} headBucket - Prove bucket ownership/existence.
 * @property {(input: import('@aws-sdk/client-s3').HeadObjectCommandInput) => Promise<any>} headObject - Read versioning-readiness evidence.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketEncryptionCommandInput) => Promise<any>} putBucketEncryption - Set SSE-S3 default encryption.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketLifecycleConfigurationCommandInput) => Promise<any>} putBucketLifecycleConfiguration - Expire only noncurrent service-health versions.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketOwnershipControlsCommandInput) => Promise<any>} putBucketOwnershipControls - Enforce bucket ownership.
 * @property {(input: import('@aws-sdk/client-s3').PutBucketVersioningCommandInput) => Promise<any>} putBucketVersioning - Enable versioning.
 * @property {(input: import('@aws-sdk/client-s3').PutPublicAccessBlockCommandInput) => Promise<any>} putPublicAccessBlock - Block all public access.
 * @property {(input: import('@aws-sdk/client-s3').PutObjectCommandInput) => Promise<any>} putObject - Write the fixed versioning-readiness sentinel.
 */

export class DeploymentControlBucketConflictError extends Error {
  constructor(
    message = 'AWS deployment control bucket conflicts with the required contract.',
  ) {
    super(message);
    this.name = 'DeploymentControlBucketConflictError';
    this.code = 'DEPLOYMENT_CONTROL_BUCKET_CONFLICT';
  }
}

export class DeploymentControlBucketUnknownError extends Error {
  constructor(message = 'AWS deployment control bucket state is unknown.') {
    super(message);
    this.name = 'DeploymentControlBucketUnknownError';
    this.code = 'DEPLOYMENT_CONTROL_BUCKET_UNKNOWN';
  }
}

class DeploymentControlBucketTagsNotVisibleError extends DeploymentControlBucketConflictError {}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} allowed @param {string} path @returns {void} */
function assertSupportedKeys(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${path} are invalid.`);
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

/** @param {unknown} error @param {...string} names @returns {boolean} */
function errorNamed(error, ...names) {
  const name =
    error && typeof error === 'object'
      ? /** @type {{name?: unknown}} */ (error).name
      : undefined;
  return typeof name === 'string' && names.includes(name);
}

/** @param {unknown} error @returns {boolean} */
function isBucketAbsentError(error) {
  if (errorNamed(error, 'NotFound', 'NoSuchBucket')) return true;
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{ $metadata?: {httpStatusCode?: unknown} }} */ (error).$metadata
      ?.httpStatusCode === 404
  );
}

/** @param {unknown} error @returns {boolean} */
function isObjectAbsentError(error) {
  return (
    errorNamed(error, 'NotFound', 'NoSuchKey') || isBucketAbsentError(error)
  );
}

/** @returns {Promise<void>} */
async function defaultWaitForReady() {
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

/** @returns {Promise<void>} */
async function defaultWaitForVersioningPropagation() {
  await new Promise((resolve) =>
    setTimeout(resolve, DEPLOYMENT_CONTROL_BUCKET_VERSIONING_PROPAGATION_MS),
  );
}

/** @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, string>>} */
function requiredTags(providerScope) {
  return Object.freeze({
    ...BASE_RESERVED_TAGS,
    'wharfie:provider-scope-id': providerScope.providerScopeId,
  });
}

/** @param {Readonly<Record<string, any>>} providerScope @returns {Readonly<Record<string, string>>} */
function versioningReadyMetadata(providerScope) {
  return Object.freeze({
    ...BASE_VERSIONING_READY_METADATA,
    'wharfie-provider-scope-id': providerScope.providerScopeId,
  });
}

/** @param {string} value @returns {boolean} */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} bucketName @returns {Readonly<Record<string, any>>} */
function absentEvidence(providerScope, bucketName) {
  return deepFreeze({
    schemaVersion: 1,
    kind: 'deploymentControlBucketInspection',
    status: 'absent',
    evidence: 'head-bucket-resource-not-found',
    bucketName,
    providerScopeId: providerScope.providerScopeId,
    bucketRegion: null,
    tagsConform: false,
    versioningEnabled: false,
    versioningWriteReady: false,
    publicAccessBlocked: false,
    objectOwnership: null,
    defaultEncryption: null,
    serviceHealthLifecycleConforms: false,
    bucketPolicyPresent: null,
    replicationConfigurationPresent: null,
  });
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<void>} */
async function validateHead(client, bucketName, accountId) {
  let response;
  try {
    response = await client.headBucket({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (isBucketAbsentError(error)) throw error;
    throw new DeploymentControlBucketUnknownError();
  }
  if (!isPlainObject(response)) {
    throw new DeploymentControlBucketUnknownError();
  }
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {Readonly<Record<string, any>>} providerScope @returns {Promise<string>} */
async function validateLocation(client, bucketName, providerScope) {
  let response;
  try {
    response = await client.getBucketLocation({
      Bucket: bucketName,
      ExpectedBucketOwner: providerScope.accountId,
    });
  } catch {
    throw new DeploymentControlBucketUnknownError();
  }
  if (!isPlainObject(response)) {
    throw new DeploymentControlBucketUnknownError();
  }
  const rawLocation = response.LocationConstraint;
  let region;
  if (rawLocation === undefined || rawLocation === null || rawLocation === '') {
    region = 'us-east-1';
  } else if (rawLocation === 'EU') {
    region = 'eu-west-1';
  } else if (typeof rawLocation === 'string' && rawLocation.length > 0) {
    region = rawLocation;
  } else {
    throw new DeploymentControlBucketUnknownError();
  }
  if (region !== providerScope.region) {
    throw new DeploymentControlBucketConflictError();
  }
  return region;
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @param {Readonly<Record<string, string>>} expected @returns {Promise<{ready: true, tags: Array<{Key: string, Value: string}>}>} */
async function inspectTags(client, bucketName, accountId, expected) {
  let response;
  try {
    response = await client.getBucketTagging({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (errorNamed(error, 'NoSuchTagSet')) {
      throw new DeploymentControlBucketTagsNotVisibleError();
    }
    throw new DeploymentControlBucketUnknownError();
  }
  if (!isPlainObject(response) || !Array.isArray(response.TagSet)) {
    throw new DeploymentControlBucketUnknownError();
  }
  if (response.TagSet.length > MAX_BUCKET_TAGS) {
    throw new DeploymentControlBucketConflictError();
  }
  const observed = new Map();
  const tags = [];
  for (const tag of response.TagSet) {
    if (
      !isPlainObject(tag) ||
      typeof tag.Key !== 'string' ||
      tag.Key.length === 0 ||
      typeof tag.Value !== 'string' ||
      observed.has(tag.Key)
    ) {
      throw new DeploymentControlBucketConflictError();
    }
    observed.set(tag.Key, tag.Value);
    tags.push({ Key: tag.Key, Value: tag.Value });
  }
  for (const [key, value] of observed) {
    if (key.startsWith('wharfie:') && expected[key] === undefined) {
      throw new DeploymentControlBucketConflictError();
    }
    if (expected[key] !== undefined && expected[key] !== value) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  const ready = Object.entries(expected).every(
    ([key, value]) => observed.get(key) === value,
  );
  if (!ready) {
    throw new DeploymentControlBucketTagsNotVisibleError();
  }
  return { ready: true, tags };
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<boolean>} */
async function inspectVersioning(client, bucketName, accountId) {
  let response;
  try {
    response = await client.getBucketVersioning({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch {
    throw new DeploymentControlBucketUnknownError();
  }
  if (!isPlainObject(response)) {
    throw new DeploymentControlBucketUnknownError();
  }
  if (response.MFADelete === 'Enabled') {
    throw new DeploymentControlBucketConflictError();
  }
  if (response.MFADelete !== undefined && response.MFADelete !== 'Disabled') {
    throw new DeploymentControlBucketUnknownError();
  }
  if (response.Status === 'Enabled') return true;
  if (response.Status === undefined) return false;
  if (response.Status === 'Suspended') {
    throw new DeploymentControlBucketConflictError();
  }
  throw new DeploymentControlBucketUnknownError();
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<boolean>} */
async function inspectPublicAccess(client, bucketName, accountId) {
  let response;
  try {
    response = await client.getPublicAccessBlock({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (errorNamed(error, 'NoSuchPublicAccessBlockConfiguration')) return false;
    throw new DeploymentControlBucketUnknownError();
  }
  const configuration = response?.PublicAccessBlockConfiguration;
  if (!isPlainObject(response) || !isPlainObject(configuration)) {
    throw new DeploymentControlBucketUnknownError();
  }
  for (const key of Object.keys(configuration)) {
    if (!PUBLIC_ACCESS_KEYS.has(key)) {
      throw new DeploymentControlBucketUnknownError();
    }
  }
  for (const key of PUBLIC_ACCESS_KEYS) {
    if (typeof configuration[key] !== 'boolean') {
      throw new DeploymentControlBucketUnknownError();
    }
  }
  return [...PUBLIC_ACCESS_KEYS].every((key) => configuration[key] === true);
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<{ready: boolean, value: string|null}>} */
async function inspectOwnership(client, bucketName, accountId) {
  let response;
  try {
    response = await client.getBucketOwnershipControls({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (
      errorNamed(
        error,
        'OwnershipControlsNotFoundError',
        'NoSuchOwnershipControls',
      )
    ) {
      return { ready: false, value: null };
    }
    throw new DeploymentControlBucketUnknownError();
  }
  const rules = response?.OwnershipControls?.Rules;
  if (!isPlainObject(response) || !Array.isArray(rules)) {
    throw new DeploymentControlBucketUnknownError();
  }
  if (
    rules.length !== 1 ||
    !isPlainObject(rules[0]) ||
    typeof rules[0].ObjectOwnership !== 'string'
  ) {
    throw new DeploymentControlBucketConflictError();
  }
  const value = rules[0].ObjectOwnership;
  if (
    value !== 'BucketOwnerEnforced' &&
    value !== 'BucketOwnerPreferred' &&
    value !== 'ObjectWriter'
  ) {
    throw new DeploymentControlBucketUnknownError();
  }
  return { ready: value === 'BucketOwnerEnforced', value };
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<{ready: boolean, value: string|null}>} */
async function inspectEncryption(client, bucketName, accountId) {
  let response;
  try {
    response = await client.getBucketEncryption({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (errorNamed(error, 'ServerSideEncryptionConfigurationNotFoundError')) {
      return { ready: false, value: null };
    }
    throw new DeploymentControlBucketUnknownError();
  }
  const rules = response?.ServerSideEncryptionConfiguration?.Rules;
  if (!isPlainObject(response) || !Array.isArray(rules)) {
    throw new DeploymentControlBucketUnknownError();
  }
  if (rules.length !== 1 || !isPlainObject(rules[0])) {
    throw new DeploymentControlBucketConflictError();
  }
  const rule = rules[0];
  const defaults = rule.ApplyServerSideEncryptionByDefault;
  if (!isPlainObject(defaults) || typeof defaults.SSEAlgorithm !== 'string') {
    throw new DeploymentControlBucketUnknownError();
  }
  if (
    defaults.SSEAlgorithm !== 'AES256' ||
    defaults.KMSMasterKeyID !== undefined ||
    (rule.BucketKeyEnabled !== undefined && rule.BucketKeyEnabled !== false)
  ) {
    throw new DeploymentControlBucketConflictError();
  }
  return { ready: true, value: 'AES256' };
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {Readonly<Record<string, any>>} providerScope @returns {Promise<{status: 'absent'|'unversioned'|'ready', versionId: string|null}>} */
async function inspectVersioningReady(client, bucketName, providerScope) {
  let response;
  try {
    response = await client.headObject({
      Bucket: bucketName,
      Key: DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_KEY,
      ExpectedBucketOwner: providerScope.accountId,
      ChecksumMode: 'ENABLED',
    });
  } catch (error) {
    if (isObjectAbsentError(error)) {
      return { status: 'absent', versionId: null };
    }
    throw new DeploymentControlBucketUnknownError();
  }
  if (!isPlainObject(response)) {
    throw new DeploymentControlBucketUnknownError();
  }
  const metadata = response.Metadata;
  const expectedMetadata = versioningReadyMetadata(providerScope);
  const metadataMatches =
    isPlainObject(metadata) &&
    Object.keys(metadata).length === Object.keys(expectedMetadata).length &&
    Object.entries(expectedMetadata).every(
      ([key, value]) => metadata[key] === value,
    );
  const storageClass = response.StorageClass ?? 'STANDARD';
  if (
    response.ContentLength !== 0 ||
    response.ChecksumSHA256 !==
      DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_CHECKSUM_SHA256 ||
    response.ContentType !== 'application/octet-stream' ||
    response.ServerSideEncryption !== 'AES256' ||
    storageClass !== 'STANDARD' ||
    response.DeleteMarker === true ||
    !metadataMatches
  ) {
    throw new DeploymentControlBucketConflictError();
  }
  const versionId = response.VersionId;
  if (versionId === undefined || versionId === null || versionId === 'null') {
    return { status: 'unversioned', versionId: null };
  }
  if (
    typeof versionId !== 'string' ||
    versionId.length === 0 ||
    !isWellFormedUnicode(versionId) ||
    Buffer.byteLength(versionId, 'utf8') > MAX_VERSION_ID_UTF8_BYTES
  ) {
    throw new DeploymentControlBucketConflictError();
  }
  return { status: 'ready', versionId };
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<boolean>} */
async function inspectServiceHealthLifecycle(client, bucketName, accountId) {
  let response;
  try {
    response = await client.getBucketLifecycleConfiguration({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (errorNamed(error, 'NoSuchLifecycleConfiguration')) return false;
    throw new DeploymentControlBucketUnknownError();
  }
  if (!isPlainObject(response) || !Array.isArray(response.Rules)) {
    throw new DeploymentControlBucketUnknownError();
  }
  if (response.Rules.length !== 1) {
    throw new DeploymentControlBucketConflictError();
  }
  const rule = response.Rules[0];
  if (!isPlainObject(rule)) {
    throw new DeploymentControlBucketUnknownError();
  }
  for (const key of LIFECYCLE_RULE_KEYS) {
    if (!Object.hasOwn(rule, key)) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  for (const key of Object.keys(rule)) {
    if (!LIFECYCLE_RULE_KEYS.has(key)) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  if (
    typeof rule.ID !== 'string' ||
    typeof rule.Status !== 'string' ||
    !isPlainObject(rule.Filter) ||
    !isPlainObject(rule.NoncurrentVersionExpiration)
  ) {
    throw new DeploymentControlBucketUnknownError();
  }
  for (const key of Object.keys(rule.Filter)) {
    if (!LIFECYCLE_FILTER_KEYS.has(key)) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  for (const key of LIFECYCLE_FILTER_KEYS) {
    if (!Object.hasOwn(rule.Filter, key)) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  for (const key of Object.keys(rule.NoncurrentVersionExpiration)) {
    if (!NONCURRENT_VERSION_EXPIRATION_KEYS.has(key)) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  for (const key of NONCURRENT_VERSION_EXPIRATION_KEYS) {
    if (!Object.hasOwn(rule.NoncurrentVersionExpiration, key)) {
      throw new DeploymentControlBucketConflictError();
    }
  }
  if (
    typeof rule.Filter.Prefix !== 'string' ||
    !Number.isSafeInteger(rule.NoncurrentVersionExpiration.NoncurrentDays) ||
    rule.NoncurrentVersionExpiration.NoncurrentDays < 1
  ) {
    throw new DeploymentControlBucketUnknownError();
  }
  if (
    rule.ID !== DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_LIFECYCLE_RULE_ID ||
    rule.Status !== 'Enabled' ||
    rule.Filter.Prefix !== DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_PREFIX ||
    rule.NoncurrentVersionExpiration.NoncurrentDays !==
      DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS
  ) {
    throw new DeploymentControlBucketConflictError();
  }
  return true;
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<void>} */
async function validateNoBucketPolicy(client, bucketName, accountId) {
  try {
    await client.getBucketPolicy({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (errorNamed(error, 'NoSuchBucketPolicy')) return;
    throw new DeploymentControlBucketUnknownError();
  }
  throw new DeploymentControlBucketConflictError();
}

/** @param {DeploymentControlBucketClient} client @param {string} bucketName @param {string} accountId @returns {Promise<void>} */
async function validateNoReplication(client, bucketName, accountId) {
  let response;
  try {
    response = await client.getBucketReplication({
      Bucket: bucketName,
      ExpectedBucketOwner: accountId,
    });
  } catch (error) {
    if (errorNamed(error, 'ReplicationConfigurationNotFoundError')) return;
    throw new DeploymentControlBucketUnknownError();
  }
  if (
    !isPlainObject(response) ||
    !isPlainObject(response.ReplicationConfiguration)
  ) {
    throw new DeploymentControlBucketUnknownError();
  }
  throw new DeploymentControlBucketConflictError();
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} bucketName @returns {Readonly<import('@aws-sdk/client-s3').CreateBucketCommandInput>} */
function createBucketRequest(providerScope, bucketName) {
  const tags = Object.entries(requiredTags(providerScope)).map(
    ([Key, Value]) => ({ Key, Value }),
  );
  return deepFreeze({
    Bucket: bucketName,
    ObjectOwnership: 'BucketOwnerEnforced',
    CreateBucketConfiguration: {
      ...(providerScope.region === 'us-east-1'
        ? {}
        : { LocationConstraint: providerScope.region }),
      Tags: tags,
    },
  });
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} bucketName @param {boolean} onlyIfAbsent @returns {Readonly<import('@aws-sdk/client-s3').PutObjectCommandInput>} */
function putVersioningReadyRequest(providerScope, bucketName, onlyIfAbsent) {
  return deepFreeze({
    Bucket: bucketName,
    Key: DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_KEY,
    ExpectedBucketOwner: providerScope.accountId,
    Body: new Uint8Array(0),
    ContentLength: 0,
    ContentType: 'application/octet-stream',
    ChecksumAlgorithm: 'SHA256',
    ChecksumSHA256: DEPLOYMENT_CONTROL_BUCKET_VERSIONING_READY_CHECKSUM_SHA256,
    ServerSideEncryption: 'AES256',
    StorageClass: 'STANDARD',
    Metadata: versioningReadyMetadata(providerScope),
    ...(onlyIfAbsent ? { IfNoneMatch: '*' } : {}),
  });
}

/** @param {Readonly<Record<string, any>>} providerScope @param {string} bucketName @returns {Readonly<import('@aws-sdk/client-s3').PutBucketLifecycleConfigurationCommandInput>} */
function putServiceHealthLifecycleRequest(providerScope, bucketName) {
  return deepFreeze({
    Bucket: bucketName,
    ExpectedBucketOwner: providerScope.accountId,
    LifecycleConfiguration: {
      Rules: [
        {
          ID: DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_LIFECYCLE_RULE_ID,
          Status: 'Enabled',
          Filter: {
            Prefix: DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_PREFIX,
          },
          NoncurrentVersionExpiration: {
            NoncurrentDays:
              DEPLOYMENT_CONTROL_BUCKET_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS,
          },
        },
      ],
    },
  });
}

/**
 * Bind the fixed, retained deployment-control bucket lifecycle to one exact
 * AWS provider scope. `inspect` is strictly read-only; `bootstrap` is the only
 * mutating entry point and never deletes the bucket or weakens its settings.
 * The supplied client remains owned by the caller.
 * @param {{client: DeploymentControlBucketClient, providerScope: unknown, waitForReady?: (attempt: number) => Promise<void>, waitForVersioningPropagation?: (attempt: number) => Promise<void>}} options - Explicit client, scope, and optional wait hooks.
 * @returns {Readonly<{bucketName: string, inspect: () => Promise<Readonly<Record<string, any>>>, bootstrap: () => Promise<Readonly<Record<string, any>>>}>} - Bucket lifecycle API.
 */
export function createDeploymentControlBucket(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('deploymentControlBucket options must be an object.');
  }
  assertSupportedKeys(options, FACTORY_KEYS, 'deploymentControlBucket options');
  if (
    !Object.hasOwn(options, 'client') ||
    !Object.hasOwn(options, 'providerScope')
  ) {
    throw new TypeError(
      'deploymentControlBucket client and providerScope are required.',
    );
  }
  const client = options.client;
  if (!client || typeof client !== 'object') {
    throw new TypeError('deploymentControlBucket client must be an object.');
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof (/** @type {any} */ (client)[method]) !== 'function') {
      throw new TypeError(
        `deploymentControlBucket client.${method} is required.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'deploymentControlBucket providerScope',
  );
  const waitForReady = options.waitForReady ?? defaultWaitForReady;
  if (typeof waitForReady !== 'function') {
    throw new TypeError(
      'deploymentControlBucket waitForReady must be a function.',
    );
  }
  const waitForVersioningPropagation =
    options.waitForVersioningPropagation ?? defaultWaitForVersioningPropagation;
  if (typeof waitForVersioningPropagation !== 'function') {
    throw new TypeError(
      'deploymentControlBucket waitForVersioningPropagation must be a function.',
    );
  }
  const bucketName = getDeploymentControlBucketName(providerScope);
  const expectedTags = requiredTags(providerScope);

  /** @returns {Promise<{state: Readonly<Record<string, any>>, needs: Record<string, boolean>, sentinel: {status: 'absent'|'unversioned'|'ready', versionId: string|null}}>} */
  async function inspectObserved() {
    try {
      await validateHead(client, bucketName, providerScope.accountId);
    } catch (error) {
      if (isBucketAbsentError(error)) {
        return {
          state: absentEvidence(providerScope, bucketName),
          needs: {},
          sentinel: { status: 'absent', versionId: null },
        };
      }
      throw error;
    }
    const region = await validateLocation(client, bucketName, providerScope);
    const tags = await inspectTags(
      client,
      bucketName,
      providerScope.accountId,
      expectedTags,
    );
    const versioningEnabled = await inspectVersioning(
      client,
      bucketName,
      providerScope.accountId,
    );
    const publicAccessBlocked = await inspectPublicAccess(
      client,
      bucketName,
      providerScope.accountId,
    );
    const ownership = await inspectOwnership(
      client,
      bucketName,
      providerScope.accountId,
    );
    const encryption = await inspectEncryption(
      client,
      bucketName,
      providerScope.accountId,
    );
    const serviceHealthLifecycleConforms = await inspectServiceHealthLifecycle(
      client,
      bucketName,
      providerScope.accountId,
    );
    await validateNoBucketPolicy(client, bucketName, providerScope.accountId);
    await validateNoReplication(client, bucketName, providerScope.accountId);
    const sentinel = await inspectVersioningReady(
      client,
      bucketName,
      providerScope,
    );
    if (!versioningEnabled && sentinel.status === 'ready') {
      throw new DeploymentControlBucketConflictError();
    }

    const active =
      tags.ready &&
      versioningEnabled &&
      sentinel.status === 'ready' &&
      publicAccessBlocked &&
      ownership.ready &&
      encryption.ready &&
      serviceHealthLifecycleConforms;
    return {
      state: deepFreeze({
        schemaVersion: 1,
        kind: 'deploymentControlBucketInspection',
        status: active ? 'active' : 'bootstrap-required',
        evidence:
          'head-location-tags-versioning-public-access-ownership-encryption-service-health-lifecycle-no-policy-no-replication-and-versioned-sentinel',
        bucketName,
        providerScopeId: providerScope.providerScopeId,
        bucketRegion: region,
        tagsConform: tags.ready,
        versioningEnabled,
        versioningWriteReady: sentinel.status === 'ready',
        publicAccessBlocked,
        objectOwnership: ownership.value,
        defaultEncryption: encryption.value,
        serviceHealthLifecycleConforms,
        bucketPolicyPresent: false,
        replicationConfigurationPresent: false,
      }),
      needs: {
        versioning: !versioningEnabled,
        publicAccess: !publicAccessBlocked,
        ownership: !ownership.ready,
        encryption: !encryption.ready,
        lifecycle: !serviceHealthLifecycleConforms,
        sentinel: sentinel.status !== 'ready',
      },
      sentinel,
    };
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  async function inspect() {
    return (await inspectObserved()).state;
  }

  /** @param {(observed: {state: Readonly<Record<string, any>>, needs: Record<string, boolean>, sentinel: {status: 'absent'|'unversioned'|'ready', versionId: string|null}}) => boolean} accepted @param {boolean} [retryMissingTags] @returns {Promise<{state: Readonly<Record<string, any>>, needs: Record<string, boolean>, sentinel: {status: 'absent'|'unversioned'|'ready', versionId: string|null}}>} */
  async function awaitInspection(accepted, retryMissingTags = false) {
    for (
      let attempt = 0;
      attempt < DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS;
      attempt += 1
    ) {
      let observed;
      try {
        observed = await inspectObserved();
      } catch (error) {
        const retryable =
          error instanceof DeploymentControlBucketUnknownError ||
          (retryMissingTags &&
            error instanceof DeploymentControlBucketTagsNotVisibleError);
        if (!retryable) {
          throw error;
        }
        if (attempt + 1 === DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS) {
          throw error;
        }
        try {
          await waitForReady(attempt + 1);
        } catch {
          throw new DeploymentControlBucketUnknownError();
        }
        continue;
      }
      if (accepted(observed)) return observed;
      if (attempt + 1 < DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS) {
        try {
          await waitForReady(attempt + 1);
        } catch {
          throw new DeploymentControlBucketUnknownError();
        }
      }
    }
    throw new DeploymentControlBucketUnknownError();
  }

  /** @param {() => Promise<any>} write @returns {Promise<void>} */
  async function attemptWrite(write) {
    try {
      await write();
    } catch {
      // Every mutator is resolved through the same exact bounded readback, so
      // success, a concurrent equivalent write, and response loss converge.
    }
  }

  /** @param {{needs: Record<string, boolean>}} observed @returns {boolean} */
  function settingsReady(observed) {
    return (
      observed.needs.versioning === false &&
      observed.needs.publicAccess === false &&
      observed.needs.ownership === false &&
      observed.needs.encryption === false &&
      observed.needs.lifecycle === false
    );
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function waitForRetry(attempt) {
    try {
      await waitForReady(attempt);
    } catch {
      throw new DeploymentControlBucketUnknownError();
    }
  }

  /** @param {number} attempt @returns {Promise<void>} */
  async function waitForPropagation(attempt) {
    try {
      await waitForVersioningPropagation(attempt);
    } catch {
      throw new DeploymentControlBucketUnknownError();
    }
  }

  /** @param {{state: Readonly<Record<string, any>>, needs: Record<string, boolean>, sentinel: {status: 'absent'|'unversioned'|'ready', versionId: string|null}}} initial @returns {Promise<Readonly<Record<string, any>>>} */
  async function convergeVersioningReady(initial) {
    let observed = initial;
    if (observed.state.status === 'active') return observed.state;
    if (!settingsReady(observed)) {
      throw new DeploymentControlBucketUnknownError();
    }
    // S3 documents a propagation window after versioning is first enabled.
    // Each bootstrap invocation that might write the sentinel waits the full
    // interval once, including after a process restart, then proves current
    // settings and sentinel state again before its first object write.
    await waitForPropagation(1);
    observed = await awaitInspection(
      (candidate) => settingsReady(candidate),
      true,
    );
    if (observed.state.status === 'active') return observed.state;

    let writeNeeded = true;
    for (
      let attempt = 0;
      attempt < DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS;
      attempt += 1
    ) {
      if (observed.state.status === 'active') return observed.state;
      if (!settingsReady(observed)) {
        throw new DeploymentControlBucketUnknownError();
      }
      if (writeNeeded) {
        const onlyIfAbsent = observed.sentinel.status === 'absent';
        if (!onlyIfAbsent && observed.sentinel.status !== 'unversioned') {
          throw new DeploymentControlBucketUnknownError();
        }
        await attemptWrite(() =>
          client.putObject(
            putVersioningReadyRequest(providerScope, bucketName, onlyIfAbsent),
          ),
        );
        writeNeeded = false;
      }

      try {
        observed = await inspectObserved();
      } catch (error) {
        if (!(error instanceof DeploymentControlBucketUnknownError)) {
          throw error;
        }
        if (attempt + 1 === DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS) {
          throw error;
        }
        await waitForRetry(attempt + 1);
        continue;
      }
      if (observed.state.status === 'active') return observed.state;
      if (!settingsReady(observed)) {
        throw new DeploymentControlBucketUnknownError();
      }
      writeNeeded = true;
      if (attempt + 1 < DEPLOYMENT_CONTROL_BUCKET_MAX_INSPECTION_ATTEMPTS) {
        await waitForRetry(attempt + 1);
      }
    }
    throw new DeploymentControlBucketUnknownError();
  }

  /** @returns {Promise<Readonly<Record<string, any>>>} */
  async function bootstrap() {
    let observed = await awaitInspection(() => true, true);
    if (observed.state.status === 'absent') {
      await attemptWrite(() =>
        client.createBucket(createBucketRequest(providerScope, bucketName)),
      );
      observed = await awaitInspection(
        (candidate) => candidate.state.status !== 'absent',
        true,
      );
    }
    if (observed.state.status === 'active') return observed.state;
    if (observed.state.status !== 'bootstrap-required') {
      throw new DeploymentControlBucketUnknownError();
    }

    if (observed.needs.publicAccess) {
      await attemptWrite(() =>
        client.putPublicAccessBlock({
          Bucket: bucketName,
          ExpectedBucketOwner: providerScope.accountId,
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
        }),
      );
    }
    if (observed.needs.ownership) {
      await attemptWrite(() =>
        client.putBucketOwnershipControls({
          Bucket: bucketName,
          ExpectedBucketOwner: providerScope.accountId,
          OwnershipControls: {
            Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
          },
        }),
      );
    }
    if (observed.needs.encryption) {
      await attemptWrite(() =>
        client.putBucketEncryption({
          Bucket: bucketName,
          ExpectedBucketOwner: providerScope.accountId,
          ServerSideEncryptionConfiguration: {
            Rules: [
              {
                ApplyServerSideEncryptionByDefault: {
                  SSEAlgorithm: 'AES256',
                },
              },
            ],
          },
        }),
      );
    }
    if (observed.needs.versioning) {
      await attemptWrite(() =>
        client.putBucketVersioning({
          Bucket: bucketName,
          ExpectedBucketOwner: providerScope.accountId,
          VersioningConfiguration: { Status: 'Enabled' },
        }),
      );
    }
    if (observed.needs.lifecycle) {
      await attemptWrite(() =>
        client.putBucketLifecycleConfiguration(
          putServiceHealthLifecycleRequest(providerScope, bucketName),
        ),
      );
    }
    observed = await awaitInspection(
      (candidate) => settingsReady(candidate),
      true,
    );
    if (observed.state.status === 'active') return observed.state;
    return await convergeVersioningReady(observed);
  }

  return Object.freeze({ bucketName, inspect, bootstrap });
}

export default { createDeploymentControlBucket };
