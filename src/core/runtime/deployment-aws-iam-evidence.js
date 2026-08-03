/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact immutable provider-evidence contracts are clearer than repeated parser-specific expansions. */

import { sortCanonicalJsonValue } from './canonical-order.js';

export const AWS_IAM_EVIDENCE_MAX_DOCUMENT_BYTES = 128 * 1024;
export const AWS_IAM_EVIDENCE_MAX_READ_PAGES = 16;
export const AWS_IAM_EVIDENCE_READ_MAX_ITEMS = 1000;
export const AWS_IAM_EVIDENCE_MAX_TAGS = 50;

const IAM_PAGINATION_MARKER_MAX_LENGTH = 4096;
const IAM_POLICY_NAME_PATTERN = /^[\w+=,.@-]{1,128}$/u;
const LIST_READER_KEYS = new Set([
  'readPage',
  'decodeItems',
  'itemKey',
  'baseRequest',
  'maxPages',
  'maxItems',
]);
const LIST_READER_REQUIRED_KEYS = new Set([
  'readPage',
  'itemKey',
  'baseRequest',
]);
const TAG_VALIDATION_KEYS = new Set(['allowIncomplete']);
const IAM_TAG_KEYS = new Set(['Key', 'Value']);
const IAM_ATTACHED_POLICY_KEYS = new Set(['PolicyName', 'PolicyArn']);

/** Provider evidence is malformed, incomplete, or unreadable. */
export class AwsIamEvidenceUnknownError extends Error {
  constructor() {
    super('AWS IAM provider evidence is unknown.');
    this.name = 'AwsIamEvidenceUnknownError';
    this.code = 'AWS_IAM_EVIDENCE_UNKNOWN';
  }
}

/** Well-formed provider evidence contradicts exact durable authority. */
export class AwsIamEvidenceConflictError extends Error {
  constructor() {
    super('AWS IAM provider evidence conflicts with exact authority.');
    this.name = 'AwsIamEvidenceConflictError';
    this.code = 'AWS_IAM_EVIDENCE_CONFLICT';
  }
}

