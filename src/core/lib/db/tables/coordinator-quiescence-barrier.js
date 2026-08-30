/* eslint-disable jsdoc/valid-types -- The durable barrier keeps exact object contracts inline. */

import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import {
  assertLedgerOpaqueId,
  encodeLedgerKeySegment,
} from '../../ledger/record-key.js';
import { CONDITION_TYPE } from '../base.js';
import {
  CoordinatorAuthorityRecordError,
  CoordinatorAuthorityStaleError,
  assertCoordinatorAuthorityCurrent,
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthorityFence,
} from './coordinator-authority.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';

export const COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION = 1;
export const COORDINATOR_QUIESCENCE_BARRIER_RECORD_KIND =
  'coordinator-quiescence-barrier';
export const COORDINATOR_QUIESCENCE_BARRIER_REQUEST_RECORD_KIND =
  'coordinator-quiescence-barrier-request';
export const COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY =
  'coordinator-quiescence-barrier/v1/state';
export const COORDINATOR_QUIESCENCE_BARRIER_REQUEST_SORT_KEY_PREFIX =
  'coordinator-quiescence-barrier/v1/request/';
export const COORDINATOR_QUIESCENCE_BARRIER_PARTITION_DOMAIN =
  'wharfie:coordinator-quiescence-barrier-partition:v1';
export const COORDINATOR_QUIESCENCE_BARRIER_PARTITION_PREFIX = 'wcqbp1';
export const COORDINATOR_QUIESCENCE_BARRIER_REQUEST_DOMAIN =
  'wharfie:coordinator-quiescence-barrier-request:v1';
export const COORDINATOR_QUIESCENCE_BARRIER_REQUEST_PREFIX = 'wcqbr1';
export const COORDINATOR_QUIESCENCE_BARRIER_RECORD_DOMAIN =
  'wharfie:coordinator-quiescence-barrier-record:v1';
export const COORDINATOR_QUIESCENCE_BARRIER_RECORD_PREFIX = 'wcqbs1';
export const COORDINATOR_QUIESCENCE_BARRIER_RECEIPT_DOMAIN =
  'wharfie:coordinator-quiescence-barrier-receipt:v1';
export const COORDINATOR_QUIESCENCE_BARRIER_RECEIPT_PREFIX = 'wcqbc1';
export const COORDINATOR_QUIESCENCE_BARRIER_MAX_RECORD_BYTES = 32 * 1024;

/**
 * @typedef {Readonly<{
 *   schemaVersion: 1,
 *   appId: string,
 *   state: 'OPEN' | 'CLOSED',
 *   version: number,
 *   authority: import('./coordinator-authority.js').CoordinatorAuthorityToken,
 *   lastAction: 'close' | 'adopt' | 'reopen',
 *   lastRequestId: string,
 *   updatedAt: number,
 * }>} CoordinatorQuiescenceBarrierSnapshot
 */

/**
 * @typedef {'close' | 'adopt' | 'reopen'} CoordinatorQuiescenceBarrierActionValue
 */

/**
 * @typedef {Readonly<{
 *   schemaVersion: 1,
 *   appId: string,
 *   requestId: string,
 *   requestDigest: string,
 *   action: CoordinatorQuiescenceBarrierActionValue,
 *   predecessor: CoordinatorQuiescenceBarrierSnapshot | null,
 *   barrier: CoordinatorQuiescenceBarrierSnapshot,
 * }>} CoordinatorQuiescenceBarrierRequestReceipt
 */

/**
 * @typedef {Readonly<{
 *   applied: boolean,
 *   action: CoordinatorQuiescenceBarrierActionValue,
 *   barrier: CoordinatorQuiescenceBarrierSnapshot,
 *   receipt: CoordinatorQuiescenceBarrierRequestReceipt,
 * }>} CoordinatorQuiescenceBarrierTransitionResult
 */

export const CoordinatorQuiescenceBarrierState = Object.freeze({
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
});

export const CoordinatorQuiescenceBarrierAction = Object.freeze({
  CLOSE: 'close',
  ADOPT: 'adopt',
  REOPEN: 'reopen',
});

const BARRIER_STATES = new Set(
  Object.values(CoordinatorQuiescenceBarrierState),
);
const BARRIER_ACTIONS = new Set(
  Object.values(CoordinatorQuiescenceBarrierAction),
);
const SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'appId',
  'state',
  'version',
  'authority',
  'lastAction',
  'lastRequestId',
  'updatedAt',
]);
const BARRIER_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'state',
  'version',
  'authority_schema_version',
  'coordinator_id',
  'authority_id',
  'epoch',
  'last_action',
  'last_request_id',
  'updated_at',
  'record_digest',
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
  'predecessor',
  'barrier',
  'record_digest',
]);

/** Admission and schedule mutation are durably closed for this application. */
export class CoordinatorQuiescenceBarrierClosedError extends Error {
  /**
   * @param {CoordinatorQuiescenceBarrierSnapshot} barrier - Exact closed barrier.
   */
  constructor(barrier) {
    super(
      `Coordinator admission and schedule mutation are closed: ${barrier.appId}#${barrier.version}`,
    );
    this.name = 'CoordinatorQuiescenceBarrierClosedError';
    this.code = 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_CLOSED';
    this.appId = barrier.appId;
    this.version = barrier.version;
  }
}

