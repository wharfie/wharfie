/* eslint-env jest */

import { describe, expect, it } from '@jest/globals';

import {
  DURABLE_ACTIVITY_RUN_RECEIPT_KIND,
  DURABLE_ACTIVITY_SUBMIT_RECEIPT_KIND,
  DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION,
  DURABLE_WORKFLOW_START_RECEIPT_KIND,
  createDurableActivityRunReceipt,
  createDurableActivitySubmitReceipt,
  createDurableWorkflowStartReceipt,
  formatDurableActivityRunHumanRow,
  formatDurableActivitySubmitHumanRow,
  formatDurableWorkflowStartHumanRow,
} from '../../src/core/runtime/operator/durable-operation-receipt.js';

const APP_ID = 'receipt-demo';
const RUN_ID = 'run-receipt-1';
const REVISION_ID = 'revision-receipt-1';
const ACTIVITY_ID = 'greet';
const WORKFLOW_ID = 'main';
const IDEMPOTENCY_KEY = 'request-receipt-1';
const PLAN_ID = 'plan-receipt-1';
const CONTINUATION_ID = 'continuation-receipt-1';
const STEP_ID = 'greet-step';
const INVOCATION_ID = 'manual';

const EXPECTED_ACTIVITY = Object.freeze({
  appId: APP_ID,
  runId: RUN_ID,
  revisionId: REVISION_ID,
  activityId: ACTIVITY_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
});
const EXPECTED_WORKFLOW = Object.freeze({
  appId: APP_ID,
  runId: RUN_ID,
  revisionId: REVISION_ID,
  workflowId: WORKFLOW_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
  planId: PLAN_ID,
  definition: {
    steps: [
      { id: STEP_ID, kind: 'activity', activity: ACTIVITY_ID },
      { id: 'pause-step', kind: 'timer' },
      { id: 'approval-step', kind: 'signal' },
    ],
  },
});

/**
 * @returns {Record<string, any>} - Complete foreground activity result.
 */
function activityRunResult() {
  return {
    appId: APP_ID,
    runId: RUN_ID,
    revisionId: REVISION_ID,
    activityName: ACTIVITY_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    input: { password: 'never-project-run-input' },
    outcome: {
      disposition: 'completed',
      reused: true,
      terminalSummary: { token: 'never-project-terminal-summary' },
      evidenceRef: { key: 'never-project-evidence-reference' },
      run: {
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        trigger: { kind: 'manual' },
        status: 'COMPLETED',
        requestRef: { key: 'never-project-run-request' },
      },
      invocation: {
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        invocationId: INVOCATION_ID,
        activityId: ACTIVITY_ID,
        generation: 2,
        status: 'COMPLETED',
        requestRef: { key: 'never-project-invocation-request' },
      },
      attempt: {
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        invocationId: INVOCATION_ID,
        activityId: ACTIVITY_ID,
        attemptId: 'private-attempt-id',
        fencingToken: 'never-project-fencing-token',
        generation: 2,
        status: 'COMPLETED',
      },
    },
  };
}

/**
 * @returns {Record<string, any>} - Compact activity submission result.
 */
function activitySubmitResult() {
  return {
    accepted: true,
    reused: false,
    appId: APP_ID,
    runId: RUN_ID,
    revisionId: REVISION_ID,
    invocationId: INVOCATION_ID,
    activityId: ACTIVITY_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    runStatus: 'RUNNING',
    invocationStatus: 'RUNNABLE',
    callerMetadata: { token: 'never-project-submit-metadata' },
  };
}

/**
 * @returns {Record<string, any>} - Complete activity-headed workflow result.
 */
function activityWorkflowStartResult() {
  return {
    appId: APP_ID,
    runId: RUN_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    planId: PLAN_ID,
    idempotencyKey: IDEMPOTENCY_KEY,
    input: { token: 'never-project-workflow-input' },
    outcome: {
      applied: false,
      receipt: { digest: 'never-project-ledger-receipt' },
      run: {
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        status: 'RUNNING',
        requestRef: { key: 'never-project-start-reference' },
        trigger: {
          kind: 'workflow',
          workflowId: WORKFLOW_ID,
          planId: PLAN_ID,
          planRef: { key: 'never-project-plan-reference' },
        },
      },
      workflowCursor: {
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        workflowId: WORKFLOW_ID,
        planId: PLAN_ID,
        continuationId: CONTINUATION_ID,
        invocationId: 'workflow-invocation-1',
        disposition: 'ACTIVITY_RUNNABLE',
        stepId: STEP_ID,
        stepIndex: 0,
        startRef: { key: 'never-project-cursor-reference' },
      },
      invocation: {
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        invocationId: 'workflow-invocation-1',
        activityId: ACTIVITY_ID,
        status: 'RUNNABLE',
        requestRef: { key: 'never-project-activity-request' },
        workflow: {
          workflowId: WORKFLOW_ID,
          planId: PLAN_ID,
          continuationId: CONTINUATION_ID,
          stepId: STEP_ID,
          stepIndex: 0,
        },
      },
    },
  };
}

