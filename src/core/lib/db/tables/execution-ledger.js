import { assertApplicationRevisionId } from '../../../runtime/application-revision.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_TERMINAL_TYPES,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
  validateActivityProtocolComponentFrame,
  validateActivityProtocolHostFrame,
} from '../../../runtime/activity-protocol.js';
import { createCanonicalJsonSha256Id } from '../../../runtime/content-id.js';
import {
  EXECUTION_PAYLOAD_MAX_BYTES,
  validateExecutionPayloadReference,
  verifyExecutionPayloadReference,
} from '../../../runtime/execution-payload.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
  cloneJsonObject,
} from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import {
  EXECUTION_LEDGER_SORT_KEY_PREFIX,
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES,
  assertLedgerOpaqueId,
  getAttemptProjectionSortKey,
  getEventSortKey,
  getInvocationProjectionSortKey,
  getRunHeadSortKey,
  getRunProjectionSortKey,
  getTransitionSortKey,
} from '../../ledger/record-key.js';
import {
  EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX,
  createExecutionLedgerRunDirectoryScope,
  getExecutionLedgerRunDirectorySortKey,
  parseExecutionLedgerRunDirectorySortKey,
} from '../../ledger/run-directory.js';
import { CONDITION_TYPE, KEY_TYPE } from '../base.js';
import { comparePortablePageKeys } from '../utils.js';

/**
 * The first ledger schema deliberately covers one manual, single-activity
 * invocation. It is a separate append-only boundary, not an extension of the
 * mutable Operation/Action snapshot store. Its table write authority is a
 * trusted control-plane boundary: content IDs and request digests detect
 * inconsistent records, but are not signatures against a writer that can
 * replace an entire semantically valid history.
 */
// V3 intentionally does not read v1/v2 records. V2 lacked the atomic
// per-service run-history directory required for a safe paginated history
// surface, so it has a fresh schema/table namespace instead of a partial
// backfill or mixed-record migration.
export const EXECUTION_LEDGER_SCHEMA_VERSION = 3;
export const EXECUTION_LEDGER_MAX_OPAQUE_ID_BYTES =
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES;
export const EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES = 64 * 1024;
export const EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES =
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES * 4;
// Referenced payloads are intentionally much larger than table records, but
// still bounded before they enter a durable local process. Keep the ledger
// alias for its public API while the payload reference is the single source
// of truth for the limit.
export const EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES =
  EXECUTION_PAYLOAD_MAX_BYTES;
// Bound transcript replay independently of its byte cap. Without this, a
// caller can make validation work scale with a large number of tiny frames.
export const EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES = 512;

export const RunStatus = Object.freeze({
  RUNNING: 'RUNNING',
  BLOCKED: 'BLOCKED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const InvocationStatus = Object.freeze({
  RUNNABLE: 'RUNNABLE',
  RUNNING: 'RUNNING',
  UNCERTAIN: 'UNCERTAIN',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

export const AttemptStatus = Object.freeze({
  CLAIMED: 'CLAIMED',
  STARTED: 'STARTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  ABANDONED: 'ABANDONED',
});

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const RUN_DIRECTORY_RECORD_TYPE = 'execution_ledger_run_directory';
const RUN_DIRECTORY_RUN_KIND = 'manual';
const RUN_DIRECTORY_CURSOR_SCHEMA_VERSION = 1;
const RUN_DIRECTORY_DEFAULT_PAGE_SIZE = 50;
const RUN_DIRECTORY_MAX_PAGE_SIZE = 100;
const RUN_DIRECTORY_MAX_PAGE_RETRIES = 3;
const EVENT_TYPES = new Set([
  'manual-run-created',
  'attempt-claimed',
  'attempt-started',
  'attempt-terminal',
  'attempt-abandoned-before-start',
  'attempt-became-uncertain',
]);
const TERMINAL_TYPES = new Set(ACTIVITY_PROTOCOL_TERMINAL_TYPES);
// The first vertical has no durable cancellation request or deadline decision.
// Do not let a valid physical `cancelled` transcript become a logical outcome
// until the corresponding ledger transition exists.
const SUPPORTED_MANUAL_TERMINAL_TYPES = new Set([
  'completed',
  'failed',
  'protocol-failed',
]);
const MANUAL_REQUEST_PAYLOAD_SCHEMA = 'wharfie.execution.manual-request.v1';
const ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA =
  'wharfie.execution.activity-evidence.v1';
/**
 * @typedef {import('../base.js').DBClient} DBClient
 */

/** Error raised when a caller reuses an immutable run identity for new work. */
export class ExecutionLedgerRunConflictError extends Error {
  /** @param {string} runId - Durable run identity. */
  constructor(runId) {
    super(`Execution ledger run conflicts with existing work: ${runId}`);
    this.name = 'ExecutionLedgerRunConflictError';
    this.runId = runId;
  }
}

/** Error raised when a requested durable run does not exist. */
export class ExecutionLedgerNotFoundError extends Error {
  /** @param {string} runId - Durable run identity. */
  constructor(runId) {
    super(`Execution ledger run was not found: ${runId}`);
    this.name = 'ExecutionLedgerNotFoundError';
    this.runId = runId;
  }
}

/** Error raised when an optimistic version or fencing precondition is stale. */
export class ExecutionLedgerConflictError extends Error {
  /**
   * @param {string} runId - Durable run identity.
   * @param {string} [reason] - Safe conflict reason.
   */
  constructor(runId, reason) {
    super(
      `Execution ledger changed concurrently: ${runId}${
        reason ? ` (${reason})` : ''
      }`,
    );
    this.name = 'ExecutionLedgerConflictError';
    this.runId = runId;
  }
}

/** Error raised when one transition ID is reused with different contents. */
export class ExecutionLedgerTransitionConflictError extends Error {
  /**
   * @param {string} runId - Durable run identity.
   * @param {string} transitionId - Reused transition identity.
   */
  constructor(runId, transitionId) {
    super(
      `Execution ledger transition conflicts with existing receipt: ${runId}#${transitionId}`,
    );
    this.name = 'ExecutionLedgerTransitionConflictError';
    this.runId = runId;
    this.transitionId = transitionId;
  }
}

/** Error raised when append-only evidence and mutable projections disagree. */
export class ExecutionLedgerProjectionError extends Error {
  /**
   * @param {string} runId - Durable run identity.
   * @param {string} reason - Safe structural failure.
   */
  constructor(runId, reason) {
    super(`Execution ledger projection is invalid: ${runId} (${reason})`);
    this.name = 'ExecutionLedgerProjectionError';
    this.runId = runId;
    this.reason = reason;
  }
}

/**
 * @param {string} propertyName - Property name.
 * @param {unknown} propertyValue - Required value.
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
 * @param {string} propertyName - Property name.
 * @returns {import('../base.js').KeyCondition} - Nonexistence condition.
 */
function notExists(propertyName) {
  return {
    conditionType: CONDITION_TYPE.NOT_EXISTS,
    propertyName,
  };
}

/**
 * @param {string} propertyName - Property name.
 * @param {string} propertyValue - Required primary-key value.
 * @returns {import('../base.js').KeyCondition} - Primary-key equality condition.
 */
function pkEq(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.PRIMARY,
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Sort-key field.
 * @param {string} propertyValue - Required sort-key prefix.
 * @returns {import('../base.js').KeyCondition} - Sort-key prefix condition.
 */
function skBegins(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.SORT,
    conditionType: CONDITION_TYPE.BEGINS_WITH,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {unknown} error - Candidate conditional failure.
 * @returns {boolean} - Whether a conditional transaction lost its race.
 */
function isConditionalCheckFailed(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * @param {unknown} value - Candidate opaque ledger identity.
 * @param {string} label - Human-readable boundary label.
 * @returns {string} - Validated identity.
 */
function assertOpaqueId(value, label) {
  return assertLedgerOpaqueId(value, label);
}

/**
 * @param {unknown} value - Candidate nonnegative safe integer.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated number.
 */
function assertNonnegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

/**
 * @param {unknown} value - Candidate positive safe integer.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated number.
 */
function assertPositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return Number(value);
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} keys - Exact allowed object keys.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertExactKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
}

/**
 * Assert a snapshot has every required field, no unknown fields, and only
 * explicitly declared optional fields.
 * @param {Record<string, any>} value - Candidate snapshot.
 * @param {string[]} required - Fields that must be present.
 * @param {string[]} optional - Fields that may be present.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertSnapshotKeys(value, required, optional, label) {
  assertExactKeys(
    value,
    [
      ...required,
      ...optional.filter((key) =>
        Object.prototype.hasOwnProperty.call(value, key),
      ),
    ],
    label,
  );
}

/**
 * @param {unknown} value - Candidate actor.
 * @returns {{kind: string, id: string}} - Validated actor.
 */
function normalizeActor(value) {
  const actor = cloneBoundedJsonObject(
    value ?? { kind: 'local', id: 'local' },
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'actor',
  );
  assertExactKeys(actor, ['kind', 'id'], 'actor');
  return {
    kind: assertOpaqueId(actor.kind, 'actor.kind'),
    id: assertOpaqueId(actor.id, 'actor.id'),
  };
}

/**
 * @param {unknown} value - Candidate manual trigger.
 * @returns {{kind: 'manual'}} - Validated trigger.
 */
function normalizeManualTrigger(value) {
  const trigger = cloneBoundedJsonObject(
    value ?? { kind: 'manual' },
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'trigger',
  );
  assertExactKeys(trigger, ['kind'], 'trigger');
  if (trigger.kind !== 'manual') {
    throw new TypeError(
      "trigger.kind must be 'manual' in the first ledger slice.",
    );
  }
  return { kind: 'manual' };
}

/**
 * @param {unknown} value - Candidate JSON payload.
 * @param {string} label - Human-readable boundary label.
 * @param {number} maxBytes - Maximum encoded JSON bytes.
 * @returns {any} - Strict independently cloned JSON value.
 */
function cloneBoundedJson(value, label, maxBytes) {
  return cloneBoundedJsonValue(value, maxBytes, label);
}

/**
 * @param {unknown} value - Candidate compact durable JSON payload.
 * @param {string} label - Human-readable boundary label.
 * @returns {any} - Strict independently cloned JSON value.
 */
function cloneInlinePayload(value, label) {
  return cloneBoundedJson(
    value,
    label,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  );
}

/**
 * @param {unknown} value - Candidate append-only event payload.
 * @param {string} label - Human-readable boundary label.
 * @returns {any} - Strict independently cloned event payload.
 */
function cloneEventPayload(value, label) {
  return cloneBoundedJson(
    value,
    label,
    EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
  );
}

/**
 * @param {unknown} value - Candidate content-addressed JSON payload.
 * @param {string} label - Human-readable boundary label.
 * @returns {any} - Strict independently cloned referenced payload.
 */
function cloneReferencedPayload(value, label) {
  return cloneBoundedJson(
    value,
    label,
    EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
  );
}

/**
 * @param {unknown} value - Candidate content-addressed JSON object.
 * @param {string} label - Human-readable boundary label.
 * @returns {Record<string, any>} - Strict independently cloned referenced payload object.
 */
function cloneReferencedPayloadObject(value, label) {
  return cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
    label,
  );
}

/**
 * @param {unknown} value - Candidate immutable payload reference.
 * @param {string} expectedPayloadSchema - Required semantic payload schema.
 * @param {string} label - Human-readable boundary label.
 * @returns {Readonly<import('../../../runtime/execution-payload.js').ExecutionPayloadReference>} - Validated immutable reference.
 */
function normalizePayloadReference(value, expectedPayloadSchema, label) {
  const reference = validateExecutionPayloadReference(value, label);
  if (reference.payloadSchema !== expectedPayloadSchema) {
    throw new TypeError(
      `${label}.payloadSchema must be '${expectedPayloadSchema}'.`,
    );
  }
  return reference;
}

/**
 * @param {unknown} value - Candidate durable manual request envelope.
 * @param {string} label - Human-readable boundary label.
 * @returns {{input: any, callerMetadata: Record<string, any>}} - Strict manual request envelope.
 */
function normalizeManualRequestEnvelope(value, label) {
  const envelope = cloneReferencedPayloadObject(value, label);
  assertExactKeys(envelope, ['input', 'callerMetadata'], label);
  return {
    input: cloneReferencedPayload(envelope.input, `${label}.input`),
    callerMetadata: cloneReferencedPayloadObject(
      envelope.callerMetadata,
      `${label}.callerMetadata`,
    ),
  };
}

/**
 * Store JSON bytes before a ledger append and require an independent
 * read/rehash verification before returning the descriptor that may enter an
 * event.  The local store performs this internally too; the second explicit
 * call keeps the ledger boundary equally strict for later providers.
 * @param {{putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}} payloadStore - Immutable payload store.
 * @param {{value: unknown, payloadSchema: string, label: string}} input - Payload persistence request.
 * @returns {Promise<Readonly<import('../../../runtime/execution-payload.js').ExecutionPayloadReference>>} - Durably verified immutable reference.
 */
async function putVerifiedPayload(payloadStore, input) {
  const reference = normalizePayloadReference(
    await payloadStore.putJson({
      value: input.value,
      payloadSchema: input.payloadSchema,
    }),
    input.payloadSchema,
    input.label,
  );
  const verified = verifyPayloadBytes(
    await payloadStore.readBytes(reference),
    reference,
    input.payloadSchema,
    `${input.label} verification`,
  );
  if (!hasSameCanonicalJson(verified.value, input.value)) {
    throw new TypeError(`${input.label} verification changed its payload.`);
  }
  return reference;
}

/**
 * Rehash and decode exact provider bytes inside the ledger before using a
 * payload. A provider only supplies one read result; the ledger itself binds
 * that result to the immutable reference, avoiding a verify/read TOCTOU gap.
 * @param {unknown} value - Exact bytes returned by the payload provider.
 * @param {Readonly<import('../../../runtime/execution-payload.js').ExecutionPayloadReference>} expectedReference - Reference requested by the ledger.
 * @param {string} expectedPayloadSchema - Required semantic payload schema.
 * @param {string} label - Human-readable boundary label.
 * @returns {{reference: Readonly<import('../../../runtime/execution-payload.js').ExecutionPayloadReference>, value: any}} - Exact verified reference and decoded value.
 */
function verifyPayloadBytes(
  value,
  expectedReference,
  expectedPayloadSchema,
  label,
) {
  const verified = verifyExecutionPayloadReference(
    expectedReference,
    value,
    label,
  );
  const reference = normalizePayloadReference(
    verified.reference,
    expectedPayloadSchema,
    `${label}.reference`,
  );
  if (!hasSameCanonicalJson(reference, expectedReference)) {
    throw new TypeError(`${label} changed its immutable reference.`);
  }
  return { reference, value: verified.value };
}

/**
 * @param {Record<string, any>} terminal - Verified terminal protocol frame.
 * @returns {{type: string, attemptId: string}} - Minimal durable terminal summary.
 */
function createTerminalSummary(terminal) {
  return {
    type: terminal.type,
    attemptId: terminal.attemptId,
  };
}

/**
 * @param {unknown} value - Candidate terminal summary.
 * @param {string} label - Human-readable boundary label.
 * @returns {{type: string, attemptId: string}} - Strict terminal summary.
 */
function normalizeTerminalSummary(value, label) {
  const summary = cloneInlinePayload(value, label);
  assertExactKeys(summary, ['type', 'attemptId'], label);
  if (!TERMINAL_TYPES.has(summary.type)) {
    throw new TypeError(`${label}.type must be an activity terminal type.`);
  }
  return {
    type: summary.type,
    attemptId: assertOpaqueId(summary.attemptId, `${label}.attemptId`),
  };
}

/**
 * @param {unknown} left - First JSON value.
 * @param {unknown} right - Second JSON value.
 * @returns {boolean} - Whether both values have identical canonical JSON.
 */
function hasSameCanonicalJson(left, right) {
  return (
    JSON.stringify(sortCanonical(left)) === JSON.stringify(sortCanonical(right))
  );
}

/**
 * @param {any} value - Already-valid JSON value.
 * @returns {any} - Canonically ordered independent clone.
 */
function sortCanonical(value) {
  if (Array.isArray(value)) return value.map((entry) => sortCanonical(entry));
  if (value === null || typeof value !== 'object') return value;
  const sorted = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortCanonical(value[key]);
  }
  return sorted;
}

/**
 * @param {any} value - Candidate record.
 * @param {string} runId - Expected run identity.
 * @param {string} sortKey - Expected exact sort key.
 * @param {string} type - Expected record type.
 * @returns {Record<string, any>} - Validated record.
 */
function requireRecord(value, runId, sortKey, type) {
  if (
    !value ||
    value[KEY_NAME] !== runId ||
    value[SORT_KEY_NAME] !== sortKey ||
    value.record_type !== type ||
    value.schema_version !== EXECUTION_LEDGER_SCHEMA_VERSION
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'record shape mismatch');
  }
  return value;
}

