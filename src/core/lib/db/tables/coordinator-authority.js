/* eslint-disable jsdoc/valid-types -- The durable authority boundary keeps its exact object contracts inline. */

import {
  createCanonicalJsonSha256Id,
  assertDomainSeparatedSha256Id,
} from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import {
  assertLedgerOpaqueId,
  encodeLedgerKeySegment,
} from '../../ledger/record-key.js';
import { CONDITION_TYPE } from '../base.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';

export const COORDINATOR_AUTHORITY_SCHEMA_VERSION = 1;
export const COORDINATOR_AUTHORITY_RECORD_KIND = 'coordinator-authority';
export const COORDINATOR_AUTHORITY_REQUEST_RECORD_KIND =
  'coordinator-authority-request';
export const COORDINATOR_AUTHORITY_SORT_KEY =
  'coordinator-authority/v1/authority';
export const COORDINATOR_AUTHORITY_REQUEST_SORT_KEY_PREFIX =
  'coordinator-authority/v1/request/';
export const COORDINATOR_AUTHORITY_PARTITION_DOMAIN =
  'wharfie:coordinator-authority-partition:v1';
export const COORDINATOR_AUTHORITY_PARTITION_PREFIX = 'wcap1';
export const COORDINATOR_AUTHORITY_ID_DOMAIN =
  'wharfie:coordinator-authority:v1';
export const COORDINATOR_AUTHORITY_ID_PREFIX = 'wca1';
export const COORDINATOR_AUTHORITY_REQUEST_DOMAIN =
  'wharfie:coordinator-authority-request:v1';
export const COORDINATOR_AUTHORITY_REQUEST_PREFIX = 'wcar1';
export const COORDINATOR_AUTHORITY_MAX_RECORD_BYTES = 32 * 1024;

/**
 * @typedef {Readonly<{
 *   schemaVersion: 1,
 *   appId: string,
 *   coordinatorId: string,
 *   authorityId: string,
 *   epoch: number,
 * }>} CoordinatorAuthorityToken
 */

/**
 * @typedef {Readonly<CoordinatorAuthorityToken & {
 *   status: 'ACTIVE' | 'RELEASED',
 *   recordVersion: number,
 *   acquisitionRequestId: string,
 *   acquiredAt: number,
 *   heartbeatAt: number,
 *   releasedAt: number | null,
 *   updatedAt: number,
 *   lastRequestId: string,
 * }>} CoordinatorAuthoritySnapshot
 */

/**
 * @typedef {'acquire' | 'heartbeat' | 'release' | 'takeover'} CoordinatorAuthorityActionValue
 */

/**
 * @typedef {Readonly<{
 *   applied: boolean,
 *   action: CoordinatorAuthorityActionValue,
 *   authority: CoordinatorAuthoritySnapshot,
 * }>} CoordinatorAuthorityTransitionResult
 */

/**
 * @typedef {Readonly<{
 *   appId: string,
 *   requestId: string,
 *   requestDigest: string,
 *   action: CoordinatorAuthorityActionValue,
 *   authority: CoordinatorAuthoritySnapshot,
 * }>} CoordinatorAuthorityRequestReceipt
 */

/**
 * @typedef {Readonly<{
 *   get: (input: {appId: string}) => Promise<CoordinatorAuthoritySnapshot | null>,
 *   acquire: (input: {appId: string, coordinatorId: string, requestId: string, observedAt?: number}) => Promise<CoordinatorAuthorityTransitionResult>,
 *   renewRecordVersion: (input: {observedAuthority: unknown, requestId: string, observedAt: number}) => Promise<{applied: boolean, authority: CoordinatorAuthoritySnapshot}>,
 *   heartbeat: (input: {authority: unknown, requestId: string, observedAt?: number}) => Promise<CoordinatorAuthorityTransitionResult>,
 *   release: (input: {authority: unknown, requestId: string, observedAt?: number}) => Promise<CoordinatorAuthorityTransitionResult>,
 *   takeover: (input: {appId: string, coordinatorId: string, requestId: string, observedAuthority: unknown, confirmAuthorityReplacement: boolean, observedAt?: number}) => Promise<CoordinatorAuthorityTransitionResult>,
 * }>} CoordinatorAuthorityStore
 */

export const CoordinatorAuthorityStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  RELEASED: 'RELEASED',
});

export const CoordinatorAuthorityAction = Object.freeze({
  ACQUIRE: 'acquire',
  HEARTBEAT: 'heartbeat',
  RELEASE: 'release',
  TAKEOVER: 'takeover',
});

const AUTHORITY_STATUSES = new Set(Object.values(CoordinatorAuthorityStatus));
const AUTHORITY_ACTIONS = new Set(Object.values(CoordinatorAuthorityAction));
const TOKEN_KEYS = new Set([
  'schemaVersion',
  'appId',
  'coordinatorId',
  'authorityId',
  'epoch',
]);
const SNAPSHOT_KEYS = new Set([
  ...TOKEN_KEYS,
  'status',
  'recordVersion',
  'acquisitionRequestId',
  'acquiredAt',
  'heartbeatAt',
  'releasedAt',
  'updatedAt',
  'lastRequestId',
]);
const AUTHORITY_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'coordinator_id',
  'authority_id',
  'epoch',
  'status',
  'record_version',
  'acquisition_request_id',
  'acquired_at',
  'heartbeat_at',
  'released_at',
  'updated_at',
  'last_request_id',
]);
const REQUEST_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'request_id',
  'request_digest',
  'action',
  'authority',
]);

/** A coordinator mutation raced another authority transition. */
export class CoordinatorAuthorityConflictError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} reason - Safe conflict reason.
   * @param {{cause?: unknown}} [options] - Optional underlying failure.
   */
  constructor(appId, reason, options = {}) {
    super(`Coordinator authority changed concurrently: ${appId} (${reason})`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'CoordinatorAuthorityConflictError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT';
    this.appId = appId;
    this.reason = reason;
  }
}

