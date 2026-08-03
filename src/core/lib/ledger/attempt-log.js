import {
  ACTIVITY_PROTOCOL_LOG_LEVELS,
  ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES,
} from '../../runtime/activity-protocol.js';
import { assertApplicationRevisionId } from '../../runtime/application-revision.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../../runtime/content-id.js';
import { cloneBoundedJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import {
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_SCHEMA_VERSION,
  assertExactKeys,
  assertNonnegativeSafeInteger,
  assertPositiveSafeInteger,
  deepFreezeJson,
  normalizePayloadReference,
} from './execution-ledger-contract.js';
import {
  EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH,
  assertLedgerOpaqueId,
  encodeLedgerSequence,
} from './record-key.js';

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const FULL_SCOPE_KEYS = [
  'appId',
  'revisionId',
  'activityId',
  'runId',
  'invocationId',
  'attemptId',
  'generation',
  'coordinatorEpoch',
  'fencingToken',
];
const ENTRY_INPUT_KEYS = [
  'scope',
  'sequence',
  'level',
  'payloadRef',
  'canonicalPayloadBytes',
  'acceptedAt',
  'previousEntryId',
];
const COMMON_STORAGE_KEYS = [
  KEY_NAME,
  SORT_KEY_NAME,
  'record_type',
  'schema_version',
  'ledger_schema_version',
  'app_id',
  'revision_id',
  'activity_id',
  'ledger_run_id',
  'invocation_id',
  'attempt_id',
  'generation',
  'coordinator_epoch',
  'disclosure',
];
const ENTRY_STORAGE_KEYS = [
  ...COMMON_STORAGE_KEYS,
  'protocol_sequence',
  'level',
  'payload_ref',
  'canonical_payload_bytes',
  'accepted_at',
  'previous_entry_id',
  'entry_id',
];
const HEAD_STORAGE_KEYS = [
  ...COMMON_STORAGE_KEYS,
  'last_protocol_sequence',
  'last_entry_id',
  'entry_count',
  'cumulative_payload_bytes',
  'version',
];
const LOG_LEVELS = new Set(ACTIVITY_PROTOCOL_LOG_LEVELS);

export const EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION = 1;
export const EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA =
  'wharfie.execution.attempt-log-frame.v1';
export const EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE =
  'execution_ledger_attempt_log_head';
export const EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE =
  'execution_ledger_attempt_log_entry';
export const EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_DOMAIN =
  'wharfie:execution-ledger-attempt-log-partition:v1';
export const EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_PREFIX = 'wlg';
export const EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_DOMAIN =
  'wharfie:execution-ledger-attempt-log-entry:v1';
export const EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX = 'wge';
export const EXECUTION_LEDGER_ATTEMPT_LOG_SORT_KEY_PREFIX =
  'ledger-attempt-log/v1/';
export const EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY = `${EXECUTION_LEDGER_ATTEMPT_LOG_SORT_KEY_PREFIX}head`;
export const EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX = `${EXECUTION_LEDGER_ATTEMPT_LOG_SORT_KEY_PREFIX}entry/`;
export const EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE =
  'application-sensitive-unredacted';
export const EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES = 256;
export const EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES =
  8 * 1024 * 1024;
export const EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES =
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES;

/**
 * @typedef {object} FullAttemptLogScope
 * @property {string} appId - Application identity.
 * @property {string} revisionId - Immutable revision identity.
 * @property {string} activityId - Activity identity.
 * @property {string} runId - Logical run identity.
 * @property {string} invocationId - Logical invocation identity.
 * @property {string} attemptId - Physical attempt identity.
 * @property {number} generation - Attempt generation.
 * @property {number} coordinatorEpoch - Coordinator epoch.
 * @property {string} fencingToken - Private attempt fence.
 */

/**
 * @typedef {object} AttemptLogScope
 * @property {string} attemptLogId - Derived physical partition identity.
 * @property {string} appId - Application identity.
 * @property {string} revisionId - Immutable revision identity.
 * @property {string} activityId - Activity identity.
 * @property {string} runId - Logical run identity.
 * @property {string} invocationId - Logical invocation identity.
 * @property {string} attemptId - Physical attempt identity.
 * @property {number} generation - Attempt generation.
 * @property {number} coordinatorEpoch - Coordinator epoch.
 */

/**
 * Strictly clone and validate the complete private derivation scope.
 * This value is never returned or copied into an auxiliary record.
 * @param {unknown} input - Candidate complete scope.
 * @param {string} label - Human-readable boundary label.
 * @returns {FullAttemptLogScope} - Independently cloned private scope.
 */
function normalizeFullScope(input, label) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES,
    label,
  );
  assertExactKeys(value, FULL_SCOPE_KEYS, label);
  assertLogicalId(value.appId, `${label}.appId`);
  assertApplicationRevisionId(value.revisionId, `${label}.revisionId`);
  assertLogicalId(value.activityId, `${label}.activityId`);
  const runId = assertLedgerOpaqueId(value.runId, `${label}.runId`);
  const invocationId = assertLedgerOpaqueId(
    value.invocationId,
    `${label}.invocationId`,
  );
  const attemptId = assertLedgerOpaqueId(value.attemptId, `${label}.attemptId`);
  const generation = assertPositiveSafeInteger(
    value.generation,
    `${label}.generation`,
  );
  const coordinatorEpoch = assertNonnegativeSafeInteger(
    value.coordinatorEpoch,
    `${label}.coordinatorEpoch`,
  );
  const fencingToken = assertLedgerOpaqueId(
    value.fencingToken,
    `${label}.fencingToken`,
  );
  return {
    appId: value.appId,
    revisionId: value.revisionId,
    activityId: value.activityId,
    runId,
    invocationId,
    attemptId,
    generation,
    coordinatorEpoch,
    fencingToken,
  };
}

