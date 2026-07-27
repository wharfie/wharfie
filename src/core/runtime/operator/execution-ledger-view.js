/**
 * The operator view deliberately exposes lifecycle identity and integrity
 * information, but not author inputs, caller metadata, terminal results,
 * evidence, fencing material, or event payloads. Those need an explicit future
 * disclosure and authorization policy.
 */
export const EXECUTION_LEDGER_OPERATOR_VIEW_SCHEMA_VERSION = 8;

/**
 * Expose only trigger identity needed to distinguish run semantics. Payload
 * references and managed-effect successor causal authority remain private.
 * @param {Record<string, any>} trigger - Verified run trigger.
 * @returns {Record<string, any>} - Redacted trigger identity.
 */
function triggerSummary(trigger) {
  return trigger.kind === 'workflow'
    ? {
        kind: trigger.kind,
        workflowId: trigger.workflowId,
        planId: trigger.planId,
        ...(trigger.cause
          ? {
              cause: {
                schemaVersion: trigger.cause.schemaVersion,
                kind: trigger.cause.kind,
                scheduleId: trigger.cause.scheduleId,
                definitionId: trigger.cause.definitionId,
                occurrenceId: trigger.cause.occurrenceId,
                scheduledAt: trigger.cause.scheduledAt,
              },
            }
          : {}),
      }
    : { kind: trigger.kind };
}

/**
 * Expose the exact workflow position without disclosing plan, start, or output
 * payload references and values.
 * @param {Record<string, any> | undefined} cursor - Verified current cursor.
 * @returns {Record<string, any> | undefined} - Redacted workflow cursor.
 */
