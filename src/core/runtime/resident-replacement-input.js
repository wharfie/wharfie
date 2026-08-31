/* eslint-disable jsdoc/valid-types -- The strict receipt keeps its exact object contract inline. */

import { TextDecoder } from 'node:util';

import { DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE } from '../lib/config/db.js';
import {
  EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX,
  EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
  normalizeExecutionPayloadDistributionIdentity,
} from '../lib/payload-store/replicated.js';
import {
  EXECUTION_PAYLOAD_STORAGE_KIND,
  createExecutionPayloadStorageIdentity,
} from './execution-payload.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from './content-id.js';
import { sortCanonicalJsonValue } from './canonical-order.js';
import { cloneBoundedJsonObject, cloneJsonObject } from './json-value.js';
import { assertApplicationRevisionId } from './application-revision.js';
import { assertLogicalId } from './logical-id.js';
import { normalizeApplicationStateDestination } from './effects/application-state.js';
import { normalizeApplicationStateSnapshotTransport } from './application-state-snapshot.js';
import { DYNAMODB_TABLE_RESOURCE_ID_PREFIX } from './dynamodb-coordinator-authority-topology.js';

export {
  EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX,
  EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
} from '../lib/payload-store/replicated.js';

export const RESIDENT_REPLACEMENT_INPUT_SCHEMA_VERSION = 2;
export const RESIDENT_REPLACEMENT_INPUT_KIND =
  'residentReplacementInputReceipt';
export const RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_DOMAIN =
  'wharfie:resident-replacement-input-receipt:v2';
export const RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX = 'wrri2';
export const RESIDENT_REPLACEMENT_INPUT_MAX_BYTES = 192 * 1024;

const TABLE_NAME_PATTERN = /^[A-Za-z0-9_.-]{3,255}$/u;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-[0-9]+$/u;
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

const CREATE_KEYS = new Set([
  'appId',
  'currentRevisionId',
  'control',
  'payloadStorage',
  'applicationStateDestination',
  'applicationStateTransport',
]);
const PAYLOAD_KEYS = new Set(['schemaVersion', 'kind', ...CREATE_KEYS]);
const RECEIPT_KEYS = new Set(['receiptId', ...PAYLOAD_KEYS]);
const CONTROL_KEYS = new Set([
  'profile',
  'adapterName',
  'region',
  'tableName',
  'tableResourceId',
]);
const PAYLOAD_STORAGE_KEYS = new Set(['kind', 'storeId', 'distribution']);

/**
 * @typedef {Readonly<{
 *   schemaVersion: 2,
 *   kind: 'residentReplacementInputReceipt',
 *   receiptId: string,
 *   appId: string,
 *   currentRevisionId: string,
 *   control: Readonly<{
 *     profile: 'dynamodb-rvn-v1',
 *     adapterName: 'dynamodb',
 *     region: string,
 *     tableName: string,
 *     tableResourceId: string,
 *   }>,
 *   payloadStorage: Readonly<{
 *     kind: 'wharfie.local-content-addressed.v1',
 *     storeId: string,
 *     distribution: Readonly<{
 *       kind: 'wharfie.execution-payload-distribution.v1',
 *       distributionId: string,
 *       storeId: string,
 *     }>,
 *   }>,
 *   applicationStateDestination: ReturnType<typeof normalizeApplicationStateDestination>,
 *   applicationStateTransport: ReturnType<typeof normalizeApplicationStateSnapshotTransport>,
 * }>} ResidentReplacementInputReceipt
 */

/**
 * @param {any} value - Canonical JSON value.
 * @returns {any} - Recursively immutable value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * @param {unknown} value - Candidate exact JSON object.
 * @param {Set<string>} keys - Required exact keys.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Independently cloned JSON object.
 */