/** Provider evidence can be valid while IAM propagation is still incomplete. */
export class AwsIamEvidenceTransientError extends Error {
  constructor() {
    super('AWS IAM provider evidence is transient.');
    this.name = 'AwsIamEvidenceTransientError';
    this.code = 'AWS_IAM_EVIDENCE_TRANSIENT';
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

/**
 * Match an AWS SDK error name without trusting any other throwable shape.
 * @param {unknown} error - Provider rejection.
 * @param {string} name - Exact AWS error name.
 * @returns {boolean}
 */
export function isAwsIamErrorNamed(error, name) {
  return (
    typeof name === 'string' &&
    name.length !== 0 &&
    error !== null &&
    typeof error === 'object' &&
    /** @type {Record<string, any>} */ (error).name === name
  );
}

/**
 * Decode the two document encodings returned by IAM into one canonical object.
 * @param {unknown} value - Raw JSON or URI-encoded JSON document.
 * @param {string} [valuePath] - Diagnostic field path.
 * @returns {Readonly<Record<string, any>>}
 */
export function decodeAwsIamJsonDocument(value, valuePath = 'awsIam document') {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > AWS_IAM_EVIDENCE_MAX_DOCUMENT_BYTES
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    let decoded;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      throw new AwsIamEvidenceUnknownError();
    }
    if (
      decoded.length === 0 ||
      Buffer.byteLength(decoded, 'utf8') > AWS_IAM_EVIDENCE_MAX_DOCUMENT_BYTES
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    try {
      parsed = JSON.parse(decoded);
    } catch {
      throw new AwsIamEvidenceUnknownError();
    }
  }
  if (!isPlainObject(parsed)) {
    throw new AwsIamEvidenceUnknownError();
  }
  try {
    return deepFreeze(
      /** @type {Readonly<Record<string, any>>} */ (
        sortCanonicalJsonValue(parsed)
      ),
    );
  } catch {
    throw new AwsIamEvidenceUnknownError();
  }
}

/**
 * Strictly decode one AWS IAM Marker page.
 * @param {unknown} response - Raw provider response.
 * @param {unknown} itemKey - Exact response-array field.
 * @param {number} [maxItems] - Per-page item bound.
 * @returns {{items: unknown[], nextMarker: string|null}}
 */
export function decodeAwsIamListPage(
  response,
  itemKey,
  maxItems = AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
) {
  if (
    typeof itemKey !== 'string' ||
    itemKey.length === 0 ||
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > AWS_IAM_EVIDENCE_READ_MAX_ITEMS ||
    !isPlainObject(response) ||
    !Array.isArray(response[itemKey]) ||
    response[itemKey].length > maxItems ||
    typeof response.IsTruncated !== 'boolean'
  ) {
    throw new AwsIamEvidenceUnknownError();
  }
  if (response.IsTruncated) {
    if (
      typeof response.Marker !== 'string' ||
      response.Marker.length === 0 ||
      response.Marker.length > IAM_PAGINATION_MARKER_MAX_LENGTH
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    return {
      items: response[itemKey],
      nextMarker: response.Marker,
    };
  }
  if (response.Marker !== undefined && response.Marker !== null) {
    throw new AwsIamEvidenceUnknownError();
  }
  return { items: response[itemKey], nextMarker: null };
}

/**
 * Read one complete bounded IAM Marker list. The caller maps provider
 * rejections before returning a page; decoded page contradictions are never
 * deferred past a later request.
 * @param {unknown} value - Read adapter, response field, base request, bounds.
 * @returns {Promise<unknown[]>}
 */
export async function readAwsIamListPages(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('awsIam list reader must be an object.');
  }
  assertSupportedKeys(value, LIST_READER_KEYS, 'awsIam list reader');
  assertRequiredKeys(value, LIST_READER_REQUIRED_KEYS, 'awsIam list reader');
  if (typeof value.readPage !== 'function') {
    throw new TypeError('awsIam list reader.readPage must be a function.');
  }
  /** @type {(items: unknown[]) => readonly unknown[]} */
  const decodeItems = Object.hasOwn(value, 'decodeItems')
    ? value.decodeItems
    : (/** @type {unknown[]} */ items) => items;
  if (typeof decodeItems !== 'function') {
    throw new TypeError('awsIam list reader.decodeItems must be a function.');
  }
  if (typeof value.itemKey !== 'string' || value.itemKey.length === 0) {
    throw new TypeError(
      'awsIam list reader.itemKey must be a non-empty string.',
    );
  }
  if (!isPlainObject(value.baseRequest)) {
    throw new TypeError('awsIam list reader.baseRequest must be an object.');
  }
  const maxPagesValue = Object.hasOwn(value, 'maxPages')
    ? value.maxPages
    : AWS_IAM_EVIDENCE_MAX_READ_PAGES;
  const maxItemsValue = Object.hasOwn(value, 'maxItems')
    ? value.maxItems
    : AWS_IAM_EVIDENCE_READ_MAX_ITEMS;
  if (
    !Number.isSafeInteger(maxPagesValue) ||
    /** @type {number} */ (maxPagesValue) < 1 ||
    /** @type {number} */ (maxPagesValue) > AWS_IAM_EVIDENCE_MAX_READ_PAGES
  ) {
    throw new TypeError(
      `awsIam list reader.maxPages must be an integer from 1 through ${AWS_IAM_EVIDENCE_MAX_READ_PAGES}.`,
    );
  }
  if (
    !Number.isSafeInteger(maxItemsValue) ||
    /** @type {number} */ (maxItemsValue) < 1 ||
    /** @type {number} */ (maxItemsValue) > AWS_IAM_EVIDENCE_READ_MAX_ITEMS
  ) {
    throw new TypeError(
      `awsIam list reader.maxItems must be an integer from 1 through ${AWS_IAM_EVIDENCE_READ_MAX_ITEMS}.`,
    );
  }
  const maxPages = /** @type {number} */ (maxPagesValue);
  const maxItems = /** @type {number} */ (maxItemsValue);

  const items = [];
  const seenMarkers = new Set();
  let marker = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const request = deepFreeze({
      ...value.baseRequest,
      MaxItems: maxItems,
      ...(marker === null ? {} : { Marker: marker }),
    });
    const response = await value.readPage(request);
    const observed = decodeAwsIamListPage(response, value.itemKey, maxItems);
    const decodedItems = decodeItems(observed.items);
    if (!Array.isArray(decodedItems)) {
      throw new AwsIamEvidenceUnknownError();
    }
    items.push(...decodedItems);
    if (observed.nextMarker === null) return items;
    if (page === maxPages || seenMarkers.has(observed.nextMarker)) {
      throw new AwsIamEvidenceUnknownError();
    }
    seenMarkers.add(observed.nextMarker);
    marker = observed.nextMarker;
  }
  throw new AwsIamEvidenceUnknownError();
}

/**
 * Decode and canonicalize one complete IAM tag list.
 * @param {unknown} value - Provider tag list.
 * @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>}
 */
