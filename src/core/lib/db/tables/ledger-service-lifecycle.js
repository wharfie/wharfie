/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { randomBytes } from 'node:crypto';

import { assertApplicationRevisionId } from '../../../runtime/application-revision.js';
import { assertArtifactId } from '../../../runtime/artifact-record.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import { CONDITION_TYPE } from '../base.js';
import { getLocalApplicationServiceStartFence } from './local-application-activation.js';

/**
 * One lifecycle record is intentionally colocated with execution-ledger data,
 * but never shares its record namespace. The `run_id` physical key name is
 * retained because the shared table has that established composite schema.
 */
const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';

export const LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION = 2;
export const LEDGER_SERVICE_LIFECYCLE_RECORD_KIND = 'ledger-service-lifecycle';
export const LEDGER_SERVICE_LIFECYCLE_SORT_KEY = 'ledger-service/v2/lifecycle';
export const LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION = 1;
export const LEDGER_SERVICE_OWNERSHIP_RECORD_KIND = 'ledger-service-ownership';
export const LEDGER_SERVICE_OWNERSHIP_SORT_KEY = 'ledger-service/v1/ownership';
export const LEDGER_SERVICE_ID_SCHEMA_VERSION = 1;
export const LEDGER_SERVICE_ID_DOMAIN = 'wharfie:ledger-service:v1';
export const LEDGER_SERVICE_ID_PREFIX = 'wls';
export const LEDGER_SERVICE_SESSION_ID_PREFIX = 'wss';
export const LEDGER_SERVICE_PARTITION_SCHEMA_VERSION = 1;
export const LEDGER_SERVICE_LIFECYCLE_PARTITION_DOMAIN =
  'wharfie:ledger-service-lifecycle-partition:v1';
export const LEDGER_SERVICE_LIFECYCLE_PARTITION_PREFIX = 'wlsp';
export const LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES = 16 * 1024;

export const LedgerServiceLifecycleStatus = Object.freeze({
  STARTING: 'STARTING',
  READY: 'READY',
  STOPPING: 'STOPPING',
  STOPPED: 'STOPPED',
});

export const LedgerServiceOwnerKind = Object.freeze({
  RESIDENT: 'resident',
  MANUAL: 'manual',
});

const LIFECYCLE_STATUSES = new Set(Object.values(LedgerServiceLifecycleStatus));
const STORAGE_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'service_id',
  'app_id',
  'revision_id',
  'artifact_id',
  'session_id',
  'generation',
  'status',
  'started_at',
  'updated_at',
]);
const OWNERSHIP_STORAGE_RECORD_KEYS = new Set([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'service_id',
  'app_id',
  'scope_id',
  'principal_id',
  'session_id',
  'owner_kind',
  'generation',
  'claimed_at',
  'updated_at',
]);
const OWNERSHIP_SNAPSHOT_KEYS = new Set([
  'schemaVersion',
  'serviceId',
  'appId',
  'scopeId',
  'principalId',
  'sessionId',
  'ownerKind',
  'generation',
  'claimedAt',
  'updatedAt',
]);

/**
 * Raised when a service lifecycle call races another lifecycle writer or uses
 * a stale session/generation fence.
 */
export class LedgerServiceLifecycleConflictError extends Error {
  /**
   * @param {string} serviceId - Durable service identity.
   * @param {string} [reason] - Safe conflict reason.
   */
  constructor(serviceId, reason) {
    super(
      `Ledger service lifecycle changed concurrently: ${serviceId}${
        reason ? ` (${reason})` : ''
      }`,
    );
    this.name = 'LedgerServiceLifecycleConflictError';
    this.serviceId = serviceId;
    this.reason = reason;
  }
}

/** Raised when a lifecycle transition is requested before service start. */
export class LedgerServiceLifecycleNotFoundError extends Error {
  /** @param {string} serviceId - Durable service identity. */
  constructor(serviceId) {
    super(`Ledger service lifecycle was not found: ${serviceId}`);
    this.name = 'LedgerServiceLifecycleNotFoundError';
    this.serviceId = serviceId;
  }
}

/** Raised when a durable lifecycle record is malformed or belongs elsewhere. */
export class LedgerServiceLifecycleRecordError extends Error {
  /**
   * @param {string} serviceId - Durable service identity.
   * @param {string} reason - Safe structural failure reason.
   */
  constructor(serviceId, reason) {
    super(
      `Ledger service lifecycle record is invalid: ${serviceId} (${reason})`,
    );
    this.name = 'LedgerServiceLifecycleRecordError';
    this.serviceId = serviceId;
    this.reason = reason;
  }
}

/**
 * Raised when a durable ownership claim/release loses its fence or races a
 * concurrent ownership writer. This is intentionally distinct from lifecycle
 * conflicts because local process ownership is a separate durable contract.
 */
export class LedgerServiceOwnershipConflictError extends Error {
  /**
   * @param {string} serviceId - Durable service identity.
   * @param {string} [reason] - Safe conflict reason.
   */
  constructor(serviceId, reason) {
    super(
      `Ledger service ownership changed concurrently: ${serviceId}${
        reason ? ` (${reason})` : ''
      }`,
    );
    this.name = 'LedgerServiceOwnershipConflictError';
    this.serviceId = serviceId;
    this.reason = reason;
  }
}

/** Raised when a durable ownership record is malformed or belongs elsewhere. */
export class LedgerServiceOwnershipRecordError extends Error {
  /**
   * @param {string} serviceId - Durable service identity.
   * @param {string} reason - Safe structural failure reason.
   */
  constructor(serviceId, reason) {
    super(
      `Ledger service ownership record is invalid: ${serviceId} (${reason})`,
    );
    this.name = 'LedgerServiceOwnershipRecordError';
    this.serviceId = serviceId;
    this.reason = reason;
  }
}

