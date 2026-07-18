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
  cloneBoundedJsonObject,
  cloneJsonObject,
} from '../../../runtime/json-value.js';
import { assertLogicalId } from '../../../runtime/logical-id.js';
import {
  AttemptStatus,
  EffectStatus,
  EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES,
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_OPAQUE_ID_BYTES,
  EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS,
  EXECUTION_LEDGER_SCHEMA_VERSION,
  ExecutionLedgerConflictError,
  ExecutionLedgerNotFoundError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerRunConflictError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
  MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
  RunStatus,
  assertExactKeys,
  assertNonnegativeSafeInteger,
  assertOpaqueId,
  assertPositiveSafeInteger,
  assertSnapshotKeys,
  cloneEventPayload,
  cloneInlinePayload,
  cloneReferencedPayload,
  cloneReferencedPayloadObject,
  createManagedEffectDestinationId,
  deepFreezeJson,
  effectVerifierKey,
  hasSameCanonicalJson,
  normalizeEffectAdapterDescriptor,
  normalizeEffectDestinationDescriptor,
  normalizeEffectEvidenceVerifiers,
  normalizeEffectVerifierDescriptor,
  normalizeManagedEffectOutcome,
  normalizeManagedEffectRequest,
  normalizePayloadReference,
  normalizeReplayProperties,
  verifyManagedEffectOutcome,
  verifyPayloadBytes,
} from '../../ledger/execution-ledger-contract.js';
import {
  EXECUTION_LEDGER_SORT_KEY_PREFIX,
  getAttemptProjectionSortKey,
  getEffectProjectionSortKey,
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

export {
  AttemptStatus,
  EffectStatus,
  EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES,
  EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_OPAQUE_ID_BYTES,
  EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
  EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS,
  EXECUTION_LEDGER_SCHEMA_VERSION,
  ExecutionLedgerConflictError,
  ExecutionLedgerNotFoundError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerRunConflictError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
  createManagedEffectDestinationId,
};

/**
 * The V7 ledger deliberately covers one manual, single-activity invocation
 * plus its explicitly managed effects. It is the only writable durable run
 * boundary. Its table write authority is a trusted control-plane boundary:
 * content IDs and request digests detect inconsistent records, but are not
 * signatures against a writer that can replace an entire semantically valid
 * history.
 */
// V7 intentionally does not read v1-v6 records. V7 compound stopped-attempt
// settlement and CANCELLED effects cannot be interpreted by singular V6 folds.

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const RUN_DIRECTORY_RECORD_TYPE = 'execution_ledger_run_directory';
const RUN_DIRECTORY_RUN_KIND = 'manual';
const RUN_DIRECTORY_CURSOR_SCHEMA_VERSION = 5;
const RUN_DIRECTORY_DEFAULT_PAGE_SIZE = 50;
const RUN_DIRECTORY_MAX_PAGE_SIZE = 100;
const RUN_DIRECTORY_MAX_PAGE_RETRIES = 3;
const EVENT_TYPES = new Set([
  'manual-run-created',
  'manual-cancellation-requested',
  'attempt-claimed',
  'attempt-started',
  'attempt-terminal',
  'attempt-abandoned-before-start',
  'attempt-became-uncertain',
  'uncertain-attempt-reconciled',
  'effect-requested',
  'effect-started',
  'effect-completed',
  'effect-failed',
  'effect-became-uncertain',
]);
const TERMINAL_TYPES = new Set(ACTIVITY_PROTOCOL_TERMINAL_TYPES);
const SUPPORTED_MANUAL_TERMINAL_TYPES = new Set([
  'completed',
  'failed',
  'cancelled',
  'protocol-failed',
]);
const MANUAL_REQUEST_PAYLOAD_SCHEMA = 'wharfie.execution.manual-request.v1';
const ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA =
  'wharfie.execution.activity-evidence.v1';
const UNCERTAIN_ATTEMPT_RECONCILIATION_VERIFIER = Object.freeze({
  kind: 'wharfie.activity-protocol',
  protocol: ACTIVITY_PROTOCOL_NAME,
  protocolVersion: ACTIVITY_PROTOCOL_VERSION,
});
const DEFAULT_PRE_START_EFFECT_CANCELLATION = Object.freeze({
  kind: 'managed-effect-cancelled-before-start',
  phase: 'before-durable-effect-start',
});
const STOPPED_ATTEMPT_SETTLEMENT_REASON_MAX_BYTES = 2 * 1024;
const STOPPED_ATTEMPT_SETTLEMENT_REASON_RESERVE = Object.freeze({
  message: 'x'.repeat(STOPPED_ATTEMPT_SETTLEMENT_REASON_MAX_BYTES),
});
/**
 * @typedef {import('../base.js').DBClient} DBClient
 */
/**
 * @typedef {{applied: boolean, outcome: 'cancellation-requested'|'terminal-authoritative'|'outcome-uncertain', receipt?: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} ManualCancellationResult
 */

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
 * @param {unknown} value - Candidate actor.
 * @returns {{kind: string, id: string}} - Validated actor.
 */
function normalizeActor(value) {
  const actor = cloneBoundedJsonObject(
    value === undefined ? { kind: 'local', id: 'local' } : value,
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
 * Normalize one durable cancellation reason through the Activity Protocol
 * host-frame validator. Persisting the exact protocol shape lets replay prove
 * that a later physical `cancelled` terminal was authorized by this decision.
 * @param {unknown} value - Candidate structured Activity Protocol error.
 * @param {string} label - Human-readable value path.
 * @returns {{code: string, name: string, message: string, details: Record<string, any>}} - Strict cancellation reason.
 */
function normalizeCancellationReason(value, label) {
  const reason = cloneInlinePayload(value, label);
  const frame = validateActivityProtocolHostFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'cancel',
      attemptId: 'cancellation-reason-validation',
      reason,
    },
    label,
  );
  return /** @type {{code: string, name: string, message: string, details: Record<string, any>}} */ (
    cloneInlinePayload(frame.reason, label)
  );
}

/**
 * @param {unknown} value - Candidate retained cancellation request.
 * @param {string} label - Human-readable value path.
 * @returns {{requestId: string, transitionId: string, requestedAt: number, actor: {kind: string, id: string}, reason: {code: string, name: string, message: string, details: Record<string, any>}}} - Strict cancellation request.
 */
function normalizeCancellationRequest(value, label) {
  const request = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    request,
    ['requestId', 'transitionId', 'requestedAt', 'actor', 'reason'],
    label,
  );
  return {
    requestId: assertOpaqueId(request.requestId, `${label}.requestId`),
    transitionId: assertOpaqueId(request.transitionId, `${label}.transitionId`),
    requestedAt: normalizeObservedAt(
      request.requestedAt,
      `${label}.requestedAt`,
    ),
    actor: normalizeActor(request.actor),
    reason: normalizeCancellationReason(request.reason, `${label}.reason`),
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
  const expectedValue = deepFreezeJson(
    cloneReferencedPayload(input.value, `${input.label} expected value`),
  );
  const providerValue = deepFreezeJson(
    cloneReferencedPayload(expectedValue, `${input.label} provider value`),
  );
  const reference = normalizePayloadReference(
    await payloadStore.putJson({
      value: providerValue,
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
  if (!hasSameCanonicalJson(verified.value, expectedValue)) {
    throw new TypeError(`${input.label} verification changed its payload.`);
  }
  return reference;
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
 * Normalize the immutable evidence-backed decision that resolves one retained
 * uncertain attempt. The verifier is deliberately fixed in V7: accepting a
 * caller-selected verifier would make the durable event claim semantics that
 * this ledger does not actually implement.
 * @param {unknown} value - Candidate reconciliation event payload.
 * @param {string} label - Human-readable value path.
 * @returns {{reconciliationId: string, invocationId: string, attemptId: string, generation: number, coordinatorEpoch: number, fencingToken: string, uncertaintyEventId: string, uncertaintySequence: number, verifier: {kind: 'wharfie.activity-protocol', protocol: string, protocolVersion: number}, evidenceRef: Readonly<import('../../../runtime/execution-payload.js').ExecutionPayloadReference>, terminal: {type: string, attemptId: string}, reason: any}} - Strict reconciliation proof reference.
 */
function normalizeUncertainAttemptReconciliation(value, label) {
  const reconciliation = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    reconciliation,
    [
      'reconciliationId',
      'invocationId',
      'attemptId',
      'generation',
      'coordinatorEpoch',
      'fencingToken',
      'uncertaintyEventId',
      'uncertaintySequence',
      'verifier',
      'evidenceRef',
      'terminal',
      'reason',
    ],
    label,
  );
  const verifier = cloneBoundedJsonObject(
    reconciliation.verifier,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    `${label}.verifier`,
  );
  assertExactKeys(
    verifier,
    ['kind', 'protocol', 'protocolVersion'],
    `${label}.verifier`,
  );
  if (
    !hasSameCanonicalJson(verifier, UNCERTAIN_ATTEMPT_RECONCILIATION_VERIFIER)
  ) {
    throw new TypeError(`${label}.verifier is not supported.`);
  }
  const terminal = normalizeTerminalSummary(
    reconciliation.terminal,
    `${label}.terminal`,
  );
  if (!SUPPORTED_MANUAL_TERMINAL_TYPES.has(terminal.type)) {
    throw new TypeError(`${label}.terminal.type is not supported.`);
  }
  return {
    reconciliationId: assertOpaqueId(
      reconciliation.reconciliationId,
      `${label}.reconciliationId`,
    ),
    invocationId: assertOpaqueId(
      reconciliation.invocationId,
      `${label}.invocationId`,
    ),
    attemptId: assertOpaqueId(reconciliation.attemptId, `${label}.attemptId`),
    generation: assertPositiveSafeInteger(
      reconciliation.generation,
      `${label}.generation`,
    ),
    coordinatorEpoch: assertNonnegativeSafeInteger(
      reconciliation.coordinatorEpoch,
      `${label}.coordinatorEpoch`,
    ),
    fencingToken: assertOpaqueId(
      reconciliation.fencingToken,
      `${label}.fencingToken`,
    ),
    uncertaintyEventId: assertOpaqueId(
      reconciliation.uncertaintyEventId,
      `${label}.uncertaintyEventId`,
    ),
    uncertaintySequence: assertPositiveSafeInteger(
      reconciliation.uncertaintySequence,
      `${label}.uncertaintySequence`,
    ),
    verifier:
      /** @type {{kind: 'wharfie.activity-protocol', protocol: string, protocolVersion: number}} */ (
        cloneInlinePayload(
          UNCERTAIN_ATTEMPT_RECONCILIATION_VERIFIER,
          `${label}.verifier`,
        )
      ),
    evidenceRef: normalizePayloadReference(
      reconciliation.evidenceRef,
      ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      `${label}.evidenceRef`,
    ),
    terminal,
    reason: cloneInlinePayload(reconciliation.reason, `${label}.reason`),
  };
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
 * @param {string} runId - Run identity.
 * @param {Record<string, any>} data - Effect projection.
 * @returns {Record<string, any>} - Effect projection record.
 */
function createEffectProjectionRecord(runId, data) {
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getEffectProjectionSortKey(
      data.invocationId,
      data.effectId,
    ),
    record_type: 'execution_ledger_effect_projection',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    invocation_id: data.invocationId,
    effect_id: data.effectId,
    destination_effect_id: data.destinationEffectId,
    status: data.status,
    version: data.version,
    revision_id: data.revisionId,
    data: cloneInlinePayload(data, 'effect projection'),
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
    domain: 'wharfie:execution-ledger-event:v7',
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
  const effect = event.payload?.effect;
  const reconciliation = event.payload?.reconciliation;
  const target = effect || attempt || reconciliation;
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
    ...(target
      ? {
          invocation_id: target.invocationId,
          ...(attempt || reconciliation
            ? { attempt_id: (attempt || reconciliation).attemptId }
            : effect.requestedBy
              ? { attempt_id: effect.requestedBy.attemptId }
              : {}),
          ...(effect ? { effect_id: effect.effectId } : {}),
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
 * @param {string} invocationId - Invocation identity.
 * @param {string} effectId - Effect identity scoped to the invocation.
 * @returns {string} - Collision-free in-memory lookup key.
 */
function effectMapKey(invocationId, effectId) {
  return JSON.stringify([invocationId, effectId]);
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
  assertSnapshotKeys(
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
    ['cancellationRequest'],
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
  const hasCancellationRequest = Object.prototype.hasOwnProperty.call(
    value,
    'cancellationRequest',
  );
  if (value.status === RunStatus.CANCELLED && !hasCancellationRequest) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'cancelled run lacks cancellation request',
    );
  }
  if (hasCancellationRequest) {
    value.cancellationRequest = normalizeCancellationRequest(
      value.cancellationRequest,
      'run projection cancellationRequest',
    );
  }
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
    ['terminal', 'uncertainty', 'cancellationRequest'],
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
  const hasCancellationRequest = Object.prototype.hasOwnProperty.call(
    value,
    'cancellationRequest',
  );
  if (
    ([InvocationStatus.RUNNABLE, InvocationStatus.RUNNING].includes(
      value.status,
    ) &&
      (hasTerminal || hasUncertainty)) ||
    (value.status === InvocationStatus.UNCERTAIN &&
      (!hasUncertainty || hasTerminal)) ||
    ([InvocationStatus.COMPLETED, InvocationStatus.FAILED].includes(
      value.status,
    ) &&
      (!hasTerminal || hasUncertainty)) ||
    (value.status === InvocationStatus.CANCELLED &&
      (!hasCancellationRequest || hasUncertainty))
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
  if (hasCancellationRequest) {
    value.cancellationRequest = normalizeCancellationRequest(
      value.cancellationRequest,
      'invocation projection cancellationRequest',
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
    [
      'startedAt',
      'terminal',
      'evidenceRef',
      'abandonment',
      'cancellationRequest',
    ],
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
  const hasCancellationRequest = Object.prototype.hasOwnProperty.call(
    value,
    'cancellationRequest',
  );
  if (
    (value.status === AttemptStatus.CLAIMED &&
      (hasStartedAt ||
        hasTerminal ||
        hasEvidenceRef ||
        hasAbandonment ||
        hasCancellationRequest)) ||
    (value.status === AttemptStatus.STARTED &&
      (!hasStartedAt || hasTerminal || hasEvidenceRef || hasAbandonment)) ||
    ([AttemptStatus.COMPLETED, AttemptStatus.FAILED].includes(value.status) &&
      (!hasStartedAt || !hasTerminal || !hasEvidenceRef || hasAbandonment)) ||
    (value.status === AttemptStatus.CANCELLED &&
      (!hasCancellationRequest ||
        hasAbandonment ||
        hasStartedAt !== hasTerminal ||
        hasTerminal !== hasEvidenceRef)) ||
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
  if (hasCancellationRequest) {
    value.cancellationRequest = normalizeCancellationRequest(
      value.cancellationRequest,
      'attempt projection cancellationRequest',
    );
  }
  return value;
}

/**
 * @param {unknown} value - Candidate physical attempt binding retained by an effect.
 * @param {string} label - Human-readable boundary label.
 * @param {boolean} includeProtocolSequence - Whether the request frame sequence is required.
 * @returns {{attemptId: string, generation: number, coordinatorEpoch: number, fencingToken: string, protocolSequence?: number}} - Strict attempt binding.
 */
function normalizeEffectAttemptBinding(value, label, includeProtocolSequence) {
  const binding = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    binding,
    [
      'attemptId',
      'generation',
      'coordinatorEpoch',
      'fencingToken',
      ...(includeProtocolSequence ? ['protocolSequence'] : []),
    ],
    label,
  );
  return {
    attemptId: assertOpaqueId(binding.attemptId, `${label}.attemptId`),
    generation: assertPositiveSafeInteger(
      binding.generation,
      `${label}.generation`,
    ),
    coordinatorEpoch: assertNonnegativeSafeInteger(
      binding.coordinatorEpoch,
      `${label}.coordinatorEpoch`,
    ),
    fencingToken: assertOpaqueId(binding.fencingToken, `${label}.fencingToken`),
    ...(includeProtocolSequence
      ? {
          protocolSequence: assertPositiveSafeInteger(
            binding.protocolSequence,
            `${label}.protocolSequence`,
          ),
        }
      : {}),
  };
}

/**
 * @param {unknown} value - Candidate effect terminal summary.
 * @param {string} label - Human-readable boundary label.
 * @returns {{ok: boolean}} - Strict redacted outcome summary.
 */
function normalizeEffectTerminal(value, label) {
  const terminal = cloneInlinePayload(value, label);
  assertExactKeys(terminal, ['ok'], label);
  if (terminal.ok !== true && terminal.ok !== false) {
    throw new TypeError(`${label}.ok must be a boolean.`);
  }
  return { ok: terminal.ok };
}

/**
 * @param {Record<string, any>} effect - Candidate managed-effect projection.
 * @param {string} runId - Expected run identity.
 * @returns {Record<string, any>} - Strict cloned effect snapshot.
 */
function normalizeEffectSnapshot(effect, runId) {
  const value = cloneBoundedJsonObject(
    effect,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'effect snapshot',
  );
  assertSnapshotKeys(
    value,
    [
      'schemaVersion',
      'runId',
      'invocationId',
      'effectId',
      'appId',
      'revisionId',
      'activityId',
      'destinationEffectId',
      'adapter',
      'destination',
      'verifier',
      'requestRef',
      'requestedReplayProperties',
      'substantiatedReplayProperties',
      'requestedBy',
      'status',
      'version',
      'lastSequence',
      'createdAt',
      'updatedAt',
    ],
    ['startedBy', 'terminal', 'outcomeRef', 'cancellation', 'uncertainty'],
    'effect snapshot',
  );
  if (value.schemaVersion !== EXECUTION_LEDGER_SCHEMA_VERSION) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'unsupported effect schema',
    );
  }
  if (value.runId !== runId) {
    throw new ExecutionLedgerProjectionError(runId, 'effect run identity');
  }
  assertOpaqueId(value.invocationId, 'effect projection invocationId');
  assertOpaqueId(value.effectId, 'effect projection effectId');
  assertLogicalId(value.appId, 'effect projection appId');
  assertApplicationRevisionId(value.revisionId, 'effect projection revisionId');
  assertLogicalId(value.activityId, 'effect projection activityId');
  value.destinationEffectId = assertOpaqueId(
    value.destinationEffectId,
    'effect projection destinationEffectId',
  );
  if (
    value.destinationEffectId !==
    createManagedEffectDestinationId({
      appId: value.appId,
      runId,
      invocationId: value.invocationId,
      effectId: value.effectId,
    })
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'effect destination identity',
    );
  }
  value.adapter = normalizeEffectAdapterDescriptor(
    value.adapter,
    'effect projection adapter',
  );
  value.destination = normalizeEffectDestinationDescriptor(
    value.destination,
    'effect projection destination',
  );
  value.verifier = normalizeEffectVerifierDescriptor(
    value.verifier,
    'effect projection verifier',
  );
  value.requestRef = normalizePayloadReference(
    value.requestRef,
    MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
    'effect projection requestRef',
  );
  value.requestedReplayProperties = normalizeReplayProperties(
    value.requestedReplayProperties,
    'effect projection requestedReplayProperties',
  );
  value.substantiatedReplayProperties = normalizeReplayProperties(
    value.substantiatedReplayProperties,
    'effect projection substantiatedReplayProperties',
  );
  if (
    !value.requestedReplayProperties.includes('unsafe') &&
    value.requestedReplayProperties.some(
      (/** @type {string} */ property) =>
        !value.substantiatedReplayProperties.includes(property),
    )
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'effect replay properties are not substantiated',
    );
  }
  value.requestedBy = normalizeEffectAttemptBinding(
    value.requestedBy,
    'effect projection requestedBy',
    true,
  );
  if (!Object.values(EffectStatus).includes(value.status)) {
    throw new ExecutionLedgerProjectionError(runId, 'effect projection status');
  }
  assertPositiveSafeInteger(value.version, 'effect projection version');
  assertPositiveSafeInteger(value.lastSequence, 'effect projection sequence');
  normalizeObservedAt(value.createdAt, 'effect projection createdAt');
  normalizeObservedAt(value.updatedAt, 'effect projection updatedAt');
  const hasStartedBy = Object.prototype.hasOwnProperty.call(value, 'startedBy');
  const hasTerminal = Object.prototype.hasOwnProperty.call(value, 'terminal');
  const hasOutcomeRef = Object.prototype.hasOwnProperty.call(
    value,
    'outcomeRef',
  );
  const hasUncertainty = Object.prototype.hasOwnProperty.call(
    value,
    'uncertainty',
  );
  const hasCancellation = Object.prototype.hasOwnProperty.call(
    value,
    'cancellation',
  );
  if (
    (value.status === EffectStatus.PENDING &&
      (hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty)) ||
    (value.status === EffectStatus.STARTED &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty)) ||
    ([EffectStatus.COMPLETED, EffectStatus.FAILED].includes(value.status) &&
      (!hasStartedBy ||
        !hasTerminal ||
        !hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty)) ||
    (value.status === EffectStatus.CANCELLED &&
      (hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        !hasCancellation ||
        hasUncertainty)) ||
    (value.status === EffectStatus.UNCERTAIN &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        !hasUncertainty))
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid effect lifecycle fields',
    );
  }
  if (hasStartedBy) {
    value.startedBy = normalizeEffectAttemptBinding(
      value.startedBy,
      'effect projection startedBy',
      false,
    );
  }
  if (hasTerminal) {
    value.terminal = normalizeEffectTerminal(
      value.terminal,
      'effect projection terminal',
    );
    if (
      (value.status === EffectStatus.COMPLETED) !==
      (value.terminal.ok === true)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect terminal does not match status',
      );
    }
  }
  if (hasOutcomeRef) {
    value.outcomeRef = normalizePayloadReference(
      value.outcomeRef,
      MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      'effect projection outcomeRef',
    );
  }
  if (hasCancellation) {
    value.cancellation = cloneInlinePayload(
      value.cancellation,
      'effect projection cancellation',
    );
  }
  if (hasUncertainty) {
    value.uncertainty = cloneInlinePayload(
      value.uncertainty,
      'effect projection uncertainty',
    );
  }
  return value;
}

/**
 * Reserve enough encoded event space to close every currently unresolved
 * effect in one future stopped-attempt settlement. The synthetic event uses a
 * maximum-sized settlement reason for the aggregate and every effect, making
 * the admission check conservative while the real event remains exactly
 * checked by cloneEventPayload.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, effects: Record<string, any>[], label: string}} input - Prospective live STARTED attempt state.
 * @returns {void}
 */
function assertStoppedAttemptClosureFits(input) {
  const unresolved = input.effects
    .filter((effect) =>
      [EffectStatus.PENDING, EffectStatus.STARTED].includes(effect.status),
    )
    .sort((left, right) =>
      left.effectId < right.effectId
        ? -1
        : left.effectId > right.effectId
          ? 1
          : 0,
    );
  if (unresolved.length > EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS) {
    throw new RangeError(
      `${input.label} exceeds the stopped-attempt managed-effect limit.`,
    );
  }
  // Use maximum-width safe integers so crossing a decimal digit boundary
  // cannot make a later admitted closure larger than this reservation.
  const sequence = Number.MAX_SAFE_INTEGER;
  const observedAt = Number.MAX_SAFE_INTEGER;
  const run = {
    ...cloneJsonObject(input.run, `${input.label} run reserve`),
    status: RunStatus.BLOCKED,
    version: Number.MAX_SAFE_INTEGER,
    lastSequence: sequence,
    updatedAt: observedAt,
  };
  const invocation = {
    ...cloneJsonObject(input.invocation, `${input.label} invocation reserve`),
    status: InvocationStatus.UNCERTAIN,
    uncertainty: STOPPED_ATTEMPT_SETTLEMENT_REASON_RESERVE,
    version: Number.MAX_SAFE_INTEGER,
    lastSequence: sequence,
    updatedAt: observedAt,
  };
  const attempt = {
    ...cloneJsonObject(input.attempt, `${input.label} attempt reserve`),
    status: AttemptStatus.ABANDONED,
    abandonment: STOPPED_ATTEMPT_SETTLEMENT_REASON_RESERVE,
    version: Number.MAX_SAFE_INTEGER,
    lastSequence: sequence,
    updatedAt: observedAt,
  };
  const effects = unresolved.map((effect) => ({
    ...cloneJsonObject(effect, `${input.label} effect reserve`),
    status:
      effect.status === EffectStatus.PENDING
        ? EffectStatus.CANCELLED
        : EffectStatus.UNCERTAIN,
    ...(effect.status === EffectStatus.PENDING
      ? { cancellation: STOPPED_ATTEMPT_SETTLEMENT_REASON_RESERVE }
      : { uncertainty: STOPPED_ATTEMPT_SETTLEMENT_REASON_RESERVE }),
    version: Number.MAX_SAFE_INTEGER,
    lastSequence: sequence,
    updatedAt: observedAt,
  }));
  cloneInlinePayload(run, `${input.label} run closure reserve`);
  cloneInlinePayload(invocation, `${input.label} invocation closure reserve`);
  cloneInlinePayload(attempt, `${input.label} attempt closure reserve`);
  for (const effect of effects) {
    cloneInlinePayload(effect, `${input.label} effect closure reserve`);
  }
  cloneEventPayload(
    { run, invocation, attempt, effects },
    `${input.label} stopped-attempt closure reserve`,
  );
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
 * @param {Record<string, any>} effect - Effect snapshot.
 * @param {Record<string, any>} run - Run snapshot.
 * @param {Record<string, any>} invocation - Invocation snapshot.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertEffectBelongsToInvocation(effect, run, invocation, runId) {
  if (
    effect.runId !== run.runId ||
    effect.runId !== runId ||
    effect.invocationId !== invocation.invocationId ||
    effect.appId !== run.appId ||
    effect.appId !== invocation.appId ||
    effect.revisionId !== run.revisionId ||
    effect.revisionId !== invocation.revisionId ||
    effect.activityId !== invocation.activityId
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'effect immutable identity mismatch',
    );
  }
}

/**
 * @param {Record<string, any>} prior - Previous effect snapshot.
 * @param {Record<string, any>} next - Candidate next effect snapshot.
 * @param {Record<string, any>} event - Current event record.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertEffectAdvance(prior, next, event, runId) {
  if (
    next.runId !== prior.runId ||
    next.invocationId !== prior.invocationId ||
    next.effectId !== prior.effectId ||
    next.appId !== prior.appId ||
    next.revisionId !== prior.revisionId ||
    next.activityId !== prior.activityId ||
    next.destinationEffectId !== prior.destinationEffectId ||
    !hasSameCanonicalJson(next.adapter, prior.adapter) ||
    !hasSameCanonicalJson(next.destination, prior.destination) ||
    !hasSameCanonicalJson(next.verifier, prior.verifier) ||
    !hasSameCanonicalJson(next.requestRef, prior.requestRef) ||
    !hasSameCanonicalJson(
      next.requestedReplayProperties,
      prior.requestedReplayProperties,
    ) ||
    !hasSameCanonicalJson(
      next.substantiatedReplayProperties,
      prior.substantiatedReplayProperties,
    ) ||
    !hasSameCanonicalJson(next.requestedBy, prior.requestedBy) ||
    next.createdAt !== prior.createdAt ||
    next.version !== prior.version + 1 ||
    next.lastSequence !== event.sequence ||
    next.updatedAt !== event.observed_at
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid effect transition',
    );
  }
}

/**
 * @param {Record<string, any>} left - Prior projection snapshot.
 * @param {Record<string, any>} right - Next projection snapshot.
 * @returns {boolean} - Whether both snapshots retain the same cancellation request.
 */
function hasSameCancellationRequest(left, right) {
  const leftHas = Object.prototype.hasOwnProperty.call(
    left,
    'cancellationRequest',
  );
  const rightHas = Object.prototype.hasOwnProperty.call(
    right,
    'cancellationRequest',
  );
  return (
    leftHas === rightHas &&
    (!leftHas ||
      hasSameCanonicalJson(left.cancellationRequest, right.cancellationRequest))
  );
}

/**
 * Compare selected optional lifecycle fields without treating absence as an
 * alias for an explicit undefined value. Cancellation may add its own request
 * metadata, but it must never manufacture or rewrite physical evidence.
 * @param {Record<string, any>} left - Prior projection snapshot.
 * @param {Record<string, any>} right - Next projection snapshot.
 * @param {string[]} fields - Optional lifecycle fields to preserve exactly.
 * @returns {boolean} - Whether field presence and canonical values match.
 */
function hasSameOptionalFields(left, right, fields) {
  return fields.every((field) => {
    const leftHas = Object.prototype.hasOwnProperty.call(left, field);
    const rightHas = Object.prototype.hasOwnProperty.call(right, field);
    return (
      leftHas === rightHas &&
      (!leftHas || hasSameCanonicalJson(left[field], right[field]))
    );
  });
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
      'effect_id',
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
  if (Object.prototype.hasOwnProperty.call(receipt, 'effect_id')) {
    if (!hasInvocation) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect receipt lacks attempt identity',
      );
    }
    assertOpaqueId(receipt.effect_id, 'transition receipt effect');
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
 * @returns {{run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[], reconciliation?: ReturnType<typeof normalizeUncertainAttemptReconciliation>}} - Event projection snapshots.
 */
function eventSnapshots(event, runId) {
  const payload = cloneBoundedJsonObject(
    event.payload,
    EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
    'event payload',
  );
  if (event.type === 'manual-cancellation-requested') {
    assertSnapshotKeys(
      payload,
      ['run', 'invocation'],
      ['attempt'],
      'event payload',
    );
  } else if (event.type === 'uncertain-attempt-reconciled') {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'reconciliation'],
      'event payload',
    );
  } else if (event.type === 'attempt-became-uncertain') {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'attempt', 'effects'],
      'event payload',
    );
  } else if (event.type.startsWith('effect-')) {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'attempt', 'effect'],
      'event payload',
    );
  } else {
    assertExactKeys(
      payload,
      event.type === 'manual-run-created'
        ? ['run', 'invocation']
        : ['run', 'invocation', 'attempt'],
      'event payload',
    );
  }
  const run = normalizeRunSnapshot(payload.run, runId);
  const invocation = normalizeInvocationSnapshot(payload.invocation, runId);
  /** @type {{run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[], reconciliation?: ReturnType<typeof normalizeUncertainAttemptReconciliation>}} */
  const result = { run, invocation };
  if (Object.prototype.hasOwnProperty.call(payload, 'attempt')) {
    result.attempt = normalizeAttemptSnapshot(payload.attempt, runId);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'effect')) {
    result.effect = normalizeEffectSnapshot(payload.effect, runId);
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'effects')) {
    if (!Array.isArray(payload.effects)) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'attempt uncertainty effects are not an array',
      );
    }
    if (
      payload.effects.length > EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'attempt uncertainty effect count exceeds limit',
      );
    }
    result.effects = payload.effects.map((item) =>
      normalizeEffectSnapshot(item, runId),
    );
    const effectIds = result.effects.map((item) => item.effectId);
    const sortedEffectIds = [...effectIds].sort();
    if (
      new Set(effectIds).size !== effectIds.length ||
      !hasSameCanonicalJson(effectIds, sortedEffectIds)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'attempt uncertainty effects are not canonical',
      );
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'reconciliation')) {
    result.reconciliation = normalizeUncertainAttemptReconciliation(
      payload.reconciliation,
      'event payload reconciliation',
    );
  }
  return result;
}