/**
 * @param {'timer'|'signal'} kind - Initial workflow activation kind.
 * @returns {Record<string, any>} - Complete timer/signal-headed start result.
 */
function waitingWorkflowStartResult(kind) {
  const result = activityWorkflowStartResult();
  const isTimer = kind === 'timer';
  const resultKey = isTimer ? 'timer' : 'signalWait';
  const idKey = isTimer ? 'timerId' : 'signalWaitId';
  const activationId = isTimer ? 'workflow-timer-1' : 'workflow-signal-wait-1';
  const disposition = isTimer ? 'TIMER_WAITING' : 'SIGNAL_WAITING';
  const cursor = result.outcome.workflowCursor;
  delete result.outcome.invocation;
  delete cursor.invocationId;
  cursor[idKey] = activationId;
  cursor.disposition = disposition;
  cursor.stepId = isTimer ? 'pause-step' : 'approval-step';
  cursor.stepIndex = isTimer ? 1 : 2;
  result.outcome[resultKey] = {
    appId: APP_ID,
    runId: RUN_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    planId: PLAN_ID,
    continuationId: CONTINUATION_ID,
    [idKey]: activationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
    status: 'WAITING',
    privatePayloadRef: { key: `never-project-${kind}-payload` },
  };
  return result;
}

/**
 * @param {'activity'|'timer'|'signal'} kind - Retained terminal activation.
 * @param {'CANCELLED'|'COMPLETED'|'FAILED'|'PROTOCOL_FAILED'} disposition - Terminal cursor state.
 * @param {string} activationStatus - Retained activation lifecycle state.
 * @returns {Record<string, any>} - Complete terminal workflow replay result.
 */
function terminalWorkflowStartResult(kind, disposition, activationStatus) {
  const result =
    kind === 'activity'
      ? activityWorkflowStartResult()
      : waitingWorkflowStartResult(kind);
  result.outcome.applied = false;
  result.outcome.run.status =
    disposition === 'CANCELLED'
      ? 'CANCELLED'
      : disposition === 'COMPLETED'
        ? 'COMPLETED'
        : 'FAILED';
  result.outcome.workflowCursor.disposition = disposition;
  const activationKey =
    kind === 'activity'
      ? 'invocation'
      : kind === 'timer'
        ? 'timer'
        : 'signalWait';
  result.outcome[activationKey].status = activationStatus;
  return result;
}

/**
 * Recursively assert that the receipt projection is immutable.
 * @param {unknown} value - Projected value.
 */