/**
 * @param {string} propertyName - Record field to compare.
 * @param {string | number} propertyValue - Exact expected value.
 * @returns {import('../base.js').KeyCondition} - Equality condition.
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Record field that must not exist.
 * @returns {import('../base.js').KeyCondition} - Nonexistence condition.
 */
function notExists(propertyName) {
  return {
    conditionType: CONDITION_TYPE.NOT_EXISTS,
    propertyName,
  };
}

/**
 * @param {unknown} error - Candidate conditional failure.
 * @returns {boolean} - Whether a transaction lost its conditional race.
 */
function isConditionalCheckFailed(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * @param {unknown} value - Candidate nonnegative durable timestamp.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated timestamp.
 */
function assertNonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate positive generation.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated generation.
 */
function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {Record<string, any>} value - Input object.
 * @param {Set<string>} allowedKeys - Exact supported keys.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertExactKeys(value, allowedKeys, label) {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate service identity.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertLedgerServiceId(value, valuePath = 'serviceId') {
  assertDomainSeparatedSha256Id(value, LEDGER_SERVICE_ID_PREFIX, valuePath);
}

/**
 * @param {unknown} value - Candidate service-session fence.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertLedgerServiceSessionId(value, valuePath = 'sessionId') {
  assertDomainSeparatedSha256Id(
    value,
    LEDGER_SERVICE_SESSION_ID_PREFIX,
    valuePath,
  );
}

/**
 * @param {unknown} value - Candidate local ownership mode.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is 'resident' | 'manual'}
 */
export function assertLedgerServiceOwnerKind(value, valuePath = 'ownerKind') {
  if (
    value !== LedgerServiceOwnerKind.RESIDENT &&
    value !== LedgerServiceOwnerKind.MANUAL
  ) {
    throw new TypeError(`${valuePath} must be 'resident' or 'manual'.`);
  }
}

/**
 * Create the immutable resident ledger-service identity for one application. The
 * identity intentionally excludes its revision: a new revision must contend
 * for the same process/session partition, while each lifecycle record keeps
 * its own immutable revision binding.
 * @param {{appId: string}} input - Stable application binding.
 * @returns {string} - Deterministic typed service identity.
 */
export function createLedgerServiceId({ appId }) {
  assertLogicalId(appId, 'appId');
  return createCanonicalJsonSha256Id({
    domain: LEDGER_SERVICE_ID_DOMAIN,
    prefix: LEDGER_SERVICE_ID_PREFIX,
    value: {
      schemaVersion: LEDGER_SERVICE_ID_SCHEMA_VERSION,
      appId,
    },
    valuePath: 'ledger service identity',
  });
}

/**
 * Create a new cryptographically random session fence. Randomness cannot be
 * inferred from a caller-supplied string, so lifecycle writes only accept this
 * fixed 256-bit token shape and callers should use this factory.
 * @returns {string} - Fresh typed session identity.
 */
export function createLedgerServiceSessionId() {
  return `${LEDGER_SERVICE_SESSION_ID_PREFIX}_${randomBytes(32).toString(
    'base64url',
  )}`;
}

/**
 * @param {string} serviceId - Valid typed service identity.
 * @returns {string} - Domain-separated durable table partition key.
 */
export function getLedgerServiceLifecyclePartitionKey(serviceId) {
  assertLedgerServiceId(serviceId, 'serviceId');
  return createCanonicalJsonSha256Id({
    domain: LEDGER_SERVICE_LIFECYCLE_PARTITION_DOMAIN,
    prefix: LEDGER_SERVICE_LIFECYCLE_PARTITION_PREFIX,
    value: {
      schemaVersion: LEDGER_SERVICE_PARTITION_SCHEMA_VERSION,
      serviceId,
    },
    valuePath: 'ledger service lifecycle partition',
  });
}

/** @returns {string} - Reserved lifecycle sort key. */
export function getLedgerServiceLifecycleSortKey() {
  return LEDGER_SERVICE_LIFECYCLE_SORT_KEY;
}

/**
 * @param {Record<string, any>} record - Storage record.
 * @returns {import('../base.js').KeyCondition[]} - Conditions for exact replacement.
 */
function replacementConditions(record) {
  return [
    eq('schema_version', record.schema_version),
    eq('record_kind', record.record_kind),
    eq('service_id', record.service_id),
    eq('app_id', record.app_id),
    eq('revision_id', record.revision_id),
    eq('artifact_id', record.artifact_id),
    eq('session_id', record.session_id),
    eq('generation', record.generation),
    eq('status', record.status),
    eq('started_at', record.started_at),
    eq('updated_at', record.updated_at),
  ];
}

/**
 * @param {Record<string, any>} record - Validated storage record.
 * @returns {Readonly<Record<string, any>>} - Safe public lifecycle snapshot.
 */
function toLifecycleSnapshot(record) {
  return Object.freeze({
    schemaVersion: record.schema_version,
    serviceId: record.service_id,
    appId: record.app_id,
    revisionId: record.revision_id,
    artifactId: record.artifact_id,
    sessionId: record.session_id,
    generation: record.generation,
    status: record.status,
    startedAt: record.started_at,
    updatedAt: record.updated_at,
  });
}

/**
 * @param {unknown} raw - Durable record returned by the backing DB.
 * @param {string} serviceId - Expected service identity.
 * @returns {Record<string, any>} - Validated storage record.
 */
function normalizeStorageRecord(raw, serviceId) {
  let record;
  try {
    record = cloneBoundedJsonObject(
      raw,
      LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
      'ledger service lifecycle record',
    );
    assertExactKeys(
      record,
      STORAGE_RECORD_KEYS,
      'ledger service lifecycle record',
    );
    if (record[KEY_NAME] !== getLedgerServiceLifecyclePartitionKey(serviceId)) {
      throw new TypeError('partition');
    }
    if (record[SORT_KEY_NAME] !== LEDGER_SERVICE_LIFECYCLE_SORT_KEY) {
      throw new TypeError('sort key');
    }
    if (record.schema_version !== LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION) {
      throw new TypeError('schema version');
    }
    if (record.record_kind !== LEDGER_SERVICE_LIFECYCLE_RECORD_KIND) {
      throw new TypeError('record kind');
    }
    if (record.service_id !== serviceId) {
      throw new TypeError('service identity');
    }
    assertLogicalId(record.app_id, 'ledger service lifecycle record.app_id');
    assertApplicationRevisionId(
      record.revision_id,
      'ledger service lifecycle record.revision_id',
    );
    if (record.artifact_id !== null) {
      assertArtifactId(
        record.artifact_id,
        'ledger service lifecycle record.artifact_id',
      );
    }
    if (createLedgerServiceId({ appId: record.app_id }) !== serviceId) {
      throw new TypeError('service application binding');
    }
    assertLedgerServiceSessionId(
      record.session_id,
      'ledger service lifecycle record.session_id',
    );
    assertPositiveSafeInteger(
      record.generation,
      'ledger service lifecycle record.generation',
    );
    if (!LIFECYCLE_STATUSES.has(record.status)) {
      throw new TypeError('status');
    }
    const startedAt = assertNonnegativeSafeInteger(
      record.started_at,
      'ledger service lifecycle record.started_at',
    );
    const updatedAt = assertNonnegativeSafeInteger(
      record.updated_at,
      'ledger service lifecycle record.updated_at',
    );
    if (updatedAt < startedAt) throw new TypeError('timestamps');
  } catch (error) {
    if (error instanceof LedgerServiceLifecycleRecordError) throw error;
    throw new LedgerServiceLifecycleRecordError(serviceId, 'record shape');
  }
  return record;
}

/**
 * @param {{serviceId: string, appId: string, revisionId: string, artifactId?: string, sessionId: string, generation: number, status: string, startedAt: number, updatedAt: number}} input - Validated lifecycle fields.
 * @returns {Record<string, any>} - Canonical storage record.
 */
function createStorageRecord(input) {
  return {
    [KEY_NAME]: getLedgerServiceLifecyclePartitionKey(input.serviceId),
    [SORT_KEY_NAME]: LEDGER_SERVICE_LIFECYCLE_SORT_KEY,
    schema_version: LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION,
    record_kind: LEDGER_SERVICE_LIFECYCLE_RECORD_KIND,
    service_id: input.serviceId,
    app_id: input.appId,
    revision_id: input.revisionId,
    artifact_id: input.artifactId ?? null,
    session_id: input.sessionId,
    generation: input.generation,
    status: input.status,
    started_at: input.startedAt,
    updated_at: input.updatedAt,
  };
}

/**
 * @param {unknown} value - Candidate start options.
 * @param {() => number} now - Durable observation clock.
 * @returns {{serviceId: string, appId: string, revisionId: string, artifactId?: string, sessionId: string, observedAt: number}} - Validated start options.
 */
function normalizeStartOptions(value, now) {
  const input = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    'ledger service lifecycle start',
  );
  assertExactKeys(
    input,
    new Set([
      'serviceId',
      'appId',
      'revisionId',
      'artifactId',
      'sessionId',
      'observedAt',
    ]),
    'ledger service lifecycle start',
  );
  assertLedgerServiceId(input.serviceId, 'start.serviceId');
  assertLogicalId(input.appId, 'start.appId');
  assertApplicationRevisionId(input.revisionId, 'start.revisionId');
  if (input.artifactId !== undefined) {
    assertArtifactId(input.artifactId, 'start.artifactId');
  }
  if (createLedgerServiceId({ appId: input.appId }) !== input.serviceId) {
    throw new TypeError('start.serviceId must bind start.appId.');
  }
  assertLedgerServiceSessionId(input.sessionId, 'start.sessionId');
  return {
    serviceId: input.serviceId,
    appId: input.appId,
    revisionId: input.revisionId,
    ...(input.artifactId !== undefined ? { artifactId: input.artifactId } : {}),
    sessionId: input.sessionId,
    observedAt: assertNonnegativeSafeInteger(
      Object.prototype.hasOwnProperty.call(input, 'observedAt')
        ? input.observedAt
        : now(),
      'start.observedAt',
    ),
  };
}

/**
 * @param {unknown} value - Candidate transition options.
 * @param {string} label - Human-readable operation name.
 * @param {() => number} now - Durable observation clock.
 * @returns {{serviceId: string, sessionId: string, generation: number, observedAt: number}} - Validated transition options.
 */
function normalizeTransitionOptions(value, label, now) {
  const input = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    `ledger service lifecycle ${label}`,
  );
  assertExactKeys(
    input,
    new Set(['serviceId', 'sessionId', 'generation', 'observedAt']),
    `ledger service lifecycle ${label}`,
  );
  assertLedgerServiceId(input.serviceId, `${label}.serviceId`);
  assertLedgerServiceSessionId(input.sessionId, `${label}.sessionId`);
  return {
    serviceId: input.serviceId,
    sessionId: input.sessionId,
    generation: assertPositiveSafeInteger(
      input.generation,
      `${label}.generation`,
    ),
    observedAt: assertNonnegativeSafeInteger(
      Object.prototype.hasOwnProperty.call(input, 'observedAt')
        ? input.observedAt
        : now(),
      `${label}.observedAt`,
    ),
  };
}