/**
 * Prove that a reconciliation addresses the retained uncertainty boundary for
 * this exact attempt. A later terminal may only resolve the current blocked
 * state; it cannot cite an arbitrary historical abandonment or relabel a
 * different physical attempt.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, reconciliation: {invocationId: string, attemptId: string, generation: number, coordinatorEpoch: number, fencingToken: string, uncertaintyEventId: string, uncertaintySequence: number}, uncertaintyEvent?: Record<string, any>, runId: string}} input - Current state and claimed uncertainty evidence.
 * @returns {boolean} - Whether the retained uncertainty event is exact.
 */
function hasExactUncertaintyEventLink(input) {
  const { run, invocation, attempt, reconciliation, uncertaintyEvent, runId } =
    input;
  if (
    !uncertaintyEvent ||
    uncertaintyEvent.type !== 'attempt-became-uncertain' ||
    uncertaintyEvent.sequence !== reconciliation.uncertaintySequence ||
    uncertaintyEvent.event_id !== reconciliation.uncertaintyEventId ||
    uncertaintyEvent.sequence !== run.lastSequence ||
    uncertaintyEvent.fence.coordinatorEpoch !==
      reconciliation.coordinatorEpoch ||
    uncertaintyEvent.fence.invocationGeneration !== reconciliation.generation
  ) {
    return false;
  }
  const snapshots = eventSnapshots(uncertaintyEvent, runId);
  const uncertaintyAttempt = snapshots.attempt;
  if (!uncertaintyAttempt) return false;
  return (
    snapshots.run.status === RunStatus.BLOCKED &&
    snapshots.invocation.status === InvocationStatus.UNCERTAIN &&
    uncertaintyAttempt.status === AttemptStatus.ABANDONED &&
    snapshots.invocation.invocationId === reconciliation.invocationId &&
    uncertaintyAttempt.invocationId === reconciliation.invocationId &&
    uncertaintyAttempt.attemptId === reconciliation.attemptId &&
    uncertaintyAttempt.generation === reconciliation.generation &&
    uncertaintyAttempt.coordinatorEpoch === reconciliation.coordinatorEpoch &&
    uncertaintyAttempt.fencingToken === reconciliation.fencingToken &&
    hasSameCanonicalJson(
      snapshots.invocation.uncertainty,
      uncertaintyAttempt.abandonment,
    ) &&
    hasSameCanonicalJson(invocation.uncertainty, attempt.abandonment) &&
    sameSnapshot(snapshots.run, run) &&
    sameSnapshot(snapshots.invocation, invocation) &&
    sameSnapshot(uncertaintyAttempt, attempt)
  );
}

