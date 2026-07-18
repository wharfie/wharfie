import { Command } from 'commander';
import { open } from 'node:fs/promises';
import { TextDecoder } from 'node:util';

import { assertApplicationRevisionId } from '../application-revision.js';
import {
  AttemptStatus,
  EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES,
  EffectStatus,
  InvocationStatus,
  RunStatus,
} from '../../lib/db/tables/execution-ledger.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import {
  MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES,
  assertLedgerOpaqueId,
} from '../../lib/ledger/record-key.js';
import { assertLogicalId } from '../logical-id.js';
import {
  reconcileManualLedgerActivity,
  recoverManualLedgerActivity,
} from '../manual-ledger-run.js';
import {
  assertApplicationStateStoreIsolation,
  openApplicationStateDB,
  resolveApplicationStateStoreConfiguration,
} from '../application-state-store.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
  normalizeApplicationStateDestination,
} from '../effects/application-state.js';
import { createBuiltinManagedEffectRecoveryCatalog } from '../effects/builtin-catalog.js';
import { recoverStartedManagedEffect } from '../managed-effect.js';
import {
  getLocalServiceSessionPrincipalId,
  getLocalServiceSessionScopeId,
} from '../local-service-session.js';
import {
  resolveExecutionLedgerStoreConfiguration,
  withExecutionLedger,
  withLocalLedgerServiceMutationOwnership,
} from './execution-ledger-store.js';
import { sendLocalOwnerCommand } from './local-owner-command.js';
import {
  createExecutionLedgerOperatorView,
  createExecutionLedgerReconciliationOperatorView,
  createExecutionLedgerRecoveryOperatorView,
  formatExecutionLedgerOperatorRows,
} from './execution-ledger-view.js';

/**
 * The evidence is published into the ledger's immutable referenced-payload
 * store, so use that exact ceiling before parsing a host-provided file.
 */
export const EXECUTION_LEDGER_RECONCILIATION_EVIDENCE_FILE_MAX_BYTES =
  EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES;

/** Keep optional operator prose comfortably inside the inline event cap. */
export const EXECUTION_LEDGER_RECONCILIATION_REASON_MAX_BYTES = 4096;

const RECONCILIATION_TRANSITION_PREFIX = 'reconcile:';
const DEFAULT_RECOVERY_OPERATOR_ACTOR = Object.freeze({
  kind: 'local',
  id: 'cli',
});

/**
 * Snapshot one exact recovery authority before any asynchronous read. The
 * same immutable actor must identify both destination-receipt recovery and
 * the following stopped-attempt transition.
 * @param {unknown} value - Optional recovery actor.
 * @returns {Readonly<{kind: string, id: string}>} - Exact immutable actor.
 */
function resolveRecoveryOperatorActor(value) {
  const candidate =
    value === undefined ? DEFAULT_RECOVERY_OPERATOR_ACTOR : value;
  if (
    !candidate ||
    typeof candidate !== 'object' ||
    Array.isArray(candidate) ||
    Object.keys(candidate).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(candidate, 'kind') ||
    !Object.prototype.hasOwnProperty.call(candidate, 'id')
  ) {
    throw new TypeError(
      'Recovery operator actor requires exactly kind and id.',
    );
  }
  const actor = /** @type {{kind: unknown, id: unknown}} */ (candidate);
  return Object.freeze({
    kind: assertLedgerOpaqueId(
      actor.kind,
      'recoverExecutionLedgerRun.actor.kind',
    ),
    id: assertLedgerOpaqueId(actor.id, 'recoverExecutionLedgerRun.actor.id'),
  });
}

/** A packaged artifact was asked to operate outside its embedded app scope. */
export class ExecutionLedgerOperatorScopeError extends Error {
  /**
   * @param {string} runId - Requested exact run.
   * @param {string} expectedAppId - Embedded application authority.
   */
  constructor(runId, expectedAppId) {
    super(
      `Durable run ${runId} does not belong to packaged application '${expectedAppId}'.`,
    );
    this.name = 'ExecutionLedgerOperatorScopeError';
    this.runId = runId;
    this.expectedAppId = expectedAppId;
  }
}

/**
 * @param {unknown} value - Candidate durable run ID.
 * @param {'inspect'|'recover'|'reconcile'|'cancel'} command - Operator command.
 * @returns {string} - Exact requested run ID.
 */
