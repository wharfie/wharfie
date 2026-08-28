/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Internal exact-schema helpers stay compact, and TypeScript assertion/readonly signatures are not understood by the current JSDoc lint parser. */

import { assertApplicationRevisionId } from '../../../runtime/application-revision.js';
import { createCanonicalJsonSha256Id } from '../../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import {
  SCHEDULE_MAX_UTC_TIMESTAMP_MS,
  SCHEDULE_MINUTE_MS,
  SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES,
} from '../../../runtime/schedule-definition.js';
import {
  hasSameCanonicalJson,
  assertNonnegativeSafeInteger,
  assertPositiveSafeInteger,
} from '../../ledger/execution-ledger-contract.js';
import {
  assertScheduleDefinitionId,
  assertScheduleMinute,
  assertScheduleOccurrenceId,
  normalizeScheduleRunCause,
} from '../../ledger/schedule-occurrence.js';
import {
  assertWorkflowPlanId,
  assertWorkflowRunId,
  createWorkflowRunId,
} from '../../ledger/workflow-execution-contract.js';
import { CONDITION_TYPE } from '../base.js';
import {
  assertCoordinatorAuthorityCurrent,
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthorityFence,
} from './coordinator-authority.js';
import {
  LEDGER_SERVICE_OWNERSHIP_RECORD_KIND,
  LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
  LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
  LedgerServiceOwnerKind,
  assertLedgerServiceId,
  assertLedgerServiceSessionId,
  createLedgerServiceId,
  getLedgerServiceLifecyclePartitionKey,
} from './ledger-service-lifecycle.js';
import { getLocalApplicationRunCreationFence } from './local-application-activation.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const CURSOR_SORT_KEY = 'schedule-control/v1/cursor';
const OCCURRENCE_SORT_KEY = 'schedule-control/v1/occurrence';
const CURSOR_PARTITION_DOMAIN = 'wharfie:schedule-control-cursor:v1';
const CURSOR_PARTITION_PREFIX = 'wscp';
const OCCURRENCE_PARTITION_DOMAIN = 'wharfie:schedule-control-occurrence:v1';
const OCCURRENCE_PARTITION_PREFIX = 'wsop';
const RECORD_MAX_BYTES = 32 * 1024;
const PREPARED_ADMISSIONS = new WeakMap();