function workflowCursorSummary(cursor) {
  if (!cursor) return undefined;
  return {
    runId: cursor.runId,
    appId: cursor.appId,
    revisionId: cursor.revisionId,
    workflowId: cursor.workflowId,
    planId: cursor.planId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
    continuationId: cursor.continuationId,
    ...(Object.prototype.hasOwnProperty.call(cursor, 'invocationId')
      ? { invocationId: cursor.invocationId }
      : Object.prototype.hasOwnProperty.call(cursor, 'timerId')
        ? { timerId: cursor.timerId }
        : { signalWaitId: cursor.signalWaitId }),
    disposition: cursor.disposition,
    outputs: cursor.outputs.map(
      (/** @type {Record<string, any>} */ output) => ({
        stepId: output.stepId,
        stepIndex: output.stepIndex,
      }),
    ),
    version: cursor.version,
    lastSequence: cursor.lastSequence,
    createdAt: cursor.createdAt,
    updatedAt: cursor.updatedAt,
  };
}

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
      trigger: triggerSummary(run.trigger),
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
        ...(invocation.workflow
          ? {
              workflow: {
                workflowId: invocation.workflow.workflowId,
                planId: invocation.workflow.planId,
                continuationId: invocation.workflow.continuationId,
                stepId: invocation.workflow.stepId,
                stepIndex: invocation.workflow.stepIndex,
              },
            }
          : {}),
      }),
    ),
    attempts: view.attempts.map(
      (/** @type {Record<string, any>} */ attempt) => ({
        invocationId: attempt.invocationId,
        attemptId: attempt.attemptId,
        status: attempt.status,
        generation: attempt.generation,
        version: attempt.version,
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
    timers: (view.timers || []).map(
      (/** @type {Record<string, any>} */ timer) => ({
        timerId: timer.timerId,
        workflowId: timer.workflowId,
        planId: timer.planId,
        continuationId: timer.continuationId,
        stepId: timer.stepId,
        stepIndex: timer.stepIndex,
        status: timer.status,
        scheduledAt: timer.scheduledAt,
        dueAt: timer.dueAt,
        ...(timer.firedAt === undefined ? {} : { firedAt: timer.firedAt }),
        version: timer.version,
        lastSequence: timer.lastSequence,
        createdAt: timer.createdAt,
        updatedAt: timer.updatedAt,
        ...(timer.cancellationRequest
          ? {
              cancellationRequest: cancellationSummary(
                timer.cancellationRequest,
              ),
            }
          : {}),
      }),
    ),
    signalWaits: (view.signalWaits || []).map(
      (/** @type {Record<string, any>} */ wait) => ({
        signalWaitId: wait.signalWaitId,
        workflowId: wait.workflowId,
        planId: wait.planId,
        continuationId: wait.continuationId,
        stepId: wait.stepId,
        stepIndex: wait.stepIndex,
        signalId: wait.signalId,
        status: wait.status,
        ...(wait.deliveryId === undefined
          ? {}
          : { deliveryId: wait.deliveryId }),
        ...(wait.acceptedAt === undefined
          ? {}
          : { acceptedAt: wait.acceptedAt }),
        version: wait.version,
        lastSequence: wait.lastSequence,
        createdAt: wait.createdAt,
        updatedAt: wait.updatedAt,
        ...(wait.cancellationRequest
          ? {
              cancellationRequest: cancellationSummary(
                wait.cancellationRequest,
              ),
            }
          : {}),
      }),
    ),
    signalDeliveries: (view.signalDeliveries || []).map(
      (/** @type {Record<string, any>} */ delivery) => ({
        deliveryId: delivery.deliveryId,
        signalId: delivery.signalId,
        status: delivery.status,
        ...(delivery.rejectionReason === undefined
          ? {}
          : { rejectionReason: delivery.rejectionReason }),
        ...(delivery.signalWaitId === undefined
          ? {}
          : { signalWaitId: delivery.signalWaitId }),
        version: delivery.version,
        lastSequence: delivery.lastSequence,
        observedAt: delivery.observedAt,
      }),
    ),
    history: view.events.map((/** @type {Record<string, any>} */ event) => ({
      sequence: event.sequence,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
    })),
    ...(view.workflowCursor
      ? { workflowCursor: workflowCursorSummary(view.workflowCursor) }
      : {}),
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
  const invocationRows = view.invocations.map(
    (/** @type {Record<string, any>} */ invocation) => {
      const attempt = attempts.get(
        `${invocation.invocationId}:${invocation.generation}`,
      );
      return {
        run_id: view.run.runId,
        app_id: view.run.appId,
        revision: view.run.revisionId,
        run_kind: view.run.trigger.kind,
        run_status: view.run.status,
        activation_kind: 'activity',
        invocation_id: invocation.invocationId,
        activity: invocation.activityId,
        workflow: invocation.workflow?.workflowId || '',
        workflow_plan: invocation.workflow?.planId || '',
        workflow_step: invocation.workflow?.stepId || '',
        workflow_step_index: invocation.workflow?.stepIndex ?? '',
        cursor_disposition:
          view.workflowCursor?.invocationId === invocation.invocationId
            ? view.workflowCursor.disposition
            : '',
        invocation_status: invocation.status,
        attempt_generation: invocation.generation,
        attempt_id: attempt?.attemptId || '',
        attempt_status: attempt?.status || '',
        cancellation_request: view.run.cancellationRequest?.requestId || '',
        event_count: view.events.length,
      };
    },
  );
  const workflowRow = (
    /** @type {Record<string, any>} */ activation,
    /** @type {'timer'|'signal'} */ kind,
  ) => ({
    run_id: view.run.runId,
    app_id: view.run.appId,
    revision: view.run.revisionId,
    run_kind: view.run.trigger.kind,
    run_status: view.run.status,
    activation_kind: kind,
    invocation_id: '',
    activity: '',
    workflow: activation.workflowId,
    workflow_plan: activation.planId,
    workflow_step: activation.stepId,
    workflow_step_index: activation.stepIndex,
    cursor_disposition:
      (kind === 'timer' &&
        view.workflowCursor?.timerId === activation.timerId) ||
      (kind === 'signal' &&
        view.workflowCursor?.signalWaitId === activation.signalWaitId)
        ? view.workflowCursor.disposition
        : '',
    invocation_status: '',
    activation_status: activation.status,
    attempt_generation: '',
    attempt_id: '',
    attempt_status: '',
    cancellation_request: view.run.cancellationRequest?.requestId || '',
    event_count: view.events.length,
  });
  return [
    ...invocationRows,
    ...(view.timers || []).map((/** @type {Record<string, any>} */ timer) =>
      workflowRow(timer, 'timer'),
    ),
    ...(view.signalWaits || []).map((/** @type {Record<string, any>} */ wait) =>
      workflowRow(wait, 'signal'),
    ),
  ];
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

/**
 * Expose only the stable effect reconciliation identity and resulting
 * lifecycle state. Destination evidence, payload references, operator prose,
 * and attempt fencing material remain inside the verified ledger boundary.
 * @param {{reconciliationId: string, effectId: string, status: string, changed: boolean}} reconciliation - Safe effect reconciliation result.
 * @param {Record<string, any>} view - Verified rebuilt execution-ledger view.
 * @returns {Record<string, any>} - Redacted effect reconciliation response.
 */
export function createExecutionLedgerEffectReconciliationOperatorView(
  reconciliation,
  view,
) {
  return {
    ...createExecutionLedgerOperatorView(view),
    kind: 'wharfie.execution-ledger.effect-reconciliation',
    effectReconciliation: {
      reconciliationId: reconciliation.reconciliationId,
      effectId: reconciliation.effectId,
      status: reconciliation.status,
      changed: reconciliation.changed,
    },
  };
}

/**
 * Present a causally linked managed-effect successor without disclosing the
 * retained request, destination binding, operator reason, or either run's
 * fencing material. Both nested run views pass through the ordinary redaction
 * boundary so this response does not create a more privileged inspection
 * channel.
 * @param {{successorId: string, intent: string, authorizationApplied: boolean, sourceEffectId: string, targetEffectId: string, targetDisposition: 'completed'|'failed'|'blocked'|'in-progress'}} successor - Safe successor result metadata.
 * @param {Record<string, any>} sourceView - Verified rebuilt source run.
 * @param {Record<string, any>} targetView - Verified rebuilt target run.
 * @returns {Record<string, any>} - Redacted causal source/target response.
 */
export function createExecutionLedgerEffectSuccessorOperatorView(
  successor,
  sourceView,
  targetView,
) {
  const source = createExecutionLedgerOperatorView(sourceView);
  const target = createExecutionLedgerOperatorView(targetView);
  return {
    schemaVersion: EXECUTION_LEDGER_OPERATOR_VIEW_SCHEMA_VERSION,
    kind: 'wharfie.execution-ledger.effect-successor',
    integrity: { verified: true },
    effectSuccessor: {
      successorId: successor.successorId,
      intent: successor.intent,
      authorizationApplied: successor.authorizationApplied,
      source: {
        runId: source.run.runId,
        effectId: successor.sourceEffectId,
        status: source.run.status,
      },
      target: {
        runId: target.run.runId,
        effectId: successor.targetEffectId,
        status: target.run.status,
        disposition: successor.targetDisposition,
      },
    },
    source,
    target,
  };
}

export default {
  EXECUTION_LEDGER_OPERATOR_VIEW_SCHEMA_VERSION,
  createExecutionLedgerEffectReconciliationOperatorView,
  createExecutionLedgerEffectSuccessorOperatorView,
  createExecutionLedgerOperatorView,
  createExecutionLedgerReconciliationOperatorView,
  createExecutionLedgerRecoveryOperatorView,
  formatExecutionLedgerOperatorRows,
};