/**
 * @param {unknown} value - Candidate get options.
 * @returns {{serviceId: string}} - Validated get options.
 */
function normalizeGetOptions(value) {
  const input = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    'ledger service lifecycle get',
  );
  assertExactKeys(
    input,
    new Set(['serviceId']),
    'ledger service lifecycle get',
  );
  assertLedgerServiceId(input.serviceId, 'get.serviceId');
  return { serviceId: input.serviceId };
}

/**
 * Create the isolated durable lifecycle store for the hidden resident ledger
 * service. It deliberately owns only state observation and session fencing;
 * acquiring the actual process/machine ownership is a separate runtime duty.
 *
 * A new session may write STARTING after any preceding state. The caller must
 * acquire that ownership before calling `start`; the conditional generation
 * write prevents two would-be successors from both becoming current.
 * @param {{db: import('../base.js').DBClient, tableName: string, now?: () => number}} options - Store dependencies.
 * @returns {{get: (input: {serviceId: string}) => Promise<Readonly<Record<string, any>> | null>, start: (input: {serviceId: string, appId: string, revisionId: string, artifactId?: string, sessionId: string, observedAt?: number}) => Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>, markReady: (input: {serviceId: string, sessionId: string, generation: number, observedAt?: number}) => Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>, markStopping: (input: {serviceId: string, sessionId: string, generation: number, observedAt?: number}) => Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>, markStopped: (input: {serviceId: string, sessionId: string, generation: number, observedAt?: number}) => Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>}} - Durable lifecycle API.
 */