function requireRunId(value, command) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${command} requires --run-id <runId>.`);
  }
  return value;
}

/**
 * @param {unknown} value - Candidate stable operator reconciliation identity.
 * @returns {string} - Validated stable caller identity.
 */
function resolveReconciliationId(value) {
  if (value === undefined) {
    throw new Error(
      'reconcile requires --reconciliation-id <reconciliationId>; reuse the same value after a lost response.',
    );
  }
  const reconciliationId = assertLedgerOpaqueId(
    value,
    'reconcile reconciliationId',
  );
  if (
    Buffer.byteLength(
      `${RECONCILIATION_TRANSITION_PREFIX}${reconciliationId}`,
      'utf8',
    ) > MAX_EXECUTION_LEDGER_OPAQUE_ID_BYTES
  ) {
    throw new RangeError(
      `reconcile --reconciliation-id must leave room for the ${RECONCILIATION_TRANSITION_PREFIX} transition namespace.`,
    );
  }
  return reconciliationId;
}

/**
 * @param {unknown} value - Candidate optional operator explanation.
 * @returns {string | undefined} - Bounded well-formed explanation.
 */
function resolveReconciliationReasonText(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('reconcile --reason must be a nonempty string.');
  }
  const isWellFormed = /** @type {any} */ (String.prototype).isWellFormed;
  if (typeof isWellFormed === 'function' && !isWellFormed.call(value)) {
    throw new TypeError('reconcile --reason must be well-formed Unicode.');
  }
  if (
    Buffer.byteLength(value, 'utf8') >
    EXECUTION_LEDGER_RECONCILIATION_REASON_MAX_BYTES
  ) {
    throw new RangeError(
      `reconcile --reason must not exceed ${EXECUTION_LEDGER_RECONCILIATION_REASON_MAX_BYTES} UTF-8 bytes.`,
    );
  }
  return value;
}

/**
 * Create deterministic, structured durable reason metadata without exposing
 * the optional prose in any operator response.
 * @param {string} reconciliationId - Stable caller reconciliation identity.
 * @param {unknown} reasonText - Optional operator explanation.
 * @returns {Record<string, any>} - Bounded durable reason.
 */
function createReconciliationReason(reconciliationId, reasonText) {
  const message = resolveReconciliationReasonText(reasonText);
  return {
    kind: 'operator-evidence-reconciliation',
    reconciliationId,
    ...(message === undefined ? {} : { message }),
  };
}

/**
 * @param {unknown} value - Candidate evidence file path.
 * @returns {string} - Nonempty evidence file path.
 */
function requireEvidenceFile(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('reconcile requires --evidence-file <path>.');
  }
  if (value.includes('\0')) {
    throw new TypeError('reconcile --evidence-file must not contain NUL.');
  }
  return value;
}

/**
 * Read a complete regular evidence file through one file descriptor. The
 * allocation occurs only after a byte-size preflight, and a final byte/read
 * size check rejects a file that grew or changed while it was read. The
 * parsed transcript is intentionally returned only to the durable validator;
 * callers must never echo it in command output.
 * @param {string} evidenceFile - Host path to a JSON transcript.
 * @returns {Promise<Record<string, any>>} - Raw bounded JSON evidence.
 */
export async function readExecutionLedgerReconciliationEvidenceFile(
  evidenceFile,
) {
  const filePath = requireEvidenceFile(evidenceFile);
  const handle = await open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) {
      throw new Error('reconcile --evidence-file must name a regular file.');
    }
    if (
      !Number.isSafeInteger(before.size) ||
      before.size < 0 ||
      before.size > EXECUTION_LEDGER_RECONCILIATION_EVIDENCE_FILE_MAX_BYTES
    ) {
      throw new RangeError(
        `reconcile evidence file must not exceed ${EXECUTION_LEDGER_RECONCILIATION_EVIDENCE_FILE_MAX_BYTES} bytes.`,
      );
    }
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        bytes.length - offset,
        offset,
      );
      if (bytesRead === 0) {
        throw new Error('reconcile evidence file changed while it was read.');
      }
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    const { bytesRead: extraBytes } = await handle.read(
      extra,
      0,
      extra.length,
      bytes.length,
    );
    const after = await handle.stat();
    if (extraBytes !== 0 || after.size !== before.size) {
      throw new Error('reconcile evidence file changed while it was read.');
    }
    let parsed;
    try {
      parsed = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new Error(
        'reconcile --evidence-file must contain valid UTF-8 JSON evidence.',
      );
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new TypeError(
        'reconcile --evidence-file must contain a JSON object evidence record.',
      );
    }
    return /** @type {Record<string, any>} */ (parsed);
  } finally {
    await handle.close();
  }
}

/**
 * @param {Record<string, any>} view - Verified run view.
 * @param {string | undefined} expectedAppId - Optional packaged app scope.
 * @returns {void}
 */
function assertExpectedApp(view, expectedAppId) {
  if (expectedAppId !== undefined && view.run.appId !== expectedAppId) {
    throw new ExecutionLedgerOperatorScopeError(view.run.runId, expectedAppId);
  }
}

/**
 * @param {unknown} value - Resolver output.
 * @returns {{appId: string, revisionId?: string} | undefined} - Validated immutable packaged identity.
 */
function normalizeExpectedIdentity(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Packaged operator identity must be an object.');
  }
  const candidate = /** @type {Record<string, unknown>} */ (value);
  assertLogicalId(candidate.appId, 'packaged operator appId');
  const appId = /** @type {string} */ (candidate.appId);
  if (candidate.revisionId !== undefined) {
    assertApplicationRevisionId(
      candidate.revisionId,
      'packaged operator revisionId',
    );
  }
  const revisionId = /** @type {string | undefined} */ (candidate.revisionId);
  return Object.freeze({
    appId,
    ...(revisionId === undefined ? {} : { revisionId }),
  });
}

/**
 * @param {unknown} error - Candidate adapter error.
 * @returns {boolean} - Whether a read-only local control store/table is absent.
 */
function isMissingReadOnlyStore(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{code?: unknown}} */ (error).code ===
      'WHARFIE_READ_ONLY_STORE_NOT_FOUND'
  );
}

/**
 * Read and verify one exact run without loading application source.
 * @param {{runId: string, expectedAppId?: string, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Exact inspection request.
 * @returns {Promise<Record<string, any> | null>} - Verified run or null.
 */
export async function inspectExecutionLedgerRun(options) {
  try {
    const view = await withExecutionLedger(
      async (ledger) => await ledger.rebuildRun(options.runId),
      { readOnly: true, configuration: options.configuration },
    );
    if (view) assertExpectedApp(view, options.expectedAppId);
    return view;
  } catch (error) {
    if (isMissingReadOnlyStore(error)) return null;
    throw error;
  }
}

/** Exact authenticated local-owner command accepted by a manual ledger runner. */
export const EXECUTION_LEDGER_CANCEL_OWNER_COMMAND = 'execution-ledger-cancel';

const OwnerCancellationOutcome = Object.freeze({
  CANCELLATION_REQUESTED: 'cancellation-requested',
  TERMINAL_AUTHORITATIVE: 'terminal-authoritative',
  OUTCOME_UNCERTAIN: 'outcome-uncertain',
  OWNER_NOT_READY: 'owner-not-ready',
  OWNER_MOVED: 'owner-moved',
  OWNER_UNREACHABLE: 'owner-unreachable',
  AUTH_FAILED: 'auth-failed',
  REQUEST_UNAVAILABLE: 'request-unavailable',
});

/** @typedef {'cancellation-requested'|'terminal-authoritative'|'outcome-uncertain'|'owner-not-ready'|'owner-moved'|'owner-unreachable'|'auth-failed'|'request-unavailable'} OwnerCancellationOutcomeValue */
/** @typedef {'started'|'not-delivered'|'not-required'} OwnerCancellationDelivery */

const OWNER_CANCELLATION_OUTCOMES = new Set(
  Object.values(OwnerCancellationOutcome),
);

const OWNER_CANCELLATION_DELIVERIES = new Set([
  'started',
  'not-delivered',
  'not-required',
]);
/** @type {Set<string>} */
const OWNER_CANCELLATION_RUN_STATUSES = new Set(Object.values(RunStatus));
/** @type {Set<string>} */
const OWNER_CANCELLATION_INVOCATION_STATUSES = new Set(
  Object.values(InvocationStatus),
);

/**
 * @param {unknown} value - Optional user-supplied retry identity.
 * @returns {string} - Stable caller-supplied cancellation request ID.
 */
function resolveCancellationRequestId(value) {
  if (value === undefined) {
    throw new Error(
      'cancel requires --request-id <requestId>; reuse the same value after a lost response.',
    );
  }
  return assertLedgerOpaqueId(value, 'cancel requestId');
}

/**
 * @param {Record<string, any>} view - Verified exact ledger run.
 * @returns {Record<string, any> | undefined} - The manual invocation when present.
 */
function getManualInvocation(view) {
  return view.invocations.find(
    (/** @type {Record<string, any>} */ invocation) =>
      invocation.invocationId === 'manual',
  );
}

/**
 * @param {unknown} left - Candidate exact JSON tuple.
 * @param {unknown} right - Expected exact JSON tuple.
 * @returns {boolean} - Whether the arrays are positionally equal.
 */
function hasExactArray(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Require the one built-in destination contract this operator knows how to
 * verify physically. Unknown adapters must not be converted into a generic
 * missing-receipt uncertainty transition.
 * @param {Record<string, any>} effect - Retained unresolved effect.
 * @param {string} appId - Persisted application scope.
 * @returns {void}
 */
function assertRecoverableApplicationStateEffect(effect, appId) {
  const destination = normalizeApplicationStateDestination(effect.destination);
  if (
    effect.adapter?.id !== APPLICATION_STATE_ADAPTER_DESCRIPTOR.id ||
    effect.adapter?.version !== APPLICATION_STATE_ADAPTER_DESCRIPTOR.version ||
    effect.verifier?.kind !== APPLICATION_STATE_VERIFIER_DESCRIPTOR.kind ||
    effect.verifier?.version !==
      APPLICATION_STATE_VERIFIER_DESCRIPTOR.version ||
    !hasExactArray(
      effect.substantiatedReplayProperties,
      APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ) ||
    destination.configuration.provider !== 'lmdb' ||
    destination.configuration.namespace !== appId
  ) {
    throw new Error(
      `Managed effect ${effect.effectId} is not the exact built-in LMDB application-state contract recoverable by this operator.`,
    );
  }
}

/**
 * Select the deliberately narrow v1 recovery target. Concurrent effect
 * execution is supported by the runtime, but partially settling a sibling set
 * could strand remaining STARTED/PENDING work after the first uncertainty
 * transition blocks the aggregate.
 * @param {Record<string, any>} view - Fresh verified run projection.
 * @returns {Record<string, any> | undefined} - Exact single STARTED effect.
 */
function getStartedEffectRecoveryTarget(view) {
  const invocation = getManualInvocation(view);
  if (
    view.run.status !== RunStatus.RUNNING ||
    invocation?.status !== InvocationStatus.RUNNING
  ) {
    return undefined;
  }
  const attempt = view.attempts.find(
    (/** @type {Record<string, any>} */ candidate) =>
      candidate.invocationId === invocation.invocationId &&
      candidate.generation === invocation.generation,
  );
  if (attempt?.status !== AttemptStatus.STARTED) return undefined;

  const unresolved = (view.effects || []).filter(
    (/** @type {Record<string, any>} */ effect) =>
      effect.invocationId === invocation.invocationId &&
      effect.requestedBy?.attemptId === attempt.attemptId &&
      ![EffectStatus.COMPLETED, EffectStatus.FAILED].includes(effect.status),
  );
  if (unresolved.length === 0) return undefined;
  if (unresolved.length !== 1) {
    throw new Error(
      `Recovery requires exactly one unresolved managed effect for attempt ${attempt.attemptId}; found ${unresolved.length}.`,
    );
  }
  const effect = unresolved[0];
  if (effect.status !== EffectStatus.STARTED) {
    throw new Error(
      `Managed effect ${effect.effectId} is ${effect.status}; recovery currently requires the exact STARTED boundary.`,
    );
  }
  assertRecoverableApplicationStateEffect(effect, view.run.appId);
  return effect;
}

/**
 * @param {Record<string, any>} run - Current run projection.
 * @returns {boolean} - Whether this run has an immutable terminal outcome.
 */
function isTerminalRun(run) {
  return ['COMPLETED', 'FAILED', 'CANCELLED'].includes(run.status);
}

/**
 * @param {Record<string, any>} view - Verified exact ledger run.
 * @returns {'terminal-authoritative'|'outcome-uncertain'|undefined} - Local no-delivery classification.
 */
function classifyNonDeliverableCancellation(view) {
  if (isTerminalRun(view.run)) {
    return OwnerCancellationOutcome.TERMINAL_AUTHORITATIVE;
  }
  const invocation = getManualInvocation(view);
  if (view.run.status === 'BLOCKED' && invocation?.status === 'UNCERTAIN') {
    return OwnerCancellationOutcome.OUTCOME_UNCERTAIN;
  }
  return undefined;
}

/**
 * Return only the status information an external operator needs. Reasons,
 * transcripts, payload references, endpoint paths, session IDs, and fences
 * never leave the current owner or read-only control layer through this API.
 * @param {{runId: string, requestId: string, outcome: OwnerCancellationOutcomeValue, delivery: OwnerCancellationDelivery, runStatus?: unknown, invocationStatus?: unknown}} input - Candidate public cancellation response.
 * @returns {Readonly<{schemaVersion: 1, kind: 'wharfie.execution-ledger.cancel', runId: string, requestId: string, outcome: string, delivery: string, runStatus?: string, invocationStatus?: string}>} - Redacted response.
 */
function createCancellationOperatorResponse(input) {
  if (!OWNER_CANCELLATION_OUTCOMES.has(input.outcome)) {
    throw new TypeError(
      'Local owner returned an unsupported cancellation outcome.',
    );
  }
  if (!OWNER_CANCELLATION_DELIVERIES.has(input.delivery)) {
    throw new TypeError(
      'Local owner returned an unsupported cancellation delivery state.',
    );
  }
  /** @type {{schemaVersion: 1, kind: 'wharfie.execution-ledger.cancel', runId: string, requestId: string, outcome: OwnerCancellationOutcomeValue, delivery: OwnerCancellationDelivery, runStatus?: string, invocationStatus?: string}} */
  const response = {
    schemaVersion: /** @type {const} */ (1),
    kind: /** @type {const} */ ('wharfie.execution-ledger.cancel'),
    runId: input.runId,
    requestId: input.requestId,
    outcome: input.outcome,
    delivery: input.delivery,
  };
  if (typeof input.runStatus === 'string') response.runStatus = input.runStatus;
  if (typeof input.invocationStatus === 'string') {
    response.invocationStatus = input.invocationStatus;
  }
  return Object.freeze(response);
}

/**
 * @param {Record<string, any>} view - Verified exact ledger run.
 * @param {string} requestId - Stable cancellation request identity.
 * @param {'terminal-authoritative'|'outcome-uncertain'} outcome - Current authority.
 * @returns {ReturnType<typeof createCancellationOperatorResponse>} - Safe no-delivery result.
 */
function createNonDeliverableCancellationResponse(view, requestId, outcome) {
  return createCancellationOperatorResponse({
    runId: view.run.runId,
    requestId,
    outcome,
    delivery: 'not-required',
    runStatus: view.run.status,
    invocationStatus: getManualInvocation(view)?.status,
  });
}

/**
 * The public owner-command protocol has deliberately narrow state/delivery
 * pairs. In particular, this external surface only reaches a live STARTED
 * attempt; it cannot claim a pre-start delivery path that the current owner
 * does not implement.
 * @param {OwnerCancellationOutcomeValue} outcome - Owner-reported durable result.
 * @param {OwnerCancellationDelivery} delivery - Owner-reported physical delivery result.
 * @returns {boolean} - Whether the pair is a supported protocol result.
 */
function isSupportedOwnerCancellationResult(outcome, delivery) {
  if (outcome === OwnerCancellationOutcome.CANCELLATION_REQUESTED) {
    return delivery === 'started' || delivery === 'not-delivered';
  }
  if (
    outcome === OwnerCancellationOutcome.TERMINAL_AUTHORITATIVE ||
    outcome === OwnerCancellationOutcome.OUTCOME_UNCERTAIN
  ) {
    return delivery === 'not-required';
  }
  return delivery === 'not-delivered';
}

/**
 * Validate statuses that an owner is permitted to report after an accepted
 * command. Undelivered responses intentionally use the caller's preflight
 * view instead, so a command for a different active run cannot leak or
 * relabel that owner's state.
 * @param {Record<string, unknown>} candidate - Authenticated owner response.
 * @param {OwnerCancellationDelivery} delivery - Validated delivery result.
 * @returns {{runStatus?: string, invocationStatus?: string}} - Safe accepted-owner statuses.
 */
function getAcceptedOwnerStatuses(candidate, delivery) {
  if (delivery === 'not-delivered') return {};
  if (
    typeof candidate.runStatus !== 'string' ||
    !OWNER_CANCELLATION_RUN_STATUSES.has(candidate.runStatus) ||
    typeof candidate.invocationStatus !== 'string' ||
    !OWNER_CANCELLATION_INVOCATION_STATUSES.has(candidate.invocationStatus)
  ) {
    throw Object.assign(
      new Error('Local owner returned invalid cancellation statuses.'),
      { code: 'local-owner-command-response' },
    );
  }
  return {
    runStatus: candidate.runStatus,
    invocationStatus: candidate.invocationStatus,
  };
}

/**
 * Read exactly the ownership record that names a possible current local
 * manual runner. This is a read-only routing lookup, not authority to write
 * the ledger; the server rechecks its durable generation before it dispatches
 * the command.
 * @param {{appId: string, configuration: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Current app and immutable storage routing.
 * @returns {Promise<{serviceId: string, ownership: Readonly<Record<string, any>>} | null>} - Current local manual owner or no eligible owner.
 */
async function readLocalManualOwner(options) {
  const serviceId = createLedgerServiceId({ appId: options.appId });
  try {
    return await withExecutionLedger(
      async (_ledger, context) => {
        const ownership = await createLedgerServiceOwnership({
          db: context.db,
          tableName: context.tableName,
        }).getOwnership({ serviceId });
        if (
          !ownership ||
          ownership.ownerKind !== LedgerServiceOwnerKind.MANUAL
        ) {
          return null;
        }
        if (
          ownership.serviceId !== serviceId ||
          ownership.appId !== options.appId
        ) {
          throw new Error(
            'The durable local owner record does not match the requested application.',
          );
        }
        return { serviceId, ownership };
      },
      { readOnly: true, configuration: options.configuration },
    );
  } catch (error) {
    if (isMissingReadOnlyStore(error)) return null;
    throw error;
  }
}

/**
 * @param {Readonly<Record<string, any>>} ownership - Durable owner snapshot.
 * @param {ReturnType<typeof resolveExecutionLedgerStoreConfiguration>} configuration - Immutable local routing configuration.
 * @returns {boolean} - Whether the record is addressable from this exact local principal/scope.
 */
function isAddressableLocalOwner(ownership, configuration) {
  return (
    ownership.scopeId ===
      getLocalServiceSessionScopeId({
        sessionRoot: configuration.sessionPath,
      }) && ownership.principalId === getLocalServiceSessionPrincipalId()
  );
}

/**
 * @param {unknown} error - Local command transport error.
 * @returns {'owner-moved'|'owner-unreachable'|'auth-failed'|'request-unavailable'} - Safe caller-facing category.
 */
function classifyOwnerCommandError(error) {
  const candidate =
    error && typeof error === 'object'
      ? /** @type {{code?: unknown}} */ (error)
      : undefined;
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  if (code.includes('auth')) return OwnerCancellationOutcome.AUTH_FAILED;
  if (code.includes('stale') || code.includes('moved')) {
    return OwnerCancellationOutcome.OWNER_MOVED;
  }
  if (
    code.includes('malformed') ||
    code.includes('response') ||
    code.includes('rejected') ||
    code.includes('timeout')
  ) {
    return OwnerCancellationOutcome.REQUEST_UNAVAILABLE;
  }
  return OwnerCancellationOutcome.OWNER_UNREACHABLE;
}

/**
 * Ask the current same-principal LMDB owner to persist and, when applicable,
 * deliver cancellation. This function is intentionally only a command client:
 * it never calls `requestManualRunCancellation` or falls back to a direct
 * write when the owner is absent, stale, or unreachable.
 * @param {{runId: string, requestId: string, expectedAppId?: string, timeoutMs?: number, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Exact cancellation request.
 * @returns {Promise<ReturnType<typeof createCancellationOperatorResponse> | null>} - Safe owner response or null when the run does not exist.
 */
export async function cancelExecutionLedgerRun(options) {
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  const requestId = resolveCancellationRequestId(options.requestId);
  if (configuration.adapterName !== 'lmdb') {
    throw new Error(
      `External cancellation requires the LMDB local-owner protocol; '${configuration.adapterName}' has no current-owner command contract.`,
    );
  }

  const preflight = await inspectExecutionLedgerRun({
    runId: options.runId,
    expectedAppId: options.expectedAppId,
    configuration,
  });
  if (!preflight) return null;

  const nonDeliverable = classifyNonDeliverableCancellation(preflight);
  if (nonDeliverable) {
    return createNonDeliverableCancellationResponse(
      preflight,
      requestId,
      nonDeliverable,
    );
  }

  const owner = await readLocalManualOwner({
    appId: preflight.run.appId,
    configuration,
  });
  if (!owner) {
    return createCancellationOperatorResponse({
      runId: preflight.run.runId,
      requestId,
      outcome: OwnerCancellationOutcome.OWNER_UNREACHABLE,
      delivery: 'not-delivered',
      runStatus: preflight.run.status,
      invocationStatus: getManualInvocation(preflight)?.status,
    });
  }
  if (!isAddressableLocalOwner(owner.ownership, configuration)) {
    return createCancellationOperatorResponse({
      runId: preflight.run.runId,
      requestId,
      outcome: OwnerCancellationOutcome.OWNER_MOVED,
      delivery: 'not-delivered',
      runStatus: preflight.run.status,
      invocationStatus: getManualInvocation(preflight)?.status,
    });
  }

  try {
    const response = await sendLocalOwnerCommand({
      serviceId: owner.serviceId,
      sessionId: owner.ownership.sessionId,
      sessionRoot: configuration.sessionPath,
      requestId,
      command: EXECUTION_LEDGER_CANCEL_OWNER_COMMAND,
      request: { runId: preflight.run.runId },
      ...(options.timeoutMs === undefined
        ? {}
        : { timeoutMs: options.timeoutMs }),
    });
    if (!response || typeof response !== 'object' || Array.isArray(response)) {
      throw Object.assign(
        new Error('Local owner returned no cancellation response.'),
        {
          code: 'local-owner-command-response',
        },
      );
    }
    const candidate = /** @type {Record<string, unknown>} */ (response);
    if (
      typeof candidate.outcome !== 'string' ||
      !OWNER_CANCELLATION_OUTCOMES.has(
        /** @type {OwnerCancellationOutcomeValue} */ (candidate.outcome),
      ) ||
      typeof candidate.delivery !== 'string' ||
      !OWNER_CANCELLATION_DELIVERIES.has(
        /** @type {OwnerCancellationDelivery} */ (candidate.delivery),
      )
    ) {
      throw Object.assign(
        new Error('Local owner returned an invalid cancellation response.'),
        { code: 'local-owner-command-response' },
      );
    }
    const outcome = /** @type {OwnerCancellationOutcomeValue} */ (
      candidate.outcome
    );
    const delivery = /** @type {OwnerCancellationDelivery} */ (
      candidate.delivery
    );
    if (!isSupportedOwnerCancellationResult(outcome, delivery)) {
      throw Object.assign(
        new Error('Local owner returned an unsupported cancellation result.'),
        { code: 'local-owner-command-response' },
      );
    }
    const ownerStatuses = getAcceptedOwnerStatuses(candidate, delivery);
    return createCancellationOperatorResponse({
      runId: preflight.run.runId,
      requestId,
      outcome,
      delivery,
      runStatus: ownerStatuses.runStatus || preflight.run.status,
      invocationStatus:
        ownerStatuses.invocationStatus ||
        getManualInvocation(preflight)?.status,
    });
  } catch (error) {
    return createCancellationOperatorResponse({
      runId: preflight.run.runId,
      requestId,
      outcome: classifyOwnerCommandError(error),
      delivery: 'not-delivered',
      runStatus: preflight.run.status,
      invocationStatus: getManualInvocation(preflight)?.status,
    });
  }
}

/**
 * Reconcile one exact run after a read-only existence/scope preflight. The
 * mutable phase reacquires the store, takes local ownership when available,
 * and rechecks packaged app scope inside that fence before changing state.
 * @param {{runId: string, expectedAppId?: string, actor?: {kind: string, id: string}, requireLocalOwnership?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>, applicationStateConfiguration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>}} options - Exact recovery request.
 * @returns {Promise<{recovery: Record<string, any>, view: Record<string, any>} | null>} - Recovery and verified readback, or null.
 */
export async function recoverExecutionLedgerRun(options) {
  const actor = resolveRecoveryOperatorActor(options.actor);
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (
    options.requireLocalOwnership === true &&
    configuration.adapterName !== 'lmdb'
  ) {
    throw new Error(
      `Packaged recovery requires the LMDB control adapter until '${configuration.adapterName}' has a coordinator ownership contract.`,
    );
  }
  const preflight = await inspectExecutionLedgerRun({
    runId: options.runId,
    expectedAppId: options.expectedAppId,
    configuration,
  });
  if (!preflight) return null;

  // Refuse unsupported effect sets while every opened store is still
  // read-only. The same selection is repeated under local ownership below so
  // a concurrent transition cannot authorize work from this stale view.
  getStartedEffectRecoveryTarget(preflight);

  return await withExecutionLedger(
    async (ledger, context) =>
      await withLocalLedgerServiceMutationOwnership({
        appId: options.expectedAppId || preflight.run.appId,
        context,
        handler: async (localOwner) => {
          const current = await ledger.rebuildRun(options.runId);
          if (!current) return null;
          assertExpectedApp(current, options.expectedAppId);
          const target = getStartedEffectRecoveryTarget(current);
          /** @type {Record<string, any> | undefined} */
          let applicationState;
          /** @type {Record<string, any> | undefined} */
          let managedEffect;
          /** @type {Record<string, any> | undefined} */
          let recovery;
          /** @type {unknown} */
          let operationError;
          let operationFailed = false;

          try {
            if (target) {
              if (!localOwner || context.adapterName !== 'lmdb') {
                throw new Error(
                  'Recovery of a STARTED managed effect requires the held LMDB local-owner protocol.',
                );
              }
              const applicationStateConfiguration =
                options.applicationStateConfiguration ||
                resolveApplicationStateStoreConfiguration();
              if (applicationStateConfiguration.adapterName !== 'lmdb') {
                throw new Error(
                  'Recovery of a STARTED application-state effect requires the LMDB application-state adapter.',
                );
              }
              assertApplicationStateStoreIsolation(
                applicationStateConfiguration,
                context,
              );
              applicationState = await openApplicationStateDB({
                configuration: applicationStateConfiguration,
                readOnly: true,
              });
              assertApplicationStateStoreIsolation(
                applicationState.context,
                context,
              );
              const catalog = await createBuiltinManagedEffectRecoveryCatalog({
                db: applicationState.db,
                appId: current.run.appId,
                adapterName: applicationState.context.adapterName,
                tableName: applicationState.context.tableName,
              });
              managedEffect = await recoverStartedManagedEffect({
                ledger,
                runId: current.run.runId,
                invocationId: target.invocationId,
                effectId: target.effectId,
                recoverOutcome: catalog.recoverOutcome,
                actor,
              });
            }

            recovery = await recoverManualLedgerActivity({
              ledger,
              runId: options.runId,
              actor,
            });
          } catch (error) {
            operationFailed = true;
            operationError = error;
          }

          /** @type {unknown} */
          let closeError;
          let closeFailed = false;
          try {
            await applicationState?.close();
          } catch (error) {
            closeFailed = true;
            closeError = error;
          }
          if (operationFailed && closeFailed) {
            throw new AggregateError(
              [operationError, closeError],
              'Managed-effect recovery and application-state cleanup both failed.',
            );
          }
          if (operationFailed) throw operationError;
          if (closeFailed) throw closeError;
          if (!recovery) {
            throw new Error('Durable recovery returned no result.');
          }

          const view = await ledger.rebuildRun(options.runId);
          if (!recovery.found || !view) return null;
          assertExpectedApp(view, options.expectedAppId);
          return {
            recovery: {
              ...recovery,
              changed: recovery.changed || managedEffect?.changed === true,
              ...(managedEffect ? { managedEffect } : {}),
            },
            view,
          };
        },
      }),
    { configuration },
  );
}

/**
 * Reconcile one exact retained uncertain run using evidence supplied by the
 * operator. Like recovery, this is source-free and performs a fresh
 * read-only scope/existence preflight before it acquires the mutation fence.
 * It deliberately does not contact a live owner, retry against a new head,
 * or select a new attempt: the core transition validates the original
 * uncertainty fence and stable reconciliation receipt.
 * @param {{runId: string, reconciliationId: string, evidence: Record<string, any>, reason?: string, expectedAppId?: string, actor?: {kind: string, id: string}, requireLocalOwnership?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Exact evidence-backed reconciliation request.
 * @returns {Promise<{reconciliation: {reconciliationId?: string, changed: boolean}, view: Record<string, any>} | null>} - Reconciliation and verified redaction source, or null.
 */
export async function reconcileExecutionLedgerRun(options) {
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  if (
    options.requireLocalOwnership === true &&
    configuration.adapterName !== 'lmdb'
  ) {
    throw new Error(
      `Packaged reconciliation requires the LMDB control adapter until '${configuration.adapterName}' has a coordinator ownership contract.`,
    );
  }
  const reconciliationId = resolveReconciliationId(options.reconciliationId);
  const reason = createReconciliationReason(reconciliationId, options.reason);
  if (
    !options.evidence ||
    typeof options.evidence !== 'object' ||
    Array.isArray(options.evidence)
  ) {
    throw new TypeError(
      'reconcileExecutionLedgerRun.evidence must be a JSON object.',
    );
  }
  const preflight = await inspectExecutionLedgerRun({
    runId: options.runId,
    expectedAppId: options.expectedAppId,
    configuration,
  });
  if (!preflight) return null;

  return await withExecutionLedger(
    async (ledger, context) =>
      await withLocalLedgerServiceMutationOwnership({
        appId: options.expectedAppId || preflight.run.appId,
        context,
        handler: async () => {
          const current = await ledger.rebuildRun(options.runId);
          if (!current) return null;
          assertExpectedApp(current, options.expectedAppId);
          const reconciliation = await reconcileManualLedgerActivity({
            ledger,
            runId: options.runId,
            reconciliationId,
            evidence: options.evidence,
            reason,
            ...(options.actor ? { actor: options.actor } : {}),
          });
          if (!reconciliation.found || !reconciliation.view) return null;
          assertExpectedApp(reconciliation.view, options.expectedAppId);
          return { reconciliation, view: reconciliation.view };
        },
      }),
    { configuration },
  );
}

/**
 * @param {string | Record<string, any>} action - Named recovery action or combined managed-effect recovery.
 * @returns {string} - Human-readable completed recovery message.
 */
function recoveryMessage(action) {
  if (typeof action === 'object' && action?.managedEffect) {
    if (action.managedEffect.action === 'outcome-recovered') {
      return `Recovered managed effect ${action.managedEffect.effectId} from its permanent destination receipt, then marked the stopped begun attempt uncertain. No activity code was dispatched.`;
    }
    if (action.managedEffect.action === 'outcome-uncertain') {
      return `No permanent destination receipt exists for managed effect ${action.managedEffect.effectId}; marked the effect and stopped begun attempt uncertain. No activity code was dispatched.`;
    }
  }
  const recoveryAction =
    typeof action === 'object' && action ? action.action : action;
  if (recoveryAction === 'released-unstarted-claim') {
    return 'Released an unstarted claim. This command did not dispatch an activity.';
  }
  if (recoveryAction === 'marked-started-uncertain') {
    return 'Marked a begun attempt uncertain. This command did not dispatch an activity.';
  }
  return 'Verified durable recovery state. No recovery transition was needed.';
}

/**
 * @param {{reconciliationId?: string, changed: boolean}} reconciliation - Safe reconciliation result.
 * @returns {string} - Human-readable completed reconciliation message.
 */
function reconciliationMessage(reconciliation) {
  if (reconciliation.changed) {
    return `Reconciliation ${reconciliation.reconciliationId} was durably applied from verified evidence.`;
  }
  return `Reconciliation ${reconciliation.reconciliationId} was already durably applied.`;
}

/**
 * @param {ReturnType<typeof createCancellationOperatorResponse>} response - Safe cancellation response.
 * @returns {boolean} - Whether a cancellation request was accepted and routed to the live attempt.
 */
function isDeliveredCancellation(response) {
  return (
    response.outcome === OwnerCancellationOutcome.CANCELLATION_REQUESTED &&
    response.delivery === 'started'
  );
}

/**
 * @param {ReturnType<typeof createCancellationOperatorResponse>} response - Safe cancellation response.
 * @returns {boolean} - Whether the command could not establish durable owner delivery.
 */
function isUndeliveredCancellation(response) {
  return (
    response.outcome === OwnerCancellationOutcome.OWNER_NOT_READY ||
    response.outcome === OwnerCancellationOutcome.OWNER_MOVED ||
    response.outcome === OwnerCancellationOutcome.OWNER_UNREACHABLE ||
    response.outcome === OwnerCancellationOutcome.AUTH_FAILED ||
    response.outcome === OwnerCancellationOutcome.REQUEST_UNAVAILABLE
  );
}

/**
 * @param {ReturnType<typeof createCancellationOperatorResponse>} response - Safe cancellation response.
 * @returns {string} - Human-readable safe outcome message.
 */
function cancellationMessage(response) {
  if (isDeliveredCancellation(response)) {
    return `Cancellation request ${response.requestId} was durably accepted and delivery to the active attempt began.`;
  }
  if (response.outcome === OwnerCancellationOutcome.CANCELLATION_REQUESTED) {
    return 'A different durable cancellation request is already authoritative; this command did not deliver a second signal.';
  }
  if (response.outcome === OwnerCancellationOutcome.TERMINAL_AUTHORITATIVE) {
    return 'The durable run already has an authoritative terminal outcome; no cancellation was delivered.';
  }
  if (response.outcome === OwnerCancellationOutcome.OUTCOME_UNCERTAIN) {
    return 'The durable run is already uncertain and remains blocked; cancellation cannot select an outcome.';
  }
  if (response.outcome === OwnerCancellationOutcome.OWNER_NOT_READY) {
    return 'The current local owner is not ready to accept this run; no cancellation was delivered.';
  }
  if (response.outcome === OwnerCancellationOutcome.OWNER_MOVED) {
    return 'The observed local owner changed before this command could reach it; no cancellation was delivered.';
  }
  if (response.outcome === OwnerCancellationOutcome.AUTH_FAILED) {
    return 'The current local owner rejected this command authentication; no cancellation was delivered.';
  }
  if (response.outcome === OwnerCancellationOutcome.REQUEST_UNAVAILABLE) {
    return 'The current local owner could not process this command; no cancellation was delivered.';
  }
  return 'No eligible current local owner could be reached; no cancellation was delivered.';
}

/**
 * @typedef ExecutionLedgerOperatorOutput
 * @property {(value: Record<string, any>) => void} json - Write JSON.
 * @property {(rows: Record<string, any>[]) => void} table - Write table rows.
 * @property {(message: string) => void} success - Write success text.
 * @property {(error: unknown) => void} failure - Write failure text.
 */

/**
 * @param {Partial<ExecutionLedgerOperatorOutput> | undefined} provided - Optional output hooks.
 * @returns {ExecutionLedgerOperatorOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  return {
    json:
      provided?.json ||
      ((value) => {
        console.log(JSON.stringify(value));
      }),
    table: provided?.table || ((rows) => console.table(rows)),
    success:
      provided?.success ||
      ((message) => {
        console.log('OK', message);
      }),
    failure:
      provided?.failure ||
      ((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
      }),
  };
}

/**
 * @typedef CreateExecutionLedgerOperatorCommandsOptions
 * @property {() => Promise<{appId: string, revisionId?: string}>} [resolveExpectedIdentity] - Lazy packaged artifact authority.
 * @property {boolean} [requireLocalOwnership] - Require the current LMDB ownership protocol for recovery.
 * @property {(evidenceFile: string) => Promise<Record<string, any>>} [readReconciliationEvidenceFile] - Bounded evidence-reader seam for tests or hosts.
 * @property {Partial<ExecutionLedgerOperatorOutput>} [output] - Test or host output hooks.
 */

/**
 * Create fresh exact-run leaf commands. Source and packaged parents must never
 * share Commander instances because addCommand reparents its child.
 * @param {CreateExecutionLedgerOperatorCommandsOptions} [options] - Host behavior.
 * @returns {{inspectCommand: Command, recoverCommand: Command, reconcileCommand: Command, cancelCommand: Command}} - Fresh commands.
 */
export function createExecutionLedgerOperatorCommands(options = {}) {
  const output = resolveOutput(options.output);
  const readReconciliationEvidenceFile =
    options.readReconciliationEvidenceFile ||
    readExecutionLedgerReconciliationEvidenceFile;

  const resolveIdentity = async () =>
    normalizeExpectedIdentity(
      options.resolveExpectedIdentity
        ? await options.resolveExpectedIdentity()
        : undefined,
    );

  const inspectCommand = new Command('inspect')
    .description('Inspect one verified durable ledger run by persisted run ID')
    .option('--run-id <runId>', 'Persisted execution-ledger run ID')
    .option('--json', 'Write a redacted machine-readable inspection view')
    .action(async (commandOptions) => {
      try {
        const runId = requireRunId(commandOptions.runId, 'inspect');
        const identity = await resolveIdentity();
        const view = await inspectExecutionLedgerRun({
          runId,
          expectedAppId: identity?.appId,
        });
        if (!view) {
          throw new Error(`No durable execution-ledger run exists: ${runId}`);
        }
        if (commandOptions.json === true) {
          output.json(createExecutionLedgerOperatorView(view));
          return;
        }
        output.table(formatExecutionLedgerOperatorRows(view));
        output.success(
          `Verified durable run ${view.run.runId} with ${view.events.length} ledger events.`,
        );
      } catch (error) {
        output.failure(error);
        process.exitCode = 1;
      }
    });

  const recoverCommand = new Command('recover')
    .description('Reconcile one durable ledger run without loading app source')
    .option('--run-id <runId>', 'Persisted execution-ledger run ID')
    .option(
      '--confirm-runner-stopped',
      'Confirm that every prior runner for this run has stopped',
    )
    .option('--json', 'Write a redacted machine-readable recovery view')
    .action(async (commandOptions) => {
      try {
        const runId = requireRunId(commandOptions.runId, 'recover');
        if (commandOptions.confirmRunnerStopped !== true) {
          throw new Error(
            'recover requires --confirm-runner-stopped before it can change durable state.',
          );
        }
        const identity = await resolveIdentity();
        const result = await recoverExecutionLedgerRun({
          runId,
          expectedAppId: identity?.appId,
          requireLocalOwnership: options.requireLocalOwnership === true,
          ...(identity?.revisionId
            ? {
                actor: {
                  kind: 'packaged-operator',
                  id: identity.revisionId,
                },
              }
            : {}),
        });
        if (!result) {
          throw new Error(
            `No durable execution-ledger run exists; recovery refuses to create work: ${runId}`,
          );
        }
        if (commandOptions.json === true) {
          output.json(
            createExecutionLedgerRecoveryOperatorView(
              /** @type {{action: string, changed: boolean}} */ (
                result.recovery
              ),
              result.view,
            ),
          );
          return;
        }
        output.table(formatExecutionLedgerOperatorRows(result.view));
        output.success(recoveryMessage(result.recovery));
      } catch (error) {
        output.failure(error);
        process.exitCode = 1;
      }
    });

  const reconcileCommand = new Command('reconcile')
    .description(
      'Resolve one blocked uncertain ledger run from a verified host transcript without loading app source',
    )
    .option('--run-id <runId>', 'Persisted execution-ledger run ID')
    .requiredOption(
      '--reconciliation-id <reconciliationId>',
      'Required stable reconciliation ID; reuse it when retrying a lost response',
    )
    .requiredOption(
      '--evidence-file <path>',
      'Required bounded JSON host transcript file; its contents are never echoed',
    )
    .option(
      '--confirm-runner-stopped',
      'Confirm that every prior runner for this run has stopped',
    )
    .option('--reason <text>', 'Optional private durable operator explanation')
    .option('--json', 'Write a redacted machine-readable reconciliation view')
    .action(async (commandOptions) => {
      try {
        const runId = requireRunId(commandOptions.runId, 'reconcile');
        if (commandOptions.confirmRunnerStopped !== true) {
          throw new Error(
            'reconcile requires --confirm-runner-stopped before it can change durable state.',
          );
        }
        const reconciliationId = resolveReconciliationId(
          commandOptions.reconciliationId,
        );
        const evidenceFile = requireEvidenceFile(commandOptions.evidenceFile);
        const reasonText = resolveReconciliationReasonText(
          commandOptions.reason,
        );
        const identity = await resolveIdentity();
        const configuration = resolveExecutionLedgerStoreConfiguration();

        // Establish exact existence and packaged app scope before opening a
        // potentially sensitive evidence file. `reconcileExecutionLedgerRun`
        // repeats this preflight before its mutation fence to close the race.
        const preflight = await inspectExecutionLedgerRun({
          runId,
          expectedAppId: identity?.appId,
          configuration,
        });
        if (!preflight) {
          throw new Error(
            `No durable execution-ledger run exists; reconciliation refuses to create work: ${runId}`,
          );
        }
        const evidence = await readReconciliationEvidenceFile(evidenceFile);
        const result = await reconcileExecutionLedgerRun({
          runId,
          reconciliationId,
          evidence,
          ...(reasonText === undefined ? {} : { reason: reasonText }),
          expectedAppId: identity?.appId,
          requireLocalOwnership: options.requireLocalOwnership === true,
          configuration,
          ...(identity?.revisionId
            ? {
                actor: {
                  kind: 'packaged-operator',
                  id: identity.revisionId,
                },
              }
            : {}),
        });
        if (!result) {
          throw new Error(
            `No durable execution-ledger run exists; reconciliation refuses to create work: ${runId}`,
          );
        }
        if (commandOptions.json === true) {
          output.json(
            createExecutionLedgerReconciliationOperatorView(
              /** @type {{reconciliationId: string, changed: boolean}} */ (
                result.reconciliation
              ),
              result.view,
            ),
          );
          return;
        }
        output.table(formatExecutionLedgerOperatorRows(result.view));
        output.success(reconciliationMessage(result.reconciliation));
      } catch (error) {
        output.failure(error);
        process.exitCode = 1;
      }
    });

  const cancelCommand = new Command('cancel')
    .description(
      'Ask the current local owner to durably cancel one exact active ledger run',
    )
    .option('--run-id <runId>', 'Persisted execution-ledger run ID')
    .requiredOption(
      '--request-id <requestId>',
      'Required stable cancellation request ID; reuse it when retrying a lost response',
    )
    .option('--json', 'Write a redacted machine-readable cancellation result')
    .action(async (commandOptions) => {
      try {
        const runId = requireRunId(commandOptions.runId, 'cancel');
        const identity = await resolveIdentity();
        const response = await cancelExecutionLedgerRun({
          runId,
          requestId: commandOptions.requestId,
          expectedAppId: identity?.appId,
        });
        if (!response) {
          throw new Error(
            `No durable execution-ledger run exists; cancellation refuses to create work: ${runId}`,
          );
        }
        if (commandOptions.json === true) output.json(response);
        else output.table([response]);

        const message = cancellationMessage(response);
        if (isUndeliveredCancellation(response)) {
          output.failure(new Error(message));
          process.exitCode = 1;
          return;
        }
        output.success(message);
      } catch (error) {
        output.failure(error);
        process.exitCode = 1;
      }
    });

  return { inspectCommand, recoverCommand, reconcileCommand, cancelCommand };
}

export default createExecutionLedgerOperatorCommands;