/**
 * @param {string} runId - Run identity.
 * @param {number} version - Head version.
 * @param {number} sequence - Last allocated event sequence.
 * @param {string} appId - Immutable app identity.
 * @param {string} revisionId - Immutable revision identity.
 * @returns {Record<string, any>} - Head record.
 */
function createHeadRecord(runId, version, sequence, appId, revisionId) {
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getRunHeadSortKey(),
    record_type: 'execution_ledger_head',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    version,
    sequence,
    app_id: appId,
    revision_id: revisionId,
  };
}

/**
 * @param {string} runId - Run identity.
 * @param {Record<string, any>} data - Run projection.
 * @returns {Record<string, any>} - Run projection record.
 */
function createRunProjectionRecord(runId, data) {
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getRunProjectionSortKey(),
    record_type: 'execution_ledger_run_projection',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    status: data.status,
    version: data.version,
    sequence: data.lastSequence,
    app_id: data.appId,
    revision_id: data.revisionId,
    data: cloneInlinePayload(data, 'run projection'),
  };
}

/**
 * Build the small, redacted projection used to locate a service's run history.
 * The directory contains no payload references, terminal data, evidence, or
 * fencing tokens; callers must rebuild the referenced run before relying on
 * any state.
 * @param {string} runId - Durable run identity.
 * @param {Record<string, any>} data - Verified run snapshot.
 * @returns {Record<string, any>} - Typed directory record.
 */
function createRunDirectoryRecord(runId, data) {
  if (data.runId !== runId) {
    throw new ExecutionLedgerProjectionError(runId, 'directory run identity');
  }
  const scope = createExecutionLedgerRunDirectoryScope({ appId: data.appId });
  return {
    [KEY_NAME]: scope.directoryId,
    [SORT_KEY_NAME]: getExecutionLedgerRunDirectorySortKey({
      createdAt: data.createdAt,
      runId,
    }),
    record_type: RUN_DIRECTORY_RECORD_TYPE,
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    service_id: scope.serviceId,
    app_id: data.appId,
    ledger_run_id: runId,
    revision_id: data.revisionId,
    run_kind: RUN_DIRECTORY_RUN_KIND,
    status: data.status,
    version: data.version,
    sequence: data.lastSequence,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
  };
}

/**
 * Strictly normalize a directory row before it becomes an index locator.
 * @param {unknown} raw - Candidate persisted directory row.
 * @param {string} appId - Expected application scope.
 * @returns {Record<string, any>} - Validated directory record.
 */
function normalizeRunDirectoryRecord(raw, appId) {
  const record = cloneBoundedJsonObject(
    raw,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'run directory record',
  );
  assertExactKeys(
    record,
    [
      KEY_NAME,
      SORT_KEY_NAME,
      'record_type',
      'schema_version',
      'service_id',
      'app_id',
      'ledger_run_id',
      'revision_id',
      'run_kind',
      'status',
      'version',
      'sequence',
      'created_at',
      'updated_at',
    ],
    'run directory record',
  );
  assertLogicalId(appId, 'run directory appId');
  const scope = createExecutionLedgerRunDirectoryScope({ appId });
  const runId = assertOpaqueId(
    record.ledger_run_id,
    'run directory record.ledger_run_id',
  );
  if (
    record[KEY_NAME] !== scope.directoryId ||
    record[SORT_KEY_NAME] !==
      getExecutionLedgerRunDirectorySortKey({
        createdAt: record.created_at,
        runId,
      }) ||
    record.record_type !== RUN_DIRECTORY_RECORD_TYPE ||
    record.schema_version !== EXECUTION_LEDGER_SCHEMA_VERSION ||
    record.service_id !== scope.serviceId ||
    record.app_id !== appId ||
    record.run_kind !== RUN_DIRECTORY_RUN_KIND
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'invalid run directory');
  }
  assertApplicationRevisionId(
    record.revision_id,
    'run directory record.revision_id',
  );
  if (!Object.values(RunStatus).includes(record.status)) {
    throw new ExecutionLedgerProjectionError(runId, 'run directory status');
  }
  assertPositiveSafeInteger(record.version, 'run directory record.version');
  assertPositiveSafeInteger(record.sequence, 'run directory record.sequence');
  normalizeObservedAt(record.created_at, 'run directory record.created_at');
  normalizeObservedAt(record.updated_at, 'run directory record.updated_at');
  return record;
}

/**
 * @param {Record<string, any>} directory - Validated directory record.
 * @param {Record<string, any>} run - Rebuilt verified run snapshot.
 * @returns {void} - Throws when the index and run projection disagree.
 */
function assertRunDirectoryMatchesRun(directory, run) {
  const expected = createRunDirectoryRecord(run.runId, run);
  if (!hasSameCanonicalJson(directory, expected)) {
    throw new ExecutionLedgerProjectionError(
      run.runId,
      'run directory disagrees with projection',
    );
  }
}

/**
 * @param {unknown} options - Candidate run-directory page request.
 * @returns {{appId: string, limit: number, cursor?: string}} - Normalized request.
 */
function normalizeRunDirectoryPageOptions(options) {
  const value = cloneBoundedJsonObject(
    options,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'listRuns',
  );
  assertSnapshotKeys(value, ['appId'], ['limit', 'cursor'], 'listRuns');
  assertLogicalId(value.appId, 'listRuns.appId');
  const limit = Object.prototype.hasOwnProperty.call(value, 'limit')
    ? value.limit
    : RUN_DIRECTORY_DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > RUN_DIRECTORY_MAX_PAGE_SIZE
  ) {
    throw new TypeError(
      `listRuns.limit must be a safe integer from 1 through ${RUN_DIRECTORY_MAX_PAGE_SIZE}.`,
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'cursor') &&
    (typeof value.cursor !== 'string' || value.cursor.length === 0)
  ) {
    throw new TypeError('listRuns.cursor must be a nonempty opaque string.');
  }
  return {
    appId: value.appId,
    limit,
    ...(Object.prototype.hasOwnProperty.call(value, 'cursor')
      ? { cursor: value.cursor }
      : {}),
  };
}

/**
 * @param {{appId: string, serviceId: string, directoryId: string}} scope - Exact directory scope.
 * @param {string} startAfter - Exclusive sort key for a following page.
 * @returns {string} - Canonical opaque cursor.
 */
function createRunDirectoryCursor(scope, startAfter) {
  parseExecutionLedgerRunDirectorySortKey(
    startAfter,
    'listRuns.cursor.startAfter',
  );
  const value = {
    schemaVersion: RUN_DIRECTORY_CURSOR_SCHEMA_VERSION,
    appId: scope.appId,
    serviceId: scope.serviceId,
    directoryId: scope.directoryId,
    startAfter,
  };
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * @param {string | undefined} cursor - Candidate opaque cursor.
 * @param {{appId: string, serviceId: string, directoryId: string}} scope - Requested directory scope.
 * @returns {string | undefined} - Exclusive cursor sort key.
 */
function parseRunDirectoryCursor(cursor, scope) {
  if (cursor === undefined) return undefined;
  if (Buffer.byteLength(cursor, 'utf8') > 4096) {
    throw new TypeError('listRuns.cursor is too large.');
  }
  let text;
  let parsed;
  try {
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) {
      throw new Error('noncanonical base64url');
    }
    text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) {
      throw new Error('invalid utf8');
    }
    parsed = JSON.parse(text);
  } catch {
    throw new TypeError('listRuns.cursor is not a valid opaque cursor.');
  }
  const value = cloneBoundedJsonObject(parsed, 4096, 'listRuns.cursor');
  assertExactKeys(
    value,
    ['schemaVersion', 'appId', 'serviceId', 'directoryId', 'startAfter'],
    'listRuns.cursor',
  );
  if (
    value.schemaVersion !== RUN_DIRECTORY_CURSOR_SCHEMA_VERSION ||
    value.appId !== scope.appId ||
    value.serviceId !== scope.serviceId ||
    value.directoryId !== scope.directoryId ||
    typeof value.startAfter !== 'string' ||
    value.startAfter.length === 0 ||
    !value.startAfter.startsWith(
      EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX,
    ) ||
    text !== JSON.stringify(value)
  ) {
    throw new TypeError('listRuns.cursor does not match the requested scope.');
  }
  try {
    parseExecutionLedgerRunDirectorySortKey(
      value.startAfter,
      'listRuns.cursor.startAfter',
    );
  } catch {
    throw new TypeError('listRuns.cursor does not match the requested scope.');
  }
  return value.startAfter;
}

/**
 * @param {Record<string, any>} directory - Verified directory row.
 * @returns {{runId: string, appId: string, revisionId: string, kind: 'manual', status: string, version: number, lastSequence: number, createdAt: number, updatedAt: number}} - Redacted page item.
 */
function createRunDirectoryPageItem(directory) {
  return {
    runId: directory.ledger_run_id,
    appId: directory.app_id,
    revisionId: directory.revision_id,
    kind: RUN_DIRECTORY_RUN_KIND,
    status: directory.status,
    version: directory.version,
    lastSequence: directory.sequence,
    createdAt: directory.created_at,
    updatedAt: directory.updated_at,
  };
}

/**
 * @param {string} runId - Run identity.
 * @param {Record<string, any>} data - Invocation projection.
 * @returns {Record<string, any>} - Invocation projection record.
 */
function createInvocationProjectionRecord(runId, data) {
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getInvocationProjectionSortKey(data.invocationId),
    record_type: 'execution_ledger_invocation_projection',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    invocation_id: data.invocationId,
    status: data.status,
    generation: data.generation,
    version: data.version,
    revision_id: data.revisionId,
    data: cloneInlinePayload(data, 'invocation projection'),
  };
}

/**
 * @param {string} runId - Run identity.
 * @param {Record<string, any>} data - Attempt projection.
 * @returns {Record<string, any>} - Attempt projection record.
 */
function createAttemptProjectionRecord(runId, data) {
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getAttemptProjectionSortKey(data.attemptId),
    record_type: 'execution_ledger_attempt_projection',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    invocation_id: data.invocationId,
    attempt_id: data.attemptId,
    status: data.status,
    generation: data.generation,
    version: data.version,
    fencing_token: data.fencingToken,
    coordinator_epoch: data.coordinatorEpoch,
    revision_id: data.revisionId,
    data: cloneInlinePayload(data, 'attempt projection'),
  };
}

/**
 * @param {{runId: string, sequence: number, transitionId: string, requestDigest: string, type: string, observedAt: number, actor: Record<string, any>, fence: Record<string, any>, payload: Record<string, any>}} value - Immutable event identity inputs.
 * @returns {string} - Content-bound event identity.
 */
function createEventId({
  runId,
  sequence,
  transitionId,
  requestDigest,
  type,
  observedAt,
  actor,
  fence,
  payload,
}) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-event:v3',
    prefix: 'wle',
    value: {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId,
      sequence,
      transitionId,
      requestDigest,
      type,
      observedAt,
      actor,
      fence,
      payload,
    },
    valuePath: 'ledger event identity',
  });
}

/**
 * @param {string} runId - Run identity.
 * @param {number} sequence - Event sequence.
 * @param {string} transitionId - Stable transition identity.
 * @param {string} requestDigest - Canonical semantic request digest.
 * @param {string} type - Event type.
 * @param {number} observedAt - Observed time.
 * @param {{kind: string, id: string}} actor - Event actor.
 * @param {{coordinatorEpoch: number, invocationGeneration: number}} fence - Relevant fence.
 * @param {Record<string, any>} payload - Event payload.
 * @returns {Record<string, any>} - Immutable event record.
 */
function createEventRecord(
  runId,
  sequence,
  transitionId,
  requestDigest,
  type,
  observedAt,
  actor,
  fence,
  payload,
) {
  const normalizedActor = cloneInlinePayload(actor, 'event actor');
  const normalizedFence = cloneInlinePayload(fence, 'event fence');
  const normalizedPayload = cloneEventPayload(payload, 'event payload');
  const eventId = createEventId({
    runId,
    sequence,
    transitionId,
    requestDigest,
    type,
    observedAt,
    actor: normalizedActor,
    fence: normalizedFence,
    payload: normalizedPayload,
  });
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getEventSortKey(sequence),
    record_type: 'execution_ledger_event',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    sequence,
    event_id: eventId,
    transition_id: transitionId,
    request_digest: requestDigest,
    type,
    observed_at: observedAt,
    actor: normalizedActor,
    fence: normalizedFence,
    payload: normalizedPayload,
  };
}

/**
 * @param {string} runId - Run identity.
 * @param {string} transitionId - Stable transition identity.
 * @param {string} requestDigest - Canonical request digest.
 * @param {Record<string, any>} event - Newly accepted event.
 * @returns {Record<string, any>} - Immutable transition receipt.
 */