export function decodeAwsIamTags(value) {
  if (!Array.isArray(value) || value.length > AWS_IAM_EVIDENCE_MAX_TAGS) {
    throw new AwsIamEvidenceUnknownError();
  }
  const tags = [];
  const seenKeys = new Set();
  for (const candidate of value) {
    if (
      !isPlainObject(candidate) ||
      Object.keys(candidate).length !== IAM_TAG_KEYS.size ||
      ![...IAM_TAG_KEYS].every((key) => Object.hasOwn(candidate, key)) ||
      typeof candidate.Key !== 'string' ||
      candidate.Key.length === 0 ||
      candidate.Key.length > 128 ||
      typeof candidate.Value !== 'string' ||
      candidate.Value.length > 256
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    if (seenKeys.has(candidate.Key)) {
      throw new AwsIamEvidenceConflictError();
    }
    seenKeys.add(candidate.Key);
    tags.push({ Key: candidate.Key, Value: candidate.Value });
  }
  tags.sort((left, right) =>
    left.Key < right.Key ? -1 : left.Key > right.Key ? 1 : 0,
  );
  return deepFreeze(tags);
}

/**
 * Prove exact IAM tags, optionally treating a matching strict subset as
 * propagation-incomplete.
 * @param {unknown} observed - Provider tag list.
 * @param {unknown} expected - Exact canonical authority tags.
 * @param {unknown} [options] - Incomplete propagation policy.
 * @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>}
 */
export function validateAwsIamTags(observed, expected, options = {}) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsIam tag validation options must be an object.');
  }
  assertSupportedKeys(
    options,
    TAG_VALIDATION_KEYS,
    'awsIam tag validation options',
  );
  const allowIncomplete = Object.hasOwn(options, 'allowIncomplete')
    ? options.allowIncomplete
    : false;
  if (typeof allowIncomplete !== 'boolean') {
    throw new TypeError(
      'awsIam tag validation options.allowIncomplete must be a boolean.',
    );
  }
  const actual = decodeAwsIamTags(observed);
  const wanted = decodeAwsIamTags(expected);
  if (sameJson(actual, wanted)) return actual;
  if (
    allowIncomplete &&
    actual.length < wanted.length &&
    actual.every((tag) =>
      wanted.some(
        (candidate) =>
          candidate.Key === tag.Key && candidate.Value === tag.Value,
      ),
    )
  ) {
    throw new AwsIamEvidenceTransientError();
  }
  throw new AwsIamEvidenceConflictError();
}

/**
 * Prove the expected locator-tag subset while allowing unrelated ownership
 * fields to remain present. This detects collisions but never adopts them.
 * @param {unknown} observed - Provider tag list.
 * @param {unknown} expectedSubset - Required locator tags.
 * @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>}
 */
export function validateAwsIamTagSubset(observed, expectedSubset) {
  const actual = decodeAwsIamTags(observed);
  const wanted = decodeAwsIamTags(expectedSubset);
  if (
    !wanted.every((tag) =>
      actual.some(
        (candidate) =>
          candidate.Key === tag.Key && candidate.Value === tag.Value,
      ),
    )
  ) {
    throw new AwsIamEvidenceConflictError();
  }
  return actual;
}

/** @param {unknown} value @returns {Readonly<string[]>} */
export function decodeAwsIamPolicyNames(value) {
  if (!Array.isArray(value)) throw new AwsIamEvidenceUnknownError();
  const names = [];
  const seen = new Set();
  for (const candidate of value) {
    if (
      typeof candidate !== 'string' ||
      !IAM_POLICY_NAME_PATTERN.test(candidate) ||
      seen.has(candidate)
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    seen.add(candidate);
    names.push(candidate);
  }
  names.sort();
  return Object.freeze(names);
}

/** @param {unknown} value @returns {Readonly<Array<Readonly<{PolicyName: string, PolicyArn: string}>>>} */
export function decodeAwsIamAttachedPolicies(value) {
  if (!Array.isArray(value)) throw new AwsIamEvidenceUnknownError();
  const policies = [];
  const seenArns = new Set();
  const seenNames = new Set();
  for (const candidate of value) {
    if (
      !isPlainObject(candidate) ||
      Object.keys(candidate).length !== IAM_ATTACHED_POLICY_KEYS.size ||
      ![...IAM_ATTACHED_POLICY_KEYS].every((key) =>
        Object.hasOwn(candidate, key),
      ) ||
      typeof candidate.PolicyName !== 'string' ||
      !IAM_POLICY_NAME_PATTERN.test(candidate.PolicyName) ||
      typeof candidate.PolicyArn !== 'string' ||
      candidate.PolicyArn.length === 0 ||
      seenArns.has(candidate.PolicyArn) ||
      seenNames.has(candidate.PolicyName)
    ) {
      throw new AwsIamEvidenceUnknownError();
    }
    seenArns.add(candidate.PolicyArn);
    seenNames.add(candidate.PolicyName);
    policies.push({
      PolicyName: candidate.PolicyName,
      PolicyArn: candidate.PolicyArn,
    });
  }
  policies.sort((left, right) =>
    left.PolicyArn < right.PolicyArn
      ? -1
      : left.PolicyArn > right.PolicyArn
        ? 1
        : 0,
  );
  return deepFreeze(policies);
}

export default {
  AWS_IAM_EVIDENCE_MAX_DOCUMENT_BYTES,
  AWS_IAM_EVIDENCE_MAX_READ_PAGES,
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
  AWS_IAM_EVIDENCE_MAX_TAGS,
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamAttachedPolicies,
  decodeAwsIamJsonDocument,
  decodeAwsIamListPage,
  decodeAwsIamPolicyNames,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTagSubset,
  validateAwsIamTags,
};
