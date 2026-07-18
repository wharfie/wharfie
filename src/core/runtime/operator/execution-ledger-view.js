/**
 * The operator view deliberately exposes lifecycle identity and integrity
 * information, but not author inputs, caller metadata, terminal results,
 * evidence, fencing tokens, or event payloads. Those need an explicit future
 * disclosure and authorization policy.
 */
export const EXECUTION_LEDGER_OPERATOR_VIEW_SCHEMA_VERSION = 4;

/**
 * Expose cancellation identity and ordering without disclosing its operator
 * reason. The event actor remains visible in the already-redacted history.
 * @param {Record<string, any> | undefined} request - Durable request metadata.
 * @returns {{requestId: string, requestedAt: number} | undefined} - Redacted cancellation summary.
 */
function cancellationSummary(request) {
  if (!request) return undefined;
  return {
    requestId: request.requestId,
    requestedAt: request.requestedAt,
  };
}

/**
 * @param {Record<string, any>} view - Verified rebuilt execution-ledger view.
 * @returns {Record<string, any>} - Redacted, stable operator representation.
 */
export function createExecutionLedgerOperatorView(view) {
  const run = view.run;
  return {
    schemaVersion: EXECUTION_LEDGER_OPERATOR_VIEW_SCHEMA_VERSION,
    kind: 'wharfie.execution-ledger.run',
    integrity: { verified: true },
    run: {
      runId: run.runId,
      appId: run.appId,
      revisionId: run.revisionId,
      status: run.status,
      version: run.version,
      lastSequence: run.lastSequence,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      ...(run.cancellationRequest
        ? { cancellationRequest: cancellationSummary(run.cancellationRequest) }
        : {}),
    },
    invocations: view.invocations.map(
      (/** @type {Record<string, any>} */ invocation) => ({
        invocationId: invocation.invocationId,
        activityId: invocation.activityId,
        status: invocation.status,
        generation: invocation.generation,
        version: invocation.version,
        lastSequence: invocation.lastSequence,
        createdAt: invocation.createdAt,
        updatedAt: invocation.updatedAt,
      }),
    ),
    attempts: view.attempts.map(
      (/** @type {Record<string, any>} */ attempt) => ({
        invocationId: attempt.invocationId,
        attemptId: attempt.attemptId,
        status: attempt.status,
        generation: attempt.generation,
        version: attempt.version,
        coordinatorEpoch: attempt.coordinatorEpoch,
        claimedAt: attempt.claimedAt,
        ...(attempt.startedAt === undefined
          ? {}
          : { startedAt: attempt.startedAt }),
        updatedAt: attempt.updatedAt,
        lastSequence: attempt.lastSequence,
      }),
    ),
    effects: (view.effects || []).map(
      (/** @type {Record<string, any>} */ effect) => ({
        invocationId: effect.invocationId,
        effectId: effect.effectId,
        status: effect.status,
        adapter: {
          id: effect.adapter.id,
          version: effect.adapter.version,
        },
        version: effect.version,
        lastSequence: effect.lastSequence,
        createdAt: effect.createdAt,
        updatedAt: effect.updatedAt,
      }),
    ),
    history: view.events.map((/** @type {Record<string, any>} */ event) => ({
      sequence: event.sequence,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
      fence: event.fence,
    })),
  };
}

/**
 * @param {Record<string, any>} view - Verified rebuilt execution-ledger view.
 * @returns {Record<string, any>[]} - Compact rows for human CLI output.
 */
export function formatExecutionLedgerOperatorRows(view) {
  const attempts = new Map(
    view.attempts.map((/** @type {Record<string, any>} */ attempt) => [
      `${attempt.invocationId}:${attempt.generation}`,
      attempt,
    ]),
  );
  return view.invocations.map(
    (/** @type {Record<string, any>} */ invocation) => {
      const attempt = attempts.get(
        `${invocation.invocationId}:${invocation.generation}`,
      );
      return {
        run_id: view.run.runId,
        app_id: view.run.appId,
        revision: view.run.revisionId,
        run_status: view.run.status,
        invocation_id: invocation.invocationId,
        activity: invocation.activityId,
        invocation_status: invocation.status,
        attempt_generation: invocation.generation,
        attempt_id: attempt?.attemptId || '',
        attempt_status: attempt?.status || '',
        cancellation_request: view.run.cancellationRequest?.requestId || '',
        event_count: view.events.length,
      };
    },
  );
}

/**
 * @param {{action: string, changed: boolean, managedEffects?: Array<{effectId: string, action: string, status: string}>}} recovery - Recovery result metadata.
 * @param {Record<string, any>} view - Verified rebuilt execution-ledger view.
 * @returns {Record<string, any>} - Redacted recovery response.
 */
export function createExecutionLedgerRecoveryOperatorView(recovery, view) {
  return {
    ...createExecutionLedgerOperatorView(view),
    kind: 'wharfie.execution-ledger.recovery',
    recovery: {
      action: recovery.action,
      changed: recovery.changed,
      ...(recovery.managedEffects
        ? {
            managedEffects: recovery.managedEffects
              .map((effect) => ({
                effectId: effect.effectId,
                action: effect.action,
                status: effect.status,
              }))
              .sort((left, right) =>
                left.effectId < right.effectId
                  ? -1
                  : left.effectId > right.effectId
                    ? 1
                    : 0,
              ),
          }
        : {}),
    },
  };
}

/**
 * Render only the stable operator reconciliation identity and whether this
 * invocation appended the durable event. Evidence, evidence references,
 * terminal values/errors, fences, and optional reason prose deliberately stay
 * inside the trusted ledger boundary.
 * @param {{reconciliationId: string, changed: boolean}} reconciliation - Safe helper result metadata.
 * @param {Record<string, any>} view - Verified rebuilt execution-ledger view.
 * @returns {Record<string, any>} - Redacted reconciliation response.
 */
export function createExecutionLedgerReconciliationOperatorView(
  reconciliation,
  view,
) {
  return {
    ...createExecutionLedgerOperatorView(view),
    kind: 'wharfie.execution-ledger.reconciliation',
    reconciliation: {
      reconciliationId: reconciliation.reconciliationId,
      changed: reconciliation.changed,
    },
  };
}

export default {
  EXECUTION_LEDGER_OPERATOR_VIEW_SCHEMA_VERSION,
  createExecutionLedgerOperatorView,
  createExecutionLedgerReconciliationOperatorView,
  createExecutionLedgerRecoveryOperatorView,
  formatExecutionLedgerOperatorRows,
};