/** A barrier transition lost its exact predecessor race. */
export class CoordinatorQuiescenceBarrierConflictError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} reason - Safe conflict reason.
   * @param {{cause?: unknown}} [options] - Optional underlying failure.
   */
  constructor(appId, reason, options = {}) {
    super(`Coordinator quiescence barrier changed: ${appId} (${reason})`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'CoordinatorQuiescenceBarrierConflictError';
    this.code = 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_CONFLICT';
    this.appId = appId;
    this.reason = reason;
  }
}

/** A stable request ID was reused for different barrier intent. */
export class CoordinatorQuiescenceBarrierRequestConflictError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} requestId - Conflicting request identity.
   */
  constructor(appId, requestId) {
    super(
      `Coordinator quiescence barrier request conflicts with retained intent: ${appId}#${requestId}`,
    );
    this.name = 'CoordinatorQuiescenceBarrierRequestConflictError';
    this.code = 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_REQUEST_CONFLICT';
    this.appId = appId;
    this.requestId = requestId;
  }
}

/** Retained barrier bytes fail their strict structural contract. */
export class CoordinatorQuiescenceBarrierRecordError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} reason - Safe integrity reason.
   * @param {{cause?: unknown}} [options] - Optional validation cause.
   */
  constructor(appId, reason, options = {}) {
    super(`Coordinator quiescence barrier is invalid: ${appId} (${reason})`, {
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = 'CoordinatorQuiescenceBarrierRecordError';
    this.code = 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_RECORD_INVALID';
    this.appId = appId;
    this.reason = reason;
  }
}

/** The monotonic barrier version cannot advance safely. */
export class CoordinatorQuiescenceBarrierVersionOverflowError extends Error {
  /** @param {string} appId - Application scope. */
  constructor(appId) {
    super(`Coordinator quiescence barrier cannot advance safely: ${appId}`);
    this.name = 'CoordinatorQuiescenceBarrierVersionOverflowError';
    this.code = 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_VERSION_OVERFLOW';
    this.appId = appId;
  }
}

/** A write and strong receipt readback could not prove one exact outcome. */
export class CoordinatorQuiescenceBarrierTransitionUnknownError extends Error {
  /**
   * @param {string} appId - Application scope.
   * @param {string} requestId - Exact retry identity.
   * @param {{cause?: unknown}} [options] - Write or readback failure.
   */
  constructor(appId, requestId, options = {}) {
    super(
      `Coordinator quiescence barrier outcome is unknown: ${appId}#${requestId}`,
      {
        ...(options.cause === undefined ? {} : { cause: options.cause }),
      },
    );
    this.name = 'CoordinatorQuiescenceBarrierTransitionUnknownError';
    this.code = 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_TRANSITION_UNKNOWN';
    this.appId = appId;
    this.requestId = requestId;
  }
}

/**
 * Recursively freeze one JSON value.
 * @template T
 * @param {T} value - JSON value.
 * @returns {T} - The same deeply frozen value.
 */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/**
 * Clone a bounded object and require exact keys.
 * @param {unknown} value - Candidate object.
 * @param {Set<string>} keys - Exact supported keys.
 * @param {string} label - Boundary label.
 * @returns {Record<string, any>} - Caller-independent object.
 */
function exactObject(value, keys, label) {
  const object = cloneBoundedJsonObject(
    value,
    COORDINATOR_QUIESCENCE_BARRIER_MAX_RECORD_BYTES,
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
 * @param {unknown} value - Candidate positive safe integer.
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
 * @param {unknown} value - Candidate nonnegative safe integer.
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
 * @param {unknown} value - Candidate request identity.
 * @param {string} label - Boundary label.
 * @returns {string} - Valid opaque identity.
 */
function requestId(value, label) {
  return assertLedgerOpaqueId(value, label);
}

/**
 * @param {unknown} value - Optional diagnostic time.
 * @param {() => number} now - Default clock.
 * @returns {number} - Nonnegative diagnostic timestamp.
 */
function observedAt(value, now) {
  return nonnegativeInteger(
    value === undefined ? now() : value,
    'coordinator quiescence barrier observedAt',
  );
}

/**
 * @param {unknown} left - JSON value.
 * @param {unknown} right - JSON value.
 * @returns {boolean} - Exact canonical equality for normalized values.
 */
function sameValue(left, right) {
  /**
   * @param {unknown} value - JSON value.
   * @returns {unknown} - Recursively key-sorted value.
   */
  const sortCanonical = (value) => {
    if (Array.isArray(value)) return value.map(sortCanonical);
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [
          key,
          sortCanonical(/** @type {Record<string, unknown>} */ (value)[key]),
        ]),
    );
  };
  return (
    JSON.stringify(sortCanonical(left)) === JSON.stringify(sortCanonical(right))
  );
}

/**
 * @param {import('./coordinator-authority.js').CoordinatorAuthorityToken} left - Authority token.
 * @param {import('./coordinator-authority.js').CoordinatorAuthorityToken} right - Authority token.
 * @returns {boolean} - Stable authority equality.
 */
function sameAuthority(left, right) {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.appId === right.appId &&
    left.coordinatorId === right.coordinatorId &&
    left.authorityId === right.authorityId &&
    left.epoch === right.epoch
  );
}

