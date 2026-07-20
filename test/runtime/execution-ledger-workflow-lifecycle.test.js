/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterAll, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getAdapterMatrix } from '../helpers/db-adapters.js';
import {
  AttemptStatus,
  ExecutionLedgerConflictError,
  ExecutionLedgerTransitionConflictError,
  InvocationStatus,
  RunStatus,
  createExecutionLedger as createProductionExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ExecutionLedgerReadyWorkKind } from '../../src/core/lib/ledger/ready-work.js';
import { MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID } from '../../src/core/lib/ledger/managed-effect-successor-contract.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';
import {
  ACTIVITY_PROTOCOL_NAME,
  ACTIVITY_PROTOCOL_VERSION,
  ActivityProtocolTranscriptValidator,
} from '../../src/core/runtime/activity-protocol.js';

const APP_ID = 'workflow-lifecycle-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-lifecycle-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'pipeline';
const CREATED_AT = 1_700_100_000_000;
const ACTOR = Object.freeze({ kind: 'worker', id: 'workflow-lifecycle-test' });
const PAYLOAD_ROOT = mkdtempSync(
  join(tmpdir(), 'wharfie-workflow-lifecycle-payload-'),
);
const PAYLOAD_STORE = createLocalExecutionPayloadStore({
  path: PAYLOAD_ROOT,
  storeId: 'workflow-lifecycle-test',
});

afterAll(() => {
  rmSync(PAYLOAD_ROOT, { recursive: true, force: true });
});

/**
 * @param {Omit<Parameters<typeof createProductionExecutionLedger>[0], 'payloadStore'>} options - Ledger dependencies.
 * @returns {ReturnType<typeof createProductionExecutionLedger>} Ledger instance.
 */
function createExecutionLedger(options) {
  return createProductionExecutionLedger({
    ...options,
    payloadStore: PAYLOAD_STORE,
  });
}

/**
 * @param {string} idempotencyKey - Caller-owned start identity.
 * @returns {string} Stable workflow run ID.
 */
function workflowRunId(idempotencyKey) {
  return createWorkflowRunId({ appId: APP_ID, idempotencyKey });
}

/**
 * @param {string} runId - Stable workflow run ID.
 * @param {Record<string, any>[]} steps - Static workflow steps.
 * @returns {Record<string, any>} Workflow creation request.
 */
function workflowRun(runId, steps) {
  return {
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: { steps },
    input: { value: 'workflow-input' },
    callerMetadata: { source: 'workflow-lifecycle-test' },
    transitionId: `create-${runId}`,
    actor: ACTOR,
    observedAt: CREATED_AT,
  };
}

/**
 * @param {Record<string, any>} cursor - Workflow cursor projection.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} Exact mutation guard.
 */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/**
 * @param {Readonly<Record<string, any>>} startFrame - Ledger-authorized Activity Protocol start.
 * @param {any} result - Component result.
 * @returns {Record<string, any>} Complete verified transcript evidence.
 */
function completedEvidence(startFrame, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'completed',
    attemptId: start.attemptId,
    sequence: 1,
    result,
  });
  return {
    status: terminal.type,
    start,
    terminal,
    frames: [start, terminal],
    transcript: transcript.snapshot(),
  };
}

/**
 * @param {ReturnType<typeof createProductionExecutionLedger>} ledger - Ledger instance.
 * @returns {Promise<Record<string, any>>} Complete exact-revision ready page.
 */
async function listReadyWork(ledger) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId: REVISION_ID,
    observedAt: Number.MAX_SAFE_INTEGER,
    limit: 100,
  });
}

