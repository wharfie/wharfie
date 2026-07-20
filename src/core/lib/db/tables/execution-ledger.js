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
  MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA,
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
  verifyManagedEffectReconciliationEvidence,
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
  getWorkflowCursorProjectionSortKey,
} from '../../ledger/record-key.js';
import {
  EXECUTION_LEDGER_RUN_DIRECTORY_SORT_KEY_PREFIX,
  createExecutionLedgerRunDirectoryScope,
  getExecutionLedgerRunDirectorySortKey,
  parseExecutionLedgerRunDirectorySortKey,
} from '../../ledger/run-directory.js';
import {
  EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX,
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkRecord,
  createExecutionLedgerReadyWorkScope,
  normalizeExecutionLedgerReadyWorkRecord,
  parseExecutionLedgerReadyWorkSortKey,
} from '../../ledger/ready-work.js';
import {
  MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID,
  assertInitialManagedEffectSuccessorRetryEligible,
  assertManagedEffectSuccessorAuthorizationDerived,
  createManagedEffectSuccessorAuthorization,
  createManagedEffectSuccessorRequestDigest,
  normalizeManagedEffectSuccessorAuthorization,
} from '../../ledger/managed-effect-successor-contract.js';
import {
  WORKFLOW_ACTIVITY_REQUEST_PAYLOAD_SCHEMA as ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_OUTPUT_PAYLOAD_KIND,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  WORKFLOW_PLAN_PAYLOAD_SCHEMA,
  WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
  WORKFLOW_START_PAYLOAD_KIND,
  WORKFLOW_START_PAYLOAD_SCHEMA,
  WorkflowCursorDisposition,
  assertWorkflowRunId,
  isWorkflowActivityDispatchSupported,
  materializeFirstWorkflowActivity,
  materializeUncertainWorkflowActivityFailure,
  materializeUncertainWorkflowActivitySuccess,
  materializeWorkflowActivityClaimRelease,
  materializeWorkflowActivityFailure,
  materializeWorkflowActivitySuccess,
  materializeWorkflowActivityUncertainty,
  materializeWorkflowCursorActivity,
  normalizeWorkflowActivityRequest,
  normalizeWorkflowCursor,
  normalizeWorkflowOutputPayload,
  normalizeWorkflowPlanPayload,
  normalizeWorkflowStartPayload,
} from '../../ledger/workflow-execution-contract.js';
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
 * The V10 ledger carries forward the proven single-activity and managed-effect
 * state machines while adding a transactionally maintained ready-work
 * projection. The projection is only a locator: the append-only event stream,
 * rebuilt projections, and ordinary fenced transitions remain execution
 * authority. Its table write authority is a trusted control-plane boundary:
 * content IDs and request digests detect inconsistent records, but are not
 * signatures against a writer that can replace an entire semantically valid
 * history.
 */
// V10 intentionally does not read v1-v9 records. Older durable records remain
// isolated under their original sort-key and run-directory namespaces.

const KEY_NAME = 'run_id';
const SORT_KEY_NAME = 'sort_key';
const RUN_DIRECTORY_RECORD_TYPE = 'execution_ledger_run_directory';
const RUN_DIRECTORY_RUN_KINDS = new Set([
  'manual',
  'workflow',
  'effect-successor',
]);
const RUN_DIRECTORY_CURSOR_SCHEMA_VERSION = 8;
const RUN_DIRECTORY_DEFAULT_PAGE_SIZE = 50;
const RUN_DIRECTORY_MAX_PAGE_SIZE = 100;
const RUN_DIRECTORY_MAX_PAGE_RETRIES = 3;
const READY_WORK_DEFAULT_PAGE_SIZE = 50;
const READY_WORK_MAX_PAGE_SIZE = 100;
const READY_WORK_CURSOR_SCHEMA_VERSION = 1;
const READY_WORK_CURSOR_MAX_BYTES = 4096;
const SUCCESSOR_IDENTITY_SORT_KEY_PREFIX = 'successor-identity/v1/';
const EVENT_TYPES = new Set([
  'manual-run-created',
  'workflow-run-created',
  'workflow-activity-claimed',
  'workflow-activity-started',
  'workflow-activity-succeeded',
  'workflow-activity-failed',
  'workflow-activity-abandoned-before-start',
  'workflow-activity-became-uncertain',
  'workflow-activity-uncertainty-reconciled',
  'effect-successor-authorized',
  'effect-successor-run-created',
  'effect-successor-started',
  'effect-successor-terminal',
  'effect-successor-interrupted',
  'effect-successor-reconciled',
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
  'uncertain-effect-reconciled',
]);
const TERMINAL_TYPES = new Set(ACTIVITY_PROTOCOL_TERMINAL_TYPES);
const SUPPORTED_MANUAL_TERMINAL_TYPES = new Set([
  'completed',
  'failed',
  'cancelled',
  'protocol-failed',
]);
const SUPPORTED_WORKFLOW_ACTIVITY_TERMINAL_TYPES = new Set([
  'completed',
  'failed',
  'protocol-failed',
]);
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
 * @param {unknown} value - Candidate run trigger.
 * @returns {Record<string, any>} - Validated trigger.
 */
function normalizeRunTrigger(value) {
  const trigger = cloneBoundedJsonObject(
    value ?? { kind: 'manual' },
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'trigger',
  );
  if (trigger.kind === 'manual') {
    assertExactKeys(trigger, ['kind'], 'trigger');
    return { kind: 'manual' };
  }
  if (trigger.kind === 'workflow') {
    assertExactKeys(
      trigger,
      ['kind', 'workflowId', 'planId', 'planRef'],
      'trigger',
    );
    assertLogicalId(trigger.workflowId, 'trigger.workflowId');
    assertOpaqueId(trigger.planId, 'trigger.planId');
    trigger.planRef = normalizePayloadReference(
      trigger.planRef,
      WORKFLOW_PLAN_PAYLOAD_SCHEMA,
      'trigger.planRef',
    );
    return trigger;
  }
  if (trigger.kind === 'effect-successor') {
    return normalizeManagedEffectSuccessorAuthorization(trigger);
  }
  throw new TypeError(
    "trigger.kind must be 'manual', 'workflow', or 'effect-successor'.",
  );
}

/**
 * @param {Record<string, any>} trigger - Verified run trigger.
 * @returns {'manual'|'workflow'|'effect-successor'} - Redacted run-directory kind.
 */
function runKindFromTrigger(trigger) {
  return trigger.kind === 'workflow'
    ? 'workflow'
    : trigger.kind === 'effect-successor'
      ? 'effect-successor'
      : 'manual';
}

/**
 * @param {unknown} value - Candidate durable manual request envelope.
 * @param {string} label - Human-readable boundary label.
 * @returns {{input: any, callerMetadata: Record<string, any>}} - Strict manual request envelope.
 */
function normalizeActivityRequestEnvelope(value, label) {
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
 * Validate the private input of one host-managed successor invocation. The
 * raw effect ID is target-owned while the remaining logical request is the
 * exact content copied from the verified source effect.
 * @param {unknown} value - Candidate successor run input.
 * @param {string} label - Human-readable boundary label.
 * @returns {{effectId: string, request: Record<string, any>}} - Exact target request.
 */
function normalizeManagedEffectSuccessorRunInput(value, label) {
  const input = cloneReferencedPayloadObject(value, label);
  assertExactKeys(input, ['effectRequest'], label);
  const effectRequest = cloneReferencedPayloadObject(
    input.effectRequest,
    `${label}.effectRequest`,
  );
  assertExactKeys(
    effectRequest,
    [
      'effectId',
      'capability',
      'operation',
      'input',
      'requestedReplayProperties',
    ],
    `${label}.effectRequest`,
  );
  const effectId = assertOpaqueId(
    effectRequest.effectId,
    `${label}.effectRequest.effectId`,
  );
  const request = normalizeManagedEffectRequest(
    {
      capability: effectRequest.capability,
      operation: effectRequest.operation,
      input: effectRequest.input,
      requestedReplayProperties: effectRequest.requestedReplayProperties,
    },
    `${label}.effectRequest`,
  );
  return { effectId, request };
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
 * uncertain attempt. The verifier is deliberately fixed in V10: accepting a
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
 * Normalize the immutable evidence-backed decision that resolves one managed
 * effect while deliberately retaining its stopped physical attempt and
 * blocked aggregate. The original uncertainty event remains the causal link;
 * this record only adds a verifier-backed disposition.
 * @param {unknown} value - Candidate effect reconciliation payload.
 * @param {string} label - Human-readable value path.
 * @returns {{reconciliationId: string, invocationId: string, attemptId: string, effectId: string, generation: number, coordinatorEpoch: number, fencingToken: string, uncertaintyEventId: string, uncertaintySequence: number, verifier: {kind: string, version: number}, evidenceRef: Readonly<import('../../../runtime/execution-payload.js').ExecutionPayloadReference>, resolutionStatus: string, reason: any}} - Strict reconciliation proof reference.
 */
function normalizeUncertainEffectReconciliation(value, label) {
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
      'effectId',
      'generation',
      'coordinatorEpoch',
      'fencingToken',
      'uncertaintyEventId',
      'uncertaintySequence',
      'verifier',
      'evidenceRef',
      'resolutionStatus',
      'reason',
    ],
    label,
  );
  if (
    ![
      EffectStatus.COMPLETED,
      EffectStatus.FAILED,
      EffectStatus.NOT_APPLIED,
    ].includes(reconciliation.resolutionStatus)
  ) {
    throw new TypeError(`${label}.resolutionStatus is not supported.`);
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
    effectId: assertOpaqueId(reconciliation.effectId, `${label}.effectId`),
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
    verifier: normalizeEffectVerifierDescriptor(
      reconciliation.verifier,
      `${label}.verifier`,
    ),
    evidenceRef: normalizePayloadReference(
      reconciliation.evidenceRef,
      reconciliation.resolutionStatus === EffectStatus.NOT_APPLIED
        ? MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA
        : MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      `${label}.evidenceRef`,
    ),
    resolutionStatus: reconciliation.resolutionStatus,
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
 * @param {unknown} value - Candidate workflow cursor projection.
 * @param {string} runId - Expected workflow run identity.
 * @returns {Record<string, any>} - Strict workflow cursor snapshot.
 */
function normalizeWorkflowCursorSnapshot(value, runId) {
  try {
    const cursor = normalizeWorkflowCursor(value, 'workflow cursor projection');
    if (cursor.runId !== runId) {
      throw new TypeError('workflow cursor projection run identity mismatch.');
    }
    return cursor;
  } catch (error) {
    if (error instanceof ExecutionLedgerProjectionError) throw error;
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid workflow cursor projection',
    );
  }
}

/**
 * @param {string} runId - Workflow run identity.
 * @param {Record<string, any>} data - Workflow cursor projection.
 * @returns {Record<string, any>} - Typed cursor projection record.
 */
function createWorkflowCursorProjectionRecord(runId, data) {
  const cursor = normalizeWorkflowCursorSnapshot(data, runId);
  return {
    [KEY_NAME]: runId,
    [SORT_KEY_NAME]: getWorkflowCursorProjectionSortKey(),
    record_type: 'execution_ledger_workflow_cursor_projection',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    disposition: cursor.disposition,
    version: cursor.version,
    sequence: cursor.lastSequence,
    revision_id: cursor.revisionId,
    data: cloneInlinePayload(cursor, 'workflow cursor projection'),
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
    run_kind: runKindFromTrigger(data.trigger),
    status: data.status,
    version: data.version,
    sequence: data.lastSequence,
    created_at: data.createdAt,
    updated_at: data.updatedAt,
  };
}

/**
 * @param {string} successorId - Stable public successor identity.
 * @returns {string} - App-directory-scoped immutable identity key.
 */
function getSuccessorIdentitySortKey(successorId) {
  const normalized = assertOpaqueId(successorId, 'successorId');
  return `${SUCCESSOR_IDENTITY_SORT_KEY_PREFIX}${createCanonicalJsonSha256Id({
    domain: 'wharfie:managed-effect-successor-public-id:v1',
    prefix: 'wsu',
    value: normalized,
    valuePath: 'managed effect successor public identity',
  })}`;
}

/**
 * @param {string} appId - Application scope.
 * @param {Record<string, any>} authorization - Exact immutable authorization.
 * @returns {Record<string, any>} - Global app-scoped successor identity row.
 */
function createSuccessorIdentityRecord(appId, authorization) {
  const scope = createExecutionLedgerRunDirectoryScope({ appId });
  const normalized =
    normalizeManagedEffectSuccessorAuthorization(authorization);
  return {
    [KEY_NAME]: scope.directoryId,
    [SORT_KEY_NAME]: getSuccessorIdentitySortKey(normalized.successorId),
    record_type: 'execution_ledger_successor_identity',
    schema_version: EXECUTION_LEDGER_SCHEMA_VERSION,
    app_id: appId,
    successor_id: normalized.successorId,
    slot_id: normalized.slotId,
    source_run_id: normalized.source.runId,
    target_run_id: normalized.target.runId,
    authorization_digest: createCanonicalJsonSha256Id({
      domain: 'wharfie:managed-effect-successor-authorization:v1',
      prefix: 'wsy',
      value: normalized,
      valuePath: 'managed effect successor authorization',
    }),
  };
}

/**
 * @param {DBClient} db - Transactional control store.
 * @param {string} tableName - Ledger table name.
 * @param {string} appId - Application scope.
 * @param {string} successorId - Stable public identity.
 * @returns {Promise<Record<string, any> | null>} - Verified identity row.
 */
async function readSuccessorIdentityRecord(db, tableName, appId, successorId) {
  const scope = createExecutionLedgerRunDirectoryScope({ appId });
  const sortKey = getSuccessorIdentitySortKey(successorId);
  const raw = await db.get({
    tableName,
    keyName: KEY_NAME,
    keyValue: scope.directoryId,
    sortKeyName: SORT_KEY_NAME,
    sortKeyValue: sortKey,
    consistentRead: true,
  });
  if (!raw) return null;
  const record = cloneBoundedJsonObject(
    raw,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'successor identity record',
  );
  assertExactKeys(
    record,
    [
      KEY_NAME,
      SORT_KEY_NAME,
      'record_type',
      'schema_version',
      'app_id',
      'successor_id',
      'slot_id',
      'source_run_id',
      'target_run_id',
      'authorization_digest',
    ],
    'successor identity record',
  );
  if (
    record[KEY_NAME] !== scope.directoryId ||
    record[SORT_KEY_NAME] !== sortKey ||
    record.record_type !== 'execution_ledger_successor_identity' ||
    record.schema_version !== EXECUTION_LEDGER_SCHEMA_VERSION ||
    record.app_id !== appId ||
    record.successor_id !== successorId
  ) {
    throw new ExecutionLedgerProjectionError(
      record.target_run_id || successorId,
      'invalid successor identity record',
    );
  }
  for (const [field, label] of [
    ['slot_id', 'successor identity slot'],
    ['source_run_id', 'successor identity source run'],
    ['target_run_id', 'successor identity target run'],
    ['authorization_digest', 'successor identity authorization digest'],
  ]) {
    assertOpaqueId(record[field], label);
  }
  return record;
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
    !RUN_DIRECTORY_RUN_KINDS.has(record.run_kind)
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
 * @returns {{runId: string, appId: string, revisionId: string, kind: 'manual'|'workflow'|'effect-successor', status: string, version: number, lastSequence: number, createdAt: number, updatedAt: number}} - Redacted page item.
 */
function createRunDirectoryPageItem(directory) {
  return {
    runId: directory.ledger_run_id,
    appId: directory.app_id,
    revisionId: directory.revision_id,
    kind: directory.run_kind,
    status: directory.status,
    version: directory.version,
    lastSequence: directory.sequence,
    createdAt: directory.created_at,
    updatedAt: directory.updated_at,
  };
}

/**
 * @param {unknown} options - Candidate ready-work query.
 * @param {number} defaultObservedAt - Store caller's current observation.
 * @returns {{appId: string, revisionId: string, limit: number, observedAt: number, cursor?: string}} - Exact bounded query.
 */
function normalizeReadyWorkPageOptions(options, defaultObservedAt) {
  const value = cloneBoundedJsonObject(
    options,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    'listReadyWork',
  );
  assertSnapshotKeys(
    value,
    ['appId', 'revisionId'],
    ['limit', 'observedAt', 'cursor'],
    'listReadyWork',
  );
  assertLogicalId(value.appId, 'listReadyWork.appId');
  assertApplicationRevisionId(value.revisionId, 'listReadyWork.revisionId');
  const limit = Object.prototype.hasOwnProperty.call(value, 'limit')
    ? value.limit
    : READY_WORK_DEFAULT_PAGE_SIZE;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > READY_WORK_MAX_PAGE_SIZE
  ) {
    throw new TypeError(
      `listReadyWork.limit must be a safe integer from 1 through ${READY_WORK_MAX_PAGE_SIZE}.`,
    );
  }
  const observedAt = assertNonnegativeSafeInteger(
    Object.prototype.hasOwnProperty.call(value, 'observedAt')
      ? value.observedAt
      : defaultObservedAt,
    'listReadyWork.observedAt',
  );
  if (
    Object.prototype.hasOwnProperty.call(value, 'cursor') &&
    (typeof value.cursor !== 'string' || value.cursor.length === 0)
  ) {
    throw new TypeError(
      'listReadyWork.cursor must be a nonempty opaque string.',
    );
  }
  return {
    appId: value.appId,
    revisionId: value.revisionId,
    limit,
    observedAt,
    ...(Object.prototype.hasOwnProperty.call(value, 'cursor')
      ? { cursor: value.cursor }
      : {}),
  };
}

/**
 * Create a scope-bound opaque continuation for one provider page boundary.
 * The boundary may name a malformed locator row: carrying its exact key lets
 * the resident page past corruption without treating that row as authority.
 * @param {{appId: string, revisionId: string, serviceId: string, readyWorkId: string}} scope - Exact query scope.
 * @param {string} startAfter - Exclusive raw sort-key boundary.
 * @returns {string} - Canonical opaque cursor.
 */
function createReadyWorkCursor(scope, startAfter) {
  if (
    typeof startAfter !== 'string' ||
    !startAfter.startsWith(EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX)
  ) {
    throw new TypeError('listReadyWork cursor boundary is invalid.');
  }
  const value = {
    schemaVersion: READY_WORK_CURSOR_SCHEMA_VERSION,
    appId: scope.appId,
    revisionId: scope.revisionId,
    serviceId: scope.serviceId,
    readyWorkId: scope.readyWorkId,
    startAfter,
  };
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

/**
 * Decode only this revision partition's canonical cursor representation.
 * @param {string | undefined} cursor - Candidate opaque cursor.
 * @param {{appId: string, revisionId: string, serviceId: string, readyWorkId: string}} scope - Exact query scope.
 * @returns {string | undefined} - Exclusive raw sort key.
 */
function parseReadyWorkCursor(cursor, scope) {
  if (cursor === undefined) return undefined;
  if (Buffer.byteLength(cursor, 'utf8') > READY_WORK_CURSOR_MAX_BYTES) {
    throw new TypeError('listReadyWork.cursor is too large.');
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
    throw new TypeError('listReadyWork.cursor is not a valid opaque cursor.');
  }
  const value = cloneBoundedJsonObject(
    parsed,
    READY_WORK_CURSOR_MAX_BYTES,
    'listReadyWork.cursor',
  );
  assertExactKeys(
    value,
    [
      'schemaVersion',
      'appId',
      'revisionId',
      'serviceId',
      'readyWorkId',
      'startAfter',
    ],
    'listReadyWork.cursor',
  );
  if (
    value.schemaVersion !== READY_WORK_CURSOR_SCHEMA_VERSION ||
    value.appId !== scope.appId ||
    value.revisionId !== scope.revisionId ||
    value.serviceId !== scope.serviceId ||
    value.readyWorkId !== scope.readyWorkId ||
    typeof value.startAfter !== 'string' ||
    !value.startAfter.startsWith(EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX) ||
    text !== JSON.stringify(value)
  ) {
    throw new TypeError(
      'listReadyWork.cursor does not match the requested scope.',
    );
  }
  return value.startAfter;
}

/**
 * Expose only scheduling coordinates. Raw table keys and service partition
 * identities stay inside the ledger implementation.
 * @param {Record<string, any>} record - Strict ready-work storage record.
 * @returns {Record<string, any>} - Camel-cased locator item.
 */
function createReadyWorkPageItem(record) {
  const common = {
    appId: record.app_id,
    revisionId: record.revision_id,
    runId: record.ledger_run_id,
    kind: record.kind,
    availableAt: record.available_at,
    runVersion: record.run_version,
    lastSequence: record.sequence,
  };
  const workflow = Object.prototype.hasOwnProperty.call(
    record,
    'cursor_version',
  )
    ? {
        cursorVersion: record.cursor_version,
        continuationId: record.continuation_id,
        stepId: record.step_id,
        stepIndex: record.step_index,
      }
    : {};
  if (record.kind === ExecutionLedgerReadyWorkKind.ACTIVITY) {
    return {
      ...common,
      invocationId: record.invocation_id,
      generation: record.generation,
      ...workflow,
    };
  }
  if (record.kind === ExecutionLedgerReadyWorkKind.RECOVERY) {
    return {
      ...common,
      invocationId: record.invocation_id,
      attemptId: record.attempt_id,
      generation: record.generation,
      ...workflow,
    };
  }
  const continuation = {
    ...common,
    cursorVersion: record.cursor_version,
    continuationId: record.continuation_id,
    stepId: record.step_id,
    stepIndex: record.step_index,
  };
  return record.kind === ExecutionLedgerReadyWorkKind.TIMER
    ? { ...continuation, timerId: record.timer_id }
    : continuation;
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
    domain: 'wharfie:execution-ledger-event:v10',
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
  value.trigger = normalizeRunTrigger(value.trigger);
  value.requestRef = normalizePayloadReference(
    value.requestRef,
    value.trigger.kind === 'workflow'
      ? WORKFLOW_START_PAYLOAD_SCHEMA
      : ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
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
 * Bind a workflow activity invocation to the exact persisted cursor that
 * materialized its logical request. Physical attempts retain their separate
 * generation and fence identities.
 * @param {unknown} value - Candidate workflow invocation binding.
 * @param {string} label - Human-readable boundary label.
 * @returns {{workflowId: string, planId: string, continuationId: string, stepId: string, stepIndex: number}} - Exact cursor binding.
 */
function normalizeWorkflowInvocationBinding(value, label) {
  const binding = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    binding,
    ['workflowId', 'planId', 'continuationId', 'stepId', 'stepIndex'],
    label,
  );
  assertLogicalId(binding.workflowId, `${label}.workflowId`);
  assertOpaqueId(binding.planId, `${label}.planId`);
  assertOpaqueId(binding.continuationId, `${label}.continuationId`);
  assertLogicalId(binding.stepId, `${label}.stepId`);
  assertNonnegativeSafeInteger(binding.stepIndex, `${label}.stepIndex`);
  return /** @type {{workflowId: string, planId: string, continuationId: string, stepId: string, stepIndex: number}} */ (
    binding
  );
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
    ['terminal', 'uncertainty', 'cancellationRequest', 'workflow'],
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
    ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
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
  const hasWorkflow = Object.prototype.hasOwnProperty.call(value, 'workflow');
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
  if (hasWorkflow) {
    value.workflow = normalizeWorkflowInvocationBinding(
      value.workflow,
      'invocation projection workflow',
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
    [
      'startedBy',
      'terminal',
      'outcomeRef',
      'cancellation',
      'uncertainty',
      'reconciliation',
    ],
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
  const hasReconciliation = Object.prototype.hasOwnProperty.call(
    value,
    'reconciliation',
  );
  if (
    (value.status === EffectStatus.PENDING &&
      (hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty ||
        hasReconciliation)) ||
    (value.status === EffectStatus.STARTED &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty ||
        hasReconciliation)) ||
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
        hasUncertainty ||
        hasReconciliation)) ||
    (value.status === EffectStatus.UNCERTAIN &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        !hasUncertainty ||
        hasReconciliation)) ||
    (value.status === EffectStatus.NOT_APPLIED &&
      (!hasStartedBy ||
        hasTerminal ||
        hasOutcomeRef ||
        hasCancellation ||
        hasUncertainty ||
        !hasReconciliation))
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
  if (hasReconciliation) {
    value.reconciliation = normalizeUncertainEffectReconciliation(
      value.reconciliation,
      'effect projection reconciliation',
    );
    if (
      value.reconciliation.invocationId !== value.invocationId ||
      value.reconciliation.effectId !== value.effectId ||
      value.reconciliation.attemptId !== value.requestedBy.attemptId ||
      value.reconciliation.resolutionStatus !== value.status ||
      (value.status !== EffectStatus.NOT_APPLIED &&
        !hasSameCanonicalJson(
          value.reconciliation.evidenceRef,
          value.outcomeRef,
        ))
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect reconciliation does not match projection',
      );
    }
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
 * Verify the immutable workflow scope and one-step cursor CAS advance. The
 * event-specific branch separately proves disposition, activation, and output
 * evolution.
 * @param {Record<string, any>} prior - Previous workflow cursor.
 * @param {Record<string, any>} next - Candidate next workflow cursor.
 * @param {Record<string, any>} event - Current event.
 * @param {string} runId - Durable run identity.
 * @returns {void}
 */
function assertWorkflowCursorAdvance(prior, next, event, runId) {
  if (
    next.schemaVersion !== prior.schemaVersion ||
    next.runId !== prior.runId ||
    next.appId !== prior.appId ||
    next.revisionId !== prior.revisionId ||
    next.workflowId !== prior.workflowId ||
    next.planId !== prior.planId ||
    !hasSameCanonicalJson(next.planRef, prior.planRef) ||
    !hasSameCanonicalJson(next.startRef, prior.startRef) ||
    next.createdAt !== prior.createdAt ||
    next.version !== prior.version + 1 ||
    next.lastSequence !== event.sequence ||
    next.updatedAt !== event.observed_at
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'invalid workflow cursor transition',
    );
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
  const priorHasWorkflow = Object.prototype.hasOwnProperty.call(
    prior,
    'workflow',
  );
  const nextHasWorkflow = Object.prototype.hasOwnProperty.call(
    next,
    'workflow',
  );
  if (
    next.runId !== prior.runId ||
    next.invocationId !== prior.invocationId ||
    next.appId !== prior.appId ||
    next.revisionId !== prior.revisionId ||
    next.activityId !== prior.activityId ||
    !hasSameCanonicalJson(next.requestRef, prior.requestRef) ||
    priorHasWorkflow !== nextHasWorkflow ||
    (priorHasWorkflow &&
      !hasSameCanonicalJson(next.workflow, prior.workflow)) ||
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
 * @returns {{run: Record<string, any>, invocation: Record<string, any>, workflowCursor?: Record<string, any>, nextInvocation?: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[], reconciliation?: Record<string, any>, authorization?: Record<string, any>}} - Event projection snapshots.
 */
function eventSnapshots(event, runId) {
  const payload = cloneBoundedJsonObject(
    event.payload,
    EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
    'event payload',
  );
  if (event.type === 'workflow-run-created') {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'workflowCursor'],
      'event payload',
    );
  } else if (
    event.type === 'workflow-activity-claimed' ||
    event.type === 'workflow-activity-started' ||
    event.type === 'workflow-activity-abandoned-before-start' ||
    event.type === 'workflow-activity-became-uncertain'
  ) {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'workflowCursor', 'attempt'],
      'event payload',
    );
  } else if (event.type === 'workflow-activity-succeeded') {
    assertSnapshotKeys(
      payload,
      ['run', 'invocation', 'workflowCursor', 'attempt'],
      ['nextInvocation'],
      'event payload',
    );
  } else if (event.type === 'workflow-activity-failed') {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'workflowCursor', 'attempt'],
      'event payload',
    );
  } else if (event.type === 'workflow-activity-uncertainty-reconciled') {
    assertSnapshotKeys(
      payload,
      ['run', 'invocation', 'workflowCursor', 'reconciliation'],
      ['nextInvocation'],
      'event payload',
    );
  } else if (
    event.type === 'effect-successor-authorized' ||
    event.type === 'effect-successor-run-created'
  ) {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'authorization'],
      'event payload',
    );
  } else if (event.type === 'manual-cancellation-requested') {
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
  } else if (event.type === 'uncertain-effect-reconciled') {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'effect', 'reconciliation'],
      'event payload',
    );
  } else if (event.type === 'effect-successor-reconciled') {
    assertExactKeys(
      payload,
      ['run', 'invocation', 'effect', 'reconciliation'],
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
      [
        'manual-run-created',
        'workflow-run-created',
        'effect-successor-run-created',
      ].includes(event.type)
        ? ['run', 'invocation']
        : ['run', 'invocation', 'attempt'],
      'event payload',
    );
  }
  const run = normalizeRunSnapshot(payload.run, runId);
  const invocation = normalizeInvocationSnapshot(payload.invocation, runId);
  /** @type {{run: Record<string, any>, invocation: Record<string, any>, workflowCursor?: Record<string, any>, nextInvocation?: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[], reconciliation?: Record<string, any>, authorization?: Record<string, any>}} */
  const result = { run, invocation };
  if (Object.prototype.hasOwnProperty.call(payload, 'workflowCursor')) {
    result.workflowCursor = normalizeWorkflowCursorSnapshot(
      payload.workflowCursor,
      runId,
    );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'nextInvocation')) {
    result.nextInvocation = normalizeInvocationSnapshot(
      payload.nextInvocation,
      runId,
    );
  }
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
    result.reconciliation =
      event.type === 'uncertain-effect-reconciled' ||
      event.type === 'effect-successor-reconciled'
        ? normalizeUncertainEffectReconciliation(
            payload.reconciliation,
            'event payload reconciliation',
          )
        : normalizeUncertainAttemptReconciliation(
            payload.reconciliation,
            'event payload reconciliation',
          );
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'authorization')) {
    result.authorization = normalizeManagedEffectSuccessorAuthorization(
      payload.authorization,
    );
  }
  return result;
}

/**
 * Prove that a reconciliation addresses the retained uncertainty boundary for
 * this exact attempt. A later terminal may only resolve the current blocked
 * state; it cannot cite an arbitrary historical abandonment or relabel a
 * different physical attempt.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, reconciliation: Record<string, any>, uncertaintyEvent?: Record<string, any>, runId: string}} input - Current state and claimed uncertainty evidence.
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
    uncertaintyEvent.fence.coordinatorEpoch !==
      reconciliation.coordinatorEpoch ||
    uncertaintyEvent.fence.invocationGeneration !== reconciliation.generation
  ) {
    return false;
  }
  const snapshots = eventSnapshots(uncertaintyEvent, runId);
  const uncertaintyAttempt = snapshots.attempt;
  if (!uncertaintyAttempt) return false;
  const runAdvance = run.lastSequence - reconciliation.uncertaintySequence;
  const invocationAdvance =
    invocation.lastSequence - reconciliation.uncertaintySequence;
  return (
    run.status === RunStatus.BLOCKED &&
    invocation.status === InvocationStatus.UNCERTAIN &&
    invocation.generation === reconciliation.generation &&
    attempt.status === AttemptStatus.ABANDONED &&
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
    hasSameCanonicalJson(
      snapshots.invocation.uncertainty,
      invocation.uncertainty,
    ) &&
    hasSameCanonicalJson(invocation.uncertainty, attempt.abandonment) &&
    hasSameCancellationRequest(snapshots.run, run) &&
    hasSameCancellationRequest(snapshots.invocation, invocation) &&
    runAdvance >= 0 &&
    invocationAdvance === runAdvance &&
    run.version - snapshots.run.version === runAdvance &&
    invocation.version - snapshots.invocation.version === runAdvance &&
    sameSnapshot(uncertaintyAttempt, attempt)
  );
}

/**
 * Prove that a workflow reconciliation addresses the exact cursor-bound
 * uncertainty boundary which retained its stopped physical attempt. Workflow
 * history cannot advance while this cursor is blocked, so every authoritative
 * snapshot must still be byte-identical to the cited event.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, workflowCursor: Record<string, any>, attempt: Record<string, any>, reconciliation: Record<string, any>, uncertaintyEvent?: Record<string, any>, runId: string}} input - Current workflow state and claimed uncertainty evidence.
 * @returns {boolean} - Whether the retained workflow uncertainty event is exact.
 */
function hasExactWorkflowActivityUncertaintyEventLink(input) {
  const {
    run,
    invocation,
    workflowCursor,
    attempt,
    reconciliation,
    uncertaintyEvent,
    runId,
  } = input;
  if (
    !uncertaintyEvent ||
    uncertaintyEvent.type !== 'workflow-activity-became-uncertain' ||
    uncertaintyEvent.sequence !== reconciliation.uncertaintySequence ||
    uncertaintyEvent.event_id !== reconciliation.uncertaintyEventId ||
    uncertaintyEvent.fence.coordinatorEpoch !==
      reconciliation.coordinatorEpoch ||
    uncertaintyEvent.fence.invocationGeneration !== reconciliation.generation
  ) {
    return false;
  }
  const snapshots = eventSnapshots(uncertaintyEvent, runId);
  const uncertaintyCursor = snapshots.workflowCursor;
  const uncertaintyAttempt = snapshots.attempt;
  return Boolean(
    uncertaintyCursor &&
    uncertaintyAttempt &&
    run.status === RunStatus.BLOCKED &&
    invocation.status === InvocationStatus.UNCERTAIN &&
    workflowCursor.disposition ===
      WorkflowCursorDisposition.ACTIVITY_UNCERTAIN &&
    attempt.status === AttemptStatus.ABANDONED &&
    snapshots.run.status === RunStatus.BLOCKED &&
    snapshots.invocation.status === InvocationStatus.UNCERTAIN &&
    uncertaintyCursor.disposition ===
      WorkflowCursorDisposition.ACTIVITY_UNCERTAIN &&
    uncertaintyAttempt.status === AttemptStatus.ABANDONED &&
    snapshots.invocation.invocationId === reconciliation.invocationId &&
    uncertaintyCursor.invocationId === reconciliation.invocationId &&
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
    sameSnapshot(uncertaintyCursor, workflowCursor) &&
    sameSnapshot(uncertaintyAttempt, attempt),
  );
}