/** A supplied authority token is no longer the current active authority. */
export class CoordinatorAuthorityStaleError extends Error {
  /** @param {string} appId - Application scope. */
  constructor(appId) {
    super(`Coordinator authority is stale or inactive: ${appId}`);
    this.name = 'CoordinatorAuthorityStaleError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_STALE';
    this.appId = appId;
  }
}

/** A stable request ID was reused for different authority intent. */
export class CoordinatorAuthorityRequestConflictError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} requestId - Conflicting request identity.
   */
  constructor(appId, requestId) {
    super(
      `Coordinator authority request conflicts with retained intent: ${appId}#${requestId}`,
    );
    this.name = 'CoordinatorAuthorityRequestConflictError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_REQUEST_CONFLICT';
    this.appId = appId;
    this.requestId = requestId;
  }
}

/** Retained authority bytes fail their strict structural contract. */
export class CoordinatorAuthorityRecordError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} reason - Safe integrity reason.
   * @param {{cause?: unknown}} [options] - Optional validation cause.
   */
  constructor(appId, reason, options = {}) {
    super(`Coordinator authority record is invalid: ${appId} (${reason})`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'CoordinatorAuthorityRecordError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_RECORD_INVALID';
    this.appId = appId;
    this.reason = reason;
  }
}

/** The monotonic coordinator epoch cannot advance safely. */
export class CoordinatorAuthorityEpochOverflowError extends Error {
  /** @param {string} appId - Application scope. */
  constructor(appId) {
    super(`Coordinator authority epoch cannot advance safely: ${appId}`);
    this.name = 'CoordinatorAuthorityEpochOverflowError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_EPOCH_OVERFLOW';
    this.appId = appId;
  }
}

/** The monotonic renewal version cannot advance safely. */
export class CoordinatorAuthorityRecordVersionOverflowError extends Error {
  /** @param {string} appId - Application scope. */
  constructor(appId) {
    super(
      `Coordinator authority record version cannot advance safely: ${appId}`,
    );
    this.name = 'CoordinatorAuthorityRecordVersionOverflowError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_RECORD_VERSION_OVERFLOW';
    this.appId = appId;
  }
}

/** A receiptless renewal could not prove whether its exact CAS committed. */
export class CoordinatorAuthorityRenewalUnknownError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} requestId - Exact retry identity.
   * @param {{cause?: unknown}} [options] - Provider or readback failure.
   */
  constructor(appId, requestId, options = {}) {
    super(
      `Coordinator authority renewal outcome is unknown: ${appId}#${requestId}`,
      {
        ...(options.cause === undefined ? {} : { cause: options.cause }),
      },
    );
    this.name = 'CoordinatorAuthorityRenewalUnknownError';
    this.code = 'WHARFIE_COORDINATOR_AUTHORITY_RENEWAL_UNKNOWN';
    this.appId = appId;
    this.requestId = requestId;
  }
}

/**
 * @param {unknown} value - Candidate data object.
 * @param {Set<string>} keys - Exact keys.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Strict cloned object.
 */
function exactObject(value, keys, label) {
  const object = cloneBoundedJsonObject(
    value,
    COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
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
 * @param {unknown} value - Candidate positive integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Positive safe integer.
 */
function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate nonnegative integer.
 * @param {string} label - Boundary label.
 * @returns {number} - Nonnegative safe integer.
 */
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate nullable nonnegative integer.
 * @param {string} label - Boundary label.
 * @returns {number | null} - Nullable timestamp.
 */
function nullableTimestamp(value, label) {
  return value === null ? null : nonnegativeInteger(value, label);
}

/**
 * @param {unknown} value - Candidate request/coordinator ID.
 * @param {string} label - Boundary label.
 * @returns {string} - Canonical opaque ID.
 */
function opaqueId(value, label) {
  return assertLedgerOpaqueId(value, label);
}

/**
 * Validate and freeze the stable authority identity carried by every
 * coordinator-issued mutation. Heartbeat and request metadata are excluded so
 * renewing diagnostic liveness never invalidates in-flight work.
 * @param {unknown} value - Candidate authority token.
 * @param {string} [label='coordinator authority'] - Boundary label.
 * @returns {CoordinatorAuthorityToken} - Canonical token.
 */
function normalizeToken(value, label = 'coordinator authority') {
  const token = exactObject(value, TOKEN_KEYS, label);
  if (token.schemaVersion !== COORDINATOR_AUTHORITY_SCHEMA_VERSION) {
    throw new TypeError(
      `${label}.schemaVersion must be ${COORDINATOR_AUTHORITY_SCHEMA_VERSION}.`,
    );
  }
  assertLogicalId(token.appId, `${label}.appId`);
  const coordinatorId = opaqueId(token.coordinatorId, `${label}.coordinatorId`);
  assertDomainSeparatedSha256Id(
    token.authorityId,
    COORDINATOR_AUTHORITY_ID_PREFIX,
    `${label}.authorityId`,
  );
  const epoch = positiveInteger(token.epoch, `${label}.epoch`);
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    appId: token.appId,
    coordinatorId,
    authorityId: token.authorityId,
    epoch,
  });
}

/**
 * Project either an exact token or a complete authority snapshot to the stable
 * identity required by fenced ledger writes.
 * @param {unknown} value - Candidate token or full authority snapshot.
 * @param {string} [label='coordinator authority'] - Boundary label.
 * @returns {CoordinatorAuthorityToken} - Canonical token.
 */
