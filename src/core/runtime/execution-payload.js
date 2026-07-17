/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { sortCanonicalJsonValue } from './canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createDomainSeparatedSha256Id,
  sha256Base64Url,
} from './content-id.js';
import { cloneJsonObject, cloneJsonValue } from './json-value.js';
import { assertLogicalId } from './logical-id.js';

/** The first strict execution-payload reference document version. */
export const EXECUTION_PAYLOAD_REFERENCE_SCHEMA_VERSION = 1;
export const EXECUTION_PAYLOAD_REFERENCE_KIND = 'executionPayloadReference';
export const EXECUTION_PAYLOAD_ID_DOMAIN = 'wharfie:execution-payload:v1';
export const EXECUTION_PAYLOAD_ID_PREFIX = 'wlp';
export const EXECUTION_PAYLOAD_MEDIA_TYPE = 'application/json';
export const EXECUTION_PAYLOAD_STORAGE_KIND =
  'wharfie.local-content-addressed.v1';
export const EXECUTION_PAYLOAD_STORAGE_KEY_PREFIX = 'sha256/';
/** Maximum exact canonical JSON byte length accepted for one payload. */
export const EXECUTION_PAYLOAD_MAX_BYTES = 16 * 1024 * 1024;

const REFERENCE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'payloadId',
  'digest',
  'size',
  'mediaType',
  'payloadSchema',
  'storage',
]);
const DIGEST_KEYS = new Set(['algorithm', 'value']);
const STORAGE_KEYS = new Set(['kind', 'storeId', 'key']);
const PAYLOAD_SCHEMA_PATTERN = /^[a-z][a-z0-9]*(?:[.:/_-][a-z0-9]+)*$/;

