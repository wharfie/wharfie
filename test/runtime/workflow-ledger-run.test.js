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
  WorkflowLedgerRecoveryAction,
  recoverWorkflowLedgerActivity,
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
});