/**
 * Prove that one effect reconciliation cites the exact event which first made
 * that effect uncertain. Other uncertain siblings may already have acquired
 * their own dispositions, so the aggregate head is allowed to have advanced;
 * the target effect and stopped physical attempt must still match the cited
 * event byte-for-byte.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, effect: Record<string, any>, reconciliation: Record<string, any>, uncertaintyEvent?: Record<string, any>, runId: string}} input - Current state and claimed effect uncertainty evidence.
 * @returns {boolean} - Whether the retained effect uncertainty link is exact.
 */
function hasExactEffectUncertaintyEventLink(input) {
  const {
    run,
    invocation,
    attempt,
    effect,
    reconciliation,
    uncertaintyEvent,
    runId,
  } = input;
  if (
    !uncertaintyEvent ||
    ![
      'effect-became-uncertain',
      'effect-successor-interrupted',
      'attempt-became-uncertain',
    ].includes(uncertaintyEvent.type) ||
    uncertaintyEvent.sequence !== reconciliation.uncertaintySequence ||
    uncertaintyEvent.event_id !== reconciliation.uncertaintyEventId ||
    uncertaintyEvent.fence.coordinatorEpoch !==
      reconciliation.coordinatorEpoch ||
    uncertaintyEvent.fence.invocationGeneration !== reconciliation.generation
  ) {
    return false;
  }
  const snapshots = eventSnapshots(uncertaintyEvent, runId);
  const uncertaintyAttempt = snapshots.attempt;
  const uncertaintyEffect =
    snapshots.effect ||
    snapshots.effects?.find(
      (candidate) => candidate.effectId === reconciliation.effectId,
    );
  if (!uncertaintyAttempt || !uncertaintyEffect) return false;
  return (
    run.status === RunStatus.BLOCKED &&
    invocation.status === InvocationStatus.UNCERTAIN &&
    attempt.status === AttemptStatus.ABANDONED &&
    effect.status === EffectStatus.UNCERTAIN &&
    snapshots.run.status === RunStatus.BLOCKED &&
    snapshots.invocation.status === InvocationStatus.UNCERTAIN &&
    uncertaintyAttempt.status === AttemptStatus.ABANDONED &&
    uncertaintyEffect.status === EffectStatus.UNCERTAIN &&
    snapshots.invocation.invocationId === reconciliation.invocationId &&
    uncertaintyAttempt.invocationId === reconciliation.invocationId &&
    uncertaintyAttempt.attemptId === reconciliation.attemptId &&
    uncertaintyAttempt.generation === reconciliation.generation &&
    uncertaintyAttempt.coordinatorEpoch === reconciliation.coordinatorEpoch &&
    uncertaintyAttempt.fencingToken === reconciliation.fencingToken &&
    uncertaintyEffect.invocationId === reconciliation.invocationId &&
    uncertaintyEffect.effectId === reconciliation.effectId &&
    uncertaintyEffect.requestedBy.attemptId === reconciliation.attemptId &&
    uncertaintyEffect.startedBy?.attemptId === reconciliation.attemptId &&
    hasSameCanonicalJson(
      snapshots.invocation.uncertainty,
      uncertaintyAttempt.abandonment,
    ) &&
    hasSameCanonicalJson(invocation.uncertainty, attempt.abandonment) &&
    sameSnapshot(uncertaintyAttempt, attempt) &&
    sameSnapshot(uncertaintyEffect, effect)
  );
}

/**
 * Classify one already-folded NOT_APPLIED effect as a legal immediate source
 * for the finite successor policy.  The two cases are deliberately
 * discriminated rather than accepting broad terminal/status combinations:
 * ordinary work remains BLOCKED/UNCERTAIN after its effect reconciliation,
 * while a framework successor terminalizes FAILED/FAILED when its sole
 * effect is permanently proven NOT_APPLIED.  Both retain the exact abandoned
 * physical attempt and immutable reconciliation evidence.
 * @param {{run: Record<string, any>, invocation: Record<string, any> | undefined, attempt: Record<string, any> | undefined, effect: Record<string, any> | undefined, uncertaintyEvent: Record<string, any> | undefined, reconciliationEvent: Record<string, any> | undefined, runId: string}} input - Candidate retained retry source.
 * @returns {'manual'|'effect-successor'|undefined} - Exact allowed source family.
 */