function expectRecursivelyFrozen(value) {
  if (!value || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectRecursivelyFrozen(child);
}

describe('durable operation receipt contract', () => {
  it('exports one shared schema and the three stable receipt kinds', () => {
    expect(DURABLE_OPERATION_RECEIPT_SCHEMA_VERSION).toBe(1);
    expect(DURABLE_ACTIVITY_RUN_RECEIPT_KIND).toBe(
      'wharfie.execution-ledger.activity-run',
    );
    expect(DURABLE_ACTIVITY_SUBMIT_RECEIPT_KIND).toBe(
      'wharfie.execution-ledger.activity-submit',
    );
    expect(DURABLE_WORKFLOW_START_RECEIPT_KIND).toBe(
      'wharfie.execution-ledger.workflow-start',
    );
  });

  it('projects an exact recursively frozen activity-run receipt and human row', () => {
    const receipt = createDurableActivityRunReceipt(
      activityRunResult(),
      EXPECTED_ACTIVITY,
    );

    expect(receipt).toStrictEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-run',
      appId: APP_ID,
      runId: RUN_ID,
      revisionId: REVISION_ID,
      activityId: ACTIVITY_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      disposition: 'completed',
      reused: true,
      runStatus: 'COMPLETED',
      invocationStatus: 'COMPLETED',
      attempt: { generation: 2, status: 'COMPLETED' },
    });
    expect(Object.keys(receipt)).toStrictEqual([
      'schemaVersion',
      'kind',
      'appId',
      'runId',
      'revisionId',
      'activityId',
      'idempotencyKey',
      'disposition',
      'reused',
      'runStatus',
      'invocationStatus',
      'attempt',
    ]);
    expectRecursivelyFrozen(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(
      /never-project|private-attempt-id/,
    );
    expect(formatDurableActivityRunHumanRow(receipt)).toStrictEqual({
      idempotency_key: IDEMPOTENCY_KEY,
      run_id: RUN_ID,
      revision: REVISION_ID,
      activity: ACTIVITY_ID,
      status: 'COMPLETED',
      invocation_status: 'COMPLETED',
      attempt_generation: 2,
      attempt_status: 'COMPLETED',
    });
  });

  it('always projects a null attempt and preserves the human sentinels before generation one', () => {
    const raw = activityRunResult();
    raw.outcome.disposition = 'in-progress';
    raw.outcome.run.status = 'RUNNING';
    raw.outcome.invocation.status = 'RUNNABLE';
    raw.outcome.invocation.generation = 0;
    delete raw.outcome.attempt;

    const receipt = createDurableActivityRunReceipt(raw, EXPECTED_ACTIVITY);

    expect(receipt.attempt).toBeNull();
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(formatDurableActivityRunHumanRow(receipt)).toStrictEqual({
      idempotency_key: IDEMPOTENCY_KEY,
      run_id: RUN_ID,
      revision: REVISION_ID,
      activity: ACTIVITY_ID,
      status: 'RUNNING',
      invocation_status: 'RUNNABLE',
      attempt_generation: 0,
      attempt_status: '',
    });
  });

  it('accepts the verified abandoned attempt behind a blocked uncertain run', () => {
    const raw = activityRunResult();
    raw.outcome.disposition = 'blocked';
    raw.outcome.run.status = 'BLOCKED';
    raw.outcome.invocation.status = 'UNCERTAIN';
    raw.outcome.attempt.status = 'ABANDONED';

    const receipt = createDurableActivityRunReceipt(raw, EXPECTED_ACTIVITY);

    expect(receipt).toMatchObject({
      disposition: 'blocked',
      runStatus: 'BLOCKED',
      invocationStatus: 'UNCERTAIN',
      attempt: { generation: 2, status: 'ABANDONED' },
    });
  });

  it.each([
    ['completed', 'COMPLETED', 'COMPLETED'],
    ['failed', 'FAILED', 'FAILED'],
    ['failed', 'CANCELLED', 'CANCELLED'],
  ])(
    'accepts a reconciled abandoned attempt behind a %s terminal run',
    (disposition, runStatus, invocationStatus) => {
      const raw = activityRunResult();
      raw.outcome.disposition = disposition;
      raw.outcome.run.status = runStatus;
      raw.outcome.invocation.status = invocationStatus;
      raw.outcome.attempt.status = 'ABANDONED';

      expect(
        createDurableActivityRunReceipt(raw, EXPECTED_ACTIVITY),
      ).toMatchObject({
        disposition,
        runStatus,
        invocationStatus,
        attempt: { generation: 2, status: 'ABANDONED' },
      });
    },
  );

  it.each([
    [
      'outer identity',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.runId = 'wrong-run';
      },
      'unexpected immutable identity',
    ],
    [
      'nested run identity',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.run.appId = 'wrong-app';
      },
      'unexpected immutable identity',
    ],
    [
      'nested invocation identity',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.invocation.activityId = 'wrong-activity';
      },
      'unexpected immutable identity',
    ],
    [
      'attempt linkage',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.attempt.generation = 3;
      },
      'unexpected immutable identity',
    ],
    [
      'unknown durable status',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.run.status = 'SECRET_STATUS';
      },
      'inconsistent durable status',
    ],
    [
      'run/invocation status pair',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.invocation.status = 'RUNNING';
      },
      'inconsistent durable status',
    ],
    [
      'disposition',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.disposition = 'in-progress';
      },
      'inconsistent durable status',
    ],
    [
      'attempt status',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.attempt.status = 'STARTED';
      },
      'inconsistent durable status',
    ],
  ])('rejects a mismatched activity-run %s', (_name, mutate, message) => {
    const raw = activityRunResult();
    mutate(raw);

    expect(() =>
      createDurableActivityRunReceipt(raw, EXPECTED_ACTIVITY),
    ).toThrow(message);
  });

  it('projects only the real compact submit receipt and preserves its human row', () => {
    const receipt = createDurableActivitySubmitReceipt(
      activitySubmitResult(),
      EXPECTED_ACTIVITY,
    );

    expect(receipt).toStrictEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-submit',
      appId: APP_ID,
      runId: RUN_ID,
      revisionId: REVISION_ID,
      activityId: ACTIVITY_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      reused: false,
      runStatus: 'RUNNING',
      invocationStatus: 'RUNNABLE',
    });
    expectRecursivelyFrozen(receipt);
    expect(JSON.stringify(receipt)).not.toContain(
      'never-project-submit-metadata',
    );
    expect(formatDurableActivitySubmitHumanRow(receipt)).toStrictEqual({
      idempotency_key: IDEMPOTENCY_KEY,
      run_id: RUN_ID,
      revision: REVISION_ID,
      activity: ACTIVITY_ID,
      status: 'RUNNING',
      invocation_status: 'RUNNABLE',
      attempt_generation: 0,
      attempt_status: '',
      reused: false,
    });
  });

  it.each([
    {
      outcome: {
        run: { status: 'RUNNING' },
        invocation: { status: 'RUNNABLE' },
      },
    },
    {
      accepted: {
        run: { status: 'RUNNING' },
        invocation: { status: 'RUNNABLE' },
      },
    },
  ])('rejects a legacy nested submit shape', (legacy) => {
    expect(() =>
      createDurableActivitySubmitReceipt(legacy, EXPECTED_ACTIVITY),
    ).toThrow('Durable activity submit returned an invalid result.');
  });

  it.each([
    [
      'identity',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.invocationId = 'wrong-invocation';
      },
      'unexpected immutable identity',
    ],
    [
      'status',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.invocationStatus = 'COMPLETED';
      },
      'inconsistent durable status',
    ],
  ])('rejects an inconsistent compact submit %s', (_name, mutate, message) => {
    const raw = activitySubmitResult();
    mutate(raw);

    expect(() =>
      createDurableActivitySubmitReceipt(raw, EXPECTED_ACTIVITY),
    ).toThrow(message);
  });

  it('projects an exact recursively frozen activity-headed workflow receipt and human row', () => {
    const receipt = createDurableWorkflowStartReceipt(
      activityWorkflowStartResult(),
      EXPECTED_WORKFLOW,
    );

    expect(receipt).toStrictEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.workflow-start',
      appId: APP_ID,
      runId: RUN_ID,
      revisionId: REVISION_ID,
      workflowId: WORKFLOW_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      reused: true,
      runStatus: 'RUNNING',
      cursor: {
        disposition: 'ACTIVITY_RUNNABLE',
        stepId: STEP_ID,
        stepIndex: 0,
      },
      nextActivation: {
        kind: 'activity',
        status: 'RUNNABLE',
      },
    });
    expectRecursivelyFrozen(receipt);
    expect(JSON.stringify(receipt)).not.toMatch(/never-project|plan-receipt-1/);
    expect(formatDurableWorkflowStartHumanRow(receipt)).toStrictEqual({
      idempotency_key: IDEMPOTENCY_KEY,
      run_id: RUN_ID,
      revision: REVISION_ID,
      workflow: WORKFLOW_ID,
      status: 'RUNNING',
      cursor_disposition: 'ACTIVITY_RUNNABLE',
      step: STEP_ID,
      step_index: 0,
      activation_kind: 'activity',
      activation_status: 'RUNNABLE',
      reused: true,
    });
  });

  it.each([
    ['timer', 'TIMER_WAITING', 'pause-step', 1],
    ['signal', 'SIGNAL_WAITING', 'approval-step', 2],
  ])(
    'projects and freezes a %s-headed workflow start',
    (kind, disposition, stepId, stepIndex) => {
      const receipt = createDurableWorkflowStartReceipt(
        waitingWorkflowStartResult(/** @type {'timer'|'signal'} */ (kind)),
        EXPECTED_WORKFLOW,
      );

      expect(receipt).toStrictEqual({
        schemaVersion: 1,
        kind: 'wharfie.execution-ledger.workflow-start',
        appId: APP_ID,
        runId: RUN_ID,
        revisionId: REVISION_ID,
        workflowId: WORKFLOW_ID,
        idempotencyKey: IDEMPOTENCY_KEY,
        reused: true,
        runStatus: 'RUNNING',
        cursor: {
          disposition,
          stepId,
          stepIndex,
        },
        nextActivation: {
          kind,
          status: 'WAITING',
        },
      });
      expectRecursivelyFrozen(receipt);
      expect(JSON.stringify(receipt)).not.toContain('never-project');
    },
  );

  it.each([
    ['activity', 'COMPLETED', 'COMPLETED'],
    ['timer', 'COMPLETED', 'FIRED'],
    ['signal', 'COMPLETED', 'CONSUMED'],
    ['activity', 'FAILED', 'FAILED'],
    ['activity', 'PROTOCOL_FAILED', 'FAILED'],
    ['activity', 'CANCELLED', 'CANCELLED'],
    ['activity', 'CANCELLED', 'COMPLETED'],
    ['timer', 'CANCELLED', 'CANCELLED'],
    ['signal', 'CANCELLED', 'CANCELLED'],
  ])(
    'projects a terminal %s-headed %s workflow replay without inventing a next activation',
    (kind, disposition, activationStatus) => {
      const receipt = createDurableWorkflowStartReceipt(
        terminalWorkflowStartResult(
          /** @type {'activity'|'timer'|'signal'} */ (kind),
          /** @type {'CANCELLED'|'COMPLETED'|'FAILED'|'PROTOCOL_FAILED'} */ (
            disposition
          ),
          activationStatus,
        ),
        EXPECTED_WORKFLOW,
      );
      const expectedRunStatus =
        disposition === 'CANCELLED'
          ? 'CANCELLED'
          : disposition === 'COMPLETED'
            ? 'COMPLETED'
            : 'FAILED';

      expect(receipt).toMatchObject({
        reused: true,
        runStatus: expectedRunStatus,
        cursor: { disposition },
        nextActivation: null,
      });
      expectRecursivelyFrozen(receipt);
      expect(formatDurableWorkflowStartHumanRow(receipt)).toMatchObject({
        status: expectedRunStatus,
        cursor_disposition: disposition,
        activation_kind: 'terminal',
        activation_status: expectedRunStatus,
      });
    },
  );

  it.each([
    [
      'outer identity',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.workflowId = 'wrong-workflow';
      },
      'unexpected immutable identity',
    ],
    [
      'trigger linkage',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.run.trigger.planId = 'wrong-plan';
      },
      'unexpected immutable identity',
    ],
    [
      'manifest plan binding',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.planId = 'coherent-wrong-plan';
        raw.outcome.run.trigger.planId = 'coherent-wrong-plan';
        raw.outcome.workflowCursor.planId = 'coherent-wrong-plan';
        raw.outcome.invocation.workflow.planId = 'coherent-wrong-plan';
      },
      'unexpected immutable identity',
    ],
    [
      'manifest step binding',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.workflowCursor.stepId = 'coherent-wrong-step';
        raw.outcome.invocation.workflow.stepId = 'coherent-wrong-step';
      },
      'unexpected immutable identity',
    ],
    [
      'cursor linkage',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.workflowCursor.appId = 'wrong-app';
      },
      'unexpected immutable identity',
    ],
    [
      'activation identity',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.invocation.invocationId = 'wrong-invocation';
      },
      'unexpected immutable identity',
    ],
    [
      'nested workflow linkage',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.invocation.workflow.stepIndex = 1;
      },
      'unexpected immutable identity',
    ],
    [
      'cursor disposition',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.workflowCursor.disposition = 'ACTIVITY_RUNNING';
      },
      'inconsistent durable status',
    ],
    [
      'activation status',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.invocation.status = 'RUNNING';
      },
      'inconsistent durable status',
    ],
    [
      'activation cardinality',
      /** @param {Record<string, any>} raw */
      (raw) => {
        raw.outcome.timer = waitingWorkflowStartResult('timer').outcome.timer;
      },
      'invalid result',
    ],
  ])('rejects a mismatched workflow-start %s', (_name, mutate, message) => {
    const raw = activityWorkflowStartResult();
    mutate(raw);

    expect(() =>
      createDurableWorkflowStartReceipt(raw, EXPECTED_WORKFLOW),
    ).toThrow(message);
  });
});