/**
 * @param {unknown} error - Candidate DB error.
 * @returns {boolean} - Whether a portable conditional check failed.
 */
function isConditionalFailure(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * @param {CoordinatorQuiescenceBarrierSnapshot | null} predecessor - Exact predecessor.
 * @param {import('./coordinator-authority.js').CoordinatorAuthorityToken} authority - Current authority.
 * @param {CoordinatorQuiescenceBarrierActionValue} action - Requested transition.
 * @returns {void} - Resolves for a valid state transition.
 */
function assertTransitionPredecessor(predecessor, authority, action) {
  if (!predecessor) {
    if (action !== CoordinatorQuiescenceBarrierAction.CLOSE) {
      throw new TypeError(
        `Coordinator quiescence barrier ${action} requires a CLOSED predecessor.`,
      );
    }
    return;
  }
  if (predecessor.appId !== authority.appId) {
    throw new TypeError(
      'Coordinator quiescence barrier authority must match its predecessor application.',
    );
  }
  if (action === CoordinatorQuiescenceBarrierAction.CLOSE) {
    if (predecessor.state !== CoordinatorQuiescenceBarrierState.OPEN) {
      throw new TypeError(
        'Coordinator quiescence barrier close requires an OPEN predecessor.',
      );
    }
    if (
      authority.epoch < predecessor.authority.epoch ||
      (authority.epoch === predecessor.authority.epoch &&
        !sameAuthority(authority, predecessor.authority))
    ) {
      throw new TypeError(
        'Coordinator quiescence barrier close cannot move to an older or divergent authority.',
      );
    }
    return;
  }
  if (predecessor.state !== CoordinatorQuiescenceBarrierState.CLOSED) {
    throw new TypeError(
      `Coordinator quiescence barrier ${action} requires a CLOSED predecessor.`,
    );
  }
  if (action === CoordinatorQuiescenceBarrierAction.ADOPT) {
    if (authority.epoch <= predecessor.authority.epoch) {
      throw new TypeError(
        'Coordinator quiescence barrier adoption requires a strictly newer authority epoch.',
      );
    }
    return;
  }
  if (!sameAuthority(authority, predecessor.authority)) {
    throw new TypeError(
      'Coordinator quiescence barrier reopen requires its exact adopted authority.',
    );
  }
}

/**
 * Normalize and freeze a public barrier snapshot.
 * @param {unknown} value - Candidate snapshot.
 * @param {string} [label='coordinator quiescence barrier'] - Boundary label.
 * @returns {CoordinatorQuiescenceBarrierSnapshot} - Canonical snapshot.
 */
export function assertCoordinatorQuiescenceBarrierSnapshot(
  value,
  label = 'coordinator quiescence barrier',
) {
  const snapshot = exactObject(value, SNAPSHOT_KEYS, label);
  if (
    snapshot.schemaVersion !== COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION
  ) {
    throw new TypeError(
      `${label}.schemaVersion must be ${COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION}.`,
    );
  }
  assertLogicalId(snapshot.appId, `${label}.appId`);
  if (!BARRIER_STATES.has(snapshot.state)) {
    throw new TypeError(`${label}.state is not supported.`);
  }
  const version = positiveInteger(snapshot.version, `${label}.version`);
  const authority = assertCoordinatorAuthorityToken(
    snapshot.authority,
    `${label}.authority`,
  );
  if (authority.appId !== snapshot.appId) {
    throw new TypeError(`${label}.authority must match appId.`);
  }
  if (!BARRIER_ACTIONS.has(snapshot.lastAction)) {
    throw new TypeError(`${label}.lastAction is not supported.`);
  }
  if (
    (snapshot.state === CoordinatorQuiescenceBarrierState.OPEN &&
      snapshot.lastAction !== CoordinatorQuiescenceBarrierAction.REOPEN) ||
    (snapshot.state === CoordinatorQuiescenceBarrierState.CLOSED &&
      snapshot.lastAction === CoordinatorQuiescenceBarrierAction.REOPEN)
  ) {
    throw new TypeError(`${label}.state and lastAction are inconsistent.`);
  }
  const lastRequestId = requestId(
    snapshot.lastRequestId,
    `${label}.lastRequestId`,
  );
  const updatedAt = nonnegativeInteger(
    snapshot.updatedAt,
    `${label}.updatedAt`,
  );
  return deepFreeze({
    schemaVersion: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
    appId: snapshot.appId,
    state: snapshot.state,
    version,
    authority,
    lastAction: snapshot.lastAction,
    lastRequestId,
    updatedAt,
  });
}

/**
 * @param {string} appId - Application scope.
 * @returns {string} - Reserved app-scoped partition.
 */
export function getCoordinatorQuiescenceBarrierPartitionKey(appId) {
  assertLogicalId(appId, 'appId');
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_QUIESCENCE_BARRIER_PARTITION_DOMAIN,
    prefix: COORDINATOR_QUIESCENCE_BARRIER_PARTITION_PREFIX,
    value: {
      schemaVersion: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
      appId,
    },
    valuePath: 'coordinator quiescence barrier partition',
  });
}