/**
 * @typedef ExecutionPayloadReference
 * @property {1} schemaVersion - Reference schema version.
 * @property {'executionPayloadReference'} kind - Document kind.
 * @property {string} payloadId - Domain-separated immutable payload ID.
 * @property {{algorithm: 'sha256', value: string}} digest - Raw exact-byte digest.
 * @property {number} size - Exact canonical JSON byte length.
 * @property {'application/json'} mediaType - Payload media type.
 * @property {string} payloadSchema - Versioned semantic JSON schema identity.
 * @property {{kind: 'wharfie.local-content-addressed.v1', storeId: string, key: string}} storage - Immutable storage identity and content-derived key.
 */

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} valuePath - Human-readable boundary label.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, valuePath) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${valuePath}.${key} is not supported.`);
    }
  }
  if (Object.keys(value).length !== allowedKeys.size) {
    throw new TypeError(`${valuePath} has missing fields.`);
  }
}

/**
 * Deeply freeze one independently validated JSON record.
 * @param {any} value - JSON record.
 * @returns {any} - The same frozen record.
 */
function freezeJsonSnapshot(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) freezeJsonSnapshot(child);
  return Object.freeze(value);
}

/**
 * Preserve exact byte inputs without accepting text or coercible values.
 * @param {unknown} value - Candidate exact bytes.
 * @param {string} valuePath - Human-readable boundary label.
 * @returns {Buffer} - Independent exact byte copy.
 */
function copyBytes(value, valuePath) {
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    assertExecutionPayloadByteLength(
      value.byteLength,
      `${valuePath}.byteLength`,
    );
    return Buffer.from(value);
  }
  if (value instanceof ArrayBuffer) {
    assertExecutionPayloadByteLength(
      value.byteLength,
      `${valuePath}.byteLength`,
    );
    return Buffer.from(new Uint8Array(value));
  }
  throw new TypeError(
    `${valuePath} must be a Buffer, Uint8Array, or ArrayBuffer of exact bytes.`,
  );
}

/**
 * Enforce the protocol-wide byte ceiling before allocating, decoding, or
 * durably naming an execution payload. The same limit applies to a serialized
 * reference and the exact bytes it authorizes.
 * @param {unknown} value - Candidate exact payload byte length.
 * @param {string} valuePath - Human-readable boundary label.
 * @returns {number} - Validated byte length.
 */
function assertExecutionPayloadByteLength(value, valuePath) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${valuePath} must be a nonnegative safe integer.`);
  }
  if (value > EXECUTION_PAYLOAD_MAX_BYTES) {
    throw new TypeError(
      `${valuePath} exceeds the ${EXECUTION_PAYLOAD_MAX_BYTES}-byte execution payload limit.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate versioned payload schema identity.
 * @param {string} valuePath - Human-readable boundary label.
 * @returns {string} - Validated schema identity.
 */
function normalizePayloadSchema(value, valuePath) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim() !== value ||
    !PAYLOAD_SCHEMA_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be a nonempty canonical lowercase payload schema identity.`,
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate named SHA-256 digest.
 * @param {string} valuePath - Human-readable boundary label.
 * @returns {{algorithm: 'sha256', value: string}} - Validated digest.
 */
function normalizeSha256Digest(value, valuePath) {
  const digest = cloneJsonObject(value, valuePath);
  assertExactKeys(digest, DIGEST_KEYS, valuePath);
  if (digest.algorithm !== 'sha256') {
    throw new TypeError(`${valuePath}.algorithm must be 'sha256'.`);
  }
  assertSha256Base64Url(digest.value, `${valuePath}.value`);
  return /** @type {{algorithm: 'sha256', value: string}} */ (digest);
}

/**
 * Return the one deterministic local content-addressed key for a SHA-256
 * descriptor. The digest is duplicated in the reference for auditability, but
 * a caller cannot choose a mutable path.
 * @param {unknown} digest - Candidate named SHA-256 digest.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {string} - Content-derived local storage key.
 */
export function getExecutionPayloadStorageKey(digest, valuePath = 'digest') {
  const normalized = normalizeSha256Digest(digest, valuePath);
  return `${EXECUTION_PAYLOAD_STORAGE_KEY_PREFIX}${normalized.value}`;
}

/**
 * Create the stable local-store identity used while constructing a payload
 * reference. The content-derived key is added only after bytes are known.
 * @param {unknown} storeId - Canonical local-store identity.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {{kind: 'wharfie.local-content-addressed.v1', storeId: string}} - Store identity.
 */
export function createExecutionPayloadStorageIdentity(
  storeId,
  valuePath = 'storeId',
) {
  assertLogicalId(storeId, valuePath);
  return Object.freeze({
    kind: EXECUTION_PAYLOAD_STORAGE_KIND,
    storeId,
  });
}

/**
 * Canonically serialize a strict JSON value. This byte sequence, rather than
 * the caller's property insertion order, is the immutable payload content.
 * @param {unknown} value - Candidate durable JSON value.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {Buffer} - Canonical compact UTF-8 JSON bytes.
 */
export function encodeCanonicalJsonPayload(value, valuePath = 'payload') {
  const normalized = sortCanonicalJsonValue(cloneJsonValue(value, valuePath));
  return Buffer.from(JSON.stringify(normalized), 'utf8');
}

/**
 * Decode and require one exact canonical UTF-8 JSON byte sequence. Whitespace,
 * duplicate JSON keys, noncanonical object order, and alternate number
 * spellings are rejected rather than silently becoming another payload.
 * @param {unknown} value - Candidate exact JSON bytes.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {any} - Independently validated canonical JSON value.
 */
export function decodeCanonicalJsonPayload(value, valuePath = 'payload bytes') {
  const bytes = copyBytes(value, valuePath);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new TypeError(`${valuePath} must be well-formed UTF-8 JSON bytes.`);
  }

  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${valuePath} must contain valid JSON: ${message}`);
  }

  const canonical = encodeCanonicalJsonPayload(parsed, valuePath);
  if (!canonical.equals(bytes)) {
    throw new TypeError(
      `${valuePath} must use Wharfie's canonical compact JSON serialization.`,
    );
  }
  return sortCanonicalJsonValue(cloneJsonValue(parsed, valuePath));
}

/**
 * Create the domain-separated identity for exact canonical payload bytes.
 * @param {unknown} bytes - Exact canonical JSON bytes.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {string} - `wlp_<base64url SHA-256>` identity.
 */
export function createExecutionPayloadId(bytes, valuePath = 'payload bytes') {
  return createDomainSeparatedSha256Id({
    domain: EXECUTION_PAYLOAD_ID_DOMAIN,
    prefix: EXECUTION_PAYLOAD_ID_PREFIX,
    payload: copyBytes(bytes, valuePath),
  });
}