export function assertCoordinatorAuthorityToken(
  value,
  label = 'coordinator authority',
) {
  const candidate = cloneBoundedJsonObject(
    value,
    COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
    label,
  );
  const keys = Object.keys(candidate);
  if (
    keys.length === TOKEN_KEYS.size &&
    keys.every((key) => TOKEN_KEYS.has(key))
  ) {
    return normalizeToken(candidate, label);
  }
  if (
    keys.length === SNAPSHOT_KEYS.size &&
    keys.every((key) => SNAPSHOT_KEYS.has(key))
  ) {
    const snapshot = normalizeSnapshot(candidate, label);
    return normalizeToken(
      {
        schemaVersion: snapshot.schemaVersion,
        appId: snapshot.appId,
        coordinatorId: snapshot.coordinatorId,
        authorityId: snapshot.authorityId,
        epoch: snapshot.epoch,
      },
      label,
    );
  }
  throw new TypeError(`${label} has unsupported or missing fields.`);
}

/** Explicitly named alias for callers projecting a returned full snapshot. */
export const createCoordinatorAuthorityToken = assertCoordinatorAuthorityToken;

/**
 * @param {unknown} value - Candidate full snapshot.
 * @param {string} label - Boundary label.
 * @returns {CoordinatorAuthoritySnapshot} - Canonical frozen snapshot.
 */
function normalizeSnapshot(value, label) {
  const snapshot = exactObject(value, SNAPSHOT_KEYS, label);
  const token = normalizeToken(
    Object.fromEntries([...TOKEN_KEYS].map((key) => [key, snapshot[key]])),
    label,
  );
  if (!AUTHORITY_STATUSES.has(snapshot.status)) {
    throw new TypeError(`${label}.status is not supported.`);
  }
  const recordVersion = positiveInteger(
    snapshot.recordVersion,
    `${label}.recordVersion`,
  );
  const acquiredAt = nonnegativeInteger(
    snapshot.acquiredAt,
    `${label}.acquiredAt`,
  );
  const acquisitionRequestId = opaqueId(
    snapshot.acquisitionRequestId,
    `${label}.acquisitionRequestId`,
  );
  const heartbeatAt = nonnegativeInteger(
    snapshot.heartbeatAt,
    `${label}.heartbeatAt`,
  );
  const releasedAt = nullableTimestamp(
    snapshot.releasedAt,
    `${label}.releasedAt`,
  );
  const updatedAt = nonnegativeInteger(
    snapshot.updatedAt,
    `${label}.updatedAt`,
  );
  const lastRequestId = opaqueId(
    snapshot.lastRequestId,
    `${label}.lastRequestId`,
  );
  if (
    heartbeatAt < acquiredAt ||
    updatedAt < heartbeatAt ||
    (snapshot.status === CoordinatorAuthorityStatus.ACTIVE &&
      releasedAt !== null) ||
    (snapshot.status === CoordinatorAuthorityStatus.RELEASED &&
      (releasedAt === null ||
        releasedAt < heartbeatAt ||
        updatedAt < releasedAt))
  ) {
    throw new TypeError(`${label} has inconsistent lifecycle timestamps.`);
  }
  if (
    createAuthorityId({
      appId: token.appId,
      coordinatorId: token.coordinatorId,
      epoch: token.epoch,
      requestId: acquisitionRequestId,
    }) !== token.authorityId
  ) {
    throw new TypeError(
      `${label}.authorityId does not match its acquisition identity.`,
    );
  }
  return Object.freeze({
    ...token,
    status: snapshot.status,
    recordVersion,
    acquisitionRequestId,
    acquiredAt,
    heartbeatAt,
    releasedAt,
    updatedAt,
    lastRequestId,
  });
}

/**
 * @param {string} appId - Application identity.
 * @returns {string} - Reserved authority partition.
 */
export function getCoordinatorAuthorityPartitionKey(appId) {
  assertLogicalId(appId, 'appId');
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_AUTHORITY_PARTITION_DOMAIN,
    prefix: COORDINATOR_AUTHORITY_PARTITION_PREFIX,
    value: {
      schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
      appId,
    },
    valuePath: 'coordinator authority partition',
  });
}

/**
 * @param {string} requestId - Stable request identity.
 * @returns {string} - Request receipt sort key.
 */
function getRequestSortKey(requestId) {
  return `${COORDINATOR_AUTHORITY_REQUEST_SORT_KEY_PREFIX}${encodeLedgerKeySegment(
    requestId,
    'coordinator authority requestId',
  )}`;
}

/**
 * Build the condition check that must share a transaction with a
 * coordinator-issued durable mutation. This is manual fencing, not a lease:
 * the row stays authoritative until graceful release or explicit takeover.
 * @param {unknown} authority - Stable authority token.
 * @returns {Readonly<import('../base.js').TransactionConditionCheck>} - Portable authority condition.
 */
export function createCoordinatorAuthorityFence(authority) {
  const token = assertCoordinatorAuthorityToken(authority);
  return Object.freeze({
    keyName: KEY_NAME,
    keyValue: getCoordinatorAuthorityPartitionKey(token.appId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: COORDINATOR_AUTHORITY_SORT_KEY,
    conditions: [
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'schema_version',
        propertyValue: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
      }),
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'record_kind',
        propertyValue: COORDINATOR_AUTHORITY_RECORD_KIND,
      }),
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'app_id',
        propertyValue: token.appId,
      }),
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'status',
        propertyValue: CoordinatorAuthorityStatus.ACTIVE,
      }),
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'coordinator_id',
        propertyValue: token.coordinatorId,
      }),
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'authority_id',
        propertyValue: token.authorityId,
      }),
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName: 'epoch',
        propertyValue: token.epoch,
      }),
    ],
  });
}

/**
 * @param {CoordinatorAuthoritySnapshot} snapshot - Canonical snapshot.
 * @returns {Readonly<Record<string, any>>} - Physical authority record.
 */
