/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact boundary contracts are clearer than parser-specific expansions. */

import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';

import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import {
  getDeploymentInstanceId,
  validateProviderScope,
} from './deployment-provider-scope.js';
import { validateDeploymentRevision } from './deployment-revision.js';
import {
  getDeploymentServiceHealthObjectKey,
  getDeploymentServiceHealthObjectLocation,
  validateDeploymentServiceHealthReceipt,
  validateDeploymentServiceHealthReceiptContext,
  validateDeploymentServiceHealthReceiptSuccessor,
} from './deployment-service-health.js';
import { DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES } from './deployment-service-health-contract.js';
import { cloneBoundedJsonObject } from './json-value.js';

export const DEPLOYMENT_SERVICE_HEALTH_CONTENT_TYPE =
  'application/vnd.wharfie.deployment-service-health+json';
export const DEPLOYMENT_SERVICE_HEALTH_CACHE_CONTROL = 'no-store';
export const DEPLOYMENT_SERVICE_HEALTH_METADATA_SCHEMA =
  'deployment-service-health-v1';
export { DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES };
export const DEPLOYMENT_SERVICE_HEALTH_DEFAULT_MAX_ATTEMPTS = 3;

const FACTORY_KEYS = new Set(['client', 'providerScope', 'now', 'maxAttempts']);
const CONTEXT_KEYS = new Set([
  'deploymentRevision',
  'profile',
  'providerScope',
  'providerSpec',
  'head',
]);
const OBSERVATION_KEYS = new Set(['receipt', 'object']);
const OBSERVATION_OBJECT_KEYS = new Set([
  'bucketName',
  'key',
  'versionId',
  'etag',
  'lastModifiedAt',
]);
const FRESHNESS_CONTEXT_KEYS = new Set([
  'now',
  'maxAgeSeconds',
  'clockSkewSeconds',
]);
const METADATA_KEYS = new Set(['wharfie-schema', 'wharfie-receipt']);
const REQUIRED_CLIENT_METHODS = Object.freeze([
  'getObject',
  'headObject',
  'putObject',
]);
const CONTROL_BUCKET_PATTERN = /^wharfie-dc-v1-[0-9]{12}-[a-f0-9]{20}$/;
const MAX_VERSION_ID_UTF8_BYTES = 1024;
const MAX_ETAG_UTF8_BYTES = 1024;
const MAX_ATTEMPTS = 10;

/**
 * The current health object does not exist.
 */
export class DeploymentServiceHealthMissingError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super('Required deployment service-health evidence is absent.', options);
    this.name = 'DeploymentServiceHealthMissingError';
    this.code = 'DEPLOYMENT_SERVICE_HEALTH_MISSING';
  }
}

/**
 * The current health object exists but is older than its pinned freshness
 * window.
 */
export class DeploymentServiceHealthStaleError extends Error {
  constructor() {
    super('Deployment service-health evidence is stale.');
    this.name = 'DeploymentServiceHealthStaleError';
    this.code = 'DEPLOYMENT_SERVICE_HEALTH_STALE';
  }
}

/**
 * Provider evidence exists but contradicts the health receipt contract.
 */
export class DeploymentServiceHealthConflictError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super(
      'Deployment service-health evidence conflicts with its contract.',
      options,
    );
    this.name = 'DeploymentServiceHealthConflictError';
    this.code = 'DEPLOYMENT_SERVICE_HEALTH_CONFLICT';
  }
}

/**
 * A provider operation or conditional publication could not be resolved by
 * bounded authoritative readback.
 */
export class DeploymentServiceHealthUnknownError extends Error {
  /** @param {{cause?: unknown}} [options] - Optional non-rendered cause. */
  constructor(options = {}) {
    super('Deployment service-health state is unknown.', options);
    this.name = 'DeploymentServiceHealthUnknownError';
    this.code = 'DEPLOYMENT_SERVICE_HEALTH_UNKNOWN';
  }
}

class CurrentVersionRaceError extends Error {}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isObjectRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

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

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function exactJsonEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {unknown} error @returns {boolean} */
function isMissingObjectError(error) {
  if (!isObjectRecord(error)) return false;
  if (
    error.name === 'NotFound' ||
    error.name === 'NoSuchKey' ||
    error.name === 'NoSuchVersion' ||
    error.name === 'NoSuchBucket'
  ) {
    return true;
  }
  return error.$metadata?.httpStatusCode === 404;
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
    value !== 'null' &&
    value.length > 0 &&
    isWellFormedUnicode(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_VERSION_ID_UTF8_BYTES
  );
}