/**
 * @param {string} value - Stable request identity.
 * @returns {string} - Reserved receipt sort key.
 */
function getRequestSortKey(value) {
  return `${COORDINATOR_QUIESCENCE_BARRIER_REQUEST_SORT_KEY_PREFIX}${encodeLedgerKeySegment(
    value,
    'coordinator quiescence barrier requestId',
  )}`;
}

/**
 * @param {CoordinatorQuiescenceBarrierSnapshot} snapshot - Canonical snapshot.
 * @returns {Readonly<Record<string, any>>} - Physical barrier record.
 */
function createBarrierRecord(snapshot) {
  const fields = {
    [KEY_NAME]: getCoordinatorQuiescenceBarrierPartitionKey(snapshot.appId),
    [SORT_KEY_NAME]: COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
    schema_version: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
    record_kind: COORDINATOR_QUIESCENCE_BARRIER_RECORD_KIND,
    app_id: snapshot.appId,
    state: snapshot.state,
    version: snapshot.version,
    authority_schema_version: snapshot.authority.schemaVersion,
    coordinator_id: snapshot.authority.coordinatorId,
    authority_id: snapshot.authority.authorityId,
    epoch: snapshot.authority.epoch,
    last_action: snapshot.lastAction,
    last_request_id: snapshot.lastRequestId,
    updated_at: snapshot.updatedAt,
  };
  return Object.freeze({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: COORDINATOR_QUIESCENCE_BARRIER_RECORD_DOMAIN,
      prefix: COORDINATOR_QUIESCENCE_BARRIER_RECORD_PREFIX,
      value: fields,
      valuePath: 'coordinator quiescence barrier record',
    }),
  });
}

/**
 * @param {unknown} raw - Candidate physical barrier row.
 * @param {string} appId - Expected application scope.
 * @returns {CoordinatorQuiescenceBarrierSnapshot} - Verified snapshot.
 */
function normalizeBarrierRecord(raw, appId) {
  try {
    const record = exactObject(
      raw,
      BARRIER_RECORD_KEYS,
      'coordinator quiescence barrier record',
    );
    assertDomainSeparatedSha256Id(
      record.record_digest,
      COORDINATOR_QUIESCENCE_BARRIER_RECORD_PREFIX,
      'coordinator quiescence barrier record.record_digest',
    );
    const snapshot = assertCoordinatorQuiescenceBarrierSnapshot(
      {
        schemaVersion: record.schema_version,
        appId: record.app_id,
        state: record.state,
        version: record.version,
        authority: {
          schemaVersion: record.authority_schema_version,
          appId: record.app_id,
          coordinatorId: record.coordinator_id,
          authorityId: record.authority_id,
          epoch: record.epoch,
        },
        lastAction: record.last_action,
        lastRequestId: record.last_request_id,
        updatedAt: record.updated_at,
      },
      'coordinator quiescence barrier record',
    );
    const expected = createBarrierRecord(snapshot);
    if (
      snapshot.appId !== appId ||
      [...BARRIER_RECORD_KEYS].some((key) => record[key] !== expected[key])
    ) {
      throw new TypeError(
        'coordinator quiescence barrier record failed verification.',
      );
    }
    return snapshot;
  } catch (cause) {
    if (cause instanceof CoordinatorQuiescenceBarrierRecordError) throw cause;
    throw new CoordinatorQuiescenceBarrierRecordError(appId, 'record shape', {
      cause,
    });
  }
}

/**
 * @param {CoordinatorQuiescenceBarrierActionValue} action - Transition action.
 * @param {string} appId - Application scope.
 * @param {string} stableRequestId - Request identity.
 * @param {import('./coordinator-authority.js').CoordinatorAuthorityToken} authority - Current authority.
 * @param {CoordinatorQuiescenceBarrierSnapshot | null} predecessor - Exact predecessor.
 * @returns {string} - Domain-separated semantic request digest.
 */
function createRequestDigest(
  action,
  appId,
  stableRequestId,
  authority,
  predecessor,
) {
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_QUIESCENCE_BARRIER_REQUEST_DOMAIN,
    prefix: COORDINATOR_QUIESCENCE_BARRIER_REQUEST_PREFIX,
    value: {
      schemaVersion: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
      appId,
      requestId: stableRequestId,
      action,
      authority,
      predecessor,
    },
    valuePath: 'coordinator quiescence barrier request',
  });
}

/**
 * @param {CoordinatorQuiescenceBarrierRequestReceipt} receipt - Canonical receipt.
 * @returns {Readonly<Record<string, any>>} - Immutable physical receipt.
 */