function createAuthorityRecord(snapshot) {
  return Object.freeze({
    [KEY_NAME]: getCoordinatorAuthorityPartitionKey(snapshot.appId),
    [SORT_KEY_NAME]: COORDINATOR_AUTHORITY_SORT_KEY,
    schema_version: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    record_kind: COORDINATOR_AUTHORITY_RECORD_KIND,
    app_id: snapshot.appId,
    coordinator_id: snapshot.coordinatorId,
    authority_id: snapshot.authorityId,
    epoch: snapshot.epoch,
    status: snapshot.status,
    record_version: snapshot.recordVersion,
    acquisition_request_id: snapshot.acquisitionRequestId,
    acquired_at: snapshot.acquiredAt,
    heartbeat_at: snapshot.heartbeatAt,
    released_at: snapshot.releasedAt,
    updated_at: snapshot.updatedAt,
    last_request_id: snapshot.lastRequestId,
  });
}

/**
 * @param {unknown} raw - Candidate physical record.
 * @param {string} appId - Exact requested scope.
 * @returns {CoordinatorAuthoritySnapshot} - Canonical snapshot.
 */
function normalizeAuthorityRecord(raw, appId) {
  try {
    const record = exactObject(
      raw,
      AUTHORITY_RECORD_KEYS,
      'coordinator authority record',
    );
    if (
      record[KEY_NAME] !== getCoordinatorAuthorityPartitionKey(appId) ||
      record[SORT_KEY_NAME] !== COORDINATOR_AUTHORITY_SORT_KEY ||
      record.schema_version !== COORDINATOR_AUTHORITY_SCHEMA_VERSION ||
      record.record_kind !== COORDINATOR_AUTHORITY_RECORD_KIND ||
      record.app_id !== appId
    ) {
      throw new TypeError('coordinator authority record scope is invalid.');
    }
    return normalizeSnapshot(
      {
        schemaVersion: record.schema_version,
        appId: record.app_id,
        coordinatorId: record.coordinator_id,
        authorityId: record.authority_id,
        epoch: record.epoch,
        status: record.status,
        recordVersion: record.record_version,
        acquisitionRequestId: record.acquisition_request_id,
        acquiredAt: record.acquired_at,
        heartbeatAt: record.heartbeat_at,
        releasedAt: record.released_at,
        updatedAt: record.updated_at,
        lastRequestId: record.last_request_id,
      },
      'coordinator authority snapshot',
    );
  } catch (cause) {
    if (cause instanceof CoordinatorAuthorityRecordError) throw cause;
    throw new CoordinatorAuthorityRecordError(appId, 'record shape', {
      cause,
    });
  }
}

/**
 * @param {CoordinatorAuthoritySnapshot} snapshot - Accepted transition.
 * @param {string} requestId - Stable request identity.
 * @param {string} requestDigest - Immutable request digest.
 * @param {string} action - Transition action.
 * @returns {Readonly<Record<string, any>>} - Immutable physical request receipt.
 */
function createRequestRecord(snapshot, requestId, requestDigest, action) {
  return Object.freeze({
    [KEY_NAME]: getCoordinatorAuthorityPartitionKey(snapshot.appId),
    [SORT_KEY_NAME]: getRequestSortKey(requestId),
    schema_version: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    record_kind: COORDINATOR_AUTHORITY_REQUEST_RECORD_KIND,
    app_id: snapshot.appId,
    request_id: requestId,
    request_digest: requestDigest,
    action,
    authority: snapshot,
  });
}

/**
 * @param {unknown} raw - Candidate request receipt.
 * @param {string} appId - Application scope.
 * @param {string} requestId - Requested receipt identity.
 * @returns {CoordinatorAuthorityRequestReceipt} - Canonical receipt.
 */
function normalizeRequestRecord(raw, appId, requestId) {
  try {
    const record = exactObject(
      raw,
      REQUEST_RECORD_KEYS,
      'coordinator authority request record',
    );
    if (
      record[KEY_NAME] !== getCoordinatorAuthorityPartitionKey(appId) ||
      record[SORT_KEY_NAME] !== getRequestSortKey(requestId) ||
      record.schema_version !== COORDINATOR_AUTHORITY_SCHEMA_VERSION ||
      record.record_kind !== COORDINATOR_AUTHORITY_REQUEST_RECORD_KIND ||
      record.app_id !== appId ||
      record.request_id !== requestId ||
      !AUTHORITY_ACTIONS.has(record.action)
    ) {
      throw new TypeError('coordinator authority request record is invalid.');
    }
    assertDomainSeparatedSha256Id(
      record.request_digest,
      COORDINATOR_AUTHORITY_REQUEST_PREFIX,
      'coordinator authority request record.request_digest',
    );
    return Object.freeze({
      appId,
      requestId,
      requestDigest: record.request_digest,
      action: record.action,
      authority: normalizeSnapshot(
        record.authority,
        'coordinator authority request record.authority',
      ),
    });
  } catch (cause) {
    if (cause instanceof CoordinatorAuthorityRecordError) throw cause;
    throw new CoordinatorAuthorityRecordError(appId, 'request receipt shape', {
      cause,
    });
  }
}

/**
 * @param {string} action - Action.
 * @param {Record<string, any>} request - Canonical semantic request.
 * @returns {string} - Content-addressed request digest.
 */
function createRequestDigest(action, request) {
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_AUTHORITY_REQUEST_DOMAIN,
    prefix: COORDINATOR_AUTHORITY_REQUEST_PREFIX,
    value: {
      schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
      action,
      ...request,
    },
    valuePath: 'coordinator authority request',
  });
}

/**
 * @param {CoordinatorAuthoritySnapshot} snapshot - Current snapshot.
 * @returns {import('../base.js').KeyCondition[]} - Exact predecessor CAS.
 */
function exactRecordConditions(snapshot) {
  const record = createAuthorityRecord(snapshot);
  return Object.entries(record)
    .filter(([key]) => key !== KEY_NAME && key !== SORT_KEY_NAME)
    .map(([propertyName, propertyValue]) => ({
      conditionType: CONDITION_TYPE.EQUALS,
      propertyName,
      propertyValue,
    }));
}