export function createLedgerServiceLifecycle({
  db,
  tableName,
  now = () => Date.now(),
}) {
  if (
    !db ||
    typeof db.get !== 'function' ||
    typeof db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createLedgerServiceLifecycle requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new TypeError('createLedgerServiceLifecycle requires a tableName.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('createLedgerServiceLifecycle now must be a function.');
  }
  const resolvedTableName = tableName.trim();

  /**
   * @param {string} serviceId - Valid typed service identity.
   * @returns {Promise<Record<string, any> | null>} - Validated raw storage record.
   */
  async function readStored(serviceId) {
    const record = await db.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: getLedgerServiceLifecyclePartitionKey(serviceId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: LEDGER_SERVICE_LIFECYCLE_SORT_KEY,
      consistentRead: true,
    });
    return record ? normalizeStorageRecord(record, serviceId) : null;
  }

  /**
   * Read one lifecycle snapshot.
   * @param {{serviceId: string}} input - Service identity.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Current snapshot, if present.
   */
  async function get(input) {
    const { serviceId } = normalizeGetOptions(input);
    const record = await readStored(serviceId);
    return record ? toLifecycleSnapshot(record) : null;
  }

  /**
   * Persist a new STARTING generation after independently obtaining ownership.
   * Repeating the exact initial STARTING write is idempotent; reusing that
   * session after it advances is rejected so an old process cannot regain it.
   * @param {{serviceId: string, appId: string, revisionId: string, artifactId?: string, sessionId: string, observedAt?: number}} input - Fresh owner identity.
   * @returns {Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>} - Current durable lifecycle.
   */
  async function start(input) {
    const options = normalizeStartOptions(input, now);
    const current = await readStored(options.serviceId);
    if (current && current.session_id === options.sessionId) {
      if (
        current.app_id === options.appId &&
        current.revision_id === options.revisionId &&
        current.artifact_id === (options.artifactId ?? null) &&
        current.status === LedgerServiceLifecycleStatus.STARTING
      ) {
        return { applied: false, lifecycle: toLifecycleSnapshot(current) };
      }
      throw new LedgerServiceLifecycleConflictError(
        options.serviceId,
        'session already advanced',
      );
    }

    const admissionFence = await getLocalApplicationServiceStartFence({
      db,
      tableName: resolvedTableName,
      appId: options.appId,
      revisionId: options.revisionId,
      ...(options.artifactId !== undefined
        ? { artifactId: options.artifactId }
        : {}),
    });

    const generation = current
      ? assertPositiveSafeInteger(
          current.generation + 1,
          'next ledger service lifecycle generation',
        )
      : 1;
    const record = createStorageRecord({
      ...options,
      generation,
      status: LedgerServiceLifecycleStatus.STARTING,
      startedAt: options.observedAt,
      updatedAt: options.observedAt,
    });
    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        conditionChecks: [admissionFence],
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record,
            conditions: current
              ? replacementConditions(current)
              : [notExists(SORT_KEY_NAME)],
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        const raced = await readStored(options.serviceId);
        if (
          raced &&
          raced.session_id === options.sessionId &&
          raced.app_id === options.appId &&
          raced.revision_id === options.revisionId &&
          raced.artifact_id === (options.artifactId ?? null) &&
          raced.status === LedgerServiceLifecycleStatus.STARTING
        ) {
          return { applied: false, lifecycle: toLifecycleSnapshot(raced) };
        }
        await getLocalApplicationServiceStartFence({
          db,
          tableName: resolvedTableName,
          appId: options.appId,
          revisionId: options.revisionId,
          ...(options.artifactId !== undefined
            ? { artifactId: options.artifactId }
            : {}),
        });
        throw new LedgerServiceLifecycleConflictError(
          options.serviceId,
          'concurrent lifecycle update',
        );
      }
      throw error;
    }
    return { applied: true, lifecycle: toLifecycleSnapshot(record) };
  }

  /**
   * @param {{serviceId: string, sessionId: string, generation: number, observedAt?: number}} input - Current owner fence.
   * @param {string} operation - Public operation name.
   * @param {readonly string[]} expectedStatuses - States allowed before the transition.
   * @param {string} targetStatus - State written by the transition.
   * @returns {Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>} - Current durable lifecycle.
   */
  async function transition(input, operation, expectedStatuses, targetStatus) {
    const options = normalizeTransitionOptions(input, operation, now);
    const current = await readStored(options.serviceId);
    if (!current)
      throw new LedgerServiceLifecycleNotFoundError(options.serviceId);
    if (current.session_id !== options.sessionId) {
      throw new LedgerServiceLifecycleConflictError(
        options.serviceId,
        'stale session',
      );
    }
    if (current.generation !== options.generation) {
      throw new LedgerServiceLifecycleConflictError(
        options.serviceId,
        'stale generation',
      );
    }
    if (current.status === targetStatus) {
      return { applied: false, lifecycle: toLifecycleSnapshot(current) };
    }
    if (!expectedStatuses.includes(current.status)) {
      throw new LedgerServiceLifecycleConflictError(
        options.serviceId,
        `expected ${expectedStatuses.join(' or ')}, found ${current.status}`,
      );
    }

    const record = createStorageRecord({
      serviceId: current.service_id,
      appId: current.app_id,
      revisionId: current.revision_id,
      ...(current.artifact_id === null
        ? {}
        : { artifactId: current.artifact_id }),
      sessionId: current.session_id,
      generation: current.generation,
      status: targetStatus,
      startedAt: current.started_at,
      updatedAt: Math.max(current.updated_at, options.observedAt),
    });
    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record,
            conditions: replacementConditions(current),
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new LedgerServiceLifecycleConflictError(
          options.serviceId,
          'concurrent lifecycle update',
        );
      }
      throw error;
    }
    return { applied: true, lifecycle: toLifecycleSnapshot(record) };
  }

  /**
   * Mark the current owner ready to run future scheduler work.
   * @param {{serviceId: string, sessionId: string, generation: number, observedAt?: number}} input - Current owner fence.
   * @returns {Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>} - Current durable lifecycle.
   */
  async function markReady(input) {
    return await transition(
      input,
      'markReady',
      [LedgerServiceLifecycleStatus.STARTING],
      LedgerServiceLifecycleStatus.READY,
    );
  }

  /**
   * Mark the starting or ready service as intentionally draining before
   * release. Accepting STARTING makes an early SIGTERM durably honest rather
   * than pretending a service reached READY when it did not.
   * @param {{serviceId: string, sessionId: string, generation: number, observedAt?: number}} input - Current owner fence.
   * @returns {Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>} - Current durable lifecycle.
   */
  async function markStopping(input) {
    return await transition(
      input,
      'markStopping',
      [
        LedgerServiceLifecycleStatus.STARTING,
        LedgerServiceLifecycleStatus.READY,
      ],
      LedgerServiceLifecycleStatus.STOPPING,
    );
  }

  /**
   * Mark the draining service fully stopped before relinquishing its session.
   * @param {{serviceId: string, sessionId: string, generation: number, observedAt?: number}} input - Current owner fence.
   * @returns {Promise<{applied: boolean, lifecycle: Readonly<Record<string, any>>}>} - Current durable lifecycle.
   */
  async function markStopped(input) {
    return await transition(
      input,
      'markStopped',
      [LedgerServiceLifecycleStatus.STOPPING],
      LedgerServiceLifecycleStatus.STOPPED,
    );
  }

  return { get, start, markReady, markStopping, markStopped };
}