/**
 * Assert the textual identity shape of one execution payload. Exact-byte
 * validation occurs when a reference is verified against its stored bytes.
 * @param {unknown} value - Candidate payload identity.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {asserts value is string}
 */
export function assertExecutionPayloadId(value, valuePath = 'payloadId') {
  assertDomainSeparatedSha256Id(value, EXECUTION_PAYLOAD_ID_PREFIX, valuePath);
}

/**
 * Build one strict immutable reference for already-canonical JSON bytes.
 * @param {{bytes: unknown, payloadSchema: unknown, storeId: unknown}} options - Reference inputs.
 * @returns {Readonly<ExecutionPayloadReference>} - Immutable payload reference.
 */
export function createExecutionPayloadReference(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'execution payload reference options must be an object.',
    );
  }
  const candidate = /** @type {Record<string, unknown>} */ (options);
  const supported = new Set(['bytes', 'payloadSchema', 'storeId']);
  for (const key of Object.keys(candidate)) {
    if (!supported.has(key)) {
      throw new TypeError(
        `execution payload reference options.${key} is not supported.`,
      );
    }
  }
  for (const key of supported) {
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
      throw new TypeError(
        `execution payload reference options.${key} is required.`,
      );
    }
  }

  const bytes = copyBytes(candidate.bytes, 'execution payload bytes');
  assertExecutionPayloadByteLength(bytes.byteLength, 'execution payload bytes');
  // A reference must never bless merely valid JSON with a noncanonical byte
  // spelling: the raw digest names these bytes forever.
  decodeCanonicalJsonPayload(bytes, 'execution payload bytes');
  const payloadSchema = normalizePayloadSchema(
    candidate.payloadSchema,
    'execution payload payloadSchema',
  );
  const storageIdentity = createExecutionPayloadStorageIdentity(
    candidate.storeId,
    'execution payload storeId',
  );
  const digest = {
    algorithm: /** @type {'sha256'} */ ('sha256'),
    value: sha256Base64Url(bytes, 'execution payload bytes'),
  };

  return /** @type {Readonly<ExecutionPayloadReference>} */ (
    freezeJsonSnapshot({
      schemaVersion: EXECUTION_PAYLOAD_REFERENCE_SCHEMA_VERSION,
      kind: EXECUTION_PAYLOAD_REFERENCE_KIND,
      payloadId: createExecutionPayloadId(bytes),
      digest,
      size: bytes.byteLength,
      mediaType: EXECUTION_PAYLOAD_MEDIA_TYPE,
      payloadSchema,
      storage: {
        ...storageIdentity,
        key: getExecutionPayloadStorageKey(digest),
      },
    })
  );
}

/**
 * Validate one serialized payload reference without fetching its bytes.
 * @param {unknown} value - Candidate reference document.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {Readonly<ExecutionPayloadReference>} - Strict independently cloned reference.
 */
