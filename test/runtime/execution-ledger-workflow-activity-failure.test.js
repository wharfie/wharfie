/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtempSync, promises as fsp, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAdapterMatrix } from '../helpers/db-adapters.js';
import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
} from '../../src/core/lib/ledger/ready-work.js';
import {
  WorkflowCursorDisposition,
  createWorkflowRunId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import {
  getEventSortKey,
  getWorkflowCursorProjectionSortKey,
} from '../../src/core/lib/ledger/record-key.js';

const APP_ID = 'workflow-failure-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-failure-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'failure-workflow';
const FIRST_STEP_ID = 'first';
const SECOND_STEP_ID = 'second';
const FIRST_ACTIVITY_ID = 'first-activity';
const SECOND_ACTIVITY_ID = 'second-activity';
const BASE_OBSERVED_AT = 1_700_200_000_000;
const ACTOR = Object.freeze({ kind: 'worker', id: 'workflow-failure-test' });
const ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA =
  'wharfie.execution.activity-evidence.v1';

const TWO_ACTIVITY_DEFINITION = Object.freeze({
  steps: [
    {
      id: FIRST_STEP_ID,
      kind: 'activity',
      activity: FIRST_ACTIVITY_ID,
      input: { kind: 'workflow-input' },
    },
    {
      id: SECOND_STEP_ID,
      kind: 'activity',
      activity: SECOND_ACTIVITY_ID,
      input: { kind: 'step-output', step: FIRST_STEP_ID },
    },
  ],
});

/** @type {ReadonlyArray<{type: 'failed'|'protocol-failed', disposition: string}>} */
const TERMINAL_CASES = Object.freeze([
  {
    type: 'failed',
    disposition: WorkflowCursorDisposition.FAILED,
  },
  {
    type: 'protocol-failed',
    disposition: WorkflowCursorDisposition.PROTOCOL_FAILED,
  },
]);

/** @type {ReadonlyArray<'direct'|'reconciled'>} */
const PATH_CASES = Object.freeze(['direct', 'reconciled']);

/** @type {ReadonlyArray<{target: 'evidence'|'cursor'|'event-terminal', path: 'direct'|'reconciled'}>} */
const TAMPER_CASES = Object.freeze([
  { target: 'evidence', path: 'direct' },
  { target: 'evidence', path: 'reconciled' },
  { target: 'cursor', path: 'reconciled' },
  { target: 'event-terminal', path: 'direct' },
]);

/** @param {Record<string, any>} cursor - Current workflow cursor. */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/** @param {string} label - Scenario identity. */
function workflowRunId(label) {
  return createWorkflowRunId({ appId: APP_ID, idempotencyKey: label });
}

/** @param {Record<string, any>} start - Durable start frame. @param {any} result - Activity result. */
function completedEvidence(start, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    result,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

/** @param {Record<string, any>} start - Durable start frame. @param {'failed'|'protocol-failed'} type - Terminal type. @param {string} marker - Evidence identity. @param {boolean} [withCancel] - Whether to add an unauthorized cancel. */
function terminalEvidence(start, type, marker, withCancel = false) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const frames = [acceptedStart];
  if (withCancel) {
    frames.push(
      transcript.acceptHostFrame({
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'cancel',
        attemptId: acceptedStart.attemptId,
        reason: {
          code: 'workflow-cancel-without-authority',
          name: 'WorkflowCancellationAuthorityError',
          message: 'No durable workflow cancellation decision exists.',
          details: { marker },
        },
      }),
    );
  }
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type,
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: {
      code:
        type === 'failed' ? 'application-failed' : 'activity-protocol-failed',
      name:
        type === 'failed'
          ? 'ApplicationFailure'
          : 'ActivityAttemptProtocolError',
      message:
        type === 'failed'
          ? 'The workflow activity failed as requested by the test.'
          : 'The activity transport could not establish a valid completion.',
      details: { marker },
    },
  });
  frames.push(terminal);
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames,
    transcript: transcript.snapshot(),
  };
}

/** @param {any} db - Adapter. @param {string} tableName - Ledger table. @param {any} payloadStore - Payload store. */
function createLedger(db, tableName, payloadStore) {
  return createExecutionLedger({ db, tableName, payloadStore });
}

