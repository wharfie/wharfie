/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  AttemptStatus,
  InvocationStatus,
  RunStatus,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ExecutionLedgerReadyWorkKind } from '../../src/core/lib/ledger/ready-work.js';
import {
  WorkflowCursorDisposition,
  createWorkflowRunId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
} from '../../src/core/runtime/activity-protocol.js';
import {
  WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION,
  WorkflowLedgerRecoveryAction,
  recoverWorkflowLedgerActivity,
  requestWorkflowLedgerRunCancellation,
  runWorkflowLedgerActivity,
} from '../../src/core/runtime/workflow-ledger-run.js';

/**
 * @typedef {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 * @typedef {import('../../src/core/runtime/workflow-definition.js').WorkflowDefinition} WorkflowDefinition
 * @typedef {Parameters<typeof runWorkflowLedgerActivity>[0]} WorkflowRunOptions
 * @typedef {Readonly<Record<string, any>>} ActivityStartFrame
 * @typedef {(...args: any[]) => any} AnyLedgerMethod
 * @typedef {{ledger: ExecutionLedgerStore, runId: string, created: Record<string, any>}} LedgerContext
 */

const APP_ID = 'workflow-ledger-run-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-ledger-run-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'durable-service';
const ACTIVITY_ID = 'perform-work';
const ACTOR = Object.freeze({
  kind: 'resident-workflow',
  id: 'workflow-ledger-run-test',
});
const OWNER_CANCELLATION = Object.freeze({
  actor: Object.freeze({
    kind: 'local-owner-command',
    id: 'workflow-ledger-run-test',
  }),
  reason: Object.freeze({
    code: 'operator-cancel-requested',
    name: 'CancellationRequested',
    message: 'The workflow runner test requested cancellation.',
    details: Object.freeze({ source: 'workflow-ledger-run-test' }),
  }),
});
const DEFINITION = /** @type {WorkflowDefinition} */ (
  Object.freeze({
    steps: [
      {
        id: 'work',
        kind: 'activity',
        activity: ACTIVITY_ID,
        input: { kind: 'workflow-input' },
      },
    ],
  })
);
const TWO_STEP_DEFINITION = /** @type {WorkflowDefinition} */ (
  Object.freeze({
    steps: [
      ...DEFINITION.steps,
      {
        id: 'finish',
        kind: 'activity',
        activity: ACTIVITY_ID,
        input: { kind: 'step-output', step: 'work' },
      },
    ],
  })
);

function createClock() {
  let time = 1_710_000_000_000;
  return () => {
    time += 1;
    return time;
  };
}

/** @param {Record<string, any>} cursor - Current workflow cursor. */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/** @param {ActivityStartFrame} start - Durable start frame. @param {'completed'|'failed'|'protocol-failed'} type - Terminal type. @param {any} [result] - Completed result. */
function terminalEvidence(start, type, result = { accepted: true }) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame(
    type === 'completed'
      ? {
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type,
          attemptId: acceptedStart.attemptId,
          sequence: 1,
          result,
        }
      : {
          protocol: ACTIVITY_PROTOCOL_NAME,
          protocolVersion: ACTIVITY_PROTOCOL_VERSION,
          type,
          attemptId: acceptedStart.attemptId,
          sequence: 1,
          error: {
            code:
              type === 'failed'
                ? 'application-failed'
                : 'activity-protocol-failed',
            name:
              type === 'failed'
                ? 'ApplicationFailure'
                : 'ActivityAttemptProtocolError',
            message: `Expected ${type} workflow activity terminal.`,
            details: { source: 'workflow-ledger-run-test' },
          },
        },
  );
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, terminal],
    transcript: transcript.snapshot(),
  };
}

/** @param {ActivityStartFrame} start - Durable start frame. @param {Record<string, any>} reason - Retained cancellation reason. */
function cancelledEvidence(start, reason) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'cancelled',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: reason,
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/** @param {ActivityStartFrame} start - Durable start frame. @param {Record<string, any>} reason - Retained cancellation reason. */
function ambiguousCancellationEvidence(start, reason) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'protocol-failed',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: {
      code: 'termination-unconfirmed',
      name: 'ActivityAttemptProtocolError',
      message: 'The test adapter could not confirm worker termination.',
      details: {},
    },
  });
  return {
    status: terminal.type,
    start: acceptedStart,
    terminal,
    frames: [acceptedStart, cancel, terminal],
    transcript: transcript.snapshot(),
  };
}

/** @param {AbortSignal} signal - Physical attempt signal. */
async function waitForAbort(signal) {
  if (signal.aborted) return;
  await new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(undefined), { once: true });
  });
}