function classifyNotAppliedManagedEffectSuccessorSource(input) {
  const {
    run,
    invocation,
    attempt,
    effect,
    uncertaintyEvent,
    reconciliationEvent,
    runId,
  } = input;
  const reconciliation = effect?.reconciliation;
  if (
    !invocation ||
    !attempt ||
    !effect ||
    !reconciliation ||
    effect.status !== EffectStatus.NOT_APPLIED ||
    reconciliation.resolutionStatus !== EffectStatus.NOT_APPLIED ||
    attempt.status !== AttemptStatus.ABANDONED ||
    effect.requestedBy?.attemptId !== attempt.attemptId ||
    !uncertaintyEvent ||
    !reconciliationEvent ||
    reconciliationEvent.event_id === uncertaintyEvent.event_id ||
    reconciliationEvent.sequence <= uncertaintyEvent.sequence ||
    reconciliation.uncertaintyEventId !== uncertaintyEvent.event_id ||
    reconciliation.uncertaintySequence !== uncertaintyEvent.sequence
  ) {
    return undefined;
  }
  let uncertaintySnapshots;
  let reconciliationSnapshots;
  try {
    uncertaintySnapshots = eventSnapshots(uncertaintyEvent, runId);
    reconciliationSnapshots = eventSnapshots(reconciliationEvent, runId);
  } catch {
    return undefined;
  }
  const uncertaintyEffects = [
    ...(uncertaintySnapshots.effect ? [uncertaintySnapshots.effect] : []),
    ...(uncertaintySnapshots.effects || []),
  ].filter((candidate) => candidate.effectId === effect.effectId);
  const uncertaintyEffect =
    uncertaintyEffects.length === 1 ? uncertaintyEffects[0] : undefined;
  const reconciledEffect = reconciliationSnapshots.effect;
  const invalidSnapshots =
    uncertaintySnapshots.attempt?.attemptId !== attempt.attemptId ||
    uncertaintySnapshots.attempt?.status !== AttemptStatus.ABANDONED ||
    !uncertaintyEffect ||
    uncertaintyEffect.invocationId !== invocation.invocationId ||
    uncertaintyEffect.status !== EffectStatus.UNCERTAIN ||
    uncertaintyEffect.requestedBy?.attemptId !== attempt.attemptId ||
    uncertaintyEffect.startedBy?.attemptId !== attempt.attemptId ||
    reconciledEffect?.effectId !== effect.effectId ||
    !reconciledEffect ||
    !sameSnapshot(reconciledEffect, effect) ||
    !hasSameCanonicalJson(
      reconciliationSnapshots.reconciliation,
      reconciliation,
    );
  if (invalidSnapshots) {
    return undefined;
  }
  if (
    run.trigger?.kind === 'manual' &&
    run.status === RunStatus.BLOCKED &&
    invocation.status === InvocationStatus.UNCERTAIN &&
    reconciliationEvent.type === 'uncertain-effect-reconciled'
  ) {
    return 'manual';
  }
  if (
    run.trigger?.kind !== 'effect-successor' ||
    run.status !== RunStatus.FAILED ||
    invocation.status !== InvocationStatus.FAILED ||
    invocation.terminal?.type !== 'failed' ||
    invocation.terminal?.attemptId !== attempt.attemptId ||
    reconciliationEvent.type !== 'effect-successor-reconciled'
  ) {
    return undefined;
  }
  try {
    const authorization = normalizeManagedEffectSuccessorAuthorization(
      run.trigger,
    );
    if (
      authorization.target.runId !== run.runId ||
      authorization.target.invocationId !== invocation.invocationId ||
      authorization.target.effectId !== effect.effectId ||
      authorization.target.destinationEffectId !== effect.destinationEffectId
    ) {
      return undefined;
    }
  } catch {
    return undefined;
  }
  return 'effect-successor';
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
 * @param {Record<string, any> | undefined} reconciliation - Reconciliation payload for an event that deliberately retains its attempt unchanged.
 * @param {{currentCursor: Record<string, any>, nextCursor: Record<string, any>, nextInvocation?: Record<string, any>} | undefined} workflowContext - Exact workflow transition context.
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
  workflowContext,
  runId,
) {
  /** @type {Record<string, any>} */
  let value;
  const currentWorkflowCursor = workflowContext?.currentCursor;
  const nextWorkflowCursor = workflowContext?.nextCursor;
  if (
    event.type.startsWith('workflow-activity-') &&
    (!currentWorkflowCursor || !nextWorkflowCursor)
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'workflow event request digest lacks cursor context',
    );
  }
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
  } else if (event.type === 'workflow-run-created') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      transitionId: event.transition_id,
      actor: event.actor,
      coordinatorEpoch: event.fence.coordinatorEpoch,
      appId: run.appId,
      revisionId: run.revisionId,
      workflowId: run.trigger.workflowId,
      planId: run.trigger.planId,
      planRef: run.trigger.planRef,
      startRef: run.requestRef,
      activityRequestRef: invocation.requestRef,
      trigger: run.trigger,
    };
  } else if (event.type === 'workflow-activity-claimed') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      cursor: workflowCursorGuard(
        /** @type {Record<string, any>} */ (currentWorkflowCursor),
      ),
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      expectedGeneration: currentInvocation?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'workflow-activity-started') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      cursor: workflowCursorGuard(
        /** @type {Record<string, any>} */ (currentWorkflowCursor),
      ),
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (
    event.type === 'workflow-activity-abandoned-before-start' ||
    event.type === 'workflow-activity-became-uncertain'
  ) {
    value = {
      runId,
      invocationId: invocation.invocationId,
      cursor: workflowCursorGuard(
        /** @type {Record<string, any>} */ (currentWorkflowCursor),
      ),
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      reason: attempt?.abandonment,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'workflow-activity-succeeded') {
    const output = /** @type {Record<string, any>} */ (
      nextWorkflowCursor
    ).outputs.at(-1);
    const nextInvocation = workflowContext?.nextInvocation;
    value = {
      runId,
      invocationId: invocation.invocationId,
      cursor: workflowCursorGuard(
        /** @type {Record<string, any>} */ (currentWorkflowCursor),
      ),
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      terminal: attempt?.terminal,
      evidenceRef: attempt?.evidenceRef,
      outputRef: output?.outputRef,
      successor: nextInvocation
        ? {
            continuationId: nextInvocation.workflow?.continuationId,
            stepId: nextInvocation.workflow?.stepId,
            stepIndex: nextInvocation.workflow?.stepIndex,
            invocationId: nextInvocation.invocationId,
            activityId: nextInvocation.activityId,
            requestRef: nextInvocation.requestRef,
          }
        : null,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'workflow-activity-failed') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      cursor: workflowCursorGuard(
        /** @type {Record<string, any>} */ (currentWorkflowCursor),
      ),
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
  } else if (event.type === 'workflow-activity-uncertainty-reconciled') {
    const completed = reconciliation?.terminal?.type === 'completed';
    const output = completed
      ? /** @type {Record<string, any>} */ (nextWorkflowCursor).outputs[
          /** @type {Record<string, any>} */ (currentWorkflowCursor).stepIndex
        ]
      : undefined;
    const nextInvocation = workflowContext?.nextInvocation;
    value = {
      runId,
      invocationId: reconciliation?.invocationId,
      cursor: workflowCursorGuard(
        /** @type {Record<string, any>} */ (currentWorkflowCursor),
      ),
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
      outputRef: completed ? output?.outputRef : null,
      successor:
        completed && nextInvocation
          ? {
              continuationId: nextInvocation.workflow?.continuationId,
              stepId: nextInvocation.workflow?.stepId,
              stepIndex: nextInvocation.workflow?.stepIndex,
              invocationId: nextInvocation.invocationId,
              activityId: nextInvocation.activityId,
              requestRef: nextInvocation.requestRef,
            }
          : null,
      reason: reconciliation?.reason,
      actor: event.actor,
      coordinatorEpoch: reconciliation?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-successor-run-created') {
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
      authorization: normalizeManagedEffectSuccessorAuthorization(
        event.payload.authorization,
      ),
    };
  } else if (event.type === 'effect-successor-authorized') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      authorization: normalizeManagedEffectSuccessorAuthorization(
        event.payload.authorization,
      ),
      actor: event.actor,
      coordinatorEpoch: event.fence.coordinatorEpoch,
    };
  } else if (event.type === 'effect-successor-started') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      destinationEffectId: effect?.destinationEffectId,
      requestRef: effect?.requestRef,
      adapter: effect?.adapter,
      destination: effect?.destination,
      verifier: effect?.verifier,
      requestedReplayProperties: effect?.requestedReplayProperties,
      substantiatedReplayProperties: effect?.substantiatedReplayProperties,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-successor-terminal') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      expectedEffectVersion: currentEffect?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      outcomeRef: effect?.outcomeRef,
      evidenceRef: attempt?.evidenceRef,
      terminal: attempt?.terminal,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-successor-interrupted') {
    value = {
      runId,
      invocationId: invocation.invocationId,
      attemptId: attempt?.attemptId,
      fencingToken: attempt?.fencingToken,
      generation: attempt?.generation,
      expectedVersion: currentRun?.version,
      expectedEffectVersion: currentEffect?.version,
      transitionId: event.transition_id,
      effectId: effect?.effectId,
      reason: effect?.uncertainty,
      actor: event.actor,
      coordinatorEpoch: attempt?.coordinatorEpoch,
    };
  } else if (event.type === 'effect-successor-reconciled') {
    value = {
      runId,
      invocationId: reconciliation?.invocationId,
      attemptId: reconciliation?.attemptId,
      effectId: reconciliation?.effectId,
      fencingToken: reconciliation?.fencingToken,
      generation: reconciliation?.generation,
      expectedVersion: currentRun?.version,
      expectedEffectVersion: currentEffect?.version,
      transitionId: event.transition_id,
      reconciliationId: reconciliation?.reconciliationId,
      uncertaintyEventId: reconciliation?.uncertaintyEventId,
      uncertaintySequence: reconciliation?.uncertaintySequence,
      verifier: reconciliation?.verifier,
      evidenceRef: reconciliation?.evidenceRef,
      resolutionStatus: reconciliation?.resolutionStatus,
      terminal: invocation.terminal,
      reason: reconciliation?.reason,
      actor: event.actor,
      coordinatorEpoch: reconciliation?.coordinatorEpoch,
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
  } else if (event.type === 'uncertain-effect-reconciled') {
    value = {
      runId,
      invocationId: reconciliation?.invocationId,
      attemptId: reconciliation?.attemptId,
      effectId: reconciliation?.effectId,
      fencingToken: reconciliation?.fencingToken,
      generation: reconciliation?.generation,
      expectedVersion: currentRun?.version,
      expectedEffectVersion: currentEffect?.version,
      transitionId: event.transition_id,
      reconciliationId: reconciliation?.reconciliationId,
      uncertaintyEventId: reconciliation?.uncertaintyEventId,
      uncertaintySequence: reconciliation?.uncertaintySequence,
      verifier: reconciliation?.verifier,
      evidenceRef: reconciliation?.evidenceRef,
      resolutionStatus: reconciliation?.resolutionStatus,
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
 * @returns {{readActivityRequest: (reference: unknown) => Promise<Record<string, any>>, readWorkflowPlan: (reference: unknown) => Promise<ReturnType<typeof normalizeWorkflowPlanPayload>>, readWorkflowStart: (reference: unknown) => Promise<ReturnType<typeof normalizeWorkflowStartPayload>>, readWorkflowOutput: (reference: unknown) => Promise<ReturnType<typeof normalizeWorkflowOutputPayload>>, readEvidence: (reference: unknown) => Promise<Record<string, any>>, readManagedEffectRequest: (reference: unknown) => Promise<ReturnType<typeof normalizeManagedEffectRequest>>, readManagedEffectOutcome: (reference: unknown) => Promise<ReturnType<typeof normalizeManagedEffectOutcome>>, readManagedEffectReconciliationEvidence: (reference: unknown) => Promise<Record<string, any>>}} - Verified payload reader.
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
    async readActivityRequest(reference) {
      return normalizeActivityRequestEnvelope(
        await read(
          reference,
          ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
          'persisted activity request',
        ),
        'persisted activity request',
      );
    },
    async readWorkflowPlan(reference) {
      return normalizeWorkflowPlanPayload(
        await read(
          reference,
          WORKFLOW_PLAN_PAYLOAD_SCHEMA,
          'persisted workflow plan',
        ),
        'persisted workflow plan',
      );
    },
    async readWorkflowStart(reference) {
      return normalizeWorkflowStartPayload(
        await read(
          reference,
          WORKFLOW_START_PAYLOAD_SCHEMA,
          'persisted workflow start',
        ),
        'persisted workflow start',
      );
    },
    async readWorkflowOutput(reference) {
      return normalizeWorkflowOutputPayload(
        await read(
          reference,
          WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
          'persisted workflow output',
        ),
        'persisted workflow output',
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
    async readManagedEffectReconciliationEvidence(reference) {
      return cloneReferencedPayloadObject(
        await read(
          reference,
          MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA,
          'persisted managed-effect reconciliation evidence',
        ),
        'persisted managed-effect reconciliation evidence',
      );
    },
  };
}

/**
 * Rehash every output reachable from a cursor. A selector may read only one
 * value, but every retained reference is part of the authoritative cursor and
 * must remain available on every fold.
 * @param {Record<string, any>} cursor - Verified workflow cursor.
 * @param {{readWorkflowOutput: (reference: unknown) => Promise<Record<string, any>>}} payloadReader - Per-fold immutable reader.
 * @returns {Promise<Array<{binding: Record<string, any>, payload: Record<string, any>}>>} - Ordered resolved outputs.
 */
async function readWorkflowCursorOutputs(cursor, payloadReader) {
  return await Promise.all(
    cursor.outputs.map(async (/** @type {Record<string, any>} */ binding) => ({
      binding,
      payload: await payloadReader.readWorkflowOutput(binding.outputRef),
    })),
  );
}

/**
 * Select the one exact prior output named by an activity input selector.
 * @param {Record<string, any>} step - Validated workflow activity step.
 * @param {Array<{binding: Record<string, any>, payload: Record<string, any>}>} outputs - Rehashed output prefix.
 * @param {string} label - Human-readable failure context.
 * @returns {{binding: Record<string, any>, payload: Record<string, any>} | undefined} - Exact selected output.
 */
function selectWorkflowStepOutput(step, outputs, label) {
  if (step.input.kind !== 'step-output') return undefined;
  const selected = outputs.filter(
    ({ binding }) => binding.stepId === step.input.step,
  );
  if (selected.length !== 1) {
    throw new TypeError(
      `${label} cannot resolve the exact persisted output for step '${step.input.step}'.`,
    );
  }
  return selected[0];
}

/**
 * @param {Record<string, any>} run - Run snapshot.
 * @param {Record<string, any>} invocation - Invocation snapshot.
 * @param {Record<string, any> | undefined} workflowCursor - Workflow cursor snapshot.
 * @param {Record<string, any> | undefined} nextInvocation - Newly materialized workflow successor invocation.
 * @param {Record<string, any> | undefined} attempt - Attempt snapshot.
 * @param {Record<string, any> | undefined} effect - Effect snapshot.
 * @param {Record<string, any>[] | undefined} effects - Compound effect snapshots.
 * @param {Record<string, any> | undefined} reconciliation - Reconciliation payload when the retained attempt is deliberately unchanged.
 * @param {Record<string, any>} event - Event being folded.
 * @param {{run?: Record<string, any>, workflowCursor?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, effects: Map<string, Record<string, any>>, eventsBySequence: Map<number, Record<string, any>>, eventsById: Map<string, Record<string, any>>}} state - Mutable fold state.
 * @param {string} runId - Run identity.
 * @param {ReturnType<typeof createLedgerPayloadReader>} payloadReader - Per-fold verified immutable payload reader.
 * @param {Map<string, {descriptor: {kind: string, version: number}, verify: (input: Record<string, any>) => boolean}>} effectVerifierRegistry - Versioned deterministic effect verifiers.
 * @returns {Promise<void>}
 */
async function applyEvent(
  run,
  invocation,
  workflowCursor,
  nextInvocation,
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

  if (event.type === 'workflow-run-created') {
    if (
      currentRun ||
      currentInvocation ||
      state.workflowCursor ||
      !workflowCursor ||
      nextInvocation ||
      attempt ||
      effect ||
      effects ||
      reconciliation ||
      event.sequence !== 1 ||
      run.status !== RunStatus.RUNNING ||
      run.version !== 1 ||
      run.lastSequence !== 1 ||
      invocation.status !== InvocationStatus.RUNNABLE ||
      invocation.generation !== 0 ||
      invocation.version !== 1 ||
      invocation.lastSequence !== 1 ||
      workflowCursor.version !== 1 ||
      workflowCursor.lastSequence !== 1 ||
      workflowCursor.disposition !==
        WorkflowCursorDisposition.ACTIVITY_RUNNABLE ||
      run.createdAt !== event.observed_at ||
      run.updatedAt !== event.observed_at ||
      invocation.createdAt !== event.observed_at ||
      invocation.updatedAt !== event.observed_at ||
      workflowCursor.createdAt !== event.observed_at ||
      workflowCursor.updatedAt !== event.observed_at ||
      run.appId !== invocation.appId ||
      run.appId !== workflowCursor.appId ||
      run.revisionId !== invocation.revisionId ||
      run.revisionId !== workflowCursor.revisionId ||
      run.runId !== workflowCursor.runId ||
      run.trigger.kind !== 'workflow' ||
      run.trigger.workflowId !== workflowCursor.workflowId ||
      run.trigger.planId !== workflowCursor.planId ||
      !hasSameCanonicalJson(run.trigger.planRef, workflowCursor.planRef) ||
      !hasSameCanonicalJson(run.requestRef, workflowCursor.startRef) ||
      invocation.invocationId !== workflowCursor.invocationId ||
      !invocation.workflow ||
      !hasSameCanonicalJson(invocation.workflow, {
        workflowId: workflowCursor.workflowId,
        planId: workflowCursor.planId,
        continuationId: workflowCursor.continuationId,
        stepId: workflowCursor.stepId,
        stepIndex: workflowCursor.stepIndex,
      }) ||
      event.fence.coordinatorEpoch !== 0 ||
      event.fence.invocationGeneration !== 0
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid workflow run creation',
      );
    }

    const planPayload = await payloadReader.readWorkflowPlan(
      run.trigger.planRef,
    );
    const startPayload = await payloadReader.readWorkflowStart(run.requestRef);
    const activityRequest = normalizeWorkflowActivityRequest(
      await payloadReader.readActivityRequest(invocation.requestRef),
      'persisted workflow activity request',
    );
    let materialized;
    try {
      materialized = materializeFirstWorkflowActivity({
        runId,
        planPayload,
        planRef: run.trigger.planRef,
        startPayload,
        startRef: run.requestRef,
        observedAt: event.observed_at,
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'workflow start materialization mismatch',
      );
    }
    if (
      materialized.planPayload.appId !== run.appId ||
      materialized.planPayload.revisionId !== run.revisionId ||
      materialized.planPayload.workflowId !== run.trigger.workflowId ||
      materialized.planId !== run.trigger.planId ||
      materialized.invocationId !== invocation.invocationId ||
      materialized.activityId !== invocation.activityId ||
      materialized.activityId === MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID ||
      !hasSameCanonicalJson(materialized.activityRequest, activityRequest) ||
      !hasSameCanonicalJson(materialized.cursor, workflowCursor)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'workflow start derivation mismatch',
      );
    }
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
      undefined,
      runId,
    );
    state.run = run;
    state.workflowCursor = workflowCursor;
    state.invocations.set(invocation.invocationId, invocation);
    return;
  }

  if (
    event.type === 'manual-run-created' ||
    event.type === 'effect-successor-run-created'
  ) {
    const isSuccessor = event.type === 'effect-successor-run-created';
    const authorization = isSuccessor
      ? normalizeManagedEffectSuccessorAuthorization(
          event.payload.authorization,
        )
      : undefined;
    if (
      currentRun ||
      currentInvocation ||
      state.workflowCursor ||
      workflowCursor ||
      nextInvocation ||
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
      event.fence.invocationGeneration !== 0 ||
      invocation.workflow ||
      (isSuccessor
        ? !authorization ||
          run.runId !== authorization.target.runId ||
          invocation.invocationId !== authorization.target.invocationId ||
          run.revisionId !== authorization.target.revisionId ||
          invocation.activityId !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID ||
          !hasSameCanonicalJson(run.trigger, authorization) ||
          authorization.source.runId === authorization.target.runId ||
          authorization.source.effectId === authorization.target.effectId ||
          authorization.target.destinationEffectId !==
            createManagedEffectDestinationId({
              appId: run.appId,
              runId: run.runId,
              invocationId: invocation.invocationId,
              effectId: authorization.target.effectId,
            })
        : run.trigger.kind !== 'manual' ||
          invocation.activityId === MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID)
    ) {
      throw new ExecutionLedgerProjectionError(runId, 'invalid run creation');
    }
    const requestEnvelope = await payloadReader.readActivityRequest(
      run.requestRef,
    );
    if (authorization) {
      const target = normalizeManagedEffectSuccessorRunInput(
        requestEnvelope.input,
        'effect successor run input',
      );
      let derivedAuthorization;
      try {
        derivedAuthorization = assertManagedEffectSuccessorAuthorizationDerived(
          {
            appId: run.appId,
            revisionId: run.revisionId,
            request: target.request,
            authorization,
          },
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'effect successor authorization derivation mismatch',
        );
      }
      if (
        Object.keys(requestEnvelope.callerMetadata).length !== 0 ||
        target.effectId !== authorization.target.effectId ||
        !hasSameCanonicalJson(derivedAuthorization, authorization) ||
        createManagedEffectSuccessorRequestDigest(target.request) !==
          authorization.target.requestDigest
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'effect successor target request mismatch',
        );
      }
    }
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
      ![
        'manual-cancellation-requested',
        'effect-successor-authorized',
      ].includes(event.type))
  ) {
    throw new ExecutionLedgerProjectionError(runId, 'event lacks prior state');
  }
  if (
    [
      'workflow-activity-claimed',
      'workflow-activity-started',
      'workflow-activity-succeeded',
      'workflow-activity-failed',
      'workflow-activity-abandoned-before-start',
      'workflow-activity-became-uncertain',
      'workflow-activity-uncertainty-reconciled',
    ].includes(event.type)
  ) {
    const currentCursor = state.workflowCursor;
    const isReconciliation =
      event.type === 'workflow-activity-uncertainty-reconciled';
    if (
      currentRun.trigger?.kind !== 'workflow' ||
      !currentCursor ||
      !workflowCursor ||
      (isReconciliation
        ? Boolean(attempt) || !reconciliation || !currentAttempt
        : !attempt || Boolean(reconciliation)) ||
      effect ||
      effects ||
      (![
        'workflow-activity-succeeded',
        'workflow-activity-uncertainty-reconciled',
      ].includes(event.type) &&
        Boolean(nextInvocation)) ||
      currentCursor.invocationId !== currentInvocation.invocationId ||
      run.updatedAt !== event.observed_at ||
      invocation.updatedAt !== event.observed_at ||
      event.observed_at < currentRun.updatedAt ||
      event.observed_at < currentCursor.updatedAt
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid workflow activity transition scope',
      );
    }
    assertRunAdvance(currentRun, run, event.sequence, runId);
    assertInvocationAdvance(
      currentInvocation,
      invocation,
      event.sequence,
      runId,
    );
    assertWorkflowCursorAdvance(currentCursor, workflowCursor, event, runId);
    assertAttemptBelongsToInvocation(
      /** @type {Record<string, any>} */ (attempt || currentAttempt),
      run,
      invocation,
      runId,
    );

    const planPayload = await payloadReader.readWorkflowPlan(
      currentCursor.planRef,
    );
    const startPayload = await payloadReader.readWorkflowStart(
      currentCursor.startRef,
    );
    const resolvedOutputs = await readWorkflowCursorOutputs(
      currentCursor,
      payloadReader,
    );
    const currentStep = planPayload.definition.steps[currentCursor.stepIndex];
    let currentSelectedOutput;
    let materializedCurrent;
    try {
      currentSelectedOutput = selectWorkflowStepOutput(
        currentStep,
        resolvedOutputs,
        'persisted workflow activity',
      );
      materializedCurrent = materializeWorkflowCursorActivity({
        cursor: currentCursor,
        planPayload,
        planRef: currentCursor.planRef,
        startPayload,
        startRef: currentCursor.startRef,
        ...(currentSelectedOutput
          ? { selectedOutput: currentSelectedOutput }
          : {}),
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'workflow activity derivation mismatch',
      );
    }
    const currentRequest = normalizeWorkflowActivityRequest(
      await payloadReader.readActivityRequest(currentInvocation.requestRef),
      'persisted workflow activity request',
    );
    if (
      materializedCurrent.runId !== runId ||
      materializedCurrent.planPayload.appId !== currentRun.appId ||
      materializedCurrent.planPayload.revisionId !== currentRun.revisionId ||
      materializedCurrent.planPayload.workflowId !==
        currentRun.trigger.workflowId ||
      materializedCurrent.planId !== currentRun.trigger.planId ||
      materializedCurrent.invocationId !== currentInvocation.invocationId ||
      materializedCurrent.activityId !== currentInvocation.activityId ||
      !isWorkflowActivityDispatchSupported(currentCursor, planPayload) ||
      !hasSameCanonicalJson(materializedCurrent.activityRequest, currentRequest)
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'workflow activity request mismatch',
      );
    }

    const sequence = event.sequence;
    const expectedRunBase = {
      ...cloneJsonObject(currentRun, 'prior workflow run'),
      version: currentRun.version + 1,
      lastSequence: sequence,
      updatedAt: event.observed_at,
    };
    const expectedInvocationBase = {
      ...cloneJsonObject(currentInvocation, 'prior workflow invocation'),
      version: currentInvocation.version + 1,
      lastSequence: sequence,
      updatedAt: event.observed_at,
    };
    const expectedCursorBase = {
      ...cloneJsonObject(currentCursor, 'prior workflow cursor'),
      version: currentCursor.version + 1,
      lastSequence: sequence,
      updatedAt: event.observed_at,
    };

    if (event.type === 'workflow-activity-claimed') {
      if (!attempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity claim lacks its attempt',
        );
      }
      const expectedAttempt = {
        schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
        runId,
        invocationId: currentInvocation.invocationId,
        attemptId: createAttemptId(
          runId,
          currentInvocation.invocationId,
          currentInvocation.generation + 1,
        ),
        appId: currentRun.appId,
        revisionId: currentRun.revisionId,
        activityId: currentInvocation.activityId,
        status: AttemptStatus.CLAIMED,
        generation: currentInvocation.generation + 1,
        version: 1,
        coordinatorEpoch: event.fence.coordinatorEpoch,
        fencingToken: attempt.fencingToken,
        claimedAt: event.observed_at,
        updatedAt: event.observed_at,
        lastSequence: sequence,
      };
      if (
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNABLE ||
        currentInvocation.status !== InvocationStatus.RUNNABLE ||
        currentAttempt ||
        event.fence.invocationGeneration !== expectedAttempt.generation ||
        !hasSameCanonicalJson(run, expectedRunBase) ||
        !hasSameCanonicalJson(invocation, {
          ...expectedInvocationBase,
          status: InvocationStatus.RUNNING,
          generation: currentInvocation.generation + 1,
        }) ||
        !hasSameCanonicalJson(workflowCursor, {
          ...expectedCursorBase,
          disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
        }) ||
        !hasSameCanonicalJson(attempt, expectedAttempt)
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid workflow activity claim',
        );
      }
    } else if (event.type === 'workflow-activity-started') {
      if (!currentAttempt || !attempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity start lacks its claimed attempt',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      if (
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNING ||
        currentInvocation.status !== InvocationStatus.RUNNING ||
        currentAttempt.status !== AttemptStatus.CLAIMED ||
        !hasSameCanonicalJson(run, expectedRunBase) ||
        !hasSameCanonicalJson(invocation, expectedInvocationBase) ||
        !hasSameCanonicalJson(workflowCursor, expectedCursorBase) ||
        !hasSameCanonicalJson(attempt, {
          ...cloneJsonObject(currentAttempt, 'prior workflow attempt'),
          status: AttemptStatus.STARTED,
          version: currentAttempt.version + 1,
          startedAt: event.observed_at,
          updatedAt: event.observed_at,
          lastSequence: sequence,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid workflow activity start',
        );
      }
    } else if (event.type === 'workflow-activity-abandoned-before-start') {
      if (!currentAttempt || !attempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow claim release lacks its claimed attempt',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      let materializedRelease;
      try {
        materializedRelease = materializeWorkflowActivityClaimRelease({
          currentCursor,
          sequence,
          observedAt: event.observed_at,
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow claim release cursor mismatch',
        );
      }
      const attemptEffects = [...state.effects.values()].filter(
        (candidate) =>
          candidate.invocationId === currentAttempt.invocationId &&
          candidate.requestedBy.attemptId === currentAttempt.attemptId,
      );
      if (
        currentRun.status !== RunStatus.RUNNING ||
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNING ||
        currentInvocation.status !== InvocationStatus.RUNNING ||
        currentAttempt.status !== AttemptStatus.CLAIMED ||
        attemptEffects.length !== 0 ||
        !hasSameCanonicalJson(run, expectedRunBase) ||
        !hasSameCanonicalJson(invocation, {
          ...expectedInvocationBase,
          status: InvocationStatus.RUNNABLE,
        }) ||
        !hasSameCanonicalJson(workflowCursor, materializedRelease) ||
        !hasSameCanonicalJson(attempt, {
          ...cloneJsonObject(currentAttempt, 'prior workflow attempt'),
          status: AttemptStatus.ABANDONED,
          version: currentAttempt.version + 1,
          lastSequence: sequence,
          updatedAt: event.observed_at,
          abandonment: attempt.abandonment,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid workflow claim release',
        );
      }
    } else if (event.type === 'workflow-activity-became-uncertain') {
      if (!currentAttempt || !attempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow uncertainty lacks its started attempt',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      let materializedUncertainty;
      try {
        materializedUncertainty = materializeWorkflowActivityUncertainty({
          currentCursor,
          sequence,
          observedAt: event.observed_at,
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow uncertainty cursor mismatch',
        );
      }
      const attemptEffects = [...state.effects.values()].filter(
        (candidate) =>
          candidate.invocationId === currentAttempt.invocationId &&
          candidate.requestedBy.attemptId === currentAttempt.attemptId,
      );
      if (
        currentRun.status !== RunStatus.RUNNING ||
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNING ||
        currentInvocation.status !== InvocationStatus.RUNNING ||
        currentAttempt.status !== AttemptStatus.STARTED ||
        attemptEffects.length !== 0 ||
        !hasSameCanonicalJson(run, {
          ...expectedRunBase,
          status: RunStatus.BLOCKED,
        }) ||
        !hasSameCanonicalJson(invocation, {
          ...expectedInvocationBase,
          status: InvocationStatus.UNCERTAIN,
          uncertainty: attempt.abandonment,
        }) ||
        !hasSameCanonicalJson(workflowCursor, materializedUncertainty) ||
        !hasSameCanonicalJson(attempt, {
          ...cloneJsonObject(currentAttempt, 'prior workflow attempt'),
          status: AttemptStatus.ABANDONED,
          version: currentAttempt.version + 1,
          lastSequence: sequence,
          updatedAt: event.observed_at,
          abandonment: attempt.abandonment,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid workflow activity uncertainty',
        );
      }
    } else if (event.type === 'workflow-activity-succeeded') {
      if (!currentAttempt || !attempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity success lacks its started attempt',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      const verifiedEvidence = validateLedgerAttemptEvidence(
        await payloadReader.readEvidence(attempt.evidenceRef),
        await createLedgerAttemptStart(
          currentRun,
          currentInvocation,
          currentAttempt,
          payloadReader,
        ),
        'persisted workflow activity evidence',
      );
      try {
        assertSupportedWorkflowActivityTerminal(
          verifiedEvidence.terminal,
          verifiedEvidence.evidence,
          'persisted workflow activity evidence',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity evidence lacks durable cancellation authority',
        );
      }
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        currentAttempt,
        state,
        payloadReader,
        effectVerifierRegistry,
        runId,
      );
      const terminal = verifiedEvidence.terminal;
      const terminalSummary = createTerminalSummary(terminal);
      const attemptEffects = [...state.effects.values()].filter(
        (candidate) =>
          candidate.invocationId === currentAttempt.invocationId &&
          candidate.requestedBy.attemptId === currentAttempt.attemptId,
      );
      const outputBinding = workflowCursor.outputs.at(-1);
      if (!outputBinding) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity success lacks its output binding',
        );
      }
      const outputPayload = await payloadReader.readWorkflowOutput(
        outputBinding.outputRef,
      );
      const nextStep =
        planPayload.definition.steps[currentCursor.stepIndex + 1];
      let nextSelectedOutput;
      let materializedSuccess;
      try {
        nextSelectedOutput = nextStep
          ? selectWorkflowStepOutput(
              nextStep,
              [
                ...resolvedOutputs,
                { binding: outputBinding, payload: outputPayload },
              ],
              'persisted workflow successor',
            )
          : undefined;
        materializedSuccess = materializeWorkflowActivitySuccess({
          currentCursor,
          planPayload,
          planRef: currentCursor.planRef,
          startPayload,
          startRef: currentCursor.startRef,
          outputPayload,
          outputRef: outputBinding.outputRef,
          ...(nextSelectedOutput ? { selectedOutput: nextSelectedOutput } : {}),
          sequence,
          observedAt: event.observed_at,
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity successor derivation mismatch',
        );
      }
      if (
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNING ||
        currentInvocation.status !== InvocationStatus.RUNNING ||
        currentAttempt.status !== AttemptStatus.STARTED ||
        attemptEffects.length !== 0 ||
        terminal.type !== 'completed' ||
        terminal.attemptId !== currentAttempt.attemptId ||
        !hasSameCanonicalJson(outputPayload.value, terminal.result) ||
        !hasSameCanonicalJson(workflowCursor, materializedSuccess.cursor) ||
        !hasSameCanonicalJson(attempt, {
          ...cloneJsonObject(currentAttempt, 'prior workflow attempt'),
          status: AttemptStatus.COMPLETED,
          version: currentAttempt.version + 1,
          lastSequence: sequence,
          updatedAt: event.observed_at,
          terminal: terminalSummary,
          evidenceRef: attempt.evidenceRef,
        }) ||
        !hasSameCanonicalJson(invocation, {
          ...expectedInvocationBase,
          status: InvocationStatus.COMPLETED,
          terminal: terminalSummary,
        }) ||
        !hasSameCanonicalJson(run, {
          ...expectedRunBase,
          status: materializedSuccess.completed
            ? RunStatus.COMPLETED
            : RunStatus.RUNNING,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid workflow activity success',
        );
      }
      if (materializedSuccess.completed) {
        if (nextInvocation) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'completed workflow retains a successor invocation',
          );
        }
      } else {
        const nextActivity = materializedSuccess.nextActivity;
        if (!nextActivity || !nextInvocation) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'workflow successor invocation is unavailable',
          );
        }
        const nextRequest = normalizeWorkflowActivityRequest(
          await payloadReader.readActivityRequest(nextInvocation.requestRef),
          'persisted workflow successor request',
        );
        const expectedNextInvocation = {
          schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
          runId,
          invocationId: nextActivity.invocationId,
          appId: currentRun.appId,
          revisionId: currentRun.revisionId,
          activityId: nextActivity.activityId,
          requestRef: nextInvocation.requestRef,
          status: InvocationStatus.RUNNABLE,
          generation: 0,
          version: 1,
          lastSequence: sequence,
          createdAt: event.observed_at,
          updatedAt: event.observed_at,
          workflow: {
            workflowId: currentCursor.workflowId,
            planId: currentCursor.planId,
            continuationId: nextActivity.continuationId,
            stepId: nextActivity.stepId,
            stepIndex: nextActivity.stepIndex,
          },
        };
        if (
          state.invocations.has(nextInvocation.invocationId) ||
          !hasSameCanonicalJson(nextRequest, nextActivity.activityRequest) ||
          !hasSameCanonicalJson(nextInvocation, expectedNextInvocation)
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'workflow successor invocation mismatch',
          );
        }
      }
    } else if (event.type === 'workflow-activity-failed') {
      if (!currentAttempt || !attempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity failure lacks its started attempt',
        );
      }
      assertAttemptAdvance(currentAttempt, attempt, event, runId);
      const verifiedEvidence = validateLedgerAttemptEvidence(
        await payloadReader.readEvidence(attempt.evidenceRef),
        await createLedgerAttemptStart(
          currentRun,
          currentInvocation,
          currentAttempt,
          payloadReader,
        ),
        'persisted failed workflow activity evidence',
      );
      try {
        assertSupportedWorkflowActivityTerminal(
          verifiedEvidence.terminal,
          verifiedEvidence.evidence,
          'persisted failed workflow activity evidence',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'failed workflow activity evidence is unsupported',
        );
      }
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        currentAttempt,
        state,
        payloadReader,
        effectVerifierRegistry,
        runId,
      );
      const terminal = verifiedEvidence.terminal;
      const terminalSummary = createTerminalSummary(terminal);
      let materializedFailure;
      try {
        materializedFailure = materializeWorkflowActivityFailure({
          currentCursor,
          planPayload,
          planRef: currentCursor.planRef,
          startPayload,
          startRef: currentCursor.startRef,
          outcome: terminal.type,
          sequence,
          observedAt: event.observed_at,
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow activity failure cursor derivation mismatch',
        );
      }
      const attemptEffects = [...state.effects.values()].filter(
        (candidate) =>
          candidate.invocationId === currentAttempt.invocationId &&
          candidate.requestedBy.attemptId === currentAttempt.attemptId,
      );
      if (
        currentRun.status !== RunStatus.RUNNING ||
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_RUNNING ||
        currentInvocation.status !== InvocationStatus.RUNNING ||
        currentAttempt.status !== AttemptStatus.STARTED ||
        !['failed', 'protocol-failed'].includes(terminal.type) ||
        terminal.attemptId !== currentAttempt.attemptId ||
        attemptEffects.length !== 0 ||
        !hasSameCanonicalJson(workflowCursor, materializedFailure.cursor) ||
        !hasSameCanonicalJson(attempt, {
          ...cloneJsonObject(currentAttempt, 'prior workflow attempt'),
          status: AttemptStatus.FAILED,
          version: currentAttempt.version + 1,
          lastSequence: sequence,
          updatedAt: event.observed_at,
          terminal: terminalSummary,
          evidenceRef: attempt.evidenceRef,
        }) ||
        !hasSameCanonicalJson(invocation, {
          ...expectedInvocationBase,
          status: InvocationStatus.FAILED,
          terminal: terminalSummary,
        }) ||
        !hasSameCanonicalJson(run, {
          ...expectedRunBase,
          status: RunStatus.FAILED,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid workflow activity failure',
        );
      }
    } else {
      if (!reconciliation || !currentAttempt) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'workflow reconciliation lacks its retained uncertain attempt',
        );
      }
      const uncertaintyBySequence = state.eventsBySequence.get(
        reconciliation.uncertaintySequence,
      );
      const uncertaintyById = state.eventsById.get(
        reconciliation.uncertaintyEventId,
      );
      const verifiedEvidence = validateLedgerAttemptEvidence(
        await payloadReader.readEvidence(reconciliation.evidenceRef),
        await createLedgerAttemptStart(
          currentRun,
          currentInvocation,
          currentAttempt,
          payloadReader,
        ),
        'persisted uncertain workflow activity evidence',
      );
      try {
        assertSupportedWorkflowActivityTerminal(
          verifiedEvidence.terminal,
          verifiedEvidence.evidence,
          'persisted uncertain workflow activity evidence',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'uncertain workflow evidence lacks durable cancellation authority',
        );
      }
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        currentAttempt,
        state,
        payloadReader,
        effectVerifierRegistry,
        runId,
      );
      const terminal = verifiedEvidence.terminal;
      const terminalSummary = createTerminalSummary(terminal);
      const completed = terminal.type === 'completed';
      let outputPayload;
      /** @type {Record<string, any>} */
      let materializedTerminal;
      if (completed) {
        const outputBinding = workflowCursor.outputs[currentCursor.stepIndex];
        if (
          !outputBinding ||
          outputBinding.stepId !== currentCursor.stepId ||
          outputBinding.stepIndex !== currentCursor.stepIndex
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'workflow reconciliation lacks its current-step output binding',
          );
        }
        outputPayload = await payloadReader.readWorkflowOutput(
          outputBinding.outputRef,
        );
        const nextStep =
          planPayload.definition.steps[currentCursor.stepIndex + 1];
        try {
          const nextSelectedOutput = nextStep
            ? selectWorkflowStepOutput(
                nextStep,
                [
                  ...resolvedOutputs,
                  { binding: outputBinding, payload: outputPayload },
                ],
                'persisted uncertain workflow successor',
              )
            : undefined;
          materializedTerminal = materializeUncertainWorkflowActivitySuccess({
            currentCursor,
            planPayload,
            planRef: currentCursor.planRef,
            startPayload,
            startRef: currentCursor.startRef,
            outputPayload,
            outputRef: outputBinding.outputRef,
            ...(nextSelectedOutput
              ? { selectedOutput: nextSelectedOutput }
              : {}),
            sequence,
            observedAt: event.observed_at,
          });
        } catch {
          throw new ExecutionLedgerProjectionError(
            runId,
            'uncertain workflow activity successor derivation mismatch',
          );
        }
      } else {
        try {
          materializedTerminal = materializeUncertainWorkflowActivityFailure({
            currentCursor,
            planPayload,
            planRef: currentCursor.planRef,
            startPayload,
            startRef: currentCursor.startRef,
            outcome: terminal.type,
            sequence,
            observedAt: event.observed_at,
          });
        } catch {
          throw new ExecutionLedgerProjectionError(
            runId,
            'uncertain workflow activity failure derivation mismatch',
          );
        }
      }
      const attemptEffects = [...state.effects.values()].filter(
        (candidate) =>
          candidate.invocationId === currentAttempt.invocationId &&
          candidate.requestedBy.attemptId === currentAttempt.attemptId,
      );
      const expectedReconciledInvocation = cloneJsonObject(
        expectedInvocationBase,
        'expected reconciled workflow invocation',
      );
      delete expectedReconciledInvocation.uncertainty;
      expectedReconciledInvocation.status = completed
        ? InvocationStatus.COMPLETED
        : InvocationStatus.FAILED;
      expectedReconciledInvocation.terminal = terminalSummary;
      if (
        !uncertaintyBySequence ||
        uncertaintyBySequence !== uncertaintyById ||
        currentRun.status !== RunStatus.BLOCKED ||
        currentCursor.disposition !==
          WorkflowCursorDisposition.ACTIVITY_UNCERTAIN ||
        currentInvocation.status !== InvocationStatus.UNCERTAIN ||
        currentAttempt.status !== AttemptStatus.ABANDONED ||
        attemptEffects.length !== 0 ||
        reconciliation.invocationId !== currentInvocation.invocationId ||
        reconciliation.attemptId !== currentAttempt.attemptId ||
        reconciliation.generation !== currentAttempt.generation ||
        reconciliation.coordinatorEpoch !== currentAttempt.coordinatorEpoch ||
        reconciliation.fencingToken !== currentAttempt.fencingToken ||
        event.fence.coordinatorEpoch !== reconciliation.coordinatorEpoch ||
        event.fence.invocationGeneration !== reconciliation.generation ||
        !['completed', 'failed', 'protocol-failed'].includes(terminal.type) ||
        terminal.attemptId !== currentAttempt.attemptId ||
        !hasSameCanonicalJson(reconciliation.terminal, terminalSummary) ||
        (completed &&
          !hasSameCanonicalJson(outputPayload?.value, terminal.result)) ||
        !hasExactWorkflowActivityUncertaintyEventLink({
          run: currentRun,
          invocation: currentInvocation,
          workflowCursor: currentCursor,
          attempt: currentAttempt,
          reconciliation,
          uncertaintyEvent: uncertaintyBySequence,
          runId,
        }) ||
        !hasSameCanonicalJson(workflowCursor, materializedTerminal.cursor) ||
        !hasSameCanonicalJson(invocation, expectedReconciledInvocation) ||
        !hasSameCanonicalJson(run, {
          ...expectedRunBase,
          status: completed
            ? materializedTerminal.completed
              ? RunStatus.COMPLETED
              : RunStatus.RUNNING
            : RunStatus.FAILED,
        })
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid uncertain workflow activity reconciliation',
        );
      }
      if (!completed) {
        if (nextInvocation) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'failed reconciled workflow retains a successor invocation',
          );
        }
      } else if (materializedTerminal.completed) {
        if (nextInvocation) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'completed reconciled workflow retains a successor invocation',
          );
        }
      } else {
        const nextActivity = materializedTerminal.nextActivity;
        if (!nextActivity || !nextInvocation) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'reconciled workflow successor invocation is unavailable',
          );
        }
        const nextRequest = normalizeWorkflowActivityRequest(
          await payloadReader.readActivityRequest(nextInvocation.requestRef),
          'persisted reconciled workflow successor request',
        );
        const expectedNextInvocation = {
          schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
          runId,
          invocationId: nextActivity.invocationId,
          appId: currentRun.appId,
          revisionId: currentRun.revisionId,
          activityId: nextActivity.activityId,
          requestRef: nextInvocation.requestRef,
          status: InvocationStatus.RUNNABLE,
          generation: 0,
          version: 1,
          lastSequence: sequence,
          createdAt: event.observed_at,
          updatedAt: event.observed_at,
          workflow: {
            workflowId: currentCursor.workflowId,
            planId: currentCursor.planId,
            continuationId: nextActivity.continuationId,
            stepId: nextActivity.stepId,
            stepIndex: nextActivity.stepIndex,
          },
        };
        if (
          state.invocations.has(nextInvocation.invocationId) ||
          !hasSameCanonicalJson(nextRequest, nextActivity.activityRequest) ||
          !hasSameCanonicalJson(nextInvocation, expectedNextInvocation)
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'reconciled workflow successor invocation mismatch',
          );
        }
      }
    }

    assertEventRequestDigest(
      event,
      currentRun,
      currentInvocation,
      currentAttempt,
      undefined,
      new Map(),
      run,
      invocation,
      attempt,
      undefined,
      undefined,
      reconciliation,
      {
        currentCursor,
        nextCursor: workflowCursor,
        ...(nextInvocation ? { nextInvocation } : {}),
      },
      runId,
    );
    state.run = run;
    state.workflowCursor = workflowCursor;
    state.invocations.set(invocation.invocationId, invocation);
    if (attempt) {
      state.attempts.set(
        attemptMapKey(attempt.invocationId, attempt.attemptId),
        attempt,
      );
    }
    if (nextInvocation) {
      state.invocations.set(nextInvocation.invocationId, nextInvocation);
    }
    return;
  }
  if (currentRun.trigger?.kind === 'workflow') {
    throw new ExecutionLedgerProjectionError(
      runId,
      'workflow event type is not implemented',
    );
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

  if (event.type === 'effect-successor-authorized') {
    const authorization = normalizeManagedEffectSuccessorAuthorization(
      event.payload.authorization,
    );
    const sourceEffect = state.effects.get(
      effectMapKey(
        authorization.source.invocationId,
        authorization.source.effectId,
      ),
    );
    const sourceAttempt = state.attempts.get(
      attemptMapKey(
        authorization.source.invocationId,
        authorization.source.attemptId,
      ),
    );
    const uncertaintyEvent = state.eventsById.get(
      authorization.source.uncertaintyEventId,
    );
    const reconciliationEvent = state.eventsById.get(
      authorization.source.reconciliationEventId,
    );
    const priorSlot = [...state.eventsBySequence.values()].find(
      (candidate) =>
        candidate.type === 'effect-successor-authorized' &&
        normalizeManagedEffectSuccessorAuthorization(
          candidate.payload.authorization,
        ).slotId === authorization.slotId,
    );
    const sourceRequest = sourceEffect
      ? await payloadReader.readManagedEffectRequest(sourceEffect.requestRef)
      : undefined;
    let derivedAuthorization;
    try {
      if (sourceEffect && sourceRequest) {
        assertInitialManagedEffectSuccessorRetryEligible({
          effect: sourceEffect,
          request: sourceRequest,
        });
        derivedAuthorization = assertManagedEffectSuccessorAuthorizationDerived(
          {
            appId: currentRun.appId,
            revisionId: currentRun.revisionId,
            request: sourceRequest,
            authorization,
          },
        );
      }
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor policy or derivation mismatch',
      );
    }
    const expectedRun = {
      ...cloneJsonObject(currentRun, 'current successor source run'),
      version: currentRun.version + 1,
      lastSequence: event.sequence,
      updatedAt: event.observed_at,
    };
    const expectedInvocation = {
      ...cloneJsonObject(
        currentInvocation,
        'current successor source invocation',
      ),
      version: currentInvocation.version + 1,
      lastSequence: event.sequence,
      updatedAt: event.observed_at,
    };
    const reconciliationSnapshots = reconciliationEvent
      ? eventSnapshots(reconciliationEvent, runId)
      : undefined;
    const sourceFamily = classifyNotAppliedManagedEffectSuccessorSource({
      run: currentRun,
      invocation: currentInvocation,
      attempt: sourceAttempt,
      effect: sourceEffect,
      uncertaintyEvent,
      reconciliationEvent,
      runId,
    });
    if (
      priorSlot ||
      !sourceFamily ||
      authorization.source.runId !== runId ||
      authorization.source.invocationId !== currentInvocation.invocationId ||
      authorization.target.runId === runId ||
      authorization.target.revisionId !== currentRun.revisionId ||
      !sourceEffect ||
      sourceEffect.status !== EffectStatus.NOT_APPLIED ||
      !sourceEffect.reconciliation ||
      sourceEffect.reconciliation.resolutionStatus !==
        EffectStatus.NOT_APPLIED ||
      sourceEffect.reconciliation.reconciliationId !==
        authorization.source.reconciliationId ||
      sourceEffect.reconciliation.uncertaintyEventId !==
        authorization.source.uncertaintyEventId ||
      sourceEffect.reconciliation.uncertaintySequence !==
        authorization.source.uncertaintySequence ||
      sourceEffect.requestedBy.attemptId !== authorization.source.attemptId ||
      !sourceAttempt ||
      sourceAttempt.status !== AttemptStatus.ABANDONED ||
      !uncertaintyEvent ||
      uncertaintyEvent.sequence !== authorization.source.uncertaintySequence ||
      !reconciliationEvent ||
      !['uncertain-effect-reconciled', 'effect-successor-reconciled'].includes(
        reconciliationEvent.type,
      ) ||
      reconciliationEvent.sequence !==
        authorization.source.reconciliationSequence ||
      reconciliationSnapshots?.effect?.effectId !== sourceEffect.effectId ||
      reconciliationSnapshots?.reconciliation?.reconciliationId !==
        authorization.source.reconciliationId ||
      !hasSameCanonicalJson(
        sourceEffect.adapter,
        authorization.contract.adapter,
      ) ||
      !hasSameCanonicalJson(
        sourceEffect.destination,
        authorization.contract.destination,
      ) ||
      !hasSameCanonicalJson(
        sourceEffect.verifier,
        authorization.contract.verifier,
      ) ||
      !hasSameCanonicalJson(
        sourceEffect.substantiatedReplayProperties,
        authorization.contract.substantiatedReplayProperties,
      ) ||
      !sourceRequest ||
      !derivedAuthorization ||
      !hasSameCanonicalJson(derivedAuthorization, authorization) ||
      createManagedEffectSuccessorRequestDigest(sourceRequest) !==
        authorization.target.requestDigest ||
      !hasSameCanonicalJson(run, expectedRun) ||
      !hasSameCanonicalJson(invocation, expectedInvocation) ||
      event.fence.coordinatorEpoch !== 0 ||
      event.fence.invocationGeneration !== currentInvocation.generation
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid effect successor authorization',
      );
    }
    assertEventRequestDigest(
      event,
      currentRun,
      currentInvocation,
      undefined,
      undefined,
      new Map(),
      run,
      invocation,
      undefined,
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

  if (event.type === 'manual-cancellation-requested') {
    if (currentRun.trigger?.kind === 'effect-successor') {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor cancellation is not authorized',
      );
    }
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
  } else if (event.type === 'effect-successor-started') {
    if (!attempt || !effect) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor start lacks attempt or effect state',
      );
    }
    const authorization = normalizeManagedEffectSuccessorAuthorization(
      currentRun.trigger,
    );
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    try {
      assertManagedEffectSuccessorPlannedRequest({
        run: currentRun,
        invocation: currentInvocation,
        effect,
        request,
        priorEffects: [...state.effects.values()],
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor start does not match its retained authority',
      );
    }
    const exactFence =
      attempt.attemptId === effect.requestedBy.attemptId &&
      attempt.generation === effect.requestedBy.generation &&
      attempt.coordinatorEpoch === effect.requestedBy.coordinatorEpoch &&
      attempt.fencingToken === effect.requestedBy.fencingToken &&
      effect.startedBy?.attemptId === attempt.attemptId &&
      effect.startedBy?.generation === attempt.generation &&
      effect.startedBy?.coordinatorEpoch === attempt.coordinatorEpoch &&
      effect.startedBy?.fencingToken === attempt.fencingToken &&
      event.fence.coordinatorEpoch === attempt.coordinatorEpoch &&
      event.fence.invocationGeneration === attempt.generation;
    if (
      currentRun.trigger?.kind !== 'effect-successor' ||
      currentRun.status !== RunStatus.RUNNING ||
      run.status !== RunStatus.RUNNING ||
      currentInvocation.status !== InvocationStatus.RUNNABLE ||
      currentInvocation.generation !== 0 ||
      invocation.status !== InvocationStatus.RUNNING ||
      invocation.generation !== 1 ||
      currentAttempt ||
      currentEffect ||
      currentEffectsForAttempt.size !== 0 ||
      attempt.status !== AttemptStatus.STARTED ||
      attempt.generation !== 1 ||
      attempt.version !== 1 ||
      attempt.lastSequence !== event.sequence ||
      attempt.attemptId !==
        createAttemptId(runId, invocation.invocationId, attempt.generation) ||
      attempt.claimedAt !== event.observed_at ||
      attempt.startedAt !== event.observed_at ||
      attempt.updatedAt !== event.observed_at ||
      Object.prototype.hasOwnProperty.call(attempt, 'terminal') ||
      Object.prototype.hasOwnProperty.call(attempt, 'evidenceRef') ||
      Object.prototype.hasOwnProperty.call(attempt, 'abandonment') ||
      effect.status !== EffectStatus.STARTED ||
      effect.version !== 1 ||
      effect.lastSequence !== event.sequence ||
      effect.createdAt !== event.observed_at ||
      effect.updatedAt !== event.observed_at ||
      effect.effectId !== authorization.target.effectId ||
      effect.destinationEffectId !== authorization.target.destinationEffectId ||
      effect.requestedBy.protocolSequence !== 1 ||
      !exactFence ||
      Object.prototype.hasOwnProperty.call(effect, 'terminal') ||
      Object.prototype.hasOwnProperty.call(effect, 'outcomeRef') ||
      Object.prototype.hasOwnProperty.call(effect, 'cancellation') ||
      Object.prototype.hasOwnProperty.call(effect, 'uncertainty') ||
      Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
      !hasSameOptionalFields(currentInvocation, invocation, [
        'terminal',
        'uncertainty',
        'cancellationRequest',
      ])
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid atomic effect successor start',
      );
    }
    assertAttemptBelongsToInvocation(attempt, run, invocation, runId);
    assertEffectBelongsToInvocation(effect, run, invocation, runId);
    try {
      assertStoppedAttemptClosureFits({
        run,
        invocation,
        attempt,
        effects: [effect],
        label: 'folded effect successor start',
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor start exceeds stopped-attempt closure budget',
      );
    }
  } else if (event.type === 'effect-successor-terminal') {
    if (!attempt || !effect || !currentAttempt || !currentEffect) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor terminal lacks retained effect state',
      );
    }
    const expectedStart = await createLedgerAttemptStart(
      run,
      invocation,
      attempt,
      payloadReader,
    );
    const verifiedEvidence = validateLedgerAttemptEvidence(
      await payloadReader.readEvidence(attempt.evidenceRef),
      expectedStart,
      'persisted effect successor terminal evidence',
    );
    const terminal = verifiedEvidence.terminal;
    const statuses = statusesForTerminal(terminal);
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    const outcome = await payloadReader.readManagedEffectOutcome(
      effect.outcomeRef,
    );
    const terminalEffects = new Map(state.effects);
    terminalEffects.set(
      effectMapKey(effect.invocationId, effect.effectId),
      effect,
    );
    try {
      verifyManagedEffectOutcome(
        effectVerifierRegistry,
        effect,
        request,
        outcome,
        'persisted effect successor outcome',
      );
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        attempt,
        { effects: terminalEffects },
        payloadReader,
        effectVerifierRegistry,
        runId,
      );
      await assertManagedEffectSuccessorTerminal({
        run: currentRun,
        invocation: currentInvocation,
        terminal,
        effects: terminalEffects,
        payloadReader,
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor terminal evidence is invalid',
      );
    }
    const expectedStatus = outcome.ok
      ? EffectStatus.COMPLETED
      : EffectStatus.FAILED;
    if (
      currentRun.trigger?.kind !== 'effect-successor' ||
      !['completed', 'failed'].includes(terminal.type) ||
      currentRun.status !== RunStatus.RUNNING ||
      run.status !== statuses.run ||
      currentInvocation.status !== InvocationStatus.RUNNING ||
      invocation.status !== statuses.invocation ||
      currentInvocation.generation !== currentAttempt.generation ||
      invocation.generation !== currentInvocation.generation ||
      currentAttempt.status !== AttemptStatus.STARTED ||
      attempt.status !== statuses.attempt ||
      attempt.startedAt !== currentAttempt.startedAt ||
      terminal.attemptId !== attempt.attemptId ||
      !hasSameCanonicalJson(
        createTerminalSummary(terminal),
        attempt.terminal,
      ) ||
      !hasSameCanonicalJson(invocation.terminal, attempt.terminal) ||
      currentEffect.status !== EffectStatus.STARTED ||
      effect.status !== expectedStatus ||
      effect.terminal?.ok !== outcome.ok ||
      outcome.ok !== (terminal.type === 'completed') ||
      (outcome.ok === false &&
        !hasSameCanonicalJson(terminal.error, outcome.error)) ||
      Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
      !hasSameOptionalFields(currentInvocation, invocation, [
        'cancellationRequest',
      ]) ||
      !hasSameOptionalFields(currentEffect, effect, ['startedBy'])
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid atomic effect successor terminal',
      );
    }
    assertAttemptBelongsToInvocation(attempt, run, invocation, runId);
    assertEffectBelongsToInvocation(effect, run, invocation, runId);
    assertAttemptAdvance(currentAttempt, attempt, event, runId);
    assertEffectAdvance(currentEffect, effect, event, runId);
  } else if (event.type === 'effect-successor-interrupted') {
    if (!attempt || !effect || !currentAttempt || !currentEffect) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor interruption lacks retained effect state',
      );
    }
    const exactStartedFence =
      effect.startedBy?.attemptId === attempt.attemptId &&
      effect.startedBy?.generation === attempt.generation &&
      effect.startedBy?.coordinatorEpoch === attempt.coordinatorEpoch &&
      effect.startedBy?.fencingToken === attempt.fencingToken;
    if (
      currentRun.trigger?.kind !== 'effect-successor' ||
      currentRun.status !== RunStatus.RUNNING ||
      run.status !== RunStatus.BLOCKED ||
      currentInvocation.status !== InvocationStatus.RUNNING ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      currentInvocation.generation !== currentAttempt.generation ||
      invocation.generation !== currentInvocation.generation ||
      invocation.generation !== attempt.generation ||
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
      Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
      unresolvedCurrentEffects.length !== 1 ||
      unresolvedCurrentEffects[0].effectId !== currentEffect.effectId
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid effect successor interruption',
      );
    }
    assertAttemptBelongsToInvocation(attempt, run, invocation, runId);
    assertEffectBelongsToInvocation(effect, run, invocation, runId);
    assertAttemptAdvance(currentAttempt, attempt, event, runId);
    assertEffectAdvance(currentEffect, effect, event, runId);
  } else if (event.type === 'effect-successor-reconciled') {
    if (!reconciliation || !currentAttempt || !currentEffect || !effect) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect successor reconciliation lacks retained state',
      );
    }
    const uncertaintyBySequence = state.eventsBySequence.get(
      reconciliation.uncertaintySequence,
    );
    const uncertaintyById = state.eventsById.get(
      reconciliation.uncertaintyEventId,
    );
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    let outcome;
    if (reconciliation.resolutionStatus === EffectStatus.NOT_APPLIED) {
      const evidence =
        await payloadReader.readManagedEffectReconciliationEvidence(
          reconciliation.evidenceRef,
        );
      try {
        verifyManagedEffectReconciliationEvidence(
          effectVerifierRegistry,
          effect,
          request,
          reconciliation.verifier,
          evidence,
          'persisted effect successor reconciliation evidence',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'effect successor not-applied evidence is invalid',
        );
      }
    } else {
      if (
        !hasSameCanonicalJson(reconciliation.verifier, effect.verifier) ||
        !hasSameCanonicalJson(reconciliation.evidenceRef, effect.outcomeRef)
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'effect successor reconciled outcome authority mismatch',
        );
      }
      outcome = await payloadReader.readManagedEffectOutcome(
        reconciliation.evidenceRef,
      );
      try {
        verifyManagedEffectOutcome(
          effectVerifierRegistry,
          effect,
          request,
          outcome,
          'persisted effect successor reconciled outcome',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'effect successor reconciled outcome evidence is invalid',
        );
      }
    }
    const terminalType =
      reconciliation.resolutionStatus === EffectStatus.COMPLETED
        ? 'completed'
        : 'failed';
    const expectedTerminal = {
      type: terminalType,
      attemptId: currentAttempt.attemptId,
    };
    if (
      !uncertaintyBySequence ||
      uncertaintyBySequence !== uncertaintyById ||
      currentRun.trigger?.kind !== 'effect-successor' ||
      currentRun.status !== RunStatus.BLOCKED ||
      run.status !==
        (terminalType === 'completed'
          ? RunStatus.COMPLETED
          : RunStatus.FAILED) ||
      currentInvocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.status !==
        (terminalType === 'completed'
          ? InvocationStatus.COMPLETED
          : InvocationStatus.FAILED) ||
      invocation.generation !== currentInvocation.generation ||
      !hasSameCanonicalJson(invocation.terminal, expectedTerminal) ||
      Object.prototype.hasOwnProperty.call(invocation, 'uncertainty') ||
      currentAttempt.status !== AttemptStatus.ABANDONED ||
      currentEffect.status !== EffectStatus.UNCERTAIN ||
      effect.status !== reconciliation.resolutionStatus ||
      reconciliation.invocationId !== invocation.invocationId ||
      reconciliation.attemptId !== currentAttempt.attemptId ||
      reconciliation.effectId !== effect.effectId ||
      reconciliation.generation !== currentAttempt.generation ||
      reconciliation.coordinatorEpoch !== currentAttempt.coordinatorEpoch ||
      reconciliation.fencingToken !== currentAttempt.fencingToken ||
      event.fence.coordinatorEpoch !== reconciliation.coordinatorEpoch ||
      event.fence.invocationGeneration !== reconciliation.generation ||
      !hasExactEffectUncertaintyEventLink({
        run: currentRun,
        invocation: currentInvocation,
        attempt: currentAttempt,
        effect: currentEffect,
        reconciliation,
        uncertaintyEvent: uncertaintyBySequence,
        runId,
      }) ||
      !hasSameCanonicalJson(effect.reconciliation, reconciliation) ||
      !hasSameOptionalFields(currentInvocation, invocation, [
        'cancellationRequest',
      ]) ||
      !hasSameOptionalFields(currentEffect, effect, ['startedBy']) ||
      (outcome &&
        (reconciliation.resolutionStatus === EffectStatus.COMPLETED) !==
          (outcome.ok === true))
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid effect successor reconciliation',
      );
    }
    assertEffectBelongsToInvocation(effect, run, invocation, runId);
    assertEffectAdvance(currentEffect, effect, event, runId);
  } else if (event.type.startsWith('effect-')) {
    if (currentRun.trigger?.kind === 'effect-successor') {
      throw new ExecutionLedgerProjectionError(
        runId,
        'ordinary managed-effect lifecycle is not authorized for a successor',
      );
    }
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
      try {
        assertManagedEffectSuccessorPlannedRequest({
          run: currentRun,
          invocation: currentInvocation,
          effect,
          request,
          priorEffects: [...state.effects.values()],
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'effect successor requested an unauthorized effect',
        );
      }
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
        Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
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
          Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
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
          Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
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
          Object.prototype.hasOwnProperty.call(effect, 'reconciliation') ||
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
  } else if (event.type === 'uncertain-effect-reconciled') {
    if (currentRun.trigger?.kind === 'effect-successor') {
      throw new ExecutionLedgerProjectionError(
        runId,
        'ordinary managed-effect reconciliation is not authorized for a successor',
      );
    }
    if (!reconciliation || !currentAttempt || !currentEffect || !effect) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'effect reconciliation lacks retained state',
      );
    }
    const uncertaintyBySequence = state.eventsBySequence.get(
      reconciliation.uncertaintySequence,
    );
    const uncertaintyById = state.eventsById.get(
      reconciliation.uncertaintyEventId,
    );
    assertEffectBelongsToInvocation(effect, run, invocation, runId);
    assertEffectAdvance(currentEffect, effect, event, runId);
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    if (
      !uncertaintyBySequence ||
      uncertaintyBySequence !== uncertaintyById ||
      currentRun.status !== RunStatus.BLOCKED ||
      run.status !== RunStatus.BLOCKED ||
      currentInvocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.generation !== currentInvocation.generation ||
      currentAttempt.status !== AttemptStatus.ABANDONED ||
      currentEffect.status !== EffectStatus.UNCERTAIN ||
      effect.status !== reconciliation.resolutionStatus ||
      reconciliation.invocationId !== invocation.invocationId ||
      reconciliation.attemptId !== currentAttempt.attemptId ||
      reconciliation.effectId !== effect.effectId ||
      reconciliation.generation !== currentAttempt.generation ||
      reconciliation.coordinatorEpoch !== currentAttempt.coordinatorEpoch ||
      reconciliation.fencingToken !== currentAttempt.fencingToken ||
      event.fence.coordinatorEpoch !== reconciliation.coordinatorEpoch ||
      event.fence.invocationGeneration !== reconciliation.generation ||
      !hasExactEffectUncertaintyEventLink({
        run: currentRun,
        invocation: currentInvocation,
        attempt: currentAttempt,
        effect: currentEffect,
        reconciliation,
        uncertaintyEvent: uncertaintyBySequence,
        runId,
      }) ||
      !hasSameCanonicalJson(effect.reconciliation, reconciliation) ||
      !hasSameOptionalFields(currentInvocation, invocation, [
        'terminal',
        'uncertainty',
        'cancellationRequest',
      ]) ||
      !hasSameOptionalFields(currentEffect, effect, ['startedBy'])
    ) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid uncertain managed-effect reconciliation',
      );
    }
    if (reconciliation.resolutionStatus === EffectStatus.NOT_APPLIED) {
      const evidence =
        await payloadReader.readManagedEffectReconciliationEvidence(
          reconciliation.evidenceRef,
        );
      try {
        verifyManagedEffectReconciliationEvidence(
          effectVerifierRegistry,
          effect,
          request,
          reconciliation.verifier,
          evidence,
          'persisted managed-effect reconciliation evidence',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'managed-effect reconciliation evidence is invalid',
        );
      }
    } else {
      if (
        !hasSameCanonicalJson(reconciliation.verifier, effect.verifier) ||
        !hasSameCanonicalJson(reconciliation.evidenceRef, effect.outcomeRef)
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'managed-effect reconciled outcome authority mismatch',
        );
      }
      const outcome = await payloadReader.readManagedEffectOutcome(
        reconciliation.evidenceRef,
      );
      try {
        verifyManagedEffectOutcome(
          effectVerifierRegistry,
          effect,
          request,
          outcome,
          'persisted reconciled managed-effect outcome',
        );
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'reconciled managed-effect outcome evidence is invalid',
        );
      }
      if (
        (reconciliation.resolutionStatus === EffectStatus.COMPLETED) !==
        (outcome.ok === true)
      ) {
        throw new ExecutionLedgerProjectionError(
          runId,
          'reconciled managed-effect outcome status mismatch',
        );
      }
    }
  } else if (event.type === 'uncertain-attempt-reconciled') {
    if (currentRun.trigger?.kind === 'effect-successor') {
      throw new ExecutionLedgerProjectionError(
        runId,
        'ordinary attempt reconciliation is not authorized for a successor',
      );
    }
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
      await assertManagedEffectSuccessorTerminal({
        run: currentRun,
        invocation: currentInvocation,
        terminal: verifiedEvidence.terminal,
        effects: state.effects,
        payloadReader,
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        runId,
        'invalid reconciled effect successor terminal',
      );
    }
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
    if (currentRun.trigger?.kind === 'effect-successor') {
      throw new ExecutionLedgerProjectionError(
        runId,
        'ordinary attempt lifecycle is not authorized for a successor',
      );
    }
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
        await assertManagedEffectSuccessorTerminal({
          run: currentRun,
          invocation: currentInvocation,
          terminal: verifiedEvidence.terminal,
          effects: state.effects,
          payloadReader,
        });
      } catch {
        throw new ExecutionLedgerProjectionError(
          runId,
          'invalid effect successor terminal',
        );
      }
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
          Object.prototype.hasOwnProperty.call(nextEffect, 'reconciliation')
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'stopped managed-effect settlement manufactured reconciliation',
          );
        }
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
    undefined,
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
    // A custom V10 table may deliberately retain older or lifecycle rows in the
    // same physical partition. Only the fresh V10 record namespace participates
    // in replay; no old history is accidentally treated as a malformed V10 run.
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
 * @returns {Promise<{head: Record<string, any>, run: Record<string, any>, workflowCursor?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, effects: Map<string, Record<string, any>>, events: Record<string, any>[]}|null>} - Verified current state, if the run exists.
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
  /** @type {Record<string, any> | undefined} */
  let workflowCursorProjection;
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
      case 'execution_ledger_workflow_cursor_projection': {
        if (workflowCursorProjection) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'duplicate workflow cursor projection',
          );
        }
        const cursor = normalizeWorkflowCursorSnapshot(record.data, runId);
        requireRecord(
          record,
          runId,
          getWorkflowCursorProjectionSortKey(),
          'execution_ledger_workflow_cursor_projection',
        );
        if (
          record.disposition !== cursor.disposition ||
          record.version !== cursor.version ||
          record.sequence !== cursor.lastSequence ||
          record.revision_id !== cursor.revisionId
        ) {
          throw new ExecutionLedgerProjectionError(
            runId,
            'workflow cursor projection index mismatch',
          );
        }
        workflowCursorProjection = cursor;
        break;
      }
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

  /** @type {{run?: Record<string, any>, workflowCursor?: Record<string, any>, invocations: Map<string, Record<string, any>>, attempts: Map<string, Record<string, any>>, effects: Map<string, Record<string, any>>, eventsBySequence: Map<number, Record<string, any>>, eventsById: Map<string, Record<string, any>>}} */
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
      snapshots.workflowCursor,
      snapshots.nextInvocation,
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
  if (
    state.run.trigger.kind === 'workflow'
      ? !state.workflowCursor ||
        !workflowCursorProjection ||
        !sameSnapshot(state.workflowCursor, workflowCursorProjection)
      : state.workflowCursor || workflowCursorProjection
  ) {
    throw new ExecutionLedgerProjectionError(
      runId,
      'workflow cursor projection disagrees',
    );
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
    ...(state.workflowCursor ? { workflowCursor: state.workflowCursor } : {}),
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
 * @returns {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, workflowCursor?: Record<string, any>, nextInvocation?: Record<string, any>, outputRef?: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[]}} - Public transition view.
 */