/**
 * An S3 ETag is used only as an opaque conditional-write token. Its spelling
 * is never interpreted as a digest or ordering value.
 * @param {unknown} value - Candidate ETag.
 * @returns {value is string} - Whether it can be safely replayed to If-Match.
 */
function isUsableOpaqueEtag(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    isWellFormedUnicode(value) &&
    !/[\r\n]/u.test(value) &&
    Buffer.byteLength(value, 'utf8') <= MAX_ETAG_UTF8_BYTES
  );
}

/** @param {unknown} value @returns {number|null} */
function getCanonicalEpochMilliseconds(value) {
  if (!(value instanceof Date)) return null;
  const milliseconds = value.getTime();
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0
    ? milliseconds
    : null;
}

/** @param {Readonly<Record<string, any>>} receipt @returns {Readonly<Record<string, string>>} */
function createMetadata(receipt) {
  return Object.freeze({
    'wharfie-schema': DEPLOYMENT_SERVICE_HEALTH_METADATA_SCHEMA,
    'wharfie-receipt': receipt.receiptId,
  });
}

/** @param {unknown} metadata @param {Readonly<Record<string, string>>} expected @returns {void} */
function assertExactMetadata(metadata, expected) {
  if (!isObjectRecord(metadata)) {
    throw new DeploymentServiceHealthConflictError();
  }
  const keys = Object.keys(metadata);
  if (
    keys.length !== METADATA_KEYS.size ||
    keys.some((key) => !METADATA_KEYS.has(key))
  ) {
    throw new DeploymentServiceHealthConflictError();
  }
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (metadata[key] !== expectedValue) {
      throw new DeploymentServiceHealthConflictError();
    }
  }
}

/** @param {Buffer} bytes @returns {string} */
function checksumSha256(bytes) {
  return createHash('sha256').update(bytes).digest('base64');
}

/** @param {unknown} body @returns {void} */
function destroyBodyBestEffort(body) {
  if (!isObjectRecord(body) || typeof body.destroy !== 'function') return;
  try {
    body.destroy();
  } catch {
    // The authoritative validation failure wins over transport cleanup.
  }
}

/** @param {unknown} body @returns {Promise<Buffer>} */
async function readBoundedBody(body) {
  if (body instanceof Uint8Array) {
    if (body.byteLength > DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES) {
      throw new DeploymentServiceHealthConflictError();
    }
    return Buffer.from(body);
  }
  if (!isObjectRecord(body)) {
    throw new DeploymentServiceHealthConflictError();
  }
  const asyncBody =
    /** @type {AsyncIterable<unknown> & {destroy?: () => unknown}} */ (body);
  if (typeof asyncBody[Symbol.asyncIterator] !== 'function') {
    destroyBodyBestEffort(body);
    throw new DeploymentServiceHealthConflictError();
  }

  /** @type {Buffer[]} */
  const chunks = [];
  let byteLength = 0;
  try {
    for await (const chunk of asyncBody) {
      let bytes;
      if (typeof chunk === 'string') bytes = Buffer.from(chunk, 'utf8');
      else if (chunk instanceof Uint8Array) bytes = Buffer.from(chunk);
      else if (chunk instanceof ArrayBuffer) bytes = Buffer.from(chunk);
      else throw new DeploymentServiceHealthConflictError();
      byteLength += bytes.byteLength;
      if (byteLength > DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES) {
        throw new DeploymentServiceHealthConflictError();
      }
      chunks.push(bytes);
    }
  } catch (error) {
    destroyBodyBestEffort(asyncBody);
    if (error instanceof DeploymentServiceHealthConflictError) throw error;
    throw new DeploymentServiceHealthUnknownError({ cause: error });
  }
  return Buffer.concat(chunks, byteLength);
}