function createTransitionRecord(runId, transitionId, requestDigest, event) {
  const attempt = event.payload?.attempt;
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getTransitionSortKey(transitionId),
    record_type: 'execution_ledger_transition',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    transition_id: transitionId,
    request_digest: requestDigest,
    event_id: event.event_id,
    sequence: event.sequence,
    type: event.type,
    ...(attempt
      ? {
          invocation_id: attempt.invocationId,
          attempt_id: attempt.attemptId,
        }
      : {}),
  };
}

/**
 * @param {Record<string, any>} value - Candidate options object.
 * @param {string[]} allowed - Supported option names.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertSupportedKeys(value, allowed, label) {
  const accepted = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!accepted.has(key)) {
      throw new TypeError(`${label}.${key} is not supported.`);
    }
  }
}

/**
 * @param {unknown} value - Candidate observation timestamp.
 * @param {string} label - Human-readable boundary label.
 * @returns {number} - Validated positive timestamp.
 */
function normalizeObservedAt(value, label) {
  return assertPositiveSafeInteger(value, label);
}

/**
 * @param {string} invocationId - Invocation identity.
 * @param {string} attemptId - Attempt identity.
 * @returns {string} - Collision-free in-memory lookup key.
 */
function attemptMapKey(invocationId, attemptId) {
  return JSON.stringify([invocationId, attemptId]);
}

/**
 * @param {Record<string, any>} run - Candidate run snapshot.
 * @param {string} runId - Expected run identity.
 * @returns {Record<string, any>} - Strict cloned run snapshot.
 */
function normalizeRunSnapshot(run, runId) {
  const value = cloneBoundedJsonObject(
    run,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'run snapshot',
  );
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'runId',
      'appId',
      'revisionId',
      'trigger',
      'requestRef',
      'status',
      'version',
      'lastSequence',
      'createdAt',
      'updatedAt',
    ],
    'run snapshot',
  );
  if (value.schemaVersion !== EXECUTION_LEDGER_SCHEMA_VERSION) {
    throw new ExecutionLedgerProjectionError(runId, 'unsupported run schema');
  }
  if (value.runId !== runId) {
    throw new ExecutionLedgerProjectionError(runId, 'run projection identity');
  }
  assertLogicalId(value.appId, 'run projection appId');
  assertApplicationRevisionId(value.revisionId, 'run projection revisionId');
  if (!Object.values(RunStatus).includes(value.status)) {
    throw new ExecutionLedgerProjectionError(runId, 'run projection status');
  }
  assertPositiveSafeInteger(value.version, 'run projection version');
  assertPositiveSafeInteger(value.lastSequence, 'run projection sequence');
  normalizeObservedAt(value.createdAt, 'run projection createdAt');
  normalizeObservedAt(value.updatedAt, 'run projection updatedAt');
  value.trigger = normalizeManualTrigger(value.trigger);
  value.requestRef = normalizePayloadReference(
    value.requestRef,
    MANUAL_REQUEST_PAYLOAD_SCHEMA,
    'run projection requestRef',
  );
  return value;
}

/**
 * @param {Record<string, any>} invocation - Candidate invocation snapshot.
 * @param {string} runId - Expected run identity.
 * @returns {Record<string, any>} - Strict cloned invocation snapshot.
 */
function normalizeInvocationSnapshot(invocation, runId) {
  const value = cloneBoundedJsonObject(
    invocation,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'invocation snapshot',
  );
  assertSnapshotKeys(
    value,
    [
      'schemaVersion',
      'runId',
      'invocationId',
      'appId',
      'revisionId',
      'activityId',
      'requestRef',
      'status',
      'generation',
      'version',
      'lastSequence',
      'createdAt',
      'updatedAt',
    ],
    ['terminal', 'uncertainty'],
    'invocation snapshot',
  );
  if (value.schemaVersion !== EXECUTION_LEDGER_SCHEMA_VERSION) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'unsupported invocation schema',
    );
  }
  if (value.runId !== runId) {
    throw new ExecutionLedgerProjectionError(runId, 'invocation run identity');
  }
  assertOpaqueId(value.invocationId, 'invocation projection invocationId');
  assertLogicalId(value.appId, 'invocation projection appId');
  assertApplicationRevisionId(
    value.revisionId,
    'invocation projection revisionId',
  );
  assertLogicalId(value.activityId, 'invocation projection activityId');
  if (!Object.values(InvocationStatus).includes(value.status)) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invocation projection status',
    );
  }
  assertNonnegativeSafeInteger(
    value.generation,
    'invocation projection generation',
  );
  assertPositiveSafeInteger(value.version, 'invocation projection version');
  assertPositiveSafeInteger(
    value.lastSequence,
    'invocation projection sequence',
  );
  normalizeObservedAt(value.createdAt, 'invocation projection createdAt');
  normalizeObservedAt(value.updatedAt, 'invocation projection updatedAt');
  value.requestRef = normalizePayloadReference(
    value.requestRef,
    MANUAL_REQUEST_PAYLOAD_SCHEMA,
    'invocation projection requestRef',
  );
  const hasTerminal = Object.prototype.hasOwnProperty.call(value, 'terminal');
  const hasUncertainty = Object.prototype.hasOwnProperty.call(
    value,
    'uncertainty',
  );
  if (
    ([InvocationStatus.RUNNABLE, InvocationStatus.RUNNING].includes(
      value.status,
    ) &&
      (hasTerminal || hasUncertainty)) ||
    (value.status === InvocationStatus.UNCERTAIN &&
      (!hasUncertainty || hasTerminal)) ||
    ([
      InvocationStatus.COMPLETED,
      InvocationStatus.FAILED,
      InvocationStatus.CANCELLED,
    ].includes(value.status) &&
      (!hasTerminal || hasUncertainty))
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid invocation lifecycle fields',
    );
  }
  if (hasTerminal) {
    value.terminal = normalizeTerminalSummary(
      value.terminal,
      'invocation projection terminal',
    );
  }
  if (hasUncertainty) {
    value.uncertainty = cloneInlinePayload(
      value.uncertainty,
      'invocation projection uncertainty',
    );
  }
  return value;
}

/**
 * @param {Record<string, any>} attempt - Candidate attempt snapshot.
 * @param {string} runId - Expected run identity.
 * @returns {Record<string, any>} - Strict cloned attempt snapshot.
 */
function normalizeAttemptSnapshot(attempt, runId) {
  const value = cloneBoundedJsonObject(
    attempt,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'attempt snapshot',
  );
  assertSnapshotKeys(
    value,
    [
      'schemaVersion',
      'runId',
      'invocationId',
      'attemptId',
      'appId',
      'revisionId',
      'activityId',
      'status',
      'generation',
      'version',
      'coordinatorEpoch',
      'fencingToken',
      'claimedAt',
      'updatedAt',
      'lastSequence',
    ],
    ['startedAt', 'terminal', 'evidenceRef', 'abandonment'],
    'attempt snapshot',
  );
  if (value.schemaVersion !== EXECUTION_LEDGER_SCHEMA_VERSION) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'unsupported attempt schema',
    );
  }
  if (value.runId !== runId) {
    throw new ExecutionLedgerProjectionError(runId, 'attempt run identity');
  }
  assertOpaqueId(value.invocationId, 'attempt projection invocationId');
  assertOpaqueId(value.attemptId, 'attempt projection attemptId');
  assertLogicalId(value.appId, 'attempt projection appId');
  assertApplicationRevisionId(
    value.revisionId,
    'attempt projection revisionId',
  );
  assertLogicalId(value.activityId, 'attempt projection activityId');
  if (!Object.values(AttemptStatus).includes(value.status)) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'attempt projection status',
    );
  }
  assertPositiveSafeInteger(value.generation, 'attempt projection generation');
  assertPositiveSafeInteger(value.version, 'attempt projection version');
  assertNonnegativeSafeInteger(
    value.coordinatorEpoch,
    'attempt projection coordinatorEpoch',
  );
  assertOpaqueId(value.fencingToken, 'attempt projection fencingToken');
  assertPositiveSafeInteger(value.lastSequence, 'attempt projection sequence');
  normalizeObservedAt(value.claimedAt, 'attempt projection claimedAt');
  normalizeObservedAt(value.updatedAt, 'attempt projection updatedAt');
  const hasStartedAt = Object.prototype.hasOwnProperty.call(value, 'startedAt');
  const hasTerminal = Object.prototype.hasOwnProperty.call(value, 'terminal');
  const hasEvidenceRef = Object.prototype.hasOwnProperty.call(
    value,
    'evidenceRef',
  );
  const hasAbandonment = Object.prototype.hasOwnProperty.call(
    value,
    'abandonment',
  );
  if (
    (value.status === AttemptStatus.CLAIMED &&
      (hasStartedAt || hasTerminal || hasEvidenceRef || hasAbandonment)) ||
    (value.status === AttemptStatus.STARTED &&
      (!hasStartedAt || hasTerminal || hasEvidenceRef || hasAbandonment)) ||
    ([
      AttemptStatus.COMPLETED,
      AttemptStatus.FAILED,
      AttemptStatus.CANCELLED,
    ].includes(value.status) &&
      (!hasStartedAt || !hasTerminal || !hasEvidenceRef || hasAbandonment)) ||
    (value.status === AttemptStatus.ABANDONED &&
      (hasTerminal || hasEvidenceRef || !hasAbandonment))
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid attempt lifecycle fields',
    );
  }
  if (hasStartedAt) {
    normalizeObservedAt(value.startedAt, 'attempt projection startedAt');
  }
  if (hasTerminal) {
    value.terminal = normalizeTerminalSummary(
      value.terminal,
      'attempt projection terminal',
    );
  }
  if (hasEvidenceRef) {
    value.evidenceRef = normalizePayloadReference(
      value.evidenceRef,
      ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      'attempt projection evidenceRef',
    );
  }
  if (hasAbandonment) {
    value.abandonment = cloneInlinePayload(
      value.abandonment,
      'attempt projection abandonment',
    );
  }
  return value;
}

/**
 * @param {Record<string, any>} prior - Previous run snapshot.
 * @param {Record<string, any>} next - Candidate next run snapshot.
 * @param {number} sequence - Event sequence.
 * @param {string} runId - Run identity.
 * @returns {void}
 */
function assertRunAdvance(prior, next, sequence, runId) {
  if (
    next.runId !== prior.runId ||
    next.appId !== prior.appId ||
    next.revisionId !== prior.revisionId ||
    !hasSameCanonicalJson(next.trigger, prior.trigger) ||
    !hasSameCanonicalJson(next.requestRef, prior.requestRef) ||
    next.createdAt !== prior.createdAt ||
    next.version !== prior.version + 1 ||
    next.lastSequence !== sequence
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'invalid run transition');
  }
}

/**
 * @param {Record<string, any>} prior - Previous invocation snapshot.
 * @param {Record<string, any>} next - Candidate next invocation snapshot.
 * @param {number} sequence - Event sequence.
 * @param {string} runId - Run identity.
 * @returns {void}
 */
function assertInvocationAdvance(prior, next, sequence, runId) {
  if (
    next.runId !== prior.runId ||
    next.invocationId !== prior.invocationId ||
    next.appId !== prior.appId ||
    next.revisionId !== prior.revisionId ||
    next.activityId !== prior.activityId ||
    !hasSameCanonicalJson(next.requestRef, prior.requestRef) ||
    next.createdAt !== prior.createdAt ||
    next.version !== prior.version + 1 ||
    next.lastSequence !== sequence
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid invocation transition',
    );
  }
}

/**
 * @param {Record<string, any>} attempt - Attempt snapshot.
 * @param {Record<string, any>} run - Run snapshot.
 * @param {Record<string, any>} invocation - Invocation snapshot.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertAttemptBelongsToInvocation(attempt, run, invocation, runId) {
  if (
    attempt.runId !== run.runId ||
    attempt.runId !== runId ||
    attempt.invocationId !== invocation.invocationId ||
    attempt.appId !== run.appId ||
    attempt.appId !== invocation.appId ||
    attempt.revisionId !== run.revisionId ||
    attempt.revisionId !== invocation.revisionId ||
    attempt.activityId !== invocation.activityId
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'attempt immutable identity mismatch',
    );
  }
}

/**
 * @param {Record<string, any>} prior - Previous attempt snapshot.
 * @param {Record<string, any>} next - Candidate next attempt snapshot.
 * @param {Record<string, any>} event - Current event record.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertAttemptAdvance(prior, next, event, runId) {
  if (
    next.runId !== prior.runId ||
    next.invocationId !== prior.invocationId ||
    next.attemptId !== prior.attemptId ||
    next.appId !== prior.appId ||
    next.revisionId !== prior.revisionId ||
    next.activityId !== prior.activityId ||
    next.generation !== prior.generation ||
    next.coordinatorEpoch !== prior.coordinatorEpoch ||
    next.fencingToken !== prior.fencingToken ||
    next.claimedAt !== prior.claimedAt ||
    next.version !== prior.version + 1 ||
    next.lastSequence !== event.sequence ||
    next.updatedAt !== event.observed_at
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid attempt transition',
    );
  }
  if (
    event.fence.coordinatorEpoch !== next.coordinatorEpoch ||
    event.fence.invocationGeneration !== next.generation
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'attempt event fence');
  }
}

/**
 * @param {Record<string, any>} value - Candidate event record.
 * @param {string} runId - Expected run identity.
 * @returns {Record<string, any>} - Strict cloned event.
 */
function normalizeEventRecord(value, runId) {
  const event = requireRecord(
    value,
    runId,
    String(value?.[SORT_KEY_NAME] || ''),
    'execution_ledger_event',
  );
  if (!EVENT_TYPES.has(event.type)) {
    throw new ExecutionLedgerProjectionError(runId, 'unknown event type');
  }
  assertExactKeys(
    event,
    [
      KEY_NAME,
      SORT_KEY_NAME,
      'record_type',
      'schema_version',
      'sequence',
      'event_id',
      'transition_id',
      'request_digest',
      'type',
      'observed_at',
      'actor',
      'fence',
      'payload',
    ],
    'event record',
  );
  assertPositiveSafeInteger(event.sequence, 'event sequence');
  assertOpaqueId(event.transition_id, 'event transition identity');
  assertOpaqueId(event.request_digest, 'event request digest');
  assertOpaqueId(event.event_id, 'event identity');
  normalizeObservedAt(event.observed_at, 'event observedAt');
  const actor = normalizeActor(event.actor);
  const fence = cloneBoundedJsonObject(
    event.fence,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'event fence',
  );
  assertExactKeys(
    fence,
    ['coordinatorEpoch', 'invocationGeneration'],
    'event fence',
  );
  const normalizedFence = {
    coordinatorEpoch: assertNonnegativeSafeInteger(
      fence.coordinatorEpoch,
      'event fence coordinatorEpoch',
    ),
    invocationGeneration: assertNonnegativeSafeInteger(
      fence.invocationGeneration,
      'event fence invocationGeneration',
    ),
  };
  const payload = cloneEventPayload(event.payload, 'event payload');
  const normalized = /** @type {Record<string, any>} */ ({
    ...event,
    actor,
    fence: normalizedFence,
    payload,
  });
  if (
    normalized.event_id !==
    createEventId({
      runId,
      sequence: normalized.sequence,
      transitionId: normalized.transition_id,
      requestDigest: normalized.request_digest,
      type: normalized.type,
      observedAt: normalized.observed_at,
      actor: normalized.actor,
      fence: normalized.fence,
      payload: normalized.payload,
    })
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'event identity mismatch');
  }
  return normalized;
}