function createRequestRecord(receipt) {
  const fields = {
    [KEY_NAME]: getCoordinatorQuiescenceBarrierPartitionKey(receipt.appId),
    [SORT_KEY_NAME]: getRequestSortKey(receipt.requestId),
    schema_version: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
    record_kind: COORDINATOR_QUIESCENCE_BARRIER_REQUEST_RECORD_KIND,
    app_id: receipt.appId,
    request_id: receipt.requestId,
    request_digest: receipt.requestDigest,
    action: receipt.action,
    predecessor: receipt.predecessor,
    barrier: receipt.barrier,
  };
  return deepFreeze({
    ...fields,
    record_digest: createCanonicalJsonSha256Id({
      domain: COORDINATOR_QUIESCENCE_BARRIER_RECEIPT_DOMAIN,
      prefix: COORDINATOR_QUIESCENCE_BARRIER_RECEIPT_PREFIX,
      value: fields,
      valuePath: 'coordinator quiescence barrier receipt',
    }),
  });
}

/**
 * @param {unknown} raw - Candidate physical receipt.
 * @param {string} appId - Expected application scope.
 * @param {string} stableRequestId - Expected request identity.
 * @returns {CoordinatorQuiescenceBarrierRequestReceipt} - Verified receipt.
 */
function normalizeRequestRecord(raw, appId, stableRequestId) {
  try {
    const record = exactObject(
      raw,
      REQUEST_RECORD_KEYS,
      'coordinator quiescence barrier request record',
    );
    if (
      record[KEY_NAME] !== getCoordinatorQuiescenceBarrierPartitionKey(appId) ||
      record[SORT_KEY_NAME] !== getRequestSortKey(stableRequestId) ||
      record.schema_version !== COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION ||
      record.record_kind !==
        COORDINATOR_QUIESCENCE_BARRIER_REQUEST_RECORD_KIND ||
      record.app_id !== appId ||
      record.request_id !== stableRequestId ||
      !BARRIER_ACTIONS.has(record.action)
    ) {
      throw new TypeError(
        'coordinator quiescence barrier request record is invalid.',
      );
    }
    assertDomainSeparatedSha256Id(
      record.request_digest,
      COORDINATOR_QUIESCENCE_BARRIER_REQUEST_PREFIX,
      'coordinator quiescence barrier request record.request_digest',
    );
    assertDomainSeparatedSha256Id(
      record.record_digest,
      COORDINATOR_QUIESCENCE_BARRIER_RECEIPT_PREFIX,
      'coordinator quiescence barrier request record.record_digest',
    );
    const predecessor =
      record.predecessor === null
        ? null
        : assertCoordinatorQuiescenceBarrierSnapshot(
            record.predecessor,
            'coordinator quiescence barrier request predecessor',
          );
    const barrier = assertCoordinatorQuiescenceBarrierSnapshot(
      record.barrier,
      'coordinator quiescence barrier request result',
    );
    const receipt = /** @type {CoordinatorQuiescenceBarrierRequestReceipt} */ (
      deepFreeze({
        schemaVersion: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
        appId,
        requestId: stableRequestId,
        requestDigest: record.request_digest,
        action: record.action,
        predecessor,
        barrier,
      })
    );
    const expectedDigest = createRequestDigest(
      receipt.action,
      appId,
      stableRequestId,
      barrier.authority,
      predecessor,
    );
    const expectedRecord = createRequestRecord(receipt);
    if (
      barrier.appId !== appId ||
      (predecessor !== null && predecessor.appId !== appId) ||
      receipt.requestDigest !== expectedDigest ||
      [...REQUEST_RECORD_KEYS].some(
        (key) => !sameValue(record[key], expectedRecord[key]),
      )
    ) {
      throw new TypeError(
        'coordinator quiescence barrier request record failed verification.',
      );
    }
    assertTransitionPredecessor(predecessor, barrier.authority, receipt.action);
    if (
      barrier.version !== (predecessor ? predecessor.version + 1 : 1) ||
      barrier.lastAction !== receipt.action ||
      barrier.lastRequestId !== stableRequestId ||
      barrier.updatedAt < (predecessor?.updatedAt ?? 0) ||
      (receipt.action === CoordinatorQuiescenceBarrierAction.REOPEN
        ? barrier.state !== CoordinatorQuiescenceBarrierState.OPEN
        : barrier.state !== CoordinatorQuiescenceBarrierState.CLOSED)
    ) {
      throw new TypeError(
        'coordinator quiescence barrier request result is not its exact successor.',
      );
    }
    return receipt;
  } catch (cause) {
    if (cause instanceof CoordinatorQuiescenceBarrierRecordError) throw cause;
    throw new CoordinatorQuiescenceBarrierRecordError(
      appId,
      'request receipt shape',
      { cause },
    );
  }
}

/**
 * @param {CoordinatorQuiescenceBarrierSnapshot} snapshot - Exact predecessor.
 * @returns {import('../base.js').KeyCondition[]} - Primitive exact CAS conditions.
 */
function exactBarrierConditions(snapshot) {
  return Object.entries(createBarrierRecord(snapshot)).map(
    ([propertyName, propertyValue]) =>
      Object.freeze({
        conditionType: CONDITION_TYPE.EQUALS,
        propertyName,
        propertyValue,
      }),
  );
}