export function validateExecutionPayloadReference(
  value,
  valuePath = 'payload reference',
) {
  const reference = cloneJsonObject(value, valuePath);
  assertExactKeys(reference, REFERENCE_KEYS, valuePath);
  if (reference.schemaVersion !== EXECUTION_PAYLOAD_REFERENCE_SCHEMA_VERSION) {
    throw new TypeError(
      `${valuePath}.schemaVersion must be the integer ${EXECUTION_PAYLOAD_REFERENCE_SCHEMA_VERSION}.`,
    );
  }
  if (reference.kind !== EXECUTION_PAYLOAD_REFERENCE_KIND) {
    throw new TypeError(
      `${valuePath}.kind must be '${EXECUTION_PAYLOAD_REFERENCE_KIND}'.`,
    );
  }
  assertExecutionPayloadId(reference.payloadId, `${valuePath}.payloadId`);
  const digest = normalizeSha256Digest(reference.digest, `${valuePath}.digest`);
  assertExecutionPayloadByteLength(reference.size, `${valuePath}.size`);
  if (reference.mediaType !== EXECUTION_PAYLOAD_MEDIA_TYPE) {
    throw new TypeError(
      `${valuePath}.mediaType must be '${EXECUTION_PAYLOAD_MEDIA_TYPE}'.`,
    );
  }
  const payloadSchema = normalizePayloadSchema(
    reference.payloadSchema,
    `${valuePath}.payloadSchema`,
  );
  const storage = cloneJsonObject(reference.storage, `${valuePath}.storage`);
  assertExactKeys(storage, STORAGE_KEYS, `${valuePath}.storage`);
  if (storage.kind !== EXECUTION_PAYLOAD_STORAGE_KIND) {
    throw new TypeError(
      `${valuePath}.storage.kind must be '${EXECUTION_PAYLOAD_STORAGE_KIND}'.`,
    );
  }
  assertLogicalId(storage.storeId, `${valuePath}.storage.storeId`);
  const expectedKey = getExecutionPayloadStorageKey(
    digest,
    `${valuePath}.digest`,
  );
  if (storage.key !== expectedKey) {
    throw new TypeError(
      `${valuePath}.storage.key must equal the content-derived digest key.`,
    );
  }

  return /** @type {Readonly<ExecutionPayloadReference>} */ (
    freezeJsonSnapshot({
      schemaVersion: EXECUTION_PAYLOAD_REFERENCE_SCHEMA_VERSION,
      kind: EXECUTION_PAYLOAD_REFERENCE_KIND,
      payloadId: reference.payloadId,
      digest,
      size: reference.size,
      mediaType: EXECUTION_PAYLOAD_MEDIA_TYPE,
      payloadSchema,
      storage: {
        kind: EXECUTION_PAYLOAD_STORAGE_KIND,
        storeId: storage.storeId,
        key: expectedKey,
      },
    })
  );
}

/**
 * Rehash, decode, and canonically validate stored bytes against a strict
 * reference. Reads must use this check before authorizing replay or recovery.
 * @param {unknown} reference - Candidate serialized reference.
 * @param {unknown} bytes - Exact stored bytes.
 * @param {string} [valuePath] - Human-readable boundary label.
 * @returns {{reference: Readonly<ExecutionPayloadReference>, value: any}} - Verified reference and decoded JSON payload.
 */
export function verifyExecutionPayloadReference(
  reference,
  bytes,
  valuePath = 'execution payload',
) {
  const normalized = validateExecutionPayloadReference(
    reference,
    `${valuePath} reference`,
  );
  const exactBytes = copyBytes(bytes, `${valuePath} bytes`);
  assertExecutionPayloadByteLength(exactBytes.byteLength, `${valuePath} bytes`);
  const decoded = decodeCanonicalJsonPayload(exactBytes, `${valuePath} bytes`);
  const expected = createExecutionPayloadReference({
    bytes: exactBytes,
    payloadSchema: normalized.payloadSchema,
    storeId: normalized.storage.storeId,
  });
  if (
    normalized.payloadId !== expected.payloadId ||
    normalized.digest.algorithm !== expected.digest.algorithm ||
    normalized.digest.value !== expected.digest.value ||
    normalized.size !== expected.size ||
    normalized.mediaType !== expected.mediaType ||
    normalized.payloadSchema !== expected.payloadSchema ||
    normalized.storage.kind !== expected.storage.kind ||
    normalized.storage.storeId !== expected.storage.storeId ||
    normalized.storage.key !== expected.storage.key
  ) {
    throw new Error(`${valuePath} reference does not match its exact bytes.`);
  }
  return { reference: normalized, value: decoded };
}

export default {
  EXECUTION_PAYLOAD_ID_DOMAIN,
  EXECUTION_PAYLOAD_ID_PREFIX,
  EXECUTION_PAYLOAD_MAX_BYTES,
  EXECUTION_PAYLOAD_MEDIA_TYPE,
  EXECUTION_PAYLOAD_REFERENCE_KIND,
  EXECUTION_PAYLOAD_REFERENCE_SCHEMA_VERSION,
  EXECUTION_PAYLOAD_STORAGE_KEY_PREFIX,
  EXECUTION_PAYLOAD_STORAGE_KIND,
  assertExecutionPayloadId,
  createExecutionPayloadId,
  createExecutionPayloadReference,
  createExecutionPayloadStorageIdentity,
  decodeCanonicalJsonPayload,
  encodeCanonicalJsonPayload,
  getExecutionPayloadStorageKey,
  validateExecutionPayloadReference,
  verifyExecutionPayloadReference,
};