/**
 * @param {Record<string, any>} value - Candidate transition receipt.
 * @param {string} runId - Expected run identity.
 * @returns {Record<string, any>} - Strict cloned receipt.
 */
function normalizeTransitionReceipt(value, runId) {
  const receipt = requireRecord(
    value,
    runId,
    String(value?.[SORT_KEY_NAME] || ''),
    'execution_ledger_transition',
  );
  assertSupportedKeys(
    receipt,
    [
      KEY_NAME,
      SORT_KEY_NAME,
      'record_type',
      'schema_version',
      'transition_id',
      'request_digest',
      'event_id',
      'sequence',
      'type',
      'invocation_id',
      'attempt_id',
    ],
    'transition receipt',
  );
  assertOpaqueId(receipt.transition_id, 'transition receipt identity');
  if (receipt[SORT_KEY_NAME] !== getTransitionSortKey(receipt.transition_id)) {
    throw new ExecutionLedgerProjectionError(runId, 'transition receipt key');
  }
  assertOpaqueId(receipt.request_digest, 'transition receipt request digest');
  assertOpaqueId(receipt.event_id, 'transition receipt event identity');
  assertPositiveSafeInteger(receipt.sequence, 'transition receipt sequence');
  if (!EVENT_TYPES.has(receipt.type)) {
    throw new ExecutionLedgerProjectionError(runId, 'transition receipt type');
  }
  const hasInvocation = Object.prototype.hasOwnProperty.call(
    receipt,
    'invocation_id',
  );
  const hasAttempt = Object.prototype.hasOwnProperty.call(
    receipt,
    'attempt_id',
  );
  if (hasInvocation !== hasAttempt) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'transition receipt attempt identity',
    );
  }
  if (hasInvocation) {
    assertOpaqueId(receipt.invocation_id, 'transition receipt invocation');
    assertOpaqueId(receipt.attempt_id, 'transition receipt attempt');
  }
  return cloneBoundedJsonObject(
    receipt,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'transition receipt',
  );
}

/**
 * @param {Record<string, any>} event - Event being folded.
 * @param {string} runId - Expected run identity.
 * @returns {{run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} - Event projection snapshots.
 */
function eventSnapshots(event, runId) {
  const payload = cloneBoundedJsonObject(
    event.payload,
    EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
    'event payload',
  );
  assertExactKeys(
    payload,
    event.type === 'manual-run-created'
      ? ['run', 'invocation']
      : ['run', 'invocation', 'attempt'],
    'event payload',
  );
  const run = normalizeRunSnapshot(payload.run, runId);
  const invocation = normalizeInvocationSnapshot(payload.invocation, runId);
  /** @type {{run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} */
  const result = { run, invocation };
  if (Object.prototype.hasOwnProperty.call(payload, 'attempt')) {
    result.attempt = normalizeAttemptSnapshot(payload.attempt, runId);
  }
  return result;
}

/**
 * Recompute the semantic idempotency digest from the immutable event and the
 * prior folded state. Event IDs bind a stored digest, but this check binds the
 * digest itself to the transition it claims to represent.
 * @param {Record<string, any>} event - Event being folded.
 * @param {Record<string, any> | undefined} currentRun - Prior run snapshot.
 * @param {Record<string, any> | undefined} currentInvocation - Prior invocation snapshot.
 * @param {Record<string, any> | undefined} currentAttempt - Prior attempt snapshot.
 * @param {Record<string, any>} run - Next run snapshot.
 * @param {Record<string, any>} invocation - Next invocation snapshot.
 * @param {Record<string, any> | undefined} attempt - Next attempt snapshot.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertEventRequestDigest(
  event,
  currentRun,
  currentInvocation,
  currentAttempt,
  run,
  invocation,
  attempt,
  runId,
) {
  /** @type {Record<string, any>} */
  let value;
  if (event.type === 'manual-run-created') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      transitionId: event.transition_id,
      actor: event.actor,
      coordinatorEpoch: event.fence.coordinatorEpoch,
      appId: run.appId,
      revisionId: run.revisionId,
      activityId: invocation.activityId,
      requestRef: run.requestRef,
      trigger: run.trigger,
    };
  } else if (event.type === 'attempt-claimed') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      expectedGeneration: currentInvocation?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'attempt-started') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'attempt-terminal') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      terminal: attempt?.terminal,
      evidenceRef: attempt?.evidenceRef,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'attempt-abandoned-before-start') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      reason: attempt?.abandonment,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      reason: attempt?.abandonment,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  }
  const expectedDigest = createTransitionRequestDigest(event.type, value);
  if (event.request_digest !== expectedDigest) {
    throw new ExecutionLedgerProjectionError(runId, 'event request digest');
  }
}

/**
 * Build a per-fold verified payload reader.  It caches only within one
 * complete ledger read: every later read rehashes content from storage before
 * authorizing another mutation.
 * @param {{readBytes: (reference: unknown) => Promise<unknown>}} payloadStore - Immutable payload store.
 * @param {string} runId - Durable run identity for safe diagnostics.
 * @returns {{readManualRequest: (reference: unknown) => Promise<Record<string, any>>, readEvidence: (reference: unknown) => Promise<Record<string, any>>}} - Verified payload reader.
 */
function createLedgerPayloadReader(payloadStore, runId) {
  /** @type {Map<string, Promise<any>>} */
  const reads = new Map();

  /**
   * @param {unknown} reference - Candidate immutable reference.
   * @param {string} payloadSchema - Required semantic schema.
   * @param {string} label - Human-readable payload label.
   * @returns {Promise<any>} - Rehashed and decoded payload.
   */
  async function read(reference, payloadSchema, label) {
    const normalized = normalizePayloadReference(
      reference,
      payloadSchema,
      label,
    );
    const key = JSON.stringify(normalized);
    let pending = reads.get(key);
    if (!pending) {
      pending = Promise.resolve()
        .then(
          async () =>
            verifyPayloadBytes(
              await payloadStore.readBytes(normalized),
              normalized,
              payloadSchema,
              label,
            ).value,
        )
        .catch(() => {
          throw new ExecutionLedgerProjectionError(
            runId,
            `${label} is unavailable or invalid`,
          );
        });
      reads.set(key, pending);
    }
    return await pending;
  }

  return {
    async readManualRequest(reference) {
      return normalizeManualRequestEnvelope(
        await read(
          reference,
          MANUAL_REQUEST_PAYLOAD_SCHEMA,
          'persisted manual request',
        ),
        'persisted manual request',
      );
    },
    async readEvidence(reference) {
      return cloneReferencedPayloadObject(
        await read(
          reference,
          ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
          'persisted attempt evidence',
        ),
        'persisted attempt evidence',
      );
    },
  };
}

/**
 * @param {Record<string, any>} run - Run snapshot.
 * @param {Record<string, any>} invocation - Invocation snapshot.
 * @param {Record<string, any> | undefined} attempt - Attempt snapshot.
 * @param {Record<string, any>} event - Event being folded.
 * @param {{run?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>}} state - Mutable fold state.
 * @param {string} runId - Run identity.
 * @param {{readManualRequest: (reference: unknown) => Promise<Record<string, any>>, readEvidence: (reference: unknown) => Promise<Record<string, any>>}} payloadReader - Per-fold verified immutable payload reader.
 * @returns {Promise<void>}
 */
async function applyEvent(
  run,
  invocation,
  attempt,
  event,
  state,
  runId,
  payloadReader,
) {
  const currentRun = state.run;
  const currentInvocation = state.invocations.get(invocation.invocationId);
  const currentAttempt = attempt
    ? state.attempts.get(attemptMapKey(attempt.invocationId, attempt.attemptId))
    : undefined;

  if (event.type === 'manual-run-created') {
    if (
      currentRun ||
      currentInvocation ||
      attempt ||
      event.sequence !== 1 ||
      run.status !== RunStatus.RUNNING ||
      run.version !== 1 ||
      run.lastSequence !== 1 ||
      invocation.status !== InvocationStatus.RUNNABLE ||
      invocation.generation !== 0 ||
      invocation.version !== 1 ||
      invocation.lastSequence !== 1 ||
      run.createdAt !== event.observed_at ||
      run.updatedAt !== event.observed_at ||
      invocation.createdAt !== event.observed_at ||
      invocation.updatedAt !== event.observed_at ||
      run.appId !== invocation.appId ||
      run.revisionId !== invocation.revisionId ||
      !hasSameCanonicalJson(run.requestRef, invocation.requestRef) ||
      event.fence.coordinatorEpoch !== 0 ||
      event.fence.invocationGeneration !== 0
    ) {
      throw new ExecutionLedgerProjectionError(runId, 'invalid run creation');
    }
    await payloadReader.readManualRequest(run.requestRef);
    assertEventRequestDigest(
      event,
      undefined,
      undefined,
      undefined,
      run,
      invocation,
      undefined,
      runId,
    );
    state.run = run;
    state.invocations.set(invocation.invocationId, invocation);
    return;
  }

  if (!currentRun || !currentInvocation || !attempt) {
    throw new ExecutionLedgerProjectionError(runId, 'event lacks prior state');
  }
  assertRunAdvance(currentRun, run, event.sequence, runId);
  assertInvocationAdvance(currentInvocation, invocation, event.sequence, runId);
  if (
    run.updatedAt !== event.observed_at ||
    invocation.updatedAt !== event.observed_at
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'event observation mismatch',
    );
  }

  if (event.type === 'attempt-claimed') {
    assertAttemptBelongsToInvocation(attempt, run, invocation, runId);
    if (
      currentRun.status !== RunStatus.RUNNING ||
      run.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNABLE ||
      state.attempts.has(
        attemptMapKey(attempt.invocationId, attempt.attemptId),
      ) ||
      attempt.status !== AttemptStatus.CLAIMED ||
      attempt.generation !== currentInvocation.generation + 1 ||
      invocation.status !== InvocationStatus.RUNNING ||
      invocation.generation !== attempt.generation ||
      attempt.version !== 1 ||
      attempt.lastSequence !== event.sequence ||
      attempt.attemptId !==
        createAttemptId(runId, invocation.invocationId, attempt.generation) ||
      attempt.claimedAt !== event.observed_at ||
      attempt.updatedAt !== event.observed_at ||
      Object.prototype.hasOwnProperty.call(attempt, 'startedAt') ||
      Object.prototype.hasOwnProperty.call(attempt, 'terminal') ||
      Object.prototype.hasOwnProperty.call(attempt, 'evidenceRef') ||
      Object.prototype.hasOwnProperty.call(attempt, 'abandonment') ||
      event.fence.coordinatorEpoch !== attempt.coordinatorEpoch ||
      event.fence.invocationGeneration !== attempt.generation
    ) {
      throw new ExecutionLedgerProjectionError(runId, 'invalid attempt claim');
    }
  } else if (event.type === 'attempt-started') {
    if (
      currentRun.status !== RunStatus.RUNNING ||
      run.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNING ||
      !currentAttempt ||
      currentAttempt.status !== AttemptStatus.CLAIMED ||
      attempt.status !== AttemptStatus.STARTED ||
      attempt.generation !== currentInvocation.generation ||
      Object.prototype.hasOwnProperty.call(currentAttempt, 'startedAt') ||
      attempt.startedAt !== event.observed_at ||
      Object.prototype.hasOwnProperty.call(attempt, 'terminal') ||
      Object.prototype.hasOwnProperty.call(attempt, 'evidenceRef') ||
      Object.prototype.hasOwnProperty.call(attempt, 'abandonment') ||
      invocation.status !== InvocationStatus.RUNNING ||
      invocation.generation !== currentInvocation.generation
    ) {
      throw new ExecutionLedgerProjectionError(runId, 'invalid attempt start');
    }
    assertAttemptAdvance(currentAttempt, attempt, event, runId);
  } else if (event.type === 'attempt-terminal') {
    const terminal = attempt.terminal;
    if (!SUPPORTED_MANUAL_TERMINAL_TYPES.has(terminal.type)) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'unsupported manual terminal type',
      );
    }
    const statuses = statusesForTerminal(terminal);
    const verifiedEvidence = validateLedgerAttemptEvidence(
      await payloadReader.readEvidence(attempt.evidenceRef),
      await createLedgerAttemptStart(run, invocation, attempt, payloadReader),
      'persisted attempt evidence',
    );
    if (
      currentRun.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNING ||
      !currentAttempt ||
      currentAttempt.status !== AttemptStatus.STARTED ||
      attempt.status !== statuses.attempt ||
      attempt.generation !== currentInvocation.generation ||
      invocation.status !== statuses.invocation ||
      invocation.generation !== currentInvocation.generation ||
      run.status !== statuses.run ||
      attempt.startedAt !== currentAttempt.startedAt ||
      terminal.attemptId !== attempt.attemptId ||
      !hasSameCanonicalJson(
        createTerminalSummary(verifiedEvidence.terminal),
        terminal,
      ) ||
      !hasSameCanonicalJson(invocation.terminal, terminal)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid attempt terminal',
      );
    }
    assertAttemptAdvance(currentAttempt, attempt, event, runId);
  } else if (event.type === 'attempt-abandoned-before-start') {
    if (
      currentRun.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNING ||
      !currentAttempt ||
      currentAttempt.status !== AttemptStatus.CLAIMED ||
      attempt.status !== AttemptStatus.ABANDONED ||
      attempt.generation !== currentInvocation.generation ||
      Object.prototype.hasOwnProperty.call(currentAttempt, 'startedAt') ||
      Object.prototype.hasOwnProperty.call(attempt, 'startedAt') ||
      Object.prototype.hasOwnProperty.call(attempt, 'terminal') ||
      Object.prototype.hasOwnProperty.call(attempt, 'evidenceRef') ||
      !Object.prototype.hasOwnProperty.call(attempt, 'abandonment') ||
      invocation.status !== InvocationStatus.RUNNABLE ||
      invocation.generation !== currentInvocation.generation ||
      run.status !== RunStatus.RUNNING
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid pre-start abandonment',
      );
    }
    assertAttemptAdvance(currentAttempt, attempt, event, runId);
  } else if (event.type === 'attempt-became-uncertain') {
    if (
      currentRun.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNING ||
      !currentAttempt ||
      currentAttempt.status !== AttemptStatus.STARTED ||
      attempt.status !== AttemptStatus.ABANDONED ||
      attempt.generation !== currentInvocation.generation ||
      attempt.startedAt !== currentAttempt.startedAt ||
      Object.prototype.hasOwnProperty.call(attempt, 'terminal') ||
      Object.prototype.hasOwnProperty.call(attempt, 'evidenceRef') ||
      !Object.prototype.hasOwnProperty.call(attempt, 'abandonment') ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.generation !== currentInvocation.generation ||
      !hasSameCanonicalJson(invocation.uncertainty, attempt.abandonment) ||
      run.status !== RunStatus.BLOCKED
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid uncertain abandonment',
      );
    }
    assertAttemptAdvance(currentAttempt, attempt, event, runId);
  }

  assertEventRequestDigest(
    event,
    currentRun,
    currentInvocation,
    currentAttempt,
    run,
    invocation,
    attempt,
    runId,
  );

  state.run = run;
  state.invocations.set(invocation.invocationId, invocation);
  state.attempts.set(
    attemptMapKey(attempt.invocationId, attempt.attemptId),
    attempt,
  );
}