/** @param {Buffer} bytes @param {Readonly<Record<string, any>>} context @param {Readonly<Record<string, string>>} location @param {Readonly<Record<string, any>>} providerScope @param {boolean} requireCurrentContext @returns {Readonly<Record<string, any>>} */
function parseReceipt(
  bytes,
  context,
  location,
  providerScope,
  requireCurrentContext,
) {
  let text;
  let parsed;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch (error) {
    throw new DeploymentServiceHealthConflictError({ cause: error });
  }
  let receipt;
  try {
    receipt = requireCurrentContext
      ? validateDeploymentServiceHealthReceiptContext(
          parsed,
          context,
          'deploymentServiceHealthS3 receipt',
        )
      : validateDeploymentServiceHealthReceipt(
          parsed,
          'deploymentServiceHealthS3 receipt',
        );
  } catch (error) {
    throw new DeploymentServiceHealthConflictError({ cause: error });
  }
  if (JSON.stringify(receipt) !== text) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (receipt.providerScopeId !== providerScope.providerScopeId) {
    throw new DeploymentServiceHealthConflictError();
  }
  let receiptLocation;
  try {
    receiptLocation = getDeploymentServiceHealthObjectLocation(
      providerScope,
      receipt,
    );
  } catch (error) {
    throw new DeploymentServiceHealthConflictError({ cause: error });
  }
  if (!exactJsonEqual(receiptLocation, location)) {
    throw new DeploymentServiceHealthConflictError();
  }
  return receipt;
}

/** @param {Record<string, any>} response @param {{bytes: Buffer, receipt: Readonly<Record<string, any>>, location: Readonly<Record<string, string>>}} expected @returns {{versionId: string, etag: string, lastModifiedAt: number}} */
function validateObjectEnvelope(response, expected) {
  if (!isUsableVersionId(response.VersionId)) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (!isUsableOpaqueEtag(response.ETag)) {
    throw new DeploymentServiceHealthConflictError();
  }
  const lastModifiedAt = getCanonicalEpochMilliseconds(response.LastModified);
  if (lastModifiedAt === null) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (response.ContentLength !== expected.bytes.byteLength) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (response.ChecksumSHA256 !== checksumSha256(expected.bytes)) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (response.ServerSideEncryption !== 'AES256') {
    throw new DeploymentServiceHealthConflictError();
  }
  if ((response.StorageClass ?? 'STANDARD') !== 'STANDARD') {
    throw new DeploymentServiceHealthConflictError();
  }
  if (response.ContentType !== DEPLOYMENT_SERVICE_HEALTH_CONTENT_TYPE) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (response.CacheControl !== DEPLOYMENT_SERVICE_HEALTH_CACHE_CONTROL) {
    throw new DeploymentServiceHealthConflictError();
  }
  assertExactMetadata(response.Metadata, createMetadata(expected.receipt));
  return {
    versionId: response.VersionId,
    etag: response.ETag,
    lastModifiedAt,
  };
}

/** @param {unknown} value @param {string} [valuePath] @returns {Readonly<Record<string, any>>} */
export function validateDeploymentServiceHealthObservation(
  value,
  valuePath = 'deploymentServiceHealthObservation',
) {
  const observation = cloneBoundedJsonObject(
    value,
    DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES * 2,
    valuePath,
  );
  assertAllKeys(observation, OBSERVATION_KEYS, valuePath);
  const receipt = validateDeploymentServiceHealthReceipt(
    observation.receipt,
    `${valuePath}.receipt`,
  );
  if (!isObjectRecord(observation.object)) {
    throw new TypeError(`${valuePath}.object must be an object.`);
  }
  assertAllKeys(
    observation.object,
    OBSERVATION_OBJECT_KEYS,
    `${valuePath}.object`,
  );
  if (
    typeof observation.object.bucketName !== 'string' ||
    !CONTROL_BUCKET_PATTERN.test(observation.object.bucketName)
  ) {
    throw new TypeError(`${valuePath}.object.bucketName is invalid.`);
  }
  const expectedKey = getDeploymentServiceHealthObjectKey(
    receipt,
    `${valuePath}.receipt`,
  );
  if (observation.object.key !== expectedKey) {
    throw new Error(`${valuePath}.object.key does not match its receipt.`);
  }
  if (!isUsableVersionId(observation.object.versionId)) {
    throw new TypeError(`${valuePath}.object.versionId is invalid.`);
  }
  if (!isUsableOpaqueEtag(observation.object.etag)) {
    throw new TypeError(`${valuePath}.object.etag is invalid.`);
  }
  if (
    !Number.isSafeInteger(observation.object.lastModifiedAt) ||
    observation.object.lastModifiedAt < 0
  ) {
    throw new TypeError(
      `${valuePath}.object.lastModifiedAt must be nonnegative epoch milliseconds.`,
    );
  }
  return deepFreeze({
    receipt,
    object: {
      bucketName: observation.object.bucketName,
      key: expectedKey,
      versionId: observation.object.versionId,
      etag: observation.object.etag,
      lastModifiedAt: observation.object.lastModifiedAt,
    },
  });
}