/** @param {string} label - Isolated scenario name. @param {(context: LedgerContext) => Promise<void>} body - Test body. @param {WorkflowDefinition} [definition] - Workflow definition. */
async function withLedger(label, body, definition = DEFINITION) {
  const directory = mkdtempSync(join(tmpdir(), 'wharfie-workflow-run-'));
  const db = createVanillaDB({ path: join(directory, 'control') });
  const payloadStore = createLocalExecutionPayloadStore({
    path: join(directory, 'payloads'),
    storeId: `workflow-run-${createHash('sha256')
      .update(label)
      .digest('hex')
      .slice(0, 20)}`,
  });
  const ledger = createExecutionLedger({
    db,
    tableName: 'workflow-ledger-run-test',
    payloadStore,
    now: createClock(),
  });
  const runId = createWorkflowRunId({
    appId: APP_ID,
    idempotencyKey: label,
  });
  try {
    const created = await ledger.createWorkflowRun({
      runId,
      appId: APP_ID,
      revisionId: REVISION_ID,
      workflowId: WORKFLOW_ID,
      definition,
      input: { scenario: label },
      callerMetadata: { source: 'workflow-ledger-run-test' },
      transitionId: `${label}-create`,
      actor: ACTOR,
    });
    await body({ ledger, runId, created });
  } finally {
    await db.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** @param {ExecutionLedgerStore} ledger - Real ledger. @param {Record<string, any>} created - Initial transition. @param {string} runId - Run identity. @param {Partial<WorkflowRunOptions>} [overrides] - Per-test options. @returns {WorkflowRunOptions} Bound workflow runner options. */
function runOptions(ledger, created, runId, overrides = {}) {
  return /** @type {WorkflowRunOptions} */ ({
    ledger,
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    planId: created.workflowCursor.planId,
    invocationId: created.invocation.invocationId,
    activityId: created.invocation.activityId,
    generation: created.invocation.generation,
    cursor: cursorGuard(created.workflowCursor),
    actor: ACTOR,
    createFencingToken: () => `${runId}-fence`,
    executeAttempt: async (/** @type {ActivityStartFrame} */ start) =>
      terminalEvidence(start, 'completed'),
    ...overrides,
  });
}

/** @param {ExecutionLedgerStore} ledger - Real ledger. */
async function listReadyWork(ledger) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId: REVISION_ID,
    observedAt: Number.MAX_SAFE_INTEGER,
    limit: 100,
  });
}

/** @param {ExecutionLedgerStore} ledger - Real ledger. @param {keyof ExecutionLedgerStore} method - Injected method. @param {(original: AnyLedgerMethod, ...args: any[]) => any} implementation - Method wrapper. @returns {ExecutionLedgerStore} Ledger with one injected method. */
function injectLedgerMethod(ledger, method, implementation) {
  return /** @type {ExecutionLedgerStore} */ (
    new Proxy(ledger, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property === method) {
          return /** @type {AnyLedgerMethod} */ (
            (...args) => implementation(value.bind(target), ...args)
          );
        }
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })
  );
}

/** @param {ExecutionLedgerStore} ledger - Real ledger. @param {string} runId - Run identity. @param {Record<string, any>} created - Initial transition. @param {string} fencingToken - Attempt fence. @returns {Promise<Record<string, any>>} Claimed transition. */
async function claimWorkflow(ledger, runId, created, fencingToken) {
  return await ledger.claimWorkflowActivity({
    runId,
    invocationId: created.invocation.invocationId,
    cursor: cursorGuard(created.workflowCursor),
    fencingToken,
    expectedGeneration: created.invocation.generation,
    expectedVersion: created.run.version,
    transitionId: `test-claim:${created.invocation.invocationId}:${fencingToken}`,
    actor: ACTOR,
    coordinatorEpoch: 0,
  });
}

/** @returns {WorkflowRunOptions['executeAttempt']} Executor that must remain uncalled. */
function unexpectedDispatch() {
  return jest.fn(async () => {
    throw new Error('This scenario must not physically dispatch an activity.');
  });
}

/** @type {ReadonlyArray<{terminal: 'completed'|'failed'|'protocol-failed', runStatus: string, invocationStatus: string, attemptStatus: string, cursorDisposition: string}>} */
const TERMINAL_CASES = Object.freeze([
  {
    terminal: 'completed',
    runStatus: RunStatus.COMPLETED,
    invocationStatus: InvocationStatus.COMPLETED,
    attemptStatus: AttemptStatus.COMPLETED,
    cursorDisposition: WorkflowCursorDisposition.COMPLETED,
  },
  {
    terminal: 'failed',
    runStatus: RunStatus.FAILED,
    invocationStatus: InvocationStatus.FAILED,
    attemptStatus: AttemptStatus.FAILED,
    cursorDisposition: WorkflowCursorDisposition.FAILED,
  },
  {
    terminal: 'protocol-failed',
    runStatus: RunStatus.FAILED,
    invocationStatus: InvocationStatus.FAILED,
    attemptStatus: AttemptStatus.FAILED,
    cursorDisposition: WorkflowCursorDisposition.PROTOCOL_FAILED,
  },
]);