/**
 * Derive and expose only the non-secret auxiliary partition scope.
 * The partition ID binds the raw fencing token, but the returned value does
 * not retain it.
 * @param {FullAttemptLogScope} fullScope - Validated complete private scope.
 * @returns {Readonly<AttemptLogScope>} - Frozen non-secret scope.
 */
function createPublicScope(fullScope) {
  const attemptLogId = createCanonicalJsonSha256Id({
    domain: EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_DOMAIN,
    prefix: EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_PREFIX,
    value: {
      schemaVersion: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
      ledgerSchemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      appId: fullScope.appId,
      revisionId: fullScope.revisionId,
      activityId: fullScope.activityId,
      runId: fullScope.runId,
      invocationId: fullScope.invocationId,
      attemptId: fullScope.attemptId,
      generation: fullScope.generation,
      coordinatorEpoch: fullScope.coordinatorEpoch,
      fencingToken: fullScope.fencingToken,
    },
    valuePath: 'execution ledger attempt-log partition',
  });
  return deepFreezeJson({
    attemptLogId,
    appId: fullScope.appId,
    revisionId: fullScope.revisionId,
    activityId: fullScope.activityId,
    runId: fullScope.runId,
    invocationId: fullScope.invocationId,
    attemptId: fullScope.attemptId,
    generation: fullScope.generation,
    coordinatorEpoch: fullScope.coordinatorEpoch,
  });
}

/**
 * Derive the exact auxiliary partition for one fenced physical attempt.
 * @param {FullAttemptLogScope} input - Complete private attempt scope.
 * @returns {Readonly<AttemptLogScope>} - Frozen non-secret partition scope.
 */
export function createExecutionLedgerAttemptLogScope(input) {
  return createPublicScope(normalizeFullScope(input, 'attempt-log scope'));
}

/**
 * @returns {string} - Singular attempt-log head sort key.
 */
export function getExecutionLedgerAttemptLogHeadSortKey() {
  return EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY;
}

/**
 * @param {number} sequence - Activity Protocol component sequence.
 * @returns {string} - Lexically ordered immutable entry sort key.
 */
export function getExecutionLedgerAttemptLogEntrySortKey(sequence) {
  return `${EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX}${encodeLedgerSequence(
    sequence,
  )}`;
}

/**
 * Decode only the exact sequence-key representation emitted by this module.
 * @param {unknown} value - Candidate entry sort key.
 * @param {string} [label] - Human-readable boundary label.
 * @returns {number} - Positive Activity Protocol component sequence.
 */
export function parseExecutionLedgerAttemptLogEntrySortKey(
  value,
  label = 'attempt-log entry sort key',
) {
  if (
    typeof value !== 'string' ||
    !value.startsWith(EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX)
  ) {
    throw new TypeError(
      `${label} must begin with the attempt-log entry sort-key prefix.`,
    );
  }
  const encoded = value.slice(
    EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX.length,
  );
  if (
    encoded.length !== EXECUTION_LEDGER_EVENT_SEQUENCE_WIDTH ||
    !/^\d+$/.test(encoded)
  ) {
    throw new TypeError(`${label} must contain one fixed-width sequence.`);
  }
  const sequence = assertPositiveSafeInteger(
    Number(encoded),
    `${label}.sequence`,
  );
  if (getExecutionLedgerAttemptLogEntrySortKey(sequence) !== value) {
    throw new TypeError(`${label} is not canonically encoded.`);
  }
  return sequence;
}