/** @param {ReturnType<typeof getAdapterMatrix>[number]} adapter - Adapter factory. @param {string} label - Scenario identity. */
async function createHarness(adapter, label) {
  const { db, cleanup: cleanupDb } = await adapter.create();
  const payloadRoot = mkdtempSync(
    join(tmpdir(), `wharfie-workflow-failure-${adapter.name}-`),
  );
  const payloadStore = createLocalExecutionPayloadStore({
    path: payloadRoot,
    storeId: `workflow-failure-${createHash('sha256')
      .update(`${adapter.name}:${label}`)
      .digest('hex')
      .slice(0, 20)}`,
  });
  return {
    db,
    payloadStore,
    async cleanup() {
      try {
        await cleanupDb();
      } finally {
        rmSync(payloadRoot, { recursive: true, force: true });
      }
    },
  };
}

/** @param {ReturnType<typeof createExecutionLedger>} ledger - Ledger. */
async function listReadyWork(ledger) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId: REVISION_ID,
    observedAt: Number.MAX_SAFE_INTEGER,
    limit: 100,
  });
}

/** @param {ReturnType<typeof createExecutionLedger>} ledger - Ledger. @param {string} runId - Run identity. @param {string} label - Scenario identity. @returns {Promise<Record<string, any>>} Second activity fixture. */
async function createSecondStartedWorkflow(ledger, runId, label) {
  const created = await ledger.createWorkflowRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: TWO_ACTIVITY_DEFINITION,
    input: { scenario: label },
    callerMetadata: { source: 'workflow-activity-failure-test' },
    transitionId: `${label}-create`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT,
  });
  const firstClaimed = await ledger.claimWorkflowActivity({
    runId,
    invocationId: created.invocation.invocationId,
    cursor: cursorGuard(created.workflowCursor),
    fencingToken: `${label}-first-fence`,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: `${label}-first-claim`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 1,
  });
  const firstStarted = await ledger.markWorkflowActivityStarted({
    runId,
    invocationId: firstClaimed.invocation.invocationId,
    cursor: cursorGuard(firstClaimed.workflowCursor),
    attemptId: firstClaimed.attempt.attemptId,
    fencingToken: firstClaimed.attempt.fencingToken,
    generation: firstClaimed.attempt.generation,
    expectedVersion: firstClaimed.run.version,
    transitionId: `${label}-first-start`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 2,
  });
  const firstOutput = { prefix: label, ordinal: 1 };
  const firstSucceeded = await ledger.commitVerifiedWorkflowActivityTerminal({
    runId,
    invocationId: firstStarted.invocation.invocationId,
    cursor: cursorGuard(firstStarted.workflowCursor),
    attemptId: firstStarted.attempt.attemptId,
    fencingToken: firstStarted.attempt.fencingToken,
    generation: firstStarted.attempt.generation,
    expectedVersion: firstStarted.run.version,
    transitionId: `${label}-first-success`,
    evidence: completedEvidence(firstStarted.startFrame, firstOutput),
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 3,
  });
  const secondClaimed = await ledger.claimWorkflowActivity({
    runId,
    invocationId: firstSucceeded.nextInvocation.invocationId,
    cursor: cursorGuard(firstSucceeded.workflowCursor),
    fencingToken: `${label}-second-fence`,
    expectedGeneration: 0,
    expectedVersion: firstSucceeded.run.version,
    transitionId: `${label}-second-claim`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 4,
  });
  const secondStarted = await ledger.markWorkflowActivityStarted({
    runId,
    invocationId: secondClaimed.invocation.invocationId,
    cursor: cursorGuard(secondClaimed.workflowCursor),
    attemptId: secondClaimed.attempt.attemptId,
    fencingToken: secondClaimed.attempt.fencingToken,
    generation: secondClaimed.attempt.generation,
    expectedVersion: secondClaimed.run.version,
    transitionId: `${label}-second-start`,
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 5,
  });
  expect(secondStarted.startFrame.input).toEqual(firstOutput);
  expect(secondStarted.workflowCursor.outputs).toEqual(
    firstSucceeded.workflowCursor.outputs,
  );
  expect(secondStarted.workflowCursor.outputs).toHaveLength(1);
  return {
    created,
    firstClaimed,
    firstStarted,
    firstSucceeded,
    firstOutput,
    secondClaimed,
    secondStarted,
  };
}