/**
 * @param {unknown} error - Candidate DB failure.
 * @returns {boolean} - Whether a portable conditional check failed.
 */
function isConditionalFailure(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * @param {unknown} value - Optional diagnostic timestamp.
 * @returns {number} - Nonnegative diagnostic time.
 */
function observedAt(value) {
  return nonnegativeInteger(
    value === undefined ? Date.now() : value,
    'observedAt',
  );
}

/**
 * @param {CoordinatorAuthoritySnapshot} snapshot - Current authority.
 * @param {CoordinatorAuthorityToken} token - Expected token.
 * @returns {boolean} - Whether the stable identity matches.
 */
function sameAuthority(snapshot, token) {
  return (
    snapshot.appId === token.appId &&
    snapshot.coordinatorId === token.coordinatorId &&
    snapshot.authorityId === token.authorityId &&
    snapshot.epoch === token.epoch
  );
}

/**
 * Strongly check whether a token still names the current active authority.
 * This read is diagnostic; mutation callers must place
 * `createCoordinatorAuthorityFence()` in the same transaction as their write.
 * @param {{db: import('../base.js').DBClient, tableName: string, authority: unknown}} options - Read dependencies and token.
 * @returns {Promise<CoordinatorAuthoritySnapshot>} - Current full snapshot.
 */
export async function assertCoordinatorAuthorityCurrent(options) {
  if (!options?.db || typeof options.db.get !== 'function') {
    throw new TypeError(
      'assertCoordinatorAuthorityCurrent requires a DB client with get.',
    );
  }
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError(
      'assertCoordinatorAuthorityCurrent requires a tableName.',
    );
  }
  const token = assertCoordinatorAuthorityToken(options.authority);
  const raw = await options.db.get({
    tableName: options.tableName.trim(),
    keyName: KEY_NAME,
    keyValue: getCoordinatorAuthorityPartitionKey(token.appId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: COORDINATOR_AUTHORITY_SORT_KEY,
    consistentRead: true,
  });
  if (!raw) throw new CoordinatorAuthorityStaleError(token.appId);
  const current = normalizeAuthorityRecord(raw, token.appId);
  if (
    current.status !== CoordinatorAuthorityStatus.ACTIVE ||
    !sameAuthority(current, token)
  ) {
    throw new CoordinatorAuthorityStaleError(token.appId);
  }
  return current;
}

/**
 * Create the explicit manual-failover coordinator authority store. Heartbeats
 * are diagnostic only. Nothing in this module infers authority from time,
 * heartbeat age, process liveness, or message delivery.
 * @param {{db: import('../base.js').DBClient, tableName: string}} options - Durable table dependencies.
 * @returns {CoordinatorAuthorityStore} - Strict authority state-machine operations.
 */
export function createCoordinatorAuthority(options) {
  if (
    !options?.db ||
    typeof options.db.get !== 'function' ||
    typeof options.db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createCoordinatorAuthority requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError('createCoordinatorAuthority requires a tableName.');
  }
  const db = options.db;
  const tableName = options.tableName.trim();

  /**
   * @param {string} appId - Application identity.
   * @returns {Promise<CoordinatorAuthoritySnapshot | null>} - Current snapshot.
   */
  async function readAuthority(appId) {
    assertLogicalId(appId, 'appId');
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getCoordinatorAuthorityPartitionKey(appId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: COORDINATOR_AUTHORITY_SORT_KEY,
      consistentRead: true,
    });
    return raw ? normalizeAuthorityRecord(raw, appId) : null;
  }

  /**
   * @param {string} appId - Application identity.
   * @param {string} requestId - Request identity.
   * @returns {Promise<CoordinatorAuthorityRequestReceipt | null>} - Retained receipt.
   */
  async function readRequest(appId, requestId) {
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getCoordinatorAuthorityPartitionKey(appId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: getRequestSortKey(requestId),
      consistentRead: true,
    });
    return raw ? normalizeRequestRecord(raw, appId, requestId) : null;
  }

  /**
   * @param {CoordinatorAuthoritySnapshot | null} current - CAS predecessor.
   * @param {CoordinatorAuthoritySnapshot} next - Successor snapshot.
   * @param {string} requestId - Stable request identity.
   * @param {string} requestDigest - Exact request digest.
   * @param {CoordinatorAuthorityActionValue} action - Authority action.
   * @returns {Promise<CoordinatorAuthorityTransitionResult>} - Accepted transition or replay.
   */
  async function writeTransition(
    current,
    next,
    requestId,
    requestDigest,
    action,
  ) {
    const existing = await readRequest(next.appId, requestId);
    if (existing) {
      if (
        existing.requestDigest !== requestDigest ||
        existing.action !== action
      ) {
        throw new CoordinatorAuthorityRequestConflictError(
          next.appId,
          requestId,
        );
      }
      return {
        applied: false,
        action,
        authority: existing.authority,
      };
    }

    /** @type {unknown} */
    let writeError;
    try {
      await db.transactionWrite({
        tableName,
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: createAuthorityRecord(next),
            conditions: current
              ? exactRecordConditions(current)
              : [
                  {
                    conditionType: CONDITION_TYPE.NOT_EXISTS,
                    propertyName: SORT_KEY_NAME,
                  },
                ],
          },
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: createRequestRecord(next, requestId, requestDigest, action),
            conditions: [
              {
                conditionType: CONDITION_TYPE.NOT_EXISTS,
                propertyName: SORT_KEY_NAME,
              },
            ],
          },
        ],
      });
    } catch (error) {
      writeError = error;
    }
    if (writeError === undefined) {
      return { applied: true, action, authority: next };
    }

    // A transport or conditional response can be lost after the complete
    // transaction commits. The immutable receipt is the only positive
    // readback proof that this exact request won.
    const retained = await readRequest(next.appId, requestId);
    if (retained) {
      if (
        retained.requestDigest !== requestDigest ||
        retained.action !== action
      ) {
        throw new CoordinatorAuthorityRequestConflictError(
          next.appId,
          requestId,
        );
      }
      return {
        applied: !isConditionalFailure(writeError),
        action,
        authority: retained.authority,
      };
    }
    if (!isConditionalFailure(writeError)) throw writeError;
    throw new CoordinatorAuthorityConflictError(
      next.appId,
      'another authority transition won the exact predecessor race',
      { cause: writeError },
    );
  }

  /**
   * @param {{appId: string}} input - Application scope.
   * @returns {Promise<CoordinatorAuthoritySnapshot | null>} - Durable snapshot.
   */
  async function get(input) {
    const value = cloneBoundedJsonObject(
      input,
      COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
      'coordinatorAuthority.get',
    );
    if (
      Object.keys(value).length !== 1 ||
      !Object.prototype.hasOwnProperty.call(value, 'appId')
    ) {
      throw new TypeError(
        'coordinatorAuthority.get has unsupported or missing fields.',
      );
    }
    return await readAuthority(value.appId);
  }

  /**
   * @param {{appId: string, coordinatorId: string, requestId: string, observedAt?: number}} input - Fresh explicit authority request.
   * @returns {Promise<CoordinatorAuthorityTransitionResult>} - Acquisition result.
   */
  async function acquire(input) {
    const value = cloneBoundedJsonObject(
      input,
      COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
      'coordinatorAuthority.acquire',
    );
    const allowed = new Set([
      'appId',
      'coordinatorId',
      'requestId',
      'observedAt',
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new TypeError(
        'coordinatorAuthority.acquire contains unsupported fields.',
      );
    }
    assertLogicalId(value.appId, 'coordinatorAuthority.acquire.appId');
    const coordinatorId = opaqueId(
      value.coordinatorId,
      'coordinatorAuthority.acquire.coordinatorId',
    );
    const requestId = opaqueId(
      value.requestId,
      'coordinatorAuthority.acquire.requestId',
    );
    const timestamp = observedAt(value.observedAt);
    const requestDigest = createRequestDigest(
      CoordinatorAuthorityAction.ACQUIRE,
      { appId: value.appId, coordinatorId, requestId },
    );
    const existingReceipt = await readRequest(value.appId, requestId);
    if (existingReceipt) {
      if (
        existingReceipt.requestDigest !== requestDigest ||
        existingReceipt.action !== CoordinatorAuthorityAction.ACQUIRE
      ) {
        throw new CoordinatorAuthorityRequestConflictError(
          value.appId,
          requestId,
        );
      }
      return {
        applied: false,
        action: CoordinatorAuthorityAction.ACQUIRE,
        authority: existingReceipt.authority,
      };
    }
    const current = await readAuthority(value.appId);
    if (current?.status === CoordinatorAuthorityStatus.ACTIVE) {
      const racedReceipt = await readRequest(value.appId, requestId);
      if (racedReceipt) {
        if (
          racedReceipt.requestDigest !== requestDigest ||
          racedReceipt.action !== CoordinatorAuthorityAction.ACQUIRE
        ) {
          throw new CoordinatorAuthorityRequestConflictError(
            value.appId,
            requestId,
          );
        }
        return {
          applied: false,
          action: CoordinatorAuthorityAction.ACQUIRE,
          authority: racedReceipt.authority,
        };
      }
      throw new CoordinatorAuthorityConflictError(
        value.appId,
        'active authority must be gracefully released or explicitly taken over',
      );
    }
    const epoch = current ? nextEpoch(current) : 1;
    const authorityId = createAuthorityId({
      appId: value.appId,
      coordinatorId,
      epoch,
      requestId,
    });
    const next = normalizeSnapshot(
      {
        schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
        appId: value.appId,
        coordinatorId,
        authorityId,
        epoch,
        status: CoordinatorAuthorityStatus.ACTIVE,
        recordVersion: current ? nextRecordVersion(current) : 1,
        acquisitionRequestId: requestId,
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        releasedAt: null,
        updatedAt: timestamp,
        lastRequestId: requestId,
      },
      'coordinator authority acquisition',
    );
    return await writeTransition(
      current,
      next,
      requestId,
      requestDigest,
      CoordinatorAuthorityAction.ACQUIRE,
    );
  }

  /**
   * Advance only the renewable record version under an exact ACTIVE snapshot
   * CAS. Unlike a diagnostic heartbeat, this bounded primitive deliberately
   * writes no permanent per-renewal receipt. An uncertain caller must retry
   * this exact predecessor, request ID, and observedAt tuple.
   * @param {{observedAuthority: unknown, requestId: string, observedAt: number}} input - Exact renewable predecessor and retry identity.
   * @returns {Promise<{applied: boolean, authority: CoordinatorAuthoritySnapshot}>} - Exact renewal or retained retry result.
   */
  async function renewRecordVersion(input) {
    const value = cloneBoundedJsonObject(
      input,
      COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
      'coordinatorAuthority.renewRecordVersion',
    );
    const allowed = new Set(['observedAuthority', 'requestId', 'observedAt']);
    if (
      Object.keys(value).length !== allowed.size ||
      Object.keys(value).some((key) => !allowed.has(key))
    ) {
      throw new TypeError(
        'coordinatorAuthority.renewRecordVersion contains unsupported or missing fields.',
      );
    }
    const observed = normalizeSnapshot(
      value.observedAuthority,
      'coordinatorAuthority.renewRecordVersion.observedAuthority',
    );
    if (observed.status !== CoordinatorAuthorityStatus.ACTIVE) {
      throw new TypeError(
        'coordinatorAuthority.renewRecordVersion requires an ACTIVE predecessor.',
      );
    }
    const requestId = opaqueId(
      value.requestId,
      'coordinatorAuthority.renewRecordVersion.requestId',
    );
    const timestamp = nonnegativeInteger(
      value.observedAt,
      'coordinatorAuthority.renewRecordVersion.observedAt',
    );
    const next = normalizeSnapshot(
      {
        ...observed,
        recordVersion: nextRecordVersion(observed),
        heartbeatAt: Math.max(observed.heartbeatAt, timestamp),
        updatedAt: Math.max(observed.updatedAt, timestamp),
        lastRequestId: requestId,
      },
      'coordinator authority record-version renewal',
    );

    const current = await readAuthority(observed.appId);
    if (current && sameSnapshot(current, next)) {
      return { applied: false, authority: current };
    }
    if (!current || !sameSnapshot(current, observed)) {
      if (
        !current ||
        current.status !== CoordinatorAuthorityStatus.ACTIVE ||
        !sameAuthority(current, observed)
      ) {
        throw new CoordinatorAuthorityStaleError(observed.appId);
      }
      throw new CoordinatorAuthorityConflictError(
        observed.appId,
        'renewal predecessor record version is no longer current',
      );
    }

    /** @type {unknown} */
    let writeError;
    try {
      await db.transactionWrite({
        tableName,
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: createAuthorityRecord(next),
            conditions: exactRecordConditions(observed),
          },
        ],
      });
    } catch (error) {
      writeError = error;
    }
    if (writeError === undefined) {
      return { applied: true, authority: next };
    }

    /** @type {CoordinatorAuthoritySnapshot | null} */
    let retained;
    try {
      retained = await readAuthority(observed.appId);
    } catch (readbackError) {
      throw new CoordinatorAuthorityRenewalUnknownError(
        observed.appId,
        requestId,
        {
          cause: new AggregateError(
            [writeError, readbackError],
            'Coordinator renewal write and strong readback both failed.',
          ),
        },
      );
    }
    if (retained && sameSnapshot(retained, next)) {
      return { applied: true, authority: retained };
    }
    if (retained && sameSnapshot(retained, observed)) {
      throw new CoordinatorAuthorityRenewalUnknownError(
        observed.appId,
        requestId,
        { cause: writeError },
      );
    }
    if (
      !retained ||
      retained.status !== CoordinatorAuthorityStatus.ACTIVE ||
      !sameAuthority(retained, observed)
    ) {
      throw new CoordinatorAuthorityStaleError(observed.appId);
    }
    throw new CoordinatorAuthorityConflictError(
      observed.appId,
      'another renewal advanced the record version',
      { cause: writeError },
    );
  }

  /**
   * @param {{authority: unknown, requestId: string, observedAt?: number}} input - Exact owner heartbeat.
   * @returns {Promise<CoordinatorAuthorityTransitionResult>} - Diagnostic heartbeat result.
   */
  async function heartbeat(input) {
    return await mutateCurrent(
      input,
      CoordinatorAuthorityAction.HEARTBEAT,
      (current, timestamp, requestId) => ({
        ...current,
        recordVersion: nextRecordVersion(current),
        heartbeatAt: Math.max(current.heartbeatAt, timestamp),
        updatedAt: Math.max(current.updatedAt, timestamp),
        lastRequestId: requestId,
      }),
    );
  }

  /**
   * @param {{authority: unknown, requestId: string, observedAt?: number}} input - Graceful owner release.
   * @returns {Promise<CoordinatorAuthorityTransitionResult>} - Release result.
   */
  async function release(input) {
    return await mutateCurrent(
      input,
      CoordinatorAuthorityAction.RELEASE,
      (current, timestamp, requestId) => {
        const releasedAt = Math.max(current.heartbeatAt, timestamp);
        return {
          ...current,
          status: CoordinatorAuthorityStatus.RELEASED,
          recordVersion: nextRecordVersion(current),
          releasedAt,
          updatedAt: Math.max(current.updatedAt, releasedAt),
          lastRequestId: requestId,
        };
      },
    );
  }

  /**
   * @param {unknown} input - Exact current-owner mutation.
   * @param {'heartbeat'|'release'} action - Action.
   * @param {(current: CoordinatorAuthoritySnapshot, timestamp: number, requestId: string) => Record<string, any>} makeNext - Successor factory.
   * @returns {Promise<CoordinatorAuthorityTransitionResult>} - Transition result.
   */
  async function mutateCurrent(input, action, makeNext) {
    const value = cloneBoundedJsonObject(
      input,
      COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
      `coordinatorAuthority.${action}`,
    );
    const allowed = new Set(['authority', 'requestId', 'observedAt']);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new TypeError(
        `coordinatorAuthority.${action} contains unsupported fields.`,
      );
    }
    const token = assertCoordinatorAuthorityToken(
      value.authority,
      `coordinatorAuthority.${action}.authority`,
    );
    const requestId = opaqueId(
      value.requestId,
      `coordinatorAuthority.${action}.requestId`,
    );
    const requestDigest = createRequestDigest(action, {
      authority: token,
      requestId,
    });
    const existingReceipt = await readRequest(token.appId, requestId);
    if (existingReceipt) {
      if (
        existingReceipt.requestDigest !== requestDigest ||
        existingReceipt.action !== action
      ) {
        throw new CoordinatorAuthorityRequestConflictError(
          token.appId,
          requestId,
        );
      }
      return { applied: false, action, authority: existingReceipt.authority };
    }
    const current = await readAuthority(token.appId);
    if (
      !current ||
      current.status !== CoordinatorAuthorityStatus.ACTIVE ||
      !sameAuthority(current, token)
    ) {
      throw new CoordinatorAuthorityStaleError(token.appId);
    }
    const next = normalizeSnapshot(
      makeNext(current, observedAt(value.observedAt), requestId),
      `coordinator authority ${action}`,
    );
    return await writeTransition(
      current,
      next,
      requestId,
      requestDigest,
      action,
    );
  }

  /**
   * @param {{appId: string, coordinatorId: string, requestId: string, observedAuthority: unknown, confirmAuthorityReplacement: boolean, observedAt?: number}} input - Explicit caller-confirmed replacement.
   * @returns {Promise<CoordinatorAuthorityTransitionResult>} - Takeover result.
   */
  async function takeover(input) {
    const value = cloneBoundedJsonObject(
      input,
      COORDINATOR_AUTHORITY_MAX_RECORD_BYTES,
      'coordinatorAuthority.takeover',
    );
    const allowed = new Set([
      'appId',
      'coordinatorId',
      'requestId',
      'observedAuthority',
      'confirmAuthorityReplacement',
      'observedAt',
    ]);
    if (Object.keys(value).some((key) => !allowed.has(key))) {
      throw new TypeError(
        'coordinatorAuthority.takeover contains unsupported fields.',
      );
    }
    assertLogicalId(value.appId, 'coordinatorAuthority.takeover.appId');
    const coordinatorId = opaqueId(
      value.coordinatorId,
      'coordinatorAuthority.takeover.coordinatorId',
    );
    const requestId = opaqueId(
      value.requestId,
      'coordinatorAuthority.takeover.requestId',
    );
    if (value.confirmAuthorityReplacement !== true) {
      throw new TypeError(
        'coordinatorAuthority.takeover.confirmAuthorityReplacement must be true.',
      );
    }
    const observed = normalizeSnapshot(
      value.observedAuthority,
      'coordinatorAuthority.takeover.observedAuthority',
    );
    if (
      observed.appId !== value.appId ||
      observed.status !== CoordinatorAuthorityStatus.ACTIVE
    ) {
      throw new TypeError(
        'coordinatorAuthority.takeover requires the exact active predecessor for appId.',
      );
    }
    const requestDigest = createRequestDigest(
      CoordinatorAuthorityAction.TAKEOVER,
      {
        appId: value.appId,
        coordinatorId,
        requestId,
        observedAuthority: observed,
        confirmAuthorityReplacement: true,
      },
    );
    const existingReceipt = await readRequest(value.appId, requestId);
    if (existingReceipt) {
      if (
        existingReceipt.requestDigest !== requestDigest ||
        existingReceipt.action !== CoordinatorAuthorityAction.TAKEOVER
      ) {
        throw new CoordinatorAuthorityRequestConflictError(
          value.appId,
          requestId,
        );
      }
      return {
        applied: false,
        action: CoordinatorAuthorityAction.TAKEOVER,
        authority: existingReceipt.authority,
      };
    }
    const current = await readAuthority(value.appId);
    if (!current || !sameSnapshot(current, observed)) {
      const racedReceipt = await readRequest(value.appId, requestId);
      if (racedReceipt) {
        if (
          racedReceipt.requestDigest !== requestDigest ||
          racedReceipt.action !== CoordinatorAuthorityAction.TAKEOVER
        ) {
          throw new CoordinatorAuthorityRequestConflictError(
            value.appId,
            requestId,
          );
        }
        return {
          applied: false,
          action: CoordinatorAuthorityAction.TAKEOVER,
          authority: racedReceipt.authority,
        };
      }
      throw new CoordinatorAuthorityConflictError(
        value.appId,
        'explicit takeover predecessor is no longer current',
      );
    }
    const epoch = nextEpoch(current);
    const timestamp = observedAt(value.observedAt);
    const next = normalizeSnapshot(
      {
        schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
        appId: value.appId,
        coordinatorId,
        authorityId: createAuthorityId({
          appId: value.appId,
          coordinatorId,
          epoch,
          requestId,
        }),
        epoch,
        status: CoordinatorAuthorityStatus.ACTIVE,
        recordVersion: nextRecordVersion(current),
        acquisitionRequestId: requestId,
        acquiredAt: timestamp,
        heartbeatAt: timestamp,
        releasedAt: null,
        updatedAt: timestamp,
        lastRequestId: requestId,
      },
      'coordinator authority takeover',
    );
    return await writeTransition(
      current,
      next,
      requestId,
      requestDigest,
      CoordinatorAuthorityAction.TAKEOVER,
    );
  }

  return Object.freeze({
    get,
    acquire,
    renewRecordVersion,
    heartbeat,
    release,
    takeover,
  });
}