/**
 * @param {DBClient} db - Backing database client.
 * @param {string} tableName - One-table ledger namespace.
 * @param {string} runId - Run identity.
 * @returns {Promise<Record<string, any>[]>} - All records for the run.
 */
async function readRunRecords(db, tableName, runId) {
  return await db.query({
    tableName,
    consistentRead: true,
    // A custom V3 table may deliberately retain V2 or lifecycle rows in the
    // same physical partition. Only the fresh V3 record namespace participates
    // in replay; no old history is accidentally treated as a malformed V3 run.
    keyConditions: [
      pkEq(KEY_NAME, runId),
      skBegins(SORT_KEY_NAME, EXECUTION_LEDGER_SORT_KEY_PREFIX),
    ],
  });
}

/**
 * @param {Record<string, any>} left - First projection snapshot.
 * @param {Record<string, any>} right - Second projection snapshot.
 * @returns {boolean} - Whether snapshots are identical canonical JSON.
 */
function sameSnapshot(left, right) {
  return hasSameCanonicalJson(left, right);
}

/**
 * Fold one run's retained event stream, then verify every current projection
 * against that fold before returning state that may authorize another write.
 * @param {Record<string, any>[]} records - All partition records.
 * @param {string} runId - Expected run identity.
 * @param {{readBytes: (reference: unknown) => Promise<unknown>}} payloadStore - Immutable payload store.
 * @returns {Promise<{head: Record<string, any>, run: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, events: Record<string, any>[]}|null>} - Verified current state, if the run exists.
 */
async function foldAndVerifyRun(records, runId, payloadStore) {
  if (records.length === 0) return null;

  /** @type {Record<string, any> | undefined} */
  let head;
  /** @type {Record<string, any> | undefined} */
  let runProjection;
  const invocationProjections = new Map();
  const attemptProjections = new Map();
  /** @type {Record<string, any>[]} */
  const rawEvents = [];
  /** @type {Record<string, any>[]} */
  const rawReceipts = [];

  for (const record of records) {
    if (!record || record[KEY_NAME] !== runId) {
      throw new ExecutionLedgerProjectionError(runId, 'partition identity');
    }
    switch (record.record_type) {
      case 'execution_ledger_head':
        if (head || record[SORT_KEY_NAME] !== getRunHeadSortKey()) {
          throw new ExecutionLedgerProjectionError(runId, 'duplicate run head');
        }
        head = requireRecord(
          record,
          runId,
          getRunHeadSortKey(),
          'execution_ledger_head',
        );
        break;
      case 'execution_ledger_run_projection':
        if (
          runProjection ||
          record[SORT_KEY_NAME] !== getRunProjectionSortKey()
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'duplicate run projection',
          );
        }
        runProjection = requireRecord(
          record,
          runId,
          getRunProjectionSortKey(),
          'execution_ledger_run_projection',
        );
        break;
      case 'execution_ledger_invocation_projection': {
        const invocation = normalizeInvocationSnapshot(record.data, runId);
        const expectedSortKey = getInvocationProjectionSortKey(
          invocation.invocationId,
        );
        requireRecord(
          record,
          runId,
          expectedSortKey,
          'execution_ledger_invocation_projection',
        );
        if (
          record.invocation_id !== invocation.invocationId ||
          record.status !== invocation.status ||
          record.generation !== invocation.generation ||
          record.version !== invocation.version ||
          record.revision_id !== invocation.revisionId ||
          invocationProjections.has(invocation.invocationId)
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'invocation projection index mismatch',
          );
        }
        invocationProjections.set(invocation.invocationId, invocation);
        break;
      }
      case 'execution_ledger_attempt_projection': {
        const attempt = normalizeAttemptSnapshot(record.data, runId);
        const expectedSortKey = getAttemptProjectionSortKey(attempt.attemptId);
        requireRecord(
          record,
          runId,
          expectedSortKey,
          'execution_ledger_attempt_projection',
        );
        const key = attemptMapKey(attempt.invocationId, attempt.attemptId);
        if (
          record.invocation_id !== attempt.invocationId ||
          record.attempt_id !== attempt.attemptId ||
          record.status !== attempt.status ||
          record.generation !== attempt.generation ||
          record.version !== attempt.version ||
          record.fencing_token !== attempt.fencingToken ||
          record.coordinator_epoch !== attempt.coordinatorEpoch ||
          record.revision_id !== attempt.revisionId ||
          attemptProjections.has(key)
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'attempt projection index mismatch',
          );
        }
        attemptProjections.set(key, attempt);
        break;
      }
      case 'execution_ledger_event':
        rawEvents.push(record);
        break;
      case 'execution_ledger_transition':
        rawReceipts.push(record);
        break;
      default:
        throw new ExecutionLedgerProjectionError(runId, 'unknown record type');
    }
  }

  if (!head || !runProjection) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'missing head or run projection',
    );
  }
  if (
    !Number.isSafeInteger(head.version) ||
    head.version < 1 ||
    !Number.isSafeInteger(head.sequence) ||
    head.sequence < 1 ||
    typeof head.app_id !== 'string' ||
    typeof head.revision_id !== 'string'
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'invalid run head');
  }
  assertLogicalId(head.app_id, 'run head app_id');
  assertApplicationRevisionId(head.revision_id, 'run head revision_id');

  const events = rawEvents
    .map((event) => normalizeEventRecord(event, runId))
    .sort((left, right) => left.sequence - right.sequence);
  if (events.length !== head.sequence) {
    throw new ExecutionLedgerProjectionError(runId, 'event sequence length');
  }
  const receipts = rawReceipts.map((receipt) =>
    normalizeTransitionReceipt(receipt, runId),
  );
  if (receipts.length !== events.length) {
    throw new ExecutionLedgerProjectionError(runId, 'transition receipt count');
  }
  const receiptsByTransition = new Map();
  for (const receipt of receipts) {
    if (receiptsByTransition.has(receipt.transition_id)) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'duplicate transition receipt',
      );
    }
    receiptsByTransition.set(receipt.transition_id, receipt);
  }

  /** @type {{run?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>}} */
  const state = {
    invocations: new Map(),
    attempts: new Map(),
  };
  const payloadReader = createLedgerPayloadReader(payloadStore, runId);
  for (const [index, event] of events.entries()) {
    const expectedSequence = index + 1;
    if (
      event.sequence !== expectedSequence ||
      event[SORT_KEY_NAME] !== getEventSortKey(expectedSequence)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'noncontiguous event stream',
      );
    }
    const snapshots = eventSnapshots(event, runId);
    const receipt = receiptsByTransition.get(event.transition_id);
    if (
      !receipt ||
      receipt.sequence !== event.sequence ||
      receipt.event_id !== event.event_id ||
      receipt.type !== event.type ||
      receipt.request_digest !== event.request_digest
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'transition receipt disagrees with event',
      );
    }
    if (
      snapshots.attempt
        ? receipt.invocation_id !== snapshots.attempt.invocationId ||
          receipt.attempt_id !== snapshots.attempt.attemptId
        : Object.prototype.hasOwnProperty.call(receipt, 'invocation_id') ||
          Object.prototype.hasOwnProperty.call(receipt, 'attempt_id')
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'transition receipt attempt mismatch',
      );
    }
    await applyEvent(
      snapshots.run,
      snapshots.invocation,
      snapshots.attempt,
      event,
      state,
      runId,
      payloadReader,
    );
  }

  if (!state.run) {
    throw new ExecutionLedgerProjectionError(runId, 'event stream has no run');
  }
  const expectedRun = normalizeRunSnapshot(runProjection.data, runId);
  if (
    !sameSnapshot(state.run, expectedRun) ||
    head.version !== state.run.version ||
    head.sequence !== state.run.lastSequence ||
    head.app_id !== state.run.appId ||
    head.revision_id !== state.run.revisionId ||
    runProjection.status !== state.run.status ||
    runProjection.version !== state.run.version ||
    runProjection.sequence !== state.run.lastSequence ||
    runProjection.app_id !== state.run.appId ||
    runProjection.revision_id !== state.run.revisionId
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'run projection disagrees');
  }
  if (state.invocations.size !== invocationProjections.size) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invocation projection count',
    );
  }
  for (const [invocationId, invocation] of state.invocations) {
    const projection = invocationProjections.get(invocationId);
    if (!projection || !sameSnapshot(invocation, projection)) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invocation projection disagrees',
      );
    }
  }
  if (state.attempts.size !== attemptProjections.size) {
    throw new ExecutionLedgerProjectionError(runId, 'attempt projection count');
  }
  for (const [key, attempt] of state.attempts) {
    const projection = attemptProjections.get(key);
    if (!projection || !sameSnapshot(attempt, projection)) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'attempt projection disagrees',
      );
    }
  }

  return {
    head: cloneJsonObject(head, 'run head'),
    run: state.run,
    invocations: state.invocations,
    attempts: state.attempts,
    events,
  };
}

/**
 * @param {Record<string, any>} state - Verified folded state.
 * @param {Record<string, any> | undefined} attempt - Current affected attempt.
 * @param {Record<string, any>} receipt - Transition receipt.
 * @param {boolean} applied - Whether this call appended the transition.
 * @returns {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} - Public transition view.
 */
function transitionResult(state, attempt, receipt, applied) {
  const invocation = [...state.invocations.values()][0];
  /** @type {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} */
  const result = {
    applied,
    receipt: cloneJsonObject(receipt, 'transition receipt'),
    run: cloneJsonObject(state.run, 'run result'),
    invocation: cloneJsonObject(invocation, 'invocation result'),
  };
  if (attempt) result.attempt = cloneJsonObject(attempt, 'attempt result');
  return result;
}

/**
 * Attach the exact host start frame to a successfully persisted STARTED
 * transition. This deliberately happens only after the durable transition is
 * readable again, so callers cannot accidentally dispatch an attempt from a
 * merely claimed projection.
 * @param {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} result - Persisted transition result.
 * @param {string} runId - Durable run identity for diagnostics.
 * @param {{readBytes: (reference: unknown) => Promise<unknown>}} payloadStore - Immutable payload store.
 * @returns {Promise<{applied: boolean, dispatchAuthorized: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, startFrame: Readonly<Record<string, any>>}>} - Started transition result.
 */
async function startedTransitionResult(result, runId, payloadStore) {
  if (!result.attempt) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'started transition has no attempt',
    );
  }
  return {
    ...result,
    attempt: result.attempt,
    // A receipt replay proves only that a start was durably observed, not
    // whether another process already dispatched it. Never authorize a second
    // physical delivery from that ambiguous response. The post-write read can
    // also observe a newer recovery or terminal transition, so an accepted
    // write alone is not enough: dispatch remains authorized only while this
    // exact attempt is still the live STARTED attempt.
    dispatchAuthorized:
      result.applied &&
      result.run.status === RunStatus.RUNNING &&
      result.invocation.status === InvocationStatus.RUNNING &&
      result.attempt.status === AttemptStatus.STARTED,
    startFrame: await createLedgerAttemptStart(
      result.run,
      result.invocation,
      result.attempt,
      createLedgerPayloadReader(payloadStore, runId),
    ),
  };
}

/**
 * @param {string} type - Stable transition type.
 * @param {Record<string, any>} value - Semantic transition request.
 * @returns {string} - Canonical request digest.
 */
function createTransitionRequestDigest(type, value) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-transition:v3',
    prefix: 'wlt',
    value: {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      type,
      ...value,
    },
    valuePath: 'execution ledger transition',
  });
}

/**
 * @param {Record<string, any>} options - Candidate transition options.
 * @param {string[]} allowed - Supported keys.
 * @param {string} label - Human-readable boundary label.
 * @param {() => number} now - Clock used when the caller omits observedAt.
 * @returns {{runId: string, transitionId: string, expectedVersion: number, actor: {kind: string, id: string}, observedAt: number, coordinatorEpoch: number}} - Common transition fields.
 */
function normalizeTransitionOptions(options, allowed, label, now) {
  const value = cloneBoundedJsonObject(
    options,
    EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
    label,
  );
  assertSupportedKeys(value, allowed, label);
  return {
    runId: assertOpaqueId(value.runId, `${label}.runId`),
    transitionId: assertOpaqueId(value.transitionId, `${label}.transitionId`),
    expectedVersion: assertPositiveSafeInteger(
      value.expectedVersion,
      `${label}.expectedVersion`,
    ),
    actor: normalizeActor(value.actor),
    observedAt: normalizeObservedAt(
      Object.prototype.hasOwnProperty.call(value, 'observedAt')
        ? value.observedAt
        : now(),
      `${label}.observedAt`,
    ),
    coordinatorEpoch: assertNonnegativeSafeInteger(
      Object.prototype.hasOwnProperty.call(value, 'coordinatorEpoch')
        ? value.coordinatorEpoch
        : 0,
      `${label}.coordinatorEpoch`,
    ),
  };
}

/**
 * @param {DBClient} db - Backing database client.
 * @param {string} tableName - Ledger table name.
 * @param {string} runId - Run identity.
 * @param {string} transitionId - Transition identity.
 * @returns {Promise<Record<string, any> | null>} - Existing immutable receipt.
 */
async function getTransitionReceipt(db, tableName, runId, transitionId) {
  const sortKey = getTransitionSortKey(transitionId);
  const record = await db.get({
    tableName,
    keyName: KEY_NAME,
    keyValue: runId,
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: sortKey,
    consistentRead: true,
  });
  if (!record) return null;
  const receipt = normalizeTransitionReceipt(
    /** @type {Record<string, any>} */ (record),
    runId,
  );
  if (
    receipt.transition_id !== transitionId ||
    receipt[SORT_KEY_NAME] !== sortKey
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'transition receipt shape');
  }
  return receipt;
}