/**
 * @param {Record<string, any>} record - Ownership storage record.
 * @returns {import('../base.js').KeyCondition[]} - Conditions for exact ownership replacement or release.
 */
function ownershipReplacementConditions(record) {
  return [
    eq('schema_version', record.schema_version),
    eq('record_kind', record.record_kind),
    eq('service_id', record.service_id),
    eq('app_id', record.app_id),
    eq('scope_id', record.scope_id),
    eq('principal_id', record.principal_id),
    eq('session_id', record.session_id),
    eq('owner_kind', record.owner_kind),
    eq('generation', record.generation),
    eq('claimed_at', record.claimed_at),
    eq('updated_at', record.updated_at),
  ];
}

/**
 * @param {Record<string, any>} record - Validated ownership storage record.
 * @returns {Readonly<Record<string, any>>} - Safe public ownership snapshot.
 */
function toOwnershipSnapshot(record) {
  return Object.freeze({
    schemaVersion: record.schema_version,
    serviceId: record.service_id,
    appId: record.app_id,
    scopeId: record.scope_id,
    principalId: record.principal_id,
    sessionId: record.session_id,
    ownerKind: record.owner_kind,
    generation: record.generation,
    claimedAt: record.claimed_at,
    updatedAt: record.updated_at,
  });
}

/**
 * @param {unknown} raw - Durable record returned by the backing DB.
 * @param {string} serviceId - Expected service identity.
 * @returns {Record<string, any>} - Validated ownership storage record.
 */