/**
 * @param {AttemptLogScope} scope - Non-secret partition scope.
 * @returns {Record<string, string|number>} - Canonical common storage fields.
 */
function createStorageScopeFields(scope) {
  return {
    [KEY_NAME]: scope.attemptLogId,
    app_id: scope.appId,
    revision_id: scope.revisionId,
    activity_id: scope.activityId,
    ledger_run_id: scope.runId,
    invocation_id: scope.invocationId,
    attempt_id: scope.attemptId,
    generation: scope.generation,
    coordinator_epoch: scope.coordinatorEpoch,
    disclosure: EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
  };
}

/**
 * @param {Record<string, any>} record - Candidate auxiliary row.
 * @param {AttemptLogScope} scope - Exact derived expected scope.
 * @param {string} label - Human-readable boundary label.
 * @returns {void} - Throws unless every retained scope field agrees.
 */
function assertStorageScope(record, scope, label) {
  const expected = createStorageScopeFields(scope);
  if (
    Object.entries(expected).some(
      ([property, value]) => record[property] !== value,
    )
  ) {
    throw new TypeError(`${label} does not match its expected attempt scope.`);
  }
}

/**
 * @param {unknown} value - Candidate Activity Protocol log level.
 * @param {string} label - Human-readable boundary label.
 * @returns {string} - Supported log level.
 */