function transitionResult(
  state,
  attempt,
  receipt,
  applied,
  effect = undefined,
  effects = undefined,
) {
  const invocation =
    (typeof receipt.invocation_id === 'string'
      ? state.invocations.get(receipt.invocation_id)
      : state.workflowCursor
        ? state.invocations.get(state.workflowCursor.invocationId)
        : state.invocations.size === 1
          ? [...state.invocations.values()][0]
          : undefined) || undefined;
  if (!invocation) {
    throw new ExecutionLedgerProjectionError(
      state.run.runId,
      'transition result invocation is unavailable',
    );
  }
  /** @type {{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, workflowCursor?: Record<string, any>, nextInvocation?: Record<string, any>, outputRef?: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>, effects?: Record<string, any>[]}} */
  const result = {
    applied,
    receipt: cloneJsonObject(receipt, 'transition receipt'),
    run: cloneJsonObject(state.run, 'run result'),
    invocation: cloneJsonObject(invocation, 'invocation result'),
  };
  if (receipt.type.startsWith('workflow-activity-')) {
    const event = state.events[receipt.sequence - 1];
    if (!event || event.event_id !== receipt.event_id) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        'workflow transition result event is unavailable',
      );
    }
    const snapshots = eventSnapshots(event, state.run.runId);
    if (!snapshots.workflowCursor) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        'workflow transition result cursor is unavailable',
      );
    }
    result.workflowCursor = cloneJsonObject(
      snapshots.workflowCursor,
      'workflow cursor result',
    );
    if (snapshots.nextInvocation) {
      result.nextInvocation = cloneJsonObject(
        snapshots.nextInvocation,
        'workflow successor invocation result',
      );
    }
    const completedDecision =
      receipt.type === 'workflow-activity-succeeded' ||
      (receipt.type === 'workflow-activity-uncertainty-reconciled' &&
        snapshots.reconciliation?.terminal.type === 'completed');
    if (completedDecision) {
      const output = snapshots.workflowCursor.outputs.at(-1);
      if (!output) {
        throw new ExecutionLedgerProjectionError(
          state.run.runId,
          'workflow success result output is unavailable',
        );
      }
      result.outputRef = cloneJsonObject(
        output.outputRef,
        'workflow output reference result',
      );
    }
  }
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
    domain: 'wharfie:execution-ledger-transition:v10',
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
 * Normalize the exact orchestration coordinates a workflow mutation observed.
 * The run-head version and physical attempt fence remain separate authorities;
 * neither can stand in for this cursor guard.
 * @param {unknown} value - Candidate workflow cursor guard.
 * @param {string} label - Human-readable boundary label.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} - Strict cursor guard.
 */
function normalizeWorkflowCursorGuard(value, label) {
  const guard = cloneBoundedJsonObject(
    value,
    EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
    label,
  );
  assertExactKeys(
    guard,
    ['version', 'continuationId', 'stepId', 'stepIndex'],
    label,
  );
  return {
    version: assertPositiveSafeInteger(guard.version, `${label}.version`),
    continuationId: assertOpaqueId(
      guard.continuationId,
      `${label}.continuationId`,
    ),
    stepId: (() => {
      assertLogicalId(guard.stepId, `${label}.stepId`);
      return guard.stepId;
    })(),
    stepIndex: assertNonnegativeSafeInteger(
      guard.stepIndex,
      `${label}.stepIndex`,
    ),
  };
}

/**
 * @param {Record<string, any>} cursor - Persisted workflow cursor.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} - Public mutation guard.
 */
function workflowCursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
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
 * @param {Record<string, any>} record - Existing workflow cursor projection.
 * @returns {import('../base.js').KeyCondition[]} - Cursor stale-write fence.
 */
function workflowCursorReplacementConditions(record) {
  return [
    eq('record_type', record.record_type),
    eq('schema_version', record.schema_version),
    eq('disposition', record.disposition),
    eq('version', record.version),
    eq('sequence', record.sequence),
    eq('revision_id', record.revision_id),
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
 * Restrict workflow activity terminals to outcomes with implemented cursor
 * semantics. Workflow cancellation has no durable cursor-aware authority yet:
 * a transcript may be structurally valid after a host cancel frame, but it
 * cannot become workflow authority until a persisted cancellation decision
 * authorizes that frame.
 * @param {Record<string, any>} terminal - Verified Activity Protocol terminal.
 * @param {Record<string, any>} evidence - Fully verified attempt evidence.
 * @param {string} label - Human-readable boundary label.
 * @returns {void}
 */
function assertSupportedWorkflowActivityTerminal(terminal, evidence, label) {
  if (!SUPPORTED_WORKFLOW_ACTIVITY_TERMINAL_TYPES.has(terminal.type)) {
    throw new TypeError(
      `${label}.terminal.type '${terminal.type}' requires a durable workflow decision that is not implemented.`,
    );
  }
  if (
    evidence.frames.some(
      (/** @type {Record<string, any>} */ frame) => frame.type === 'cancel',
    )
  ) {
    throw new TypeError(
      `${label} contains a host cancel frame, but workflow cancellation authority is not implemented.`,
    );
  }
}

/**
 * @param {Record<string, any>} run - Current run projection.
 * @param {Record<string, any>} invocation - Current invocation projection.
 * @param {Record<string, any>} attempt - Current attempt projection.
 * @param {{readActivityRequest: (reference: unknown) => Promise<Record<string, any>>}} payloadReader - Verified immutable payload reader.
 * @returns {Promise<Readonly<Record<string, any>>>} - Exact host start frame bound by the ledger.
 */
async function createLedgerAttemptStart(
  run,
  invocation,
  attempt,
  payloadReader,
) {
  const request = await payloadReader.readActivityRequest(
    invocation.requestRef,
  );
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
      if (
        [EffectStatus.CANCELLED, EffectStatus.NOT_APPLIED].includes(
          effect.status,
        )
      ) {
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
 * A successor authorization is authority for exactly one retained logical
 * effect. Prove that an effect-request transition is that plan before either
 * accepting a write or folding retained history.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, effect: Record<string, any>, request: Record<string, any>, priorEffects: Record<string, any>[]}} input - Candidate successor request boundary.
 * @returns {void}
 */
function assertManagedEffectSuccessorPlannedRequest(input) {
  if (input.run.trigger?.kind !== 'effect-successor') return;
  const authorization = normalizeManagedEffectSuccessorAuthorization(
    input.run.trigger,
  );
  if (
    input.invocation.invocationId !== authorization.target.invocationId ||
    input.invocation.activityId !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID ||
    input.priorEffects.some(
      (effect) => effect.invocationId === input.invocation.invocationId,
    ) ||
    input.effect.effectId !== authorization.target.effectId ||
    input.effect.destinationEffectId !==
      authorization.target.destinationEffectId ||
    createManagedEffectSuccessorRequestDigest(input.request) !==
      authorization.target.requestDigest ||
    !hasSameCanonicalJson(
      input.effect.adapter,
      authorization.contract.adapter,
    ) ||
    !hasSameCanonicalJson(
      input.effect.destination,
      authorization.contract.destination,
    ) ||
    !hasSameCanonicalJson(
      input.effect.verifier,
      authorization.contract.verifier,
    ) ||
    !hasSameCanonicalJson(
      input.effect.substantiatedReplayProperties,
      authorization.contract.substantiatedReplayProperties,
    )
  ) {
    throw new TypeError(
      'effect-successor request must match its sole authorized effect plan.',
    );
  }
}

/**
 * A normally completed or failed successor attempt must have executed the
 * exact sole effect authorized by its trigger. This prevents a low-level
 * caller from terminalizing an empty or alternate-effect successor run.
 * @param {{run: Record<string, any>, invocation: Record<string, any>, terminal: Record<string, any>, effects: Map<string, Record<string, any>>, payloadReader: ReturnType<typeof createLedgerPayloadReader>}} input - Candidate terminal boundary.
 * @returns {Promise<void>}
 */
async function assertManagedEffectSuccessorTerminal(input) {
  if (input.run.trigger?.kind !== 'effect-successor') return;
  const authorization = normalizeManagedEffectSuccessorAuthorization(
    input.run.trigger,
  );
  const effects = [...input.effects.values()].filter(
    (effect) => effect.invocationId === input.invocation.invocationId,
  );
  if (
    input.invocation.invocationId !== authorization.target.invocationId ||
    input.invocation.activityId !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID ||
    effects.length !== 1 ||
    effects[0].effectId !== authorization.target.effectId ||
    effects[0].destinationEffectId !== authorization.target.destinationEffectId
  ) {
    throw new TypeError(
      'effect-successor terminal requires its exact sole authorized effect.',
    );
  }
  const [effect] = effects;
  if (input.terminal.type === 'completed') {
    if (effect.status !== EffectStatus.COMPLETED || !effect.outcomeRef) {
      throw new TypeError(
        'completed effect-successor terminal requires a completed authorized effect.',
      );
    }
    const outcome = await input.payloadReader.readManagedEffectOutcome(
      effect.outcomeRef,
    );
    if (
      outcome.ok !== true ||
      !hasSameCanonicalJson(input.terminal.result, outcome.result)
    ) {
      throw new TypeError(
        'completed effect-successor terminal must return the authorized effect result.',
      );
    }
  } else if (
    input.terminal.type === 'failed' &&
    effect.status !== EffectStatus.FAILED
  ) {
    throw new TypeError(
      'failed effect-successor terminal requires a failed authorized effect.',
    );
  } else if (
    input.terminal.type === 'cancelled' &&
    effect.status !== EffectStatus.CANCELLED
  ) {
    throw new TypeError(
      'cancelled effect-successor terminal requires a cancelled authorized effect.',
    );
  }
}

/**
 * Construct the framework-owned transcript for the one-effect successor
 * activity. Unlike an authored activity, this executor has no application
 * frames to preserve: its complete protocol is the retained start, its one
 * authorized request, the verifier-backed outcome, and the matching terminal.
 * Building and revalidating it here keeps normal attempt evidence invariants
 * without reopening the generic activity runner.
 * @param {{start: Readonly<Record<string, any>>, attempt: Record<string, any>, effect: Record<string, any>, request: Record<string, any>, outcome: Record<string, any>}} input - Exact retained successor delivery and verified outcome.
 * @returns {{terminal: Readonly<Record<string, any>>, evidence: Record<string, any>}} - Strict canonical terminal transcript.
 */
function createManagedEffectSuccessorTerminalEvidence(input) {
  const requestFrame = validateActivityProtocolComponentFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'effect-request',
      attemptId: input.attempt.attemptId,
      sequence: input.effect.requestedBy.protocolSequence,
      effectId: input.effect.effectId,
      capability: input.request.capability,
      operation: input.request.operation,
      input: input.request.input,
      requestedReplayProperties: input.request.requestedReplayProperties,
    },
    'effect successor terminal effect request',
  );
  const resultFrame = validateActivityProtocolHostFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: 'effect-result',
      attemptId: input.attempt.attemptId,
      effectId: input.effect.effectId,
      ok: input.outcome.ok,
      ...(input.outcome.ok
        ? { result: input.outcome.result }
        : { error: input.outcome.error }),
      substantiatedReplayProperties:
        input.outcome.substantiatedReplayProperties,
      evidence: input.outcome.evidence,
    },
    'effect successor terminal effect result',
  );
  const terminal = validateActivityProtocolComponentFrame(
    {
      protocol: ACTIVITY_PROTOCOL_NAME,
      protocolVersion: ACTIVITY_PROTOCOL_VERSION,
      type: input.outcome.ok ? 'completed' : 'failed',
      attemptId: input.attempt.attemptId,
      sequence: input.effect.requestedBy.protocolSequence + 1,
      ...(input.outcome.ok
        ? { result: input.outcome.result }
        : { error: input.outcome.error }),
    },
    'effect successor terminal frame',
  );
  const transcript = new ActivityProtocolTranscriptValidator();
  transcript.acceptHostFrame(input.start);
  transcript.acceptComponentFrame(requestFrame);
  transcript.acceptHostFrame(resultFrame);
  transcript.acceptComponentFrame(terminal);
  return validateLedgerAttemptEvidence(
    {
      status: terminal.type,
      start: input.start,
      terminal,
      frames: [input.start, requestFrame, resultFrame, terminal],
      transcript: transcript.snapshot(),
    },
    input.start,
    'effect successor terminal evidence',
  );
}

/**
 * @param {string} runId - Durable run identity.
 * @param {string} invocationId - Durable invocation identity.
 * @param {number} generation - Attempt generation scoped to the invocation.
 * @returns {string} - Globally scoped deterministic physical-attempt identity.
 */
function createAttemptId(runId, invocationId, generation) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-attempt:v10',
    prefix: 'wla',
    value: { runId, invocationId, generation },
    valuePath: 'execution ledger attempt identity',
  });
}