function normalizeOwnershipStorageRecord(raw, serviceId) {
  let record;
  try {
    record = cloneBoundedJsonObject(
      raw,
      LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
      'ledger service ownership record',
    );
    assertExactKeys(
      record,
      OWNERSHIP_STORAGE_RECORD_KEYS,
      'ledger service ownership record',
    );
    if (record[KEY_NAME] !== getLedgerServiceLifecyclePartitionKey(serviceId)) {
      throw new TypeError('partition');
    }
    if (record[SORT_KEY_NAME] !== LEDGER_SERVICE_OWNERSHIP_SORT_KEY) {
      throw new TypeError('sort key');
    }
    if (record.schema_version !== LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION) {
      throw new TypeError('schema version');
    }
    if (record.record_kind !== LEDGER_SERVICE_OWNERSHIP_RECORD_KIND) {
      throw new TypeError('record kind');
    }
    if (record.service_id !== serviceId) {
      throw new TypeError('service identity');
    }
    assertLogicalId(record.app_id, 'ledger service ownership record.app_id');
    if (createLedgerServiceId({ appId: record.app_id }) !== serviceId) {
      throw new TypeError('service application binding');
    }
    assertLogicalId(
      record.scope_id,
      'ledger service ownership record.scope_id',
    );
    assertLogicalId(
      record.principal_id,
      'ledger service ownership record.principal_id',
    );
    assertLedgerServiceSessionId(
      record.session_id,
      'ledger service ownership record.session_id',
    );
    assertLedgerServiceOwnerKind(
      record.owner_kind,
      'ledger service ownership record.owner_kind',
    );
    assertPositiveSafeInteger(
      record.generation,
      'ledger service ownership record.generation',
    );
    const claimedAt = assertNonnegativeSafeInteger(
      record.claimed_at,
      'ledger service ownership record.claimed_at',
    );
    const updatedAt = assertNonnegativeSafeInteger(
      record.updated_at,
      'ledger service ownership record.updated_at',
    );
    if (updatedAt < claimedAt) throw new TypeError('timestamps');
  } catch (error) {
    if (error instanceof LedgerServiceOwnershipRecordError) throw error;
    throw new LedgerServiceOwnershipRecordError(serviceId, 'record shape');
  }
  return record;
}

/**
 * @param {{serviceId: string, appId: string, scopeId: string, principalId: string, sessionId: string, ownerKind: 'resident' | 'manual', generation: number, claimedAt: number, updatedAt: number}} input - Validated ownership fields.
 * @returns {Record<string, any>} - Canonical ownership storage record.
 */
function createOwnershipStorageRecord(input) {
  return {
    [KEY_NAME]: getLedgerServiceLifecyclePartitionKey(input.serviceId),
    [SORT_KEY_NAME]: LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
    schema_version: LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
    record_kind: LEDGER_SERVICE_OWNERSHIP_RECORD_KIND,
    service_id: input.serviceId,
    app_id: input.appId,
    scope_id: input.scopeId,
    principal_id: input.principalId,
    session_id: input.sessionId,
    owner_kind: input.ownerKind,
    generation: input.generation,
    claimed_at: input.claimedAt,
    updated_at: input.updatedAt,
  };
}

/**
 * @param {unknown} value - Candidate public ownership snapshot.
 * @param {string} label - Human-readable boundary label.
 * @returns {Record<string, any>} - Validated expected ownership snapshot.
 */
function normalizeExpectedOwnership(value, label) {
  const expected = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    label,
  );
  assertExactKeys(expected, OWNERSHIP_SNAPSHOT_KEYS, label);
  if (expected.schemaVersion !== LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION) {
    throw new TypeError(
      `${label}.schemaVersion must be ${LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION}.`,
    );
  }
  assertLedgerServiceId(expected.serviceId, `${label}.serviceId`);
  assertLogicalId(expected.appId, `${label}.appId`);
  if (createLedgerServiceId({ appId: expected.appId }) !== expected.serviceId) {
    throw new TypeError(`${label}.serviceId must bind ${label}.appId.`);
  }
  assertLogicalId(expected.scopeId, `${label}.scopeId`);
  assertLogicalId(expected.principalId, `${label}.principalId`);
  assertLedgerServiceSessionId(expected.sessionId, `${label}.sessionId`);
  assertLedgerServiceOwnerKind(expected.ownerKind, `${label}.ownerKind`);
  assertPositiveSafeInteger(expected.generation, `${label}.generation`);
  const claimedAt = assertNonnegativeSafeInteger(
    expected.claimedAt,
    `${label}.claimedAt`,
  );
  const updatedAt = assertNonnegativeSafeInteger(
    expected.updatedAt,
    `${label}.updatedAt`,
  );
  if (updatedAt < claimedAt) {
    throw new TypeError(
      `${label}.updatedAt must not precede ${label}.claimedAt.`,
    );
  }
  return expected;
}

/**
 * @param {Record<string, any>} record - Current validated storage record.
 * @param {Record<string, any>} expected - Caller-observed public snapshot.
 * @returns {boolean} - Whether every ownership field remains exact.
 */
function matchesExpectedOwnership(record, expected) {
  return (
    record.schema_version === expected.schemaVersion &&
    record.service_id === expected.serviceId &&
    record.app_id === expected.appId &&
    record.scope_id === expected.scopeId &&
    record.principal_id === expected.principalId &&
    record.session_id === expected.sessionId &&
    record.owner_kind === expected.ownerKind &&
    record.generation === expected.generation &&
    record.claimed_at === expected.claimedAt &&
    record.updated_at === expected.updatedAt
  );
}

/**
 * @param {unknown} value - Candidate ownership claim options.
 * @param {() => number} now - Durable observation clock.
 * @returns {{serviceId: string, appId: string, scopeId: string, principalId: string, sessionId: string, ownerKind: 'resident' | 'manual', expected: Record<string, any> | null, claimedAt: number}} - Validated claim options.
 */