function normalizeLogLevel(value, label) {
  if (typeof value !== 'string' || !LOG_LEVELS.has(value)) {
    throw new TypeError(`${label} is not a supported activity log level.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate prior entry identity.
 * @param {string} label - Human-readable boundary label.
 * @returns {string|null} - Canonical prior entry identity or first-entry null.
 */
function normalizePreviousEntryId(value, label) {
  if (value === null) return null;
  assertDomainSeparatedSha256Id(
    value,
    EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX,
    label,
  );
  return /** @type {string} */ (value);
}

/**
 * @param {number} value - Candidate canonical payload byte count.
 * @param {Readonly<import('../../runtime/execution-payload.js').ExecutionPayloadReference>} payloadRef - Exact payload reference.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Exact bounded canonical frame byte count.
 */
function normalizeCanonicalPayloadBytes(value, payloadRef, label) {
  const bytes = assertPositiveSafeInteger(value, label);
  if (bytes !== payloadRef.size) {
    throw new TypeError(`${label} must equal payloadRef.size.`);
  }
  if (bytes > ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES) {
    throw new RangeError(
      `${label} must not exceed the Activity Protocol frame limit of ${ACTIVITY_PROTOCOL_MAX_ENCODED_FRAME_BYTES} bytes.`,
    );
  }
  return bytes;
}

/**
 * Derive the hash-chain identity for an otherwise complete immutable entry.
 * @param {Record<string, any>} record - Canonical entry without entry_id.
 * @returns {string} - Domain-separated entry identity.
 */
function deriveEntryId(record) {
  return createCanonicalJsonSha256Id({
    domain: EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_DOMAIN,
    prefix: EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX,
    value: record,
    valuePath: 'execution ledger attempt-log entry',
  });
}

/**
 * Strictly validate and canonicalize one entry against a prevalidated private
 * scope. Stored bytes are verified by the execution-ledger payload reader;
 * this boundary validates the exact reference schema and byte descriptor.
 * @param {unknown} raw - Candidate immutable entry row.
 * @param {FullAttemptLogScope} fullScope - Complete private expected scope.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical entry.
 */
function normalizeEntryRecord(raw, fullScope) {
  const scope = createPublicScope(fullScope);
  const record = cloneBoundedJsonObject(
    raw,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES,
    'attempt-log entry record',
  );
  assertExactKeys(record, ENTRY_STORAGE_KEYS, 'attempt-log entry record');
  assertStorageScope(record, scope, 'attempt-log entry record');
  if (
    record.record_type !== EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE ||
    record.schema_version !== EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION ||
    record.ledger_schema_version !== EXECUTION_LEDGER_SCHEMA_VERSION
  ) {
    throw new TypeError('attempt-log entry record has an invalid schema.');
  }
  const sequence = assertPositiveSafeInteger(
    record.protocol_sequence,
    'attempt-log entry record.protocol_sequence',
  );
  if (
    record[SORT_KEY_NAME] !== getExecutionLedgerAttemptLogEntrySortKey(sequence)
  ) {
    throw new TypeError(
      'attempt-log entry record sort key does not match its protocol sequence.',
    );
  }
  const level = normalizeLogLevel(
    record.level,
    'attempt-log entry record.level',
  );
  const payloadRef = normalizePayloadReference(
    record.payload_ref,
    EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
    'attempt-log entry record.payload_ref',
  );
  const canonicalPayloadBytes = normalizeCanonicalPayloadBytes(
    record.canonical_payload_bytes,
    payloadRef,
    'attempt-log entry record.canonical_payload_bytes',
  );
  const acceptedAt = assertNonnegativeSafeInteger(
    record.accepted_at,
    'attempt-log entry record.accepted_at',
  );
  const previousEntryId = normalizePreviousEntryId(
    record.previous_entry_id,
    'attempt-log entry record.previous_entry_id',
  );
  assertDomainSeparatedSha256Id(
    record.entry_id,
    EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX,
    'attempt-log entry record.entry_id',
  );
  const canonicalWithoutId = {
    [KEY_NAME]: scope.attemptLogId,
    [SORT_KEY_NAME]: getExecutionLedgerAttemptLogEntrySortKey(sequence),
    record_type: EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE,
    schema_version: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
    ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    ...createStorageScopeFields(scope),
    protocol_sequence: sequence,
    level,
    payload_ref: payloadRef,
    canonical_payload_bytes: canonicalPayloadBytes,
    accepted_at: acceptedAt,
    previous_entry_id: previousEntryId,
  };
  const entryId = deriveEntryId(canonicalWithoutId);
  if (record.entry_id !== entryId) {
    throw new TypeError(
      'attempt-log entry record entry ID does not match its canonical fields.',
    );
  }
  return deepFreezeJson({ ...canonicalWithoutId, entry_id: entryId });
}

/**
 * Construct one immutable hash-linked log entry from an already verified
 * payload reference.
 * @param {{scope: FullAttemptLogScope, sequence: number, level: string, payloadRef: unknown, canonicalPayloadBytes: number, acceptedAt: number, previousEntryId: string|null}} input - Exact entry inputs.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical entry row.
 */
export function createExecutionLedgerAttemptLogEntryRecord(input) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES,
    'attempt-log entry input',
  );
  assertExactKeys(value, ENTRY_INPUT_KEYS, 'attempt-log entry input');
  const fullScope = normalizeFullScope(
    value.scope,
    'attempt-log entry input.scope',
  );
  const scope = createPublicScope(fullScope);
  const sequence = assertPositiveSafeInteger(
    value.sequence,
    'attempt-log entry input.sequence',
  );
  const level = normalizeLogLevel(value.level, 'attempt-log entry input.level');
  const payloadRef = normalizePayloadReference(
    value.payloadRef,
    EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
    'attempt-log entry input.payloadRef',
  );
  const canonicalPayloadBytes = normalizeCanonicalPayloadBytes(
    value.canonicalPayloadBytes,
    payloadRef,
    'attempt-log entry input.canonicalPayloadBytes',
  );
  const acceptedAt = assertNonnegativeSafeInteger(
    value.acceptedAt,
    'attempt-log entry input.acceptedAt',
  );
  const previousEntryId = normalizePreviousEntryId(
    value.previousEntryId,
    'attempt-log entry input.previousEntryId',
  );
  const record = {
    [KEY_NAME]: scope.attemptLogId,
    [SORT_KEY_NAME]: getExecutionLedgerAttemptLogEntrySortKey(sequence),
    record_type: EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE,
    schema_version: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
    ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    ...createStorageScopeFields(scope),
    protocol_sequence: sequence,
    level,
    payload_ref: payloadRef,
    canonical_payload_bytes: canonicalPayloadBytes,
    accepted_at: acceptedAt,
    previous_entry_id: previousEntryId,
  };
  return normalizeEntryRecord(
    { ...record, entry_id: deriveEntryId(record) },
    fullScope,
  );
}

/**
 * Strictly validate an untrusted immutable entry row against the complete
 * private scope used to derive its partition.
 * @param {unknown} raw - Candidate entry row.
 * @param {FullAttemptLogScope} expectedScope - Complete private expected scope.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical entry row.
 */
export function normalizeExecutionLedgerAttemptLogEntryRecord(
  raw,
  expectedScope,
) {
  return normalizeEntryRecord(
    raw,
    normalizeFullScope(expectedScope, 'attempt-log expected scope'),
  );
}

/**
 * Strictly validate and canonicalize one head against a prevalidated private
 * scope.
 * @param {unknown} raw - Candidate mutable head row.
 * @param {FullAttemptLogScope} fullScope - Complete private expected scope.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical head.
 */
function normalizeHeadRecord(raw, fullScope) {
  const scope = createPublicScope(fullScope);
  const record = cloneBoundedJsonObject(
    raw,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES,
    'attempt-log head record',
  );
  assertExactKeys(record, HEAD_STORAGE_KEYS, 'attempt-log head record');
  assertStorageScope(record, scope, 'attempt-log head record');
  if (
    record[SORT_KEY_NAME] !== EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY ||
    record.record_type !== EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE ||
    record.schema_version !== EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION ||
    record.ledger_schema_version !== EXECUTION_LEDGER_SCHEMA_VERSION
  ) {
    throw new TypeError(
      'attempt-log head record has an invalid schema or key.',
    );
  }
  const lastProtocolSequence = assertPositiveSafeInteger(
    record.last_protocol_sequence,
    'attempt-log head record.last_protocol_sequence',
  );
  assertDomainSeparatedSha256Id(
    record.last_entry_id,
    EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX,
    'attempt-log head record.last_entry_id',
  );
  const entryCount = assertPositiveSafeInteger(
    record.entry_count,
    'attempt-log head record.entry_count',
  );
  if (entryCount > EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES) {
    throw new RangeError(
      `attempt-log head record.entry_count must not exceed ${EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES}.`,
    );
  }
  if (lastProtocolSequence < entryCount) {
    throw new TypeError(
      'attempt-log head record.last_protocol_sequence cannot precede its entry count.',
    );
  }
  const cumulativePayloadBytes = assertPositiveSafeInteger(
    record.cumulative_payload_bytes,
    'attempt-log head record.cumulative_payload_bytes',
  );
  if (
    cumulativePayloadBytes >
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES
  ) {
    throw new RangeError(
      `attempt-log head record.cumulative_payload_bytes must not exceed ${EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES}.`,
    );
  }
  const version = assertPositiveSafeInteger(
    record.version,
    'attempt-log head record.version',
  );
  if (version !== entryCount) {
    throw new TypeError(
      'attempt-log head record.version must equal its entry count.',
    );
  }
  return deepFreezeJson({
    [KEY_NAME]: scope.attemptLogId,
    [SORT_KEY_NAME]: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
    record_type: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
    schema_version: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
    ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    ...createStorageScopeFields(scope),
    last_protocol_sequence: lastProtocolSequence,
    last_entry_id: record.last_entry_id,
    entry_count: entryCount,
    cumulative_payload_bytes: cumulativePayloadBytes,
    version,
  });
}

/**
 * Create the first head in the same transaction as a first immutable entry.
 * The first Activity Protocol sequence may be greater than one because non-log
 * component frames share its sequence space.
 * @param {{scope: FullAttemptLogScope, entry: unknown}} input - Exact first-head inputs.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical first head.
 */
export function createInitialExecutionLedgerAttemptLogHeadRecord(input) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES,
    'initial attempt-log head input',
  );
  assertExactKeys(value, ['scope', 'entry'], 'initial attempt-log head input');
  const fullScope = normalizeFullScope(
    value.scope,
    'initial attempt-log head input.scope',
  );
  const scope = createPublicScope(fullScope);
  const entry = normalizeEntryRecord(value.entry, fullScope);
  if (entry.previous_entry_id !== null) {
    throw new TypeError(
      'initial attempt-log entry.previous_entry_id must be null.',
    );
  }
  return normalizeHeadRecord(
    {
      [KEY_NAME]: scope.attemptLogId,
      [SORT_KEY_NAME]: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
      record_type: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
      schema_version: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
      ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
      ...createStorageScopeFields(scope),
      last_protocol_sequence: entry.protocol_sequence,
      last_entry_id: entry.entry_id,
      entry_count: 1,
      cumulative_payload_bytes: entry.canonical_payload_bytes,
      version: 1,
    },
    fullScope,
  );
}

/**
 * Exactly advance a retained head through one later hash-linked entry.
 * Sequences must increase but need not be contiguous.
 * @param {{scope: FullAttemptLogScope, previousHead: unknown, entry: unknown}} input - Exact head-advance inputs.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical next head.
 */
export function advanceExecutionLedgerAttemptLogHeadRecord(input) {
  const value = cloneBoundedJsonObject(
    input,
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES * 2,
    'attempt-log head advance input',
  );
  assertExactKeys(
    value,
    ['scope', 'previousHead', 'entry'],
    'attempt-log head advance input',
  );
  const fullScope = normalizeFullScope(
    value.scope,
    'attempt-log head advance input.scope',
  );
  const scope = createPublicScope(fullScope);
  const previousHead = normalizeHeadRecord(value.previousHead, fullScope);
  const entry = normalizeEntryRecord(value.entry, fullScope);
  if (entry.previous_entry_id !== previousHead.last_entry_id) {
    throw new TypeError(
      'attempt-log entry does not link to the previous head entry.',
    );
  }
  if (entry.protocol_sequence <= previousHead.last_protocol_sequence) {
    throw new TypeError(
      'attempt-log entry protocol sequence must increase beyond the previous head.',
    );
  }
  const entryCount = previousHead.entry_count + 1;
  if (entryCount > EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES) {
    throw new RangeError(
      `attempt-log append exceeds the ${EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES}-entry limit.`,
    );
  }
  const cumulativePayloadBytes =
    previousHead.cumulative_payload_bytes + entry.canonical_payload_bytes;
  if (
    cumulativePayloadBytes >
    EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES
  ) {
    throw new RangeError(
      `attempt-log append exceeds the ${EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES}-byte cumulative payload limit.`,
    );
  }
  return normalizeHeadRecord(
    {
      [KEY_NAME]: scope.attemptLogId,
      [SORT_KEY_NAME]: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
      record_type: EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
      schema_version: EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
      ledger_schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
      ...createStorageScopeFields(scope),
      last_protocol_sequence: entry.protocol_sequence,
      last_entry_id: entry.entry_id,
      entry_count: entryCount,
      cumulative_payload_bytes: cumulativePayloadBytes,
      version: previousHead.version + 1,
    },
    fullScope,
  );
}

/**
 * Strictly validate an untrusted head against the complete private scope used
 * to derive its partition.
 * @param {unknown} raw - Candidate head row.
 * @param {FullAttemptLogScope} expectedScope - Complete private expected scope.
 * @returns {Readonly<Record<string, any>>} - Frozen canonical head row.
 */
export function normalizeExecutionLedgerAttemptLogHeadRecord(
  raw,
  expectedScope,
) {
  return normalizeHeadRecord(
    raw,
    normalizeFullScope(expectedScope, 'attempt-log expected scope'),
  );
}

export default {
  EXECUTION_LEDGER_ATTEMPT_LOG_DISCLOSURE,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_DOMAIN,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_ID_PREFIX,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_RECORD_TYPE,
  EXECUTION_LEDGER_ATTEMPT_LOG_ENTRY_SORT_KEY_PREFIX,
  EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_RECORD_TYPE,
  EXECUTION_LEDGER_ATTEMPT_LOG_HEAD_SORT_KEY,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_CUMULATIVE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_ENTRIES,
  EXECUTION_LEDGER_ATTEMPT_LOG_MAX_RECORD_BYTES,
  EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_DOMAIN,
  EXECUTION_LEDGER_ATTEMPT_LOG_PARTITION_PREFIX,
  EXECUTION_LEDGER_ATTEMPT_LOG_PAYLOAD_SCHEMA,
  EXECUTION_LEDGER_ATTEMPT_LOG_SCHEMA_VERSION,
  EXECUTION_LEDGER_ATTEMPT_LOG_SORT_KEY_PREFIX,
  advanceExecutionLedgerAttemptLogHeadRecord,
  createExecutionLedgerAttemptLogEntryRecord,
  createExecutionLedgerAttemptLogScope,
  createInitialExecutionLedgerAttemptLogHeadRecord,
  getExecutionLedgerAttemptLogEntrySortKey,
  getExecutionLedgerAttemptLogHeadSortKey,
  normalizeExecutionLedgerAttemptLogEntryRecord,
  normalizeExecutionLedgerAttemptLogHeadRecord,
  parseExecutionLedgerAttemptLogEntrySortKey,
};