/**
 * Recompute the semantic idempotency digest from the immutable event and the
 * prior folded state. Event IDs bind a stored digest, but this check binds the
 * digest itself to the transition it claims to represent.
 * @param {Record<string, any>} event - Event being folded.
 * @param {Record<string, any> | undefined} currentRun - Prior run snapshot.
 * @param {Record<string, any> | undefined} currentInvocation - Prior invocation snapshot.
 * @param {Record<string, any> | undefined} currentAttempt - Prior attempt snapshot.
 * @param {Record<string, any> | undefined} currentEffect - Prior effect snapshot.
 * @param {Map<string, Record<string, any>>} currentEffectsForAttempt - Prior compound effect snapshots by logical ID.
 * @param {Record<string, any>} run - Next run snapshot.
 * @param {Record<string, any>} invocation - Next invocation snapshot.
 * @param {Record<string, any> | undefined} attempt - Next attempt snapshot.
 * @param {Record<string, any> | undefined} effect - Next effect snapshot.
 * @param {Record<string, any>[] | undefined} effects - Next compound effect snapshots.
 * @param {ReturnType<typeof normalizeUncertainAttemptReconciliation> | undefined} reconciliation - Reconciliation payload for an event that deliberately retains its attempt unchanged.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertEventRequestDigest(
  event,
  currentRun,
  currentInvocation,
  currentAttempt,
  currentEffect,
  currentEffectsForAttempt,
  run,
  invocation,
  attempt,
  effect,
  effects,
  reconciliation,
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
  } else if (event.type === 'manual-cancellation-requested') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      expectedGeneration: currentInvocation?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      requestId: run.cancellationRequest?.requestId,
      reason: run.cancellationRequest?.reason,
      actor: event.actor,
      coordinatorEpoch: event.fence.coordinatorEpoch,
      ...(attempt
        ? {
            attemptId: attempt.attemptId,
            fencingToken: attempt.fencingToken,
          }
        : {}),
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
  } else if (event.type === 'attempt-became-uncertain') {
    const decisions = (effects || []).map((nextEffect) => {
      const priorEffect = currentEffectsForAttempt.get(nextEffect.effectId);
      /** @type {Record<string, any>} */
      const decision = {
        effectId: nextEffect.effectId,
        expectedEffectVersion: priorEffect?.version,
      };
      if (
        priorEffect?.status === EffectStatus.PENDING &&
        nextEffect.status === EffectStatus.CANCELLED
      ) {
        decision.disposition = 'cancelled-before-start';
        decision.reason = nextEffect.cancellation;
      } else if (
        priorEffect?.status === EffectStatus.STARTED &&
        [EffectStatus.COMPLETED, EffectStatus.FAILED].includes(
          nextEffect.status,
        )
      ) {
        decision.disposition = 'outcome-recovered';
        decision.outcomeRef = nextEffect.outcomeRef;
      } else if (
        priorEffect?.status === EffectStatus.STARTED &&
        nextEffect.status === EffectStatus.UNCERTAIN
      ) {
        decision.disposition = 'outcome-uncertain';
        decision.reason = nextEffect.uncertainty;
      }
      return decision;
    });
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      decisions,
      reason: attempt?.abandonment,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-requested') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      protocolSequence: effect?.requestedBy.protocolSequence,
      requestRef: effect?.requestRef,
      adapter: effect?.adapter,
      destination: effect?.destination,
      verifier: effect?.verifier,
      substantiatedReplayProperties: effect?.substantiatedReplayProperties,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-started') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      expectedEffectVersion: currentEffect?.version,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (
    event.type === 'effect-completed' ||
    event.type === 'effect-failed'
  ) {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      expectedEffectVersion: currentEffect?.version,
      outcomeRef: effect?.outcomeRef,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-became-uncertain') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      expectedEffectVersion: currentEffect?.version,
      reason: effect?.uncertainty,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'uncertain-attempt-reconciled') {
    value = {
      runId,
      invocationId: reconciliation?.invocationId,
      attemptId: reconciliation?.attemptId,
      fencingToken: reconciliation?.fencingToken,
      generation: reconciliation?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      reconciliationId: reconciliation?.reconciliationId,
      uncertaintyEventId: reconciliation?.uncertaintyEventId,
      uncertaintySequence: reconciliation?.uncertaintySequence,
      verifier: reconciliation?.verifier,
      evidenceRef: reconciliation?.evidenceRef,
      terminal: reconciliation?.terminal,
      reason: reconciliation?.reason,
      actor: event.actor,
      coordinatorEpoch: reconciliation?.coordinatorEpoch,
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
 * @returns {{readManualRequest: (reference: unknown) => Promise<Record<string, any>>, readEvidence: (reference: unknown) => Promise<Record<string, any>>, readManagedEffectRequest: (reference: unknown) => Promise<ReturnType<typeof normalizeManagedEffectRequest>>, readManagedEffectOutcome: (reference: unknown) => Promise<ReturnType<typeof normalizeManagedEffectOutcome>>}} - Verified payload reader.
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
    async readManagedEffectRequest(reference) {
      return normalizeManagedEffectRequest(
        await read(
          reference,
          MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
          'persisted managed-effect request',
        ),
        'persisted managed-effect request',
      );
    },
    async readManagedEffectOutcome(reference) {
      return normalizeManagedEffectOutcome(
        await read(
          reference,
          MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
          'persisted managed-effect outcome',
        ),
        'persisted managed-effect outcome',
      );
    },
  };
}

/**
 * @param {Record<string, any>} run - Run snapshot.
 * @param {Record<string, any>} invocation - Invocation snapshot.
 * @param {Record<string, any> | undefined} attempt - Attempt snapshot.
 * @param {Record<string, any> | undefined} effect - Effect snapshot.
 * @param {Record<string, any>[] | undefined} effects - Compound effect snapshots.
 * @param {ReturnType<typeof normalizeUncertainAttemptReconciliation> | undefined} reconciliation - Reconciliation payload when the retained attempt is deliberately unchanged.
 * @param {Record<string, any>} event - Event being folded.
 * @param {{run?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, effects: Map<string, Record<string, any>>, eventsBySequence: Map<number, Record<string, any>>, eventsById: Map<string, Record<string, any>>}} state - Mutable fold state.
 * @param {string} runId - Run identity.
 * @param {ReturnType<typeof createLedgerPayloadReader>} payloadReader - Per-fold verified immutable payload reader.
 * @param {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} effectVerifierRegistry - Versioned deterministic effect verifiers.
 * @returns {Promise<void>}
 */