/**
 * Validate a health observation and prove that its provider-controlled object
 * timestamp is inside the exact accepted window. Keeping this check public
 * makes every consumer enforce the same boundary even when an observation did
 * not arrive through createDeploymentServiceHealthS3().inspect().
 * @param {unknown} value - Candidate provider observation.
 * @param {unknown} freshnessContext - Exact sampled clock and pinned timing policy.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {Readonly<Record<string, any>>} - Canonical fresh observation.
 */
export function validateDeploymentServiceHealthObservationFreshness(
  value,
  freshnessContext,
  valuePath = 'deploymentServiceHealthObservation',
) {
  const observation = validateDeploymentServiceHealthObservation(
    value,
    valuePath,
  );
  if (!isObjectRecord(freshnessContext)) {
    throw new TypeError(`${valuePath} freshness context must be an object.`);
  }
  assertAllKeys(
    freshnessContext,
    FRESHNESS_CONTEXT_KEYS,
    `${valuePath} freshness context`,
  );
  const { now, maxAgeSeconds, clockSkewSeconds } = freshnessContext;
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError(
      `${valuePath} freshness context.now must be nonnegative epoch milliseconds.`,
    );
  }
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds < 1) {
    throw new TypeError(
      `${valuePath} freshness context.maxAgeSeconds must be a positive safe integer.`,
    );
  }
  if (!Number.isSafeInteger(clockSkewSeconds) || clockSkewSeconds < 0) {
    throw new TypeError(
      `${valuePath} freshness context.clockSkewSeconds must be a nonnegative safe integer.`,
    );
  }
  const allowedFutureMilliseconds = clockSkewSeconds * 1000;
  const allowedAgeMilliseconds = (maxAgeSeconds + clockSkewSeconds) * 1000;
  if (
    !Number.isSafeInteger(allowedFutureMilliseconds) ||
    !Number.isSafeInteger(allowedAgeMilliseconds)
  ) {
    throw new TypeError(
      `${valuePath} freshness timing exceeds the supported safe integer range.`,
    );
  }
  const lastModifiedAt = observation.object.lastModifiedAt;
  if (lastModifiedAt - now > allowedFutureMilliseconds) {
    throw new DeploymentServiceHealthConflictError();
  }
  if (now - lastModifiedAt > allowedAgeMilliseconds) {
    throw new DeploymentServiceHealthStaleError();
  }
  return observation;
}

/** @param {Readonly<Record<string, any>>} receipt @param {Readonly<Record<string, string>>} location @param {{versionId: string, etag: string, lastModifiedAt: number}} object @returns {Readonly<Record<string, any>>} */
function createObservation(receipt, location, object) {
  return validateDeploymentServiceHealthObservation({
    receipt,
    object: {
      bucketName: location.bucketName,
      key: location.key,
      versionId: object.versionId,
      etag: object.etag,
      lastModifiedAt: object.lastModifiedAt,
    },
  });
}

/**
 * Create the host/coordinator S3 service-health boundary.
 * @param {unknown} options - Exact client, scope, clock, and retry bound.
 * @returns {Readonly<{inspect: (context: unknown) => Promise<Readonly<Record<string, any>>>, publish: (receipt: unknown, context: unknown) => Promise<Readonly<Record<string, any>>>}>} - Narrow health publication capability.
 */