const CURSOR_STORAGE_KEYS = Object.freeze([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'schedule_id',
  'revision_id',
  'definition_id',
  'activation_boundary',
  'horizon',
  'version',
  'updated_at',
]);
const OCCURRENCE_STORAGE_KEYS_V1 = Object.freeze([
  KEY_NAME,
  SORT_KEY_NAME,
  'schema_version',
  'record_kind',
  'app_id',
  'schedule_id',
  'revision_id',
  'definition_id',
  'workflow_id',
  'plan_id',
  'run_id_value',
  'occurrence_id',
  'scheduled_at',
  'window_after_exclusive',
  'through_inclusive',
  'scanned_minute_count',
  'skipped',
  'cause',
  'created_at',
]);
const OCCURRENCE_STORAGE_KEYS_V2 = Object.freeze([
  ...OCCURRENCE_STORAGE_KEYS_V1,
  'coordinator_authority',
]);
const OWNER_KEYS = Object.freeze([
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
const EXPECTED_KEYS = Object.freeze([
  'appId',
  'revisionId',
  'scheduleId',
  'definitionId',
  'workflowId',
  'planId',
  'runId',
  'cause',
]);

/** @template T @param {T} value */
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

/** @param {string} propertyName @param {unknown} propertyValue */
function eq(propertyName, propertyValue) {
  return Object.freeze({
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  });
}

/** @param {string} propertyName */
function notExists(propertyName) {
  return Object.freeze({
    conditionType: CONDITION_TYPE.NOT_EXISTS,
    propertyName,
  });
}

/** @param {unknown} error */
function isConditionalCheckFailed(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/** @param {Record<string, any>} value @param {readonly string[]} keys @param {string} label */
function assertExactKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} must contain exactly ${keys.join(', ')}.`);
  }
}

/**
 * Reject extra operation fields while permitting only named optional fields.
 * @param {unknown} value
 * @param {readonly string[]} required
 * @param {readonly string[]} optional
 * @param {string} label
 */
function assertInputKeys(value, required, optional, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const input = /** @type {Record<string, any>} */ (value);
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(input, key)) ||
    Object.keys(input).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(
      `${label} must contain ${required.join(', ')}${
        optional.length ? ` and only optional ${optional.join(', ')}` : ''
      }.`,
    );
  }
}

/** @param {unknown} value @param {string} label */
function normalizeTimestamp(value, label) {
  const timestamp = assertNonnegativeSafeInteger(value, label);
  if (timestamp > SCHEDULE_MAX_UTC_TIMESTAMP_MS) {
    throw new TypeError(`${label} exceeds the supported UTC timestamp range.`);
  }
  return timestamp;
}

/** @param {number} value */
function floorScheduleMinute(value) {
  return Math.floor(value / SCHEDULE_MINUTE_MS) * SCHEDULE_MINUTE_MS;
}

/** @param {string} appId @param {string} scheduleId */
function cursorPartition(appId, scheduleId) {
  return createCanonicalJsonSha256Id({
    domain: CURSOR_PARTITION_DOMAIN,
    prefix: CURSOR_PARTITION_PREFIX,
    value: { appId, scheduleId },
    valuePath: 'schedule cursor partition',
  });
}

/** @param {string} occurrenceId */
function occurrencePartition(occurrenceId) {
  assertScheduleOccurrenceId(occurrenceId);
  return createCanonicalJsonSha256Id({
    domain: OCCURRENCE_PARTITION_DOMAIN,
    prefix: OCCURRENCE_PARTITION_PREFIX,
    value: { occurrenceId },
    valuePath: 'schedule occurrence partition',
  });
}

/** @param {Readonly<Record<string, any>>} owner @param {string} appId */
function normalizeOwner(owner, appId) {
  const normalized = cloneBoundedJsonObject(
    owner,
    RECORD_MAX_BYTES,
    'schedule resident owner',
  );
  assertExactKeys(normalized, OWNER_KEYS, 'schedule resident owner');
  if (normalized.schemaVersion !== LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION) {
    throw new TypeError('schedule resident owner schemaVersion is invalid.');
  }
  assertLedgerServiceId(
    normalized.serviceId,
    'schedule resident owner.serviceId',
  );
  assertLogicalId(normalized.appId, 'schedule resident owner.appId');
  assertLogicalId(normalized.scopeId, 'schedule resident owner.scopeId');
  assertLogicalId(
    normalized.principalId,
    'schedule resident owner.principalId',
  );
  assertLedgerServiceSessionId(
    normalized.sessionId,
    'schedule resident owner.sessionId',
  );
  if (normalized.ownerKind !== LedgerServiceOwnerKind.RESIDENT) {
    throw new TypeError('schedule owner must be a resident owner.');
  }
  const generation = assertPositiveSafeInteger(
    normalized.generation,
    'schedule resident owner.generation',
  );
  const claimedAt = normalizeTimestamp(
    normalized.claimedAt,
    'schedule resident owner.claimedAt',
  );
  const updatedAt = normalizeTimestamp(
    normalized.updatedAt,
    'schedule resident owner.updatedAt',
  );
  if (
    normalized.appId !== appId ||
    normalized.serviceId !== createLedgerServiceId({ appId }) ||
    updatedAt < claimedAt
  ) {
    throw new TypeError(
      'schedule resident owner does not match its application or timestamps.',
    );
  }
  return Object.freeze({
    schemaVersion: LEDGER_SERVICE_OWNERSHIP_SCHEMA_VERSION,
    serviceId: normalized.serviceId,
    appId,
    scopeId: normalized.scopeId,
    principalId: normalized.principalId,
    sessionId: normalized.sessionId,
    ownerKind: /** @type {'resident'} */ (LedgerServiceOwnerKind.RESIDENT),
    generation,
    claimedAt,
    updatedAt,
  });
}

/** @param {Readonly<Record<string, any>>} owner */
function ownerFence(owner) {
  return deepFreeze({
    keyName: KEY_NAME,
    keyValue: getLedgerServiceLifecyclePartitionKey(owner.serviceId),
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: LEDGER_SERVICE_OWNERSHIP_SORT_KEY,
    conditions: [
      eq('schema_version', owner.schemaVersion),
      eq('record_kind', LEDGER_SERVICE_OWNERSHIP_RECORD_KIND),
      eq('service_id', owner.serviceId),
      eq('app_id', owner.appId),
      eq('scope_id', owner.scopeId),
      eq('principal_id', owner.principalId),
      eq('session_id', owner.sessionId),
      eq('owner_kind', owner.ownerKind),
      eq('generation', owner.generation),
      eq('claimed_at', owner.claimedAt),
      eq('updated_at', owner.updatedAt),
    ],
  });
}

/** @param {unknown} value @param {string} label */
function normalizeCursor(value, label = 'schedule cursor') {
  const cursor = cloneBoundedJsonObject(value, RECORD_MAX_BYTES, label);
  assertExactKeys(
    cursor,
    [
      'appId',
      'scheduleId',
      'revisionId',
      'definitionId',
      'activationBoundary',
      'horizon',
      'version',
      'updatedAt',
    ],
    label,
  );
  assertLogicalId(cursor.appId, `${label}.appId`);
  assertLogicalId(cursor.scheduleId, `${label}.scheduleId`);
  assertApplicationRevisionId(cursor.revisionId, `${label}.revisionId`);
  assertScheduleDefinitionId(cursor.definitionId, `${label}.definitionId`);
  const activationBoundary = assertScheduleMinute(
    cursor.activationBoundary,
    `${label}.activationBoundary`,
  );
  const horizon = assertScheduleMinute(cursor.horizon, `${label}.horizon`);
  const updatedAt = normalizeTimestamp(cursor.updatedAt, `${label}.updatedAt`);
  if (horizon < activationBoundary || updatedAt < horizon) {
    throw new TypeError(
      `${label} horizon must not precede activationBoundary or updatedAt.`,
    );
  }
  return Object.freeze({
    appId: cursor.appId,
    scheduleId: cursor.scheduleId,
    revisionId: cursor.revisionId,
    definitionId: cursor.definitionId,
    activationBoundary,
    horizon,
    version: assertPositiveSafeInteger(cursor.version, `${label}.version`),
    updatedAt,
  });
}

/** @param {Readonly<Record<string, any>>} cursor */
function cursorRecord(cursor) {
  return {
    [KEY_NAME]: cursorPartition(cursor.appId, cursor.scheduleId),
    [SORT_KEY_NAME]: CURSOR_SORT_KEY,
    schema_version: 1,
    record_kind: 'schedule-cursor',
    app_id: cursor.appId,
    schedule_id: cursor.scheduleId,
    revision_id: cursor.revisionId,
    definition_id: cursor.definitionId,
    activation_boundary: cursor.activationBoundary,
    horizon: cursor.horizon,
    version: cursor.version,
    updated_at: cursor.updatedAt,
  };
}

/** @param {Readonly<Record<string, any>>} cursor */
function cursorFence(cursor) {
  const record = cursorRecord(cursor);
  return deepFreeze({
    keyName: KEY_NAME,
    keyValue: record[KEY_NAME],
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: record[SORT_KEY_NAME],
    conditions: [
      eq('schema_version', record.schema_version),
      eq('record_kind', record.record_kind),
      eq('app_id', record.app_id),
      eq('schedule_id', record.schedule_id),
      eq('revision_id', record.revision_id),
      eq('definition_id', record.definition_id),
      eq('activation_boundary', record.activation_boundary),
      eq('horizon', record.horizon),
      eq('version', record.version),
      eq('updated_at', record.updated_at),
    ],
  });
}

/** @param {Record<string, any>} record @param {string} appId @param {string} scheduleId */
function cursorFromRecord(record, appId, scheduleId) {
  const raw = cloneBoundedJsonObject(
    record,
    RECORD_MAX_BYTES,
    'schedule cursor record',
  );
  assertExactKeys(raw, CURSOR_STORAGE_KEYS, 'schedule cursor record');
  if (
    raw[KEY_NAME] !== cursorPartition(appId, scheduleId) ||
    raw[SORT_KEY_NAME] !== CURSOR_SORT_KEY ||
    raw.schema_version !== 1 ||
    raw.record_kind !== 'schedule-cursor' ||
    raw.app_id !== appId ||
    raw.schedule_id !== scheduleId
  ) {
    throw new Error('Schedule cursor record is invalid.');
  }
  return normalizeCursor({
    appId: raw.app_id,
    scheduleId: raw.schedule_id,
    revisionId: raw.revision_id,
    definitionId: raw.definition_id,
    activationBoundary: raw.activation_boundary,
    horizon: raw.horizon,
    version: raw.version,
    updatedAt: raw.updated_at,
  });
}

/** @param {unknown} value */
function normalizeExpected(value) {
  const expected = cloneBoundedJsonObject(
    value,
    RECORD_MAX_BYTES,
    'prepared schedule workflow admission expected',
  );
  assertExactKeys(
    expected,
    EXPECTED_KEYS,
    'prepared schedule workflow admission expected',
  );
  assertLogicalId(expected.appId, 'expected.appId');
  assertApplicationRevisionId(expected.revisionId, 'expected.revisionId');
  assertLogicalId(expected.scheduleId, 'expected.scheduleId');
  assertScheduleDefinitionId(expected.definitionId, 'expected.definitionId');
  assertLogicalId(expected.workflowId, 'expected.workflowId');
  assertWorkflowPlanId(expected.planId, 'expected.planId');
  assertWorkflowRunId(expected.runId, 'expected.runId');
  const cause = normalizeScheduleRunCause(expected.cause, {
    appId: expected.appId,
    label: 'expected.cause',
  });
  if (
    cause.scheduleId !== expected.scheduleId ||
    cause.definitionId !== expected.definitionId ||
    expected.runId !==
      createWorkflowRunId({
        appId: expected.appId,
        idempotencyKey: cause.occurrenceId,
      })
  ) {
    throw new TypeError(
      'prepared schedule workflow admission expected identities conflict.',
    );
  }
  return Object.freeze({
    appId: expected.appId,
    revisionId: expected.revisionId,
    scheduleId: expected.scheduleId,
    definitionId: expected.definitionId,
    workflowId: expected.workflowId,
    planId: expected.planId,
    runId: expected.runId,
    cause,
  });
}

/** @param {unknown} value @param {number} afterExclusive @param {number} scheduledAt @param {number} scannedMinuteCount */
function normalizeSkipped(
  value,
  afterExclusive,
  scheduledAt,
  scannedMinuteCount,
) {
  if (value === null) return null;
  const skipped = cloneBoundedJsonObject(
    value,
    RECORD_MAX_BYTES,
    'schedule skipped occurrences',
  );
  assertExactKeys(
    skipped,
    ['count', 'firstScheduledAtMs', 'lastScheduledAtMs'],
    'schedule skipped occurrences',
  );
  const count = assertPositiveSafeInteger(
    skipped.count,
    'schedule skipped occurrences.count',
  );
  const firstScheduledAtMs = assertScheduleMinute(
    skipped.firstScheduledAtMs,
    'schedule skipped occurrences.firstScheduledAtMs',
  );
  const lastScheduledAtMs = assertScheduleMinute(
    skipped.lastScheduledAtMs,
    'schedule skipped occurrences.lastScheduledAtMs',
  );
  if (
    firstScheduledAtMs <= afterExclusive ||
    lastScheduledAtMs < firstScheduledAtMs ||
    lastScheduledAtMs >= scheduledAt ||
    count > scannedMinuteCount - 1 ||
    count > (lastScheduledAtMs - firstScheduledAtMs) / SCHEDULE_MINUTE_MS + 1
  ) {
    throw new TypeError(
      'schedule skipped occurrences must stay inside the evaluated window and precede the selected occurrence.',
    );
  }
  return Object.freeze({ count, firstScheduledAtMs, lastScheduledAtMs });
}

/** @param {Record<string, any>} record */
function occurrenceFromRecord(record) {
  const raw = cloneBoundedJsonObject(
    record,
    RECORD_MAX_BYTES,
    'schedule occurrence record',
  );
  const schemaVersion = raw.schema_version;
  if (schemaVersion === 1) {
    assertExactKeys(
      raw,
      OCCURRENCE_STORAGE_KEYS_V1,
      'schedule occurrence record',
    );
  } else if (schemaVersion === 2) {
    assertExactKeys(
      raw,
      OCCURRENCE_STORAGE_KEYS_V2,
      'schedule occurrence record',
    );
  } else {
    throw new Error('Schedule occurrence record schema is invalid.');
  }
  const expected = normalizeExpected({
    appId: raw.app_id,
    revisionId: raw.revision_id,
    scheduleId: raw.schedule_id,
    definitionId: raw.definition_id,
    workflowId: raw.workflow_id,
    planId: raw.plan_id,
    runId: raw.run_id_value,
    cause: raw.cause,
  });
  if (
    raw[KEY_NAME] !== occurrencePartition(expected.cause.occurrenceId) ||
    raw[SORT_KEY_NAME] !== OCCURRENCE_SORT_KEY ||
    raw.record_kind !== 'schedule-occurrence' ||
    raw.occurrence_id !== expected.cause.occurrenceId ||
    raw.scheduled_at !== expected.cause.scheduledAt
  ) {
    throw new Error('Schedule occurrence record is invalid.');
  }
  const windowAfterExclusive = assertScheduleMinute(
    raw.window_after_exclusive,
    'schedule occurrence.windowAfterExclusive',
  );
  const throughInclusive = assertScheduleMinute(
    raw.through_inclusive,
    'schedule occurrence.throughInclusive',
  );
  const scannedMinuteCount = assertPositiveSafeInteger(
    raw.scanned_minute_count,
    'schedule occurrence.scannedMinuteCount',
  );
  if (
    throughInclusive <= windowAfterExclusive ||
    expected.cause.scheduledAt <= windowAfterExclusive ||
    expected.cause.scheduledAt > throughInclusive ||
    scannedMinuteCount > SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES ||
    scannedMinuteCount !==
      (throughInclusive - windowAfterExclusive) / SCHEDULE_MINUTE_MS
  ) {
    throw new Error('Schedule occurrence window is invalid.');
  }
  const skipped = normalizeSkipped(
    raw.skipped,
    windowAfterExclusive,
    expected.cause.scheduledAt,
    scannedMinuteCount,
  );
  const createdAt = normalizeTimestamp(
    raw.created_at,
    'schedule occurrence.createdAt',
  );
  if (createdAt < throughInclusive) {
    throw new Error('Schedule occurrence creation precedes its scan window.');
  }
  const coordinatorAuthority =
    schemaVersion === 2
      ? assertCoordinatorAuthorityToken(
          raw.coordinator_authority,
          'schedule occurrence.coordinatorAuthority',
        )
      : undefined;
  if (
    coordinatorAuthority !== undefined &&
    coordinatorAuthority.appId !== expected.appId
  ) {
    throw new Error(
      'Schedule occurrence coordinator authority does not match its application.',
    );
  }
  return Object.freeze({
    ...expected,
    occurrenceId: expected.cause.occurrenceId,
    scheduledAt: expected.cause.scheduledAt,
    windowAfterExclusive,
    throughInclusive,
    scannedMinuteCount,
    skipped,
    createdAt,
    ...(coordinatorAuthority === undefined ? {} : { coordinatorAuthority }),
  });
}

/** @param {Readonly<Record<string, any>>} occurrence */
function occurrenceRecord(occurrence) {
  const coordinatorAuthority =
    occurrence.coordinatorAuthority === undefined
      ? undefined
      : assertCoordinatorAuthorityToken(
          occurrence.coordinatorAuthority,
          'schedule occurrence.coordinatorAuthority',
        );
  if (
    coordinatorAuthority !== undefined &&
    coordinatorAuthority.appId !== occurrence.appId
  ) {
    throw new TypeError(
      'schedule occurrence coordinatorAuthority must bind its appId.',
    );
  }
  return {
    [KEY_NAME]: occurrencePartition(occurrence.occurrenceId),
    [SORT_KEY_NAME]: OCCURRENCE_SORT_KEY,
    schema_version: coordinatorAuthority === undefined ? 1 : 2,
    record_kind: 'schedule-occurrence',
    app_id: occurrence.appId,
    schedule_id: occurrence.scheduleId,
    revision_id: occurrence.revisionId,
    definition_id: occurrence.definitionId,
    workflow_id: occurrence.workflowId,
    plan_id: occurrence.planId,
    run_id_value: occurrence.runId,
    occurrence_id: occurrence.occurrenceId,
    scheduled_at: occurrence.scheduledAt,
    window_after_exclusive: occurrence.windowAfterExclusive,
    through_inclusive: occurrence.throughInclusive,
    scanned_minute_count: occurrence.scannedMinuteCount,
    skipped: occurrence.skipped,
    cause: occurrence.cause,
    created_at: occurrence.createdAt,
    ...(coordinatorAuthority === undefined
      ? {}
      : { coordinator_authority: coordinatorAuthority }),
  };
}

/** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right */
function sameOccurrenceRequest(left, right) {
  /** @param {Readonly<Record<string, any>>} value */
  const withoutCreatedAt = (value) => {
    const {
      createdAt: _createdAt,
      coordinatorAuthority: _coordinatorAuthority,
      ...identity
    } = value;
    return identity;
  };
  return hasSameCanonicalJson(withoutCreatedAt(left), withoutCreatedAt(right));
}

/**
 * Attach the exact authority that will fence a new combined admission. Legacy
 * and unbound occurrences intentionally omit authorship instead of treating
 * epoch zero or a later coordinator as historical provenance.
 * @param {Readonly<Record<string, any>>} occurrence
 * @param {import('./coordinator-authority.js').CoordinatorAuthorityToken | undefined} coordinatorAuthority
 */
function occurrenceWithCoordinatorAuthority(occurrence, coordinatorAuthority) {
  const {
    coordinatorAuthority: _retainedCoordinatorAuthority,
    ...logicalOccurrence
  } = occurrence;
  return Object.freeze({
    ...logicalOccurrence,
    ...(coordinatorAuthority === undefined ? {} : { coordinatorAuthority }),
  });
}

/** @param {unknown} prepared @param {unknown} expected @param {unknown} context */
function preparedMetadata(prepared, expected, context) {
  if (!prepared || typeof prepared !== 'object') {
    throw new TypeError('prepared schedule workflow admission is invalid.');
  }
  const metadata = PREPARED_ADMISSIONS.get(prepared);
  if (!metadata) {
    throw new TypeError(
      'prepared schedule workflow admission was not created by this module.',
    );
  }
  assertInputKeys(
    context,
    ['db', 'tableName'],
    ['coordinatorAuthority'],
    'prepared schedule workflow admission store context',
  );
  const store = /** @type {Record<string, any>} */ (context);
  if (store.db !== metadata.db || store.tableName !== metadata.tableName) {
    throw new TypeError(
      'prepared schedule workflow admission belongs to another durable store.',
    );
  }
  const normalizedExpected = normalizeExpected(expected);
  if (!hasSameCanonicalJson(metadata.expected, normalizedExpected)) {
    throw new TypeError(
      'prepared schedule workflow admission expected identity changed.',
    );
  }
  const contextAuthority =
    store.coordinatorAuthority === undefined
      ? undefined
      : assertCoordinatorAuthorityToken(
          store.coordinatorAuthority,
          'prepared schedule workflow admission context.coordinatorAuthority',
        );
  if (
    (contextAuthority && contextAuthority.appId !== normalizedExpected.appId) ||
    (metadata.coordinatorAuthority &&
      (!contextAuthority ||
        !hasSameCanonicalJson(metadata.coordinatorAuthority, contextAuthority)))
  ) {
    throw new TypeError(
      'prepared schedule workflow admission coordinator authority must match its consuming execution ledger.',
    );
  }
  return { metadata, contextAuthority };
}

/**
 * Resolve private schedule-control transaction material for execution-ledger.
 * A bound admission requires the same stable token in its consuming ledger;
 * that ledger adds the single authority item check to the combined transaction.
 * @param {unknown} prepared - Opaque prepared admission.
 * @param {unknown} expected - Exact caller-owned workflow identity.
 * @param {{db: import('../base.js').DBClient, tableName: string, coordinatorAuthority?: import('./coordinator-authority.js').CoordinatorAuthorityToken | import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}} context - Exact execution-ledger store and authority binding.
 * @returns {Readonly<{mode: 'create'|'replay', coordinatorAuthority?: import('./coordinator-authority.js').CoordinatorAuthorityToken, conditionChecks: readonly import('../base.js').TransactionConditionCheck[], putRequests: readonly import('../base.js').TransactionPutRequest[]}>}
 */
export function resolvePreparedScheduleWorkflowAdmission(
  prepared,
  expected,
  context,
) {
  const { metadata, contextAuthority } = preparedMetadata(
    prepared,
    expected,
    context,
  );
  const occurrence =
    metadata.mode === 'create'
      ? occurrenceWithCoordinatorAuthority(
          metadata.occurrence,
          contextAuthority,
        )
      : metadata.occurrence;
  const occurrenceChanged = !hasSameCanonicalJson(
    occurrence.coordinatorAuthority ?? null,
    metadata.occurrence.coordinatorAuthority ?? null,
  );
  const putRequests =
    metadata.mode === 'create' && occurrenceChanged
      ? Object.freeze(
          metadata.putRequests.map(
            (/** @type {Record<string, any>} */ request) =>
              request.record?.record_kind === 'schedule-occurrence'
                ? deepFreeze({
                    ...request,
                    record: occurrenceRecord(occurrence),
                  })
                : request,
          ),
        )
      : metadata.putRequests;
  const retainedAuthority = occurrence.coordinatorAuthority;
  return Object.freeze({
    mode: metadata.mode,
    ...(retainedAuthority === undefined
      ? {}
      : { coordinatorAuthority: retainedAuthority }),
    conditionChecks: metadata.conditionChecks,
    putRequests,
  });
}

/**
 * Classify the durable result after an ambiguous execution-ledger response.
 * @param {unknown} prepared - Opaque prepared admission.
 * @param {unknown} expected - Exact caller-owned workflow identity.
 * @param {{db: import('../base.js').DBClient, tableName: string, coordinatorAuthority?: import('./coordinator-authority.js').CoordinatorAuthorityToken | import('./coordinator-authority.js').CoordinatorAuthoritySnapshot}} context - Exact execution-ledger store and authority binding.
 * @returns {Promise<Readonly<{status: 'absent'|'exact'|'conflict', occurrence?: Readonly<Record<string, any>>}>>}
 */
export async function reconcilePreparedScheduleWorkflowAdmission(
  prepared,
  expected,
  context,
) {
  const { metadata } = preparedMetadata(prepared, expected, context);
  const occurrence = await metadata.readOccurrence(
    metadata.expected.cause.occurrenceId,
  );
  if (!occurrence) return Object.freeze({ status: 'absent' });
  if (!sameOccurrenceRequest(occurrence, metadata.occurrence)) {
    return Object.freeze({ status: 'conflict' });
  }
  return Object.freeze({ status: 'exact', occurrence });
}

/**
 * Create the durable schedule cursor and occurrence-control kernel.
 * @param {{db: import('../base.js').DBClient, tableName: string, coordinatorAuthority?: import('./coordinator-authority.js').CoordinatorAuthorityToken | import('./coordinator-authority.js').CoordinatorAuthoritySnapshot, now?: () => number}} options - Store dependencies.
 */
export function createScheduleControl({
  db,
  tableName,
  coordinatorAuthority,
  now = () => Date.now(),
}) {
  if (
    !db ||
    typeof db.get !== 'function' ||
    typeof db.transactionWrite !== 'function'
  ) {
    throw new TypeError(
      'createScheduleControl requires a DB client with get and transactionWrite.',
    );
  }
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new TypeError('createScheduleControl requires a tableName.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('createScheduleControl now must be a function.');
  }
  const resolvedTableName = tableName.trim();
  const resolvedCoordinatorAuthority =
    coordinatorAuthority === undefined
      ? undefined
      : assertCoordinatorAuthorityToken(
          coordinatorAuthority,
          'createScheduleControl.coordinatorAuthority',
        );

  /** @param {string} appId */
  function assertCoordinatorAppScope(appId) {
    if (
      resolvedCoordinatorAuthority &&
      resolvedCoordinatorAuthority.appId !== appId
    ) {
      throw new TypeError(
        'Schedule control coordinator authority must bind the mutated appId.',
      );
    }
  }

  /**
   * Check the stable active authority tuple in the same transaction as every
   * cursor mutation, alongside the existing application and local-owner
   * fences. A diagnostic read before the transaction cannot provide fencing.
   * @param {import('../base.js').TransactionWriteParams} params
   * @param {string} appId
   */
  async function transactionWrite(params, appId) {
    assertCoordinatorAppScope(appId);
    const conditionChecks = [...(params.conditionChecks || [])];
    if (resolvedCoordinatorAuthority) {
      conditionChecks.push(
        createCoordinatorAuthorityFence(resolvedCoordinatorAuthority),
      );
    }
    await db.transactionWrite({
      ...params,
      ...(conditionChecks.length === 0 ? {} : { conditionChecks }),
    });
  }

  /**
   * Diagnose a failed conditional transaction only after callers preserve an
   * exact known result. Successful and write-free replays do not need a later
   * authority read that could hide their already accepted result.
   * @param {unknown} error
   */
  async function assertCurrentCoordinatorAuthorityAfterFailure(error) {
    if (!resolvedCoordinatorAuthority || !isConditionalCheckFailed(error)) {
      return;
    }
    await assertCoordinatorAuthorityCurrent({
      db,
      tableName: resolvedTableName,
      authority: resolvedCoordinatorAuthority,
    });
  }

  /** @param {string} appId @param {string} scheduleId */
  async function readCursor(appId, scheduleId) {
    const record = await db.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: cursorPartition(appId, scheduleId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: CURSOR_SORT_KEY,
      consistentRead: true,
    });
    return record ? cursorFromRecord(record, appId, scheduleId) : null;
  }

  /** @param {string} occurrenceId */
  async function readOccurrence(occurrenceId) {
    assertScheduleOccurrenceId(occurrenceId);
    const record = await db.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: occurrencePartition(occurrenceId),
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: OCCURRENCE_SORT_KEY,
      consistentRead: true,
    });
    return record ? occurrenceFromRecord(record) : null;
  }

  /** @param {{appId: string, scheduleId: string}} input */
  async function getCursor(input) {
    assertInputKeys(input, ['appId', 'scheduleId'], [], 'getCursor');
    assertLogicalId(input?.appId, 'getCursor.appId');
    assertLogicalId(input?.scheduleId, 'getCursor.scheduleId');
    return await readCursor(input.appId, input.scheduleId);
  }

  /**
   * Bind a schedule to one selected revision. Definition changes reset the
   * scan boundary; exact replay retains progress.
   * @param {{appId: string, scheduleId: string, revisionId: string, definitionId: string, owner: Readonly<Record<string, any>>, observedAt?: number}} input
   */
  async function activate(input) {
    assertInputKeys(
      input,
      ['appId', 'scheduleId', 'revisionId', 'definitionId', 'owner'],
      ['observedAt'],
      'activate',
    );
    const { appId, scheduleId, revisionId, definitionId } = input;
    assertLogicalId(appId, 'activate.appId');
    assertCoordinatorAppScope(appId);
    assertLogicalId(scheduleId, 'activate.scheduleId');
    assertApplicationRevisionId(revisionId, 'activate.revisionId');
    assertScheduleDefinitionId(definitionId, 'activate.definitionId');
    const owner = normalizeOwner(input.owner, appId);
    const observedAt = normalizeTimestamp(
      input.observedAt ?? now(),
      'activate.observedAt',
    );
    const current = await readCursor(appId, scheduleId);
    // Wall clocks can regress across NTP correction or process restart.
    // Existing cursor progress is authoritative; a changed definition starts
    // no earlier than its last durable observation.
    const effectiveObservedAt = current
      ? Math.max(observedAt, current.updatedAt)
      : observedAt;
    const sameDefinition =
      current?.revisionId === revisionId &&
      current.definitionId === definitionId;
    const next = sameDefinition
      ? current
      : normalizeCursor({
          appId,
          scheduleId,
          revisionId,
          definitionId,
          activationBoundary: floorScheduleMinute(effectiveObservedAt),
          horizon: floorScheduleMinute(effectiveObservedAt),
          version: current ? current.version + 1 : 1,
          updatedAt: effectiveObservedAt,
        });
    const admissionFence = await getLocalApplicationRunCreationFence({
      db,
      tableName: resolvedTableName,
      appId,
      revisionId,
    });
    try {
      if (sameDefinition) {
        await transactionWrite(
          {
            tableName: resolvedTableName,
            conditionChecks: [
              admissionFence,
              ownerFence(owner),
              cursorFence(current),
            ],
          },
          appId,
        );
        return Object.freeze({ applied: false, cursor: current });
      }
      await transactionWrite(
        {
          tableName: resolvedTableName,
          conditionChecks: [admissionFence, ownerFence(owner)],
          putRequests: [
            {
              keyName: KEY_NAME,
              sortKeyName: SORT_KEY_NAME,
              record: cursorRecord(next),
              conditions: current
                ? cursorFence(current).conditions
                : [notExists(SORT_KEY_NAME)],
            },
          ],
        },
        appId,
      );
    } catch (error) {
      await assertCurrentCoordinatorAuthorityAfterFailure(error);
      throw error;
    }
    return Object.freeze({ applied: true, cursor: next });
  }

  /**
   * CAS-advance a window that contained no due occurrence.
   * @param {{expectedCursor: Readonly<Record<string, any>>, throughInclusive: number, owner: Readonly<Record<string, any>>, observedAt?: number}} input
   */
  async function advance(input) {
    assertInputKeys(
      input,
      ['expectedCursor', 'throughInclusive', 'owner'],
      ['observedAt'],
      'advance',
    );
    const expected = normalizeCursor(input?.expectedCursor);
    assertCoordinatorAppScope(expected.appId);
    const throughInclusive = assertScheduleMinute(
      input?.throughInclusive,
      'advance.throughInclusive',
    );
    if (throughInclusive < expected.horizon) {
      throw new TypeError('advance.throughInclusive must not precede horizon.');
    }
    if (
      (throughInclusive - expected.horizon) / SCHEDULE_MINUTE_MS >
      SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES
    ) {
      throw new TypeError(
        'advance scan window exceeds the supported minute bound.',
      );
    }
    const owner = normalizeOwner(input.owner, expected.appId);
    const observedAt = normalizeTimestamp(
      input.observedAt ?? now(),
      'advance.observedAt',
    );
    if (observedAt < expected.updatedAt || observedAt < throughInclusive) {
      throw new TypeError(
        'advance.observedAt must not precede cursor updatedAt or throughInclusive.',
      );
    }
    const admissionFence = await getLocalApplicationRunCreationFence({
      db,
      tableName: resolvedTableName,
      appId: expected.appId,
      revisionId: expected.revisionId,
    });
    if (throughInclusive === expected.horizon) {
      try {
        await transactionWrite(
          {
            tableName: resolvedTableName,
            conditionChecks: [
              admissionFence,
              ownerFence(owner),
              cursorFence(expected),
            ],
          },
          expected.appId,
        );
      } catch (error) {
        await assertCurrentCoordinatorAuthorityAfterFailure(error);
        throw error;
      }
      return Object.freeze({ applied: false, cursor: expected });
    }
    const next = normalizeCursor({
      ...expected,
      horizon: throughInclusive,
      version: expected.version + 1,
      updatedAt: observedAt,
    });
    try {
      await transactionWrite(
        {
          tableName: resolvedTableName,
          conditionChecks: [admissionFence, ownerFence(owner)],
          putRequests: [
            {
              keyName: KEY_NAME,
              sortKeyName: SORT_KEY_NAME,
              record: cursorRecord(next),
              conditions: cursorFence(expected).conditions,
            },
          ],
        },
        expected.appId,
      );
    } catch (error) {
      const current = await readCursor(expected.appId, expected.scheduleId);
      if (
        resolvedCoordinatorAuthority &&
        current &&
        hasSameCanonicalJson(current, next)
      ) {
        // The exact requested cursor is already durable. Returning this
        // read-only result must not be hidden by a takeover after commit or
        // cause another transaction under the predecessor's stale token.
        return Object.freeze({ applied: false, cursor: current });
      }
      if (
        current &&
        current.revisionId === expected.revisionId &&
        current.definitionId === expected.definitionId &&
        current.activationBoundary === expected.activationBoundary &&
        current.horizon >= throughInclusive &&
        current.version > expected.version
      ) {
        await assertCurrentCoordinatorAuthorityAfterFailure(error);
        const currentAdmissionFence = await getLocalApplicationRunCreationFence(
          {
            db,
            tableName: resolvedTableName,
            appId: current.appId,
            revisionId: current.revisionId,
          },
        );
        try {
          await transactionWrite(
            {
              tableName: resolvedTableName,
              conditionChecks: [
                currentAdmissionFence,
                ownerFence(owner),
                cursorFence(current),
              ],
            },
            current.appId,
          );
        } catch (replayError) {
          await assertCurrentCoordinatorAuthorityAfterFailure(replayError);
          throw replayError;
        }
        return Object.freeze({ applied: false, cursor: current });
      }
      await assertCurrentCoordinatorAuthorityAfterFailure(error);
      throw error;
    }
    return Object.freeze({ applied: true, cursor: next });
  }

  /**
   * Prepare the schedule rows that execution-ledger will append atomically with
   * a new workflow run.
   * @param {{expectedCursor: Readonly<Record<string, any>>, scheduledAt: number, throughInclusive: number, skipped: null | {count: number, firstScheduledAtMs: number, lastScheduledAtMs: number}, workflowId: string, planId: string, runId: string, cause: unknown, owner: Readonly<Record<string, any>>, observedAt?: number}} input
   */
  async function prepareWorkflowAdmission(input) {
    assertInputKeys(
      input,
      [
        'expectedCursor',
        'scheduledAt',
        'throughInclusive',
        'skipped',
        'workflowId',
        'planId',
        'runId',
        'cause',
        'owner',
      ],
      ['observedAt'],
      'prepareWorkflowAdmission',
    );
    const cursor = normalizeCursor(input?.expectedCursor);
    assertCoordinatorAppScope(cursor.appId);
    assertLogicalId(input?.workflowId, 'prepareWorkflowAdmission.workflowId');
    assertWorkflowPlanId(input?.planId, 'prepareWorkflowAdmission.planId');
    assertWorkflowRunId(input?.runId, 'prepareWorkflowAdmission.runId');
    const cause = normalizeScheduleRunCause(input?.cause, {
      appId: cursor.appId,
      label: 'prepareWorkflowAdmission.cause',
    });
    const scheduledAt = assertScheduleMinute(
      input?.scheduledAt,
      'prepareWorkflowAdmission.scheduledAt',
    );
    const throughInclusive = assertScheduleMinute(
      input?.throughInclusive,
      'prepareWorkflowAdmission.throughInclusive',
    );
    if (
      cause.scheduleId !== cursor.scheduleId ||
      cause.definitionId !== cursor.definitionId ||
      cause.scheduledAt !== scheduledAt ||
      scheduledAt <= cursor.horizon ||
      scheduledAt > throughInclusive
    ) {
      throw new TypeError(
        'prepared schedule occurrence does not match its cursor or evaluated window.',
      );
    }
    const scannedMinuteCount =
      (throughInclusive - cursor.horizon) / SCHEDULE_MINUTE_MS;
    if (
      !Number.isSafeInteger(scannedMinuteCount) ||
      scannedMinuteCount < 1 ||
      scannedMinuteCount > SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES
    ) {
      throw new TypeError(
        'prepared schedule occurrence scan window is outside the supported bound.',
      );
    }
    const skipped = normalizeSkipped(
      input.skipped,
      cursor.horizon,
      scheduledAt,
      scannedMinuteCount,
    );
    const owner = normalizeOwner(input.owner, cursor.appId);
    const observedAt = normalizeTimestamp(
      input.observedAt ?? now(),
      'prepareWorkflowAdmission.observedAt',
    );
    if (observedAt < cursor.updatedAt || observedAt < throughInclusive) {
      throw new TypeError(
        'prepareWorkflowAdmission.observedAt must not precede cursor updatedAt or throughInclusive.',
      );
    }
    const expected = normalizeExpected({
      appId: cursor.appId,
      revisionId: cursor.revisionId,
      scheduleId: cursor.scheduleId,
      definitionId: cursor.definitionId,
      workflowId: input.workflowId,
      planId: input.planId,
      runId: input.runId,
      cause,
    });
    let occurrence = Object.freeze({
      ...expected,
      occurrenceId: cause.occurrenceId,
      scheduledAt,
      windowAfterExclusive: cursor.horizon,
      throughInclusive,
      scannedMinuteCount,
      skipped,
      createdAt: observedAt,
      ...(resolvedCoordinatorAuthority === undefined
        ? {}
        : { coordinatorAuthority: resolvedCoordinatorAuthority }),
    });
    const current = await readOccurrence(cause.occurrenceId);
    let mode;
    let conditionChecks;
    let putRequests;
    if (current) {
      if (!sameOccurrenceRequest(current, occurrence)) {
        throw new Error(
          `Schedule occurrence conflicts with durable state: ${cause.occurrenceId}`,
        );
      }
      mode = /** @type {'replay'} */ ('replay');
      conditionChecks = Object.freeze([]);
      putRequests = Object.freeze([]);
      occurrence = current;
    } else {
      mode = /** @type {'create'} */ ('create');
      const nextCursor = normalizeCursor({
        ...cursor,
        horizon: throughInclusive,
        version: cursor.version + 1,
        updatedAt: observedAt,
      });
      conditionChecks = Object.freeze([ownerFence(owner)]);
      putRequests = Object.freeze([
        deepFreeze({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record: cursorRecord(nextCursor),
          conditions: cursorFence(cursor).conditions,
        }),
        deepFreeze({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record: occurrenceRecord(occurrence),
          conditions: [notExists(SORT_KEY_NAME)],
        }),
      ]);
    }
    const prepared = Object.freeze({ mode, occurrence });
    PREPARED_ADMISSIONS.set(prepared, {
      db,
      tableName: resolvedTableName,
      coordinatorAuthority: resolvedCoordinatorAuthority,
      mode,
      expected,
      occurrence,
      conditionChecks,
      putRequests,
      readOccurrence,
    });
    return prepared;
  }

  /** @param {{occurrenceId: string}} input */
  async function getOccurrence(input) {
    assertInputKeys(input, ['occurrenceId'], [], 'getOccurrence');
    assertScheduleOccurrenceId(
      input?.occurrenceId,
      'getOccurrence.occurrenceId',
    );
    return await readOccurrence(input.occurrenceId);
  }

  return Object.freeze({
    getCursor,
    activate,
    advance,
    prepareWorkflowAdmission,
    getOccurrence,
  });
}

export default {
  createScheduleControl,
  reconcilePreparedScheduleWorkflowAdmission,
  resolvePreparedScheduleWorkflowAdmission,
};