async function applyEvent(
  run,
  invocation,
  attempt,
  effect,
  effects,
  reconciliation,
  event,
  state,
  runId,
  payloadReader,
  effectVerifierRegistry,
) {
  const currentRun = state.run;
  const currentInvocation = state.invocations.get(invocation.invocationId);
  const currentAttempt = attempt
    ? state.attempts.get(attemptMapKey(attempt.invocationId, attempt.attemptId))
    : reconciliation
      ? state.attempts.get(
          attemptMapKey(reconciliation.invocationId, reconciliation.attemptId),
        )
      : undefined;
  const currentEffect = effect
    ? state.effects.get(effectMapKey(effect.invocationId, effect.effectId))
    : undefined;
  const currentEffectsForAttempt = new Map(
    attempt
      ? [...state.effects.values()]
          .filter(
            (item) =>
              item.invocationId === attempt.invocationId &&
              item.requestedBy.attemptId === attempt.attemptId,
          )
          .map((item) => [item.effectId, item])
      : [],
  );
  const unresolvedCurrentEffects = [...currentEffectsForAttempt.values()]
    .filter((item) =>
      [EffectStatus.PENDING, EffectStatus.STARTED].includes(item.status),
    )
    .sort((left, right) =>
      left.effectId < right.effectId
        ? -1
        : left.effectId > right.effectId
          ? 1
          : 0,
    );

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
      undefined,
      new Map(),
      run,
      invocation,
      undefined,
      undefined,
      undefined,
      undefined,
      runId,
    );
    state.run = run;
    state.invocations.set(invocation.invocationId, invocation);
    return;
  }

  if (
    !currentRun ||
    !currentInvocation ||
    (!attempt &&
      !reconciliation &&
      event.type !== 'manual-cancellation-requested')
  ) {
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

  if (event.type !== 'manual-cancellation-requested') {
    if (
      !hasSameCancellationRequest(currentRun, run) ||
      !hasSameCancellationRequest(currentInvocation, invocation) ||
      (currentAttempt &&
        attempt &&
        !hasSameCancellationRequest(currentAttempt, attempt))
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'cancellation request changed outside its decision event',
      );
    }
  }

  if (event.type === 'manual-cancellation-requested') {
    const cancellationRequest = run.cancellationRequest;
    const matchingRequest =
      cancellationRequest &&
      cancellationRequest.transitionId === event.transition_id &&
      cancellationRequest.requestedAt === event.observed_at &&
      hasSameCanonicalJson(cancellationRequest.actor, event.actor) &&
      hasSameCanonicalJson(
        invocation.cancellationRequest,
        cancellationRequest,
      ) &&
      (!attempt ||
        hasSameCanonicalJson(attempt.cancellationRequest, cancellationRequest));
    const hadRequest =
      Object.prototype.hasOwnProperty.call(currentRun, 'cancellationRequest') ||
      Object.prototype.hasOwnProperty.call(
        currentInvocation,
        'cancellationRequest',
      ) ||
      Boolean(
        currentAttempt &&
        Object.prototype.hasOwnProperty.call(
          currentAttempt,
          'cancellationRequest',
        ),
      );
    const cancelsRunnable =
      currentRun.status === RunStatus.RUNNING &&
      currentInvocation.status === InvocationStatus.RUNNABLE &&
      run.status === RunStatus.CANCELLED &&
      invocation.status === InvocationStatus.CANCELLED &&
      (currentInvocation.generation === 0
        ? !attempt
        : currentAttempt?.status === AttemptStatus.ABANDONED &&
          attempt?.status === AttemptStatus.ABANDONED);
    const cancelsClaimed =
      currentRun.status === RunStatus.RUNNING &&
      currentInvocation.status === InvocationStatus.RUNNING &&
      currentAttempt?.status === AttemptStatus.CLAIMED &&
      run.status === RunStatus.CANCELLED &&
      invocation.status === InvocationStatus.CANCELLED &&
      attempt?.status === AttemptStatus.CANCELLED;
    const requestsStarted =
      currentRun.status === RunStatus.RUNNING &&
      currentInvocation.status === InvocationStatus.RUNNING &&
      currentAttempt?.status === AttemptStatus.STARTED &&
      run.status === RunStatus.RUNNING &&
      invocation.status === InvocationStatus.RUNNING &&
      attempt?.status === AttemptStatus.STARTED;
    if (
      !matchingRequest ||
      hadRequest ||
      !hasSameOptionalFields(currentInvocation, invocation, [
        'terminal',
        'uncertainty',
      ]) ||
      invocation.generation !== currentInvocation.generation ||
      event.fence.invocationGeneration !== currentInvocation.generation ||
      (!attempt && event.fence.coordinatorEpoch !== 0) ||
      (!cancelsRunnable && !cancelsClaimed && !requestsStarted)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid manual cancellation request',
      );
    }
    if (attempt) {
      if (!currentAttempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'cancellation attempt lacks prior state',
        );
      }
      if (
        !hasSameOptionalFields(currentAttempt, attempt, [
          'startedAt',
          'terminal',
          'evidenceRef',
          'abandonment',
        ])
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'cancellation rewrote attempt lifecycle evidence',
        );
      }
      assertAttemptBelongsToInvocation(attempt, run, invocation, runId);
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      if (requestsStarted) {
        try {
          assertStoppedAttemptClosureFits({
            run,
            invocation,
            attempt,
            effects: [...currentEffectsForAttempt.values()],
            label: 'folded manual cancellation',
          });
        } catch {
          throw new ExecutionLedgerProjectionError(
            runId,
            'manual cancellation exceeds stopped-attempt closure budget',
          );
        }
      }
    }
  } else if (event.type.startsWith('effect-')) {
    if (!attempt || !effect || !currentAttempt) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'managed-effect event lacks current attempt state',
      );
    }
    assertAttemptBelongsToInvocation(attempt, run, invocation, runId);
    assertEffectBelongsToInvocation(effect, run, invocation, runId);
    if (!effectVerifierRegistry.has(effectVerifierKey(effect.verifier))) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'managed-effect verifier is unavailable',
      );
    }
    const exactFence =
      attempt.attemptId === effect.requestedBy.attemptId &&
      attempt.generation === effect.requestedBy.generation &&
      attempt.coordinatorEpoch === effect.requestedBy.coordinatorEpoch &&
      attempt.fencingToken === effect.requestedBy.fencingToken &&
      event.fence.coordinatorEpoch === attempt.coordinatorEpoch &&
      event.fence.invocationGeneration === attempt.generation;
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    if (
      !exactFence ||
      currentInvocation.generation !== currentAttempt.generation ||
      invocation.generation !== attempt.generation ||
      !hasSameCanonicalJson(
        request.requestedReplayProperties,
        effect.requestedReplayProperties,
      )
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'managed-effect request or fence mismatch',
      );
    }

    if (event.type === 'effect-requested') {
      if (
        currentEffect ||
        unresolvedCurrentEffects.length >=
          EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS ||
        currentRun.status !== RunStatus.RUNNING ||
        run.status !== RunStatus.RUNNING ||
        currentInvocation.status !== InvocationStatus.RUNNING ||
        invocation.status !== InvocationStatus.RUNNING ||
        currentAttempt.status !== AttemptStatus.STARTED ||
        attempt.status !== AttemptStatus.STARTED ||
        effect.status !== EffectStatus.PENDING ||
        effect.version !== 1 ||
        effect.lastSequence !== event.sequence ||
        effect.createdAt !== event.observed_at ||
        effect.updatedAt !== event.observed_at ||
        Object.prototype.hasOwnProperty.call(effect, 'startedBy') ||
        Object.prototype.hasOwnProperty.call(effect, 'terminal') ||
        Object.prototype.hasOwnProperty.call(effect, 'outcomeRef') ||
        Object.prototype.hasOwnProperty.call(effect, 'cancellation') ||
        Object.prototype.hasOwnProperty.call(effect, 'uncertainty') ||
        !hasSameOptionalFields(currentInvocation, invocation, [
          'terminal',
          'uncertainty',
          'cancellationRequest',
        ]) ||
        !hasSameOptionalFields(currentAttempt, attempt, [
          'startedAt',
          'terminal',
          'evidenceRef',
          'abandonment',
          'cancellationRequest',
        ])
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid managed-effect request',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      try {
        assertStoppedAttemptClosureFits({
          run,
          invocation,
          attempt,
          effects: [...currentEffectsForAttempt.values(), effect],
          label: 'folded managed-effect request',
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'managed-effect request exceeds stopped-attempt closure budget',
        );
      }
    } else {
      if (!currentEffect) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'managed-effect event lacks prior effect state',
        );
      }
      assertEffectAdvance(currentEffect, effect, event, runId);
      const exactStartedFence =
        effect.startedBy &&
        effect.startedBy.attemptId === attempt.attemptId &&
        effect.startedBy.generation === attempt.generation &&
        effect.startedBy.coordinatorEpoch === attempt.coordinatorEpoch &&
        effect.startedBy.fencingToken === attempt.fencingToken;

      if (event.type === 'effect-started') {
        if (
          currentRun.status !== RunStatus.RUNNING ||
          run.status !== RunStatus.RUNNING ||
          currentInvocation.status !== InvocationStatus.RUNNING ||
          invocation.status !== InvocationStatus.RUNNING ||
          currentAttempt.status !== AttemptStatus.STARTED ||
          attempt.status !== AttemptStatus.STARTED ||
          currentEffect.status !== EffectStatus.PENDING ||
          effect.status !== EffectStatus.STARTED ||
          !exactStartedFence ||
          Object.prototype.hasOwnProperty.call(effect, 'terminal') ||
          Object.prototype.hasOwnProperty.call(effect, 'outcomeRef') ||
          Object.prototype.hasOwnProperty.call(effect, 'cancellation') ||
          Object.prototype.hasOwnProperty.call(effect, 'uncertainty') ||
          !hasSameOptionalFields(currentInvocation, invocation, [
            'terminal',
            'uncertainty',
            'cancellationRequest',
          ]) ||
          !hasSameOptionalFields(currentAttempt, attempt, [
            'startedAt',
            'terminal',
            'evidenceRef',
            'abandonment',
            'cancellationRequest',
          ])
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'invalid managed-effect start',
          );
        }
        assertAttemptAdvance(currentAttempt, attempt, event, runId);
        try {
          assertStoppedAttemptClosureFits({
            run,
            invocation,
            attempt,
            effects: [...currentEffectsForAttempt.values()].map((item) =>
              item.effectId === effect.effectId ? effect : item,
            ),
            label: 'folded managed-effect start',
          });
        } catch {
          throw new ExecutionLedgerProjectionError(
            runId,
            'managed-effect start exceeds stopped-attempt closure budget',
          );
        }
      } else if (
        event.type === 'effect-completed' ||
        event.type === 'effect-failed'
      ) {
        const expectedStatus =
          event.type === 'effect-completed'
            ? EffectStatus.COMPLETED
            : EffectStatus.FAILED;
        const expectedOk = event.type === 'effect-completed';
        if (
          currentRun.status !== RunStatus.RUNNING ||
          run.status !== RunStatus.RUNNING ||
          currentInvocation.status !== InvocationStatus.RUNNING ||
          invocation.status !== InvocationStatus.RUNNING ||
          currentAttempt.status !== AttemptStatus.STARTED ||
          attempt.status !== AttemptStatus.STARTED ||
          currentEffect.status !== EffectStatus.STARTED ||
          effect.status !== expectedStatus ||
          !exactStartedFence ||
          effect.terminal?.ok !== expectedOk ||
          !hasSameOptionalFields(currentInvocation, invocation, [
            'terminal',
            'uncertainty',
            'cancellationRequest',
          ]) ||
          !hasSameOptionalFields(currentAttempt, attempt, [
            'startedAt',
            'terminal',
            'evidenceRef',
            'abandonment',
            'cancellationRequest',
          ])
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'invalid managed-effect outcome',
          );
        }
        const outcome = await payloadReader.readManagedEffectOutcome(
          effect.outcomeRef,
        );
        try {
          verifyManagedEffectOutcome(
            effectVerifierRegistry,
            effect,
            request,
            outcome,
            'persisted managed-effect outcome',
          );
        } catch {
          throw new ExecutionLedgerProjectionError(
            runId,
            'managed-effect outcome evidence is invalid',
          );
        }
        if (outcome.ok !== expectedOk) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'managed-effect outcome status mismatch',
          );
        }
        assertAttemptAdvance(currentAttempt, attempt, event, runId);
      } else if (event.type === 'effect-became-uncertain') {
        if (
          currentRun.status !== RunStatus.RUNNING ||
          run.status !== RunStatus.BLOCKED ||
          currentInvocation.status !== InvocationStatus.RUNNING ||
          invocation.status !== InvocationStatus.UNCERTAIN ||
          currentAttempt.status !== AttemptStatus.STARTED ||
          attempt.status !== AttemptStatus.ABANDONED ||
          attempt.startedAt !== currentAttempt.startedAt ||
          currentEffect.status !== EffectStatus.STARTED ||
          effect.status !== EffectStatus.UNCERTAIN ||
          !exactStartedFence ||
          !hasSameCanonicalJson(effect.uncertainty, attempt.abandonment) ||
          !hasSameCanonicalJson(effect.uncertainty, invocation.uncertainty) ||
          Object.prototype.hasOwnProperty.call(effect, 'terminal') ||
          Object.prototype.hasOwnProperty.call(effect, 'outcomeRef') ||
          Object.prototype.hasOwnProperty.call(effect, 'cancellation') ||
          unresolvedCurrentEffects.length !== 1 ||
          unresolvedCurrentEffects[0].effectId !== currentEffect.effectId
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'invalid uncertain managed effect',
          );
        }
        assertAttemptAdvance(currentAttempt, attempt, event, runId);
      }
    }
  } else if (event.type === 'uncertain-attempt-reconciled') {
    if (!reconciliation || !currentAttempt) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'reconciliation lacks retained attempt state',
      );
    }
    const uncertaintyBySequence = state.eventsBySequence.get(
      reconciliation.uncertaintySequence,
    );
    const uncertaintyById = state.eventsById.get(
      reconciliation.uncertaintyEventId,
    );
    const terminal = reconciliation.terminal;
    const statuses = statusesForTerminal(terminal);
    const verifiedEvidence = validateLedgerAttemptEvidence(
      await payloadReader.readEvidence(reconciliation.evidenceRef),
      await createLedgerAttemptStart(
        currentRun,
        currentInvocation,
        currentAttempt,
        payloadReader,
      ),
      'persisted uncertain-attempt reconciliation evidence',
    );
    await assertAttemptEvidenceMatchesManagedEffects(
      verifiedEvidence.evidence,
      currentAttempt,
      state,
      payloadReader,
      effectVerifierRegistry,
      runId,
    );
    try {
      assertSupportedManualTerminal(
        verifiedEvidence.terminal,
        verifiedEvidence.evidence,
        currentRun.cancellationRequest,
        'persisted uncertain-attempt reconciliation',
      );
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'unsupported or unauthorized uncertain-attempt reconciliation terminal',
      );
    }
    if (
      !uncertaintyBySequence ||
      uncertaintyBySequence !== uncertaintyById ||
      currentRun.status !== RunStatus.BLOCKED ||
      currentInvocation.status !== InvocationStatus.UNCERTAIN ||
      currentInvocation.invocationId !== reconciliation.invocationId ||
      currentInvocation.generation !== reconciliation.generation ||
      currentAttempt.status !== AttemptStatus.ABANDONED ||
      currentAttempt.invocationId !== reconciliation.invocationId ||
      currentAttempt.attemptId !== reconciliation.attemptId ||
      currentAttempt.generation !== reconciliation.generation ||
      currentAttempt.coordinatorEpoch !== reconciliation.coordinatorEpoch ||
      currentAttempt.fencingToken !== reconciliation.fencingToken ||
      event.fence.coordinatorEpoch !== reconciliation.coordinatorEpoch ||
      event.fence.invocationGeneration !== reconciliation.generation ||
      !hasExactUncertaintyEventLink({
        run: currentRun,
        invocation: currentInvocation,
        attempt: currentAttempt,
        reconciliation,
        uncertaintyEvent: uncertaintyBySequence,
        runId,
      }) ||
      run.status !== statuses.run ||
      invocation.status !== statuses.invocation ||
      invocation.generation !== currentInvocation.generation ||
      terminal.attemptId !== currentAttempt.attemptId ||
      !hasSameCanonicalJson(
        createTerminalSummary(verifiedEvidence.terminal),
        terminal,
      ) ||
      !hasSameCanonicalJson(invocation.terminal, terminal) ||
      Object.prototype.hasOwnProperty.call(invocation, 'uncertainty') ||
      !hasSameOptionalFields(currentInvocation, invocation, [
        'cancellationRequest',
      ])
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid uncertain-attempt reconciliation',
      );
    }
  } else {
    if (!attempt) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'attempt event lacks an attempt snapshot',
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
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid attempt claim',
        );
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
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid attempt start',
        );
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
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        attempt,
        state,
        payloadReader,
        effectVerifierRegistry,
        runId,
      );
      try {
        assertSupportedManualTerminal(
          verifiedEvidence.terminal,
          verifiedEvidence.evidence,
          run.cancellationRequest,
          'persisted attempt terminal',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'unsupported or unauthorized manual terminal type',
        );
      }
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
      const nextEffects = effects || [];
      const activeEffectIds = unresolvedCurrentEffects.map(
        (item) => item.effectId,
      );
      const nextEffectIds = nextEffects.map((item) => item.effectId);
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
        run.status !== RunStatus.BLOCKED ||
        unresolvedCurrentEffects.length >
          EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS ||
        !hasSameCanonicalJson(activeEffectIds, nextEffectIds)
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid uncertain abandonment',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      for (const nextEffect of nextEffects) {
        const priorEffect = currentEffectsForAttempt.get(nextEffect.effectId);
        if (!priorEffect) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'attempt uncertainty effect lacks prior state',
          );
        }
        assertEffectBelongsToInvocation(nextEffect, run, invocation, runId);
        assertEffectAdvance(priorEffect, nextEffect, event, runId);
        if (
          !effectVerifierRegistry.has(effectVerifierKey(nextEffect.verifier))
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'managed-effect verifier is unavailable',
          );
        }
        const exactRequestedFence =
          nextEffect.requestedBy.attemptId === attempt.attemptId &&
          nextEffect.requestedBy.generation === attempt.generation &&
          nextEffect.requestedBy.coordinatorEpoch ===
            attempt.coordinatorEpoch &&
          nextEffect.requestedBy.fencingToken === attempt.fencingToken;
        const request = await payloadReader.readManagedEffectRequest(
          nextEffect.requestRef,
        );
        if (
          !exactRequestedFence ||
          !hasSameCanonicalJson(
            request.requestedReplayProperties,
            nextEffect.requestedReplayProperties,
          )
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'managed-effect request or fence mismatch',
          );
        }
        if (priorEffect.status === EffectStatus.PENDING) {
          if (
            nextEffect.status !== EffectStatus.CANCELLED ||
            !Object.prototype.hasOwnProperty.call(nextEffect, 'cancellation')
          ) {
            throw new ExecutionLedgerProjectionError(
              runId,
              'invalid pre-start managed-effect cancellation',
            );
          }
          continue;
        }
        const exactStartedFence =
          nextEffect.startedBy?.attemptId === attempt.attemptId &&
          nextEffect.startedBy?.generation === attempt.generation &&
          nextEffect.startedBy?.coordinatorEpoch === attempt.coordinatorEpoch &&
          nextEffect.startedBy?.fencingToken === attempt.fencingToken;
        if (priorEffect.status !== EffectStatus.STARTED || !exactStartedFence) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'invalid stopped managed-effect settlement source',
          );
        }
        if (
          [EffectStatus.COMPLETED, EffectStatus.FAILED].includes(
            nextEffect.status,
          )
        ) {
          const outcome = await payloadReader.readManagedEffectOutcome(
            nextEffect.outcomeRef,
          );
          try {
            verifyManagedEffectOutcome(
              effectVerifierRegistry,
              nextEffect,
              request,
              outcome,
              'persisted recovered managed-effect outcome',
            );
          } catch {
            throw new ExecutionLedgerProjectionError(
              runId,
              'recovered managed-effect outcome evidence is invalid',
            );
          }
          if (
            (nextEffect.status === EffectStatus.COMPLETED) !==
            (outcome.ok === true)
          ) {
            throw new ExecutionLedgerProjectionError(
              runId,
              'recovered managed-effect outcome status mismatch',
            );
          }
        } else if (nextEffect.status !== EffectStatus.UNCERTAIN) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'invalid stopped managed-effect disposition',
          );
        }
      }
    }
  }

  assertEventRequestDigest(
    event,
    currentRun,
    currentInvocation,
    currentAttempt,
    currentEffect,
    currentEffectsForAttempt,
    run,
    invocation,
    attempt,
    effect,
    effects,
    reconciliation,
    runId,
  );

  state.run = run;
  state.invocations.set(invocation.invocationId, invocation);
  if (attempt) {
    state.attempts.set(
      attemptMapKey(attempt.invocationId, attempt.attemptId),
      attempt,
    );
  }
  if (effect) {
    state.effects.set(
      effectMapKey(effect.invocationId, effect.effectId),
      effect,
    );
  }
  for (const nextEffect of effects || []) {
    state.effects.set(
      effectMapKey(nextEffect.invocationId, nextEffect.effectId),
      nextEffect,
    );
  }
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
    // A custom V7 table may deliberately retain older or lifecycle rows in the
    // same physical partition. Only the fresh V7 record namespace participates
    // in replay; no old history is accidentally treated as a malformed V7 run.
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
 * @param {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} effectVerifierRegistry - Versioned deterministic effect verifiers.
 * @returns {Promise<{head: Record<string, any>, run: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, effects: Map<string, Record<string, any>>, events: Record<string, any>[]}|null>} - Verified current state, if the run exists.
 */
async function foldAndVerifyRun(
  records,
  runId,
  payloadStore,
  effectVerifierRegistry,
) {
  if (records.length === 0) return null;

  /** @type {Record<string, any> | undefined} */
  let head;
  /** @type {Record<string, any> | undefined} */
  let runProjection;
  const invocationProjections = new Map();
  const attemptProjections = new Map();
  const effectProjections = new Map();
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
      case 'execution_ledger_effect_projection': {
        const effect = normalizeEffectSnapshot(record.data, runId);
        const expectedSortKey = getEffectProjectionSortKey(
          effect.invocationId,
          effect.effectId,
        );
        requireRecord(
          record,
          runId,
          expectedSortKey,
          'execution_ledger_effect_projection',
        );
        const key = effectMapKey(effect.invocationId, effect.effectId);
        if (
          record.invocation_id !== effect.invocationId ||
          record.effect_id !== effect.effectId ||
          record.destination_effect_id !== effect.destinationEffectId ||
          record.status !== effect.status ||
          record.version !== effect.version ||
          record.revision_id !== effect.revisionId ||
          effectProjections.has(key)
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'effect projection index mismatch',
          );
        }
        effectProjections.set(key, effect);
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

  /** @type {{run?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, effects: Map<string, Record<string, any>>, eventsBySequence: Map<number, Record<string, any>>, eventsById: Map<string, Record<string, any>>}} */
  const state = {
    invocations: new Map(),
    attempts: new Map(),
    effects: new Map(),
    eventsBySequence: new Map(),
    eventsById: new Map(),
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
    const receiptTarget =
      snapshots.effect || snapshots.attempt || snapshots.reconciliation;
    const receiptAttempt = snapshots.attempt || snapshots.reconciliation;
    if (
      receiptTarget
        ? !receiptAttempt ||
          receipt.invocation_id !== receiptTarget.invocationId ||
          receipt.attempt_id !== receiptAttempt.attemptId ||
          (snapshots.effect
            ? receipt.effect_id !== snapshots.effect.effectId
            : Object.prototype.hasOwnProperty.call(receipt, 'effect_id'))
        : Object.prototype.hasOwnProperty.call(receipt, 'invocation_id') ||
          Object.prototype.hasOwnProperty.call(receipt, 'attempt_id') ||
          Object.prototype.hasOwnProperty.call(receipt, 'effect_id')
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
      snapshots.effect,
      snapshots.effects,
      snapshots.reconciliation,
      event,
      state,
      runId,
      payloadReader,
      effectVerifierRegistry,
    );
    if (
      state.eventsBySequence.has(event.sequence) ||
      state.eventsById.has(event.event_id)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'duplicate event identity',
      );
    }
    state.eventsBySequence.set(event.sequence, event);
    state.eventsById.set(event.event_id, event);
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
  if (state.effects.size !== effectProjections.size) {
    throw new ExecutionLedgerProjectionError(runId, 'effect projection count');
  }
  for (const [key, effect] of state.effects) {
    const projection = effectProjections.get(key);
    if (!projection || !sameSnapshot(effect, projection)) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect projection disagrees',
      );
    }
  }

  return {
    head: cloneJsonObject(head, 'run head'),
    run: state.run,
    invocations: state.invocations,
    attempts: state.attempts,
    effects: state.effects,
    events,
  };
}

/**
 * @param {Record<string, any>} state - Verified folded state.
 * @param {Record<string, any> | undefined} attempt - Current affected attempt.
 * @param {Record<string, any>} receipt - Transition receipt.
 * @param {boolean} applied - Whether this call appended the transition.
 * @param {Record<string, any> | undefined} effect - Current affected effect.
 * @param {Record<string, any>[] | undefined} effects - Current compound affected effects.
 * @returns {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[]}} - Public transition view.
 */
function transitionResult(
  state,
  attempt,
  receipt,
  applied,
  effect = undefined,
  effects = undefined,
) {
  const invocation = [...state.invocations.values()][0];
  /** @type {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[]}} */
  const result = {
    applied,
    receipt: cloneJsonObject(receipt, 'transition receipt'),
    run: cloneJsonObject(state.run, 'run result'),
    invocation: cloneJsonObject(invocation, 'invocation result'),
  };
  if (attempt) result.attempt = cloneJsonObject(attempt, 'attempt result');
  if (effect) result.effect = cloneJsonObject(effect, 'effect result');
  if (effects) {
    result.effects = effects.map((item) =>
      cloneJsonObject(item, 'compound effect result'),
    );
  }
  return result;
}

/**
 * Return the retained physical attempt for an invocation's current generation.
 * Generation zero is the only state with no attempt. Any other missing or
 * duplicate generation is corrupt history rather than a cancellable gap.
 * @param {Record<string, any>} state - Verified folded ledger state.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @param {string} runId - Durable run identity.
 * @returns {Record<string, any> | undefined} - Current generation attempt.
 */
function getCurrentGenerationAttempt(state, invocation, runId) {
  if (invocation.generation === 0) return undefined;
  const attempts = [...state.attempts.values()].filter(
    (attempt) =>
      attempt.invocationId === invocation.invocationId &&
      attempt.generation === invocation.generation,
  );
  if (attempts.length !== 1) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'current invocation generation attempt count',
    );
  }
  return attempts[0];
}