/**
 * @param {Record<string, any>} record - Existing projection record.
 * @param {import('../base.js').KeyCondition[]} extraConditions - Additional preconditions.
 * @returns {import('../base.js').KeyCondition[]} - Full replacement conditions.
 */
function replacementConditions(record, extraConditions = []) {
  return [
    eq('version', record.version),
    eq('status', record.status),
    eq('revision_id', record.revision_id),
    ...extraConditions,
  ];
}

/**
 * @param {Record<string, any>} record - Existing typed run-directory row.
 * @returns {import('../base.js').KeyCondition[]} - Full stale-write fence.
 */
function runDirectoryReplacementConditions(record) {
  return [
    eq('record_type', record.record_type),
    eq('schema_version', record.schema_version),
    eq('service_id', record.service_id),
    eq('app_id', record.app_id),
    eq('ledger_run_id', record.ledger_run_id),
    eq('revision_id', record.revision_id),
    eq('run_kind', record.run_kind),
    eq('status', record.status),
    eq('version', record.version),
    eq('sequence', record.sequence),
    eq('created_at', record.created_at),
    eq('updated_at', record.updated_at),
  ];
}

/**
 * @param {Record<string, any>} attempt - Attempt whose fence is being validated.
 * @param {{coordinatorEpoch: number, fencingToken: string, generation: number}} input - Caller fence.
 * @param {string} runId - Run identity.
 * @returns {void}
 */
function assertCurrentAttemptFence(attempt, input, runId) {
  if (
    attempt.coordinatorEpoch !== input.coordinatorEpoch ||
    attempt.fencingToken !== input.fencingToken ||
    attempt.generation !== input.generation
  ) {
    throw new ExecutionLedgerConflictError(runId, 'stale attempt fence');
  }
}

/**
 * @param {Record<string, any>} terminal - Validated terminal component frame.
 * @returns {{attempt: string, invocation: string, run: string}} - Ledger status mapping.
 */
function statusesForTerminal(terminal) {
  if (terminal.type === 'completed') {
    return {
      attempt: AttemptStatus.COMPLETED,
      invocation: InvocationStatus.COMPLETED,
      run: RunStatus.COMPLETED,
    };
  }
  if (terminal.type === 'cancelled') {
    return {
      attempt: AttemptStatus.CANCELLED,
      invocation: InvocationStatus.CANCELLED,
      run: RunStatus.CANCELLED,
    };
  }
  return {
    attempt: AttemptStatus.FAILED,
    invocation: InvocationStatus.FAILED,
    run: RunStatus.FAILED,
  };
}

/**
 * @param {Record<string, any>} terminal - Validated Activity Protocol terminal.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertSupportedManualTerminal(terminal, label) {
  if (!SUPPORTED_MANUAL_TERMINAL_TYPES.has(terminal.type)) {
    throw new TypeError(
      `${label}.type '${terminal.type}' requires a durable cancellation or deadline decision that this ledger slice does not implement.`,
    );
  }
}

/**
 * @param {Record<string, any>} run - Current run projection.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @param {Record<string, any>} attempt - Current attempt projection.
 * @param {{readManualRequest: (reference: unknown) => Promise<Record<string, any>>}} payloadReader - Verified immutable payload reader.
 * @returns {Promise<Readonly<Record<string, any>>>} - Exact host start frame bound by the ledger.
 */
async function createLedgerAttemptStart(
  run,
  invocation,
  attempt,
  payloadReader,
) {
  const request = await payloadReader.readManualRequest(invocation.requestRef);
  return validateActivityProtocolHostFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'start',
      revisionId: run.revisionId,
      activityId: invocation.activityId,
      runId: run.runId,
      invocationId: invocation.invocationId,
      attemptId: attempt.attemptId,
      fencingToken: attempt.fencingToken,
      input: request.input,
      caller: { metadata: request.callerMetadata },
    },
    'ledger activity attempt start',
  );
}

/**
 * Reject a known oversized frames array before deep-cloning evidence. This is
 * only a fast path: the strict bounded clone below remains the authority for
 * object shape, accessors, and byte accounting.
 * @param {unknown} value - Candidate evidence envelope.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertEvidenceFrameCountPreflight(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, 'frames');
  if (
    descriptor &&
    'value' in descriptor &&
    Array.isArray(descriptor.value) &&
    descriptor.value.length > EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES
  ) {
    throw new TypeError(
      `${label}.frames must contain no more than ${EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES} frames.`,
    );
  }
}

/**
 * Validate the complete host-owned evidence before allowing any physical
 * attempt terminal to become a durable logical outcome. A bare terminal frame
 * is not sufficient: cancellation, deadline, component ordering, and managed
 * effect correlation all live in the transcript.
 * @param {unknown} value - Candidate host-collected attempt evidence.
 * @param {Readonly<Record<string, any>>} expectedStart - Exact ledger-bound start frame.
 * @param {string} label - Human-readable boundary label.
 * @returns {{terminal: Readonly<Record<string, any>>, evidence: Record<string, any>}} - Revalidated bounded evidence.
 */
function validateLedgerAttemptEvidence(value, expectedStart, label) {
  assertEvidenceFrameCountPreflight(value, label);
  const evidence = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    evidence,
    ['status', 'start', 'terminal', 'frames', 'transcript'],
    label,
  );
  if (
    !Array.isArray(evidence.frames) ||
    evidence.frames.length < 2 ||
    evidence.frames.length > EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES
  ) {
    throw new TypeError(
      `${label}.frames must contain a start and terminal and no more than ${EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES} frames.`,
    );
  }
  const declaredStart = validateActivityProtocolHostFrame(
    evidence.start,
    `${label}.start`,
  );
  if (
    declaredStart.type !== 'start' ||
    !hasSameCanonicalJson(declaredStart, expectedStart)
  ) {
    throw new TypeError(`${label}.start must match the persisted attempt.`);
  }

  const transcript = new ActivityProtocolTranscriptValidator();
  let terminal = /** @type {Readonly<Record<string, any>> | null} */ (null);
  for (const [index, frame] of evidence.frames.entries()) {
    if (index === 0) {
      const acceptedStart = transcript.acceptHostFrame(frame);
      if (
        acceptedStart.type !== 'start' ||
        !hasSameCanonicalJson(acceptedStart, expectedStart)
      ) {
        throw new TypeError(
          `${label}.frames[0] must match the persisted start.`,
        );
      }
      continue;
    }

    if (frame?.type === 'cancel' || frame?.type === 'effect-result') {
      transcript.acceptHostFrame(frame);
      continue;
    }
    const accepted = validateActivityProtocolComponentFrame(
      frame,
      `${label}.frames[${index}]`,
    );
    const isTerminal = TERMINAL_TYPES.has(accepted.type);
    if (isTerminal && index !== evidence.frames.length - 1) {
      throw new TypeError(`${label} terminal must be its final frame.`);
    }
    const acceptedByTranscript = transcript.acceptComponentFrame(accepted);
    if (isTerminal) terminal = acceptedByTranscript;
  }

  if (!terminal) {
    throw new TypeError(`${label} must contain one terminal component frame.`);
  }
  if (
    !hasSameCanonicalJson(evidence.terminal, terminal) ||
    evidence.status !== terminal.type
  ) {
    throw new TypeError(
      `${label}.status and ${label}.terminal must match its transcript terminal.`,
    );
  }
  if (!hasSameCanonicalJson(evidence.transcript, transcript.snapshot())) {
    throw new TypeError(`${label}.transcript must match its accepted frames.`);
  }
  return {
    terminal,
    evidence,
  };
}

/**
 * @param {string} runId - Durable run identity.
 * @param {string} invocationId - Durable invocation identity.
 * @param {number} generation - Attempt generation scoped to the invocation.
 * @returns {string} - Globally scoped deterministic physical-attempt identity.
 */
function createAttemptId(runId, invocationId, generation) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-attempt:v3',
    prefix: 'wla',
    value: { runId, invocationId, generation },
    valuePath: 'execution ledger attempt identity',
  });
}

/**
 * Create a provider-neutral append-only execution ledger over one transactional
 * DB table. It intentionally does not provide leases, scheduling, effects, or
 * a general workflow API; those require later durable contracts.
 * @param {{db: DBClient, tableName: string, payloadStore: {putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}, now?: () => number}} options - Store dependencies.
 * @returns {ExecutionLedgerStore} - Durable ledger API.
 */