function normalizeOwnershipClaimOptions(value, now) {
  const input = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    'ledger service ownership claim',
  );
  assertExactKeys(
    input,
    new Set([
      'serviceId',
      'appId',
      'scopeId',
      'principalId',
      'sessionId',
      'ownerKind',
      'expected',
      'claimedAt',
    ]),
    'ledger service ownership claim',
  );
  if (!Object.prototype.hasOwnProperty.call(input, 'expected')) {
    throw new TypeError('claimOwnership.expected is required.');
  }
  assertLedgerServiceId(input.serviceId, 'claimOwnership.serviceId');
  assertLogicalId(input.appId, 'claimOwnership.appId');
  if (createLedgerServiceId({ appId: input.appId }) !== input.serviceId) {
    throw new TypeError(
      'claimOwnership.serviceId must bind claimOwnership.appId.',
    );
  }
  assertLogicalId(input.scopeId, 'claimOwnership.scopeId');
  assertLogicalId(input.principalId, 'claimOwnership.principalId');
  assertLedgerServiceSessionId(input.sessionId, 'claimOwnership.sessionId');
  assertLedgerServiceOwnerKind(input.ownerKind, 'claimOwnership.ownerKind');
  const expected =
    input.expected === null
      ? null
      : normalizeExpectedOwnership(input.expected, 'claimOwnership.expected');
  if (
    expected &&
    (expected.serviceId !== input.serviceId || expected.appId !== input.appId)
  ) {
    throw new TypeError(
      'claimOwnership.expected must bind the claimed serviceId and appId.',
    );
  }
  return {
    serviceId: input.serviceId,
    appId: input.appId,
    scopeId: input.scopeId,
    principalId: input.principalId,
    sessionId: input.sessionId,
    ownerKind: input.ownerKind,
    expected,
    claimedAt: assertNonnegativeSafeInteger(
      Object.prototype.hasOwnProperty.call(input, 'claimedAt')
        ? input.claimedAt
        : now(),
      'claimOwnership.claimedAt',
    ),
  };
}

/**
 * @param {unknown} value - Candidate ownership-release options.
 * @returns {{serviceId: string, scopeId: string, principalId: string, sessionId: string, generation: number}} - Validated release options.
 */
function normalizeOwnershipReleaseOptions(value) {
  const input = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    'ledger service ownership release',
  );
  assertExactKeys(
    input,
    new Set(['serviceId', 'scopeId', 'principalId', 'sessionId', 'generation']),
    'ledger service ownership release',
  );
  assertLedgerServiceId(input.serviceId, 'releaseOwnership.serviceId');
  assertLogicalId(input.scopeId, 'releaseOwnership.scopeId');
  assertLogicalId(input.principalId, 'releaseOwnership.principalId');
  assertLedgerServiceSessionId(input.sessionId, 'releaseOwnership.sessionId');
  return {
    serviceId: input.serviceId,
    scopeId: input.scopeId,
    principalId: input.principalId,
    sessionId: input.sessionId,
    generation: assertPositiveSafeInteger(
      input.generation,
      'releaseOwnership.generation',
    ),
  };
}

/**
 * @param {unknown} value - Candidate ownership-get options.
 * @returns {{serviceId: string}} - Validated get options.
 */
function normalizeOwnershipGetOptions(value) {
  const input = cloneBoundedJsonObject(
    value,
    LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
    'ledger service ownership get',
  );
  assertExactKeys(
    input,
    new Set(['serviceId']),
    'ledger service ownership get',
  );
  assertLedgerServiceId(input.serviceId, 'getOwnership.serviceId');
  return { serviceId: input.serviceId };
}

/**
 * Create the narrow durable ownership fence for one local resident ledger
 * service.
 * The store neither probes nor infers socket/process liveness: callers must
 * read an owner, probe its session endpoint, and pass that exact observed
 * snapshot as `expected` when attempting a takeover. This makes a candidate
 * owner unable to overwrite an owner that changed after its probe.
 * @param {{db: import('../base.js').DBClient, tableName: string, now?: () => number}} options - Store dependencies.
 * @returns {{getOwnership: (input: {serviceId: string}) => Promise<Readonly<Record<string, any>> | null>, claimOwnership: (input: {serviceId: string, appId: string, scopeId: string, principalId: string, sessionId: string, ownerKind: 'resident' | 'manual', expected: Readonly<Record<string, any>> | null, claimedAt?: number}) => Promise<{applied: boolean, ownership: Readonly<Record<string, any>>}>, releaseOwnership: (input: {serviceId: string, scopeId: string, principalId: string, sessionId: string, generation: number}) => Promise<{applied: boolean, ownership: Readonly<Record<string, any>>}>}} - Durable ownership API.
 */