/**
 * @param {Record<string, any>} state - Verified folded ledger state.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @param {Record<string, any> | undefined} attempt - Current generation attempt.
 * @param {'terminal-authoritative'|'outcome-uncertain'} outcome - Explicit no-mutation result.
 * @returns {{applied: false, outcome: 'terminal-authoritative'|'outcome-uncertain', run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}} - Current no-mutation state.
 */
function cancellationNoMutationResult(state, invocation, attempt, outcome) {
  const result = {
    applied: /** @type {const} */ (false),
    outcome,
    run: cloneJsonObject(state.run, 'run result'),
    invocation: cloneJsonObject(invocation, 'invocation result'),
  };
  if (attempt) {
    /** @type {Record<string, any>} */ (result).attempt = cloneJsonObject(
      attempt,
      'attempt result',
    );
  }
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
    domain: 'wharfie:execution-ledger-transition:v7',
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
 * @param {Record<string, any>} evidence - Fully verified attempt evidence.
 * @param {Record<string, any> | undefined} cancellationRequest - Prior durable cancellation authority.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertSupportedManualTerminal(
  terminal,
  evidence,
  cancellationRequest,
  label,
) {
  if (!SUPPORTED_MANUAL_TERMINAL_TYPES.has(terminal.type)) {
    throw new TypeError(
      `${label}.type '${terminal.type}' requires a durable decision that this ledger slice does not implement.`,
    );
  }
  const cancelFrames = evidence.frames.filter(
    (/** @type {Record<string, any>} */ frame) => frame.type === 'cancel',
  );
  const hasAuthorizedCancelFrame =
    cancelFrames.length === 1 &&
    cancellationRequest &&
    cancelFrames[0].attemptId === terminal.attemptId &&
    hasSameCanonicalJson(cancelFrames[0].reason, cancellationRequest.reason);
  if (cancelFrames.length > 0 && !hasAuthorizedCancelFrame) {
    throw new TypeError(
      `${label} contains a host cancel frame without the exact prior durable cancellation request authority.`,
    );
  }
  if (
    terminal.type === 'protocol-failed' &&
    cancellationRequest &&
    cancelFrames.length > 0
  ) {
    throw new TypeError(
      `${label}.type 'protocol-failed' after cancellation does not prove that the begun handler stopped.`,
    );
  }
  if (terminal.type !== 'cancelled') return;
  if (!hasAuthorizedCancelFrame) {
    throw new TypeError(
      `${label}.type 'cancelled' requires a prior durable cancellation request with the exact accepted host cancel reason.`,
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
 * Require every effect frame in a terminal attempt transcript to agree with
 * independently persisted logical effect state. The transcript is correlation
 * evidence only; it never creates or completes an effect by itself.
 * @param {Record<string, any>} evidence - Strict host-owned attempt evidence.
 * @param {Record<string, any>} attempt - Exact physical attempt.
 * @param {{effects: Map<string, Record<string, any>>}} state - Folded effect state.
 * @param {ReturnType<typeof createLedgerPayloadReader>} payloadReader - Rehashed payload reader.
 * @param {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} verifierRegistry - Versioned deterministic verifiers.
 * @param {string} runId - Durable run identity.
 * @returns {Promise<void>}
 */
async function assertAttemptEvidenceMatchesManagedEffects(
  evidence,
  attempt,
  state,
  payloadReader,
  verifierRegistry,
  runId,
) {
  const effects = [...state.effects.values()].filter(
    (effect) =>
      effect.invocationId === attempt.invocationId &&
      effect.requestedBy.attemptId === attempt.attemptId,
  );
  const byId = new Map(effects.map((effect) => [effect.effectId, effect]));
  const seenRequests = new Set();
  const seenResults = new Set();
  const permitsCancelledWithoutResult = [
    'cancelled',
    'failed',
    'protocol-failed',
  ].includes(evidence.terminal?.type || evidence.status);
  for (const frame of evidence.frames) {
    if (frame.type === 'effect-request') {
      const effect = byId.get(frame.effectId);
      if (!effect || seenRequests.has(frame.effectId)) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'attempt transcript has unpersisted managed-effect request',
        );
      }
      const logicalRequest = await payloadReader.readManagedEffectRequest(
        effect.requestRef,
      );
      if (
        effect.requestedBy.protocolSequence !== frame.sequence ||
        !hasSameCanonicalJson(logicalRequest, {
          capability: frame.capability,
          operation: frame.operation,
          input: frame.input,
          requestedReplayProperties: frame.requestedReplayProperties,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'attempt transcript managed-effect request mismatch',
        );
      }
      seenRequests.add(frame.effectId);
    } else if (frame.type === 'effect-result') {
      const effect = byId.get(frame.effectId);
      if (
        !effect ||
        !seenRequests.has(frame.effectId) ||
        seenResults.has(frame.effectId) ||
        ![EffectStatus.COMPLETED, EffectStatus.FAILED].includes(
          effect.status,
        ) ||
        !effect.outcomeRef
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'attempt transcript has unresolved managed-effect result',
        );
      }
      const request = await payloadReader.readManagedEffectRequest(
        effect.requestRef,
      );
      const outcome = await payloadReader.readManagedEffectOutcome(
        effect.outcomeRef,
      );
      try {
        verifyManagedEffectOutcome(
          verifierRegistry,
          effect,
          request,
          outcome,
          'attempt transcript managed-effect outcome',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'attempt transcript managed-effect evidence is invalid',
        );
      }
      const expectedFrame = validateActivityProtocolHostFrame(
        {
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type: 'effect-result',
          attemptId: attempt.attemptId,
          effectId: effect.effectId,
          ok: outcome.ok,
          ...(outcome.ok
            ? { result: outcome.result }
            : { error: outcome.error }),
          substantiatedReplayProperties: outcome.substantiatedReplayProperties,
          evidence: outcome.evidence,
        },
        'persisted managed-effect result frame',
      );
      if (!hasSameCanonicalJson(frame, expectedFrame)) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'attempt transcript managed-effect result mismatch',
        );
      }
      seenResults.add(frame.effectId);
    }
  }
  if (
    effects.some((effect) => {
      if (effect.status === EffectStatus.CANCELLED) {
        return (
          !permitsCancelledWithoutResult ||
          !seenRequests.has(effect.effectId) ||
          seenResults.has(effect.effectId)
        );
      }
      return (
        !seenRequests.has(effect.effectId) ||
        !seenResults.has(effect.effectId) ||
        ![EffectStatus.COMPLETED, EffectStatus.FAILED].includes(effect.status)
      );
    })
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'attempt terminal leaves managed effects unresolved',
    );
  }
}

/**
 * @param {string} runId - Durable run identity.
 * @param {string} invocationId - Durable invocation identity.
 * @param {number} generation - Attempt generation scoped to the invocation.
 * @returns {string} - Globally scoped deterministic physical-attempt identity.
 */
function createAttemptId(runId, invocationId, generation) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-attempt:v7',
    prefix: 'wla',
    value: { runId, invocationId, generation },
    valuePath: 'execution ledger attempt identity',
  });
}

/**
 * Create a provider-neutral append-only execution ledger over one transactional
 * DB table. It intentionally does not provide leases, scheduling, or a general
 * workflow API; those require later durable contracts.
 * @param {{db: DBClient, tableName: string, payloadStore: {putJson: (input: {value: unknown, payloadSchema: string}) => Promise<unknown>, readBytes: (reference: unknown) => Promise<unknown>}, effectEvidenceVerifiers?: {kind: string, version: number, verify: (input: Record<string, any>) => boolean}[], now?: () => number}} options - Store dependencies.
 * @returns {ExecutionLedgerStore} - Durable ledger API.
 */