export function createExecutionLedger({
  db,
  tableName,
  payloadStore,
  now = () => Date.now(),
}) {
  if (!db || typeof db.transactionWrite !== 'function') {
    throw new TypeError(
      'createExecutionLedger requires a transactional DB client (transactionWrite).',
    );
  }
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new TypeError('createExecutionLedger requires a tableName.');
  }
  if (
    !payloadStore ||
    typeof payloadStore.putJson !== 'function' ||
    typeof payloadStore.readBytes !== 'function'
  ) {
    throw new TypeError(
      'createExecutionLedger requires an immutable payloadStore with putJson and readBytes.',
    );
  }
  if (typeof now !== 'function') {
    throw new TypeError('createExecutionLedger now must be a function.');
  }
  const resolvedTableName = tableName.trim();

  /**
   * @param {string} runId - Run identity.
   * @returns {Promise<ReturnType<typeof foldAndVerifyRun>>} - Verified run state.
   */
  async function readVerifiedRun(runId) {
    return await foldAndVerifyRun(
      await readRunRecords(db, resolvedTableName, runId),
      runId,
      payloadStore,
    );
  }

  /**
   * @param {Record<string, any>} state - Existing verified state.
   * @param {Record<string, any> | null} receipt - Existing receipt, if any.
   * @param {string} requestDigest - Expected semantic request digest.
   * @returns {Record<string, any> | null} - Matching receipt, if any.
   */
  function assertMatchingReceipt(state, receipt, requestDigest) {
    if (!receipt) return null;
    if (receipt.request_digest !== requestDigest) {
      throw new ExecutionLedgerTransitionConflictError(
        state.run.runId,
        receipt.transition_id,
      );
    }
    return receipt;
  }

  /**
   * Atomically append exactly one event, its receipt, the next run head, and
   * the affected projections. The caller supplies already-folded snapshots so
   * the event remains sufficient to reconstruct every projection.
   * @param {{state: Record<string, any> | null, runId: string, transitionId: string, requestDigest: string, event: Record<string, any>, nextRun: Record<string, any>, nextInvocation: Record<string, any>, nextAttempt?: Record<string, any>, currentAttempt?: Record<string, any>}} input - Fully validated transition.
   * @returns {Promise<void>} - Resolves only after the durable transaction commits.
   */
  async function appendTransition(input) {
    const eventRecord = input.event;
    const headRecord = createHeadRecord(
      input.runId,
      input.nextRun.version,
      input.nextRun.lastSequence,
      input.nextRun.appId,
      input.nextRun.revisionId,
    );
    const runRecord = createRunProjectionRecord(input.runId, input.nextRun);
    const directoryRecord = createRunDirectoryRecord(
      input.runId,
      input.nextRun,
    );
    const invocationRecord = createInvocationProjectionRecord(
      input.runId,
      input.nextInvocation,
    );
    const receiptRecord = createTransitionRecord(
      input.runId,
      input.transitionId,
      input.requestDigest,
      eventRecord,
    );
    const currentInvocation = input.state
      ? input.state.invocations.get(input.nextInvocation.invocationId)
      : undefined;
    if (input.state && !currentInvocation) {
      throw new ExecutionLedgerProjectionError(
        input.runId,
        'transition invocation missing',
      );
    }
    const persistedInvocation = /** @type {Record<string, any>} */ (
      currentInvocation
    );

    /** @type {import('../base.js').TransactionPutRequest[]} */
    const putRequests = [
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: headRecord,
        conditions: input.state
          ? [
              eq('version', input.state.head.version),
              eq('sequence', input.state.head.sequence),
              eq('revision_id', input.state.head.revision_id),
            ]
          : [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: eventRecord,
        conditions: [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: receiptRecord,
        conditions: [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: runRecord,
        conditions: input.state
          ? replacementConditions(
              createRunProjectionRecord(input.runId, input.state.run),
            )
          : [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: directoryRecord,
        conditions: input.state
          ? runDirectoryReplacementConditions(
              createRunDirectoryRecord(input.runId, input.state.run),
            )
          : [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: invocationRecord,
        conditions: input.state
          ? replacementConditions(
              createInvocationProjectionRecord(
                input.runId,
                persistedInvocation,
              ),
              [eq('generation', persistedInvocation.generation)],
            )
          : [notExists(SORT_KEY_NAME)],
      },
    ];
    if (input.nextAttempt) {
      const attemptRecord = createAttemptProjectionRecord(
        input.runId,
        input.nextAttempt,
      );
      putRequests.push({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: attemptRecord,
        conditions: input.currentAttempt
          ? replacementConditions(
              createAttemptProjectionRecord(input.runId, input.currentAttempt),
              [eq('generation', input.currentAttempt.generation)],
            )
          : [notExists(SORT_KEY_NAME)],
      });
    }

    await db.transactionWrite({
      tableName: resolvedTableName,
      putRequests,
    });
  }

  /**
   * @param {Record<string, any>} state - Current verified state.
   * @param {Record<string, any>} receipt - Existing transition receipt.
   * @returns {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} - Idempotent receipt result.
   */
  function existingTransitionResult(state, receipt) {
    const attempt =
      typeof receipt.invocation_id === 'string' &&
      typeof receipt.attempt_id === 'string'
        ? state.attempts.get(
            attemptMapKey(receipt.invocation_id, receipt.attempt_id),
          )
        : undefined;
    return transitionResult(state, attempt, receipt, false);
  }

  /**
   * @param {Record<string, any>} current - Existing run projection.
   * @param {Record<string, any>} invocation - Existing root invocation projection.
   * @param {{appId: string, revisionId: string, activityId: string, input: any, callerMetadata: Record<string, any>, trigger: {kind: 'manual'}}} requested - Caller-requested manual work.
   * @param {{readManualRequest: (reference: unknown) => Promise<Record<string, any>>}} payloadReader - Verified immutable payload reader.
   * @returns {Promise<boolean>} - Whether the run is an exact idempotent duplicate.
   */
  async function isSameManualRun(
    current,
    invocation,
    requested,
    payloadReader,
  ) {
    if (
      current.appId === requested.appId &&
      current.revisionId === requested.revisionId &&
      invocation.appId === requested.appId &&
      invocation.revisionId === requested.revisionId &&
      invocation.activityId === requested.activityId &&
      hasSameCanonicalJson(current.trigger, requested.trigger) &&
      hasSameCanonicalJson(current.requestRef, invocation.requestRef)
    ) {
      const persisted = await payloadReader.readManualRequest(
        current.requestRef,
      );
      return (
        hasSameCanonicalJson(persisted.input, requested.input) &&
        hasSameCanonicalJson(persisted.callerMetadata, requested.callerMetadata)
      );
    }
    return false;
  }

  /**
   * Create one manual run and its one initial runnable invocation. The run ID
   * is its idempotency identity: identical requests return the retained run;
   * different work fails visibly rather than being silently deduplicated.
   * @param {{runId: string, appId: string, revisionId: string, invocationId: string, activityId: string, input?: any, callerMetadata?: Record<string, any>, trigger?: {kind: 'manual'}, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Immutable run definition.
   * @returns {Promise<{applied: boolean, receipt?: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>}>} - Created or deduplicated run.
   */
  async function createManualRun(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'createManualRun',
    );
    assertSupportedKeys(
      value,
      [
        'runId',
        'appId',
        'revisionId',
        'invocationId',
        'activityId',
        'input',
        'callerMetadata',
        'trigger',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'createManualRun',
    );
    const runId = assertOpaqueId(value.runId, 'createManualRun.runId');
    const appId = value.appId;
    assertLogicalId(appId, 'createManualRun.appId');
    const revisionId = value.revisionId;
    assertApplicationRevisionId(revisionId, 'createManualRun.revisionId');
    const invocationId = assertOpaqueId(
      value.invocationId,
      'createManualRun.invocationId',
    );
    const activityId = value.activityId;
    assertLogicalId(activityId, 'createManualRun.activityId');
    const input = cloneReferencedPayload(
      Object.prototype.hasOwnProperty.call(value, 'input') ? value.input : {},
      'createManualRun.input',
    );
    const callerMetadata = cloneReferencedPayloadObject(
      Object.prototype.hasOwnProperty.call(value, 'callerMetadata')
        ? value.callerMetadata
        : {},
      'createManualRun.callerMetadata',
    );
    const trigger = normalizeManualTrigger(value.trigger);
    const transitionId = assertOpaqueId(
      value.transitionId,
      'createManualRun.transitionId',
    );
    const actor = normalizeActor(value.actor);
    const coordinatorEpoch = assertNonnegativeSafeInteger(
      Object.prototype.hasOwnProperty.call(value, 'coordinatorEpoch')
        ? value.coordinatorEpoch
        : 0,
      'createManualRun.coordinatorEpoch',
    );
    if (coordinatorEpoch !== 0) {
      throw new TypeError(
        'createManualRun.coordinatorEpoch must be 0 until durable coordinator ownership is implemented.',
      );
    }
    const observedAt = normalizeObservedAt(
      Object.prototype.hasOwnProperty.call(value, 'observedAt')
        ? value.observedAt
        : now(),
      'createManualRun.observedAt',
    );
    const requested = {
      appId,
      revisionId,
      activityId,
      input,
      callerMetadata,
      trigger,
    };

    const existing = await readVerifiedRun(runId);
    if (existing) {
      const persistedInvocation = existing.invocations.get(invocationId);
      if (
        !persistedInvocation ||
        !(await isSameManualRun(
          existing.run,
          persistedInvocation,
          requested,
          createLedgerPayloadReader(payloadStore, runId),
        ))
      ) {
        throw new ExecutionLedgerRunConflictError(runId);
      }
      const requestDigest = createTransitionRequestDigest(
        'manual-run-created',
        {
          runId,
          invocationId,
          transitionId,
          actor,
          coordinatorEpoch,
          appId,
          revisionId,
          activityId,
          requestRef: existing.run.requestRef,
          trigger,
        },
      );
      const receipt = await getTransitionReceipt(
        db,
        resolvedTableName,
        runId,
        transitionId,
      );
      if (receipt && receipt.request_digest !== requestDigest) {
        throw new ExecutionLedgerTransitionConflictError(runId, transitionId);
      }
      return {
        applied: false,
        ...(receipt ? { receipt: cloneJsonObject(receipt, 'receipt') } : {}),
        run: cloneJsonObject(existing.run, 'run result'),
        invocation: cloneJsonObject(persistedInvocation, 'invocation result'),
      };
    }

    const requestRef = await putVerifiedPayload(payloadStore, {
      value: { input, callerMetadata },
      payloadSchema: MANUAL_REQUEST_PAYLOAD_SCHEMA,
      label: 'createManualRun.requestRef',
    });
    const requestDigest = createTransitionRequestDigest('manual-run-created', {
      runId,
      invocationId,
      transitionId,
      actor,
      coordinatorEpoch,
      appId,
      revisionId,
      activityId,
      requestRef,
      trigger,
    });

    const run = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId,
      appId,
      revisionId,
      trigger,
      requestRef,
      status: RunStatus.RUNNING,
      version: 1,
      lastSequence: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    const invocation = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId,
      invocationId,
      appId,
      revisionId,
      activityId,
      requestRef,
      status: InvocationStatus.RUNNABLE,
      generation: 0,
      version: 1,
      lastSequence: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    const event = createEventRecord(
      runId,
      1,
      transitionId,
      requestDigest,
      'manual-run-created',
      observedAt,
      actor,
      { coordinatorEpoch, invocationGeneration: 0 },
      { run, invocation },
    );

    try {
      await appendTransition({
        state: null,
        runId,
        transitionId,
        requestDigest,
        event,
        nextRun: run,
        nextInvocation: invocation,
      });
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
      const raced = await readVerifiedRun(runId);
      if (!raced) throw new ExecutionLedgerConflictError(runId);
      const persistedInvocation = raced.invocations.get(invocationId);
      if (
        !persistedInvocation ||
        !(await isSameManualRun(
          raced.run,
          persistedInvocation,
          requested,
          createLedgerPayloadReader(payloadStore, runId),
        ))
      ) {
        throw new ExecutionLedgerRunConflictError(runId);
      }
      const racedRequestDigest = createTransitionRequestDigest(
        'manual-run-created',
        {
          runId,
          invocationId,
          transitionId,
          actor,
          coordinatorEpoch,
          appId,
          revisionId,
          activityId,
          requestRef: raced.run.requestRef,
          trigger,
        },
      );
      const receipt = await getTransitionReceipt(
        db,
        resolvedTableName,
        runId,
        transitionId,
      );
      if (receipt && receipt.request_digest !== racedRequestDigest) {
        throw new ExecutionLedgerTransitionConflictError(runId, transitionId);
      }
      return {
        applied: false,
        ...(receipt ? { receipt: cloneJsonObject(receipt, 'receipt') } : {}),
        run: cloneJsonObject(raced.run, 'run result'),
        invocation: cloneJsonObject(persistedInvocation, 'invocation result'),
      };
    }

    const next = await readVerifiedRun(runId);
    if (!next)
      throw new ExecutionLedgerProjectionError(runId, 'created run missing');
    const receipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      runId,
      transitionId,
    );
    if (!receipt) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'created transition missing',
      );
    }
    return transitionResult(next, undefined, receipt, true);
  }

  /**
   * @param {{state: Record<string, any>, runId: string, transitionId: string, requestDigest: string, event: Record<string, any>, nextRun: Record<string, any>, nextInvocation: Record<string, any>, nextAttempt?: Record<string, any>, currentAttempt?: Record<string, any>}} input - Fully validated existing-run transition.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Accepted or idempotently replayed transition.
   */
  async function appendOrReplay(input) {
    const existing = assertMatchingReceipt(
      input.state,
      await getTransitionReceipt(
        db,
        resolvedTableName,
        input.runId,
        input.transitionId,
      ),
      input.requestDigest,
    );
    if (existing) return existingTransitionResult(input.state, existing);

    try {
      await appendTransition(input);
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
      const raced = await readVerifiedRun(input.runId);
      if (!raced) throw new ExecutionLedgerConflictError(input.runId);
      const receipt = await getTransitionReceipt(
        db,
        resolvedTableName,
        input.runId,
        input.transitionId,
      );
      if (receipt) {
        assertMatchingReceipt(raced, receipt, input.requestDigest);
        return existingTransitionResult(raced, receipt);
      }
      throw new ExecutionLedgerConflictError(input.runId);
    }

    const next = await readVerifiedRun(input.runId);
    if (!next) {
      throw new ExecutionLedgerProjectionError(
        input.runId,
        'accepted run disappeared',
      );
    }
    const receipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      input.runId,
      input.transitionId,
    );
    if (!receipt) {
      throw new ExecutionLedgerProjectionError(
        input.runId,
        'accepted transition receipt missing',
      );
    }
    const attempt =
      typeof receipt.invocation_id === 'string' &&
      typeof receipt.attempt_id === 'string'
        ? next.attempts.get(
            attemptMapKey(receipt.invocation_id, receipt.attempt_id),
          )
        : undefined;
    return transitionResult(
      next,
      attempt,
      /** @type {Record<string, any>} */ (receipt),
      true,
    );
  }

  /**
   * Claim the next physical generation of the manual invocation. The caller
   * supplies its future-facing fence now, even though this local slice has no
   * provider-backed coordinator lease yet.
   * @param {{runId: string, invocationId: string, fencingToken: string, expectedGeneration: number, expectedVersion: number, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Claim request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Claim outcome.
   */
  async function claimInvocation(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'claimInvocation',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'fencingToken',
        'expectedGeneration',
        'expectedVersion',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'claimInvocation',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'claimInvocation.invocationId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'claimInvocation.fencingToken',
    );
    const expectedGeneration = assertNonnegativeSafeInteger(
      value.expectedGeneration,
      'claimInvocation.expectedGeneration',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const currentInvocation = state.invocations.get(invocationId);
    const attemptId = createAttemptId(
      common.runId,
      invocationId,
      expectedGeneration + 1,
    );
    const requestDigest = createTransitionRequestDigest('attempt-claimed', {
      runId: common.runId,
      invocationId,
      attemptId,
      fencingToken,
      expectedGeneration,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      actor: common.actor,
      coordinatorEpoch: common.coordinatorEpoch,
    });
    const existing = assertMatchingReceipt(
      state,
      await getTransitionReceipt(
        db,
        resolvedTableName,
        common.runId,
        common.transitionId,
      ),
      requestDigest,
    );
    if (existing) return existingTransitionResult(state, existing);
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      !currentInvocation ||
      state.run.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNABLE ||
      currentInvocation.generation !== expectedGeneration
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'invocation is not currently runnable',
      );
    }
    if (state.attempts.has(attemptMapKey(invocationId, attemptId))) {
      throw new ExecutionLedgerConflictError(common.runId, 'attempt ID reuse');
    }

    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(currentInvocation, 'current invocation'),
      status: InvocationStatus.RUNNING,
      generation: expectedGeneration + 1,
      version: currentInvocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const attempt = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: common.runId,
      invocationId,
      attemptId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      activityId: currentInvocation.activityId,
      status: AttemptStatus.CLAIMED,
      generation: nextInvocation.generation,
      version: 1,
      coordinatorEpoch: common.coordinatorEpoch,
      fencingToken,
      claimedAt: common.observedAt,
      updatedAt: common.observedAt,
      lastSequence: sequence,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'attempt-claimed',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: attempt.generation,
      },
      { run: nextRun, invocation: nextInvocation, attempt },
    );
    return await appendOrReplay({
      state,
      runId: common.runId,
      transitionId: common.transitionId,
      requestDigest,
      event,
      nextRun,
      nextInvocation,
      nextAttempt: attempt,
    });
  }

  /**
   * Persist the irreversible handler-start boundary immediately before the
   * runtime adapter receives the attempt start frame. From this point a lost
   * response is ambiguous by default and must not be replayed automatically.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Start request.
   * @returns {Promise<{applied: boolean, dispatchAuthorized: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, startFrame: Readonly<Record<string, any>>}>} - Start outcome and exact durable host frame. Only a `dispatchAuthorized: true` response may be dispatched.
   */
  async function markAttemptStarted(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'markAttemptStarted',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'markAttemptStarted',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'markAttemptStarted.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'markAttemptStarted.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'markAttemptStarted.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'markAttemptStarted.generation',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const requestDigest = createTransitionRequestDigest('attempt-started', {
      runId: common.runId,
      invocationId,
      attemptId,
      fencingToken,
      generation,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      actor: common.actor,
      coordinatorEpoch: common.coordinatorEpoch,
    });
    const existing = assertMatchingReceipt(
      state,
      await getTransitionReceipt(
        db,
        resolvedTableName,
        common.runId,
        common.transitionId,
      ),
      requestDigest,
    );
    if (existing) {
      return await startedTransitionResult(
        existingTransitionResult(state, existing),
        common.runId,
        payloadStore,
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      !invocation ||
      !attempt ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.CLAIMED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt is not currently claimable for start',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );

    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current invocation'),
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current attempt'),
      status: AttemptStatus.STARTED,
      version: attempt.version + 1,
      startedAt: common.observedAt,
      updatedAt: common.observedAt,
      lastSequence: sequence,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'attempt-started',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      { run: nextRun, invocation: nextInvocation, attempt: nextAttempt },
    );
    return await startedTransitionResult(
      await appendOrReplay({
        state,
        runId: common.runId,
        transitionId: common.transitionId,
        requestDigest,
        event,
        nextRun,
        nextInvocation,
        nextAttempt,
        currentAttempt: attempt,
      }),
      common.runId,
      payloadStore,
    );
  }

  /**
   * Atomically record a host-verified protocol terminal together with the one
   * authoritative invocation and run outcome. This is the durable authority;
   * physical worker evidence alone is never treated as a durable outcome.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, evidence: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Terminal commit request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Terminal outcome.
   */
  async function commitVerifiedAttemptTerminal(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'commitVerifiedAttemptTerminal',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'transitionId',
        'evidence',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'commitVerifiedAttemptTerminal',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'commitVerifiedAttemptTerminal.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'commitVerifiedAttemptTerminal.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'commitVerifiedAttemptTerminal.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'commitVerifiedAttemptTerminal.generation',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (!invocation || !attempt) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt does not belong to this invocation',
      );
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const verifiedEvidence = validateLedgerAttemptEvidence(
      value.evidence,
      await createLedgerAttemptStart(
        state.run,
        invocation,
        attempt,
        payloadReader,
      ),
      'commitVerifiedAttemptTerminal.evidence',
    );
    const terminal = verifiedEvidence.terminal;
    const evidence = verifiedEvidence.evidence;
    if (
      !TERMINAL_TYPES.has(terminal.type) ||
      terminal.attemptId !== attemptId
    ) {
      throw new TypeError(
        'commitVerifiedAttemptTerminal.evidence must end with a terminal for the exact persisted attempt.',
      );
    }
    assertSupportedManualTerminal(terminal, 'commitVerifiedAttemptTerminal');
    const terminalSummary = createTerminalSummary(terminal);
    const existingReceipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      common.runId,
      common.transitionId,
    );
    if (existingReceipt) {
      if (
        existingReceipt.type !== 'attempt-terminal' ||
        existingReceipt.invocation_id !== invocationId ||
        existingReceipt.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingEvent = state.events[existingReceipt.sequence - 1];
      if (
        !existingEvent ||
        existingEvent.event_id !== existingReceipt.event_id ||
        existingEvent.transition_id !== common.transitionId
      ) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'terminal receipt event is unavailable',
        );
      }
      const existingAttempt = eventSnapshots(
        existingEvent,
        common.runId,
      ).attempt;
      if (
        !existingAttempt ||
        !hasSameCanonicalJson(existingAttempt.terminal, terminalSummary) ||
        !hasSameCanonicalJson(
          await payloadReader.readEvidence(existingAttempt.evidenceRef),
          evidence,
        )
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingRequestDigest = createTransitionRequestDigest(
        'attempt-terminal',
        {
          runId: common.runId,
          invocationId,
          attemptId,
          fencingToken,
          generation,
          expectedVersion: common.expectedVersion,
          transitionId: common.transitionId,
          terminal: terminalSummary,
          evidenceRef: existingAttempt.evidenceRef,
          actor: common.actor,
          coordinatorEpoch: common.coordinatorEpoch,
        },
      );
      const existing = assertMatchingReceipt(
        state,
        existingReceipt,
        existingRequestDigest,
      );
      if (!existing) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'terminal receipt disappeared',
        );
      }
      return existingTransitionResult(state, existing);
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt cannot commit a terminal outcome',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const evidenceRef = await putVerifiedPayload(payloadStore, {
      value: evidence,
      payloadSchema: ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      label: 'commitVerifiedAttemptTerminal.evidenceRef',
    });
    const requestDigest = createTransitionRequestDigest('attempt-terminal', {
      runId: common.runId,
      invocationId,
      attemptId,
      fencingToken,
      generation,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      terminal: terminalSummary,
      evidenceRef,
      actor: common.actor,
      coordinatorEpoch: common.coordinatorEpoch,
    });
    const statuses = statusesForTerminal(terminal);
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      status: statuses.run,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current invocation'),
      status: statuses.invocation,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      terminal: terminalSummary,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current attempt'),
      status: statuses.attempt,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      terminal: terminalSummary,
      evidenceRef,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'attempt-terminal',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      { run: nextRun, invocation: nextInvocation, attempt: nextAttempt },
    );
    return await appendOrReplay({
      state,
      runId: common.runId,
      transitionId: common.transitionId,
      requestDigest,
      event,
      nextRun,
      nextInvocation,
      nextAttempt,
      currentAttempt: attempt,
    });
  }

  /**
   * Persist the conservative result of losing confidence in a begun attempt:
   * the physical attempt is abandoned, but its invocation remains durably
   * uncertain and blocks the run rather than being silently retried.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Uncertainty transition request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Uncertainty outcome.
   */
  async function markAttemptUncertain(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'markAttemptUncertain',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'transitionId',
        'reason',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'markAttemptUncertain',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'markAttemptUncertain.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'markAttemptUncertain.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'markAttemptUncertain.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'markAttemptUncertain.generation',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'markAttemptUncertain.reason',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const requestDigest = createTransitionRequestDigest(
      'attempt-became-uncertain',
      {
        runId: common.runId,
        invocationId,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    const existing = assertMatchingReceipt(
      state,
      await getTransitionReceipt(
        db,
        resolvedTableName,
        common.runId,
        common.transitionId,
      ),
      requestDigest,
    );
    if (existing) return existingTransitionResult(state, existing);
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      !invocation ||
      !attempt ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt cannot become uncertain',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      status: RunStatus.BLOCKED,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current invocation'),
      status: InvocationStatus.UNCERTAIN,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      uncertainty: reason,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current attempt'),
      status: AttemptStatus.ABANDONED,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      abandonment: reason,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'attempt-became-uncertain',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      { run: nextRun, invocation: nextInvocation, attempt: nextAttempt },
    );
    return await appendOrReplay({
      state,
      runId: common.runId,
      transitionId: common.transitionId,
      requestDigest,
      event,
      nextRun,
      nextInvocation,
      nextAttempt,
      currentAttempt: attempt,
    });
  }

  /**
   * Recover a claim that demonstrably never crossed `STARTED`. It is safe to
   * abandon the physical attempt and return its invocation to `RUNNABLE`; this
   * method deliberately refuses a begun attempt, which must become uncertain.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Safe pre-start recovery request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Recovery outcome.
   */
  async function abandonUnstartedAttempt(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'abandonUnstartedAttempt',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'transitionId',
        'reason',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'abandonUnstartedAttempt',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'abandonUnstartedAttempt.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'abandonUnstartedAttempt.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'abandonUnstartedAttempt.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'abandonUnstartedAttempt.generation',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'abandonUnstartedAttempt.reason',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const requestDigest = createTransitionRequestDigest(
      'attempt-abandoned-before-start',
      {
        runId: common.runId,
        invocationId,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    const existing = assertMatchingReceipt(
      state,
      await getTransitionReceipt(
        db,
        resolvedTableName,
        common.runId,
        common.transitionId,
      ),
      requestDigest,
    );
    if (existing) return existingTransitionResult(state, existing);
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      !invocation ||
      !attempt ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.CLAIMED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt cannot be safely abandoned',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current invocation'),
      status: InvocationStatus.RUNNABLE,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current attempt'),
      status: AttemptStatus.ABANDONED,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      abandonment: reason,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'attempt-abandoned-before-start',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      { run: nextRun, invocation: nextInvocation, attempt: nextAttempt },
    );
    return await appendOrReplay({
      state,
      runId: common.runId,
      transitionId: common.transitionId,
      requestDigest,
      event,
      nextRun,
      nextInvocation,
      nextAttempt,
      currentAttempt: attempt,
    });
  }

  /**
   * Read a bounded, redacted page of one application's durable run history.
   * The directory is only a locator: every row is matched to a fully rebuilt
   * run projection before it is returned. This is deliberately not a ready
   * queue and has no scheduling or cancellation authority.
   * @param {{appId: string, limit?: number, cursor?: string}} options - Scoped page request.
   * @returns {Promise<{items: ReturnType<typeof createRunDirectoryPageItem>[], nextCursor?: string}>} - Verified history page.
   */
  async function listRuns(options) {
    if (typeof db.queryPage !== 'function') {
      throw new Error(
        'createExecutionLedger requires a DB client with queryPage for run history.',
      );
    }
    const request = normalizeRunDirectoryPageOptions(options);
    const scope = createExecutionLedgerRunDirectoryScope({
      appId: request.appId,
    });
    const startAfter = parseRunDirectoryCursor(request.cursor, scope);
    if (startAfter !== undefined) {
      const cursorRow = await db.get({
        tableName: resolvedTableName,
        keyName: KEY_NAME,
        keyValue: scope.directoryId,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: startAfter,
        consistentRead: true,
      });
      if (!cursorRow) {
        throw new TypeError(
          'listRuns.cursor no longer identifies a durable run-history boundary.',
        );
      }
      normalizeRunDirectoryRecord(cursorRow, request.appId);
    }

    for (let retry = 0; retry < RUN_DIRECTORY_MAX_PAGE_RETRIES; retry += 1) {
      const page = await db.queryPage({
        tableName: resolvedTableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, scope.directoryId),
          {
            keyType: KEY_TYPE.SORT,
            conditionType: CONDITION_TYPE.BEGINS_WITH,
            propertyName: SORT_KEY_NAME,
            propertyValue: EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX,
          },
        ],
        limit: request.limit,
        ...(startAfter === undefined ? {} : { startAfter }),
      });
      if (
        !page ||
        typeof page !== 'object' ||
        !Array.isArray(page.items) ||
        page.items.length > request.limit
      ) {
        throw new Error('DB queryPage returned an invalid run-history page.');
      }

      /** @type {Record<string, any>[]} */
      const directories = [];
      let previousSortKey = startAfter;
      const seenRunIds = new Set();
      for (const raw of page.items) {
        const directory = normalizeRunDirectoryRecord(raw, request.appId);
        const sortKey = directory[SORT_KEY_NAME];
        if (
          (previousSortKey !== undefined &&
            comparePortablePageKeys(sortKey, previousSortKey) <= 0) ||
          seenRunIds.has(directory.ledger_run_id)
        ) {
          throw new ExecutionLedgerProjectionError(
            directory.ledger_run_id,
            'run directory page order',
          );
        }
        previousSortKey = sortKey;
        seenRunIds.add(directory.ledger_run_id);
        directories.push(directory);
      }
      const nextStartAfter = page.nextStartAfter;
      if (
        nextStartAfter !== undefined &&
        (typeof nextStartAfter !== 'string' ||
          directories.length === 0 ||
          nextStartAfter !== directories[directories.length - 1][SORT_KEY_NAME])
      ) {
        throw new Error('DB queryPage returned an invalid run-history cursor.');
      }

      try {
        for (const directory of directories) {
          const state = await readVerifiedRun(directory.ledger_run_id);
          if (!state) {
            throw new ExecutionLedgerProjectionError(
              directory.ledger_run_id,
              'directory run missing',
            );
          }
          assertRunDirectoryMatchesRun(directory, state.run);
        }
      } catch (error) {
        if (
          error instanceof ExecutionLedgerProjectionError &&
          error.reason === 'run directory disagrees with projection' &&
          retry + 1 < RUN_DIRECTORY_MAX_PAGE_RETRIES
        ) {
          continue;
        }
        throw error;
      }

      return {
        items: directories.map(createRunDirectoryPageItem),
        ...(nextStartAfter === undefined
          ? {}
          : { nextCursor: createRunDirectoryCursor(scope, nextStartAfter) }),
      };
    }

    throw new Error('Run history changed too often to read a stable page.');
  }

  /**
   * @param {string} runId - Run identity.
   * @returns {Promise<Record<string, any> | null>} - Current run projection after an event/projection verification.
   */
  async function getRun(runId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const state = await readVerifiedRun(normalizedRunId);
    return state ? cloneJsonObject(state.run, 'run') : null;
  }

  /**
   * @param {string} runId - Run identity.
   * @param {string} invocationId - Invocation identity.
   * @returns {Promise<Record<string, any> | null>} - Current invocation projection after verification.
   */
  async function getInvocation(runId, invocationId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const normalizedInvocationId = assertOpaqueId(invocationId, 'invocationId');
    const state = await readVerifiedRun(normalizedRunId);
    const invocation = state?.invocations.get(normalizedInvocationId);
    return invocation ? cloneJsonObject(invocation, 'invocation') : null;
  }

  /**
   * @param {string} runId - Run identity.
   * @param {string} invocationId - Invocation identity.
   * @param {string} attemptId - Attempt identity.
   * @returns {Promise<Record<string, any> | null>} - Current retained attempt projection after verification.
   */
  async function getAttempt(runId, invocationId, attemptId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const normalizedInvocationId = assertOpaqueId(invocationId, 'invocationId');
    const normalizedAttemptId = assertOpaqueId(attemptId, 'attemptId');
    const state = await readVerifiedRun(normalizedRunId);
    const attempt = state?.attempts.get(
      attemptMapKey(normalizedInvocationId, normalizedAttemptId),
    );
    return attempt ? cloneJsonObject(attempt, 'attempt') : null;
  }

  /**
   * @param {string} runId - Run identity.
   * @returns {Promise<Record<string, any>[]>} - Immutable event stream after verification.
   */
  async function getEvents(runId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const state = await readVerifiedRun(normalizedRunId);
    return state
      ? state.events.map((event) => cloneJsonObject(event, 'event'))
      : [];
  }

  /**
   * Verify and expose a fully rebuilt run view for recovery/inspection. A
   * projection mismatch rejects rather than authorizing any later mutation.
   * @param {string} runId - Run identity.
   * @returns {Promise<{head: Record<string, any>, run: Record<string, any>, invocations: Record<string, any>[], attempts: Record<string, any>[], events: Record<string, any>[]}|null>} - Rebuilt run view.
   */
  async function rebuildRun(runId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const state = await readVerifiedRun(normalizedRunId);
    if (!state) return null;
    return {
      head: cloneJsonObject(state.head, 'run head'),
      run: cloneJsonObject(state.run, 'run'),
      invocations: [...state.invocations.values()]
        .sort((left, right) =>
          left.invocationId < right.invocationId
            ? -1
            : left.invocationId > right.invocationId
              ? 1
              : 0,
        )
        .map((invocation) => cloneJsonObject(invocation, 'invocation')),
      attempts: [...state.attempts.values()]
        .sort((left, right) =>
          left.attemptId < right.attemptId
            ? -1
            : left.attemptId > right.attemptId
              ? 1
              : 0,
        )
        .map((attempt) => cloneJsonObject(attempt, 'attempt')),
      events: state.events.map((event) => cloneJsonObject(event, 'event')),
    };
  }

  return {
    abandonUnstartedAttempt,
    claimInvocation,
    commitVerifiedAttemptTerminal,
    createManualRun,
    getAttempt,
    getEvents,
    getInvocation,
    getRun,
    listRuns,
    markAttemptStarted,
    markAttemptUncertain,
    rebuildRun,
  };
}