export function createLedgerServiceOwnership({
  db,
  tableName,
  now = () => Date.now(),
}) {
  if (
    !db ||
    typeof db.get !== 'function' ||
    typeof db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createLedgerServiceOwnership requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new TypeError('createLedgerServiceOwnership requires a tableName.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('createLedgerServiceOwnership now must be a function.');
  }
  const resolvedTableName = tableName.trim();

  /**
   * @param {string} serviceId - Valid typed service identity.
   * @returns {Promise<Record<string, any> | null>} - Validated raw ownership record.
   */
  async function readStoredOwnership(serviceId) {
    const record = await db.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: getLedgerServiceLifecyclePartitionKey(serviceId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
      consistentRead: true,
    });
    return record ? normalizeOwnershipStorageRecord(record, serviceId) : null;
  }

  /**
   * @param {{serviceId: string}} input - Service identity.
   * @returns {Promise<Readonly<Record<string, any>> | null>} - Current ownership snapshot, if any.
   */
  async function getOwnership(input) {
    const { serviceId } = normalizeOwnershipGetOptions(input);
    const record = await readStoredOwnership(serviceId);
    return record ? toOwnershipSnapshot(record) : null;
  }

  /**
   * Claim a locally-probed vacant or stale ownership record. The explicit
   * expected snapshot is both the caller's liveness decision boundary and the
   * durable compare-and-swap fence; this function never decides staleness.
   * @param {{serviceId: string, appId: string, scopeId: string, principalId: string, sessionId: string, ownerKind: 'resident' | 'manual', expected: Readonly<Record<string, any>> | null, claimedAt?: number}} input - Candidate ownership and exact observed predecessor.
   * @returns {Promise<{applied: boolean, ownership: Readonly<Record<string, any>>}>} - Current durable ownership.
   */
  async function claimOwnership(input) {
    const options = normalizeOwnershipClaimOptions(input, now);
    const current = await readStoredOwnership(options.serviceId);
    if (options.expected === null) {
      if (current) {
        throw new LedgerServiceOwnershipConflictError(
          options.serviceId,
          'expected no ownership',
        );
      }
    } else {
      if (!current || !matchesExpectedOwnership(current, options.expected)) {
        throw new LedgerServiceOwnershipConflictError(
          options.serviceId,
          'expected ownership changed',
        );
      }
      if (
        current.scope_id !== options.scopeId ||
        current.principal_id !== options.principalId
      ) {
        throw new LedgerServiceOwnershipConflictError(
          options.serviceId,
          'ownership scope or principal mismatch',
        );
      }
      if (current.session_id === options.sessionId) {
        if (current.owner_kind === options.ownerKind) {
          return { applied: false, ownership: toOwnershipSnapshot(current) };
        }
        throw new LedgerServiceOwnershipConflictError(
          options.serviceId,
          'session already has another owner kind',
        );
      }
    }

    const generation = current
      ? assertPositiveSafeInteger(
          current.generation + 1,
          'next ledger service ownership generation',
        )
      : 1;
    const record = createOwnershipStorageRecord({
      serviceId: options.serviceId,
      appId: options.appId,
      scopeId: options.scopeId,
      principalId: options.principalId,
      sessionId: options.sessionId,
      ownerKind: options.ownerKind,
      generation,
      claimedAt: options.claimedAt,
      updatedAt: options.claimedAt,
    });
    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        putRequests: [
          {
            keyName: KEY_NAME,
            sortKeyName: SORT_KEY_NAME,
            record,
            conditions: current
              ? ownershipReplacementConditions(current)
              : [notExists(SORT_KEY_NAME)],
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new LedgerServiceOwnershipConflictError(
          options.serviceId,
          'concurrent ownership update',
        );
      }
      throw error;
    }
    return { applied: true, ownership: toOwnershipSnapshot(record) };
  }

  /**
   * Release exactly the ownership held by one current session/generation. A
   * missing record is not idempotent: it indicates a stale or already-replaced
   * owner and must remain visible to the caller.
   * @param {{serviceId: string, scopeId: string, principalId: string, sessionId: string, generation: number}} input - Current ownership fence.
   * @returns {Promise<{applied: boolean, ownership: Readonly<Record<string, any>>}>} - Released ownership snapshot.
   */
  async function releaseOwnership(input) {
    const options = normalizeOwnershipReleaseOptions(input);
    const current = await readStoredOwnership(options.serviceId);
    if (!current) {
      throw new LedgerServiceOwnershipConflictError(
        options.serviceId,
        'ownership not held',
      );
    }
    if (
      current.scope_id !== options.scopeId ||
      current.principal_id !== options.principalId
    ) {
      throw new LedgerServiceOwnershipConflictError(
        options.serviceId,
        'ownership scope or principal mismatch',
      );
    }
    if (current.session_id !== options.sessionId) {
      throw new LedgerServiceOwnershipConflictError(
        options.serviceId,
        'stale session',
      );
    }
    if (current.generation !== options.generation) {
      throw new LedgerServiceOwnershipConflictError(
        options.serviceId,
        'stale generation',
      );
    }
    const ownership = toOwnershipSnapshot(current);
    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        deleteRequests: [
          {
            keyName: KEY_NAME,
            keyValue: current[KEY_NAME],
            sortKeyName: SORT_KEY_NAME,
            sortKeyValue: current[SORT_KEY_NAME],
            conditions: ownershipReplacementConditions(current),
          },
        ],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new LedgerServiceOwnershipConflictError(
          options.serviceId,
          'concurrent ownership update',
        );
      }
      throw error;
    }
    return { applied: true, ownership };
  }

  return { getOwnership, claimOwnership, releaseOwnership };
}

export default {
  LEDGER_SERVICE_ID_DOMAIN,
  LEDGER_SERVICE_ID_PREFIX,
  LEDGER_SERVICE_ID_SCHEMA_VERSION,
  LEDGER_SERVICE_LIFECYCLE_MAX_RECORD_BYTES,
  LEDGER_SERVICE_LIFECYCLE_PARTITION_DOMAIN,
  LEDGER_SERVICE_LIFECYCLE_PARTITION_PREFIX,
  LEDGER_SERVICE_LIFECYCLE_RECORD_KIND,
  LEDGER_SERVICE_LIFECYCLE_SCHEMA_VERSION,
  LEDGER_SERVICE_LIFECYCLE_SORT_KEY,
  LEDGER_SERVICE_OWNERSHIP_RECORD_KIND,
  LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
  LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
  LEDGER_SERVICE_PARTITION_SCHEMA_VERSION,
  LEDGER_SERVICE_SESSION_ID_PREFIX,
  LedgerServiceLifecycleConflictError,
  LedgerServiceLifecycleNotFoundError,
  LedgerServiceLifecycleRecordError,
  LedgerServiceLifecycleStatus,
  LedgerServiceOwnerKind,
  LedgerServiceOwnershipConflictError,
  LedgerServiceOwnershipRecordError,
  assertLedgerServiceId,
  assertLedgerServiceOwnerKind,
  assertLedgerServiceSessionId,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
  getLedgerServiceLifecyclePartitionKey,
  getLedgerServiceLifecycleSortKey,
};