/** @param {string} runId - Run identity. @param {Record<string, any>} started - Started transition. @param {string} transitionId - Transition identity. @param {'failed'|'protocol-failed'} type - Terminal type. @param {string} marker - Evidence identity. @param {boolean} [withCancel] - Add unauthorized cancel. @returns {Record<string, any>} Terminal request. */
function directTerminalRequest(
  runId,
  started,
  transitionId,
  type,
  marker,
  withCancel = false,
) {
  return {
    runId,
    invocationId: started.invocation.invocationId,
    cursor: cursorGuard(started.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    coordinatorEpoch: started.attempt.coordinatorEpoch,
    expectedVersion: started.run.version,
    transitionId,
    evidence: terminalEvidence(started.startFrame, type, marker, withCancel),
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 6,
  };
}

/** @param {string} runId - Run identity. @param {Record<string, any>} started - Started transition. @param {string} transitionId - Transition identity. */
function uncertaintyRequest(runId, started, transitionId) {
  return {
    runId,
    invocationId: started.invocation.invocationId,
    cursor: cursorGuard(started.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    coordinatorEpoch: started.attempt.coordinatorEpoch,
    expectedVersion: started.run.version,
    transitionId,
    reason: { code: 'runner-outcome-lost' },
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 6,
  };
}

/** @param {ReturnType<typeof createExecutionLedger>} ledger - Ledger. @param {string} runId - Run identity. @param {Record<string, any>} started - Started transition. @param {string} label - Scenario identity. */
async function makeSecondUncertain(ledger, runId, started, label) {
  return await ledger.markWorkflowActivityAttemptUncertain(
    uncertaintyRequest(runId, started, `${label}-uncertain`),
  );
}

/** @param {ReturnType<typeof createExecutionLedger>} ledger - Ledger. @param {string} runId - Run identity. @param {Record<string, any>} started - Started transition. @param {Record<string, any>} uncertain - Uncertain transition. @param {string} transitionId - Transition identity. @param {'completed'|'failed'|'protocol-failed'} type - Terminal type. @param {string} marker - Evidence identity. @param {boolean} [withCancel] - Add unauthorized cancel. @returns {Promise<Record<string, any>>} Reconciliation request. */
async function reconciliationRequest(
  ledger,
  runId,
  started,
  uncertain,
  transitionId,
  type,
  marker,
  withCancel = false,
) {
  const uncertaintyEvent = (await ledger.getEvents(runId)).find(
    (/** @type {Record<string, any>} */ event) =>
      event.type === 'workflow-activity-became-uncertain' &&
      event.payload?.attempt?.attemptId === started.attempt.attemptId,
  );
  if (!uncertaintyEvent) {
    throw new Error('Expected the exact second-activity uncertainty event.');
  }
  return {
    runId,
    invocationId: started.invocation.invocationId,
    cursor: cursorGuard(uncertain.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    coordinatorEpoch: started.attempt.coordinatorEpoch,
    expectedVersion: uncertain.run.version,
    uncertaintyEventId: uncertaintyEvent.event_id,
    uncertaintySequence: uncertaintyEvent.sequence,
    transitionId,
    reconciliationId: `${transitionId}-decision`,
    reason: { code: 'retained-transcript-recovered' },
    evidence:
      type === 'completed'
        ? completedEvidence(started.startFrame, { marker, ordinal: 2 })
        : terminalEvidence(started.startFrame, type, marker, withCancel),
    actor: ACTOR,
    observedAt: BASE_OBSERVED_AT + 7,
  };
}

/** @param {ReturnType<typeof createExecutionLedger>} ledger - Ledger. @param {string} runId - Run identity. @param {string} label - Scenario identity. @param {'direct'|'reconciled'} path - Decision path. @param {'failed'|'protocol-failed'} type - Terminal type. @param {string} [marker] - Evidence identity. @param {boolean} [withCancel] - Add unauthorized cancel. @returns {Promise<Record<string, any>>} Prepared mutation. */
async function prepareFailureScenario(
  ledger,
  runId,
  label,
  path,
  type,
  marker = 'alpha',
  withCancel = false,
) {
  const workflow = await createSecondStartedWorkflow(ledger, runId, label);
  if (path === 'direct') {
    const request = directTerminalRequest(
      runId,
      workflow.secondStarted,
      `${label}-terminal`,
      type,
      marker,
      withCancel,
    );
    return {
      workflow,
      request,
      uncertain: undefined,
      mutate: (
        /** @type {ReturnType<typeof createExecutionLedger>} */ targetLedger,
        /** @type {Record<string, any>} */ nextRequest = request,
      ) => targetLedger.commitVerifiedWorkflowActivityTerminal(nextRequest),
    };
  }
  const uncertain = await makeSecondUncertain(
    ledger,
    runId,
    workflow.secondStarted,
    label,
  );
  const request = await reconciliationRequest(
    ledger,
    runId,
    workflow.secondStarted,
    uncertain,
    `${label}-reconcile`,
    type,
    marker,
    withCancel,
  );
  return {
    workflow,
    request,
    uncertain,
    mutate: (
      /** @type {ReturnType<typeof createExecutionLedger>} */ targetLedger,
      /** @type {Record<string, any>} */ nextRequest = request,
    ) => targetLedger.reconcileUncertainWorkflowActivityAttempt(nextRequest),
  };
}

/** @param {{ledger: ReturnType<typeof createExecutionLedger>, runId: string, path: 'direct'|'reconciled', type: 'failed'|'protocol-failed', disposition: string, scenario: Record<string, any>, result: Record<string, any>}} input - Expected terminal state. */
async function expectTerminalFailureState({
  ledger,
  runId,
  path,
  type,
  disposition,
  scenario,
  result,
}) {
  const { workflow, uncertain } = scenario;
  expect(result).toMatchObject({
    applied: true,
    receipt: {
      type:
        path === 'direct'
          ? 'workflow-activity-failed'
          : 'workflow-activity-uncertainty-reconciled',
    },
    run: { status: RunStatus.FAILED },
    invocation: {
      invocationId: workflow.secondStarted.invocation.invocationId,
      status: InvocationStatus.FAILED,
      terminal: { type },
    },
    workflowCursor: {
      stepId: SECOND_STEP_ID,
      stepIndex: 1,
      disposition,
      outputs: workflow.firstSucceeded.workflowCursor.outputs,
    },
  });
  expect(result).not.toHaveProperty('outputRef');
  expect(result).not.toHaveProperty('nextInvocation');
  expect(result.workflowCursor.outputs).toEqual(
    workflow.firstSucceeded.workflowCursor.outputs,
  );
  if (path === 'direct') {
    expect(result.attempt).toMatchObject({
      attemptId: workflow.secondStarted.attempt.attemptId,
      status: AttemptStatus.FAILED,
      terminal: { type },
      evidenceRef: expect.objectContaining({
        payloadSchema: ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA,
      }),
    });
  } else {
    expect(uncertain).toBeDefined();
    expect(result.attempt).toEqual(uncertain.attempt);
    expect(result.attempt).toMatchObject({
      attemptId: workflow.secondStarted.attempt.attemptId,
      status: AttemptStatus.ABANDONED,
    });
  }
  await expect(listReadyWork(ledger)).resolves.toMatchObject({ items: [] });
  const rebuilt = await ledger.rebuildRun(runId);
  if (!rebuilt) throw new Error('Expected rebuilt workflow failure state.');
  expect(rebuilt).toMatchObject({
    head: {
      version: path === 'direct' ? 7 : 8,
      sequence: path === 'direct' ? 7 : 8,
    },
    run: { status: RunStatus.FAILED },
    workflowCursor: {
      disposition,
      outputs: workflow.firstSucceeded.workflowCursor.outputs,
    },
  });
  expect(rebuilt.workflowCursor.outputs).toEqual(
    workflow.firstSucceeded.workflowCursor.outputs,
  );
  const rebuiltInvocation = rebuilt.invocations.find(
    (/** @type {Record<string, any>} */ invocation) =>
      invocation.invocationId ===
      workflow.secondStarted.invocation.invocationId,
  );
  expect(rebuiltInvocation).toMatchObject({
    status: InvocationStatus.FAILED,
    terminal: { type },
  });
  const rebuiltAttempt = rebuilt.attempts.find(
    (/** @type {Record<string, any>} */ attempt) =>
      attempt.attemptId === workflow.secondStarted.attempt.attemptId,
  );
  if (path === 'direct') {
    expect(rebuiltAttempt).toEqual(result.attempt);
  } else {
    expect(rebuiltAttempt).toEqual(uncertain.attempt);
  }
}

/** @param {any} db - Adapter. @param {string} tableName - Ledger table. @param {Record<string, any>} ready - Ready-work item. @param {number} delta - Version delta from the original. */
async function corruptReadyWorkVersion(db, tableName, ready, delta) {
  const scope = createExecutionLedgerReadyWorkScope({
    appId: APP_ID,
    revisionId: REVISION_ID,
  });
  await db.update({
    tableName,
    keyName: 'run_id',
    keyValue: scope.readyWorkId,
    sortKeyName: 'sort_key',
    sortKeyValue: getExecutionLedgerReadyWorkSortKey({
      availableAt: ready.availableAt,
      runId: ready.runId,
    }),
    updates: [
      {
        property: ['run_version'],
        propertyValue: ready.runVersion + delta,
      },
    ],
  });
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} workflow activity failure`, () => {
    test.each(
      PATH_CASES.flatMap((path) =>
        TERMINAL_CASES.map(({ type, disposition }) => ({
          path,
          type,
          disposition,
        })),
      ),
    )(
      '$path second activity $type preserves its output prefix and terminalizes without successor work',
      async ({ path, type, disposition }) => {
        const label = `happy-${path}-${type}-${adapter.name}`;
        const harness = await createHarness(adapter, label);
        const tableName = `workflow-failure-happy-${path}-${type}`;
        const runId = workflowRunId(label);
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const scenario = await prepareFailureScenario(
            ledger,
            runId,
            label,
            path,
            type,
          );
          const result = await scenario.mutate(ledger);
          await expectTerminalFailureState({
            ledger,
            runId,
            path,
            type,
            disposition,
            scenario,
            result,
          });
          await expect(
            harness.payloadStore.readJson(
              scenario.workflow.firstSucceeded.outputRef,
            ),
          ).resolves.toEqual({
            schemaVersion: 1,
            kind: 'workflowOutput',
            value: scenario.workflow.firstOutput,
          });

          const replayed = await scenario.mutate(ledger);
          expect(replayed).toEqual({ ...result, applied: false });

          const changedEvidence = {
            ...scenario.request,
            evidence: terminalEvidence(
              scenario.workflow.secondStarted.startFrame,
              type,
              'omega',
            ),
          };
          await expect(
            scenario.mutate(ledger, changedEvidence),
          ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
          const otherType = type === 'failed' ? 'protocol-failed' : 'failed';
          const changedType = {
            ...scenario.request,
            evidence: terminalEvidence(
              scenario.workflow.secondStarted.startFrame,
              otherType,
              'alpha',
            ),
          };
          await expect(
            scenario.mutate(ledger, changedType),
          ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(
      PATH_CASES.flatMap((path) =>
        TERMINAL_CASES.map(({ type }) => ({ path, type })),
      ),
    )(
      '$path $type rejects unauthorized host cancel evidence before first write and on retained-receipt replay',
      async ({ path, type }) => {
        const label = `cancel-${path}-${type}-${adapter.name}`;
        const harness = await createHarness(adapter, label);
        const tableName = `workflow-failure-cancel-${path}-${type}`;
        const runId = workflowRunId(label);
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const unauthorized = await prepareFailureScenario(
            ledger,
            runId,
            label,
            path,
            type,
            'alpha',
            true,
          );
          const before = await ledger.rebuildRun(runId);
          const readyBefore = await listReadyWork(ledger);
          await expect(unauthorized.mutate(ledger)).rejects.toThrow(
            /workflow cancellation authority is not implemented/,
          );
          await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
          await expect(listReadyWork(ledger)).resolves.toEqual(readyBefore);

          const validRequest = {
            ...unauthorized.request,
            evidence: terminalEvidence(
              unauthorized.workflow.secondStarted.startFrame,
              type,
              'alpha',
            ),
          };
          const retained = await unauthorized.mutate(ledger, validRequest);
          expect(retained.applied).toBe(true);
          await expect(unauthorized.mutate(ledger)).rejects.toThrow(
            /workflow cancellation authority is not implemented/,
          );
          await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
            run: { status: RunStatus.FAILED },
          });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(
      PATH_CASES.flatMap((path) =>
        ['evidence-publication', 'transaction'].map((failureKind) => ({
          path,
          failureKind,
        })),
      ),
    )(
      '$path $failureKind failure preserves exact authority and permits exact failure retry',
      async ({ path, failureKind }) => {
        const label = `fault-${path}-${failureKind}-${adapter.name}`;
        const harness = await createHarness(adapter, label);
        const tableName = `workflow-failure-fault-${path}-${failureKind}`;
        const runId = workflowRunId(label);
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const scenario = await prepareFailureScenario(
            ledger,
            runId,
            label,
            path,
            'failed',
          );
          const before = await ledger.rebuildRun(runId);
          const readyBefore = await listReadyWork(ledger);
          let failureObserved = false;
          let failingLedger;
          if (failureKind === 'evidence-publication') {
            const failingPayloadStore = {
              /** @param {{value: unknown, payloadSchema: string}} input - Payload publication. */
              async putJson(input) {
                if (
                  !failureObserved &&
                  input.payloadSchema === ACTIVITY_EVIDENCE_PAYLOAD_SCHEMA
                ) {
                  failureObserved = true;
                  throw new Error('injected evidence publication failure');
                }
                return await harness.payloadStore.putJson(input);
              },
              /** @param {unknown} reference - Payload reference. */
              async readBytes(reference) {
                return await harness.payloadStore.readBytes(reference);
              },
            };
            failingLedger = createLedger(
              harness.db,
              tableName,
              failingPayloadStore,
            );
          } else {
            const failingDb = {
              ...harness.db,
              /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} _params - Rejected terminal transaction. */
              async transactionWrite(_params) {
                failureObserved = true;
                throw new Error('injected terminal transaction failure');
              },
            };
            failingLedger = createLedger(
              failingDb,
              tableName,
              harness.payloadStore,
            );
          }
          await expect(scenario.mutate(failingLedger)).rejects.toThrow(
            failureKind === 'evidence-publication'
              ? 'injected evidence publication failure'
              : 'injected terminal transaction failure',
          );
          expect(failureObserved).toBe(true);
          await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
          await expect(listReadyWork(ledger)).resolves.toEqual(readyBefore);
          await expect(ledger.getEvents(runId)).resolves.toHaveLength(
            path === 'direct' ? 6 : 7,
          );

          const retried = await scenario.mutate(ledger);
          expect(retried).toMatchObject({
            applied: true,
            run: { status: RunStatus.FAILED },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.FAILED,
            },
          });
          const replayed = await scenario.mutate(ledger);
          expect(replayed).toEqual({ ...retried, applied: false });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['failure', 'uncertainty'])(
      '%s wins a direct-failure versus uncertainty transaction race without mixed authority',
      async (winnerKind) => {
        const label = `direct-uncertainty-race-${winnerKind}-${adapter.name}`;
        const harness = await createHarness(adapter, label);
        const tableName = `workflow-failure-direct-uncertainty-${winnerKind}`;
        const runId = workflowRunId(label);
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const workflow = await createSecondStartedWorkflow(
            directLedger,
            runId,
            label,
          );
          const failureRequest = directTerminalRequest(
            runId,
            workflow.secondStarted,
            `${label}-failure`,
            'failed',
            'alpha',
          );
          const lostRequest = uncertaintyRequest(
            runId,
            workflow.secondStarted,
            `${label}-uncertain`,
          );
          let injectWinner = true;
          let winner;
          const guardedDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing transaction. */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                winner =
                  winnerKind === 'failure'
                    ? await directLedger.commitVerifiedWorkflowActivityTerminal(
                        failureRequest,
                      )
                    : await directLedger.markWorkflowActivityAttemptUncertain(
                        lostRequest,
                      );
              }
              return await harness.db.transactionWrite(params);
            },
          };
          const racingLedger = createLedger(
            guardedDb,
            tableName,
            harness.payloadStore,
          );
          const losingMutation =
            winnerKind === 'failure'
              ? racingLedger.markWorkflowActivityAttemptUncertain(lostRequest)
              : racingLedger.commitVerifiedWorkflowActivityTerminal(
                  failureRequest,
                );
          await expect(losingMutation).rejects.toBeInstanceOf(
            ExecutionLedgerConflictError,
          );
          expect(winner).toBeDefined();
          const rebuilt = await directLedger.rebuildRun(runId);
          if (!rebuilt) throw new Error('Expected rebuilt race winner.');
          const secondAttempt = rebuilt.attempts.find(
            (/** @type {Record<string, any>} */ attempt) =>
              attempt.attemptId === workflow.secondStarted.attempt.attemptId,
          );
          if (winnerKind === 'failure') {
            expect(rebuilt).toMatchObject({
              run: { status: RunStatus.FAILED },
              workflowCursor: {
                disposition: WorkflowCursorDisposition.FAILED,
              },
            });
            expect(secondAttempt).toMatchObject({
              status: AttemptStatus.FAILED,
            });
          } else {
            expect(rebuilt).toMatchObject({
              run: { status: RunStatus.BLOCKED },
              workflowCursor: {
                disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
              },
            });
            expect(secondAttempt).toMatchObject({
              status: AttemptStatus.ABANDONED,
            });
          }
          expect(rebuilt.workflowCursor.outputs).toEqual(
            workflow.firstSucceeded.workflowCursor.outputs,
          );
          await expect(listReadyWork(directLedger)).resolves.toMatchObject({
            items: [],
          });
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(7);
        } finally {
          await harness.cleanup();
        }
      },
    );

    test.each(['completed', 'failed'])(
      '%s wins a completed-versus-failure reconciliation race',
      async (winnerType) => {
        const label = `reconciliation-race-${winnerType}-${adapter.name}`;
        const harness = await createHarness(adapter, label);
        const tableName = `workflow-failure-reconciliation-race-${winnerType}`;
        const runId = workflowRunId(label);
        try {
          const directLedger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const workflow = await createSecondStartedWorkflow(
            directLedger,
            runId,
            label,
          );
          const uncertain = await makeSecondUncertain(
            directLedger,
            runId,
            workflow.secondStarted,
            label,
          );
          const completedRequest = await reconciliationRequest(
            directLedger,
            runId,
            workflow.secondStarted,
            uncertain,
            `${label}-completed`,
            'completed',
            'completed-winner',
          );
          const failedRequest = await reconciliationRequest(
            directLedger,
            runId,
            workflow.secondStarted,
            uncertain,
            `${label}-failed`,
            'failed',
            'failed-winner',
          );
          const winnerRequest =
            winnerType === 'completed' ? completedRequest : failedRequest;
          const loserRequest =
            winnerType === 'completed' ? failedRequest : completedRequest;
          let injectWinner = true;
          let winner;
          const guardedDb = {
            ...harness.db,
            /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing reconciliation transaction. */
            async transactionWrite(params) {
              if (injectWinner) {
                injectWinner = false;
                winner =
                  await directLedger.reconcileUncertainWorkflowActivityAttempt(
                    winnerRequest,
                  );
              }
              return await harness.db.transactionWrite(params);
            },
          };
          const racingLedger = createLedger(
            guardedDb,
            tableName,
            harness.payloadStore,
          );
          await expect(
            racingLedger.reconcileUncertainWorkflowActivityAttempt(
              loserRequest,
            ),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
          expect(winner).toBeDefined();
          const rebuilt = await directLedger.rebuildRun(runId);
          if (!rebuilt) {
            throw new Error('Expected rebuilt reconciliation race winner.');
          }
          expect(
            rebuilt.attempts.find(
              (/** @type {Record<string, any>} */ attempt) =>
                attempt.attemptId === workflow.secondStarted.attempt.attemptId,
            ),
          ).toEqual(uncertain.attempt);
          if (winnerType === 'completed') {
            expect(rebuilt).toMatchObject({
              run: { status: RunStatus.COMPLETED },
              workflowCursor: {
                disposition: WorkflowCursorDisposition.COMPLETED,
              },
            });
            expect(rebuilt.workflowCursor.outputs).toHaveLength(2);
          } else {
            expect(rebuilt).toMatchObject({
              run: { status: RunStatus.FAILED },
              workflowCursor: {
                disposition: WorkflowCursorDisposition.FAILED,
              },
            });
            expect(rebuilt.workflowCursor.outputs).toEqual(
              workflow.firstSucceeded.workflowCursor.outputs,
            );
          }
          await expect(listReadyWork(directLedger)).resolves.toMatchObject({
            items: [],
          });
          await expect(directLedger.getEvents(runId)).resolves.toHaveLength(8);
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('a corrupt recovery-ready row makes direct failure fail atomically and permits retry after repair', async () => {
      const label = `ready-corruption-${adapter.name}`;
      const harness = await createHarness(adapter, label);
      const tableName = 'workflow-failure-ready-corruption';
      const runId = workflowRunId(label);
      try {
        const ledger = createLedger(
          harness.db,
          tableName,
          harness.payloadStore,
        );
        const scenario = await prepareFailureScenario(
          ledger,
          runId,
          label,
          'direct',
          'failed',
        );
        const before = await ledger.rebuildRun(runId);
        const ready = await listReadyWork(ledger);
        expect(ready.items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.RECOVERY,
            invocationId:
              scenario.workflow.secondStarted.invocation.invocationId,
          }),
        ]);
        await corruptReadyWorkVersion(
          harness.db,
          tableName,
          ready.items[0],
          100,
        );
        await expect(scenario.mutate(ledger)).rejects.toBeInstanceOf(
          ExecutionLedgerConflictError,
        );
        await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
        await expect(ledger.getEvents(runId)).resolves.toHaveLength(6);

        await corruptReadyWorkVersion(harness.db, tableName, ready.items[0], 0);
        const retried = await scenario.mutate(ledger);
        expect(retried).toMatchObject({
          applied: true,
          run: { status: RunStatus.FAILED },
        });
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [],
        });
      } finally {
        await harness.cleanup();
      }
    });

    test.each(TAMPER_CASES)(
      '$path $target tamper fails rebuild and replay closed',
      async ({ target, path }) => {
        const label = `tamper-${path}-${target}-${adapter.name}`;
        const harness = await createHarness(adapter, label);
        const tableName = `workflow-failure-tamper-${path}-${target}`;
        const runId = workflowRunId(label);
        try {
          const ledger = createLedger(
            harness.db,
            tableName,
            harness.payloadStore,
          );
          const scenario = await prepareFailureScenario(
            ledger,
            runId,
            label,
            path,
            'failed',
            'alpha',
          );
          const result = await scenario.mutate(ledger);
          if (target === 'evidence') {
            const events = await ledger.getEvents(runId);
            const evidenceRef =
              path === 'direct'
                ? result.attempt.evidenceRef
                : events.at(-1)?.payload?.reconciliation?.evidenceRef;
            expect(evidenceRef).toBeDefined();
            const evidencePath = harness.payloadStore.getPath(evidenceRef);
            const original = await fsp.readFile(evidencePath, 'utf8');
            const tampered = original.replace('"alpha"', '"omega"');
            expect(tampered).not.toBe(original);
            expect(Buffer.byteLength(tampered)).toBe(
              Buffer.byteLength(original),
            );
            await fsp.writeFile(evidencePath, tampered, 'utf8');
          } else if (target === 'cursor') {
            await harness.db.update({
              tableName,
              keyName: 'run_id',
              keyValue: runId,
              sortKeyName: 'sort_key',
              sortKeyValue: getWorkflowCursorProjectionSortKey(),
              updates: [
                {
                  property: ['data', 'disposition'],
                  propertyValue: WorkflowCursorDisposition.COMPLETED,
                },
              ],
            });
          } else {
            const sequence = result.receipt.sequence;
            await harness.db.update({
              tableName,
              keyName: 'run_id',
              keyValue: runId,
              sortKeyName: 'sort_key',
              sortKeyValue: getEventSortKey(sequence),
              updates: [
                {
                  property: ['payload', 'attempt', 'terminal', 'type'],
                  propertyValue: 'protocol-failed',
                },
              ],
            });
          }

          await expect(ledger.rebuildRun(runId)).rejects.toBeInstanceOf(
            ExecutionLedgerProjectionError,
          );
          await expect(scenario.mutate(ledger)).rejects.toBeInstanceOf(
            ExecutionLedgerProjectionError,
          );
        } finally {
          await harness.cleanup();
        }
      },
    );
  });
}