function exactObject(value, keys, label) {
  const object = cloneJsonObject(value, label);
  if (
    Object.keys(object).length !== keys.size ||
    Object.keys(object).some((key) => !keys.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
  return object;
}

/**
 * @param {unknown} value - Candidate exact receipt-sized object.
 * @param {Set<string>} keys - Required exact keys.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Bounded independently cloned object.
 */
function exactBoundedObject(value, keys, label) {
  const object = cloneBoundedJsonObject(
    value,
    RESIDENT_REPLACEMENT_INPUT_MAX_BYTES,
    label,
  );
  if (
    Object.keys(object).length !== keys.size ||
    Object.keys(object).some((key) => !keys.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
  return object;
}

/**
 * @param {unknown} value - Candidate DynamoDB control scope.
 * @param {string} label - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Exact immutable control scope.
 */
function normalizeControl(value, label) {
  const control = exactObject(value, CONTROL_KEYS, label);
  if (control.profile !== DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE) {
    throw new TypeError(
      `${label}.profile must be '${DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE}'.`,
    );
  }
  if (control.adapterName !== 'dynamodb') {
    throw new TypeError(`${label}.adapterName must be 'dynamodb'.`);
  }
  if (
    typeof control.region !== 'string' ||
    !REGION_PATTERN.test(control.region)
  ) {
    throw new TypeError(`${label}.region must be an exact AWS Region.`);
  }
  if (
    typeof control.tableName !== 'string' ||
    !TABLE_NAME_PATTERN.test(control.tableName)
  ) {
    throw new TypeError(
      `${label}.tableName must be an exact valid DynamoDB table name.`,
    );
  }
  assertDomainSeparatedSha256Id(
    control.tableResourceId,
    DYNAMODB_TABLE_RESOURCE_ID_PREFIX,
    `${label}.tableResourceId`,
  );
  return deepFreeze({
    profile: DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
    adapterName: 'dynamodb',
    region: control.region,
    tableName: control.tableName,
    tableResourceId: control.tableResourceId,
  });
}

/**
 * @param {unknown} value - Candidate immutable distribution identity.
 * @param {string} label - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Exact distribution identity.
 */
function normalizePayloadStorage(value, label) {
  const payloadStorage = exactObject(value, PAYLOAD_STORAGE_KEYS, label);
  const storage = createExecutionPayloadStorageIdentity(
    payloadStorage.storeId,
    `${label}.storeId`,
  );
  if (payloadStorage.kind !== EXECUTION_PAYLOAD_STORAGE_KIND) {
    throw new TypeError(
      `${label}.kind must be '${EXECUTION_PAYLOAD_STORAGE_KIND}'.`,
    );
  }
  const distribution = normalizeExecutionPayloadDistributionIdentity(
    payloadStorage.distribution,
    `${label}.distribution`,
  );
  if (distribution.storeId !== storage.storeId) {
    throw new TypeError(
      `${label}.distribution.storeId must match ${label}.storeId.`,
    );
  }
  return deepFreeze({
    ...storage,
    distribution,
  });
}

/**
 * Normalize every identity in the receipt except its self-derived ID.
 * @param {unknown} value - Candidate payload document.
 * @param {string} label - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Canonical receipt payload.
 */
function normalizePayload(value, label) {
  const payload = exactBoundedObject(value, PAYLOAD_KEYS, label);
  if (payload.schemaVersion !== RESIDENT_REPLACEMENT_INPUT_SCHEMA_VERSION) {
    throw new TypeError(`${label}.schemaVersion must be the integer 2.`);
  }
  if (payload.kind !== RESIDENT_REPLACEMENT_INPUT_KIND) {
    throw new TypeError(
      `${label}.kind must be '${RESIDENT_REPLACEMENT_INPUT_KIND}'.`,
    );
  }
  assertLogicalId(payload.appId, `${label}.appId`);
  assertApplicationRevisionId(
    payload.currentRevisionId,
    `${label}.currentRevisionId`,
  );
  const control = normalizeControl(payload.control, `${label}.control`);
  const payloadStorage = normalizePayloadStorage(
    payload.payloadStorage,
    `${label}.payloadStorage`,
  );
  const applicationStateDestination = normalizeApplicationStateDestination(
    payload.applicationStateDestination,
  );
  const applicationStateTransport = normalizeApplicationStateSnapshotTransport(
    payload.applicationStateTransport,
    `${label}.applicationStateTransport`,
  );
  if (applicationStateDestination.configuration.namespace !== payload.appId) {
    throw new TypeError(
      `${label}.applicationStateDestination namespace must match appId.`,
    );
  }
  if (
    JSON.stringify(sortCanonicalJsonValue(applicationStateDestination)) !==
    JSON.stringify(
      sortCanonicalJsonValue(applicationStateTransport.snapshot.destination),
    )
  ) {
    throw new TypeError(
      `${label}.applicationStateTransport snapshot must match applicationStateDestination.`,
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion: RESIDENT_REPLACEMENT_INPUT_SCHEMA_VERSION,
      kind: RESIDENT_REPLACEMENT_INPUT_KIND,
      appId: payload.appId,
      currentRevisionId: payload.currentRevisionId,
      control,
      payloadStorage,
      applicationStateDestination,
      applicationStateTransport,
    }),
  );
}

/**
 * Create one stable, credential-free receipt for independently supplied
 * replacement startup inputs. Its content ID detects field substitution but
 * does not replace the trusted provisioning channel that distributes it.
 * @param {unknown} value - Exact fields excluding schema, kind, and receipt ID.
 * @returns {ResidentReplacementInputReceipt} - Canonical immutable receipt.
 */
export function createResidentReplacementInputReceipt(value) {
  const input = exactBoundedObject(
    value,
    CREATE_KEYS,
    'resident replacement input receipt',
  );
  const payload = normalizePayload(
    {
      schemaVersion: RESIDENT_REPLACEMENT_INPUT_SCHEMA_VERSION,
      kind: RESIDENT_REPLACEMENT_INPUT_KIND,
      ...input,
    },
    'resident replacement input receipt',
  );
  const receiptId = createCanonicalJsonSha256Id({
    domain: RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_DOMAIN,
    prefix: RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath: 'resident replacement input receipt',
  });
  const receipt = exactBoundedObject(
    { ...payload, receiptId },
    RECEIPT_KEYS,
    'resident replacement input receipt',
  );
  return /** @type {ResidentReplacementInputReceipt} */ (
    deepFreeze(sortCanonicalJsonValue(receipt))
  );
}

/**
 * Validate, reidentify, and freeze a serialized replacement-input receipt.
 * @param {unknown} value - Candidate serialized receipt.
 * @param {string} [label] - Boundary label.
 * @returns {ResidentReplacementInputReceipt} - Canonical immutable receipt.
 */
export function validateResidentReplacementInputReceipt(
  value,
  label = 'resident replacement input receipt',
) {
  const receipt = exactBoundedObject(value, RECEIPT_KEYS, label);
  assertDomainSeparatedSha256Id(
    receipt.receiptId,
    RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
    `${label}.receiptId`,
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = receipt[key];
  const payload = normalizePayload(payloadInput, label);
  const expectedReceiptId = createCanonicalJsonSha256Id({
    domain: RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_DOMAIN,
    prefix: RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
    value: payload,
    valuePath: label,
  });
  if (receipt.receiptId !== expectedReceiptId) {
    throw new Error(
      `${label}.receiptId does not match its exact replacement inputs.`,
    );
  }
  return /** @type {ResidentReplacementInputReceipt} */ (
    deepFreeze(
      sortCanonicalJsonValue({ ...payload, receiptId: expectedReceiptId }),
    )
  );
}

/**
 * Render the one canonical byte artifact accepted by the durable handoff
 * store. Alternate JSON whitespace or object ordering is deliberately not a
 * second spelling for the same receipt artifact.
 * @param {unknown} value - Candidate replacement-input receipt.
 * @returns {Buffer} - Canonical compact UTF-8 JSON bytes.
 */
export function encodeResidentReplacementInputReceipt(value) {
  const receipt = validateResidentReplacementInputReceipt(value);
  return Buffer.from(JSON.stringify(sortCanonicalJsonValue(receipt)), 'utf8');
}

/**
 * Parse and validate exact canonical receipt bytes.
 * @param {unknown} value - Candidate byte artifact.
 * @param {string} [label] - Boundary label.
 * @returns {ResidentReplacementInputReceipt} - Canonical immutable receipt.
 */
export function decodeResidentReplacementInputReceipt(
  value,
  label = 'resident replacement input receipt bytes',
) {
  let byteLength;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    byteLength = value.byteLength;
  } else if (value instanceof ArrayBuffer) {
    byteLength = value.byteLength;
  } else {
    throw new TypeError(`${label} must be exact bytes.`);
  }
  if (byteLength > RESIDENT_REPLACEMENT_INPUT_MAX_BYTES) {
    throw new RangeError(
      `${label} must not exceed ${RESIDENT_REPLACEMENT_INPUT_MAX_BYTES} bytes.`,
    );
  }
  const bytes =
    value instanceof ArrayBuffer
      ? Buffer.from(new Uint8Array(value))
      : Buffer.from(value);
  let text;
  try {
    text = UTF8_DECODER.decode(bytes);
  } catch (cause) {
    throw new TypeError(`${label} must be well-formed UTF-8 JSON.`, { cause });
  }
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new TypeError(`${label} must contain valid JSON.`, { cause });
  }
  const receipt = validateResidentReplacementInputReceipt(parsed, label);
  const canonical = encodeResidentReplacementInputReceipt(receipt);
  if (!canonical.equals(bytes)) {
    throw new TypeError(`${label} must use canonical compact JSON bytes.`);
  }
  return receipt;
}

export default {
  EXECUTION_PAYLOAD_DISTRIBUTION_ID_PREFIX,
  EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
  RESIDENT_REPLACEMENT_INPUT_KIND,
  RESIDENT_REPLACEMENT_INPUT_MAX_BYTES,
  RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_DOMAIN,
  RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
  RESIDENT_REPLACEMENT_INPUT_SCHEMA_VERSION,
  createResidentReplacementInputReceipt,
  decodeResidentReplacementInputReceipt,
  encodeResidentReplacementInputReceipt,
  validateResidentReplacementInputReceipt,
};