export function createDeploymentServiceHealthS3(options) {
  if (!isObjectRecord(options)) {
    throw new TypeError('deploymentServiceHealthS3 options must be an object.');
  }
  for (const key of Object.keys(options)) {
    if (!FACTORY_KEYS.has(key)) {
      throw new TypeError(
        `deploymentServiceHealthS3 options.${key} is not supported.`,
      );
    }
  }
  for (const key of ['client', 'providerScope']) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new TypeError(
        `deploymentServiceHealthS3 options.${key} is required.`,
      );
    }
  }
  const client = options.client;
  if (!isObjectRecord(client)) {
    throw new TypeError(
      'deploymentServiceHealthS3 options.client must be an object.',
    );
  }
  for (const method of REQUIRED_CLIENT_METHODS) {
    if (typeof client[method] !== 'function') {
      throw new TypeError(
        `deploymentServiceHealthS3 options.client.${method} must be a function.`,
      );
    }
  }
  const providerScope = validateProviderScope(
    options.providerScope,
    'deploymentServiceHealthS3 options.providerScope',
  );
  const now = options.now ?? Date.now;
  if (typeof now !== 'function') {
    throw new TypeError(
      'deploymentServiceHealthS3 options.now must be a function.',
    );
  }
  const maxAttempts =
    options.maxAttempts ?? DEPLOYMENT_SERVICE_HEALTH_DEFAULT_MAX_ATTEMPTS;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_ATTEMPTS
  ) {
    throw new TypeError(
      `deploymentServiceHealthS3 options.maxAttempts must be an integer between 1 and ${MAX_ATTEMPTS}.`,
    );
  }

  /** @param {unknown} value @returns {Readonly<Record<string, any>>} */
  function validateContext(value) {
    if (!isObjectRecord(value)) {
      throw new TypeError(
        'deploymentServiceHealthS3 context must be an object.',
      );
    }
    assertAllKeys(value, CONTEXT_KEYS, 'deploymentServiceHealthS3 context');
    const contextScope = validateProviderScope(
      value.providerScope,
      'deploymentServiceHealthS3 context.providerScope',
    );
    if (contextScope.providerScopeId !== providerScope.providerScopeId) {
      throw new Error(
        'deploymentServiceHealthS3 context provider scope does not match the bound scope.',
      );
    }
    const profile = validateDeploymentProfile(
      value.profile,
      'deploymentServiceHealthS3 context.profile',
    );
    const deploymentRevision = validateDeploymentRevision(
      value.deploymentRevision,
      'deploymentServiceHealthS3 context.deploymentRevision',
    );
    const providerSpec = validateAwsSingleNodeProviderSpecContext(
      value.providerSpec,
      { profile, providerScope: contextScope },
    );
    const head = validateDeploymentHead(
      value.head,
      'deploymentServiceHealthS3 context.head',
    );
    const deploymentInstanceId = getDeploymentInstanceId({
      deploymentRevision,
      providerScope: contextScope,
    });
    if (
      head.deploymentInstanceId !== deploymentInstanceId ||
      head.providerScope.providerScopeId !== contextScope.providerScopeId
    ) {
      throw new Error(
        'deploymentServiceHealthS3 context head does not match its deployment and provider scope.',
      );
    }
    const nodeBindings = head.resourceBindings.filter(
      (/** @type {Readonly<Record<string, any>>} */ binding) =>
        binding.capability.kind === 'resident-node',
    );
    if (nodeBindings.length !== 1) {
      throw new Error(
        'deploymentServiceHealthS3 context requires exactly one resident-node binding.',
      );
    }
    const nodeBinding = nodeBindings[0];
    const location = getDeploymentServiceHealthObjectLocation(providerScope, {
      deploymentInstanceId,
      incarnationId: head.incarnationId,
      nodeBindingId: nodeBinding.bindingId,
    });
    return deepFreeze({
      context: {
        deploymentRevision,
        profile,
        providerScope: contextScope,
        providerSpec,
        head,
      },
      location,
      serviceHealth: providerSpec.capabilities.serviceHealth,
    });
  }

  /** @param {Readonly<Record<string, any>>} validated @param {boolean} requireCurrentContext @returns {Promise<Readonly<Record<string, any>>>} */
  async function readCurrent(validated, requireCurrentContext) {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      let response;
      try {
        response = await client.getObject({
          Bucket: validated.location.bucketName,
          Key: validated.location.key,
          ChecksumMode: 'ENABLED',
          ExpectedBucketOwner: providerScope.accountId,
        });
      } catch (error) {
        if (isMissingObjectError(error)) {
          throw new DeploymentServiceHealthMissingError({ cause: error });
        }
        throw new DeploymentServiceHealthUnknownError({ cause: error });
      }
      if (!isObjectRecord(response)) {
        throw new DeploymentServiceHealthConflictError();
      }
      if (
        !Number.isSafeInteger(response.ContentLength) ||
        response.ContentLength < 2 ||
        response.ContentLength > DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES
      ) {
        destroyBodyBestEffort(response.Body);
        throw new DeploymentServiceHealthConflictError();
      }
      const bytes = await readBoundedBody(response.Body);
      if (bytes.byteLength !== response.ContentLength) {
        throw new DeploymentServiceHealthConflictError();
      }
      const receipt = parseReceipt(
        bytes,
        validated.context,
        validated.location,
        providerScope,
        requireCurrentContext,
      );
      const getEvidence = validateObjectEnvelope(response, {
        bytes,
        receipt,
        location: validated.location,
      });

      let head;
      try {
        head = await client.headObject({
          Bucket: validated.location.bucketName,
          Key: validated.location.key,
          ChecksumMode: 'ENABLED',
          ExpectedBucketOwner: providerScope.accountId,
        });
      } catch (error) {
        if (isMissingObjectError(error)) {
          if (attempt + 1 < maxAttempts) continue;
          throw new DeploymentServiceHealthUnknownError({ cause: error });
        }
        throw new DeploymentServiceHealthUnknownError({ cause: error });
      }
      if (!isObjectRecord(head)) {
        throw new DeploymentServiceHealthConflictError();
      }
      if (!isUsableVersionId(head.VersionId)) {
        throw new DeploymentServiceHealthConflictError();
      }
      if (head.VersionId !== getEvidence.versionId) {
        if (attempt + 1 < maxAttempts) continue;
        throw new DeploymentServiceHealthUnknownError({
          cause: new CurrentVersionRaceError(),
        });
      }
      const headEvidence = validateObjectEnvelope(head, {
        bytes,
        receipt,
        location: validated.location,
      });
      if (
        headEvidence.etag !== getEvidence.etag ||
        headEvidence.lastModifiedAt !== getEvidence.lastModifiedAt
      ) {
        throw new DeploymentServiceHealthConflictError();
      }
      return createObservation(receipt, validated.location, headEvidence);
    }
    throw new DeploymentServiceHealthUnknownError();
  }

  /** @param {Readonly<Record<string, any>>} observation @param {Readonly<Record<string, any>>} timing @returns {Readonly<Record<string, any>>} */
  function requireFresh(observation, timing) {
    const nowValue = now();
    return validateDeploymentServiceHealthObservationFreshness(observation, {
      now: nowValue,
      maxAgeSeconds: timing.maxAgeSeconds,
      clockSkewSeconds: timing.clockSkewSeconds,
    });
  }

  /** @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
  async function inspect(context) {
    const validated = validateContext(context);
    const observation = await readCurrent(validated, true);
    return requireFresh(observation, validated.serviceHealth);
  }

  /** @param {Readonly<Record<string, any>>} receipt @returns {Buffer} */
  function encodeReceipt(receipt) {
    const bytes = Buffer.from(JSON.stringify(receipt), 'utf8');
    if (bytes.byteLength > DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES) {
      throw new RangeError(
        `deploymentServiceHealth receipt encoded JSON must not exceed ${DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES} bytes.`,
      );
    }
    return bytes;
  }

  /** @param {Readonly<Record<string, any>>} predecessor @param {Readonly<Record<string, any>>} successor @returns {boolean} */
  function isValidSuccessor(predecessor, successor) {
    try {
      validateDeploymentServiceHealthReceiptSuccessor(predecessor, successor);
      return true;
    } catch {
      return false;
    }
  }

  /** @param {Readonly<Record<string, any>>} candidate @param {Readonly<Record<string, any>>} observed @param {Readonly<Record<string, any>>} context @returns {boolean} */
  function isAdoptableSuccessor(candidate, observed, context) {
    if (!isValidSuccessor(candidate, observed)) return false;
    try {
      validateDeploymentServiceHealthReceiptContext(
        observed,
        context,
        'deploymentServiceHealthS3 adopted receipt',
      );
    } catch (error) {
      throw new DeploymentServiceHealthConflictError({ cause: error });
    }
    return true;
  }

  /** @param {Readonly<Record<string, any>>} candidate @param {Readonly<Record<string, any>>|null} current @param {Readonly<Record<string, string>>} location @param {Buffer} bytes @returns {Promise<unknown>} */
  async function putCandidate(candidate, current, location, bytes) {
    const condition =
      current === null
        ? { IfNoneMatch: '*' }
        : { IfMatch: current.object.etag };
    return client.putObject({
      Bucket: location.bucketName,
      Key: location.key,
      Body: bytes,
      ContentLength: bytes.byteLength,
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: checksumSha256(bytes),
      ServerSideEncryption: 'AES256',
      StorageClass: 'STANDARD',
      ContentType: DEPLOYMENT_SERVICE_HEALTH_CONTENT_TYPE,
      CacheControl: DEPLOYMENT_SERVICE_HEALTH_CACHE_CONTROL,
      ExpectedBucketOwner: providerScope.accountId,
      Metadata: createMetadata(candidate),
      ...condition,
    });
  }

  /** @param {unknown} candidateValue @param {unknown} context @returns {Promise<Readonly<Record<string, any>>>} */
  async function publish(candidateValue, context) {
    const validated = validateContext(context);
    const candidate = validateDeploymentServiceHealthReceiptContext(
      candidateValue,
      validated.context,
      'deploymentServiceHealthS3 candidate',
    );
    if (
      candidate.authorizedHeadId !== validated.context.head.headId ||
      candidate.authorizedHeadGeneration !== validated.context.head.generation
    ) {
      throw new DeploymentServiceHealthConflictError();
    }
    const candidateLocation = getDeploymentServiceHealthObjectLocation(
      providerScope,
      candidate,
    );
    if (!exactJsonEqual(candidateLocation, validated.location)) {
      throw new Error(
        'deploymentServiceHealthS3 candidate does not address the current resident node.',
      );
    }
    const bytes = encodeReceipt(candidate);
    /** @type {unknown} */
    let ambiguousCause;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      /** @type {Readonly<Record<string, any>>|null} */
      let predecessor;
      try {
        predecessor = await readCurrent(validated, false);
      } catch (error) {
        if (error instanceof DeploymentServiceHealthMissingError) {
          predecessor = null;
        } else if (error instanceof DeploymentServiceHealthUnknownError) {
          ambiguousCause = error;
          continue;
        } else {
          throw error;
        }
      }

      if (predecessor === null) {
        if (candidate.sequence !== 1) {
          throw new DeploymentServiceHealthConflictError();
        }
      } else if (predecessor.receipt.receiptId === candidate.receiptId) {
        return predecessor;
      } else if (
        isAdoptableSuccessor(candidate, predecessor.receipt, validated.context)
      ) {
        return predecessor;
      } else if (!isValidSuccessor(predecessor.receipt, candidate)) {
        throw new DeploymentServiceHealthConflictError();
      }

      try {
        await putCandidate(candidate, predecessor, validated.location, bytes);
      } catch (error) {
        ambiguousCause = error;
      }

      /** @type {Readonly<Record<string, any>>|null} */
      let readback;
      try {
        readback = await readCurrent(validated, false);
      } catch (error) {
        if (error instanceof DeploymentServiceHealthMissingError) {
          if (predecessor !== null) {
            throw new DeploymentServiceHealthConflictError({ cause: error });
          }
          readback = null;
        } else if (error instanceof DeploymentServiceHealthUnknownError) {
          ambiguousCause = error;
          continue;
        } else {
          throw error;
        }
      }

      if (readback?.receipt.receiptId === candidate.receiptId) {
        return readback;
      }
      if (
        readback !== null &&
        isAdoptableSuccessor(candidate, readback.receipt, validated.context)
      ) {
        return readback;
      }
      if (
        (predecessor === null && readback === null) ||
        (predecessor !== null &&
          readback !== null &&
          readback.receipt.receiptId === predecessor.receipt.receiptId)
      ) {
        continue;
      }
      throw new DeploymentServiceHealthConflictError();
    }
    throw new DeploymentServiceHealthUnknownError({ cause: ambiguousCause });
  }

  return Object.freeze({ inspect, publish });
}

export default createDeploymentServiceHealthS3;
