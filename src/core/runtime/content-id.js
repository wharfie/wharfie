/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { createHash } from 'node:crypto';

import { sortCanonicalJsonValue } from './canonical-order.js';
import { cloneJsonValue } from './json-value.js';

export const SHA256_BASE64URL_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const DOMAIN_PATTERN = /^[a-z][a-z0-9:./_-]*$/;
const ID_PREFIX_PATTERN = /^[a-z][a-z0-9]*$/;

/**
 * Require the one canonical unpadded base64url spelling of exactly 32 bytes.
 * Node's decoder deliberately accepts non-zero trailing pad bits, so syntax
 * and encoded length alone would allow several strings to name the same hash.
 * @param {unknown} value - Candidate encoded digest.
 * @returns {value is string} - Whether the digest has one canonical spelling.
 */
function isCanonicalSha256Base64Url(value) {
  if (typeof value !== 'string' || !SHA256_BASE64URL_PATTERN.test(value)) {
    return false;
  }

  const bytes = Buffer.from(value, 'base64url');
  return bytes.byteLength === 32 && bytes.toString('base64url') === value;
}

/**
 * @typedef {string | Buffer | Uint8Array | ArrayBuffer} HashInput
 */

/**
 * Convert one unambiguous byte input into a Buffer view.
 * @param {HashInput} value - Bytes or a UTF-8 string.
 * @param {string} valuePath - Human-readable value path.
 * @returns {Buffer} - Byte view.
 */
function toBuffer(value, valuePath) {
  if (typeof value === 'string') return Buffer.from(value, 'utf8');
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);

  throw new TypeError(
    `${valuePath} must be a string, Buffer, Uint8Array, or ArrayBuffer.`,
  );
}

/**
 * Calculate the lowercase SHA-256 digest of exact bytes.
 * @param {HashInput} value - Bytes or a UTF-8 string.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {string} - Unpadded base64url digest.
 */
export function sha256Base64Url(value, valuePath = 'value') {
  return createHash('sha256')
    .update(toBuffer(value, valuePath))
    .digest('base64url');
}

/**
 * Create a typed identity that directly addresses exact bytes.
 * @param {{ prefix: string, payload: HashInput }} options - Identity inputs.
 * @returns {string} - `<prefix>_<base64url sha256>` identity.
 */
export function createSha256Id(options) {
  assertIdPrefix(options?.prefix, 'prefix');
  return `${options.prefix}_${sha256Base64Url(options.payload, 'payload')}`;
}

/**
 * Assert one unpadded base64url-encoded SHA-256 digest value.
 * @param {unknown} value - Candidate digest.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertSha256Base64Url(value, valuePath = 'digest') {
  if (!isCanonicalSha256Base64Url(value)) {
    throw new TypeError(
      `${valuePath} must be an unpadded base64url-encoded SHA-256 digest.`,
    );
  }
}

/**
 * Validate the controlled namespace used to distinguish semantic identities.
 * @param {unknown} value - Candidate domain.
 * @param {string} valuePath - Human-readable value path.
 * @returns {asserts value is string}
 */
function assertDomain(value, valuePath) {
  if (typeof value !== 'string' || !DOMAIN_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be a canonical lowercase identity domain.`,
    );
  }
}

/**
 * Validate the readable type prefix rendered into a semantic identity.
 * @param {unknown} value - Candidate prefix.
 * @param {string} valuePath - Human-readable value path.
 * @returns {asserts value is string}
 */
function assertIdPrefix(value, valuePath) {
  if (typeof value !== 'string' || !ID_PREFIX_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be a canonical lowercase identity prefix.`,
    );
  }
}

/**
 * Hash semantic bytes in an explicit namespace. Domains cannot contain NUL,
 * so `domain + NUL + payload` is unambiguous and cannot alias another domain.
 * @param {{ domain: string, prefix: string, payload: HashInput }} options - Identity inputs.
 * @returns {string} - `<prefix>_<base64url sha256>` semantic identity.
 */
export function createDomainSeparatedSha256Id(options) {
  assertDomain(options?.domain, 'domain');
  assertIdPrefix(options?.prefix, 'prefix');
  const payload = toBuffer(options.payload, 'payload');
  const digest = createHash('sha256')
    .update(options.domain, 'utf8')
    .update('\0', 'utf8')
    .update(payload)
    .digest('base64url');
  return `${options.prefix}_${digest}`;
}

/**
 * Canonically serialize a JSON value before hashing it in a semantic domain.
 * Object key order is non-semantic; array order remains semantic.
 * @param {{ domain: string, prefix: string, value: unknown, valuePath?: string }} options - Identity inputs.
 * @returns {string} - Domain-separated identity.
 */
export function createCanonicalJsonSha256Id(options) {
  const cloned = cloneJsonValue(options.value, options.valuePath || 'value');
  const canonicalJson = JSON.stringify(sortCanonicalJsonValue(cloned));
  return createDomainSeparatedSha256Id({
    domain: options.domain,
    prefix: options.prefix,
    payload: canonicalJson,
  });
}

/**
 * Assert a canonical domain-separated SHA-256 identity for one type prefix.
 * @param {unknown} value - Candidate identity.
 * @param {string} prefix - Expected type prefix.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertDomainSeparatedSha256Id(value, prefix, valuePath = 'id') {
  assertIdPrefix(prefix, 'prefix');
  const encodedDigest =
    typeof value === 'string' && value.startsWith(`${prefix}_`)
      ? value.slice(prefix.length + 1)
      : undefined;
  if (!isCanonicalSha256Base64Url(encodedDigest)) {
    throw new TypeError(
      `${valuePath} must be a canonical ${prefix}_<base64url SHA-256> identity.`,
    );
  }
}

export default {
  SHA256_BASE64URL_PATTERN,
  assertDomainSeparatedSha256Id,
  assertSha256Base64Url,
  createCanonicalJsonSha256Id,
  createDomainSeparatedSha256Id,
  createSha256Id,
  sha256Base64Url,
};
