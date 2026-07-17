import { Buffer } from 'node:buffer';

export const RUN_SORT_KEY_PREFIX = 'run/';
export const OPERATIONS_SORT_KEY_PREFIX = RUN_SORT_KEY_PREFIX;
export const MAX_OPERATION_ID_BYTES = 256;
export const MAX_ACTION_ID_BYTES = 256;

/**
 * UTF-8 replaces lone UTF-16 surrogates, so reject them to keep encoding
 * injective for JavaScript strings.
 * @param {string} value - String to inspect.
 * @returns {boolean} - Whether the string contains valid surrogate pairs.
 */
function isWellFormedUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/**
 * @param {unknown} value - Identifier to validate.
 * @param {string} label - Human-readable identifier label.
 * @param {number} maxBytes - Maximum UTF-8 byte length.
 * @returns {string} - Validated identifier.
 */
function assertRecordId(value, label, maxBytes) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a nonempty string.`);
  }
  if (!isWellFormedUnicode(value)) {
    throw new TypeError(`${label} must contain well-formed Unicode.`);
  }

  const byteLength = Buffer.byteLength(value, 'utf8');
  if (byteLength > maxBytes) {
    throw new RangeError(
      `${label} must be at most ${maxBytes} UTF-8 bytes; received ${byteLength}.`,
    );
  }

  return value;
}

/**
 * Encode a validated identifier into one separator-free key segment.
 * @param {unknown} value - Identifier to encode.
 * @param {string} label - Human-readable identifier label.
 * @param {number} maxBytes - Maximum UTF-8 byte length.
 * @returns {string} - Base64url key segment.
 */
function encodeRecordId(value, label, maxBytes) {
  const id = assertRecordId(value, label, maxBytes);
  return Buffer.from(id, 'utf8').toString('base64url');
}

/**
 * @param {unknown} operationId - Operation identifier.
 * @returns {string} - Encoded operation identifier.
 */
function encodeOperationId(operationId) {
  return encodeRecordId(operationId, 'Operation ID', MAX_OPERATION_ID_BYTES);
}

/**
 * @param {unknown} actionId - Action identifier.
 * @returns {string} - Encoded action identifier.
 */
function encodeActionId(actionId) {
  return encodeRecordId(actionId, 'Action ID', MAX_ACTION_ID_BYTES);
}

/**
 * @param {string} operationId - Operation identifier.
 * @returns {string} - Prefix shared by an operation and all of its actions.
 */
export function getOperationSortKeyPrefix(operationId) {
  return `${OPERATIONS_SORT_KEY_PREFIX}${encodeOperationId(operationId)}/`;
}

/** Alias retained for the operations-store vocabulary. */
export const getOperationRecordsSortKeyPrefix = getOperationSortKeyPrefix;

/**
 * @param {string} operationId - Operation identifier.
 * @returns {string} - Exact operation metadata sort key.
 */
export function getOperationSortKey(operationId) {
  return `${getOperationSortKeyPrefix(operationId)}meta`;
}

/**
 * @param {string} operationId - Operation identifier.
 * @returns {string} - Prefix shared by all actions of an operation.
 */
export function getActionSortKeyPrefix(operationId) {
  return `${getOperationSortKeyPrefix(operationId)}action/`;
}

/** Alias retained for the operations-store vocabulary. */
export const getActionRecordsSortKeyPrefix = getActionSortKeyPrefix;

/**
 * @param {string} operationId - Operation identifier.
 * @param {string} actionId - Action identifier.
 * @returns {string} - Exact action sort key.
 */
export function getActionSortKey(operationId, actionId) {
  return `${getActionSortKeyPrefix(operationId)}${encodeActionId(actionId)}`;
}

export default {
  RUN_SORT_KEY_PREFIX,
  OPERATIONS_SORT_KEY_PREFIX,
  MAX_OPERATION_ID_BYTES,
  MAX_ACTION_ID_BYTES,
  getOperationSortKey,
  getOperationSortKeyPrefix,
  getOperationRecordsSortKeyPrefix,
  getActionSortKey,
  getActionSortKeyPrefix,
  getActionRecordsSortKeyPrefix,
};