/**
 * Create a provider-neutral append-only execution ledger over one transactional
 * DB table. It intentionally does not provide leases, scheduling, or a general
 * workflow engine; it admits activity-headed workflows and atomically advances
 * completed activities only to another activity or terminal state.
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
  async function readFoldedRun(runId) {
    return await foldAndVerifyRun(
      await readRunRecords(db, resolvedTableName, runId),
      runId,
      payloadStore,
      effectVerifierRegistry,
    );
  }

  /**
   * Verify the bounded cross-partition records created by one atomic successor
   * handoff. Base folds intentionally do not recurse, so both source and target
   * reads can validate their immediate edge without walking an ancestry chain.
   * @param {Record<string, any>} state - Locally folded run state.
   * @returns {Promise<void>}
   */
  async function verifyManagedEffectSuccessorLinks(state) {
    /** @type {Record<string, any>[]} */
    const authorizations = [];
    if (state.run.trigger?.kind === 'effect-successor') {
      authorizations.push(
        normalizeManagedEffectSuccessorAuthorization(state.run.trigger),
      );
    }
    for (const event of state.events) {
      if (event.type === 'effect-successor-authorized') {
        authorizations.push(
          normalizeManagedEffectSuccessorAuthorization(
            event.payload.authorization,
          ),
        );
      }
    }
    for (const authorization of authorizations) {
      const identity = await readSuccessorIdentityRecord(
        db,
        resolvedTableName,
        state.run.appId,
        authorization.successorId,
      );
      const expectedIdentity = createSuccessorIdentityRecord(
        state.run.appId,
        authorization,
      );
      if (!identity || !hasSameCanonicalJson(identity, expectedIdentity)) {
        throw new ExecutionLedgerProjectionError(
          state.run.runId,
          'successor atomic identity link is unavailable',
        );
      }

      const source =
        state.run.runId === authorization.source.runId
          ? state
          : await readFoldedRun(authorization.source.runId);
      const target =
        state.run.runId === authorization.target.runId
          ? state
          : await readFoldedRun(authorization.target.runId);
      const sourceEvent = source?.events.find(
        (/** @type {Record<string, any>} */ event) =>
          event.type === 'effect-successor-authorized' &&
          hasSameCanonicalJson(event.payload.authorization, authorization),
      );
      const targetEvent = target?.events[0];
      if (
        !source ||
        !target ||
        source.run.appId !== state.run.appId ||
        target.run.appId !== state.run.appId ||
        target.run.revisionId !== authorization.target.revisionId ||
        !sourceEvent ||
        targetEvent?.type !== 'effect-successor-run-created' ||
        !hasSameCanonicalJson(
          targetEvent.payload.authorization,
          authorization,
        ) ||
        !hasSameCanonicalJson(target.run.trigger, authorization)
      ) {
        throw new ExecutionLedgerProjectionError(
          state.run.runId,
          'successor atomic source-target link is unavailable',
        );
      }
    }
  }

  /**
   * @param {string} runId - Run identity.
   * @returns {Promise<ReturnType<typeof foldAndVerifyRun>>} - Fully verified run state.
   */
  async function readVerifiedRun(runId) {
    const state = await readFoldedRun(runId);
    if (state) await verifyManagedEffectSuccessorLinks(state);
    return state;
  }

  /**
   * Keep the established single-activity transitions fail-closed. Workflow and
   * successor runs have cursor-aware finite state machines; permitting an old
   * generic entry point would advance or terminalize them without consuming
   * their durable orchestration position.
   * @param {Record<string, any>} state - Fresh verified durable state.
   * @param {string} operation - Calling mutation name for diagnostics.
   * @returns {void}
   */
  function assertManualLifecycleRun(state, operation) {
    if (state.run.trigger?.kind !== 'manual') {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} is authorized only for a manual activity run`,
      );
    }
  }

  /**
   * Resolve one exact workflow activity from both the persisted cursor and the
   * immutable invocation binding. Cursorless or stale callers cannot enter a
   * physical attempt transition even when they hold a current run version.
   * @param {Record<string, any>} state - Fresh verified durable state.
   * @param {string} invocationId - Expected active invocation.
   * @param {{version: number, continuationId: string, stepId: string, stepIndex: number}} guard - Exact caller-observed cursor.
   * @param {string} operation - Calling mutation name for diagnostics.
   * @returns {{cursor: Record<string, any>, invocation: Record<string, any>}} - Exact active workflow authority.
   */
  function getWorkflowActivityAuthority(state, invocationId, guard, operation) {
    if (state.run.trigger?.kind !== 'workflow' || !state.workflowCursor) {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} requires a workflow activity run`,
      );
    }
    const cursor = state.workflowCursor;
    const invocation = state.invocations.get(invocationId);
    if (
      !invocation ||
      state.run.status !== RunStatus.RUNNING ||
      cursor.invocationId !== invocationId ||
      !hasSameCanonicalJson(workflowCursorGuard(cursor), guard) ||
      !invocation.workflow ||
      !hasSameCanonicalJson(invocation.workflow, {
        workflowId: cursor.workflowId,
        planId: cursor.planId,
        continuationId: cursor.continuationId,
        stepId: cursor.stepId,
        stepIndex: cursor.stepIndex,
      })
    ) {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} cursor is not the current workflow activity`,
      );
    }
    return { cursor, invocation };
  }

  /**
   * Resolve the exact blocked workflow activation that may be reconciled from
   * independent evidence. This authority is deliberately separate from the
   * runnable/running path so an uncertain cursor can never authorize another
   * physical dispatch.
   * @param {Record<string, any>} state - Fresh verified durable state.
   * @param {string} invocationId - Expected uncertain invocation.
   * @param {{version: number, continuationId: string, stepId: string, stepIndex: number}} guard - Exact caller-observed cursor.
   * @param {string} operation - Calling mutation name for diagnostics.
   * @returns {{cursor: Record<string, any>, invocation: Record<string, any>}} - Exact uncertain workflow authority.
   */
  function getUncertainWorkflowActivityAuthority(
    state,
    invocationId,
    guard,
    operation,
  ) {
    if (state.run.trigger?.kind !== 'workflow' || !state.workflowCursor) {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} requires a workflow activity run`,
      );
    }
    const cursor = state.workflowCursor;
    const invocation = state.invocations.get(invocationId);
    if (
      !invocation ||
      state.run.status !== RunStatus.BLOCKED ||
      cursor.disposition !== WorkflowCursorDisposition.ACTIVITY_UNCERTAIN ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      cursor.invocationId !== invocationId ||
      !hasSameCanonicalJson(workflowCursorGuard(cursor), guard) ||
      !invocation.workflow ||
      !hasSameCanonicalJson(invocation.workflow, {
        workflowId: cursor.workflowId,
        planId: cursor.planId,
        continuationId: cursor.continuationId,
        stepId: cursor.stepId,
        stepIndex: cursor.stepIndex,
      })
    ) {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} cursor is not the retained uncertain workflow activity`,
      );
    }
    return { cursor, invocation };
  }

  /**
   * Workflow activity lifecycle currently supports only attempts with no
   * logical managed effects. Effect settlement has independent authority;
   * silently combining the two would make a terminal transcript ambiguous.
   * @param {Record<string, any>} state - Fresh verified durable state.
   * @param {Record<string, any>} attempt - Exact physical attempt.
   * @param {string} operation - Calling mutation name for diagnostics.
   * @returns {void}
   */
  function assertWorkflowActivityHasNoManagedEffects(
    state,
    attempt,
    operation,
  ) {
    if (
      [...state.effects.values()].some(
        (effect) =>
          effect.invocationId === attempt.invocationId &&
          effect.requestedBy.attemptId === attempt.attemptId,
      )
    ) {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} does not support workflow activities with managed effects`,
      );
    }
  }

  /**
   * Rehash and rederive the exact activity request selected by a workflow
   * cursor. This runs before every physical lifecycle mutation, not only when
   * the invocation was first materialized.
   * @param {Record<string, any>} state - Fresh verified workflow state.
   * @param {Record<string, any>} cursor - Exact current workflow cursor.
   * @param {Record<string, any>} invocation - Cursor-bound invocation.
   * @param {string} operation - Calling mutation name.
   * @returns {Promise<{planPayload: Record<string, any>, startPayload: Record<string, any>, outputs: Array<{binding: Record<string, any>, payload: Record<string, any>}>, step: Record<string, any>, materialized: Record<string, any>, payloadReader: ReturnType<typeof createLedgerPayloadReader>}>} - Verified current activity materialization.
   */
  async function verifyWorkflowCursorActivity(
    state,
    cursor,
    invocation,
    operation,
  ) {
    const payloadReader = createLedgerPayloadReader(
      payloadStore,
      state.run.runId,
    );
    const planPayload = await payloadReader.readWorkflowPlan(cursor.planRef);
    const startPayload = await payloadReader.readWorkflowStart(cursor.startRef);
    const outputs = await readWorkflowCursorOutputs(cursor, payloadReader);
    const step = planPayload.definition.steps[cursor.stepIndex];
    if (!step || step.kind !== 'activity') {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        `${operation} cursor does not select an activity`,
      );
    }
    let selectedOutput;
    try {
      selectedOutput = selectWorkflowStepOutput(step, outputs, operation);
    } catch {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        `${operation} selected output is unavailable`,
      );
    }
    let materialized;
    try {
      materialized = materializeWorkflowCursorActivity({
        cursor,
        planPayload,
        planRef: cursor.planRef,
        startPayload,
        startRef: cursor.startRef,
        ...(selectedOutput ? { selectedOutput } : {}),
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        `${operation} activity materialization mismatch`,
      );
    }
    const request = normalizeWorkflowActivityRequest(
      await payloadReader.readActivityRequest(invocation.requestRef),
      `${operation} persisted activity request`,
    );
    if (
      planPayload.appId !== state.run.appId ||
      planPayload.revisionId !== state.run.revisionId ||
      planPayload.workflowId !== state.run.trigger.workflowId ||
      materialized.activityId !== invocation.activityId ||
      materialized.invocationId !== invocation.invocationId ||
      materialized.continuationId !== cursor.continuationId ||
      !hasSameCanonicalJson(materialized.activityRequest, request)
    ) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        `${operation} invocation does not match its workflow cursor`,
      );
    }
    return {
      planPayload,
      startPayload,
      outputs,
      step,
      materialized,
      payloadReader,
    };
  }

  /**
   * Keep physical dispatch behind the continuation shapes this tranche can
   * commit atomically. A worker must not begin user code if success would stop
   * at an unimplemented timer or signal boundary.
   * @param {Record<string, any>} state - Verified workflow state.
   * @param {Record<string, any>} cursor - Current activity cursor.
   * @param {Record<string, any>} planPayload - Rehashed immutable plan.
   * @param {string} operation - Calling mutation name.
   * @returns {void}
   */
  function assertWorkflowActivityDispatchSupported(
    state,
    cursor,
    planPayload,
    operation,
  ) {
    if (!isWorkflowActivityDispatchSupported(cursor, planPayload)) {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        `${operation} cannot dispatch an activity whose continuation is not implemented`,
      );
    }
  }

  /**
   * Resolve the only invocation a framework-owned successor may contain.
   * @param {Record<string, any>} state - Fresh verified durable state.
   * @returns {{authorization: Record<string, any>, invocation: Record<string, any>}} - Exact target authority and invocation.
   */
  function getManagedEffectSuccessorInvocation(state) {
    if (state.run.trigger?.kind !== 'effect-successor') {
      throw new ExecutionLedgerConflictError(
        state.run.runId,
        'run is not a managed-effect successor',
      );
    }
    const authorization = normalizeManagedEffectSuccessorAuthorization(
      state.run.trigger,
    );
    const invocation = state.invocations.get(authorization.target.invocationId);
    if (
      !invocation ||
      invocation.activityId !== MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID ||
      invocation.runId !== authorization.target.runId
    ) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        'managed-effect successor target invocation is unavailable',
      );
    }
    return { authorization, invocation };
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
   * Locate the one physical attempt that keeps a RUNNING invocation
   * discoverable after a coordinator process dies. The ready-work projection
   * never creates authority; it names this already-folded attempt so a new
   * resident can enter the ordinary conservative recovery transition.
   * @param {Record<string, any> | null} state - Verified current fold.
   * @param {Record<string, any>} invocation - Exact invocation projection.
   * @returns {Record<string, any> | undefined} - Current recoverable attempt.
   */
  function getReadyWorkAttempt(state, invocation) {
    if (!state || invocation.status !== InvocationStatus.RUNNING) {
      return undefined;
    }
    const candidates = [...state.attempts.values()].filter(
      (candidate) =>
        candidate.invocationId === invocation.invocationId &&
        candidate.generation === invocation.generation &&
        [AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(
          candidate.status,
        ),
    );
    if (candidates.length !== 1) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        'running invocation lacks one ready-work attempt',
      );
    }
    return candidates[0];
  }

  /**
   * Derive the locator row implied by one authoritative lifecycle snapshot.
   * Manual work has no cursor coordinates; workflow activity work is bound to
   * the exact persisted continuation that selected its logical request.
   * @param {Record<string, any>} run - Run snapshot.
   * @param {Record<string, any>} invocation - Current invocation snapshot.
   * @param {Record<string, any> | undefined} attempt - Current physical attempt.
   * @param {Record<string, any> | undefined} workflowCursor - Current workflow cursor.
   * @returns {Record<string, any> | undefined} - Canonical storage row.
   */
  function createLifecycleReadyWorkRecord(
    run,
    invocation,
    attempt,
    workflowCursor = undefined,
  ) {
    if (
      !['manual', 'workflow'].includes(run.trigger?.kind) ||
      run.status !== RunStatus.RUNNING
    ) {
      return undefined;
    }
    if (
      invocation.runId !== run.runId ||
      invocation.appId !== run.appId ||
      invocation.revisionId !== run.revisionId
    ) {
      throw new ExecutionLedgerProjectionError(
        run.runId,
        'ready-work invocation scope mismatch',
      );
    }
    const isWorkflow = run.trigger.kind === 'workflow';
    const expectedWorkflowDisposition =
      invocation.status === InvocationStatus.RUNNABLE
        ? WorkflowCursorDisposition.ACTIVITY_RUNNABLE
        : invocation.status === InvocationStatus.RUNNING
          ? WorkflowCursorDisposition.ACTIVITY_RUNNING
          : undefined;
    if (
      isWorkflow
        ? !workflowCursor ||
          workflowCursor.runId !== run.runId ||
          workflowCursor.appId !== run.appId ||
          workflowCursor.revisionId !== run.revisionId ||
          workflowCursor.workflowId !== run.trigger.workflowId ||
          workflowCursor.planId !== run.trigger.planId ||
          workflowCursor.invocationId !== invocation.invocationId ||
          !expectedWorkflowDisposition ||
          workflowCursor.disposition !== expectedWorkflowDisposition ||
          !invocation.workflow ||
          !hasSameCanonicalJson(invocation.workflow, {
            workflowId: workflowCursor.workflowId,
            planId: workflowCursor.planId,
            continuationId: workflowCursor.continuationId,
            stepId: workflowCursor.stepId,
            stepIndex: workflowCursor.stepIndex,
          })
        : workflowCursor || invocation.workflow
    ) {
      throw new ExecutionLedgerProjectionError(
        run.runId,
        'ready-work workflow cursor mismatch',
      );
    }
    const common = {
      appId: run.appId,
      revisionId: run.revisionId,
      runId: run.runId,
      runVersion: run.version,
      lastSequence: run.lastSequence,
    };
    if (invocation.status === InvocationStatus.RUNNABLE) {
      return createExecutionLedgerReadyWorkRecord({
        ...common,
        kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
        availableAt: invocation.updatedAt,
        invocationId: invocation.invocationId,
        generation: invocation.generation,
        ...(workflowCursor
          ? {
              cursorVersion: workflowCursor.version,
              continuationId: workflowCursor.continuationId,
              stepId: workflowCursor.stepId,
              stepIndex: workflowCursor.stepIndex,
            }
          : {}),
      });
    }
    if (invocation.status !== InvocationStatus.RUNNING) return undefined;
    if (
      !attempt ||
      attempt.invocationId !== invocation.invocationId ||
      attempt.generation !== invocation.generation ||
      ![AttemptStatus.CLAIMED, AttemptStatus.STARTED].includes(attempt.status)
    ) {
      throw new ExecutionLedgerProjectionError(
        run.runId,
        'ready-work recovery attempt mismatch',
      );
    }
    return createExecutionLedgerReadyWorkRecord({
      ...common,
      kind: ExecutionLedgerReadyWorkKind.RECOVERY,
      availableAt: attempt.updatedAt,
      invocationId: invocation.invocationId,
      attemptId: attempt.attemptId,
      generation: attempt.generation,
      ...(workflowCursor
        ? {
            cursorVersion: workflowCursor.version,
            continuationId: workflowCursor.continuationId,
            stepId: workflowCursor.stepId,
            stepIndex: workflowCursor.stepIndex,
          }
        : {}),
    });
  }

  /**
   * Match the exact prior locator before replacing or deleting it. Conditions
   * deliberately cover both lifecycle coordinates and storage scope so a
   * forged or stale row makes the authoritative transition fail closed.
   * @param {Record<string, any>} record - Prior canonical ready-work row.
   * @returns {import('../base.js').KeyCondition[]} - Replacement conditions.
   */
  function readyWorkReplacementConditions(record) {
    return Object.entries(record)
      .filter(([property]) => ![KEY_NAME, SORT_KEY_NAME].includes(property))
      .map(([property, value]) => eq(property, value));
  }

  /**
   * Atomically append exactly one event, its receipt, the next run head, and
   * the affected projections, including the current ready-work locator. The
   * caller supplies already-folded snapshots so the event remains sufficient
   * to reconstruct every authoritative projection.
   * @param {{state: Record<string, any> | null, runId: string, transitionId: string, requestDigest: string, event: Record<string, any>, nextRun: Record<string, any>, nextInvocation: Record<string, any>, nextAdditionalInvocation?: Record<string, any>, nextWorkflowCursor?: Record<string, any>, nextAttempt?: Record<string, any>, currentAttempt?: Record<string, any>, nextEffect?: Record<string, any>, currentEffect?: Record<string, any>, effectTransitions?: Array<{currentEffect?: Record<string, any>, nextEffect: Record<string, any>}>}} input - Fully validated transition.
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
    const receiptRecord = createTransitionRecord(
      input.runId,
      input.transitionId,
      input.requestDigest,
      eventRecord,
    );
    const currentWorkflowCursor = input.state?.workflowCursor;
    const nextWorkflowCursor = input.nextWorkflowCursor;
    if (
      input.nextRun.trigger?.kind === 'workflow'
        ? !nextWorkflowCursor
        : Boolean(currentWorkflowCursor || nextWorkflowCursor)
    ) {
      throw new ExecutionLedgerProjectionError(
        input.runId,
        'transition workflow cursor presence mismatch',
      );
    }
    const currentInvocation = input.state
      ? input.state.invocations.get(input.nextInvocation.invocationId)
      : undefined;
    if (input.state && !currentInvocation) {
      throw new ExecutionLedgerProjectionError(
        input.runId,
        'transition invocation missing',
      );
    }
    const nextAdditionalInvocation = input.nextAdditionalInvocation;
    if (
      nextAdditionalInvocation &&
      (!input.state ||
        nextAdditionalInvocation.invocationId ===
          input.nextInvocation.invocationId ||
        input.state.invocations.has(nextAdditionalInvocation.invocationId))
    ) {
      throw new ExecutionLedgerProjectionError(
        input.runId,
        'additional transition invocation conflicts with retained state',
      );
    }
    const persistedInvocation = /** @type {Record<string, any>} */ (
      currentInvocation
    );
    const currentReadyWork = input.state
      ? createLifecycleReadyWorkRecord(
          input.state.run,
          persistedInvocation,
          getReadyWorkAttempt(input.state, persistedInvocation),
          currentWorkflowCursor,
        )
      : undefined;
    const nextReadyInvocation =
      nextAdditionalInvocation || input.nextInvocation;
    const nextReadyAttempt =
      nextReadyInvocation.status === InvocationStatus.RUNNING
        ? nextReadyInvocation.invocationId === input.nextInvocation.invocationId
          ? input.nextAttempt ||
            (input.state
              ? getReadyWorkAttempt(input.state, persistedInvocation)
              : undefined)
          : undefined
        : undefined;
    const nextReadyWork = createLifecycleReadyWorkRecord(
      input.nextRun,
      nextReadyInvocation,
      nextReadyAttempt,
      nextWorkflowCursor,
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
    ];
    const invocationRecord = createInvocationProjectionRecord(
      input.runId,
      input.nextInvocation,
    );
    putRequests.push({
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: invocationRecord,
      conditions: input.state
        ? replacementConditions(
            createInvocationProjectionRecord(input.runId, persistedInvocation),
            [eq('generation', persistedInvocation.generation)],
          )
        : [notExists(SORT_KEY_NAME)],
    });
    if (nextAdditionalInvocation) {
      putRequests.push({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: createInvocationProjectionRecord(
          input.runId,
          nextAdditionalInvocation,
        ),
        conditions: [notExists(SORT_KEY_NAME)],
      });
    }
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

    /** @type {import('../base.js').TransactionDeleteRequest[]} */
    const deleteRequests = [];
    if (nextWorkflowCursor) {
      const cursorRecord = createWorkflowCursorProjectionRecord(
        input.runId,
        nextWorkflowCursor,
      );
      putRequests.push({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: cursorRecord,
        conditions: currentWorkflowCursor
          ? workflowCursorReplacementConditions(
              createWorkflowCursorProjectionRecord(
                input.runId,
                currentWorkflowCursor,
              ),
            )
          : [notExists(SORT_KEY_NAME)],
      });
    } else if (currentWorkflowCursor) {
      const currentCursorRecord = createWorkflowCursorProjectionRecord(
        input.runId,
        currentWorkflowCursor,
      );
      deleteRequests.push({
        keyName: KEY_NAME,
        keyValue: input.runId,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: currentCursorRecord[SORT_KEY_NAME],
        conditions: workflowCursorReplacementConditions(currentCursorRecord),
      });
    }
    if (currentReadyWork && nextReadyWork) {
      const sameReadyWorkKey =
        currentReadyWork[KEY_NAME] === nextReadyWork[KEY_NAME] &&
        currentReadyWork[SORT_KEY_NAME] === nextReadyWork[SORT_KEY_NAME];
      if (sameReadyWorkKey) {
        putRequests.push({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record: nextReadyWork,
          conditions: readyWorkReplacementConditions(currentReadyWork),
        });
      } else {
        deleteRequests.push({
          keyName: KEY_NAME,
          keyValue: currentReadyWork[KEY_NAME],
          sortKeyName: SORT_KEY_NAME,
          sortKeyValue: currentReadyWork[SORT_KEY_NAME],
          conditions: readyWorkReplacementConditions(currentReadyWork),
        });
        putRequests.push({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record: nextReadyWork,
          conditions: [notExists(SORT_KEY_NAME)],
        });
      }
    } else if (nextReadyWork) {
      putRequests.push({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: nextReadyWork,
        conditions: [notExists(SORT_KEY_NAME)],
      });
    } else if (currentReadyWork) {
      deleteRequests.push({
        keyName: KEY_NAME,
        keyValue: currentReadyWork[KEY_NAME],
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: currentReadyWork[SORT_KEY_NAME],
        conditions: readyWorkReplacementConditions(currentReadyWork),
      });
    }

    await db.transactionWrite({
      tableName: resolvedTableName,
      putRequests,
      ...(deleteRequests.length === 0 ? {} : { deleteRequests }),
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
   * @param {{readActivityRequest: (reference: unknown) => Promise<Record<string, any>>}} payloadReader - Verified immutable payload reader.
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
      const persisted = await payloadReader.readActivityRequest(
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
    if (activityId === MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID) {
      throw new TypeError(
        'createManualRun cannot use the reserved managed-effect successor activity ID.',
      );
    }
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
    const trigger = normalizeRunTrigger(value.trigger);
    if (trigger.kind !== 'manual') {
      throw new TypeError(
        'createManualRun accepts only a manual trigger; effect successors require atomic authorization.',
      );
    }
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
    const manualTrigger = /** @type {{kind: 'manual'}} */ (trigger);
    const requested = {
      appId,
      revisionId,
      activityId,
      input,
      callerMetadata,
      trigger: manualTrigger,
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
      try {
        await repairReadyWork({ appId, revisionId, runId });
      } catch (error) {
        if (!(error instanceof ExecutionLedgerConflictError)) throw error;
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
      payloadSchema: ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
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
      try {
        await repairReadyWork({ appId, revisionId, runId });
      } catch (error) {
        if (!(error instanceof ExecutionLedgerConflictError)) throw error;
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
   * @param {Record<string, any>} state - Verified workflow state.
   * @param {{planPayload: Record<string, any>, startPayload: Record<string, any>, actor: {kind: string, id: string}}} requested - Exact requested immutable work.
   * @returns {Promise<{run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>} | undefined>} - Immutable creation snapshots, if the run is an exact duplicate.
   */
  async function getMatchingWorkflowCreation(state, requested) {
    const creationEvent = state.events[0];
    if (
      state.run.trigger?.kind !== 'workflow' ||
      creationEvent?.type !== 'workflow-run-created' ||
      !hasSameCanonicalJson(creationEvent.actor, requested.actor)
    ) {
      return undefined;
    }
    const creation = eventSnapshots(creationEvent, state.run.runId);
    if (!creation.workflowCursor) return undefined;
    const payloadReader = createLedgerPayloadReader(
      payloadStore,
      state.run.runId,
    );
    const persistedPlan = await payloadReader.readWorkflowPlan(
      creation.run.trigger.planRef,
    );
    const persistedStart = await payloadReader.readWorkflowStart(
      creation.run.requestRef,
    );
    return hasSameCanonicalJson(persistedPlan, requested.planPayload) &&
      hasSameCanonicalJson(persistedStart, requested.startPayload)
      ? {
          run: creation.run,
          workflowCursor: creation.workflowCursor,
          invocation: creation.invocation,
        }
      : undefined;
  }

  /**
   * @param {{runId: string, invocationId: string, transitionId: string, actor: {kind: string, id: string}, appId: string, revisionId: string, workflowId: string, planId: string, planRef: Record<string, any>, startRef: Record<string, any>, activityRequestRef: Record<string, any>, trigger: Record<string, any>}} input - Exact workflow creation authority.
   * @returns {string} - Canonical transition request digest.
   */
  function createWorkflowRunRequestDigest(input) {
    return createTransitionRequestDigest('workflow-run-created', {
      runId: input.runId,
      invocationId: input.invocationId,
      transitionId: input.transitionId,
      actor: input.actor,
      coordinatorEpoch: 0,
      appId: input.appId,
      revisionId: input.revisionId,
      workflowId: input.workflowId,
      planId: input.planId,
      planRef: input.planRef,
      startRef: input.startRef,
      activityRequestRef: input.activityRequestRef,
      trigger: input.trigger,
    });
  }

  /**
   * @param {Record<string, any>} state - Verified workflow state.
   * @param {Record<string, any> | null} receipt - Optional creation receipt.
   * @param {boolean} applied - Whether this call won creation.
   * @returns {{applied: boolean, receipt?: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>}} - Public workflow creation result.
   */
  function workflowCreationResult(state, receipt, applied) {
    const cursor = state.workflowCursor;
    const invocation = cursor
      ? state.invocations.get(cursor.invocationId)
      : undefined;
    if (!cursor || !invocation) {
      throw new ExecutionLedgerProjectionError(
        state.run.runId,
        'workflow creation state is incomplete',
      );
    }
    return {
      applied,
      ...(receipt
        ? { receipt: cloneJsonObject(receipt, 'workflow creation receipt') }
        : {}),
      run: cloneJsonObject(state.run, 'workflow run result'),
      workflowCursor: cloneJsonObject(cursor, 'workflow cursor result'),
      invocation: cloneJsonObject(invocation, 'workflow invocation result'),
    };
  }

  /**
   * Create the first persisted continuation of one static workflow. This
   * tranche intentionally accepts only activity-headed definitions; timer and
   * signal starts remain closed until their own durable projections and race
   * semantics exist.
   * @param {{runId: string, appId: string, revisionId: string, workflowId: string, definition: Record<string, any>, input?: any, callerMetadata?: Record<string, any>, transitionId: string, actor?: {kind: string, id: string}, observedAt?: number}} options - Immutable workflow start.
   * @returns {Promise<{applied: boolean, receipt?: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>}>} - Created or exactly deduplicated workflow.
   */
  async function createWorkflowRun(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'createWorkflowRun',
    );
    assertSupportedKeys(
      value,
      [
        'runId',
        'appId',
        'revisionId',
        'workflowId',
        'definition',
        'input',
        'callerMetadata',
        'transitionId',
        'actor',
        'observedAt',
      ],
      'createWorkflowRun',
    );
    const runId = value.runId;
    assertWorkflowRunId(runId, 'createWorkflowRun.runId');
    const appId = value.appId;
    assertLogicalId(appId, 'createWorkflowRun.appId');
    const revisionId = value.revisionId;
    assertApplicationRevisionId(revisionId, 'createWorkflowRun.revisionId');
    const workflowId = value.workflowId;
    assertLogicalId(workflowId, 'createWorkflowRun.workflowId');
    const planPayload = normalizeWorkflowPlanPayload(
      {
        schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
        kind: WORKFLOW_PLAN_PAYLOAD_KIND,
        appId,
        revisionId,
        workflowId,
        definition: value.definition,
      },
      'createWorkflowRun.plan',
    );
    const startPayload = normalizeWorkflowStartPayload(
      {
        schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
        kind: WORKFLOW_START_PAYLOAD_KIND,
        input: Object.prototype.hasOwnProperty.call(value, 'input')
          ? value.input
          : {},
        callerMetadata: Object.prototype.hasOwnProperty.call(
          value,
          'callerMetadata',
        )
          ? value.callerMetadata
          : {},
      },
      'createWorkflowRun.start',
    );
    const firstStep = planPayload.definition.steps[0];
    if (firstStep.kind !== 'activity') {
      throw new TypeError(
        'createWorkflowRun requires an activity first step; timer and signal first steps are not implemented.',
      );
    }
    if (firstStep.activity === MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID) {
      throw new TypeError(
        'createWorkflowRun cannot use the reserved managed-effect successor activity ID.',
      );
    }
    let preflightInput;
    if (firstStep.input.kind === 'workflow-input') {
      preflightInput = startPayload.input;
    } else if (firstStep.input.kind === 'literal') {
      preflightInput = firstStep.input.value;
    } else {
      throw new TypeError(
        'createWorkflowRun first activity cannot select a prior step output.',
      );
    }
    const preflightActivityRequest = normalizeWorkflowActivityRequest(
      {
        input: preflightInput,
        callerMetadata: startPayload.callerMetadata,
      },
      'createWorkflowRun.activityRequest',
    );
    const transitionId = assertOpaqueId(
      value.transitionId,
      'createWorkflowRun.transitionId',
    );
    const actor = normalizeActor(value.actor);
    const observedAt = normalizeObservedAt(
      Object.prototype.hasOwnProperty.call(value, 'observedAt')
        ? value.observedAt
        : now(),
      'createWorkflowRun.observedAt',
    );
    const requested = { planPayload, startPayload, actor };

    const existing = await readVerifiedRun(runId);
    if (existing) {
      const creation = await getMatchingWorkflowCreation(existing, requested);
      if (!creation || !existing.workflowCursor) {
        throw new ExecutionLedgerRunConflictError(runId);
      }
      const requestDigest = createWorkflowRunRequestDigest({
        runId,
        invocationId: creation.invocation.invocationId,
        transitionId,
        actor,
        appId,
        revisionId,
        workflowId,
        planId: creation.workflowCursor.planId,
        planRef: creation.workflowCursor.planRef,
        startRef: creation.workflowCursor.startRef,
        activityRequestRef: creation.invocation.requestRef,
        trigger: creation.run.trigger,
      });
      const receipt = await getTransitionReceipt(
        db,
        resolvedTableName,
        runId,
        transitionId,
      );
      if (receipt && receipt.request_digest !== requestDigest) {
        throw new ExecutionLedgerTransitionConflictError(runId, transitionId);
      }
      try {
        await repairReadyWork({ appId, revisionId, runId });
      } catch (error) {
        if (!(error instanceof ExecutionLedgerConflictError)) throw error;
      }
      return workflowCreationResult(existing, receipt, false);
    }

    const planRef = await putVerifiedPayload(payloadStore, {
      value: planPayload,
      payloadSchema: WORKFLOW_PLAN_PAYLOAD_SCHEMA,
      label: 'createWorkflowRun.planRef',
    });
    const startRef = await putVerifiedPayload(payloadStore, {
      value: startPayload,
      payloadSchema: WORKFLOW_START_PAYLOAD_SCHEMA,
      label: 'createWorkflowRun.startRef',
    });
    const materialized = materializeFirstWorkflowActivity({
      runId,
      planPayload,
      planRef,
      startPayload,
      startRef,
      observedAt,
    });
    if (
      !hasSameCanonicalJson(
        materialized.activityRequest,
        preflightActivityRequest,
      )
    ) {
      throw new TypeError(
        'createWorkflowRun activity materialization changed its preflight request.',
      );
    }
    const activityRequestRef = await putVerifiedPayload(payloadStore, {
      value: materialized.activityRequest,
      payloadSchema: ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
      label: 'createWorkflowRun.activityRequestRef',
    });
    const trigger = normalizeRunTrigger({
      kind: 'workflow',
      workflowId,
      planId: materialized.planId,
      planRef,
    });
    const run = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId,
      appId,
      revisionId,
      trigger,
      requestRef: startRef,
      status: RunStatus.RUNNING,
      version: 1,
      lastSequence: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    const workflowCursor = materialized.cursor;
    const invocation = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId,
      invocationId: materialized.invocationId,
      appId,
      revisionId,
      activityId: materialized.activityId,
      requestRef: activityRequestRef,
      status: InvocationStatus.RUNNABLE,
      generation: 0,
      version: 1,
      lastSequence: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
      workflow: {
        workflowId,
        planId: materialized.planId,
        continuationId: materialized.continuationId,
        stepId: workflowCursor.stepId,
        stepIndex: workflowCursor.stepIndex,
      },
    };
    const requestDigest = createWorkflowRunRequestDigest({
      runId,
      invocationId: invocation.invocationId,
      transitionId,
      actor,
      appId,
      revisionId,
      workflowId,
      planId: materialized.planId,
      planRef,
      startRef,
      activityRequestRef,
      trigger,
    });
    const event = createEventRecord(
      runId,
      1,
      transitionId,
      requestDigest,
      'workflow-run-created',
      observedAt,
      actor,
      { coordinatorEpoch: 0, invocationGeneration: 0 },
      { run, invocation, workflowCursor },
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
        nextWorkflowCursor: workflowCursor,
      });
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
      const raced = await readVerifiedRun(runId);
      if (!raced) throw new ExecutionLedgerConflictError(runId);
      const racedCreation = await getMatchingWorkflowCreation(raced, requested);
      if (!racedCreation || !raced.workflowCursor) {
        throw new ExecutionLedgerRunConflictError(runId);
      }
      const racedRequestDigest = createWorkflowRunRequestDigest({
        runId,
        invocationId: racedCreation.invocation.invocationId,
        transitionId,
        actor,
        appId,
        revisionId,
        workflowId,
        planId: racedCreation.workflowCursor.planId,
        planRef: racedCreation.workflowCursor.planRef,
        startRef: racedCreation.workflowCursor.startRef,
        activityRequestRef: racedCreation.invocation.requestRef,
        trigger: racedCreation.run.trigger,
      });
      const receipt = await getTransitionReceipt(
        db,
        resolvedTableName,
        runId,
        transitionId,
      );
      if (receipt && receipt.request_digest !== racedRequestDigest) {
        throw new ExecutionLedgerTransitionConflictError(runId, transitionId);
      }
      try {
        await repairReadyWork({ appId, revisionId, runId });
      } catch (repairError) {
        if (!(repairError instanceof ExecutionLedgerConflictError)) {
          throw repairError;
        }
      }
      return workflowCreationResult(raced, receipt, false);
    }

    const next = await readVerifiedRun(runId);
    if (!next) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'created workflow run missing',
      );
    }
    const receipt = await getTransitionReceipt(
      db,
      resolvedTableName,
      runId,
      transitionId,
    );
    if (!receipt) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'created workflow transition missing',
      );
    }
    return workflowCreationResult(next, receipt, true);
  }

  /**
   * Atomically authorize one exact destination-finalized managed-effect retry
   * on its blocked source run and create the fresh effect-only target run. The
   * source effect and abandoned attempt are never rewritten. One app-scoped
   * public successor ID and one source reconciliation policy slot are both
   * first-wins identities.
   * @param {{sourceRunId: string, sourceEffectId: string, successorId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, observedAt?: number}} options - Stable successor request.
   * @returns {Promise<{applied: boolean, authorization: Record<string, any>, sourceRun: Record<string, any>, sourceInvocation: Record<string, any>, targetRun: Record<string, any>, targetInvocation: Record<string, any>, request: Record<string, any>}>} - Atomic authorization and target state.
   */
  async function authorizeManagedEffectSuccessorRetry(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'authorizeManagedEffectSuccessorRetry',
    );
    assertSupportedKeys(
      value,
      [
        'sourceRunId',
        'sourceEffectId',
        'successorId',
        'reason',
        'actor',
        'observedAt',
      ],
      'authorizeManagedEffectSuccessorRetry',
    );
    const sourceRunId = assertOpaqueId(
      value.sourceRunId,
      'authorizeManagedEffectSuccessorRetry.sourceRunId',
    );
    const sourceEffectId = assertOpaqueId(
      value.sourceEffectId,
      'authorizeManagedEffectSuccessorRetry.sourceEffectId',
    );
    const successorId = assertOpaqueId(
      value.successorId,
      'authorizeManagedEffectSuccessorRetry.successorId',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'authorizeManagedEffectSuccessorRetry.reason',
    );
    const actor = normalizeActor(value.actor);
    const observedAt = normalizeObservedAt(
      Object.prototype.hasOwnProperty.call(value, 'observedAt')
        ? value.observedAt
        : now(),
      'authorizeManagedEffectSuccessorRetry.observedAt',
    );
    const state = await readVerifiedRun(sourceRunId);
    if (!state) throw new ExecutionLedgerNotFoundError(sourceRunId);
    const sourceEffects = [...state.effects.values()].filter(
      (candidate) => candidate.effectId === sourceEffectId,
    );
    if (sourceEffects.length !== 1) {
      throw new ExecutionLedgerConflictError(
        sourceRunId,
        'reconciled source effect is unavailable or ambiguous',
      );
    }
    const sourceEffect = sourceEffects[0];
    const sourceInvocation = state.invocations.get(sourceEffect.invocationId);
    const sourceAttempt = state.attempts.get(
      attemptMapKey(
        sourceEffect.invocationId,
        sourceEffect.requestedBy.attemptId,
      ),
    );
    const reconciliation = sourceEffect.reconciliation;
    const reconciliationEvent = state.events.find((event) => {
      if (
        ![
          'uncertain-effect-reconciled',
          'effect-successor-reconciled',
        ].includes(event.type)
      ) {
        return false;
      }
      const snapshots = eventSnapshots(event, sourceRunId);
      return (
        snapshots.effect?.effectId === sourceEffect.effectId &&
        snapshots.reconciliation?.reconciliationId ===
          reconciliation?.reconciliationId
      );
    });
    const uncertaintyEvent = reconciliation
      ? state.events[reconciliation.uncertaintySequence - 1]
      : undefined;
    const sourceFamily = classifyNotAppliedManagedEffectSuccessorSource({
      run: state.run,
      invocation: sourceInvocation,
      attempt: sourceAttempt,
      effect: sourceEffect,
      uncertaintyEvent,
      reconciliationEvent,
      runId: sourceRunId,
    });
    if (
      !sourceFamily ||
      !reconciliation ||
      !reconciliationEvent ||
      !uncertaintyEvent ||
      reconciliationEvent.event_id === uncertaintyEvent.event_id ||
      uncertaintyEvent.event_id !== reconciliation.uncertaintyEventId ||
      reconciliationEvent.sequence <= reconciliation.uncertaintySequence
    ) {
      throw new ExecutionLedgerConflictError(
        sourceRunId,
        'effect lacks an exact retained not-applied reconciliation',
      );
    }
    const verifiedSourceInvocation = /** @type {Record<string, any>} */ (
      sourceInvocation
    );
    const verifiedSourceAttempt = /** @type {Record<string, any>} */ (
      sourceAttempt
    );
    const verifiedUncertaintyEvent = /** @type {Record<string, any>} */ (
      uncertaintyEvent
    );
    const payloadReader = createLedgerPayloadReader(payloadStore, sourceRunId);
    const request = await payloadReader.readManagedEffectRequest(
      sourceEffect.requestRef,
    );
    assertInitialManagedEffectSuccessorRetryEligible({
      effect: sourceEffect,
      request,
    });
    const authorization = createManagedEffectSuccessorAuthorization({
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      successorId,
      reason,
      source: {
        runId: sourceRunId,
        invocationId: verifiedSourceInvocation.invocationId,
        attemptId: verifiedSourceAttempt.attemptId,
        effectId: sourceEffect.effectId,
        uncertaintyEventId: verifiedUncertaintyEvent.event_id,
        uncertaintySequence: verifiedUncertaintyEvent.sequence,
        reconciliationEventId: reconciliationEvent.event_id,
        reconciliationSequence: reconciliationEvent.sequence,
        reconciliationId: reconciliation.reconciliationId,
        disposition: EffectStatus.NOT_APPLIED,
      },
      contract: {
        adapter: sourceEffect.adapter,
        destination: sourceEffect.destination,
        verifier: sourceEffect.verifier,
        substantiatedReplayProperties:
          sourceEffect.substantiatedReplayProperties,
      },
      request,
    });
    const sourceTransitionId = `successor:${authorization.slotId}`;
    const targetTransitionId = 'create';
    assertOpaqueId(sourceTransitionId, 'successor source transitionId');

    /**
     * Return an exact existing atomic handoff, or fail when either the public
     * identity or causal slot already belongs to different work.
     * @param {Record<string, any>} current - Fresh verified source state.
     * @returns {Promise<null | {applied: false, authorization: Record<string, any>, sourceRun: Record<string, any>, sourceInvocation: Record<string, any>, targetRun: Record<string, any>, targetInvocation: Record<string, any>, request: Record<string, any>} >} - Existing handoff when exact.
     */
    const readExisting = async (current) => {
      const identity = await readSuccessorIdentityRecord(
        db,
        resolvedTableName,
        current.run.appId,
        successorId,
      );
      const slotEvent = current.events.find(
        (/** @type {Record<string, any>} */ event) =>
          event.type === 'effect-successor-authorized' &&
          normalizeManagedEffectSuccessorAuthorization(
            event.payload.authorization,
          ).slotId === authorization.slotId,
      );
      if (!slotEvent) {
        if (!identity) return null;
        if (
          identity.source_run_id !== sourceRunId ||
          identity.slot_id !== authorization.slotId
        ) {
          throw new ExecutionLedgerTransitionConflictError(
            sourceRunId,
            sourceTransitionId,
          );
        }
        throw new ExecutionLedgerProjectionError(
          sourceRunId,
          'successor identity is missing its atomic source authorization',
        );
      }
      const retained = normalizeManagedEffectSuccessorAuthorization(
        slotEvent.payload.authorization,
      );
      if (retained.successorId !== successorId) {
        throw new ExecutionLedgerTransitionConflictError(
          sourceRunId,
          sourceTransitionId,
        );
      }
      if (!identity) {
        throw new ExecutionLedgerProjectionError(
          sourceRunId,
          'source authorization is missing its atomic successor identity',
        );
      }
      const expectedIdentity = createSuccessorIdentityRecord(
        current.run.appId,
        retained,
      );
      if (
        !hasSameCanonicalJson(retained, authorization) ||
        !hasSameCanonicalJson(identity, expectedIdentity) ||
        !hasSameCanonicalJson(slotEvent.actor, actor)
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          sourceRunId,
          sourceTransitionId,
        );
      }
      const target = await readVerifiedRun(retained.target.runId);
      const targetInvocation = target?.invocations.get(
        retained.target.invocationId,
      );
      if (
        !target ||
        !targetInvocation ||
        !hasSameCanonicalJson(target.run.trigger, retained)
      ) {
        throw new ExecutionLedgerProjectionError(
          retained.target.runId,
          'authorized successor target is unavailable',
        );
      }
      const durableSourceInvocation = current.invocations.get(
        retained.source.invocationId,
      );
      if (!durableSourceInvocation) {
        throw new ExecutionLedgerProjectionError(
          sourceRunId,
          'authorized successor source invocation is unavailable',
        );
      }
      return {
        applied: false,
        authorization: retained,
        sourceRun: cloneJsonObject(current.run, 'successor source run'),
        sourceInvocation: cloneJsonObject(
          durableSourceInvocation,
          'successor source invocation',
        ),
        targetRun: cloneJsonObject(target.run, 'successor target run'),
        targetInvocation: cloneJsonObject(
          targetInvocation,
          'successor target invocation',
        ),
        request: cloneJsonObject(request, 'successor request'),
      };
    };

    const existing = await readExisting(state);
    if (existing) return existing;
    const publicIdentity = await readSuccessorIdentityRecord(
      db,
      resolvedTableName,
      state.run.appId,
      successorId,
    );
    if (publicIdentity) {
      throw new ExecutionLedgerTransitionConflictError(
        sourceRunId,
        sourceTransitionId,
      );
    }

    const targetRequestRef = await putVerifiedPayload(payloadStore, {
      value: {
        input: {
          effectRequest: {
            effectId: authorization.target.effectId,
            ...cloneJsonObject(request, 'successor logical request'),
          },
        },
        callerMetadata: {},
      },
      payloadSchema: ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
      label: 'authorizeManagedEffectSuccessorRetry.targetRequestRef',
    });
    const sourceSequence = state.head.sequence + 1;
    const nextSourceRun = /** @type {Record<string, any>} */ ({
      ...cloneJsonObject(state.run, 'current successor source run'),
      version: state.run.version + 1,
      lastSequence: sourceSequence,
      updatedAt: observedAt,
    });
    const nextSourceInvocation = {
      ...cloneJsonObject(
        verifiedSourceInvocation,
        'current successor source invocation',
      ),
      version: verifiedSourceInvocation.version + 1,
      lastSequence: sourceSequence,
      updatedAt: observedAt,
    };
    const sourceRequestDigest = createTransitionRequestDigest(
      'effect-successor-authorized',
      {
        runId: sourceRunId,
        invocationId: verifiedSourceInvocation.invocationId,
        expectedVersion: state.run.version,
        transitionId: sourceTransitionId,
        authorization,
        actor,
        coordinatorEpoch: 0,
      },
    );
    const sourceEvent = createEventRecord(
      sourceRunId,
      sourceSequence,
      sourceTransitionId,
      sourceRequestDigest,
      'effect-successor-authorized',
      observedAt,
      actor,
      {
        coordinatorEpoch: 0,
        invocationGeneration: verifiedSourceInvocation.generation,
      },
      {
        run: nextSourceRun,
        invocation: nextSourceInvocation,
        authorization,
      },
    );
    const targetRun = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: authorization.target.runId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      trigger: authorization,
      requestRef: targetRequestRef,
      status: RunStatus.RUNNING,
      version: 1,
      lastSequence: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    const targetInvocation = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: authorization.target.runId,
      invocationId: authorization.target.invocationId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      activityId: MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID,
      requestRef: targetRequestRef,
      status: InvocationStatus.RUNNABLE,
      generation: 0,
      version: 1,
      lastSequence: 1,
      createdAt: observedAt,
      updatedAt: observedAt,
    };
    const targetRequestDigest = createTransitionRequestDigest(
      'effect-successor-run-created',
      {
        runId: targetRun.runId,
        invocationId: targetInvocation.invocationId,
        transitionId: targetTransitionId,
        actor,
        coordinatorEpoch: 0,
        appId: targetRun.appId,
        revisionId: targetRun.revisionId,
        activityId: targetInvocation.activityId,
        requestRef: targetRequestRef,
        trigger: authorization,
        authorization,
      },
    );
    const targetEvent = createEventRecord(
      targetRun.runId,
      1,
      targetTransitionId,
      targetRequestDigest,
      'effect-successor-run-created',
      observedAt,
      actor,
      { coordinatorEpoch: 0, invocationGeneration: 0 },
      { run: targetRun, invocation: targetInvocation, authorization },
    );
    const sourceHead = createHeadRecord(
      sourceRunId,
      nextSourceRun.version,
      nextSourceRun.lastSequence,
      nextSourceRun.appId,
      nextSourceRun.revisionId,
    );
    const targetHead = createHeadRecord(
      targetRun.runId,
      targetRun.version,
      targetRun.lastSequence,
      targetRun.appId,
      targetRun.revisionId,
    );
    const putRequests = [
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: sourceHead,
        conditions: [
          eq('version', state.head.version),
          eq('sequence', state.head.sequence),
          eq('revision_id', state.head.revision_id),
        ],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: sourceEvent,
        conditions: [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: createTransitionRecord(
          sourceRunId,
          sourceTransitionId,
          sourceRequestDigest,
          sourceEvent,
        ),
        conditions: [notExists(SORT_KEY_NAME)],
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: createRunProjectionRecord(sourceRunId, nextSourceRun),
        conditions: replacementConditions(
          createRunProjectionRecord(sourceRunId, state.run),
        ),
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: createRunDirectoryRecord(sourceRunId, nextSourceRun),
        conditions: runDirectoryReplacementConditions(
          createRunDirectoryRecord(sourceRunId, state.run),
        ),
      },
      {
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: createInvocationProjectionRecord(
          sourceRunId,
          nextSourceInvocation,
        ),
        conditions: replacementConditions(
          createInvocationProjectionRecord(
            sourceRunId,
            verifiedSourceInvocation,
          ),
          [eq('generation', verifiedSourceInvocation.generation)],
        ),
      },
      ...[
        targetHead,
        targetEvent,
        createTransitionRecord(
          targetRun.runId,
          targetTransitionId,
          targetRequestDigest,
          targetEvent,
        ),
        createRunProjectionRecord(targetRun.runId, targetRun),
        createRunDirectoryRecord(targetRun.runId, targetRun),
        createInvocationProjectionRecord(targetRun.runId, targetInvocation),
        createSuccessorIdentityRecord(targetRun.appId, authorization),
      ].map((record) => ({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record,
        conditions: [notExists(SORT_KEY_NAME)],
      })),
    ];

    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        putRequests,
      });
    } catch (error) {
      if (!isConditionalCheckFailed(error)) throw error;
      const raced = await readVerifiedRun(sourceRunId);
      if (!raced) throw new ExecutionLedgerConflictError(sourceRunId);
      const winner = await readExisting(raced);
      if (winner) return winner;
      throw new ExecutionLedgerConflictError(
        sourceRunId,
        'successor authorization lost its atomic first-wins race',
      );
    }

    const [acceptedSource, acceptedTarget] = await Promise.all([
      readVerifiedRun(sourceRunId),
      readVerifiedRun(targetRun.runId),
    ]);
    const acceptedSourceInvocation = acceptedSource?.invocations.get(
      verifiedSourceInvocation.invocationId,
    );
    const acceptedTargetInvocation = acceptedTarget?.invocations.get(
      targetInvocation.invocationId,
    );
    if (
      !acceptedSource ||
      !acceptedTarget ||
      !acceptedSourceInvocation ||
      !acceptedTargetInvocation
    ) {
      throw new ExecutionLedgerProjectionError(
        targetRun.runId,
        'accepted atomic successor handoff is unavailable',
      );
    }
    return {
      applied: true,
      authorization,
      sourceRun: cloneJsonObject(
        acceptedSource.run,
        'accepted successor source run',
      ),
      sourceInvocation: cloneJsonObject(
        acceptedSourceInvocation,
        'accepted successor source invocation',
      ),
      targetRun: cloneJsonObject(
        acceptedTarget.run,
        'accepted successor target run',
      ),
      targetInvocation: cloneJsonObject(
        acceptedTargetInvocation,
        'accepted successor target invocation',
      ),
      request: cloneJsonObject(request, 'accepted successor request'),
    };
  }

  /**
   * Atomically cross the sole successor dispatch boundary. The new physical
   * attempt and its one exact effect are born STARTED in one ledger event, so
   * no crash can leave an apparently begun successor without durable effect
   * authority. Only the writer of that event may enter the destination.
   * @param {{runId: string, fencingToken: string, expectedVersion: number, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Exact successor start request.
   * @returns {Promise<{applied: boolean, dispatchAuthorized: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}>} - Durable atomic start result.
   */
  async function startManagedEffectSuccessor(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'startManagedEffectSuccessor',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'fencingToken',
        'expectedVersion',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'startManagedEffectSuccessor',
      now,
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'startManagedEffectSuccessor.fencingToken',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const { authorization, invocation } =
      getManagedEffectSuccessorInvocation(state);
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const requestEnvelope = await payloadReader.readActivityRequest(
      invocation.requestRef,
    );
    const targetInput = normalizeManagedEffectSuccessorRunInput(
      requestEnvelope.input,
      'startManagedEffectSuccessor target input',
    );
    let derivedAuthorization;
    try {
      derivedAuthorization = assertManagedEffectSuccessorAuthorizationDerived({
        appId: state.run.appId,
        revisionId: state.run.revisionId,
        request: targetInput.request,
        authorization,
      });
    } catch {
      throw new ExecutionLedgerProjectionError(
        common.runId,
        'managed-effect successor authorization derivation mismatch',
      );
    }
    if (
      targetInput.effectId !== authorization.target.effectId ||
      !hasSameCanonicalJson(derivedAuthorization, authorization) ||
      Object.keys(requestEnvelope.callerMetadata).length !== 0
    ) {
      throw new ExecutionLedgerProjectionError(
        common.runId,
        'managed-effect successor target request is unavailable',
      );
    }
    if (
      !effectVerifierRegistry.has(
        effectVerifierKey(authorization.contract.verifier),
      )
    ) {
      throw new ExecutionLedgerProjectionError(
        common.runId,
        'managed-effect successor verifier is unavailable',
      );
    }
    const requestRef = await putVerifiedPayload(payloadStore, {
      value: targetInput.request,
      payloadSchema: MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
      label: 'startManagedEffectSuccessor.requestRef',
    });
    const generation = 1;
    const attemptId = createAttemptId(
      common.runId,
      invocation.invocationId,
      generation,
    );
    const requestDigest = createTransitionRequestDigest(
      'effect-successor-started',
      {
        runId: common.runId,
        invocationId: invocation.invocationId,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        effectId: authorization.target.effectId,
        destinationEffectId: authorization.target.destinationEffectId,
        requestRef,
        adapter: authorization.contract.adapter,
        destination: authorization.contract.destination,
        verifier: authorization.contract.verifier,
        requestedReplayProperties:
          targetInput.request.requestedReplayProperties,
        substantiatedReplayProperties:
          authorization.contract.substantiatedReplayProperties,
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
    if (existing) {
      if (
        existing.type !== 'effect-successor-started' ||
        existing.invocation_id !== invocation.invocationId ||
        existing.attempt_id !== attemptId ||
        existing.effect_id !== authorization.target.effectId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return {
        ...(await existingTransitionResult(state, existing)),
        dispatchAuthorized: false,
      };
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNABLE ||
      invocation.generation !== 0 ||
      [...state.attempts.values()].some(
        (attempt) => attempt.invocationId === invocation.invocationId,
      ) ||
      [...state.effects.values()].some(
        (effect) => effect.invocationId === invocation.invocationId,
      )
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor is not runnable for atomic start',
      );
    }
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current successor run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = /** @type {Record<string, any>} */ ({
      ...cloneJsonObject(invocation, 'current successor invocation'),
      status: InvocationStatus.RUNNING,
      generation,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    });
    const nextAttempt = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: common.runId,
      invocationId: invocation.invocationId,
      attemptId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      activityId: invocation.activityId,
      status: AttemptStatus.STARTED,
      generation,
      version: 1,
      coordinatorEpoch: common.coordinatorEpoch,
      fencingToken,
      claimedAt: common.observedAt,
      startedAt: common.observedAt,
      updatedAt: common.observedAt,
      lastSequence: sequence,
    };
    const nextEffect = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: common.runId,
      invocationId: invocation.invocationId,
      effectId: authorization.target.effectId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      activityId: invocation.activityId,
      destinationEffectId: authorization.target.destinationEffectId,
      adapter: authorization.contract.adapter,
      destination: authorization.contract.destination,
      verifier: authorization.contract.verifier,
      requestRef,
      requestedReplayProperties: targetInput.request.requestedReplayProperties,
      substantiatedReplayProperties:
        authorization.contract.substantiatedReplayProperties,
      requestedBy: {
        attemptId,
        generation,
        coordinatorEpoch: common.coordinatorEpoch,
        fencingToken,
        protocolSequence: 1,
      },
      status: EffectStatus.STARTED,
      version: 1,
      lastSequence: sequence,
      createdAt: common.observedAt,
      updatedAt: common.observedAt,
      startedBy: {
        attemptId,
        generation,
        coordinatorEpoch: common.coordinatorEpoch,
        fencingToken,
      },
    };
    try {
      assertManagedEffectSuccessorPlannedRequest({
        run: state.run,
        invocation,
        effect: nextEffect,
        request: targetInput.request,
        priorEffects: [...state.effects.values()],
      });
      assertStoppedAttemptClosureFits({
        run: nextRun,
        invocation: nextInvocation,
        attempt: nextAttempt,
        effects: [nextEffect],
        label: 'startManagedEffectSuccessor',
      });
    } catch {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor start violates its finite effect plan',
      );
    }
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'effect-successor-started',
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
      nextEffect,
    });
    return {
      ...result,
      dispatchAuthorized:
        result.applied === true &&
        result.run.status === RunStatus.RUNNING &&
        result.invocation.status === InvocationStatus.RUNNING &&
        result.attempt?.status === AttemptStatus.STARTED &&
        result.effect?.status === EffectStatus.STARTED &&
        result.attempt.attemptId === attemptId &&
        result.effect.effectId === authorization.target.effectId,
    };
  }

  /**
   * Atomically close a started successor effect and its enclosing effect-only
   * attempt. The destination outcome, framework transcript, effect terminal,
   * attempt terminal, invocation terminal, and run terminal become visible in
   * one transaction; no post-effect gap remains for a crash to strand.
   * @param {{runId: string, fencingToken: string, generation: number, expectedVersion: number, expectedEffectVersion: number, transitionId: string, outcome: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Verified successor outcome request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}>} - Durable aggregate terminal result.
   */
  async function commitManagedEffectSuccessorOutcome(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'commitManagedEffectSuccessorOutcome',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
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
      'commitManagedEffectSuccessorOutcome',
      now,
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'commitManagedEffectSuccessorOutcome.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'commitManagedEffectSuccessorOutcome.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'commitManagedEffectSuccessorOutcome.expectedEffectVersion',
    );
    const rawOutcome = cloneBoundedJsonObject(
      value.outcome,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'commitManagedEffectSuccessorOutcome.outcome',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const { authorization, invocation } =
      getManagedEffectSuccessorInvocation(state);
    const effect = state.effects.get(
      effectMapKey(invocation.invocationId, authorization.target.effectId),
    );
    const attempt = effect
      ? state.attempts.get(
          attemptMapKey(invocation.invocationId, effect.requestedBy.attemptId),
        )
      : undefined;
    if (!effect || !attempt) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor has no started effect to close',
      );
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    const outcome = normalizeManagedEffectOutcome(
      {
        destinationEffectId: effect.destinationEffectId,
        adapter: effect.adapter,
        destination: effect.destination,
        verifier: effect.verifier,
        ok: rawOutcome.ok,
        ...(rawOutcome.ok === true
          ? { result: rawOutcome.result }
          : { error: rawOutcome.error }),
        substantiatedReplayProperties: effect.substantiatedReplayProperties,
        evidence: rawOutcome.evidence,
      },
      'commitManagedEffectSuccessorOutcome.outcome',
    );
    verifyManagedEffectOutcome(
      effectVerifierRegistry,
      effect,
      request,
      outcome,
      'commitManagedEffectSuccessorOutcome.outcome',
    );
    const outcomeRef = await putVerifiedPayload(payloadStore, {
      value: outcome,
      payloadSchema: MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      label: 'commitManagedEffectSuccessorOutcome.outcomeRef',
    });
    const start = await createLedgerAttemptStart(
      state.run,
      invocation,
      attempt,
      payloadReader,
    );
    const terminalEvidence = createManagedEffectSuccessorTerminalEvidence({
      start,
      attempt,
      effect,
      request,
      outcome,
    });
    const evidenceRef = await putVerifiedPayload(payloadStore, {
      value: terminalEvidence.evidence,
      payloadSchema: ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      label: 'commitManagedEffectSuccessorOutcome.evidenceRef',
    });
    const requestDigest = createTransitionRequestDigest(
      'effect-successor-terminal',
      {
        runId: common.runId,
        invocationId: invocation.invocationId,
        attemptId: attempt.attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        expectedEffectVersion,
        transitionId: common.transitionId,
        effectId: effect.effectId,
        outcomeRef,
        evidenceRef,
        terminal: createTerminalSummary(terminalEvidence.terminal),
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
    if (existing) {
      if (
        existing.type !== 'effect-successor-terminal' ||
        existing.invocation_id !== invocation.invocationId ||
        existing.attempt_id !== attempt.attemptId ||
        existing.effect_id !== effect.effectId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return await existingTransitionResult(state, existing);
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      invocation.generation !== generation ||
      attempt.status !== AttemptStatus.STARTED ||
      effect.status !== EffectStatus.STARTED ||
      effect.version !== expectedEffectVersion ||
      effect.effectId !== authorization.target.effectId ||
      effect.destinationEffectId !== authorization.target.destinationEffectId
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor is not started for terminal closure',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const sequence = state.head.sequence + 1;
    const terminal = createTerminalSummary(terminalEvidence.terminal);
    const statuses = statusesForTerminal(terminalEvidence.terminal);
    const nextRun = {
      ...cloneJsonObject(state.run, 'current successor run'),
      status: statuses.run,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current successor invocation'),
      status: statuses.invocation,
      terminal,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current successor attempt'),
      status: statuses.attempt,
      terminal,
      evidenceRef,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextEffect = /** @type {Record<string, any>} */ ({
      ...cloneJsonObject(effect, 'current successor effect'),
      status: outcome.ok ? EffectStatus.COMPLETED : EffectStatus.FAILED,
      terminal: { ok: outcome.ok },
      outcomeRef,
      version: effect.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    });
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'effect-successor-terminal',
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
   * Conservatively stop a successor after its atomic STARTED boundary. This
   * never retries or replays the adapter: it records the exact physical
   * attempt and its one effect as uncertain so destination truth can decide
   * the target's later terminal state.
   * @param {{runId: string, fencingToken: string, generation: number, expectedVersion: number, expectedEffectVersion: number, transitionId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Exact successor interruption request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}>} - Durable blocked target state.
   */
  async function interruptManagedEffectSuccessor(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'interruptManagedEffectSuccessor',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
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
      'interruptManagedEffectSuccessor',
      now,
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'interruptManagedEffectSuccessor.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'interruptManagedEffectSuccessor.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'interruptManagedEffectSuccessor.expectedEffectVersion',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'interruptManagedEffectSuccessor.reason',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const { authorization, invocation } =
      getManagedEffectSuccessorInvocation(state);
    const effect = state.effects.get(
      effectMapKey(invocation.invocationId, authorization.target.effectId),
    );
    const attempt = effect
      ? state.attempts.get(
          attemptMapKey(invocation.invocationId, effect.requestedBy.attemptId),
        )
      : undefined;
    if (!effect || !attempt) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor has no started effect to interrupt',
      );
    }
    const requestDigest = createTransitionRequestDigest(
      'effect-successor-interrupted',
      {
        runId: common.runId,
        invocationId: invocation.invocationId,
        attemptId: attempt.attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        expectedEffectVersion,
        transitionId: common.transitionId,
        effectId: effect.effectId,
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
    if (existing) {
      if (
        existing.type !== 'effect-successor-interrupted' ||
        existing.invocation_id !== invocation.invocationId ||
        existing.attempt_id !== attempt.attemptId ||
        existing.effect_id !== effect.effectId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return await existingTransitionResult(state, existing);
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    if (
      state.run.status !== RunStatus.RUNNING ||
      invocation.status !== InvocationStatus.RUNNING ||
      invocation.generation !== generation ||
      attempt.status !== AttemptStatus.STARTED ||
      effect.status !== EffectStatus.STARTED ||
      effect.version !== expectedEffectVersion ||
      effect.effectId !== authorization.target.effectId ||
      effect.destinationEffectId !== authorization.target.destinationEffectId
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor is not started for interruption',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current successor run'),
      status: RunStatus.BLOCKED,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(invocation, 'current successor invocation'),
      status: InvocationStatus.UNCERTAIN,
      uncertainty: reason,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current successor attempt'),
      status: AttemptStatus.ABANDONED,
      abandonment: reason,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextEffect = {
      ...cloneJsonObject(effect, 'current successor effect'),
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
      'effect-successor-interrupted',
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
   * Resolve one interrupted successor from immutable destination evidence.
   * Positive evidence closes the target successfully or failed; a permanent
   * negative proof closes it FAILED with NOT_APPLIED preserved on the effect.
   * The original abandoned physical attempt remains byte-identical.
   * @param {{runId: string, fencingToken: string, generation: number, expectedVersion: number, expectedEffectVersion: number, uncertaintyEventId: string, uncertaintySequence: number, transitionId: string, reconciliationId: string, reason: Record<string, any>, resolution: {kind: 'outcome', outcome: Record<string, any>} | {kind: 'not-applied', verifier: {kind: string, version: number}, evidence: Record<string, any>}, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Exact successor reconciliation request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}>} - Durable target terminal state.
   */
  async function reconcileManagedEffectSuccessor(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'reconcileManagedEffectSuccessor',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'expectedEffectVersion',
        'uncertaintyEventId',
        'uncertaintySequence',
        'transitionId',
        'reconciliationId',
        'reason',
        'resolution',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'reconcileManagedEffectSuccessor',
      now,
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'reconcileManagedEffectSuccessor.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'reconcileManagedEffectSuccessor.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'reconcileManagedEffectSuccessor.expectedEffectVersion',
    );
    const uncertaintyEventId = assertOpaqueId(
      value.uncertaintyEventId,
      'reconcileManagedEffectSuccessor.uncertaintyEventId',
    );
    const uncertaintySequence = assertPositiveSafeInteger(
      value.uncertaintySequence,
      'reconcileManagedEffectSuccessor.uncertaintySequence',
    );
    const reconciliationId = assertOpaqueId(
      value.reconciliationId,
      'reconcileManagedEffectSuccessor.reconciliationId',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'reconcileManagedEffectSuccessor.reason',
    );
    const resolution = cloneBoundedJsonObject(
      value.resolution,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'reconcileManagedEffectSuccessor.resolution',
    );
    if (resolution.kind === 'outcome') {
      assertExactKeys(
        resolution,
        ['kind', 'outcome'],
        'reconcileManagedEffectSuccessor.resolution',
      );
    } else if (resolution.kind === 'not-applied') {
      assertExactKeys(
        resolution,
        ['kind', 'verifier', 'evidence'],
        'reconcileManagedEffectSuccessor.resolution',
      );
    } else {
      throw new TypeError(
        'reconcileManagedEffectSuccessor.resolution.kind is not supported.',
      );
    }
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    const { authorization, invocation } =
      getManagedEffectSuccessorInvocation(state);
    const effect = state.effects.get(
      effectMapKey(invocation.invocationId, authorization.target.effectId),
    );
    const attempt = effect
      ? state.attempts.get(
          attemptMapKey(invocation.invocationId, effect.requestedBy.attemptId),
        )
      : undefined;
    if (!effect || !attempt) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor has no interrupted effect to reconcile',
      );
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    /** @type {ReturnType<typeof normalizeManagedEffectOutcome> | undefined} */
    let outcome;
    /** @type {Record<string, any> | undefined} */
    let negativeEvidence;
    /** @type {{kind: string, version: number}} */
    let verifier;
    /** @type {string} */
    let resolutionStatus;
    if (resolution.kind === 'outcome') {
      if (resolution.outcome?.ok === true) {
        assertExactKeys(
          resolution.outcome,
          ['ok', 'result', 'evidence'],
          'reconcileManagedEffectSuccessor.resolution.outcome',
        );
      } else if (resolution.outcome?.ok === false) {
        assertExactKeys(
          resolution.outcome,
          ['ok', 'error', 'evidence'],
          'reconcileManagedEffectSuccessor.resolution.outcome',
        );
      } else {
        throw new TypeError(
          'reconcileManagedEffectSuccessor.resolution.outcome.ok must be a boolean.',
        );
      }
      outcome = normalizeManagedEffectOutcome(
        {
          destinationEffectId: effect.destinationEffectId,
          adapter: effect.adapter,
          destination: effect.destination,
          verifier: effect.verifier,
          ok: resolution.outcome.ok,
          ...(resolution.outcome.ok
            ? { result: resolution.outcome.result }
            : { error: resolution.outcome.error }),
          substantiatedReplayProperties: effect.substantiatedReplayProperties,
          evidence: resolution.outcome.evidence,
        },
        'reconcileManagedEffectSuccessor.resolution.outcome',
      );
      verifyManagedEffectOutcome(
        effectVerifierRegistry,
        effect,
        request,
        outcome,
        'reconcileManagedEffectSuccessor.resolution.outcome',
      );
      verifier = cloneInlinePayload(
        effect.verifier,
        'reconcileManagedEffectSuccessor outcome verifier',
      );
      resolutionStatus = outcome.ok
        ? EffectStatus.COMPLETED
        : EffectStatus.FAILED;
    } else {
      verifier = normalizeEffectVerifierDescriptor(
        resolution.verifier,
        'reconcileManagedEffectSuccessor.resolution.verifier',
      );
      negativeEvidence = cloneReferencedPayloadObject(
        resolution.evidence,
        'reconcileManagedEffectSuccessor.resolution.evidence',
      );
      verifyManagedEffectReconciliationEvidence(
        effectVerifierRegistry,
        effect,
        request,
        verifier,
        negativeEvidence,
        'reconcileManagedEffectSuccessor.resolution.evidence',
      );
      resolutionStatus = EffectStatus.NOT_APPLIED;
    }
    const evidenceRef = await putVerifiedPayload(payloadStore, {
      value: negativeEvidence || outcome,
      payloadSchema:
        resolutionStatus === EffectStatus.NOT_APPLIED
          ? MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA
          : MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      label: 'reconcileManagedEffectSuccessor.evidenceRef',
    });
    const terminal = {
      type:
        resolutionStatus === EffectStatus.COMPLETED ? 'completed' : 'failed',
      attemptId: attempt.attemptId,
    };
    const requestDigest = createTransitionRequestDigest(
      'effect-successor-reconciled',
      {
        runId: common.runId,
        invocationId: invocation.invocationId,
        attemptId: attempt.attemptId,
        effectId: effect.effectId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        expectedEffectVersion,
        transitionId: common.transitionId,
        reconciliationId,
        uncertaintyEventId,
        uncertaintySequence,
        verifier,
        evidenceRef,
        resolutionStatus,
        terminal,
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
    if (existing) {
      if (
        existing.type !== 'effect-successor-reconciled' ||
        existing.invocation_id !== invocation.invocationId ||
        existing.attempt_id !== attempt.attemptId ||
        existing.effect_id !== effect.effectId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return await existingTransitionResult(state, existing);
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const uncertaintyEvent = state.events[uncertaintySequence - 1];
    const reconciliationLink = {
      invocationId: invocation.invocationId,
      attemptId: attempt.attemptId,
      effectId: effect.effectId,
      generation,
      coordinatorEpoch: common.coordinatorEpoch,
      fencingToken,
      uncertaintyEventId,
      uncertaintySequence,
    };
    if (
      state.run.status !== RunStatus.BLOCKED ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.generation !== generation ||
      attempt.status !== AttemptStatus.ABANDONED ||
      effect.status !== EffectStatus.UNCERTAIN ||
      effect.version !== expectedEffectVersion ||
      effect.effectId !== authorization.target.effectId ||
      effect.destinationEffectId !== authorization.target.destinationEffectId ||
      !hasExactEffectUncertaintyEventLink({
        run: state.run,
        invocation,
        attempt,
        effect,
        reconciliation: reconciliationLink,
        uncertaintyEvent,
        runId: common.runId,
      })
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed-effect successor is not the retained interrupted effect',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const reconciliation = {
      reconciliationId,
      ...reconciliationLink,
      verifier,
      evidenceRef,
      resolutionStatus,
      reason,
    };
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current successor run'),
      status:
        resolutionStatus === EffectStatus.COMPLETED
          ? RunStatus.COMPLETED
          : RunStatus.FAILED,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = /** @type {Record<string, any>} */ ({
      ...cloneJsonObject(invocation, 'current successor invocation'),
      status:
        resolutionStatus === EffectStatus.COMPLETED
          ? InvocationStatus.COMPLETED
          : InvocationStatus.FAILED,
      terminal,
      version: invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    });
    delete nextInvocation.uncertainty;
    const nextEffect = /** @type {Record<string, any>} */ ({
      ...cloneJsonObject(effect, 'current successor effect'),
      status: resolutionStatus,
      reconciliation,
      version: effect.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    });
    delete nextEffect.uncertainty;
    if (outcome) {
      nextEffect.terminal = { ok: outcome.ok };
      nextEffect.outcomeRef = evidenceRef;
    }
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'effect-successor-reconciled',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        effect: nextEffect,
        reconciliation,
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
      nextEffect,
      currentEffect: effect,
    });
  }

  /**
   * @param {{state: Record<string, any>, runId: string, transitionId: string, requestDigest: string, event: Record<string, any>, nextRun: Record<string, any>, nextInvocation: Record<string, any>, nextAdditionalInvocation?: Record<string, any>, nextWorkflowCursor?: Record<string, any>, nextAttempt?: Record<string, any>, currentAttempt?: Record<string, any>, nextEffect?: Record<string, any>, currentEffect?: Record<string, any>, effectTransitions?: Array<{currentEffect?: Record<string, any>, nextEffect: Record<string, any>}>, resultEffectIds?: string[]}} input - Fully validated existing-run transition.
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
    assertManualLifecycleRun(state, 'requestManualRunCancellation');
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
   * Claim one exact runnable workflow activity under both the run head and
   * orchestration cursor CAS. The returned attempt remains undispatchable
   * until markWorkflowActivityStarted persists the irreversible boundary.
   * @param {{runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, fencingToken: string, expectedGeneration: number, expectedVersion: number, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Cursor-guarded claim request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>}>} - Accepted or exactly replayed claim.
   */
  async function claimWorkflowActivity(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'claimWorkflowActivity',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'cursor',
        'fencingToken',
        'expectedGeneration',
        'expectedVersion',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'claimWorkflowActivity',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'claimWorkflowActivity.invocationId',
    );
    const guard = normalizeWorkflowCursorGuard(
      value.cursor,
      'claimWorkflowActivity.cursor',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'claimWorkflowActivity.fencingToken',
    );
    const expectedGeneration = assertNonnegativeSafeInteger(
      value.expectedGeneration,
      'claimWorkflowActivity.expectedGeneration',
    );
    const attemptId = createAttemptId(
      common.runId,
      invocationId,
      expectedGeneration + 1,
    );
    const requestDigest = createTransitionRequestDigest(
      'workflow-activity-claimed',
      {
        runId: common.runId,
        invocationId,
        cursor: guard,
        attemptId,
        fencingToken,
        expectedGeneration,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
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
      if (
        existing.type !== 'workflow-activity-claimed' ||
        existing.invocation_id !== invocationId ||
        existing.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return /** @type {any} */ (
        await existingTransitionResult(state, existing)
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const authority = getWorkflowActivityAuthority(
      state,
      invocationId,
      guard,
      'claimWorkflowActivity',
    );
    const verified = await verifyWorkflowCursorActivity(
      state,
      authority.cursor,
      authority.invocation,
      'claimWorkflowActivity',
    );
    assertWorkflowActivityDispatchSupported(
      state,
      authority.cursor,
      verified.planPayload,
      'claimWorkflowActivity',
    );
    if (
      authority.cursor.disposition !==
        WorkflowCursorDisposition.ACTIVITY_RUNNABLE ||
      authority.invocation.status !== InvocationStatus.RUNNABLE ||
      authority.invocation.generation !== expectedGeneration ||
      state.attempts.has(attemptMapKey(invocationId, attemptId))
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow activity is not currently runnable',
      );
    }
    if (
      common.observedAt < state.run.updatedAt ||
      common.observedAt < authority.cursor.updatedAt
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow claim observation precedes durable state',
      );
    }

    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current workflow run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(authority.invocation, 'current workflow invocation'),
      status: InvocationStatus.RUNNING,
      generation: expectedGeneration + 1,
      version: authority.invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextWorkflowCursor = normalizeWorkflowCursor(
      {
        ...cloneJsonObject(authority.cursor, 'current workflow cursor'),
        disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
        version: authority.cursor.version + 1,
        lastSequence: sequence,
        updatedAt: common.observedAt,
      },
      'claimWorkflowActivity.nextCursor',
    );
    const attempt = {
      schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
      runId: common.runId,
      invocationId,
      attemptId,
      appId: state.run.appId,
      revisionId: state.run.revisionId,
      activityId: authority.invocation.activityId,
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
      'workflow-activity-claimed',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: attempt.generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        workflowCursor: nextWorkflowCursor,
        attempt,
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
        nextWorkflowCursor,
        nextAttempt: attempt,
      })
    );
  }

  /**
   * Persist the irreversible dispatch boundary for one exact claimed workflow
   * activity. Receipt replay deliberately never authorizes a second delivery.
   * @param {{runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Cursor-guarded start request.
   * @returns {Promise<{applied: boolean, dispatchAuthorized: boolean, receipt: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, startFrame: Readonly<Record<string, any>>}>} - Durable start outcome.
   */
  async function markWorkflowActivityStarted(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'markWorkflowActivityStarted',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'cursor',
        'attemptId',
        'fencingToken',
        'generation',
        'expectedVersion',
        'transitionId',
        'actor',
        'coordinatorEpoch',
        'observedAt',
      ],
      'markWorkflowActivityStarted',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'markWorkflowActivityStarted.invocationId',
    );
    const guard = normalizeWorkflowCursorGuard(
      value.cursor,
      'markWorkflowActivityStarted.cursor',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'markWorkflowActivityStarted.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'markWorkflowActivityStarted.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'markWorkflowActivityStarted.generation',
    );
    const requestDigest = createTransitionRequestDigest(
      'workflow-activity-started',
      {
        runId: common.runId,
        invocationId,
        cursor: guard,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
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
      if (
        existing.type !== 'workflow-activity-started' ||
        existing.invocation_id !== invocationId ||
        existing.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return /** @type {any} */ (
        await startedTransitionResult(
          await existingTransitionResult(state, existing),
          common.runId,
          payloadStore,
        )
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const authority = getWorkflowActivityAuthority(
      state,
      invocationId,
      guard,
      'markWorkflowActivityStarted',
    );
    const verified = await verifyWorkflowCursorActivity(
      state,
      authority.cursor,
      authority.invocation,
      'markWorkflowActivityStarted',
    );
    assertWorkflowActivityDispatchSupported(
      state,
      authority.cursor,
      verified.planPayload,
      'markWorkflowActivityStarted',
    );
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      authority.cursor.disposition !==
        WorkflowCursorDisposition.ACTIVITY_RUNNING ||
      authority.invocation.status !== InvocationStatus.RUNNING ||
      !attempt ||
      attempt.status !== AttemptStatus.CLAIMED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow attempt is not currently claimable for start',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    if (
      common.observedAt < state.run.updatedAt ||
      common.observedAt < authority.cursor.updatedAt ||
      common.observedAt < attempt.updatedAt
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow start observation precedes durable state',
      );
    }

    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current workflow run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(authority.invocation, 'current workflow invocation'),
      version: authority.invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextWorkflowCursor = normalizeWorkflowCursor(
      {
        ...cloneJsonObject(authority.cursor, 'current workflow cursor'),
        version: authority.cursor.version + 1,
        lastSequence: sequence,
        updatedAt: common.observedAt,
      },
      'markWorkflowActivityStarted.nextCursor',
    );
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current workflow attempt'),
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
      'workflow-activity-started',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        workflowCursor: nextWorkflowCursor,
        attempt: nextAttempt,
      },
    );
    return /** @type {any} */ (
      await startedTransitionResult(
        await appendOrReplay({
          state,
          runId: common.runId,
          transitionId: common.transitionId,
          requestDigest,
          event,
          nextRun,
          nextInvocation,
          nextWorkflowCursor,
          nextAttempt,
          currentAttempt: attempt,
        }),
        common.runId,
        payloadStore,
      )
    );
  }

  /**
   * Release one cursor-bound workflow claim which demonstrably never crossed
   * the durable STARTED boundary. The abandoned physical generation remains
   * retained while the same logical activation becomes runnable again.
   * @param {{runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Cursor-guarded claim release.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>}>} - Accepted or exactly replayed release.
   */
  async function abandonUnstartedWorkflowActivityAttempt(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'abandonUnstartedWorkflowActivityAttempt',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'cursor',
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
      'abandonUnstartedWorkflowActivityAttempt',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'abandonUnstartedWorkflowActivityAttempt.invocationId',
    );
    const guard = normalizeWorkflowCursorGuard(
      value.cursor,
      'abandonUnstartedWorkflowActivityAttempt.cursor',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'abandonUnstartedWorkflowActivityAttempt.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'abandonUnstartedWorkflowActivityAttempt.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'abandonUnstartedWorkflowActivityAttempt.generation',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'abandonUnstartedWorkflowActivityAttempt.reason',
    );
    const requestDigest = createTransitionRequestDigest(
      'workflow-activity-abandoned-before-start',
      {
        runId: common.runId,
        invocationId,
        cursor: guard,
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
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
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
      if (
        existing.type !== 'workflow-activity-abandoned-before-start' ||
        existing.invocation_id !== invocationId ||
        existing.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return /** @type {any} */ (
        await existingTransitionResult(state, existing)
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const authority = getWorkflowActivityAuthority(
      state,
      invocationId,
      guard,
      'abandonUnstartedWorkflowActivityAttempt',
    );
    const verified = await verifyWorkflowCursorActivity(
      state,
      authority.cursor,
      authority.invocation,
      'abandonUnstartedWorkflowActivityAttempt',
    );
    assertWorkflowActivityDispatchSupported(
      state,
      authority.cursor,
      verified.planPayload,
      'abandonUnstartedWorkflowActivityAttempt',
    );
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      authority.cursor.disposition !==
        WorkflowCursorDisposition.ACTIVITY_RUNNING ||
      authority.invocation.status !== InvocationStatus.RUNNING ||
      authority.invocation.generation !== generation ||
      !attempt ||
      attempt.status !== AttemptStatus.CLAIMED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow attempt cannot be safely released',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    assertWorkflowActivityHasNoManagedEffects(
      state,
      attempt,
      'abandonUnstartedWorkflowActivityAttempt',
    );
    if (
      common.observedAt < state.run.updatedAt ||
      common.observedAt < authority.cursor.updatedAt ||
      common.observedAt < attempt.updatedAt
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow claim release observation precedes durable state',
      );
    }
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current workflow run'),
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(authority.invocation, 'current workflow invocation'),
      status: InvocationStatus.RUNNABLE,
      version: authority.invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextWorkflowCursor = materializeWorkflowActivityClaimRelease({
      currentCursor: authority.cursor,
      sequence,
      observedAt: common.observedAt,
    });
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current workflow attempt'),
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
      'workflow-activity-abandoned-before-start',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        workflowCursor: nextWorkflowCursor,
        attempt: nextAttempt,
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
        nextWorkflowCursor,
        nextAttempt,
        currentAttempt: attempt,
      })
    );
  }

  /**
   * Conservatively block one cursor-bound workflow attempt which crossed the
   * durable STARTED boundary but no longer has a trusted live reporter. The
   * logical activation remains selected and no retry is made authoritative.
   * @param {{runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, reason: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Cursor-guarded uncertainty transition.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>}>} - Accepted or exactly replayed uncertainty.
   */
  async function markWorkflowActivityAttemptUncertain(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES,
      'markWorkflowActivityAttemptUncertain',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'cursor',
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
      'markWorkflowActivityAttemptUncertain',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'markWorkflowActivityAttemptUncertain.invocationId',
    );
    const guard = normalizeWorkflowCursorGuard(
      value.cursor,
      'markWorkflowActivityAttemptUncertain.cursor',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'markWorkflowActivityAttemptUncertain.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'markWorkflowActivityAttemptUncertain.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'markWorkflowActivityAttemptUncertain.generation',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'markWorkflowActivityAttemptUncertain.reason',
    );
    const requestDigest = createTransitionRequestDigest(
      'workflow-activity-became-uncertain',
      {
        runId: common.runId,
        invocationId,
        cursor: guard,
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
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
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
      if (
        existing.type !== 'workflow-activity-became-uncertain' ||
        existing.invocation_id !== invocationId ||
        existing.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      return /** @type {any} */ (
        await existingTransitionResult(state, existing)
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const authority = getWorkflowActivityAuthority(
      state,
      invocationId,
      guard,
      'markWorkflowActivityAttemptUncertain',
    );
    const verified = await verifyWorkflowCursorActivity(
      state,
      authority.cursor,
      authority.invocation,
      'markWorkflowActivityAttemptUncertain',
    );
    assertWorkflowActivityDispatchSupported(
      state,
      authority.cursor,
      verified.planPayload,
      'markWorkflowActivityAttemptUncertain',
    );
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      authority.cursor.disposition !==
        WorkflowCursorDisposition.ACTIVITY_RUNNING ||
      authority.invocation.status !== InvocationStatus.RUNNING ||
      authority.invocation.generation !== generation ||
      !attempt ||
      attempt.status !== AttemptStatus.STARTED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow attempt cannot become uncertain',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    assertWorkflowActivityHasNoManagedEffects(
      state,
      attempt,
      'markWorkflowActivityAttemptUncertain',
    );
    if (
      common.observedAt < state.run.updatedAt ||
      common.observedAt < authority.cursor.updatedAt ||
      common.observedAt < attempt.updatedAt
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow uncertainty observation precedes durable state',
      );
    }
    const sequence = state.head.sequence + 1;
    const nextRun = {
      ...cloneJsonObject(state.run, 'current workflow run'),
      status: RunStatus.BLOCKED,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(authority.invocation, 'current workflow invocation'),
      status: InvocationStatus.UNCERTAIN,
      version: authority.invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      uncertainty: reason,
    };
    const nextWorkflowCursor = materializeWorkflowActivityUncertainty({
      currentCursor: authority.cursor,
      sequence,
      observedAt: common.observedAt,
    });
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current workflow attempt'),
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
      'workflow-activity-became-uncertain',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        workflowCursor: nextWorkflowCursor,
        attempt: nextAttempt,
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
        nextWorkflowCursor,
        nextAttempt,
        currentAttempt: attempt,
      })
    );
  }

  /**
   * Commit one supported verified Activity Protocol terminal as the current
   * logical workflow step. Completed evidence atomically installs an output
   * and optional successor; failed or protocol-failed evidence terminalizes
   * the workflow without either.
   * @param {{runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, attemptId: string, fencingToken: string, generation: number, expectedVersion: number, transitionId: string, evidence: Record<string, any>, actor?: {kind: string, id: string}, coordinatorEpoch?: number, observedAt?: number}} options - Cursor-guarded verified terminal.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, outputRef?: Record<string, any>, nextInvocation?: Record<string, any>}>} - Compound terminal outcome.
   */
  async function commitVerifiedWorkflowActivityTerminal(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'commitVerifiedWorkflowActivityTerminal',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'cursor',
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
      'commitVerifiedWorkflowActivityTerminal',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'commitVerifiedWorkflowActivityTerminal.invocationId',
    );
    const guard = normalizeWorkflowCursorGuard(
      value.cursor,
      'commitVerifiedWorkflowActivityTerminal.cursor',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'commitVerifiedWorkflowActivityTerminal.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'commitVerifiedWorkflowActivityTerminal.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'commitVerifiedWorkflowActivityTerminal.generation',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
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
        !['workflow-activity-succeeded', 'workflow-activity-failed'].includes(
          existingReceipt.type,
        ) ||
        existingReceipt.invocation_id !== invocationId ||
        existingReceipt.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingEvent = receiptState.events[existingReceipt.sequence - 1];
      const snapshots = existingEvent
        ? eventSnapshots(existingEvent, common.runId)
        : undefined;
      const persistedAttempt = snapshots?.attempt;
      const persistedCursor = snapshots?.workflowCursor;
      const priorEvent = receiptState.events[existingReceipt.sequence - 2];
      const priorCursor = priorEvent
        ? eventSnapshots(priorEvent, common.runId).workflowCursor
        : undefined;
      if (
        !existingEvent ||
        existingEvent.event_id !== existingReceipt.event_id ||
        !snapshots ||
        !persistedAttempt ||
        !persistedCursor ||
        !priorCursor ||
        !hasSameCanonicalJson(workflowCursorGuard(priorCursor), guard)
      ) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'workflow terminal receipt snapshots are unavailable',
        );
      }
      const payloadReader = createLedgerPayloadReader(
        payloadStore,
        common.runId,
      );
      const verifiedEvidence = validateLedgerAttemptEvidence(
        value.evidence,
        await createLedgerAttemptStart(
          snapshots.run,
          snapshots.invocation,
          persistedAttempt,
          payloadReader,
        ),
        'commitVerifiedWorkflowActivityTerminal.evidence',
      );
      assertSupportedWorkflowActivityTerminal(
        verifiedEvidence.terminal,
        verifiedEvidence.evidence,
        'commitVerifiedWorkflowActivityTerminal.evidence',
      );
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        persistedAttempt,
        /** @type {{effects: Map<string, Record<string, any>>}} */ (
          receiptState
        ),
        payloadReader,
        effectVerifierRegistry,
        common.runId,
      );
      assertWorkflowActivityHasNoManagedEffects(
        receiptState,
        persistedAttempt,
        'commitVerifiedWorkflowActivityTerminal',
      );
      const terminal = verifiedEvidence.terminal;
      const eventType =
        terminal.type === 'completed'
          ? 'workflow-activity-succeeded'
          : 'workflow-activity-failed';
      if (
        existingReceipt.type !== eventType ||
        terminal.attemptId !== attemptId ||
        !hasSameCanonicalJson(
          await payloadReader.readEvidence(persistedAttempt.evidenceRef),
          verifiedEvidence.evidence,
        )
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      let outputRef;
      let successor;
      if (terminal.type === 'completed') {
        const output = persistedCursor.outputs[priorCursor.stepIndex];
        if (
          !output ||
          output.stepId !== priorCursor.stepId ||
          output.stepIndex !== priorCursor.stepIndex
        ) {
          throw new ExecutionLedgerProjectionError(
            common.runId,
            'workflow success receipt output is unavailable',
          );
        }
        const outputPayload = await payloadReader.readWorkflowOutput(
          output.outputRef,
        );
        if (!hasSameCanonicalJson(outputPayload.value, terminal.result)) {
          throw new ExecutionLedgerTransitionConflictError(
            common.runId,
            common.transitionId,
          );
        }
        outputRef = output.outputRef;
        successor = snapshots.nextInvocation
          ? {
              continuationId: snapshots.nextInvocation.workflow?.continuationId,
              stepId: snapshots.nextInvocation.workflow?.stepId,
              stepIndex: snapshots.nextInvocation.workflow?.stepIndex,
              invocationId: snapshots.nextInvocation.invocationId,
              activityId: snapshots.nextInvocation.activityId,
              requestRef: snapshots.nextInvocation.requestRef,
            }
          : null;
      } else {
        if (snapshots.nextInvocation) {
          throw new ExecutionLedgerProjectionError(
            common.runId,
            'workflow failure receipt retains a successor invocation',
          );
        }
        successor = null;
      }
      const requestDigest = createTransitionRequestDigest(eventType, {
        runId: common.runId,
        invocationId,
        cursor: guard,
        attemptId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        transitionId: common.transitionId,
        terminal: createTerminalSummary(terminal),
        evidenceRef: persistedAttempt.evidenceRef,
        ...(terminal.type === 'completed' ? { outputRef, successor } : {}),
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      });
      const existing = assertMatchingReceipt(
        receiptState,
        existingReceipt,
        requestDigest,
      );
      return /** @type {any} */ (
        await existingTransitionResult(
          receiptState,
          /** @type {Record<string, any>} */ (existing),
        )
      );
    }

    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const authority = getWorkflowActivityAuthority(
      state,
      invocationId,
      guard,
      'commitVerifiedWorkflowActivityTerminal',
    );
    const verified = await verifyWorkflowCursorActivity(
      state,
      authority.cursor,
      authority.invocation,
      'commitVerifiedWorkflowActivityTerminal',
    );
    assertWorkflowActivityDispatchSupported(
      state,
      authority.cursor,
      verified.planPayload,
      'commitVerifiedWorkflowActivityTerminal',
    );
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    if (
      authority.cursor.disposition !==
        WorkflowCursorDisposition.ACTIVITY_RUNNING ||
      authority.invocation.status !== InvocationStatus.RUNNING ||
      !attempt ||
      attempt.status !== AttemptStatus.STARTED
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow attempt cannot commit a terminal in its current state',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    if (
      common.observedAt < state.run.updatedAt ||
      common.observedAt < authority.cursor.updatedAt ||
      common.observedAt < attempt.updatedAt
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow terminal observation precedes durable state',
      );
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const verifiedEvidence = validateLedgerAttemptEvidence(
      value.evidence,
      await createLedgerAttemptStart(
        state.run,
        authority.invocation,
        attempt,
        payloadReader,
      ),
      'commitVerifiedWorkflowActivityTerminal.evidence',
    );
    assertSupportedWorkflowActivityTerminal(
      verifiedEvidence.terminal,
      verifiedEvidence.evidence,
      'commitVerifiedWorkflowActivityTerminal.evidence',
    );
    await assertAttemptEvidenceMatchesManagedEffects(
      verifiedEvidence.evidence,
      attempt,
      state,
      payloadReader,
      effectVerifierRegistry,
      common.runId,
    );
    assertWorkflowActivityHasNoManagedEffects(
      state,
      attempt,
      'commitVerifiedWorkflowActivityTerminal',
    );
    const terminal = verifiedEvidence.terminal;
    if (terminal.attemptId !== attemptId) {
      throw new TypeError(
        'commitVerifiedWorkflowActivityTerminal.evidence must end with a supported terminal for the exact persisted attempt.',
      );
    }
    const evidenceRef = await putVerifiedPayload(payloadStore, {
      value: verifiedEvidence.evidence,
      payloadSchema: ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      label: 'commitVerifiedWorkflowActivityTerminal.evidenceRef',
    });
    const sequence = state.head.sequence + 1;
    let outputRef;
    /** @type {Record<string, any>} */
    let materialized;
    if (terminal.type === 'completed') {
      const outputPayload = normalizeWorkflowOutputPayload(
        {
          schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
          kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
          value: terminal.result,
        },
        'commitVerifiedWorkflowActivityTerminal.output',
      );
      outputRef = await putVerifiedPayload(payloadStore, {
        value: outputPayload,
        payloadSchema: WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
        label: 'commitVerifiedWorkflowActivityTerminal.outputRef',
      });
      const nextStep =
        verified.planPayload.definition.steps[authority.cursor.stepIndex + 1];
      let selectedOutput;
      if (
        nextStep?.kind === 'activity' &&
        nextStep.input.kind === 'step-output' &&
        nextStep.input.step !== authority.cursor.stepId
      ) {
        selectedOutput = selectWorkflowStepOutput(
          nextStep,
          verified.outputs,
          'commitVerifiedWorkflowActivityTerminal successor',
        );
      }
      materialized = materializeWorkflowActivitySuccess({
        currentCursor: authority.cursor,
        planPayload: verified.planPayload,
        planRef: authority.cursor.planRef,
        startPayload: verified.startPayload,
        startRef: authority.cursor.startRef,
        outputPayload,
        outputRef,
        ...(selectedOutput ? { selectedOutput } : {}),
        sequence,
        observedAt: common.observedAt,
      });
    } else {
      materialized = materializeWorkflowActivityFailure({
        currentCursor: authority.cursor,
        planPayload: verified.planPayload,
        planRef: authority.cursor.planRef,
        startPayload: verified.startPayload,
        startRef: authority.cursor.startRef,
        outcome: terminal.type,
        sequence,
        observedAt: common.observedAt,
      });
    }
    let nextAdditionalInvocation;
    if (materialized.nextActivity) {
      const nextRequestRef = await putVerifiedPayload(payloadStore, {
        value: materialized.nextActivity.activityRequest,
        payloadSchema: ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
        label: 'commitVerifiedWorkflowActivityTerminal.nextRequestRef',
      });
      nextAdditionalInvocation = {
        schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
        runId: common.runId,
        invocationId: materialized.nextActivity.invocationId,
        appId: state.run.appId,
        revisionId: state.run.revisionId,
        activityId: materialized.nextActivity.activityId,
        requestRef: nextRequestRef,
        status: InvocationStatus.RUNNABLE,
        generation: 0,
        version: 1,
        lastSequence: sequence,
        createdAt: common.observedAt,
        updatedAt: common.observedAt,
        workflow: {
          workflowId: authority.cursor.workflowId,
          planId: authority.cursor.planId,
          continuationId: materialized.nextActivity.continuationId,
          stepId: materialized.nextActivity.stepId,
          stepIndex: materialized.nextActivity.stepIndex,
        },
      };
    }
    const terminalSummary = createTerminalSummary(terminal);
    const eventType =
      terminal.type === 'completed'
        ? 'workflow-activity-succeeded'
        : 'workflow-activity-failed';
    const terminalStatuses = statusesForTerminal(terminal);
    const nextRun = {
      ...cloneJsonObject(state.run, 'current workflow run'),
      status:
        terminal.type === 'completed'
          ? materialized.completed
            ? RunStatus.COMPLETED
            : RunStatus.RUNNING
          : terminalStatuses.run,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = {
      ...cloneJsonObject(authority.invocation, 'current workflow invocation'),
      status: terminalStatuses.invocation,
      version: authority.invocation.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      terminal: terminalSummary,
    };
    const nextAttempt = {
      ...cloneJsonObject(attempt, 'current workflow attempt'),
      status: terminalStatuses.attempt,
      version: attempt.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
      terminal: terminalSummary,
      evidenceRef,
    };
    const successor = nextAdditionalInvocation
      ? {
          continuationId: nextAdditionalInvocation.workflow.continuationId,
          stepId: nextAdditionalInvocation.workflow.stepId,
          stepIndex: nextAdditionalInvocation.workflow.stepIndex,
          invocationId: nextAdditionalInvocation.invocationId,
          activityId: nextAdditionalInvocation.activityId,
          requestRef: nextAdditionalInvocation.requestRef,
        }
      : null;
    const requestDigest = createTransitionRequestDigest(eventType, {
      runId: common.runId,
      invocationId,
      cursor: guard,
      attemptId,
      fencingToken,
      generation,
      expectedVersion: common.expectedVersion,
      transitionId: common.transitionId,
      terminal: terminalSummary,
      evidenceRef,
      ...(terminal.type === 'completed' ? { outputRef, successor } : {}),
      actor: common.actor,
      coordinatorEpoch: common.coordinatorEpoch,
    });
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
        workflowCursor: materialized.cursor,
        attempt: nextAttempt,
        ...(nextAdditionalInvocation
          ? { nextInvocation: nextAdditionalInvocation }
          : {}),
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
        nextAdditionalInvocation,
        nextWorkflowCursor: materialized.cursor,
        nextAttempt,
        currentAttempt: attempt,
      })
    );
  }

  /**
   * Resolve one retained uncertain workflow activity from a supported complete
   * verified terminal transcript. The abandoned physical attempt is never
   * rewritten; completed evidence may advance output/successor state, while
   * failure evidence terminalizes only the logical invocation, cursor, and run.
   * @param {{runId: string, invocationId: string, cursor: {version: number, continuationId: string, stepId: string, stepIndex: number}, attemptId: string, fencingToken: string, generation: number, coordinatorEpoch?: number, expectedVersion: number, uncertaintyEventId: string, uncertaintySequence: number, transitionId: string, reconciliationId: string, reason: Record<string, any>, evidence: Record<string, any>, actor?: {kind: string, id: string}, observedAt?: number}} options - Evidence-backed uncertain workflow resolution.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>, attempt: Record<string, any>, outputRef?: Record<string, any>, nextInvocation?: Record<string, any>}>} - Compound reconciliation outcome.
   */
  async function reconcileUncertainWorkflowActivityAttempt(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'reconcileUncertainWorkflowActivityAttempt',
    );
    const common = normalizeTransitionOptions(
      value,
      [
        'runId',
        'invocationId',
        'cursor',
        'attemptId',
        'fencingToken',
        'generation',
        'coordinatorEpoch',
        'expectedVersion',
        'uncertaintyEventId',
        'uncertaintySequence',
        'transitionId',
        'reconciliationId',
        'reason',
        'evidence',
        'actor',
        'observedAt',
      ],
      'reconcileUncertainWorkflowActivityAttempt',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'reconcileUncertainWorkflowActivityAttempt.invocationId',
    );
    const guard = normalizeWorkflowCursorGuard(
      value.cursor,
      'reconcileUncertainWorkflowActivityAttempt.cursor',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'reconcileUncertainWorkflowActivityAttempt.attemptId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'reconcileUncertainWorkflowActivityAttempt.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'reconcileUncertainWorkflowActivityAttempt.generation',
    );
    const reconciliationId = assertOpaqueId(
      value.reconciliationId,
      'reconcileUncertainWorkflowActivityAttempt.reconciliationId',
    );
    const uncertaintyEventId = assertOpaqueId(
      value.uncertaintyEventId,
      'reconcileUncertainWorkflowActivityAttempt.uncertaintyEventId',
    );
    const uncertaintySequence = assertPositiveSafeInteger(
      value.uncertaintySequence,
      'reconcileUncertainWorkflowActivityAttempt.uncertaintySequence',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'reconcileUncertainWorkflowActivityAttempt.reason',
    );
    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
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
        existingReceipt.type !== 'workflow-activity-uncertainty-reconciled' ||
        existingReceipt.invocation_id !== invocationId ||
        existingReceipt.attempt_id !== attemptId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingEvent = receiptState.events[existingReceipt.sequence - 1];
      const snapshots = existingEvent
        ? eventSnapshots(existingEvent, common.runId)
        : undefined;
      const persistedReconciliation = snapshots?.reconciliation;
      const persistedCursor = snapshots?.workflowCursor;
      const persistedAttempt = receiptState.attempts.get(
        attemptMapKey(invocationId, attemptId),
      );
      const uncertaintyEvent = persistedReconciliation
        ? receiptState.events[persistedReconciliation.uncertaintySequence - 1]
        : undefined;
      const uncertaintySnapshots = uncertaintyEvent
        ? eventSnapshots(uncertaintyEvent, common.runId)
        : undefined;
      const priorCursor = uncertaintySnapshots?.workflowCursor;
      if (
        !existingEvent ||
        existingEvent.event_id !== existingReceipt.event_id ||
        !snapshots ||
        !persistedReconciliation ||
        !persistedCursor ||
        !persistedAttempt ||
        !uncertaintyEvent ||
        uncertaintyEvent.type !== 'workflow-activity-became-uncertain' ||
        uncertaintyEvent.event_id !==
          persistedReconciliation.uncertaintyEventId ||
        !uncertaintySnapshots ||
        !priorCursor ||
        !hasSameCanonicalJson(workflowCursorGuard(priorCursor), guard)
      ) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'workflow reconciliation receipt snapshots are unavailable',
        );
      }
      const payloadReader = createLedgerPayloadReader(
        payloadStore,
        common.runId,
      );
      const verifiedEvidence = validateLedgerAttemptEvidence(
        value.evidence,
        await createLedgerAttemptStart(
          uncertaintySnapshots.run,
          uncertaintySnapshots.invocation,
          persistedAttempt,
          payloadReader,
        ),
        'reconcileUncertainWorkflowActivityAttempt.evidence',
      );
      assertSupportedWorkflowActivityTerminal(
        verifiedEvidence.terminal,
        verifiedEvidence.evidence,
        'reconcileUncertainWorkflowActivityAttempt.evidence',
      );
      await assertAttemptEvidenceMatchesManagedEffects(
        verifiedEvidence.evidence,
        persistedAttempt,
        /** @type {{effects: Map<string, Record<string, any>>}} */ (
          receiptState
        ),
        payloadReader,
        effectVerifierRegistry,
        common.runId,
      );
      assertWorkflowActivityHasNoManagedEffects(
        receiptState,
        persistedAttempt,
        'reconcileUncertainWorkflowActivityAttempt',
      );
      const terminal = verifiedEvidence.terminal;
      if (
        terminal.attemptId !== attemptId ||
        !hasSameCanonicalJson(
          await payloadReader.readEvidence(persistedReconciliation.evidenceRef),
          verifiedEvidence.evidence,
        )
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      let outputRef = null;
      let successor = null;
      if (terminal.type === 'completed') {
        const outputBinding = persistedCursor.outputs[priorCursor.stepIndex];
        if (
          !outputBinding ||
          outputBinding.stepId !== priorCursor.stepId ||
          outputBinding.stepIndex !== priorCursor.stepIndex
        ) {
          throw new ExecutionLedgerProjectionError(
            common.runId,
            'workflow reconciliation receipt output is unavailable',
          );
        }
        const outputPayload = await payloadReader.readWorkflowOutput(
          outputBinding.outputRef,
        );
        if (!hasSameCanonicalJson(outputPayload.value, terminal.result)) {
          throw new ExecutionLedgerTransitionConflictError(
            common.runId,
            common.transitionId,
          );
        }
        outputRef = outputBinding.outputRef;
        successor = snapshots.nextInvocation
          ? {
              continuationId: snapshots.nextInvocation.workflow?.continuationId,
              stepId: snapshots.nextInvocation.workflow?.stepId,
              stepIndex: snapshots.nextInvocation.workflow?.stepIndex,
              invocationId: snapshots.nextInvocation.invocationId,
              activityId: snapshots.nextInvocation.activityId,
              requestRef: snapshots.nextInvocation.requestRef,
            }
          : null;
      } else if (snapshots.nextInvocation) {
        throw new ExecutionLedgerProjectionError(
          common.runId,
          'failed workflow reconciliation retains a successor invocation',
        );
      }
      const requestDigest = createTransitionRequestDigest(
        'workflow-activity-uncertainty-reconciled',
        {
          runId: common.runId,
          invocationId,
          cursor: guard,
          attemptId,
          fencingToken,
          generation,
          expectedVersion: common.expectedVersion,
          transitionId: common.transitionId,
          reconciliationId,
          uncertaintyEventId,
          uncertaintySequence,
          verifier: persistedReconciliation.verifier,
          evidenceRef: persistedReconciliation.evidenceRef,
          terminal: createTerminalSummary(terminal),
          outputRef,
          successor,
          reason,
          actor: common.actor,
          coordinatorEpoch: common.coordinatorEpoch,
        },
      );
      const existing = assertMatchingReceipt(
        receiptState,
        existingReceipt,
        requestDigest,
      );
      return /** @type {any} */ (
        await existingTransitionResult(
          receiptState,
          /** @type {Record<string, any>} */ (existing),
        )
      );
    }
    if (state.head.version !== common.expectedVersion) {
      throw new ExecutionLedgerConflictError(common.runId, 'stale run version');
    }
    const authority = getUncertainWorkflowActivityAuthority(
      state,
      invocationId,
      guard,
      'reconcileUncertainWorkflowActivityAttempt',
    );
    const verified = await verifyWorkflowCursorActivity(
      state,
      authority.cursor,
      authority.invocation,
      'reconcileUncertainWorkflowActivityAttempt',
    );
    assertWorkflowActivityDispatchSupported(
      state,
      authority.cursor,
      verified.planPayload,
      'reconcileUncertainWorkflowActivityAttempt',
    );
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const uncertaintyEvent = state.events[uncertaintySequence - 1];
    if (
      !attempt ||
      authority.invocation.generation !== generation ||
      attempt.status !== AttemptStatus.ABANDONED ||
      !hasExactWorkflowActivityUncertaintyEventLink({
        run: state.run,
        invocation: authority.invocation,
        workflowCursor: authority.cursor,
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
        'workflow attempt is not the retained uncertain activity attempt',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    assertWorkflowActivityHasNoManagedEffects(
      state,
      attempt,
      'reconcileUncertainWorkflowActivityAttempt',
    );
    if (
      common.observedAt < state.run.updatedAt ||
      common.observedAt < authority.cursor.updatedAt ||
      common.observedAt < attempt.updatedAt
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'workflow reconciliation observation precedes durable state',
      );
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const verifiedEvidence = validateLedgerAttemptEvidence(
      value.evidence,
      await createLedgerAttemptStart(
        state.run,
        authority.invocation,
        attempt,
        payloadReader,
      ),
      'reconcileUncertainWorkflowActivityAttempt.evidence',
    );
    assertSupportedWorkflowActivityTerminal(
      verifiedEvidence.terminal,
      verifiedEvidence.evidence,
      'reconcileUncertainWorkflowActivityAttempt.evidence',
    );
    await assertAttemptEvidenceMatchesManagedEffects(
      verifiedEvidence.evidence,
      attempt,
      state,
      payloadReader,
      effectVerifierRegistry,
      common.runId,
    );
    const terminal = verifiedEvidence.terminal;
    if (terminal.attemptId !== attemptId) {
      throw new TypeError(
        'reconcileUncertainWorkflowActivityAttempt.evidence must end with a supported terminal for the exact retained attempt.',
      );
    }
    const evidenceRef = await putVerifiedPayload(payloadStore, {
      value: verifiedEvidence.evidence,
      payloadSchema: ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      label: 'reconcileUncertainWorkflowActivityAttempt.evidenceRef',
    });
    const sequence = state.head.sequence + 1;
    let outputRef = null;
    /** @type {Record<string, any>} */
    let materialized;
    if (terminal.type === 'completed') {
      const outputPayload = normalizeWorkflowOutputPayload(
        {
          schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
          kind: WORKFLOW_OUTPUT_PAYLOAD_KIND,
          value: terminal.result,
        },
        'reconcileUncertainWorkflowActivityAttempt.output',
      );
      outputRef = await putVerifiedPayload(payloadStore, {
        value: outputPayload,
        payloadSchema: WORKFLOW_OUTPUT_PAYLOAD_SCHEMA,
        label: 'reconcileUncertainWorkflowActivityAttempt.outputRef',
      });
      const nextStep =
        verified.planPayload.definition.steps[authority.cursor.stepIndex + 1];
      let selectedOutput;
      if (
        nextStep?.kind === 'activity' &&
        nextStep.input.kind === 'step-output' &&
        nextStep.input.step !== authority.cursor.stepId
      ) {
        selectedOutput = selectWorkflowStepOutput(
          nextStep,
          verified.outputs,
          'reconcileUncertainWorkflowActivityAttempt successor',
        );
      }
      materialized = materializeUncertainWorkflowActivitySuccess({
        currentCursor: authority.cursor,
        planPayload: verified.planPayload,
        planRef: authority.cursor.planRef,
        startPayload: verified.startPayload,
        startRef: authority.cursor.startRef,
        outputPayload,
        outputRef,
        ...(selectedOutput ? { selectedOutput } : {}),
        sequence,
        observedAt: common.observedAt,
      });
    } else {
      materialized = materializeUncertainWorkflowActivityFailure({
        currentCursor: authority.cursor,
        planPayload: verified.planPayload,
        planRef: authority.cursor.planRef,
        startPayload: verified.startPayload,
        startRef: authority.cursor.startRef,
        outcome: terminal.type,
        sequence,
        observedAt: common.observedAt,
      });
    }
    let nextAdditionalInvocation;
    if (materialized.nextActivity) {
      const nextRequestRef = await putVerifiedPayload(payloadStore, {
        value: materialized.nextActivity.activityRequest,
        payloadSchema: ACTIVITY_REQUEST_PAYLOAD_SCHEMA,
        label: 'reconcileUncertainWorkflowActivityAttempt.nextRequestRef',
      });
      nextAdditionalInvocation = {
        schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
        runId: common.runId,
        invocationId: materialized.nextActivity.invocationId,
        appId: state.run.appId,
        revisionId: state.run.revisionId,
        activityId: materialized.nextActivity.activityId,
        requestRef: nextRequestRef,
        status: InvocationStatus.RUNNABLE,
        generation: 0,
        version: 1,
        lastSequence: sequence,
        createdAt: common.observedAt,
        updatedAt: common.observedAt,
        workflow: {
          workflowId: authority.cursor.workflowId,
          planId: authority.cursor.planId,
          continuationId: materialized.nextActivity.continuationId,
          stepId: materialized.nextActivity.stepId,
          stepIndex: materialized.nextActivity.stepIndex,
        },
      };
    }
    const terminalSummary = createTerminalSummary(terminal);
    const terminalStatuses = statusesForTerminal(terminal);
    const nextRun = {
      ...cloneJsonObject(state.run, 'current workflow run'),
      status:
        terminal.type === 'completed'
          ? materialized.completed
            ? RunStatus.COMPLETED
            : RunStatus.RUNNING
          : terminalStatuses.run,
      version: state.run.version + 1,
      lastSequence: sequence,
      updatedAt: common.observedAt,
    };
    const nextInvocation = cloneJsonObject(
      authority.invocation,
      'current uncertain workflow invocation',
    );
    delete nextInvocation.uncertainty;
    nextInvocation.status = terminalStatuses.invocation;
    nextInvocation.version = authority.invocation.version + 1;
    nextInvocation.lastSequence = sequence;
    nextInvocation.updatedAt = common.observedAt;
    nextInvocation.terminal = terminalSummary;
    const reconciliation = normalizeUncertainAttemptReconciliation(
      {
        reconciliationId,
        invocationId,
        attemptId,
        generation,
        coordinatorEpoch: common.coordinatorEpoch,
        fencingToken,
        uncertaintyEventId,
        uncertaintySequence,
        verifier: UNCERTAIN_ATTEMPT_RECONCILIATION_VERIFIER,
        evidenceRef,
        terminal: terminalSummary,
        reason,
      },
      'reconcileUncertainWorkflowActivityAttempt.reconciliation',
    );
    const successor = nextAdditionalInvocation
      ? {
          continuationId: nextAdditionalInvocation.workflow.continuationId,
          stepId: nextAdditionalInvocation.workflow.stepId,
          stepIndex: nextAdditionalInvocation.workflow.stepIndex,
          invocationId: nextAdditionalInvocation.invocationId,
          activityId: nextAdditionalInvocation.activityId,
          requestRef: nextAdditionalInvocation.requestRef,
        }
      : null;
    const requestDigest = createTransitionRequestDigest(
      'workflow-activity-uncertainty-reconciled',
      {
        runId: common.runId,
        invocationId,
        cursor: guard,
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
        outputRef,
        successor,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
    );
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'workflow-activity-uncertainty-reconciled',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        workflowCursor: materialized.cursor,
        reconciliation,
        ...(nextAdditionalInvocation
          ? { nextInvocation: nextAdditionalInvocation }
          : {}),
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
        nextAdditionalInvocation,
        nextWorkflowCursor: materialized.cursor,
      })
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
    assertManualLifecycleRun(state, 'claimInvocation');
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
    assertManualLifecycleRun(state, 'markAttemptStarted');
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
    assertManualLifecycleRun(state, 'recordManagedEffectRequest');
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
    assertManagedEffectSuccessorPlannedRequest({
      run: state.run,
      invocation,
      effect: prospectiveEffect,
      request: logicalRequest,
      priorEffects: [...state.effects.values()],
    });
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
    assertManualLifecycleRun(state, 'markManagedEffectStarted');
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
    assertManualLifecycleRun(state, 'commitManagedEffectOutcome');
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
    assertManualLifecycleRun(state, 'markManagedEffectUncertain');
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
    assertManualLifecycleRun(state, 'settleStoppedAttemptManagedEffects');
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
    assertManualLifecycleRun(state, 'commitVerifiedAttemptTerminal');
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
    await assertManagedEffectSuccessorTerminal({
      run: state.run,
      invocation,
      terminal,
      effects: state.effects,
      payloadReader,
    });
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
    assertManualLifecycleRun(state, 'markAttemptUncertain');
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
   * Resolve one uncertain managed effect from immutable destination evidence.
   * The stopped attempt remains byte-identical ABANDONED and the aggregate
   * remains BLOCKED/UNCERTAIN; only the effect acquires a durable disposition.
   * @param {{runId: string, invocationId: string, attemptId: string, effectId: string, fencingToken: string, generation: number, coordinatorEpoch: number, expectedVersion: number, expectedEffectVersion: number, uncertaintyEventId: string, uncertaintySequence: number, transitionId: string, reconciliationId: string, actor?: {kind: string, id: string}, reason: Record<string, any>, resolution: {kind: 'outcome', outcome: Record<string, any>} | {kind: 'not-applied', verifier: {kind: string, version: number}, evidence: Record<string, any>}, observedAt?: number}} options - Evidence-backed uncertain-effect reconciliation request.
   * @returns {Promise<{applied: boolean, receipt: Record<string, any>, run: Record<string, any>, invocation: Record<string, any>, attempt?: Record<string, any>, effect?: Record<string, any>}>} - Reconciliation outcome.
   */
  async function reconcileUncertainManagedEffect(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'reconcileUncertainManagedEffect',
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
        'coordinatorEpoch',
        'expectedVersion',
        'expectedEffectVersion',
        'uncertaintyEventId',
        'uncertaintySequence',
        'transitionId',
        'reconciliationId',
        'actor',
        'reason',
        'resolution',
        'observedAt',
      ],
      'reconcileUncertainManagedEffect',
      now,
    );
    const invocationId = assertOpaqueId(
      value.invocationId,
      'reconcileUncertainManagedEffect.invocationId',
    );
    const attemptId = assertOpaqueId(
      value.attemptId,
      'reconcileUncertainManagedEffect.attemptId',
    );
    const effectId = assertOpaqueId(
      value.effectId,
      'reconcileUncertainManagedEffect.effectId',
    );
    const fencingToken = assertOpaqueId(
      value.fencingToken,
      'reconcileUncertainManagedEffect.fencingToken',
    );
    const generation = assertPositiveSafeInteger(
      value.generation,
      'reconcileUncertainManagedEffect.generation',
    );
    const expectedEffectVersion = assertPositiveSafeInteger(
      value.expectedEffectVersion,
      'reconcileUncertainManagedEffect.expectedEffectVersion',
    );
    const reconciliationId = assertOpaqueId(
      value.reconciliationId,
      'reconcileUncertainManagedEffect.reconciliationId',
    );
    const uncertaintyEventId = assertOpaqueId(
      value.uncertaintyEventId,
      'reconcileUncertainManagedEffect.uncertaintyEventId',
    );
    const uncertaintySequence = assertPositiveSafeInteger(
      value.uncertaintySequence,
      'reconcileUncertainManagedEffect.uncertaintySequence',
    );
    const reason = cloneInlinePayload(
      value.reason,
      'reconcileUncertainManagedEffect.reason',
    );
    const resolution = cloneBoundedJsonObject(
      value.resolution,
      EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
      'reconcileUncertainManagedEffect.resolution',
    );
    if (resolution.kind === 'outcome') {
      assertExactKeys(
        resolution,
        ['kind', 'outcome'],
        'reconcileUncertainManagedEffect.resolution',
      );
    } else if (resolution.kind === 'not-applied') {
      assertExactKeys(
        resolution,
        ['kind', 'verifier', 'evidence'],
        'reconcileUncertainManagedEffect.resolution',
      );
    } else {
      throw new TypeError(
        'reconcileUncertainManagedEffect.resolution.kind is not supported.',
      );
    }

    const state = await readVerifiedRun(common.runId);
    if (!state) throw new ExecutionLedgerNotFoundError(common.runId);
    assertManualLifecycleRun(state, 'reconcileUncertainManagedEffect');
    const invocation = state.invocations.get(invocationId);
    const attempt = state.attempts.get(attemptMapKey(invocationId, attemptId));
    const effect = state.effects.get(effectMapKey(invocationId, effectId));
    if (!invocation || !attempt || !effect) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'managed effect does not belong to this stopped attempt',
      );
    }
    const payloadReader = createLedgerPayloadReader(payloadStore, common.runId);
    const request = await payloadReader.readManagedEffectRequest(
      effect.requestRef,
    );
    /** @type {ReturnType<typeof normalizeManagedEffectOutcome> | undefined} */
    let outcome;
    /** @type {Record<string, any> | undefined} */
    let negativeEvidence;
    /** @type {{kind: string, version: number}} */
    let verifier;
    /** @type {string} */
    let resolutionStatus;
    if (resolution.kind === 'outcome') {
      if (resolution.outcome?.ok === true) {
        assertExactKeys(
          resolution.outcome,
          ['ok', 'result', 'evidence'],
          'reconcileUncertainManagedEffect.resolution.outcome',
        );
      } else if (resolution.outcome?.ok === false) {
        assertExactKeys(
          resolution.outcome,
          ['ok', 'error', 'evidence'],
          'reconcileUncertainManagedEffect.resolution.outcome',
        );
      } else {
        throw new TypeError(
          'reconcileUncertainManagedEffect.resolution.outcome.ok must be a boolean.',
        );
      }
      outcome = normalizeManagedEffectOutcome(
        {
          destinationEffectId: effect.destinationEffectId,
          adapter: effect.adapter,
          destination: effect.destination,
          verifier: effect.verifier,
          ok: resolution.outcome?.ok,
          ...(resolution.outcome?.ok === true
            ? { result: resolution.outcome.result }
            : { error: resolution.outcome?.error }),
          substantiatedReplayProperties: effect.substantiatedReplayProperties,
          evidence: resolution.outcome?.evidence,
        },
        'reconcileUncertainManagedEffect.resolution.outcome',
      );
      verifyManagedEffectOutcome(
        effectVerifierRegistry,
        effect,
        request,
        outcome,
        'reconcileUncertainManagedEffect.resolution.outcome',
      );
      verifier = cloneInlinePayload(
        effect.verifier,
        'reconcileUncertainManagedEffect outcome verifier',
      );
      resolutionStatus = outcome.ok
        ? EffectStatus.COMPLETED
        : EffectStatus.FAILED;
    } else {
      verifier = normalizeEffectVerifierDescriptor(
        resolution.verifier,
        'reconcileUncertainManagedEffect.resolution.verifier',
      );
      negativeEvidence = cloneReferencedPayloadObject(
        resolution.evidence,
        'reconcileUncertainManagedEffect.resolution.evidence',
      );
      verifyManagedEffectReconciliationEvidence(
        effectVerifierRegistry,
        effect,
        request,
        verifier,
        negativeEvidence,
        'reconcileUncertainManagedEffect.resolution.evidence',
      );
      resolutionStatus = EffectStatus.NOT_APPLIED;
    }

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
      if (
        retainedReceipt.type !== 'uncertain-effect-reconciled' ||
        retainedReceipt.invocation_id !== invocationId ||
        retainedReceipt.attempt_id !== attemptId ||
        retainedReceipt.effect_id !== effectId
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingEvent = receiptState.events[retainedReceipt.sequence - 1];
      const existingReconciliation = existingEvent
        ? eventSnapshots(existingEvent, common.runId).reconciliation
        : undefined;
      if (
        !existingReconciliation ||
        existingReconciliation.resolutionStatus !== resolutionStatus ||
        !hasSameCanonicalJson(existingReconciliation.verifier, verifier)
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const existingEvidence =
        resolutionStatus === EffectStatus.NOT_APPLIED
          ? await payloadReader.readManagedEffectReconciliationEvidence(
              existingReconciliation.evidenceRef,
            )
          : await payloadReader.readManagedEffectOutcome(
              existingReconciliation.evidenceRef,
            );
      if (
        !hasSameCanonicalJson(existingEvidence, negativeEvidence || outcome)
      ) {
        throw new ExecutionLedgerTransitionConflictError(
          common.runId,
          common.transitionId,
        );
      }
      const requestDigest = createTransitionRequestDigest(
        'uncertain-effect-reconciled',
        {
          runId: common.runId,
          invocationId,
          attemptId,
          effectId,
          fencingToken,
          generation,
          expectedVersion: common.expectedVersion,
          expectedEffectVersion,
          transitionId: common.transitionId,
          reconciliationId,
          uncertaintyEventId,
          uncertaintySequence,
          verifier,
          evidenceRef: existingReconciliation.evidenceRef,
          resolutionStatus,
          reason,
          actor: common.actor,
          coordinatorEpoch: common.coordinatorEpoch,
        },
      );
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
    const uncertaintyEvent = state.events[uncertaintySequence - 1];
    const effectReconciliationLink = {
      invocationId,
      attemptId,
      effectId,
      generation,
      coordinatorEpoch: common.coordinatorEpoch,
      fencingToken,
      uncertaintyEventId,
      uncertaintySequence,
    };
    if (
      state.run.status !== RunStatus.BLOCKED ||
      invocation.status !== InvocationStatus.UNCERTAIN ||
      invocation.generation !== generation ||
      attempt.status !== AttemptStatus.ABANDONED ||
      effect.status !== EffectStatus.UNCERTAIN ||
      effect.version !== expectedEffectVersion ||
      !hasExactEffectUncertaintyEventLink({
        run: state.run,
        invocation,
        attempt,
        effect,
        reconciliation: effectReconciliationLink,
        uncertaintyEvent,
        runId: common.runId,
      })
    ) {
      throw new ExecutionLedgerConflictError(
        common.runId,
        'effect is not the retained uncertain managed effect',
      );
    }
    assertCurrentAttemptFence(
      attempt,
      { coordinatorEpoch: common.coordinatorEpoch, fencingToken, generation },
      common.runId,
    );
    const evidenceRef = await putVerifiedPayload(payloadStore, {
      value: negativeEvidence || outcome,
      payloadSchema:
        resolutionStatus === EffectStatus.NOT_APPLIED
          ? MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA
          : MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
      label: 'reconcileUncertainManagedEffect.evidenceRef',
    });
    const reconciliation = {
      reconciliationId,
      ...effectReconciliationLink,
      verifier,
      evidenceRef,
      resolutionStatus,
      reason,
    };
    const requestDigest = createTransitionRequestDigest(
      'uncertain-effect-reconciled',
      {
        runId: common.runId,
        invocationId,
        attemptId,
        effectId,
        fencingToken,
        generation,
        expectedVersion: common.expectedVersion,
        expectedEffectVersion,
        transitionId: common.transitionId,
        reconciliationId,
        uncertaintyEventId,
        uncertaintySequence,
        verifier,
        evidenceRef,
        resolutionStatus,
        reason,
        actor: common.actor,
        coordinatorEpoch: common.coordinatorEpoch,
      },
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
    const nextEffect = cloneJsonObject(effect, 'current effect');
    delete nextEffect.uncertainty;
    nextEffect.status = resolutionStatus;
    nextEffect.reconciliation = reconciliation;
    if (outcome) {
      nextEffect.terminal = { ok: outcome.ok };
      nextEffect.outcomeRef = evidenceRef;
    }
    nextEffect.version = effect.version + 1;
    nextEffect.lastSequence = sequence;
    nextEffect.updatedAt = common.observedAt;
    const event = createEventRecord(
      common.runId,
      sequence,
      common.transitionId,
      requestDigest,
      'uncertain-effect-reconciled',
      common.observedAt,
      common.actor,
      {
        coordinatorEpoch: common.coordinatorEpoch,
        invocationGeneration: generation,
      },
      {
        run: nextRun,
        invocation: nextInvocation,
        effect: nextEffect,
        reconciliation,
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
      nextEffect,
      currentEffect: effect,
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
    assertManualLifecycleRun(state, 'reconcileUncertainManualAttempt');
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
    await assertManagedEffectSuccessorTerminal({
      run: state.run,
      invocation,
      terminal,
      effects: state.effects,
      payloadReader,
    });
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
    assertManualLifecycleRun(state, 'abandonUnstartedAttempt');
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
   * Reconcile one known run's replaceable ready-work locator from its
   * authoritative event fold. This is a liveness repair only: the run head is
   * condition-checked and the repaired row still grants no execution
   * authority. Supplying an observed stale row also removes that exact extra
   * locator in the same transaction.
   * @param {{appId: string, revisionId: string, runId: string, observed?: Record<string, any>}} options - Exact run and optional stale locator.
   * @returns {Promise<{applied: boolean, runId: string, expected?: Record<string, any>}>} - Repair result.
   */
  async function repairReadyWork(options) {
    const value = cloneBoundedJsonObject(
      options,
      EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES,
      'repairReadyWork',
    );
    assertSupportedKeys(
      value,
      ['appId', 'revisionId', 'runId', 'observed'],
      'repairReadyWork',
    );
    assertLogicalId(value.appId, 'repairReadyWork.appId');
    assertApplicationRevisionId(value.revisionId, 'repairReadyWork.revisionId');
    const runId = assertOpaqueId(value.runId, 'repairReadyWork.runId');
    const state = await readVerifiedRun(runId);
    if (!state) throw new ExecutionLedgerNotFoundError(runId);
    if (
      state.run.appId !== value.appId ||
      state.run.revisionId !== value.revisionId
    ) {
      throw new ExecutionLedgerConflictError(
        runId,
        'ready-work repair scope mismatch',
      );
    }
    const invocations = [...state.invocations.values()];
    const invocation =
      state.run.trigger.kind === 'workflow' && state.workflowCursor
        ? state.invocations.get(state.workflowCursor.invocationId)
        : invocations.length === 1
          ? invocations[0]
          : undefined;
    if (!invocation) {
      throw new ExecutionLedgerProjectionError(
        runId,
        'ready-work repair cannot identify the current invocation',
      );
    }
    const expected = createLifecycleReadyWorkRecord(
      state.run,
      invocation,
      getReadyWorkAttempt(state, invocation),
      state.workflowCursor,
    );
    const observed = Object.prototype.hasOwnProperty.call(value, 'observed')
      ? createExecutionLedgerReadyWorkRecord(value.observed)
      : undefined;
    if (
      observed &&
      (observed.app_id !== value.appId ||
        observed.revision_id !== value.revisionId ||
        observed.ledger_run_id !== runId)
    ) {
      throw new TypeError(
        'repairReadyWork.observed must name the exact requested run scope.',
      );
    }
    const expectedStored = expected
      ? await db.get({
          tableName: resolvedTableName,
          keyName: KEY_NAME,
          keyValue: expected[KEY_NAME],
          sortKeyName: SORT_KEY_NAME,
          sortKeyValue: expected[SORT_KEY_NAME],
          consistentRead: true,
        })
      : undefined;
    const expectedIsExact = Boolean(
      expectedStored && hasSameCanonicalJson(expectedStored, expected),
    );
    const observedNamesExpected = Boolean(
      observed &&
      expected &&
      observed[KEY_NAME] === expected[KEY_NAME] &&
      observed[SORT_KEY_NAME] === expected[SORT_KEY_NAME],
    );
    if (expected && expectedIsExact && (!observed || observedNamesExpected)) {
      return {
        applied: false,
        runId,
        expected: createReadyWorkPageItem(expected),
      };
    }
    if (!expected && !observed) return { applied: false, runId };

    /** @type {import('../base.js').TransactionConditionCheck[]} */
    const conditionChecks = [
      {
        keyName: KEY_NAME,
        keyValue: runId,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: getRunHeadSortKey(),
        conditions: [
          eq('version', state.head.version),
          eq('sequence', state.head.sequence),
          eq('revision_id', state.head.revision_id),
        ],
      },
    ];
    /** @type {import('../base.js').TransactionPutRequest[]} */
    const putRequests = [];
    /** @type {import('../base.js').TransactionDeleteRequest[]} */
    const deleteRequests = [];
    // The event-folded head is the only repair CAS. Projection bytes are
    // deliberately not conditions: they may be malformed, and every normal
    // lifecycle mutation advances this head while maintaining the row in the
    // same transaction. Concurrent repairs against one unchanged head are
    // therefore safely convergent writes of the same canonical locator.
    if (expected && !expectedIsExact) {
      putRequests.push({
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: expected,
      });
    }
    if (observed && !observedNamesExpected) {
      deleteRequests.push({
        keyName: KEY_NAME,
        keyValue: observed[KEY_NAME],
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: observed[SORT_KEY_NAME],
      });
    }

    try {
      await db.transactionWrite({
        tableName: resolvedTableName,
        conditionChecks,
        ...(putRequests.length === 0 ? {} : { putRequests }),
        ...(deleteRequests.length === 0 ? {} : { deleteRequests }),
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) {
        throw new ExecutionLedgerConflictError(
          runId,
          'ready-work repair raced another transition',
        );
      }
      throw error;
    }
    return {
      applied: true,
      runId,
      ...(expected === undefined
        ? {}
        : { expected: createReadyWorkPageItem(expected) }),
    };
  }

  /**
   * Read the earliest bounded set of currently eligible work for one exact
   * embedded application revision. Rows are strict locators only: callers
   * must rebuild the named run and win its ordinary fenced transition before
   * dispatch, recovery, timer firing, or continuation work.
   * @param {{appId: string, revisionId: string, limit?: number, observedAt?: number, cursor?: string}} options - Exact revision-scoped query.
   * @returns {Promise<{items: Record<string, any>[], nextCursor?: string}>} - Eligible locators in canonical order.
   */
  async function listReadyWork(options) {
    if (typeof db.queryPage !== 'function') {
      throw new Error(
        'createExecutionLedger requires a DB client with queryPage for ready work.',
      );
    }
    const request = normalizeReadyWorkPageOptions(options, now());
    const scope = createExecutionLedgerReadyWorkScope({
      appId: request.appId,
      revisionId: request.revisionId,
    });
    const startAfter = parseReadyWorkCursor(request.cursor, scope);
    const page = await db.queryPage({
      tableName: resolvedTableName,
      consistentRead: true,
      keyConditions: [
        pkEq(KEY_NAME, scope.readyWorkId),
        skBegins(SORT_KEY_NAME, EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX),
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
      throw new Error('DB queryPage returned an invalid ready-work page.');
    }

    /** @type {Record<string, any>[]} */
    const records = [];
    let previousSortKey = startAfter;
    let sawFutureBoundary = false;
    for (const raw of page.items) {
      if (
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw) ||
        typeof raw[SORT_KEY_NAME] !== 'string' ||
        !raw[SORT_KEY_NAME].startsWith(
          EXECUTION_LEDGER_READY_WORK_SORT_KEY_PREFIX,
        )
      ) {
        throw new Error('DB queryPage returned an invalid ready-work key.');
      }
      const sortKey = raw[SORT_KEY_NAME];
      if (
        previousSortKey !== undefined &&
        comparePortablePageKeys(sortKey, previousSortKey) <= 0
      ) {
        throw new Error('DB queryPage returned invalid ready-work order.');
      }
      previousSortKey = sortKey;
      try {
        if (
          parseExecutionLedgerReadyWorkSortKey(sortKey).availableAt >
          request.observedAt
        ) {
          sawFutureBoundary = true;
        }
      } catch {
        // A malformed locator is never returned as authority. Keeping its raw
        // key as the page boundary still lets the next page and healthy work
        // progress; a known run can be repaired from its event stream.
      }
      try {
        records.push(
          normalizeExecutionLedgerReadyWorkRecord(raw, {
            appId: request.appId,
            revisionId: request.revisionId,
          }),
        );
      } catch {
        // The index is a replaceable liveness projection. Corrupt rows are
        // skipped, never dispatched, and do not prevent cursor progress.
      }
    }
    const nextStartAfter = page.nextStartAfter;
    if (
      nextStartAfter !== undefined &&
      (typeof nextStartAfter !== 'string' ||
        page.items.length === 0 ||
        nextStartAfter !== page.items[page.items.length - 1][SORT_KEY_NAME])
    ) {
      throw new Error('DB queryPage returned an invalid ready-work cursor.');
    }
    return {
      items: records
        .filter((record) => record.available_at <= request.observedAt)
        .map(createReadyWorkPageItem),
      ...(nextStartAfter === undefined || sawFutureBoundary
        ? {}
        : { nextCursor: createReadyWorkCursor(scope, nextStartAfter) }),
    };
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
   * Read one manual invocation's immutable request and its exact creation
   * actor after verifying the complete event stream, every projection, and
   * the referenced request bytes. The creation actor is required when a
   * resident owner replays `createManualRun`: changing it would change the
   * immutable creation receipt instead of reaching the retained request.
   * @param {string} runId - Run identity.
   * @param {string} invocationId - Invocation identity.
   * @returns {Promise<{run: Record<string, any>, invocation: Record<string, any>, request: {input: any, callerMetadata: Record<string, any>}, actor: {kind: string, id: string}} | null>} - Verified manual request authority, or null when the run or invocation does not exist.
   */
  async function readManualRunRequest(runId, invocationId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const normalizedInvocationId = assertOpaqueId(invocationId, 'invocationId');
    const state = await readVerifiedRun(normalizedRunId);
    const invocation = state?.invocations.get(normalizedInvocationId);
    if (!state || !invocation) return null;

    const creationEvent = state.events[0];
    if (
      state.run.trigger?.kind !== 'manual' ||
      creationEvent?.sequence !== 1 ||
      creationEvent?.type !== 'manual-run-created'
    ) {
      throw new ExecutionLedgerProjectionError(
        normalizedRunId,
        'manual run creation authority is unavailable',
      );
    }
    const creation = eventSnapshots(creationEvent, normalizedRunId);
    if (
      creation.run.runId !== state.run.runId ||
      creation.invocation.invocationId !== normalizedInvocationId ||
      !hasSameCanonicalJson(
        creation.invocation.requestRef,
        invocation.requestRef,
      )
    ) {
      throw new ExecutionLedgerProjectionError(
        normalizedRunId,
        'manual run creation authority disagrees with invocation',
      );
    }
    const request = await createLedgerPayloadReader(
      payloadStore,
      normalizedRunId,
    ).readActivityRequest(invocation.requestRef);
    return {
      run: cloneJsonObject(state.run, 'manual request run'),
      invocation: cloneJsonObject(invocation, 'manual request invocation'),
      request: {
        input: cloneReferencedPayload(request.input, 'manual request input'),
        callerMetadata: cloneJsonObject(
          request.callerMetadata,
          'manual request caller metadata',
        ),
      },
      actor: {
        kind: creationEvent.actor.kind,
        id: creationEvent.actor.id,
      },
    };
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
   * @returns {Promise<{head: Record<string, any>, run: Record<string, any>, workflowCursor?: Record<string, any>, invocations: Record<string, any>[], attempts: Record<string, any>[], effects: Record<string, any>[], events: Record<string, any>[]}|null>} - Rebuilt run view.
   */
  async function rebuildRun(runId) {
    const normalizedRunId = assertOpaqueId(runId, 'runId');
    const state = await readVerifiedRun(normalizedRunId);
    if (!state) return null;
    return {
      head: cloneJsonObject(state.head, 'run head'),
      run: cloneJsonObject(state.run, 'run'),
      ...(state.workflowCursor
        ? {
            workflowCursor: cloneJsonObject(
              state.workflowCursor,
              'workflow cursor',
            ),
          }
        : {}),
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
    abandonUnstartedWorkflowActivityAttempt,
    authorizeManagedEffectSuccessorRetry,
    claimInvocation,
    claimWorkflowActivity,
    commitManagedEffectSuccessorOutcome,
    commitVerifiedAttemptTerminal,
    commitVerifiedWorkflowActivityTerminal,
    commitManagedEffectOutcome,
    createManualRun,
    createWorkflowRun,
    getAttempt,
    getEffect,
    getEvents,
    getInvocation,
    getRun,
    listReadyWork,
    listRuns,
    markAttemptStarted,
    markWorkflowActivityAttemptUncertain,
    markWorkflowActivityStarted,
    markAttemptUncertain,
    markManagedEffectStarted,
    markManagedEffectUncertain,
    interruptManagedEffectSuccessor,
    recordManagedEffectRequest,
    readManualRunRequest,
    readManagedEffectDelivery,
    reconcileUncertainManagedEffect,
    reconcileUncertainManualAttempt,
    reconcileUncertainWorkflowActivityAttempt,
    reconcileManagedEffectSuccessor,
    repairReadyWork,
    rebuildRun,
    requestManualRunCancellation,
    settleStoppedAttemptManagedEffects,
    startManagedEffectSuccessor,
  };
}

/**
 * @typedef ExecutionLedgerStore
 * @property {(...args: any[]) => Promise<any>} createManualRun - Creates one idempotent manual run.
 * @property {(...args: any[]) => Promise<any>} createWorkflowRun - Creates one idempotent activity-headed workflow run.
 * @property {(...args: any[]) => Promise<any>} claimWorkflowActivity - Claims one exact cursor-bound workflow activity generation.
 * @property {(...args: any[]) => Promise<any>} markWorkflowActivityStarted - Persists the dispatch boundary for one exact workflow activity attempt.
 * @property {(...args: any[]) => Promise<any>} commitVerifiedWorkflowActivityTerminal - Atomically commits one supported verified workflow activity terminal, with output and successor only for completion.
 * @property {(...args: any[]) => Promise<any>} abandonUnstartedWorkflowActivityAttempt - Safely releases one cursor-bound workflow claim that never started.
 * @property {(...args: any[]) => Promise<any>} markWorkflowActivityAttemptUncertain - Blocks one cursor-bound begun workflow attempt without retrying it.
 * @property {(...args: any[]) => Promise<any>} reconcileUncertainWorkflowActivityAttempt - Resolves one blocked workflow activity from exact supported terminal evidence while retaining its abandoned attempt.
 * @property {(...args: any[]) => Promise<any>} authorizeManagedEffectSuccessorRetry - Atomically appends source authorization and creates one fresh effect-only retry run.
 * @property {(...args: any[]) => Promise<any>} startManagedEffectSuccessor - Atomically starts a successor's sole retained effect and authorizes one physical dispatch.
 * @property {(...args: any[]) => Promise<any>} commitManagedEffectSuccessorOutcome - Atomically closes a successor's sole started effect and aggregate terminal state.
 * @property {(...args: any[]) => Promise<any>} interruptManagedEffectSuccessor - Atomically blocks a successor after a potentially begun destination delivery.
 * @property {(...args: any[]) => Promise<any>} reconcileManagedEffectSuccessor - Resolves a blocked successor from destination evidence without rewriting its abandoned attempt.
 * @property {(...args: any[]) => Promise<any>} claimInvocation - Claims the next physical generation.
 * @property {(...args: any[]) => Promise<any>} markAttemptStarted - Persists the handler-start boundary.
 * @property {(...args: any[]) => Promise<any>} commitVerifiedAttemptTerminal - Commits validated terminal evidence.
 * @property {(...args: any[]) => Promise<any>} recordManagedEffectRequest - Persists a logical effect before adapter start.
 * @property {(...args: any[]) => Promise<any>} markManagedEffectStarted - Persists that an adapter may have begun.
 * @property {(...args: any[]) => Promise<any>} commitManagedEffectOutcome - Commits verifier-backed destination outcome evidence.
 * @property {(...args: any[]) => Promise<any>} markManagedEffectUncertain - Blocks an aggregate on an ambiguous begun effect.
 * @property {(...args: any[]) => Promise<any>} settleStoppedAttemptManagedEffects - Atomically closes every unresolved effect for a stopped attempt.
 * @property {(...args: any[]) => Promise<any>} markAttemptUncertain - Blocks a begun ambiguous attempt.
 * @property {(...args: any[]) => Promise<any>} reconcileUncertainManagedEffect - Resolves one uncertain managed effect from immutable destination evidence.
 * @property {(...args: any[]) => Promise<any>} reconcileUncertainManualAttempt - Resolves one retained uncertain attempt from exact durable evidence.
 * @property {(...args: any[]) => Promise<any>} abandonUnstartedAttempt - Safely releases an unstarted claim.
 * @property {(...args: any[]) => Promise<any>} requestManualRunCancellation - Persists the first cancellation request or returns authoritative terminal/uncertain state.
 * @property {(runId: string) => Promise<Record<string, any> | null>} getRun - Reads a verified run projection.
 * @property {(runId: string, invocationId: string) => Promise<Record<string, any> | null>} getInvocation - Reads a verified invocation projection.
 * @property {(runId: string, invocationId: string, attemptId: string) => Promise<Record<string, any> | null>} getAttempt - Reads a verified attempt projection.
 * @property {(runId: string, invocationId: string, effectId: string) => Promise<Record<string, any> | null>} getEffect - Reads a verified effect projection.
 * @property {(runId: string, invocationId: string) => Promise<{run: Record<string, any>, invocation: Record<string, any>, request: {input: any, callerMetadata: Record<string, any>}, actor: {kind: string, id: string}} | null>} readManualRunRequest - Rehashes one manual request and returns its verified creation actor for identical durable replay.
 * @property {(runId: string, invocationId: string, effectId: string) => Promise<Record<string, any> | null>} readManagedEffectDelivery - Rehashes a logical request and re-verifies any terminal result for safe redelivery.
 * @property {(runId: string) => Promise<Record<string, any>[]>} getEvents - Reads a verified event stream.
 * @property {(options: {appId: string, revisionId: string, limit?: number, observedAt?: number, cursor?: string}) => Promise<{items: Record<string, any>[], nextCursor?: string}>} listReadyWork - Reads an exact-revision page of current-work locators; each must be rebuilt before use.
 * @property {(options: {appId: string, revisionId: string, runId: string, observed?: Record<string, any>}) => Promise<{applied: boolean, runId: string, expected?: Record<string, any>}>} repairReadyWork - Rebuilds one known run's replaceable ready-work locator under an exact head condition.
 * @property {(options: {appId: string, limit?: number, cursor?: string}) => Promise<{items: Record<string, any>[], nextCursor?: string}>} listRuns - Reads a verified bounded run-history page.
 * @property {(runId: string) => Promise<Record<string, any> | null>} rebuildRun - Rebuilds and verifies a whole run.
 */

export default createExecutionLedger;