describe('workflow ledger activity runner', () => {
  test.each(TERMINAL_CASES)(
    'durably starts before dispatch and terminalizes $terminal evidence',
    async ({
      terminal,
      runStatus,
      invocationStatus,
      attemptStatus,
      cursorDisposition,
    }) => {
      await withLedger(
        `terminal-${terminal}`,
        async ({ ledger, runId, created }) => {
          const executeAttempt = jest.fn(
            async (/** @type {ActivityStartFrame} */ start) => {
              const dispatched = await ledger.rebuildRun(runId);
              expect(dispatched).toMatchObject({
                run: { version: 3, status: RunStatus.RUNNING },
                workflowCursor: {
                  version: 3,
                  disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
                },
                invocations: [
                  { status: InvocationStatus.RUNNING, generation: 1 },
                ],
                attempts: [
                  {
                    attemptId: start.attemptId,
                    status: AttemptStatus.STARTED,
                    generation: 1,
                  },
                ],
              });
              expect((await listReadyWork(ledger)).items).toEqual([
                expect.objectContaining({
                  runId,
                  kind: ExecutionLedgerReadyWorkKind.RECOVERY,
                  runVersion: 3,
                  cursorVersion: 3,
                  attemptId: start.attemptId,
                  generation: 1,
                }),
              ]);
              return terminalEvidence(start, terminal);
            },
          );

          const outcome = await runWorkflowLedgerActivity(
            runOptions(ledger, created, runId, { executeAttempt }),
          );

          expect(executeAttempt).toHaveBeenCalledTimes(1);
          expect(outcome).toMatchObject({
            disposition: terminal === 'completed' ? 'completed' : 'failed',
            reused: false,
            dispatched: true,
            run: { status: runStatus, version: 4 },
            workflowCursor: { disposition: cursorDisposition, version: 4 },
            invocation: {
              status: invocationStatus,
              terminal: { type: terminal },
            },
            attempt: {
              status: attemptStatus,
              terminal: { type: terminal },
            },
          });
          expect((await listReadyWork(ledger)).items).toEqual([]);
        },
      );
    },
  );

  test('runs a two-activity continuation from the exact persisted successor input', async () => {
    await withLedger(
      'two-activity-continuation',
      async ({ ledger, runId, created }) => {
        const firstResult = { accepted: true, sequence: 1 };
        const first = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            createFencingToken: () => `${runId}-first-fence`,
            executeAttempt: async (/** @type {ActivityStartFrame} */ start) =>
              terminalEvidence(start, 'completed', firstResult),
          }),
        );

        expect(first).toMatchObject({
          disposition: 'runnable',
          dispatched: true,
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: 'finish',
            stepIndex: 1,
          },
          invocation: {
            activityId: ACTIVITY_ID,
            status: InvocationStatus.RUNNABLE,
            generation: 0,
          },
        });

        const secondExecute = jest.fn(
          async (/** @type {ActivityStartFrame} */ start) => {
            expect(start.input).toEqual(firstResult);
            return terminalEvidence(start, 'completed');
          },
        );
        const second = await runWorkflowLedgerActivity(
          runOptions(ledger, first, runId, {
            createFencingToken: () => `${runId}-second-fence`,
            executeAttempt: secondExecute,
          }),
        );

        expect(secondExecute).toHaveBeenCalledTimes(1);
        expect(second).toMatchObject({
          disposition: 'completed',
          dispatched: true,
          run: { status: RunStatus.COMPLETED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            stepId: 'finish',
            stepIndex: 1,
          },
        });
        expect((await listReadyWork(ledger)).items).toEqual([]);
      },
      TWO_STEP_DEFINITION,
    );
  });

  test('retains an ambiguous claimed attempt for recovery without dispatch', async () => {
    await withLedger(
      'claim-response-loss',
      async ({ ledger, runId, created }) => {
        let claimCalls = 0;
        const responseLostLedger = injectLedgerMethod(
          ledger,
          'claimWorkflowActivity',
          async (claim, request) => {
            claimCalls += 1;
            await claim(request);
            throw new Error('claim response was lost');
          },
        );
        const executeAttempt = unexpectedDispatch();

        const outcome = await runWorkflowLedgerActivity(
          runOptions(responseLostLedger, created, runId, { executeAttempt }),
        );

        expect(claimCalls).toBe(1);
        expect(executeAttempt).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({
          disposition: 'in-progress',
          reused: true,
          dispatched: false,
          run: { status: RunStatus.RUNNING, version: 2 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
            version: 2,
          },
          invocation: { status: InvocationStatus.RUNNING, generation: 1 },
          attempt: { status: AttemptStatus.CLAIMED, generation: 1 },
        });
        expect((await listReadyWork(ledger)).items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.RECOVERY,
            runVersion: 2,
            cursorVersion: 2,
            attemptId: outcome.attempt.attemptId,
            generation: 1,
          }),
        ]);
      },
    );
  });

  test('rebases an initial claim after a rejected signal advances only the run head', async () => {
    await withLedger(
      'claim-rejected-signal-head-churn',
      async ({ ledger, runId, created }) => {
        /** @type {Record<string, any>[]} */
        const claimRequests = [];
        let rejectionAppended = false;
        const churnLedger = injectLedgerMethod(
          ledger,
          'claimWorkflowActivity',
          async (claim, request) => {
            claimRequests.push(structuredClone(request));
            if (!rejectionAppended) {
              rejectionAppended = true;
              await expect(
                ledger.deliverWorkflowSignal({
                  appId: APP_ID,
                  runId,
                  signalId: 'approval',
                  deliveryId: 'claim-head-churn-delivery',
                  payload: { ignored: true },
                  actor: ACTOR,
                }),
              ).resolves.toMatchObject({
                applied: true,
                outcome: 'rejected',
                rejectionReason: 'unexpected-signal',
                run: { version: 2 },
                workflowCursor: { version: 1 },
              });
            }
            return await claim(request);
          },
        );
        const executeAttempt = jest.fn(
          async (/** @type {ActivityStartFrame} */ start) =>
            terminalEvidence(start, 'completed'),
        );

        const outcome = await runWorkflowLedgerActivity(
          runOptions(churnLedger, created, runId, { executeAttempt }),
        );

        expect(claimRequests).toHaveLength(2);
        expect(claimRequests.map((request) => request.expectedVersion)).toEqual(
          [1, 2],
        );
        expect(claimRequests.map((request) => request.cursor)).toEqual([
          cursorGuard(created.workflowCursor),
          cursorGuard(created.workflowCursor),
        ]);
        expect(claimRequests[1]).toMatchObject({
          invocationId: created.invocation.invocationId,
          expectedGeneration: created.invocation.generation,
          fencingToken: `${runId}-fence`,
          transitionId: `workflow-claim:${created.invocation.invocationId}:1`,
        });
        expect(executeAttempt).toHaveBeenCalledTimes(1);
        expect(outcome).toMatchObject({
          disposition: 'completed',
          reused: false,
          dispatched: true,
          run: { status: RunStatus.COMPLETED, version: 5 },
          workflowCursor: { disposition: WorkflowCursorDisposition.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
        expect(
          (await ledger.getEvents(runId)).map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'workflow-run-created',
          'workflow-signal-rejected',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-succeeded',
        ]);
      },
    );
  });

  test('returns a nonfatal reload outcome after two rejection-only claim races', async () => {
    await withLedger(
      'claim-two-rejected-signal-races',
      async ({ ledger, runId, created }) => {
        /** @type {Record<string, any>[]} */
        const claimRequests = [];
        const churnLedger = injectLedgerMethod(
          ledger,
          'claimWorkflowActivity',
          async (claim, request) => {
            claimRequests.push(structuredClone(request));
            const sequence = claimRequests.length;
            await expect(
              ledger.deliverWorkflowSignal({
                appId: APP_ID,
                runId,
                signalId: 'approval',
                deliveryId: `claim-head-churn-delivery-${sequence}`,
                payload: { ignored: sequence },
                actor: ACTOR,
              }),
            ).resolves.toMatchObject({
              applied: true,
              outcome: 'rejected',
              rejectionReason: 'unexpected-signal',
              run: { version: sequence + 1 },
              workflowCursor: { version: 1 },
            });
            return await claim(request);
          },
        );
        const executeAttempt = unexpectedDispatch();

        const outcome = await runWorkflowLedgerActivity(
          runOptions(churnLedger, created, runId, { executeAttempt }),
        );

        expect(claimRequests).toHaveLength(2);
        expect(claimRequests.map((request) => request.expectedVersion)).toEqual(
          [1, 2],
        );
        expect(claimRequests.map((request) => request.cursor)).toEqual([
          cursorGuard(created.workflowCursor),
          cursorGuard(created.workflowCursor),
        ]);
        expect(executeAttempt).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({
          disposition: 'runnable',
          reused: true,
          dispatched: false,
          run: { status: RunStatus.RUNNING, version: 3 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            version: 1,
          },
          invocation: {
            status: InvocationStatus.RUNNABLE,
            generation: 0,
          },
        });
        expect((await listReadyWork(ledger)).items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            runVersion: 3,
            cursorVersion: 1,
            generation: 0,
          }),
        ]);
      },
    );
  });

  test('keeps repeated same-head claim storage failures fatal', async () => {
    await withLedger(
      'claim-same-head-storage-failure',
      async ({ ledger, runId, created }) => {
        const failure = new Error('claim storage unavailable');
        let claimCalls = 0;
        const failingLedger = injectLedgerMethod(
          ledger,
          'claimWorkflowActivity',
          async () => {
            claimCalls += 1;
            throw failure;
          },
        );
        const executeAttempt = unexpectedDispatch();

        await expect(
          runWorkflowLedgerActivity(
            runOptions(failingLedger, created, runId, { executeAttempt }),
          ),
        ).rejects.toMatchObject({
          message: `Could not claim workflow activity ${runId}#${created.invocation.invocationId}.`,
          errors: [failure, failure],
        });

        expect(claimCalls).toBe(2);
        expect(executeAttempt).not.toHaveBeenCalled();
      },
    );
  });

  test('rebases durable start after a rejected signal advances only the run head', async () => {
    await withLedger(
      'start-rejected-signal-head-churn',
      async ({ ledger, runId, created }) => {
        /** @type {Record<string, any>[]} */
        const startRequests = [];
        let rejectionAppended = false;
        const churnLedger = injectLedgerMethod(
          ledger,
          'markWorkflowActivityStarted',
          async (start, request) => {
            startRequests.push(structuredClone(request));
            if (!rejectionAppended) {
              rejectionAppended = true;
              await expect(
                ledger.deliverWorkflowSignal({
                  appId: APP_ID,
                  runId,
                  signalId: 'approval',
                  deliveryId: 'start-head-churn-delivery',
                  payload: { ignored: true },
                  actor: ACTOR,
                }),
              ).resolves.toMatchObject({
                applied: true,
                outcome: 'rejected',
                rejectionReason: 'unexpected-signal',
                run: { version: 3 },
                workflowCursor: { version: 2 },
              });
            }
            return await start(request);
          },
        );
        const executeAttempt = jest.fn(
          async (/** @type {ActivityStartFrame} */ start) =>
            terminalEvidence(start, 'completed'),
        );

        const outcome = await runWorkflowLedgerActivity(
          runOptions(churnLedger, created, runId, { executeAttempt }),
        );

        expect(startRequests).toHaveLength(2);
        expect(startRequests.map((request) => request.expectedVersion)).toEqual(
          [2, 3],
        );
        expect(startRequests[1]).toMatchObject({
          invocationId: created.invocation.invocationId,
          cursor: startRequests[0].cursor,
          attemptId: startRequests[0].attemptId,
          fencingToken: `${runId}-fence`,
          generation: 1,
          transitionId: startRequests[0].transitionId,
        });
        expect(executeAttempt).toHaveBeenCalledTimes(1);
        expect(outcome).toMatchObject({
          disposition: 'completed',
          reused: false,
          dispatched: true,
          run: { status: RunStatus.COMPLETED, version: 5 },
          workflowCursor: { disposition: WorkflowCursorDisposition.COMPLETED },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
        expect(
          (await ledger.getEvents(runId)).map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-signal-rejected',
          'workflow-activity-started',
          'workflow-activity-succeeded',
        ]);
      },
    );
  });

  test.each(['response-loss', 'replay'])(
    'never dispatches after a durable start %s and marks the outcome uncertain',
    async (scenario) => {
      await withLedger(
        `start-${scenario}`,
        async ({ ledger, runId, created }) => {
          let startCalls = 0;
          const injectedLedger = injectLedgerMethod(
            ledger,
            'markWorkflowActivityStarted',
            async (start, request) => {
              startCalls += 1;
              const first = await start(request);
              if (scenario === 'response-loss') {
                throw new Error('start response was lost');
              }
              return await start(request).then(
                (/** @type {Record<string, any>} */ replay) => ({
                  ...replay,
                  startFrame: first.startFrame,
                }),
              );
            },
          );
          const executeAttempt = unexpectedDispatch();

          const outcome = await runWorkflowLedgerActivity(
            runOptions(injectedLedger, created, runId, { executeAttempt }),
          );

          expect(startCalls).toBe(1);
          expect(executeAttempt).not.toHaveBeenCalled();
          expect(outcome).toMatchObject({
            disposition: 'blocked',
            dispatched: false,
            run: { status: RunStatus.BLOCKED, version: 4 },
            workflowCursor: {
              disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
              version: 4,
            },
            invocation: { status: InvocationStatus.UNCERTAIN, generation: 1 },
            attempt: { status: AttemptStatus.ABANDONED, generation: 1 },
          });
          expect((await listReadyWork(ledger)).items).toEqual([]);
        },
      );
    },
  );

  test('accepts authoritative terminal state after losing its commit response', async () => {
    await withLedger(
      'terminal-response-loss',
      async ({ ledger, runId, created }) => {
        let terminalCalls = 0;
        const responseLostLedger = injectLedgerMethod(
          ledger,
          'commitVerifiedWorkflowActivityTerminal',
          async (commit, request) => {
            terminalCalls += 1;
            await commit(request);
            throw new Error('terminal response was lost');
          },
        );
        const executeAttempt = jest.fn(
          async (/** @type {ActivityStartFrame} */ start) =>
            terminalEvidence(start, 'completed'),
        );

        const outcome = await runWorkflowLedgerActivity(
          runOptions(responseLostLedger, created, runId, { executeAttempt }),
        );

        expect(executeAttempt).toHaveBeenCalledTimes(1);
        expect(terminalCalls).toBe(1);
        expect(outcome).toMatchObject({
          disposition: 'completed',
          reused: true,
          dispatched: true,
          run: { status: RunStatus.COMPLETED, version: 4 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            version: 4,
          },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
        expect(
          (await ledger.getEvents(runId)).map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-activity-succeeded',
        ]);
        expect((await listReadyWork(ledger)).items).toEqual([]);
      },
    );
  });

  test('turns an executor throw into durable uncertainty and never redispatches it', async () => {
    await withLedger('executor-throw', async ({ ledger, runId, created }) => {
      const executeAttempt = jest.fn(async () => {
        throw new Error('physical outcome is unknown');
      });
      const options = runOptions(ledger, created, runId, { executeAttempt });

      const first = await runWorkflowLedgerActivity(options);
      const second = await runWorkflowLedgerActivity(options);

      expect(executeAttempt).toHaveBeenCalledTimes(1);
      expect(first).toMatchObject({
        disposition: 'blocked',
        reused: false,
        dispatched: true,
        run: { status: RunStatus.BLOCKED, version: 4 },
        workflowCursor: {
          disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
        },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
      expect(second).toMatchObject({
        disposition: 'blocked',
        reused: true,
        dispatched: false,
        run: { status: RunStatus.BLOCKED, version: 4 },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
      expect((await listReadyWork(ledger)).items).toEqual([]);
    });
  });

  test('releases a claim when admission closes before durable start', async () => {
    await withLedger(
      'admission-after-claim',
      async ({ ledger, runId, created }) => {
        const controller = new AbortController();
        const admissionLedger = injectLedgerMethod(
          ledger,
          'claimWorkflowActivity',
          async (claim, request) => {
            const claimed = await claim(request);
            controller.abort(new Error('resident is stopping'));
            return claimed;
          },
        );
        const executeAttempt = unexpectedDispatch();

        const outcome = await runWorkflowLedgerActivity(
          runOptions(admissionLedger, created, runId, {
            admissionSignal: controller.signal,
            executeAttempt,
          }),
        );

        expect(executeAttempt).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({
          disposition: 'runnable',
          reused: false,
          dispatched: false,
          run: { status: RunStatus.RUNNING, version: 3 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            version: 3,
          },
          invocation: { status: InvocationStatus.RUNNABLE, generation: 1 },
          attempt: { status: AttemptStatus.ABANDONED, generation: 1 },
        });
        expect((await listReadyWork(ledger)).items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            runVersion: 3,
            cursorVersion: 3,
            generation: 1,
          }),
        ]);
      },
    );
  });

  test('recovery releases a CLAIMED attempt for a successor generation', async () => {
    await withLedger('recover-claimed', async ({ ledger, runId, created }) => {
      const claimed = await claimWorkflow(
        ledger,
        runId,
        created,
        'recover-claimed-fence',
      );

      const recovery = await recoverWorkflowLedgerActivity({
        ledger,
        runId,
        invocationId: created.invocation.invocationId,
        actor: ACTOR,
      });

      expect(recovery).toMatchObject({
        found: true,
        mayExecute: true,
        action: WorkflowLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM,
        changed: true,
        outcome: {
          disposition: 'runnable',
          run: { status: RunStatus.RUNNING, version: 3 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            version: 3,
          },
          invocation: { status: InvocationStatus.RUNNABLE, generation: 1 },
          attempt: {
            attemptId: claimed.attempt.attemptId,
            status: AttemptStatus.ABANDONED,
            generation: 1,
          },
        },
      });
      expect((await listReadyWork(ledger)).items).toEqual([
        expect.objectContaining({
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
          generation: 1,
        }),
      ]);
    });
  });

  test('recovery makes a STARTED attempt uncertain without redispatch', async () => {
    await withLedger('recover-started', async ({ ledger, runId, created }) => {
      const claimed = await claimWorkflow(
        ledger,
        runId,
        created,
        'recover-started-fence',
      );
      await ledger.markWorkflowActivityStarted({
        runId,
        invocationId: created.invocation.invocationId,
        cursor: cursorGuard(claimed.workflowCursor),
        attemptId: claimed.attempt.attemptId,
        fencingToken: claimed.attempt.fencingToken,
        generation: claimed.attempt.generation,
        expectedVersion: claimed.run.version,
        transitionId: `test-start:${claimed.attempt.attemptId}`,
        actor: ACTOR,
        coordinatorEpoch: claimed.attempt.coordinatorEpoch,
      });

      const recovery = await recoverWorkflowLedgerActivity({
        ledger,
        runId,
        invocationId: created.invocation.invocationId,
        actor: ACTOR,
      });

      expect(recovery).toMatchObject({
        found: true,
        mayExecute: false,
        action: WorkflowLedgerRecoveryAction.MARKED_STARTED_UNCERTAIN,
        changed: true,
        outcome: {
          disposition: 'blocked',
          run: { status: RunStatus.BLOCKED, version: 4 },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
            version: 4,
          },
          invocation: { status: InvocationStatus.UNCERTAIN, generation: 1 },
          attempt: {
            attemptId: claimed.attempt.attemptId,
            status: AttemptStatus.ABANDONED,
            generation: 1,
          },
        },
      });
      expect((await listReadyWork(ledger)).items).toEqual([]);
      expect(
        (await ledger.getEvents(runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'workflow-run-created',
        'workflow-activity-claimed',
        'workflow-activity-started',
        'workflow-activity-became-uncertain',
      ]);
    });
  });

  test('cancels runnable work without requiring a live physical owner', async () => {
    await withLedger('cancel-runnable', async ({ ledger, runId, created }) => {
      const cancellation = await requestWorkflowLedgerRunCancellation({
        ledger,
        runId,
        requestId: 'cancel-runnable-request',
        actor: OWNER_CANCELLATION.actor,
        reason: OWNER_CANCELLATION.reason,
      });

      expect(cancellation).toMatchObject({
        applied: true,
        outcome: 'cancellation-requested',
        cancellationDeliveryRequired: false,
        signalDelivered: false,
        run: {
          status: RunStatus.CANCELLED,
          cancellationRequest: {
            requestId: 'cancel-runnable-request',
            actor: OWNER_CANCELLATION.actor,
            reason: OWNER_CANCELLATION.reason,
          },
        },
        workflowCursor: {
          disposition: WorkflowCursorDisposition.CANCELLED,
          outputs: [],
        },
        invocation: { status: InvocationStatus.CANCELLED },
      });
      expect(cancellation).not.toHaveProperty('attempt');
      expect(created.invocation.generation).toBe(0);
      expect((await listReadyWork(ledger)).items).toEqual([]);
      expect(
        (await ledger.getEvents(runId)).map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual(['workflow-run-created', 'workflow-cancellation-requested']);
    });
  });

  test('refuses to persist fresh STARTED cancellation without its exact live port', async () => {
    await withLedger(
      'cancel-started-without-port',
      async ({ ledger, runId, created }) => {
        const claimed = await claimWorkflow(
          ledger,
          runId,
          created,
          'cancel-started-without-port-fence',
        );
        await ledger.markWorkflowActivityStarted({
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(claimed.workflowCursor),
          attemptId: claimed.attempt.attemptId,
          fencingToken: claimed.attempt.fencingToken,
          generation: claimed.attempt.generation,
          expectedVersion: claimed.run.version,
          transitionId: `test-start:${claimed.attempt.attemptId}`,
          actor: ACTOR,
          coordinatorEpoch: claimed.attempt.coordinatorEpoch,
        });

        const cancellation = await requestWorkflowLedgerRunCancellation({
          ledger,
          runId,
          requestId: 'cancel-started-without-port-request',
        });

        expect(cancellation).toMatchObject({
          applied: false,
          outcome: 'owner-not-ready',
          cancellationDeliveryRequired: false,
          signalDelivered: false,
          run: { status: RunStatus.RUNNING },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNING,
          },
          invocation: { status: InvocationStatus.RUNNING },
          attempt: { status: AttemptStatus.STARTED },
        });
        expect(cancellation.run).not.toHaveProperty('cancellationRequest');
        expect(
          (await ledger.getEvents(runId)).map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
        ]);
      },
    );
  });

  test('persists through the exact live port before delivering cancelled evidence', async () => {
    await withLedger(
      'cancel-started-through-port',
      async ({ ledger, runId, created }) => {
        /** @type {import('../../src/core/runtime/workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
        let port;
        const executeAttempt = jest.fn(
          async (
            /** @type {ActivityStartFrame} */ start,
            /** @type {{signal: AbortSignal}} */ { signal },
          ) => {
            expect(port).toMatchObject({
              version: WORKFLOW_LEDGER_ACTIVE_CANCELLATION_PORT_VERSION,
              runId,
              invocationId: created.invocation.invocationId,
              attemptId: start.attemptId,
            });
            const cancellation = await requestWorkflowLedgerRunCancellation({
              ledger,
              runId,
              requestId: 'cancel-started-through-port-request',
              activeCancellationPort: port,
            });
            expect(cancellation).toMatchObject({
              applied: true,
              outcome: 'cancellation-requested',
              cancellationDeliveryRequired: true,
              signalDelivered: true,
              run: {
                status: RunStatus.RUNNING,
                cancellationRequest: {
                  requestId: 'cancel-started-through-port-request',
                  actor: OWNER_CANCELLATION.actor,
                  reason: OWNER_CANCELLATION.reason,
                },
              },
              attempt: { status: AttemptStatus.STARTED },
            });
            expect(signal.aborted).toBe(true);
            const durableBeforeEvidence = await ledger.rebuildRun(runId);
            expect(
              durableBeforeEvidence?.run.cancellationRequest?.reason,
            ).toEqual(signal.reason);
            return cancelledEvidence(start, signal.reason);
          },
        );

        const outcome = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            ownerCancellation: OWNER_CANCELLATION,
            registerActiveWorkflowCancellationPort: (candidate) => {
              port = candidate;
              return () => {
                if (port === candidate) port = undefined;
              };
            },
            executeAttempt,
          }),
        );

        expect(executeAttempt).toHaveBeenCalledTimes(1);
        expect(port).toBeUndefined();
        expect(outcome).toMatchObject({
          disposition: 'cancelled',
          dispatched: true,
          run: { status: RunStatus.CANCELLED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.CANCELLED,
          },
          invocation: {
            status: InvocationStatus.CANCELLED,
            terminal: { type: 'cancelled' },
          },
          attempt: {
            status: AttemptStatus.CANCELLED,
            terminal: { type: 'cancelled' },
          },
        });
        expect(
          (await ledger.getEvents(runId)).map(
            (/** @type {Record<string, any>} */ event) => event.type,
          ),
        ).toEqual([
          'workflow-run-created',
          'workflow-activity-claimed',
          'workflow-activity-started',
          'workflow-cancellation-requested',
          'workflow-activity-cancelled',
        ]);
      },
    );
  });

  test('rebases a non-final completed terminal after cancellation without creating a successor', async () => {
    await withLedger(
      'cancel-nonfinal-completion',
      async ({ ledger, runId, created }) => {
        /** @type {import('../../src/core/runtime/workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
        let port;
        const outcome = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            ownerCancellation: OWNER_CANCELLATION,
            registerActiveWorkflowCancellationPort: (candidate) => {
              port = candidate;
            },
            executeAttempt: async (
              /** @type {ActivityStartFrame} */ start,
              /** @type {{signal: AbortSignal}} */ { signal },
            ) => {
              const cancellation = await requestWorkflowLedgerRunCancellation({
                ledger,
                runId,
                requestId: 'cancel-nonfinal-completion-request',
                activeCancellationPort: port,
              });
              expect(cancellation.signalDelivered).toBe(true);
              expect(signal.aborted).toBe(true);
              return terminalEvidence(start, 'completed', {
                completedAfterCancellation: true,
              });
            },
          }),
        );

        expect(outcome).toMatchObject({
          disposition: 'cancelled',
          run: { status: RunStatus.CANCELLED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.CANCELLED,
            stepId: 'work',
            stepIndex: 0,
            outputs: [],
          },
          invocation: {
            status: InvocationStatus.COMPLETED,
            terminal: { type: 'completed' },
          },
          attempt: {
            status: AttemptStatus.COMPLETED,
            terminal: { type: 'completed' },
          },
        });
        expect((await listReadyWork(ledger)).items).toEqual([]);
        const view = await ledger.rebuildRun(runId);
        expect(view?.invocations).toHaveLength(1);
      },
      TWO_STEP_DEFINITION,
    );
  });

  test('allows final completion to remain authoritative after retained cancellation', async () => {
    await withLedger(
      'cancel-final-completion',
      async ({ ledger, runId, created }) => {
        /** @type {import('../../src/core/runtime/workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
        let port;
        const outcome = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            ownerCancellation: OWNER_CANCELLATION,
            registerActiveWorkflowCancellationPort: (candidate) => {
              port = candidate;
            },
            executeAttempt: async (/** @type {ActivityStartFrame} */ start) => {
              await requestWorkflowLedgerRunCancellation({
                ledger,
                runId,
                requestId: 'cancel-final-completion-request',
                activeCancellationPort: port,
              });
              return terminalEvidence(start, 'completed', {
                finalCompletionWon: true,
              });
            },
          }),
        );

        expect(outcome).toMatchObject({
          disposition: 'completed',
          run: { status: RunStatus.COMPLETED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.COMPLETED,
            outputs: [expect.objectContaining({ stepId: 'work' })],
          },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.COMPLETED },
        });
      },
    );
  });

  test('a terminal success that wins first is preserved while cancellation consumes its successor', async () => {
    await withLedger(
      'success-before-run-cancellation',
      async ({ ledger, runId, created }) => {
        /** @type {import('../../src/core/runtime/workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
        let port;
        let cancellation;
        const racingLedger = injectLedgerMethod(
          ledger,
          'commitVerifiedWorkflowActivityTerminal',
          async (commit, request) => {
            const terminal = await commit(request);
            cancellation = await requestWorkflowLedgerRunCancellation({
              ledger,
              runId,
              requestId: 'success-before-run-cancellation-request',
              activeCancellationPort: port,
              actor: OWNER_CANCELLATION.actor,
              reason: OWNER_CANCELLATION.reason,
            });
            return terminal;
          },
        );

        const outcome = await runWorkflowLedgerActivity(
          runOptions(racingLedger, created, runId, {
            registerActiveWorkflowCancellationPort: (candidate) => {
              port = candidate;
            },
            executeAttempt: async (/** @type {ActivityStartFrame} */ start) =>
              terminalEvidence(start, 'completed', { preserved: true }),
          }),
        );

        expect(cancellation).toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
          cancellationDeliveryRequired: false,
          signalDelivered: false,
          run: { status: RunStatus.CANCELLED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.CANCELLED,
            stepId: 'finish',
            stepIndex: 1,
            outputs: [expect.objectContaining({ stepId: 'work' })],
          },
        });
        expect(outcome).toMatchObject({
          disposition: 'cancelled',
          run: { status: RunStatus.CANCELLED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.CANCELLED,
            stepId: 'finish',
            outputs: [expect.objectContaining({ stepId: 'work' })],
          },
          invocation: {
            status: InvocationStatus.CANCELLED,
          },
        });
        const view = await ledger.rebuildRun(runId);
        expect(view?.invocations).toHaveLength(2);
        expect(view?.invocations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: InvocationStatus.COMPLETED,
              terminal: { type: 'completed', attemptId: expect.any(String) },
            }),
            expect.objectContaining({ status: InvocationStatus.CANCELLED }),
          ]),
        );
      },
      TWO_STEP_DEFINITION,
    );
  });

  test('a lost cancellation response never sends the physical signal on replay', async () => {
    await withLedger(
      'cancel-response-loss-no-resignal',
      async ({ ledger, runId, created }) => {
        let cancellationCalls = 0;
        const responseLostLedger = injectLedgerMethod(
          ledger,
          'requestWorkflowRunCancellation',
          async (requestCancellation, request) => {
            cancellationCalls += 1;
            const result = await requestCancellation(request);
            if (cancellationCalls === 1) {
              throw new Error('workflow cancellation response was lost');
            }
            return result;
          },
        );
        /** @type {import('../../src/core/runtime/workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
        let port;
        let aborts = 0;
        const outcome = await runWorkflowLedgerActivity(
          runOptions(responseLostLedger, created, runId, {
            ownerCancellation: OWNER_CANCELLATION,
            registerActiveWorkflowCancellationPort: (candidate) => {
              port = candidate;
            },
            executeAttempt: async (
              /** @type {ActivityStartFrame} */ start,
              /** @type {{signal: AbortSignal}} */ { signal },
            ) => {
              signal.addEventListener('abort', () => {
                aborts += 1;
              });
              const first = await requestWorkflowLedgerRunCancellation({
                ledger: responseLostLedger,
                runId,
                requestId: 'cancel-response-loss-request',
                activeCancellationPort: port,
              });
              const replay = await requestWorkflowLedgerRunCancellation({
                ledger: responseLostLedger,
                runId,
                requestId: 'cancel-response-loss-request',
                activeCancellationPort: port,
              });
              expect(first.signalDelivered).toBe(false);
              expect(replay.signalDelivered).toBe(false);
              expect(signal.aborted).toBe(false);
              return terminalEvidence(start, 'completed');
            },
          }),
        );

        expect(cancellationCalls).toBe(1);
        expect(aborts).toBe(0);
        expect(outcome).toMatchObject({
          disposition: 'completed',
          run: { status: RunStatus.COMPLETED },
        });
      },
    );
  });

  test('treats protocol failure after an authorized cancel frame as uncertainty', async () => {
    await withLedger(
      'cancel-protocol-failed-uncertain',
      async ({ ledger, runId, created }) => {
        /** @type {import('../../src/core/runtime/workflow-ledger-run.js').WorkflowLedgerActiveCancellationPort | undefined} */
        let port;
        const outcome = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            ownerCancellation: OWNER_CANCELLATION,
            registerActiveWorkflowCancellationPort: (candidate) => {
              port = candidate;
            },
            executeAttempt: async (
              /** @type {ActivityStartFrame} */ start,
              /** @type {{signal: AbortSignal}} */ { signal },
            ) => {
              await requestWorkflowLedgerRunCancellation({
                ledger,
                runId,
                requestId: 'cancel-protocol-failed-request',
                activeCancellationPort: port,
              });
              await waitForAbort(signal);
              return ambiguousCancellationEvidence(start, signal.reason);
            },
          }),
        );

        expect(outcome).toMatchObject({
          disposition: 'blocked',
          run: {
            status: RunStatus.BLOCKED,
            cancellationRequest: {
              requestId: 'cancel-protocol-failed-request',
            },
          },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
          },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
      },
    );
  });

  test('records cancellation intent after uncertainty without signaling or rewriting the attempt', async () => {
    await withLedger(
      'cancel-after-uncertainty',
      async ({ ledger, runId, created }) => {
        const uncertain = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            executeAttempt: async () => {
              throw new Error('physical outcome is unavailable');
            },
          }),
        );
        const retainedAttempt = structuredClone(uncertain.attempt);

        const cancellation = await requestWorkflowLedgerRunCancellation({
          ledger,
          runId,
          requestId: 'cancel-after-uncertainty-request',
          actor: OWNER_CANCELLATION.actor,
          reason: OWNER_CANCELLATION.reason,
        });

        expect(cancellation).toMatchObject({
          applied: true,
          outcome: 'cancellation-requested',
          cancellationDeliveryRequired: false,
          signalDelivered: false,
          run: { status: RunStatus.BLOCKED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
          },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        expect(cancellation.attempt).toEqual(retainedAttempt);
        expect((await listReadyWork(ledger)).items).toEqual([]);
      },
    );
  });

  test('keeps deadline-exceeded unsupported and conservatively blocks the workflow', async () => {
    await withLedger(
      'deadline-exceeded-unsupported',
      async ({ ledger, runId, created }) => {
        const outcome = await runWorkflowLedgerActivity(
          runOptions(ledger, created, runId, {
            executeAttempt: async () =>
              /** @type {any} */ ({ status: 'deadline-exceeded' }),
          }),
        );

        expect(outcome).toMatchObject({
          disposition: 'blocked',
          run: { status: RunStatus.BLOCKED },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
          },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
      },
    );
  });
});