/**
 * @param {{appId: string, coordinatorId: string, epoch: number, requestId: string}} input - Authority identity inputs.
 * @returns {string} - Content-addressed authority identity.
 */
function createAuthorityId(input) {
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
    prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
    value: {
      schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
      appId: input.appId,
      coordinatorId: input.coordinatorId,
      epoch: input.epoch,
      requestId: input.requestId,
    },
    valuePath: 'coordinator authority identity',
  });
}

/**
 * @param {CoordinatorAuthoritySnapshot} current - Current snapshot.
 * @returns {number} - Next epoch.
 */
function nextEpoch(current) {
  if (current.epoch >= Number.MAX_SAFE_INTEGER) {
    throw new CoordinatorAuthorityEpochOverflowError(current.appId);
  }
  return current.epoch + 1;
}

/**
 * @param {CoordinatorAuthoritySnapshot} current - Current snapshot.
 * @returns {number} - Next renewable record version.
 */
function nextRecordVersion(current) {
  if (current.recordVersion >= Number.MAX_SAFE_INTEGER) {
    throw new CoordinatorAuthorityRecordVersionOverflowError(current.appId);
  }
  return current.recordVersion + 1;
}

/**
 * @param {CoordinatorAuthoritySnapshot} left - Snapshot.
 * @param {CoordinatorAuthoritySnapshot} right - Snapshot.
 * @returns {boolean} - Exact canonical equality.
 */
function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export default createCoordinatorAuthority;