const FIRST_STEP = Object.freeze({
  id: 'produce',
  kind: 'activity',
  activity: 'produce',
  input: { kind: 'workflow-input' },
});
const SECOND_STEP = Object.freeze({
  id: 'consume',
  kind: 'activity',
  activity: 'consume',
  input: { kind: 'step-output', step: 'produce' },
});

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} execution-ledger workflow lifecycle`, () => {
    test.each([
      {
        label: 'timer',
        nextStep: { id: 'pause', kind: 'timer', delayMs: 1_000 },
      },
      {
        label: 'signal',
        nextStep: { id: 'approval', kind: 'signal' },
      },
      {
        label: 'reserved-activity',
        nextStep: {
          id: 'reserved',
          kind: 'activity',
          activity: MANAGED_EFFECT_SUCCESSOR_ACTIVITY_ID,
          input: { kind: 'workflow-input' },
        },
      },
    ])(
      'refuses physical dispatch before an unsupported $label continuation',
      async ({ label, nextStep }) => {
        const { db, cleanup } = await adapter.create();
        const tableName = `execution-ledger-workflow-unsupported-${label}`;
        const runId = workflowRunId(`${adapter.name}-unsupported-${label}`);
        try {
          const ledger = createExecutionLedger({ db, tableName });
          const created = await ledger.createWorkflowRun(
            workflowRun(runId, [FIRST_STEP, nextStep]),
          );
          await expect(
            ledger.claimWorkflowActivity({
              runId,
              invocationId: created.invocation.invocationId,
              cursor: cursorGuard(created.workflowCursor),
              fencingToken: `unsupported-${label}-fence`,
              expectedGeneration: 0,
              expectedVersion: 1,
              transitionId: `unsupported-${label}-claim`,
              actor: ACTOR,
              observedAt: CREATED_AT + 1,
            }),
          ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
          await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
          await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
            run: { version: 1, status: RunStatus.RUNNING },
            workflowCursor: {
              version: 1,
              disposition: 'ACTIVITY_RUNNABLE',
            },
          });
        } finally {
          await cleanup();
        }
      },
    );

    test('claims, starts, advances, and terminalizes one two-activity workflow', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-lifecycle-happy';
      const runId = workflowRunId(`${adapter.name}-happy`);
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const created = await ledger.createWorkflowRun(
          workflowRun(runId, [FIRST_STEP, SECOND_STEP]),
        );
        const firstClaimRequest = {
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(created.workflowCursor),
          fencingToken: 'first-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'claim-first',
          actor: ACTOR,
          observedAt: CREATED_AT + 1,
        };
        const firstClaim =
          await ledger.claimWorkflowActivity(firstClaimRequest);
        const firstClaimReplay =
          await ledger.claimWorkflowActivity(firstClaimRequest);

        expect(firstClaim).toMatchObject({
          applied: true,
          run: { status: RunStatus.RUNNING, version: 2, lastSequence: 2 },
          workflowCursor: {
            disposition: 'ACTIVITY_RUNNING',
            version: 2,
            lastSequence: 2,
          },
          invocation: {
            status: InvocationStatus.RUNNING,
            generation: 1,
          },
          attempt: {
            status: AttemptStatus.CLAIMED,
            generation: 1,
            fencingToken: 'first-fence',
          },
        });
        expect(firstClaimReplay).toMatchObject({
          applied: false,
          receipt: firstClaim.receipt,
          workflowCursor: firstClaim.workflowCursor,
          attempt: firstClaim.attempt,
        });
        expect((await listReadyWork(ledger)).items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.RECOVERY,
            runVersion: 2,
            cursorVersion: 2,
            invocationId: created.invocation.invocationId,
            attemptId: firstClaim.attempt.attemptId,
            generation: 1,
          }),
        ]);

        const firstStartRequest = {
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(firstClaim.workflowCursor),
          attemptId: firstClaim.attempt.attemptId,
          fencingToken: 'first-fence',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'start-first',
          actor: ACTOR,
          observedAt: CREATED_AT + 2,
        };
        const firstStart =
          await ledger.markWorkflowActivityStarted(firstStartRequest);
        const firstStartReplay =
          await ledger.markWorkflowActivityStarted(firstStartRequest);

        expect(firstStart).toMatchObject({
          applied: true,
          dispatchAuthorized: true,
          run: { version: 3, lastSequence: 3 },
          workflowCursor: { version: 3, lastSequence: 3 },
          attempt: { status: AttemptStatus.STARTED },
          startFrame: {
            type: 'start',
            runId,
            invocationId: created.invocation.invocationId,
            attemptId: firstClaim.attempt.attemptId,
            fencingToken: 'first-fence',
            activityId: 'produce',
            input: { value: 'workflow-input' },
          },
        });
        expect(firstStartReplay).toMatchObject({
          applied: false,
          dispatchAuthorized: false,
          receipt: firstStart.receipt,
          startFrame: firstStart.startFrame,
        });

        const firstSuccessRequest = {
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(firstStart.workflowCursor),
          attemptId: firstClaim.attempt.attemptId,
          fencingToken: 'first-fence',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'success-first',
          evidence: completedEvidence(firstStart.startFrame, {
            produced: 'first-output',
          }),
          actor: ACTOR,
          observedAt: CREATED_AT + 3,
        };
        const firstSuccess =
          await ledger.commitVerifiedWorkflowActivityTerminal(
            firstSuccessRequest,
          );
        const firstSuccessReplay =
          await ledger.commitVerifiedWorkflowActivityTerminal(
            firstSuccessRequest,
          );

        expect(firstSuccess).toMatchObject({
          applied: true,
          run: { status: RunStatus.RUNNING, version: 4, lastSequence: 4 },
          invocation: {
            invocationId: created.invocation.invocationId,
            status: InvocationStatus.COMPLETED,
            terminal: {
              type: 'completed',
              attemptId: firstClaim.attempt.attemptId,
            },
          },
          attempt: { status: AttemptStatus.COMPLETED },
          workflowCursor: {
            stepId: 'consume',
            stepIndex: 1,
            disposition: 'ACTIVITY_RUNNABLE',
            version: 4,
            lastSequence: 4,
            outputs: [
              {
                stepId: 'produce',
                stepIndex: 0,
                outputRef: expect.objectContaining({
                  payloadSchema: 'wharfie.execution.workflow-output.v1',
                }),
              },
            ],
          },
          outputRef: expect.objectContaining({
            payloadSchema: 'wharfie.execution.workflow-output.v1',
          }),
          nextInvocation: {
            activityId: 'consume',
            status: InvocationStatus.RUNNABLE,
            generation: 0,
            workflow: {
              stepId: 'consume',
              stepIndex: 1,
            },
          },
        });
        expect(firstSuccessReplay).toMatchObject({
          applied: false,
          receipt: firstSuccess.receipt,
          workflowCursor: firstSuccess.workflowCursor,
          outputRef: firstSuccess.outputRef,
          nextInvocation: firstSuccess.nextInvocation,
        });
        await expect(
          PAYLOAD_STORE.readJson(firstSuccess.outputRef),
        ).resolves.toEqual({
          schemaVersion: 1,
          kind: 'workflowOutput',
          value: { produced: 'first-output' },
        });
        await expect(
          PAYLOAD_STORE.readJson(firstSuccess.nextInvocation.requestRef),
        ).resolves.toEqual({
          input: { produced: 'first-output' },
          callerMetadata: { source: 'workflow-lifecycle-test' },
        });
        expect((await listReadyWork(ledger)).items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            runVersion: 4,
            lastSequence: 4,
            cursorVersion: 4,
            invocationId: firstSuccess.nextInvocation.invocationId,
            generation: 0,
            stepId: 'consume',
            stepIndex: 1,
          }),
        ]);

        const secondClaim = await ledger.claimWorkflowActivity({
          runId,
          invocationId: firstSuccess.nextInvocation.invocationId,
          cursor: cursorGuard(firstSuccess.workflowCursor),
          fencingToken: 'second-fence',
          expectedGeneration: 0,
          expectedVersion: 4,
          transitionId: 'claim-second',
          actor: ACTOR,
          observedAt: CREATED_AT + 4,
        });
        const lateFirstSuccessReplay =
          await ledger.commitVerifiedWorkflowActivityTerminal(
            firstSuccessRequest,
          );
        expect(lateFirstSuccessReplay).toMatchObject({
          applied: false,
          run: { version: 5, lastSequence: 5 },
          invocation: {
            invocationId: created.invocation.invocationId,
            status: InvocationStatus.COMPLETED,
          },
          workflowCursor: firstSuccess.workflowCursor,
          outputRef: firstSuccess.outputRef,
          nextInvocation: firstSuccess.nextInvocation,
        });
        const secondStart = await ledger.markWorkflowActivityStarted({
          runId,
          invocationId: firstSuccess.nextInvocation.invocationId,
          cursor: cursorGuard(secondClaim.workflowCursor),
          attemptId: secondClaim.attempt.attemptId,
          fencingToken: 'second-fence',
          generation: 1,
          expectedVersion: 5,
          transitionId: 'start-second',
          actor: ACTOR,
          observedAt: CREATED_AT + 5,
        });
        const finalSuccess =
          await ledger.commitVerifiedWorkflowActivityTerminal({
            runId,
            invocationId: firstSuccess.nextInvocation.invocationId,
            cursor: cursorGuard(secondStart.workflowCursor),
            attemptId: secondClaim.attempt.attemptId,
            fencingToken: 'second-fence',
            generation: 1,
            expectedVersion: 6,
            transitionId: 'success-second',
            evidence: completedEvidence(secondStart.startFrame, {
              consumed: true,
            }),
            actor: ACTOR,
            observedAt: CREATED_AT + 6,
          });

        expect(finalSuccess).toMatchObject({
          applied: true,
          run: { status: RunStatus.COMPLETED, version: 7, lastSequence: 7 },
          invocation: {
            invocationId: firstSuccess.nextInvocation.invocationId,
            status: InvocationStatus.COMPLETED,
          },
          attempt: { status: AttemptStatus.COMPLETED },
          workflowCursor: {
            stepId: 'consume',
            stepIndex: 1,
            disposition: 'COMPLETED',
            version: 7,
            lastSequence: 7,
            outputs: [
              firstSuccess.workflowCursor.outputs[0],
              {
                stepId: 'consume',
                stepIndex: 1,
                outputRef: expect.objectContaining({
                  payloadSchema: 'wharfie.execution.workflow-output.v1',
                }),
              },
            ],
          },
          outputRef: expect.objectContaining({
            payloadSchema: 'wharfie.execution.workflow-output.v1',
          }),
        });
        expect(finalSuccess).not.toHaveProperty('nextInvocation');
        await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });
        await expect(ledger.getEvents(runId)).resolves.toHaveLength(7);
        const rebuilt = await ledger.rebuildRun(runId);
        if (!rebuilt) throw new Error('Expected completed workflow rebuild.');
        expect(rebuilt).toMatchObject({
          run: finalSuccess.run,
          workflowCursor: finalSuccess.workflowCursor,
        });
        expect(rebuilt.invocations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              invocationId: created.invocation.invocationId,
              status: InvocationStatus.COMPLETED,
            }),
            expect.objectContaining({
              invocationId: firstSuccess.nextInvocation.invocationId,
              status: InvocationStatus.COMPLETED,
            }),
          ]),
        );
        expect(rebuilt.attempts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              attemptId: firstClaim.attempt.attemptId,
            }),
            expect.objectContaining({
              attemptId: secondClaim.attempt.attemptId,
            }),
          ]),
        );
      } finally {
        await cleanup();
      }
    });

    test('rejects stale cursor, head, fence, and conflicting transition reuse', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-lifecycle-conflicts';
      const runId = workflowRunId(`${adapter.name}-conflicts`);
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const created = await ledger.createWorkflowRun(
          workflowRun(runId, [FIRST_STEP]),
        );
        const claimBase = {
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(created.workflowCursor),
          fencingToken: 'conflict-fence',
          expectedGeneration: 0,
          expectedVersion: 1,
          transitionId: 'conflict-claim',
          actor: ACTOR,
          observedAt: CREATED_AT + 1,
        };

        await expect(
          ledger.claimWorkflowActivity({
            ...claimBase,
            cursor: { ...claimBase.cursor, version: 2 },
            transitionId: 'stale-cursor-claim',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.claimWorkflowActivity({
            ...claimBase,
            expectedVersion: 2,
            transitionId: 'stale-head-claim',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        const claimed = await ledger.claimWorkflowActivity(claimBase);
        await expect(
          ledger.claimWorkflowActivity({
            ...claimBase,
            fencingToken: 'changed-fence',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
        const startBase = {
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(claimed.workflowCursor),
          attemptId: claimed.attempt.attemptId,
          fencingToken: 'conflict-fence',
          generation: 1,
          expectedVersion: 2,
          transitionId: 'conflict-start',
          actor: ACTOR,
          observedAt: CREATED_AT + 2,
        };
        await expect(
          ledger.markWorkflowActivityStarted({
            ...startBase,
            cursor: cursorGuard(created.workflowCursor),
            transitionId: 'stale-cursor-start',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.markWorkflowActivityStarted({
            ...startBase,
            fencingToken: 'wrong-fence',
            transitionId: 'wrong-fence-start',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        const started = await ledger.markWorkflowActivityStarted(startBase);
        const successBase = {
          runId,
          invocationId: created.invocation.invocationId,
          cursor: cursorGuard(started.workflowCursor),
          attemptId: claimed.attempt.attemptId,
          fencingToken: 'conflict-fence',
          generation: 1,
          expectedVersion: 3,
          transitionId: 'conflict-success',
          evidence: completedEvidence(started.startFrame, { completed: true }),
          actor: ACTOR,
          observedAt: CREATED_AT + 3,
        };
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal({
            ...successBase,
            cursor: cursorGuard(claimed.workflowCursor),
            transitionId: 'stale-cursor-success',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal({
            ...successBase,
            fencingToken: 'wrong-fence',
            transitionId: 'wrong-fence-success',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal({
            ...successBase,
            expectedVersion: 4,
            transitionId: 'stale-head-success',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        await expect(ledger.getEvents(runId)).resolves.toHaveLength(3);
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [
            expect.objectContaining({
              runId,
              kind: ExecutionLedgerReadyWorkKind.RECOVERY,
              runVersion: 3,
              cursorVersion: 3,
            }),
          ],
        });
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal(successBase),
        ).resolves.toMatchObject({
          applied: true,
          run: { status: RunStatus.COMPLETED },
        });
      } finally {
        await cleanup();
      }
    });
  });
}