export function createExecutionLedger({
  db,
  tableName,
  payloadStore,
  effectEvidenceVerifiers,
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
  const effectVerifierRegistry = normalizeEffectEvidenceVerifiers(
    effectEvidenceVerifiers,
  );

  /**
   * @param {string} runId - Run identity.
   * @returns {Promise<ReturnType<typeof foldAndVerifyRun>>} - Verified run state.
   */
  async function readVerifiedRun(runId) {
    return await foldAndVerifyRun(
      await readRunRecords(db, resolvedTableName, runId),
      runId,
      payloadStore,
      effectVerifierRegistry,
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
   * @param {{state: Record<string, any> | null, runId: string, transitionId: string, requestDigest: string, event: Record<string, any>, nextRun: Record<string, any>, nextInvocation: Record<string, any>, nextAttempt?: Record<string, any>, currentAttempt?: Record<string, any>, nextEffect?: Record<string, any>, currentEffect?: Record<string, any>, effectTransitions?: Array<{currentEffect?: Record<string, any>, nextEffect: Record<string, any>}>}} input - Fully validated transition.
   * @returns {Promise<void>} - Resolves only after the durable transaction commits.
   */
  async function appendTransition(input) {
    const effectTransitions =
      input.effectTransitions ||
      (input.nextEffect
        ? [
            {
              currentEffect: input.currentEffect,
              nextEffect: input.nextEffect,
            },
          ]
        : []);
    if (
      effectTransitions.length >
        EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS ||
      new Set(effectTransitions.map(({ nextEffect }) => nextEffect.effectId))
        .size !== effectTransitions.length
    ) {
      throw new TypeError(
        'execution ledger transition effects must be unique and within the managed-effect limit.',
      );
    }
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
    for (const { currentEffect, nextEffect } of effectTransitions) {
      const effectRecord = createEffectProjectionRecord(
        input.runId,
        nextEffect,
      );
      putRequests.push({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: effectRecord,
        conditions: currentEffect
          ? replacementConditions(
              createEffectProjectionRecord(input.runId, currentEffect),
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
   * @param {Record<string, any>} state - Verified folded state.
   * @param {Record<string, any>} receipt - Immutable transition receipt.
   * @returns {boolean} - Whether the fold contains the receipt's exact event.
   */
  function stateContainsTransitionReceipt(state, receipt) {
    const event = state.events[receipt.sequence - 1];
    return (
      event?.event_id === receipt.event_id &&
      event.transition_id === receipt.transition_id &&
      event.request_digest === receipt.request_digest &&
      event.type === receipt.type
    );
  }

  /**
   * Refresh a fold when a receipt appeared after the caller's state read.
   * @param {Record<string, any>} state - Possibly stale verified state.
   * @param {Record<string, any>} receipt - Newly observed receipt.
   * @returns {Promise<Record<string, any>>} - Verified state containing the receipt event.
   */
  async function stateContainingTransitionReceipt(state, receipt) {
    if (stateContainsTransitionReceipt(state, receipt)) return state;
    const refreshed = await readVerifiedRun(state.run.runId);
    if (!refreshed || !stateContainsTransitionReceipt(refreshed, receipt)) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        'transition receipt is not represented by folded state',
      );
    }
    return refreshed;
  }

  /**
   * @param {Record<string, any>} state - Current verified state.
   * @param {Record<string, any>} receipt - Existing transition receipt.
   * @param {string[]} [effectIds] - Compound effect IDs to return.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Idempotent receipt result from a fold that contains the receipt event.
   */
  async function existingTransitionResult(
    state,
    receipt,
    effectIds = undefined,
  ) {
    const durableState = await stateContainingTransitionReceipt(state, receipt);
    const attempt =
      typeof receipt.invocation_id === 'string' &&
      typeof receipt.attempt_id === 'string'
        ? durableState.attempts.get(
            attemptMapKey(receipt.invocation_id, receipt.attempt_id),
          )
        : undefined;
    const effect =
      typeof receipt.invocation_id === 'string' &&
      typeof receipt.effect_id === 'string'
        ? durableState.effects.get(
            effectMapKey(receipt.invocation_id, receipt.effect_id),
          )
        : undefined;
    const effects = effectIds
      ? effectIds.map((effectId) => {
          const item = durableState.effects.get(
            effectMapKey(receipt.invocation_id, effectId),
          );
          if (!item) {
            throw new ExecutionLedgerProjectionError(
              durableState.run.runId,
              'compound transition effect is unavailable',
            );
          }
          return item;
        })
      : undefined;
    return transitionResult(
      durableState,
      attempt,
      receipt,
      false,
      effect,
      effects,
    );
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
    return transitionResult(next, undefined, receipt, true, undefined);
  }

  /**
   * @param {{state: Record<string, any>, runId: string, transitionId: string, requestDigest: string, event: Record<string, any>, nextRun: Record<string, any>, nextInvocation: Record<string, any>, nextAttempt?: Record<string, any>, currentAttempt?: Record<string, any>, nextEffect?: Record<string, any>, currentEffect?: Record<string, any>, effectTransitions?: Array<{currentEffect?: Record<string, any>, nextEffect: Record<string, any>}>, resultEffectIds?: string[]}} input - Fully validated existing-run transition.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}>} - Accepted or idempotently replayed transition.
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
    if (existing) {
      return await existingTransitionResult(
        input.state,
        existing,
        input.resultEffectIds,
      );
    }

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
        return await existingTransitionResult(
          raced,
          receipt,
          input.resultEffectIds,
        );
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
    const effect =
      typeof receipt.invocation_id === 'string' &&
      typeof receipt.effect_id === 'string'
        ? next.effects.get(
            effectMapKey(receipt.invocation_id, receipt.effect_id),
          )
        : undefined;
    const effects = input.resultEffectIds
      ? input.resultEffectIds.map((effectId) => {
          const item = next.effects.get(
            effectMapKey(receipt.invocation_id, effectId),
          );
          if (!item) {
            throw new ExecutionLedgerProjectionError(
              input.runId,
              'compound transition effect is unavailable',
            );
          }
          return item;
        })
      : undefined;
    return transitionResult(
      next,
      attempt,
      /** @type {Record<string, any>} */ (receipt),
      true,
      effect,
      effects,
    );
  }

  /**
   * Persist the one first-wins cancellation request for a manual run. Work
   * that has not crossed STARTED becomes durably cancelled immediately. A
   * begun attempt retains RUNNING state until its full protocol evidence wins
   * a later terminal race; already uncertain work remains a reconciliation
   * concern and is never relabelled by this API.
   * @param {{runId: string, invocationId: string, expectedVersion: number, expectedGeneration: number, transitionId: string, requestId: string, reason: {code: string, name: string, message: string, details: Record<string, any>}, attemptId?: string, fencingToken?: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Durable cancellation request.
   * @returns {Promise<ManualCancellationResult>} - Accepted request or explicit authoritative no-mutation state.
   */
  async function requestManualRunCancellation(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'requestManualRunCancellation',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'expectedVersion',
        'expectedGeneration',
        'transitionId',
        'requestId',
        'reason',
        'attemptId',
        'fencingToken',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'requestManualRunCancellation',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'requestManualRunCancellation.invocationId',
    );
    const expectedGeneration = assertNonnegativeSafeInteger(
      value.expectedGeneration,
      'requestManualRunCancellation.expectedGeneration',
    );
    // `transitionId` addresses the immutable receipt/event namespace, while
    // `requestId` is the stable caller-facing cancellation identity. Keeping
    // both explicit prevents an external retry key from colliding with a
    // lifecycle receipt such as `create`, while preserving that retry key in
    // the durable cancellation authority.
    const requestId = assertOpaqueId(
      value.requestId,
      'requestManualRunCancellation.requestId',
    );
    const reason = normalizeCancellationReason(
      value.reason,
      'requestManualRunCancellation.reason',
    );
    const hasAttemptId = Object.prototype.hasOwnProperty.call(
      value,
      'attemptId',
    );
    const hasFencingToken = Object.prototype.hasOwnProperty.call(
      value,
      'fencingToken',
    );
    if (hasAttemptId !== hasFencingToken) {
      throw new TypeError(
        'requestManualRunCancellation.attemptId and fencingToken must be supplied together.',
      );
    }
    const requestedAttemptId = hasAttemptId
      ? assertOpaqueId(
          value.attemptId,
          'requestManualRunCancellation.attemptId',
        )
      : undefined;
    const requestedFencingToken = hasFencingToken
      ? assertOpaqueId(
          value.fencingToken,
          'requestManualRunCancellation.fencingToken',
        )
      : undefined;

    /**
     * Classify durable states that make a new append unnecessary. This is
     * used both before the optimistic write and after a conditional loss so a
     * terminal or uncertainty transition that wins the race remains the
     * explicit authority instead of surfacing as an undifferentiated conflict.
     * @param {Record<string, any>} durableState - Fresh verified ledger state.
     * @returns {Promise<{invocation: Record<string, any>, currentAttempt?: Record<string, any>, result?: ManualCancellationResult}>} - Current invocation plus any authoritative cancellation result.
     */
    async function classifyDurableCancellation(durableState) {
      const durableInvocation = durableState.invocations.get(invocationId);
      if (!durableInvocation) {
        throw new ExecutionLedgerConflictError(
          common.runId,
          'manual invocation does not exist',
        );
      }
      const durableAttempt = getCurrentGenerationAttempt(
        durableState,
        durableInvocation,
        common.runId,
      );
      const retainedRequest = durableState.run.cancellationRequest;
      if (retainedRequest) {
        if (
          !hasSameCanonicalJson(
            durableInvocation.cancellationRequest,
            retainedRequest,
          ) ||
          (durableAttempt &&
            !hasSameCanonicalJson(
              durableAttempt.cancellationRequest,
              retainedRequest,
            ))
        ) {
          throw new ExecutionLedgerProjectionError(
            common.runId,
            'retained cancellation request projection mismatch',
          );
        }
        const retainedReceipt = await getTransitionReceipt(
          db,
          resolvedTableName,
          common.runId,
          retainedRequest.transitionId,
        );
        if (
          !retainedReceipt ||
          retainedReceipt.type !== 'manual-cancellation-requested'
        ) {
          throw new ExecutionLedgerProjectionError(
            common.runId,
            'retained cancellation request receipt missing',
          );
        }
        if (common.transitionId === retainedRequest.transitionId) {
          const replayedRequestDigest = createTransitionRequestDigest(
            'manual-cancellation-requested',
            {
              runId: common.runId,
              invocationId,
              expectedGeneration,
              expectedVersion: common.expectedVersion,
              transitionId: common.transitionId,
              requestId,
              reason,
              actor: common.actor,
              coordinatorEpoch: common.coordinatorEpoch,
              ...(requestedAttemptId !== undefined &&
              requestedFencingToken !== undefined
                ? {
                    attemptId: requestedAttemptId,
                    fencingToken: requestedFencingToken,
                  }
                : {}),
            },
          );
          if (retainedReceipt.request_digest !== replayedRequestDigest) {
            throw new ExecutionLedgerTransitionConflictError(
              common.runId,
              common.transitionId,
            );
          }
        }
        return {
          invocation: durableInvocation,
          ...(durableAttempt ? { currentAttempt: durableAttempt } : {}),
          result: {
            ...(await existingTransitionResult(
              durableState,
              /** @type {Record<string, any>} */ (retainedReceipt),
            )),
            outcome: /** @type {const} */ ('cancellation-requested'),
          },
        };
      }
      if (
        [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED].includes(
          durableState.run.status,
        )
      ) {
        return {
          invocation: durableInvocation,
          ...(durableAttempt ? { currentAttempt: durableAttempt } : {}),
          result: cancellationNoMutationResult(
            durableState,
            durableInvocation,
            durableAttempt,
            'terminal-authoritative',
          ),
        };
      }
      if (
        durableState.run.status === RunStatus.BLOCKED &&
        durableInvocation.status === InvocationStatus.UNCERTAIN &&
        durableAttempt?.status === AttemptStatus.ABANDONED
      ) {
        return {
          invocation: durableInvocation,
          currentAttempt: durableAttempt,
          result: cancellationNoMutationResult(
            durableState,
            durableInvocation,
            durableAttempt,
            'outcome-uncertain',
          ),
        };
      }
      return {
        invocation: durableInvocation,
        ...(durableAttempt ? { currentAttempt: durableAttempt } : {}),
      };
    }

    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const classified = await classifyDurableCancellation(state);
    if (classified.result) return classified.result;
    const invocation = classified.invocation;
    const currentAttempt = classified.currentAttempt;
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (invocation.generation !== expectedGeneration) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'stale invocation generation',
      );
    }
    if (currentAttempt) {
      if (
        requestedAttemptId === undefined ||
        requestedFencingToken === undefined ||
        requestedAttemptId !== currentAttempt.attemptId
      ) {
        throw new ExecutionLedgerConflictError(
          common.runId,
          'current attempt identity is required',
        );
      }
      assertCurrentAttemptFence(
        currentAttempt,
        {
          coordinatorEpoch: common.coordinatorEpoch,
          fencingToken: requestedFencingToken,
          generation: expectedGeneration,
        },
        common.runId,
      );
    } else if (
      requestedAttemptId !== undefined ||
      requestedFencingToken !== undefined ||
      common.coordinatorEpoch !== 0
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'cancellation supplied a stale attempt fence',
      );
    }

    const isRunnable =
      state.run.status === RunStatus.RUNNING &&
      invocation.status === InvocationStatus.RUNNABLE &&
      (!currentAttempt || currentAttempt.status === AttemptStatus.ABANDONED);
    const isClaimed =
      state.run.status === RunStatus.RUNNING &&
      invocation.status === InvocationStatus.RUNNING &&
      currentAttempt?.status === AttemptStatus.CLAIMED;
    const isStarted =
      state.run.status === RunStatus.RUNNING &&
      invocation.status === InvocationStatus.RUNNING &&
      currentAttempt?.status === AttemptStatus.STARTED;
    if (!isRunnable && !isClaimed && !isStarted) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'manual invocation cannot accept cancellation in its current state',
      );
    }

    const cancellationRequest = {
      requestId,
      transitionId: common.transitionId,
      requestedAt: common.observedAt,
      actor: common.actor,
      reason,
    };
    const requestDigest = createTransitionRequestDigest(
      'manual-cancellation-requested',
      {
        runId: common.runId,
        invocationId,
        expectedGeneration,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        requestId,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
        ...(currentAttempt
          ? {
              attemptId: currentAttempt.attemptId,
              fencingToken: currentAttempt.fencingToken,
            }
          : {}),
      },
    );
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      status: isRunnable || isClaimed ? RunStatus.CANCELLED : RunStatus.RUNNING,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      cancellationRequest,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current invocation'),
      status:
        isRunnable || isClaimed
          ? InvocationStatus.CANCELLED
          : InvocationStatus.RUNNING,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      cancellationRequest,
    };
    const nextAttempt = currentAttempt
      ? {
          ...cloneJsonObject(currentAttempt, 'current attempt'),
          status: isClaimed ? AttemptStatus.CANCELLED : currentAttempt.status,
          version: currentAttempt.version + 1,
          lastSequence: sequence,
          updatedAt: common.observedAt,
          cancellationRequest,
        }
      : undefined;
    if (isStarted && nextAttempt) {
      assertStoppedAttemptClosureFits({
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effects: [...state.effects.values()].filter(
          (effect) =>
            effect.invocationId === invocationId &&
            effect.requestedBy.attemptId === currentAttempt.attemptId,
        ),
        label: 'requestManualRunCancellation',
      });
    }
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'manual-cancellation-requested',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: expectedGeneration,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        ...(nextAttempt ? { attempt: nextAttempt } : {}),
      },
    );
    let result;
    try {
      result = await appendOrReplay({
        state,
        runId: common.runId,
        transitionId: common.transitionId,
        requestDigest,
        event,
        nextRun,
        nextInvocation,
        ...(nextAttempt ? { nextAttempt, currentAttempt } : {}),
      });
    } catch (error) {
      if (!(error instanceof ExecutionLedgerConflictError)) throw error;
      const racedState = await readVerifiedRun(common.runId);
      if (!racedState) throw error;
      const raced = await classifyDurableCancellation(racedState);
      if (raced.result) return raced.result;
      throw error;
    }
    return {
      ...result,
      outcome: /** @type {const} */ ('cancellation-requested'),
    };
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
    if (existing) return await existingTransitionResult(state, existing);
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
        await existingTransitionResult(state, existing),
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
   * Persist a logical managed-effect request before any adapter is permitted
   * to begin. Physical protocol sequence belongs to the requesting attempt;
   * the referenced request contains only fields stable across future retries.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, request: Record<string, any>, adapter: {id: string, version: number}, destination: {kind: string, version: number, bindingId: string, configuration: Record<string, any>}, verifier: {kind: string, version: number}, substantiatedReplayProperties: string[], actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Managed-effect request transition.
   * @returns {Promise<Record<string, any>>} - Persisted transition and effect projection.
   */
  async function recordManagedEffectRequest(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'recordManagedEffectRequest',
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
        'request',
        'adapter',
        'destination',
        'verifier',
        'substantiatedReplayProperties',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'recordManagedEffectRequest',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'recordManagedEffectRequest.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'recordManagedEffectRequest.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'recordManagedEffectRequest.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'recordManagedEffectRequest.generation',
    );
    const requestFrame = validateActivityProtocolComponentFrame(
      value.request,
      'recordManagedEffectRequest.request',
    );
    if (
      requestFrame.type !== 'effect-request' ||
      requestFrame.attemptId !== attemptId
    ) {
      throw new TypeError(
        'recordManagedEffectRequest.request must be an effect-request frame for the exact attempt.',
      );
    }
    const effectId = assertOpaqueId(
      requestFrame.effectId,
      'recordManagedEffectRequest.request.effectId',
    );
    const adapter = normalizeEffectAdapterDescriptor(
      value.adapter,
      'recordManagedEffectRequest.adapter',
    );
    const destination = normalizeEffectDestinationDescriptor(
      value.destination,
      'recordManagedEffectRequest.destination',
    );
    const verifier = normalizeEffectVerifierDescriptor(
      value.verifier,
      'recordManagedEffectRequest.verifier',
    );
    if (!effectVerifierRegistry.has(effectVerifierKey(verifier))) {
      throw new TypeError(
        `recordManagedEffectRequest verifier ${verifier.kind}@${verifier.version} is unavailable.`,
      );
    }
    const substantiatedReplayProperties = normalizeReplayProperties(
      value.substantiatedReplayProperties,
      'recordManagedEffectRequest.substantiatedReplayProperties',
    );
    const logicalRequest = normalizeManagedEffectRequest(
      {
        capability: requestFrame.capability,
        operation: requestFrame.operation,
        input: requestFrame.input,
        requestedReplayProperties: requestFrame.requestedReplayProperties,
      },
      'recordManagedEffectRequest.logicalRequest',
    );
    if (
      !logicalRequest.requestedReplayProperties.includes('unsafe') &&
      logicalRequest.requestedReplayProperties.some(
        (property) => !substantiatedReplayProperties.includes(property),
      )
    ) {
      throw new TypeError(
        'recordManagedEffectRequest substantiated replay properties do not satisfy the request.',
      );
    }
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const key = effectMapKey(invocationId, effectId);
    const currentEffect = state.effects.get(key);
    const retainedReceipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      common.runId,
      common.transitionId,
    );
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    if (retainedReceipt) {
      const receiptState = await stateContainingTransitionReceipt(
        state,
        retainedReceipt,
      );
      const retainedEffect = receiptState.effects.get(key);
      if (
        retainedReceipt.type !== 'effect-requested' ||
        retainedReceipt.invocation_id !== invocationId ||
        retainedReceipt.attempt_id !== attemptId ||
        retainedReceipt.effect_id !== effectId ||
        !retainedEffect ||
        !hasSameCanonicalJson(retainedEffect.adapter, adapter) ||
        !hasSameCanonicalJson(retainedEffect.destination, destination) ||
        !hasSameCanonicalJson(retainedEffect.verifier, verifier) ||
        !hasSameCanonicalJson(
          retainedEffect.substantiatedReplayProperties,
          substantiatedReplayProperties,
        ) ||
        retainedEffect.requestedBy.attemptId !== attemptId ||
        retainedEffect.requestedBy.generation !== generation ||
        retainedEffect.requestedBy.coordinatorEpoch !==
          common.coordinatorEpoch ||
        retainedEffect.requestedBy.fencingToken !== fencingToken ||
        retainedEffect.requestedBy.protocolSequence !== requestFrame.sequence ||
        !hasSameCanonicalJson(
          await payloadReader.readManagedEffectRequest(
            retainedEffect.requestRef,
          ),
          logicalRequest,
        )
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const requestDigest = createTransitionRequestDigest('effect-requested', {
        runId: common.runId,
        invocationId,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        effectId,
        protocolSequence: requestFrame.sequence,
        requestRef: retainedEffect.requestRef,
        adapter,
        destination,
        verifier,
        substantiatedReplayProperties,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      });
      const existing = assertMatchingReceipt(
        receiptState,
        retainedReceipt,
        requestDigest,
      );
      return await existingTransitionResult(
        receiptState,
        /** @type {Record<string, any>} */ (existing),
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const unresolvedEffectCount = [...state.effects.values()].filter(
      (item) =>
        item.invocationId === invocationId &&
        item.requestedBy.attemptId === attemptId &&
        [EffectStatus.PENDING, EffectStatus.STARTED].includes(item.status),
    ).length;
    if (
      unresolvedEffectCount >= EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt managed-effect limit reached',
      );
    }
    if (
      !invocation ||
      !attempt ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED ||
      currentEffect
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        currentEffect ? 'effect ID reuse' : 'attempt is not effect-capable',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const sequence = state.head.sequence + 1;
    const requestRefReserve = {
      ...cloneJsonObject(
        state.run.requestRef,
        'managed-effect request reserve',
      ),
      payloadSchema: MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
      size: EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
    };
    const prospectiveEffect = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: common.runId,
      invocationId,
      effectId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      activityId: invocation.activityId,
      destinationEffectId: createManagedEffectDestinationId({
        appId: state.run.appId,
        runId: common.runId,
        invocationId,
        effectId,
      }),
      adapter,
      destination,
      verifier,
      requestRef: requestRefReserve,
      requestedReplayProperties: logicalRequest.requestedReplayProperties,
      substantiatedReplayProperties,
      requestedBy: {
        attemptId,
        generation,
        coordinatorEpoch: common.coordinatorEpoch,
        fencingToken,
        protocolSequence: requestFrame.sequence,
      },
      status: EffectStatus.PENDING,
      version: 1,
      lastSequence: sequence,
      createdAt: common.observedAt,
      updatedAt: common.observedAt,
    };
    cloneInlinePayload(
      prospectiveEffect,
      'recordManagedEffectRequest prospective effect',
    );
    assertStoppedAttemptClosureFits({
      run: state.run,
      invocation,
      attempt,
      effects: [
        ...[...state.effects.values()].filter(
          (item) =>
            item.invocationId === invocationId &&
            item.requestedBy.attemptId === attemptId,
        ),
        prospectiveEffect,
      ],
      label: 'recordManagedEffectRequest',
    });
    const requestRef = await putVerifiedPayload(payloadStore, {
      value: logicalRequest,
      payloadSchema: MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
      label: 'recordManagedEffectRequest.requestRef',
    });
    const requestDigest = createTransitionRequestDigest('effect-requested', {
      runId: common.runId,
      invocationId,
      attemptId,
      fencingToken,
      generation,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      effectId,
      protocolSequence: requestFrame.sequence,
      requestRef,
      adapter,
      destination,
      verifier,
      substantiatedReplayProperties,
      actor: common.actor,
      coordinatorEpoch: common.coordinatorEpoch,
    });
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
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const effect = { ...prospectiveEffect, requestRef };
    assertStoppedAttemptClosureFits({
      run: state.run,
      invocation,
      attempt,
      effects: [
        ...[...state.effects.values()].filter(
          (item) =>
            item.invocationId === invocationId &&
            item.requestedBy.attemptId === attemptId,
        ),
        effect,
      ],
      label: 'recordManagedEffectRequest persisted reference',
    });
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'effect-requested',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effect,
      },
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
      nextEffect: effect,
    });
  }

  /**
   * Persist that the adapter may begin immediately after this transition.
   * @param {{runId: string, invocationId: string, attemptId: string, effectId: string, fencingToken: string, generation: number, expectedVersion: number, expectedEffectVersion: number, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Managed-effect start transition.
   * @returns {Promise<Record<string, any>>} - Persisted started effect.
   */
  async function markManagedEffectStarted(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'markManagedEffectStarted',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'effectId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'expectedEffectVersion',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'markManagedEffectStarted',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'markManagedEffectStarted.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'markManagedEffectStarted.attemptId',
    );
    const effectId = assertOpaqueId(
      value.effectId,
      'markManagedEffectStarted.effectId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'markManagedEffectStarted.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'markManagedEffectStarted.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'markManagedEffectStarted.expectedEffectVersion',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const effect = state.effects.get(effectMapKey(invocationId, effectId));
    const requestDigest = createTransitionRequestDigest('effect-started', {
      runId: common.runId,
      invocationId,
      attemptId,
      fencingToken,
      generation,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      effectId,
      expectedEffectVersion,
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
    if (existing) return await existingTransitionResult(state, existing);
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      !invocation ||
      !attempt ||
      !effect ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED ||
      effect.status !== EffectStatus.PENDING ||
      effect.version !== expectedEffectVersion ||
      effect.requestedBy.attemptId !== attemptId
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'effect is not currently pending for this attempt',
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
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextEffect = {
      ...cloneJsonObject(effect, 'current effect'),
      status: EffectStatus.STARTED,
      startedBy: {
        attemptId,
        generation,
        coordinatorEpoch: common.coordinatorEpoch,
        fencingToken,
      },
      version: effect.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    assertStoppedAttemptClosureFits({
      run: nextRun,
      invocation: nextInvocation,
      attempt: nextAttempt,
      effects: [...state.effects.values()]
        .filter(
          (item) =>
            item.invocationId === invocationId &&
            item.requestedBy.attemptId === attemptId,
        )
        .map((item) => (item.effectId === effectId ? nextEffect : item)),
      label: 'markManagedEffectStarted',
    });
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'effect-started',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effect: nextEffect,
      },
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
      nextEffect,
      currentEffect: effect,
    });
  }

  /**
   * Commit one verifier-substantiated destination outcome before it may be
   * delivered back to the component as an effect-result frame.
   * @param {{runId: string, invocationId: string, attemptId: string, effectId: string, fencingToken: string, generation: number, expectedVersion: number, expectedEffectVersion: number, transitionId: string, outcome: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Managed-effect outcome transition.
   * @returns {Promise<Record<string, any>>} - Persisted effect and canonical outcome.
   */
  async function commitManagedEffectOutcome(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'commitManagedEffectOutcome',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'effectId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'expectedEffectVersion',
        'transitionId',
        'outcome',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'commitManagedEffectOutcome',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'commitManagedEffectOutcome.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'commitManagedEffectOutcome.attemptId',
    );
    const effectId = assertOpaqueId(
      value.effectId,
      'commitManagedEffectOutcome.effectId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'commitManagedEffectOutcome.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'commitManagedEffectOutcome.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'commitManagedEffectOutcome.expectedEffectVersion',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const effect = state.effects.get(effectMapKey(invocationId, effectId));
    if (!effect) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed effect does not exist',
      );
    }
    const candidateOutcome = normalizeManagedEffectOutcome(
      {
        destinationEffectId: effect.destinationEffectId,
        adapter: effect.adapter,
        destination: effect.destination,
        verifier: effect.verifier,
        ok: value.outcome?.ok,
        ...(value.outcome?.ok === true
          ? { result: value.outcome.result }
          : { error: value.outcome?.error }),
        substantiatedReplayProperties: effect.substantiatedReplayProperties,
        evidence: value.outcome?.evidence,
      },
      'commitManagedEffectOutcome.outcome',
    );
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const logicalRequest = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    verifyManagedEffectOutcome(
      effectVerifierRegistry,
      effect,
      logicalRequest,
      candidateOutcome,
      'commitManagedEffectOutcome.outcome',
    );
    const retainedReceipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      common.runId,
      common.transitionId,
    );
    if (retainedReceipt) {
      const receiptState = await stateContainingTransitionReceipt(
        state,
        retainedReceipt,
      );
      const retainedEffect = receiptState.effects.get(
        effectMapKey(invocationId, effectId),
      );
      if (
        !retainedEffect?.outcomeRef ||
        ![EffectStatus.COMPLETED, EffectStatus.FAILED].includes(
          retainedEffect.status,
        ) ||
        retainedReceipt.type !==
          (candidateOutcome.ok ? 'effect-completed' : 'effect-failed') ||
        retainedReceipt.invocation_id !== invocationId ||
        retainedReceipt.attempt_id !== attemptId ||
        retainedReceipt.effect_id !== effectId ||
        !hasSameCanonicalJson(
          await payloadReader.readManagedEffectOutcome(
            retainedEffect.outcomeRef,
          ),
          candidateOutcome,
        )
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const requestDigest = createTransitionRequestDigest(
        candidateOutcome.ok ? 'effect-completed' : 'effect-failed',
        {
          runId: common.runId,
          invocationId,
          attemptId,
          fencingToken,
          generation,
          expectedVersion: common.expectedVersion,
          transitionId: common.transitionId,
          effectId,
          expectedEffectVersion,
          outcomeRef: retainedEffect.outcomeRef,
          actor: common.actor,
          coordinatorEpoch: common.coordinatorEpoch,
        },
      );
      const existing = assertMatchingReceipt(
        receiptState,
        retainedReceipt,
        requestDigest,
      );
      return {
        ...(await existingTransitionResult(
          receiptState,
          /** @type {Record<string, any>} */ (existing),
        )),
        outcome: candidateOutcome,
      };
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      !invocation ||
      !attempt ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED ||
      effect.status !== EffectStatus.STARTED ||
      effect.version !== expectedEffectVersion ||
      effect.startedBy?.attemptId !== attemptId
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'effect is not currently started for this attempt',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const outcomeRef = await putVerifiedPayload(payloadStore, {
      value: candidateOutcome,
      payloadSchema: MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      label: 'commitManagedEffectOutcome.outcomeRef',
    });
    const eventType = candidateOutcome.ok
      ? 'effect-completed'
      : 'effect-failed';
    const requestDigest = createTransitionRequestDigest(eventType, {
      runId: common.runId,
      invocationId,
      attemptId,
      fencingToken,
      generation,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      effectId,
      expectedEffectVersion,
      outcomeRef,
      actor: common.actor,
      coordinatorEpoch: common.coordinatorEpoch,
    });
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
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextEffect = {
      ...cloneJsonObject(effect, 'current effect'),
      status: candidateOutcome.ok
        ? EffectStatus.COMPLETED
        : EffectStatus.FAILED,
      terminal: { ok: candidateOutcome.ok },
      outcomeRef,
      version: effect.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      eventType,
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effect: nextEffect,
      },
    );
    const result = await appendOrReplay({
      state,
      runId: common.runId,
      transitionId: common.transitionId,
      requestDigest,
      event,
      nextRun,
      nextInvocation,
      nextAttempt,
      currentAttempt: attempt,
      nextEffect,
      currentEffect: effect,
    });
    return { ...result, outcome: candidateOutcome };
  }

  /**
   * Block the whole manual aggregate when an adapter may have begun but no
   * registered verifier can establish its destination outcome.
   * @param {{runId: string, invocationId: string, attemptId: string, effectId: string, fencingToken: string, generation: number, expectedVersion: number, expectedEffectVersion: number, transitionId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Managed-effect uncertainty transition.
   * @returns {Promise<Record<string, any>>} - Persisted blocked aggregate.
   */
  async function markManagedEffectUncertain(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'markManagedEffectUncertain',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'effectId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'expectedEffectVersion',
        'transitionId',
        'reason',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'markManagedEffectUncertain',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'markManagedEffectUncertain.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'markManagedEffectUncertain.attemptId',
    );
    const effectId = assertOpaqueId(
      value.effectId,
      'markManagedEffectUncertain.effectId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'markManagedEffectUncertain.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'markManagedEffectUncertain.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'markManagedEffectUncertain.expectedEffectVersion',
    );
    const reason = cloneBoundedJsonObject(
      value.reason,
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
      'markManagedEffectUncertain.reason',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const effect = state.effects.get(effectMapKey(invocationId, effectId));
    const unresolvedEffectsForUncertainty = [...state.effects.values()].filter(
      (item) =>
        item.invocationId === invocationId &&
        item.requestedBy.attemptId === attemptId &&
        [EffectStatus.PENDING, EffectStatus.STARTED].includes(item.status),
    );
    const requestDigest = createTransitionRequestDigest(
      'effect-became-uncertain',
      {
        runId: common.runId,
        invocationId,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        effectId,
        expectedEffectVersion,
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
    if (existing) return await existingTransitionResult(state, existing);
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      !invocation ||
      !attempt ||
      !effect ||
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      attempt.status !== AttemptStatus.STARTED ||
      effect.status !== EffectStatus.STARTED ||
      effect.version !== expectedEffectVersion ||
      effect.startedBy?.attemptId !== attemptId ||
      unresolvedEffectsForUncertainty.length !== 1 ||
      unresolvedEffectsForUncertainty[0].effectId !== effectId
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'effect is not currently started for uncertainty',
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
      uncertainty: reason,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current attempt'),
      status: AttemptStatus.ABANDONED,
      abandonment: reason,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextEffect = {
      ...cloneJsonObject(effect, 'current effect'),
      status: EffectStatus.UNCERTAIN,
      uncertainty: reason,
      version: effect.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'effect-became-uncertain',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effect: nextEffect,
      },
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
      nextEffect,
      currentEffect: effect,
    });
  }

  /**
   * Atomically close the complete unresolved managed-effect set for a stopped
   * STARTED attempt, then retain the enclosing arbitrary activity as uncertain.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, decisions: Array<{effectId: string, expectedEffectVersion: number, disposition: 'cancelled-before-start', reason?: Record<string, any>}|{effectId: string, expectedEffectVersion: number, disposition: 'outcome-recovered', outcome: Record<string, any>}|{effectId: string, expectedEffectVersion: number, disposition: 'outcome-uncertain', reason?: Record<string, any>}>, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Exact stopped-attempt settlement.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, effects: Record<string, any>[]}>} - Compound settlement result.
   */
  async function settleStoppedAttemptManagedEffects(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'settleStoppedAttemptManagedEffects',
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
        'decisions',
        'reason',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'settleStoppedAttemptManagedEffects',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'settleStoppedAttemptManagedEffects.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'settleStoppedAttemptManagedEffects.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'settleStoppedAttemptManagedEffects.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'settleStoppedAttemptManagedEffects.generation',
    );
    const reason = cloneBoundedJsonObject(
      value.reason,
      STOPPED_ATTEMPT_SETTLEMENT_REASON_MAX_BYTES,
      'settleStoppedAttemptManagedEffects.reason',
    );
    if (!Array.isArray(value.decisions) || value.decisions.length === 0) {
      throw new TypeError(
        'settleStoppedAttemptManagedEffects.decisions must be a nonempty array.',
      );
    }
    if (
      value.decisions.length > EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS
    ) {
      throw new RangeError(
        `settleStoppedAttemptManagedEffects.decisions must not exceed ${EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS} entries.`,
      );
    }

    /** @type {Record<string, any>[]} */
    const decisions = value.decisions.map((candidate, index) => {
      const label = `settleStoppedAttemptManagedEffects.decisions[${index}]`;
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
      ) {
        throw new TypeError(`${label} must be an object.`);
      }
      const disposition = candidate.disposition;
      if (disposition === 'outcome-recovered') {
        assertExactKeys(
          candidate,
          ['effectId', 'expectedEffectVersion', 'disposition', 'outcome'],
          label,
        );
      } else if (
        disposition === 'cancelled-before-start' ||
        disposition === 'outcome-uncertain'
      ) {
        assertSnapshotKeys(
          candidate,
          ['effectId', 'expectedEffectVersion', 'disposition'],
          ['reason'],
          label,
        );
      } else {
        throw new TypeError(`${label}.disposition is not supported.`);
      }
      return {
        effectId: assertOpaqueId(candidate.effectId, `${label}.effectId`),
        expectedEffectVersion: assertPositiveSafeInteger(
          candidate.expectedEffectVersion,
          `${label}.expectedEffectVersion`,
        ),
        disposition,
        ...(disposition === 'outcome-recovered'
          ? { outcome: candidate.outcome }
          : {
              reason: cloneBoundedJsonObject(
                candidate.reason ||
                  (disposition === 'cancelled-before-start'
                    ? DEFAULT_PRE_START_EFFECT_CANCELLATION
                    : reason),
                STOPPED_ATTEMPT_SETTLEMENT_REASON_MAX_BYTES,
                `${label}.reason`,
              ),
            }),
      };
    });
    const effectIds = decisions.map((decision) => decision.effectId);
    if (
      new Set(effectIds).size !== effectIds.length ||
      !hasSameCanonicalJson(effectIds, [...effectIds].sort())
    ) {
      throw new TypeError(
        'settleStoppedAttemptManagedEffects.decisions must have unique, canonically sorted effectId values.',
      );
    }

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
    const retainedReceipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      common.runId,
      common.transitionId,
    );
    if (retainedReceipt) {
      if (
        retainedReceipt.type !== 'attempt-became-uncertain' ||
        retainedReceipt.invocation_id !== invocationId ||
        retainedReceipt.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
    } else {
      if (state.head.version !== common.expectedVersion) {
        throw new ExecutionLedgerConflictError(
          common.runId,
          'stale run version',
        );
      }
      if (
        !invocation ||
        !attempt ||
        state.run.status !== RunStatus.RUNNING ||
        invocation.status !== InvocationStatus.RUNNING ||
        attempt.status !== AttemptStatus.STARTED
      ) {
        throw new ExecutionLedgerConflictError(
          common.runId,
          'attempt cannot settle managed effects',
        );
      }
      assertCurrentAttemptFence(
        attempt,
        { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
        common.runId,
      );
      const unresolvedEffects = [...state.effects.values()]
        .filter(
          (effect) =>
            effect.invocationId === invocationId &&
            effect.requestedBy.attemptId === attemptId &&
            [EffectStatus.PENDING, EffectStatus.STARTED].includes(
              effect.status,
            ),
        )
        .sort((left, right) =>
          left.effectId < right.effectId
            ? -1
            : left.effectId > right.effectId
              ? 1
              : 0,
        );
      if (
        unresolvedEffects.length >
          EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS ||
        !hasSameCanonicalJson(
          effectIds,
          unresolvedEffects.map((effect) => effect.effectId),
        )
      ) {
        throw new ExecutionLedgerConflictError(
          common.runId,
          'decisions do not cover the exact unresolved managed-effect set',
        );
      }
      for (const decision of decisions) {
        const effect = state.effects.get(
          effectMapKey(invocationId, decision.effectId),
        );
        if (
          !effect ||
          effect.version !== decision.expectedEffectVersion ||
          (effect.status === EffectStatus.PENDING &&
            decision.disposition !== 'cancelled-before-start') ||
          (effect.status === EffectStatus.STARTED &&
            !['outcome-recovered', 'outcome-uncertain'].includes(
              decision.disposition,
            )) ||
          (effect.status === EffectStatus.STARTED &&
            effect.startedBy?.attemptId !== attemptId)
        ) {
          throw new ExecutionLedgerConflictError(
            common.runId,
            'managed-effect settlement decision is stale or incompatible',
          );
        }
      }
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);

    /** @type {Array<{decision: Record<string, any>, effect: Record<string, any>, outcome?: Record<string, any>, outcomeRef?: Record<string, any>}>} */
    const prepared = [];
    for (const decision of decisions) {
      const effect = state.effects.get(
        effectMapKey(invocationId, decision.effectId),
      );
      if (!effect) {
        throw new ExecutionLedgerConflictError(
          common.runId,
          'managed effect does not exist',
        );
      }
      if (decision.disposition !== 'outcome-recovered') {
        prepared.push({ decision, effect });
        continue;
      }
      const outcome = normalizeManagedEffectOutcome(
        {
          destinationEffectId: effect.destinationEffectId,
          adapter: effect.adapter,
          destination: effect.destination,
          verifier: effect.verifier,
          ok: decision.outcome?.ok,
          ...(decision.outcome?.ok === true
            ? { result: decision.outcome.result }
            : { error: decision.outcome?.error }),
          substantiatedReplayProperties: effect.substantiatedReplayProperties,
          evidence: decision.outcome?.evidence,
        },
        `settleStoppedAttemptManagedEffects outcome ${decision.effectId}`,
      );
      const logicalRequest = await payloadReader.readManagedEffectRequest(
        effect.requestRef,
      );
      verifyManagedEffectOutcome(
        effectVerifierRegistry,
        effect,
        logicalRequest,
        outcome,
        `settleStoppedAttemptManagedEffects outcome ${decision.effectId}`,
      );
      prepared.push({ decision, effect, outcome });
    }

    // Persist references only after every recovered outcome has verified. The
    // content-addressed writes may be orphaned by a later control-store race,
    // but no partial ledger settlement can become visible.
    for (const item of prepared) {
      if (!item.outcome) continue;
      item.outcomeRef = await putVerifiedPayload(payloadStore, {
        value: item.outcome,
        payloadSchema: MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
        label: `settleStoppedAttemptManagedEffects outcomeRef ${item.decision.effectId}`,
      });
    }
    const digestDecisions = prepared.map((item) => ({
      effectId: item.decision.effectId,
      expectedEffectVersion: item.decision.expectedEffectVersion,
      disposition: item.decision.disposition,
      ...(item.outcomeRef
        ? { outcomeRef: item.outcomeRef }
        : { reason: item.decision.reason }),
    }));
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
        decisions: digestDecisions,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    if (retainedReceipt) {
      const existing = assertMatchingReceipt(
        state,
        retainedReceipt,
        requestDigest,
      );
      return /** @type {any} */ (
        await existingTransitionResult(
          state,
          /** @type {Record<string, any>} */ (existing),
          effectIds,
        )
      );
    }
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
      uncertainty: reason,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current attempt'),
      status: AttemptStatus.ABANDONED,
      abandonment: reason,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextEffects = prepared.map((item) => ({
      ...cloneJsonObject(item.effect, 'current effect'),
      ...(item.decision.disposition === 'cancelled-before-start'
        ? {
            status: EffectStatus.CANCELLED,
            cancellation: item.decision.reason,
          }
        : item.decision.disposition === 'outcome-uncertain'
          ? {
              status: EffectStatus.UNCERTAIN,
              uncertainty: item.decision.reason,
            }
          : {
              status:
                item.outcome?.ok === true
                  ? EffectStatus.COMPLETED
                  : EffectStatus.FAILED,
              terminal: { ok: item.outcome?.ok === true },
              outcomeRef: item.outcomeRef,
            }),
      version: item.effect.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    }));
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
      {
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effects: nextEffects,
      },
    );
    return /** @type {any} */ (
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
        effectTransitions: prepared.map((item, index) => ({
          currentEffect: item.effect,
          nextEffect: nextEffects[index],
        })),
        resultEffectIds: effectIds,
      })
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
    await assertAttemptEvidenceMatchesManagedEffects(
      evidence,
      attempt,
      state,
      payloadReader,
      effectVerifierRegistry,
      common.runId,
    );
    if (
      !TERMINAL_TYPES.has(terminal.type) ||
      terminal.attemptId !== attemptId
    ) {
      throw new TypeError(
        'commitVerifiedAttemptTerminal.evidence must end with a terminal for the exact persisted attempt.',
      );
    }
    assertSupportedManualTerminal(
      terminal,
      evidence,
      state.run.cancellationRequest,
      'commitVerifiedAttemptTerminal',
    );
    const terminalSummary = createTerminalSummary(terminal);
    const existingReceipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      common.runId,
      common.transitionId,
    );
    if (existingReceipt) {
      const receiptState = await stateContainingTransitionReceipt(
        state,
        existingReceipt,
      );
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
      const existingEvent = receiptState.events[existingReceipt.sequence - 1];
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
        receiptState,
        existingReceipt,
        existingRequestDigest,
      );
      if (!existing) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'terminal receipt disappeared',
        );
      }
      return await existingTransitionResult(receiptState, existing);
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
    const reason = cloneBoundedJsonObject(
      value.reason,
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
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
        decisions: [],
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
    if (existing) return await existingTransitionResult(state, existing);
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const hasUnresolvedManagedEffect = [...state.effects.values()].some(
      (effect) =>
        effect.invocationId === invocationId &&
        effect.requestedBy.attemptId === attemptId &&
        [EffectStatus.PENDING, EffectStatus.STARTED].includes(effect.status),
    );
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
    if (hasUnresolvedManagedEffect) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed effect must become uncertain explicitly',
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
      {
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effects: [],
      },
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
   * Resolve one retained uncertain physical attempt from a complete, exact
   * Activity Protocol transcript. The physical attempt remains ABANDONED: this
   * transition only gives the previously blocked invocation and run their one
   * authoritative logical terminal outcome.
   * @param {{runId: string, invocationId: string, attemptId: string, fencingToken: string, generation: number, coordinatorEpoch: number, expectedVersion: number, uncertaintyEventId: string, uncertaintySequence: number, transitionId: string, reconciliationId: string, actor?: {kind: string, id: string}, reason: Record<string, any>, evidence: Record<string, any>, observedAt?: number}} options - Evidence-backed uncertain-attempt reconciliation request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>}>} - Reconciliation outcome.
   */
  async function reconcileUncertainManualAttempt(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'reconcileUncertainManualAttempt',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'attemptId',
        'fencingToken',
        'generation',
        'coordinatorEpoch',
        'expectedVersion',
        'uncertaintyEventId',
        'uncertaintySequence',
        'transitionId',
        'reconciliationId',
        'actor',
        'reason',
        'evidence',
        'observedAt',
      ],
      'reconcileUncertainManualAttempt',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'reconcileUncertainManualAttempt.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'reconcileUncertainManualAttempt.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'reconcileUncertainManualAttempt.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'reconcileUncertainManualAttempt.generation',
    );
    const reconciliationId = assertOpaqueId(
      value.reconciliationId,
      'reconcileUncertainManualAttempt.reconciliationId',
    );
    const uncertaintyEventId = assertOpaqueId(
      value.uncertaintyEventId,
      'reconcileUncertainManualAttempt.uncertaintyEventId',
    );
    const uncertaintySequence = assertPositiveSafeInteger(
      value.uncertaintySequence,
      'reconcileUncertainManualAttempt.uncertaintySequence',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'reconcileUncertainManualAttempt.reason',
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
      'reconcileUncertainManualAttempt.evidence',
    );
    const terminal = verifiedEvidence.terminal;
    const evidence = verifiedEvidence.evidence;
    await assertAttemptEvidenceMatchesManagedEffects(
      evidence,
      attempt,
      state,
      payloadReader,
      effectVerifierRegistry,
      common.runId,
    );
    if (
      !TERMINAL_TYPES.has(terminal.type) ||
      terminal.attemptId !== attemptId
    ) {
      throw new TypeError(
        'reconcileUncertainManualAttempt.evidence must end with a terminal for the exact retained attempt.',
      );
    }
    assertSupportedManualTerminal(
      terminal,
      evidence,
      state.run.cancellationRequest,
      'reconcileUncertainManualAttempt',
    );
    const terminalSummary = createTerminalSummary(terminal);
    const existingReceipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      common.runId,
      common.transitionId,
    );
    if (existingReceipt) {
      const receiptState = await stateContainingTransitionReceipt(
        state,
        existingReceipt,
      );
      if (
        existingReceipt.type !== 'uncertain-attempt-reconciled' ||
        existingReceipt.invocation_id !== invocationId ||
        existingReceipt.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingEvent = receiptState.events[existingReceipt.sequence - 1];
      if (
        !existingEvent ||
        existingEvent.event_id !== existingReceipt.event_id ||
        existingEvent.transition_id !== common.transitionId
      ) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'reconciliation receipt event is unavailable',
        );
      }
      const existingReconciliation = eventSnapshots(
        existingEvent,
        common.runId,
      ).reconciliation;
      if (!existingReconciliation) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'reconciliation receipt lacks reconciliation payload',
        );
      }
      if (
        !hasSameCanonicalJson(
          await payloadReader.readEvidence(existingReconciliation.evidenceRef),
          evidence,
        )
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingRequestDigest = createTransitionRequestDigest(
        'uncertain-attempt-reconciled',
        {
          runId: common.runId,
          invocationId,
          attemptId,
          fencingToken,
          generation,
          expectedVersion: common.expectedVersion,
          transitionId: common.transitionId,
          reconciliationId,
          uncertaintyEventId,
          uncertaintySequence,
          verifier: existingReconciliation.verifier,
          evidenceRef: existingReconciliation.evidenceRef,
          terminal: terminalSummary,
          reason,
          actor: common.actor,
          coordinatorEpoch: common.coordinatorEpoch,
        },
      );
      const existing = assertMatchingReceipt(
        receiptState,
        existingReceipt,
        existingRequestDigest,
      );
      if (!existing) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'reconciliation receipt disappeared',
        );
      }
      return await existingTransitionResult(receiptState, existing);
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const uncertaintyEvent = state.events[uncertaintySequence - 1];
    if (
      state.run.status !== RunStatus.BLOCKED ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.generation !== generation ||
      attempt.status !== AttemptStatus.ABANDONED ||
      !hasExactUncertaintyEventLink({
        run: state.run,
        invocation,
        attempt,
        reconciliation: {
          invocationId,
          attemptId,
          generation,
          coordinatorEpoch: common.coordinatorEpoch,
          fencingToken,
          uncertaintyEventId,
          uncertaintySequence,
        },
        uncertaintyEvent,
        runId: common.runId,
      })
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'attempt is not the retained uncertain attempt',
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
      label: 'reconcileUncertainManualAttempt.evidenceRef',
    });
    const reconciliation = {
      reconciliationId,
      invocationId,
      attemptId,
      generation,
      coordinatorEpoch: common.coordinatorEpoch,
      fencingToken,
      uncertaintyEventId,
      uncertaintySequence,
      verifier: cloneInlinePayload(
        UNCERTAIN_ATTEMPT_RECONCILIATION_VERIFIER,
        'reconcileUncertainManualAttempt.verifier',
      ),
      evidenceRef,
      terminal: terminalSummary,
      reason,
    };
    const requestDigest = createTransitionRequestDigest(
      'uncertain-attempt-reconciled',
      {
        runId: common.runId,
        invocationId,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        reconciliationId,
        uncertaintyEventId,
        uncertaintySequence,
        verifier: reconciliation.verifier,
        evidenceRef,
        terminal: terminalSummary,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    const statuses = statusesForTerminal(terminal);
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current run'),
      status: statuses.run,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = cloneJsonObject(invocation, 'current invocation');
    delete nextInvocation.uncertainty;
    nextInvocation.status = statuses.invocation;
    nextInvocation.version = invocation.version + 1;
    nextInvocation.lastSequence = sequence;
    nextInvocation.updatedAt = common.observedAt;
    nextInvocation.terminal = terminalSummary;
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'uncertain-attempt-reconciled',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      { run: nextRun, invocation: nextInvocation, reconciliation },
    );
    return await appendOrReplay({
      state,
      runId: common.runId,
      transitionId: common.transitionId,
      requestDigest,
      event,
      nextRun,
      nextInvocation,
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
    if (existing) return await existingTransitionResult(state, existing);
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
   * @param {string} invocationId - Invocation identity.
   * @param {string} effectId - Logical effect identity.
   * @returns {Promise<Record<string, any> | null>} - Current retained effect projection after verification.
   */
  async function getEffect(runId, invocationId, effectId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const normalizedInvocationId = assertOpaqueId(invocationId, 'invocationId');
    const normalizedEffectId = assertOpaqueId(effectId, 'effectId');
    const state = await readVerifiedRun(normalizedRunId);
    const effect = state?.effects.get(
      effectMapKey(normalizedInvocationId, normalizedEffectId),
    );
    return effect ? cloneJsonObject(effect, 'effect') : null;
  }

  /**
   * Read the immutable logical request and, when terminal, reverify and expose
   * the exact Activity Protocol result that may be redelivered after response
   * loss. A terminal projection alone is never sufficient authority: this
   * method rehashes both payload references and reruns the versioned verifier.
   * @param {string} runId - Run identity.
   * @param {string} invocationId - Invocation identity.
   * @param {string} effectId - Logical effect identity.
   * @returns {Promise<{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, effect: Record<string, any>, request: Record<string, any>, outcome?: Record<string, any>, resultFrame?: Readonly<Record<string, any>>}|null>} - Verified resumable delivery state.
   */
  async function readManagedEffectDelivery(runId, invocationId, effectId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const normalizedInvocationId = assertOpaqueId(invocationId, 'invocationId');
    const normalizedEffectId = assertOpaqueId(effectId, 'effectId');
    const state = await readVerifiedRun(normalizedRunId);
    const invocation = state?.invocations.get(normalizedInvocationId);
    const effect = state?.effects.get(
      effectMapKey(normalizedInvocationId, normalizedEffectId),
    );
    if (!state || !invocation || !effect) return null;
    const attempt = state.attempts.get(
      attemptMapKey(normalizedInvocationId, effect.requestedBy.attemptId),
    );
    if (!attempt) {
      throw new ExecutionLedgerProjectionError(
        normalizedRunId,
        'managed effect attempt is unavailable',
      );
    }
    const payloadReader = createLedgerPayloadReader(
      payloadStore,
      normalizedRunId,
    );
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    const result = {
      run: cloneJsonObject(state.run, 'managed effect run'),
      invocation: cloneJsonObject(invocation, 'managed effect invocation'),
      attempt: cloneJsonObject(attempt, 'managed effect attempt'),
      effect: cloneJsonObject(effect, 'managed effect'),
      request: cloneJsonObject(request, 'managed effect request'),
    };
    if (
      ![EffectStatus.COMPLETED, EffectStatus.FAILED].includes(effect.status)
    ) {
      return result;
    }
    if (!effect.outcomeRef || !effect.startedBy) {
      throw new ExecutionLedgerProjectionError(
        normalizedRunId,
        'terminal managed effect lacks outcome authority',
      );
    }
    const outcome = await payloadReader.readManagedEffectOutcome(
      effect.outcomeRef,
    );
    try {
      verifyManagedEffectOutcome(
        effectVerifierRegistry,
        effect,
        request,
        outcome,
        'managed effect redelivery outcome',
      );
    } catch {
      throw new ExecutionLedgerProjectionError(
        normalizedRunId,
        'managed effect redelivery evidence is invalid',
      );
    }
    const resultFrame = validateActivityProtocolHostFrame(
      {
        protocol: ACTIVITY_PROTOCOL_NAME,
        protocolVersion: ACTIVITY_PROTOCOL_VERSION,
        type: 'effect-result',
        attemptId: effect.startedBy.attemptId,
        effectId: effect.effectId,
        ok: outcome.ok,
        ...(outcome.ok ? { result: outcome.result } : { error: outcome.error }),
        substantiatedReplayProperties: outcome.substantiatedReplayProperties,
        evidence: outcome.evidence,
      },
      'managed effect redelivery result',
    );
    return {
      ...result,
      outcome: cloneJsonObject(outcome, 'managed effect outcome'),
      resultFrame,
    };
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
   * @returns {Promise<{head: Record<string, any>, run: Record<string, any>, invocations: Record<string, any>[], attempts: Record<string, any>[], effects: Record<string, any>[], events: Record<string, any>[]}|null>} - Rebuilt run view.
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
      effects: [...state.effects.values()]
        .sort((left, right) => {
          const leftKey = effectMapKey(left.invocationId, left.effectId);
          const rightKey = effectMapKey(right.invocationId, right.effectId);
          return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
        })
        .map((effect) => cloneJsonObject(effect, 'effect')),
      events: state.events.map((event) => cloneJsonObject(event, 'event')),
    };
  }

  return {
    abandonUnstartedAttempt,
    claimInvocation,
    commitVerifiedAttemptTerminal,
    commitManagedEffectOutcome,
    createManualRun,
    getAttempt,
    getEffect,
    getEvents,
    getInvocation,
    getRun,
    listRuns,
    markAttemptStarted,
    markAttemptUncertain,
    markManagedEffectStarted,
    markManagedEffectUncertain,
    recordManagedEffectRequest,
    readManagedEffectDelivery,
    reconcileUncertainManualAttempt,
    rebuildRun,
    requestManualRunCancellation,
    settleStoppedAttemptManagedEffects,
  };
}

/**
 * @typedef ExecutionLedgerStore
 * @property {(...args: any[]) => Promise<any>} createManualRun - Creates one idempotent manual run.
 * @property {(...args: any[]) => Promise<any>} claimInvocation - Claims the next physical generation.
 * @property {(...args: any[]) => Promise<any>} markAttemptStarted - Persists the handler-start boundary.
 * @property {(...args: any[]) => Promise<any>} commitVerifiedAttemptTerminal - Commits validated terminal evidence.
 * @property {(...args: any[]) => Promise<any>} recordManagedEffectRequest - Persists a logical effect before adapter start.
 * @property {(...args: any[]) => Promise<any>} markManagedEffectStarted - Persists that an adapter may have begun.
 * @property {(...args: any[]) => Promise<any>} commitManagedEffectOutcome - Commits verifier-backed destination outcome evidence.
 * @property {(...args: any[]) => Promise<any>} markManagedEffectUncertain - Blocks an aggregate on an ambiguous begun effect.
 * @property {(...args: any[]) => Promise<any>} settleStoppedAttemptManagedEffects - Atomically closes every unresolved effect for a stopped attempt.
 * @property {(...args: any[]) => Promise<any>} markAttemptUncertain - Blocks a begun ambiguous attempt.
 * @property {(...args: any[]) => Promise<any>} reconcileUncertainManualAttempt - Resolves one retained uncertain attempt from exact durable evidence.
 * @property {(...args: any[]) => Promise<any>} abandonUnstartedAttempt - Safely releases an unstarted claim.
 * @property {(...args: any[]) => Promise<any>} requestManualRunCancellation - Persists the first cancellation request or returns authoritative terminal/uncertain state.
 * @property {(runId: string) => Promise<Record<string, any> | null>} getRun - Reads a verified run projection.
 * @property {(runId: string, invocationId: string) => Promise<Record<string, any> | null>} getInvocation - Reads a verified invocation projection.
 * @property {(runId: string, invocationId: string, attemptId: string) => Promise<Record<string, any> | null>} getAttempt - Reads a verified attempt projection.
 * @property {(runId: string, invocationId: string, effectId: string) => Promise<Record<string, any> | null>} getEffect - Reads a verified effect projection.
 * @property {(runId: string, invocationId: string, effectId: string) => Promise<Record<string, any> | null>} readManagedEffectDelivery - Rehashes a logical request and re-verifies any terminal result for safe redelivery.
 * @property {(runId: string) => Promise<Record<string, any>[]>} getEvents - Reads a verified event stream.
 * @property {(options: {appId: string, limit?: number, cursor?: string}) => Promise<{items: Record<string, any>[], nextCursor?: string}>} listRuns - Reads a verified bounded run-history page.
 * @property {(runId: string) => Promise<Record<string, any> | null>} rebuildRun - Rebuilds and verifies a whole run.
 */

export default createExecutionLedger;