/**
 * @typedef ExecutionLedgerStore
 * @property {(...args: any[]) => Promise<any>} createManualRun - Creates one idempotent manual run.
 * @property {(...args: any[]) => Promise<any>} claimInvocation - Claims the next physical generation.
 * @property {(...args: any[]) => Promise<any>} markAttemptStarted - Persists the handler-start boundary.
 * @property {(...args: any[]) => Promise<any>} commitVerifiedAttemptTerminal - Commits validated terminal evidence.
 * @property {(...args: any[]) => Promise<any>} markAttemptUncertain - Blocks a begun ambiguous attempt.
 * @property {(...args: any[]) => Promise<any>} abandonUnstartedAttempt - Safely releases an unstarted claim.
 * @property {(runId: string) => Promise<Record<string, any> | null>} getRun - Reads a verified run projection.
 * @property {(runId: string, invocationId: string) => Promise<Record<string, any> | null>} getInvocation - Reads a verified invocation projection.
 * @property {(runId: string, invocationId: string, attemptId: string) => Promise<Record<string, any> | null>} getAttempt - Reads a verified attempt projection.
 * @property {(runId: string) => Promise<Record<string, any>[]>} getEvents - Reads a verified event stream.
 * @property {(options: {appId: string, limit?: number, cursor?: string}) => Promise<{items: Record<string, any>[], nextCursor?: string}>} listRuns - Reads a verified bounded run-history page.
 * @property {(runId: string) => Promise<Record<string, any> | null>} rebuildRun - Rebuilds and verifies a whole run.
 */

export default createExecutionLedger;