/**
 * Build the same-table fence for one fresh admission or schedule mutation.
 * Missing is the compatibility OPEN state, but the returned NOT_EXISTS check
 * makes a concurrent first close win atomically. Exact committed replays must
 * be resolved before asking for this fresh-write fence; they remain read-only
 * and do not require the current barrier to be open.
 * @param {{appId: string, barrier: CoordinatorQuiescenceBarrierSnapshot | null}} input - Strongly observed barrier.
 * @returns {Readonly<import('../base.js').TransactionConditionCheck>} - Exact same-table fence.
 */
export function createCoordinatorQuiescenceAdmissionFence(input) {
  const value = exactObject(
    input,
    new Set(['appId', 'barrier']),
    'coordinator quiescence admission fence',
  );
  assertLogicalId(value.appId, 'coordinator quiescence admission fence.appId');
  if (value.barrier === null) {
    return deepFreeze({
      keyName: KEY_NAME,
      keyValue: getCoordinatorQuiescenceBarrierPartitionKey(value.appId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
      conditions: [
        {
          conditionType: CONDITION_TYPE.NOT_EXISTS,
          propertyName: SORT_KEY_NAME,
        },
      ],
    });
  }
  const barrier = assertCoordinatorQuiescenceBarrierSnapshot(
    value.barrier,
    'coordinator quiescence admission fence.barrier',
  );
  if (barrier.appId !== value.appId) {
    throw new TypeError(
      'Coordinator quiescence admission fence barrier must match appId.',
    );
  }
  if (barrier.state !== CoordinatorQuiescenceBarrierState.OPEN) {
    throw new CoordinatorQuiescenceBarrierClosedError(barrier);
  }
  return deepFreeze({
    keyName: KEY_NAME,
    keyValue: getCoordinatorQuiescenceBarrierPartitionKey(value.appId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
    conditions: exactBarrierConditions(barrier),
  });
}

/**
 * @param {CoordinatorQuiescenceBarrierSnapshot | null} predecessor - Exact predecessor.
 * @param {import('./coordinator-authority.js').CoordinatorAuthorityToken} authority - New owner.
 * @param {CoordinatorQuiescenceBarrierActionValue} action - Transition action.
 * @param {string} stableRequestId - Stable request identity.
 * @param {number} timestamp - Diagnostic timestamp.
 * @returns {CoordinatorQuiescenceBarrierSnapshot} - Exact monotonic successor.
 */
function createSuccessor(
  predecessor,
  authority,
  action,
  stableRequestId,
  timestamp,
) {
  assertTransitionPredecessor(predecessor, authority, action);
  if (predecessor?.version === Number.MAX_SAFE_INTEGER) {
    throw new CoordinatorQuiescenceBarrierVersionOverflowError(authority.appId);
  }
  return assertCoordinatorQuiescenceBarrierSnapshot(
    {
      schemaVersion: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
      appId: authority.appId,
      state:
        action === CoordinatorQuiescenceBarrierAction.REOPEN
          ? CoordinatorQuiescenceBarrierState.OPEN
          : CoordinatorQuiescenceBarrierState.CLOSED,
      version: predecessor ? predecessor.version + 1 : 1,
      authority,
      lastAction: action,
      lastRequestId: stableRequestId,
      updatedAt: Math.max(predecessor?.updatedAt ?? 0, timestamp),
    },
    'coordinator quiescence barrier successor',
  );
}

/**
 * Create the durable app-scoped admission and schedule-mutation barrier. The
 * barrier and coordinator authority must live in the same execution-ledger
 * table as every protected mutation. This store never deletes or resets a
 * barrier row; OPEN/CLOSED changes and CLOSED adoption always advance version.
 * @param {{db: import('../base.js').DBClient, tableName: string, now?: () => number}} options - Exact table dependencies.
 * @returns {Readonly<{
 *   get: (input: {appId: string}) => Promise<CoordinatorQuiescenceBarrierSnapshot | null>,
 *   prepareFreshAdmission: (input: {appId: string}) => Promise<Readonly<{barrier: CoordinatorQuiescenceBarrierSnapshot | null, conditionCheck: import('../base.js').TransactionConditionCheck}>>,
 *   close: (input: {authority: unknown, requestId: string, predecessor: CoordinatorQuiescenceBarrierSnapshot | null, observedAt?: number}) => Promise<CoordinatorQuiescenceBarrierTransitionResult>,
 *   adopt: (input: {authority: unknown, requestId: string, predecessor: CoordinatorQuiescenceBarrierSnapshot, observedAt?: number}) => Promise<CoordinatorQuiescenceBarrierTransitionResult>,
 *   reopen: (input: {authority: unknown, requestId: string, predecessor: CoordinatorQuiescenceBarrierSnapshot, observedAt?: number}) => Promise<CoordinatorQuiescenceBarrierTransitionResult>,
 * }>} - Closed barrier state-machine operations.
 */
export function createCoordinatorQuiescenceBarrier(options) {
  if (
    !options?.db ||
    typeof options.db.get !== 'function' ||
    typeof options.db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createCoordinatorQuiescenceBarrier requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof options.tableName !== 'string' || !options.tableName.trim()) {
    throw new TypeError(
      'createCoordinatorQuiescenceBarrier requires a tableName.',
    );
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError(
      'createCoordinatorQuiescenceBarrier now must be a function.',
    );
  }
  const db = options.db;
  const tableName = options.tableName.trim();
  const now = options.now ?? (() => Date.now());

  /**
   * @param {string} appId - Application scope.
   * @returns {Promise<CoordinatorQuiescenceBarrierSnapshot | null>} - Strongly read barrier.
   */
  async function readBarrier(appId) {
    assertLogicalId(appId, 'appId');
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getCoordinatorQuiescenceBarrierPartitionKey(appId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
      consistentRead: true,
    });
    return raw ? normalizeBarrierRecord(raw, appId) : null;
  }

  /**
   * @param {string} appId - Application scope.
   * @param {string} stableRequestId - Request identity.
   * @returns {Promise<CoordinatorQuiescenceBarrierRequestReceipt | null>} - Strongly read receipt.
   */
  async function readRequest(appId, stableRequestId) {
    const raw = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: getCoordinatorQuiescenceBarrierPartitionKey(appId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: getRequestSortKey(stableRequestId),
      consistentRead: true,
    });
    return raw ? normalizeRequestRecord(raw, appId, stableRequestId) : null;
  }

  /**
   * @param {CoordinatorQuiescenceBarrierRequestReceipt | null} receipt - Retained receipt.
   * @param {string} digest - Expected request digest.
   * @param {CoordinatorQuiescenceBarrierActionValue} action - Expected action.
   * @param {string} appId - Application scope.
   * @param {string} stableRequestId - Request identity.
   * @returns {CoordinatorQuiescenceBarrierRequestReceipt | null} - Exact receipt or null.
   */
  function assertExactReceipt(receipt, digest, action, appId, stableRequestId) {
    if (!receipt) return null;
    if (receipt.requestDigest !== digest || receipt.action !== action) {
      throw new CoordinatorQuiescenceBarrierRequestConflictError(
        appId,
        stableRequestId,
      );
    }
    return receipt;
  }

  /**
   * @param {CoordinatorQuiescenceBarrierRequestReceipt} receipt - Exact receipt.
   * @param {boolean} applied - Whether this call proved a fresh application.
   * @returns {CoordinatorQuiescenceBarrierTransitionResult} - Deeply frozen result.
   */
  function transitionResult(receipt, applied) {
    return deepFreeze({
      applied,
      action: receipt.action,
      barrier: receipt.barrier,
      receipt,
    });
  }

  /**
   * @param {CoordinatorQuiescenceBarrierActionValue} action - Transition action.
   * @param {unknown} input - Exact transition input.
   * @returns {Promise<CoordinatorQuiescenceBarrierTransitionResult>} - Accepted transition or exact replay.
   */
  async function transition(action, input) {
    const value = cloneBoundedJsonObject(
      input,
      COORDINATOR_QUIESCENCE_BARRIER_MAX_RECORD_BYTES,
      `coordinatorQuiescenceBarrier.${action}`,
    );
    const allowed = new Set([
      'authority',
      'requestId',
      'predecessor',
      'observedAt',
    ]);
    const required = new Set(['authority', 'requestId', 'predecessor']);
    if (
      Object.keys(value).some((key) => !allowed.has(key)) ||
      [...required].some(
        (key) => !Object.prototype.hasOwnProperty.call(value, key),
      )
    ) {
      throw new TypeError(
        `coordinatorQuiescenceBarrier.${action} has unsupported or missing fields.`,
      );
    }
    const authority = assertCoordinatorAuthorityToken(
      value.authority,
      `coordinatorQuiescenceBarrier.${action}.authority`,
    );
    const stableRequestId = requestId(
      value.requestId,
      `coordinatorQuiescenceBarrier.${action}.requestId`,
    );
    const predecessor =
      value.predecessor === null
        ? null
        : assertCoordinatorQuiescenceBarrierSnapshot(
            value.predecessor,
            `coordinatorQuiescenceBarrier.${action}.predecessor`,
          );
    assertTransitionPredecessor(predecessor, authority, action);
    const timestamp = observedAt(value.observedAt, now);
    const digest = createRequestDigest(
      action,
      authority.appId,
      stableRequestId,
      authority,
      predecessor,
    );
    const existing = assertExactReceipt(
      await readRequest(authority.appId, stableRequestId),
      digest,
      action,
      authority.appId,
      stableRequestId,
    );
    if (existing) return transitionResult(existing, false);

    const current = await readBarrier(authority.appId);
    if (!sameValue(current, predecessor)) {
      const raced = assertExactReceipt(
        await readRequest(authority.appId, stableRequestId),
        digest,
        action,
        authority.appId,
        stableRequestId,
      );
      if (raced) return transitionResult(raced, false);
      await assertCoordinatorAuthorityCurrent({
        db,
        tableName,
        authority,
      });
      throw new CoordinatorQuiescenceBarrierConflictError(
        authority.appId,
        'the strongly observed predecessor is no longer current',
      );
    }

    const successor = createSuccessor(
      predecessor,
      authority,
      action,
      stableRequestId,
      timestamp,
    );
    const receipt = /** @type {CoordinatorQuiescenceBarrierRequestReceipt} */ (
      deepFreeze({
        schemaVersion: COORDINATOR_QUIESCENCE_BARRIER_SCHEMA_VERSION,
        appId: authority.appId,
        requestId: stableRequestId,
        requestDigest: digest,
        action,
        predecessor,
        barrier: successor,
      })
    );
    /** @type {unknown} */
    let writeError;
    try {
      await db.transactionWrite({
        tableName,
        conditionChecks: [createCoordinatorAuthorityFence(authority)],
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record: createBarrierRecord(successor),
            conditions: predecessor
              ? exactBarrierConditions(predecessor)
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
            record: createRequestRecord(receipt),
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
    if (writeError === undefined) return transitionResult(receipt, true);

    /** @type {CoordinatorQuiescenceBarrierRequestReceipt | null} */
    let retained;
    try {
      retained = assertExactReceipt(
        await readRequest(authority.appId, stableRequestId),
        digest,
        action,
        authority.appId,
        stableRequestId,
      );
    } catch (readError) {
      if (
        readError instanceof CoordinatorQuiescenceBarrierRequestConflictError ||
        readError instanceof CoordinatorQuiescenceBarrierRecordError
      ) {
        throw readError;
      }
      try {
        await assertCoordinatorAuthorityCurrent({
          db,
          tableName,
          authority,
        });
      } catch (authorityError) {
        if (
          authorityError instanceof CoordinatorAuthorityStaleError ||
          authorityError instanceof CoordinatorAuthorityRecordError
        ) {
          throw authorityError;
        }
        throw new CoordinatorQuiescenceBarrierTransitionUnknownError(
          authority.appId,
          stableRequestId,
          {
            cause: new AggregateError([writeError, readError, authorityError]),
          },
        );
      }
      throw new CoordinatorQuiescenceBarrierTransitionUnknownError(
        authority.appId,
        stableRequestId,
        { cause: new AggregateError([writeError, readError]) },
      );
    }
    if (retained) {
      return transitionResult(retained, !isConditionalFailure(writeError));
    }
    if (!isConditionalFailure(writeError)) {
      // Exact retained success and retained-record integrity take precedence.
      // Once neither applies, diagnose takeover before classifying an unknown
      // transport outcome, without losing either causal failure when the
      // diagnostic read is itself unavailable.
      try {
        await assertCoordinatorAuthorityCurrent({
          db,
          tableName,
          authority,
        });
      } catch (authorityError) {
        if (
          authorityError instanceof CoordinatorAuthorityStaleError ||
          authorityError instanceof CoordinatorAuthorityRecordError
        ) {
          throw authorityError;
        }
        throw new CoordinatorQuiescenceBarrierTransitionUnknownError(
          authority.appId,
          stableRequestId,
          {
            cause: new AggregateError([writeError, authorityError]),
          },
        );
      }
      throw new CoordinatorQuiescenceBarrierTransitionUnknownError(
        authority.appId,
        stableRequestId,
        { cause: writeError },
      );
    }

    await assertCoordinatorAuthorityCurrent({
      db,
      tableName,
      authority,
    });
    throw new CoordinatorQuiescenceBarrierConflictError(
      authority.appId,
      'another barrier transition won the exact predecessor race',
      { cause: writeError },
    );
  }

  /**
   * @param {{appId: string}} input - Application scope.
   * @returns {Promise<CoordinatorQuiescenceBarrierSnapshot | null>} - Strong snapshot.
   */
  async function get(input) {
    const value = exactObject(
      input,
      new Set(['appId']),
      'coordinatorQuiescenceBarrier.get',
    );
    return await readBarrier(value.appId);
  }

  /**
   * Prepare the exact condition check for a fresh admission or schedule
   * mutation. Callers must resolve an exact committed replay first; a replay
   * is read-only and intentionally bypasses the current barrier.
   * @param {{appId: string}} input - Application scope.
   * @returns {Promise<Readonly<{barrier: CoordinatorQuiescenceBarrierSnapshot | null, conditionCheck: import('../base.js').TransactionConditionCheck}>>} - Strong observation and exact fence.
   */
  async function prepareFreshAdmission(input) {
    const value = exactObject(
      input,
      new Set(['appId']),
      'coordinatorQuiescenceBarrier.prepareFreshAdmission',
    );
    const barrier = await readBarrier(value.appId);
    return deepFreeze({
      barrier,
      conditionCheck: createCoordinatorQuiescenceAdmissionFence({
        appId: value.appId,
        barrier,
      }),
    });
  }

  return Object.freeze({
    get,
    prepareFreshAdmission,
    close: async (input) =>
      await transition(CoordinatorQuiescenceBarrierAction.CLOSE, input),
    adopt: async (input) =>
      await transition(CoordinatorQuiescenceBarrierAction.ADOPT, input),
    reopen: async (input) =>
      await transition(CoordinatorQuiescenceBarrierAction.REOPEN, input),
  });
}
