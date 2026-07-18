import { Command } from 'commander';

import { assertApplicationRevisionId } from '../application-revision.js';
import {
  InvocationStatus,
  RunStatus,
} from '../../lib/db/tables/execution-ledger.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import { assertLedgerOpaqueId } from '../../lib/ledger/record-key.js';
import { assertLogicalId } from '../logical-id.js';
import { recoverManualLedgerActivity } from '../manual-ledger-run.js';
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
  createExecutionLedgerRecoveryOperatorView,
  formatExecutionLedgerOperatorRows,
} from './execution-ledger-view.js';

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
 * @param {'inspect'|'recover'|'cancel'} command - Operator command.
 * @returns {string} - Exact requested run ID.
 */
function requireRunId(value, command) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${command} requires --run-id <runId>.`);
  }
  return value;
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
 * @param {{runId: string, expectedAppId?: string, actor?: {kind: string, id: string}, requireLocalOwnership?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} options - Exact recovery request.
 * @returns {Promise<{recovery: Record<string, any>, view: Record<string, any>} | null>} - Recovery and verified readback, or null.
 */
export async function recoverExecutionLedgerRun(options) {
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

  return await withExecutionLedger(
    async (ledger, context) =>
      await withLocalLedgerServiceMutationOwnership({
        appId: options.expectedAppId || preflight.run.appId,
        context,
        handler: async () => {
          const current = await ledger.rebuildRun(options.runId);
          if (!current) return null;
          assertExpectedApp(current, options.expectedAppId);
          const recovery = await recoverManualLedgerActivity({
            ledger,
            runId: options.runId,
            ...(options.actor ? { actor: options.actor } : {}),
          });
          const view = await ledger.rebuildRun(options.runId);
          if (!recovery.found || !view) return null;
          assertExpectedApp(view, options.expectedAppId);
          return { recovery, view };
        },
      }),
    { configuration },
  );
}

/**
 * @param {string} action - Named recovery action.
 * @returns {string} - Human-readable completed recovery message.
 */
function recoveryMessage(action) {
  if (action === 'released-unstarted-claim') {
    return 'Released an unstarted claim. This command did not dispatch an activity.';
  }
  if (action === 'marked-started-uncertain') {
    return 'Marked a begun attempt uncertain. This command did not dispatch an activity.';
  }
  return 'Verified durable recovery state. No recovery transition was needed.';
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
 * @property {Partial<ExecutionLedgerOperatorOutput>} [output] - Test or host output hooks.
 */

/**
 * Create fresh exact-run leaf commands. Source and packaged parents must never
 * share Commander instances because addCommand reparents its child.
 * @param {CreateExecutionLedgerOperatorCommandsOptions} [options] - Host behavior.
 * @returns {{inspectCommand: Command, recoverCommand: Command, cancelCommand: Command}} - Fresh commands.
 */
export function createExecutionLedgerOperatorCommands(options = {}) {
  const output = resolveOutput(options.output);

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
        output.success(recoveryMessage(result.recovery.action));
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

  return { inspectCommand, recoverCommand, cancelCommand };
}

export default createExecutionLedgerOperatorCommands;
