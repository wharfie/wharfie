/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
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
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';

const APP_ID = 'workflow-cancellation-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-cancellation-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'cancellable-pipeline';
const BASE_TIME = 1_701_000_000_000;
const ACTOR = Object.freeze({ kind: 'operator', id: 'cancellation-test' });
const CANCELLATION_REASON = Object.freeze({
  code: 'operator-requested-cancellation',
  name: 'WorkflowCancellationError',
  message: 'The operator cancelled this workflow.',
  details: { source: 'workflow-cancellation-test' },
});
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

/** @typedef {ReturnType<typeof createExecutionLedger>} Ledger */

/** @param {Record<string, any>} cursor */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/**
 * @param {Record<string, any>} start
 * @param {any} result
 * @param {Record<string, any>} [cancellationReason]
 */
function completedEvidence(start, result, cancellationReason = undefined) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const frames = [acceptedStart];
  if (cancellationReason) {
    frames.push(
      transcript.acceptHostFrame({
        protocol: 'wharfie.activity',
        protocolVersion: 1,
        type: 'cancel',
        attemptId: acceptedStart.attemptId,
        reason: cancellationReason,
      }),
    );
  }
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'completed',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    result,
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

/** @param {Record<string, any>} start @param {Record<string, any>} reason */
function cancelledEvidence(start, reason) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
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

/** @param {Record<string, any>} start @param {Record<string, any>} reason */
function protocolFailedAfterCancelEvidence(start, reason) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const cancel = transcript.acceptHostFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'cancel',
    attemptId: acceptedStart.attemptId,
    reason,
  });
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type: 'protocol-failed',
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: {
      code: 'protocol-failed-after-cancel',
      name: 'ProtocolFailure',
      message: 'The component outcome is ambiguous after cancellation.',
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

/**
 * @param {ReturnType<typeof getAdapterMatrix>[number]} adapter
 * @param {string} label
 */
async function createHarness(adapter, label) {
  const { db, cleanup: cleanupDb } = await adapter.create();
  const payloadRoot = mkdtempSync(
    join(tmpdir(), `wharfie-workflow-cancellation-${adapter.name}-`),
  );
  const payloadStore = createLocalExecutionPayloadStore({
    path: payloadRoot,
    storeId: `workflow-cancel-${createHash('sha256')
      .update(`${adapter.name}:${label}`)
      .digest('hex')
      .slice(0, 16)}`,
  });
  return {
    ledger: createExecutionLedger({
      db,
      tableName: `workflow-cancellation-${label}`,
      payloadStore,
    }),
    async cleanup() {
      try {
        await cleanupDb();
      } finally {
        rmSync(payloadRoot, { recursive: true, force: true });
      }
    },
  };
}

/**
 * @param {Ledger} ledger
 * @param {string} label
 * @param {Record<string, any>[]} [steps]
 */
async function createWorkflow(
  ledger,
  label,
  steps = [FIRST_STEP, SECOND_STEP],
) {
  const runId = createWorkflowRunId({
    appId: APP_ID,
    idempotencyKey: label,
  });
  const created = await ledger.createWorkflowRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: { steps },
    input: { scenario: label },
    callerMetadata: { source: 'workflow-cancellation-test' },
    transitionId: `${label}-create`,
    actor: ACTOR,
    observedAt: BASE_TIME,
  });
  return { runId, created };
}

/**
 * @param {Ledger} ledger
 * @param {string} runId
 * @param {Record<string, any>} current
 * @param {string} label
 * @param {number} observedAt
 */
async function claimWorkflow(ledger, runId, current, label, observedAt) {
  return await ledger.claimWorkflowActivity({
    runId,
    invocationId: current.invocation.invocationId,
    cursor: cursorGuard(current.workflowCursor),
    fencingToken: `${label}-fence`,
    expectedGeneration: current.invocation.generation,
    expectedVersion: current.run.version,
    transitionId: `${label}-claim`,
    actor: ACTOR,
    observedAt,
  });
}

/**
 * @param {Ledger} ledger
 * @param {string} runId
 * @param {Record<string, any>} claimed
 * @param {string} label
 * @param {number} observedAt
 */
async function startWorkflow(ledger, runId, claimed, label, observedAt) {
  return await ledger.markWorkflowActivityStarted({
    runId,
    invocationId: claimed.invocation.invocationId,
    cursor: cursorGuard(claimed.workflowCursor),
    attemptId: claimed.attempt.attemptId,
    fencingToken: claimed.attempt.fencingToken,
    generation: claimed.attempt.generation,
    coordinatorEpoch: claimed.attempt.coordinatorEpoch,
    expectedVersion: claimed.run.version,
    transitionId: `${label}-start`,
    actor: ACTOR,
    observedAt,
  });
}

/**
 * @param {string} runId
 * @param {Record<string, any>} current
 * @param {string} transitionId
 * @param {number} observedAt
 */
function cancellationRequest(runId, current, transitionId, observedAt) {
  return {
    runId,
    invocationId: current.invocation.invocationId,
    cursor: cursorGuard(current.workflowCursor),
    expectedVersion: current.run.version,
    expectedGeneration: current.invocation.generation,
    transitionId,
    requestId: `${transitionId}-request`,
    reason: CANCELLATION_REASON,
    actor: ACTOR,
    observedAt,
    ...(current.attempt
      ? {
          attemptId: current.attempt.attemptId,
          fencingToken: current.attempt.fencingToken,
          coordinatorEpoch: current.attempt.coordinatorEpoch,
        }
      : {}),
  };
}

/**
 * @param {string} runId
 * @param {Record<string, any>} current
 * @param {string} transitionId
 * @param {Record<string, any>} evidence
 * @param {number} observedAt
 */
function terminalRequest(runId, current, transitionId, evidence, observedAt) {
  return {
    runId,
    invocationId: current.invocation.invocationId,
    cursor: cursorGuard(current.workflowCursor),
    attemptId: current.attempt.attemptId,
    fencingToken: current.attempt.fencingToken,
    generation: current.attempt.generation,
    coordinatorEpoch: current.attempt.coordinatorEpoch,
    expectedVersion: current.run.version,
    transitionId,
    evidence,
    actor: ACTOR,
    observedAt,
  };
}

/**
 * @param {Ledger} ledger
 * @param {string} runId
 * @param {Record<string, any>} current
 * @param {string} label
 * @param {number} observedAt
 */
async function markUncertain(ledger, runId, current, label, observedAt) {
  return await ledger.markWorkflowActivityAttemptUncertain({
    runId,
    invocationId: current.invocation.invocationId,
    cursor: cursorGuard(current.workflowCursor),
    attemptId: current.attempt.attemptId,
    fencingToken: current.attempt.fencingToken,
    generation: current.attempt.generation,
    coordinatorEpoch: current.attempt.coordinatorEpoch,
    expectedVersion: current.run.version,
    transitionId: `${label}-uncertain`,
    reason: { code: 'runner-outcome-lost', label },
    actor: ACTOR,
    observedAt,
  });
}

/**
 * @param {Ledger} ledger
 * @param {string} runId
 * @param {Record<string, any>} started
 * @param {Record<string, any>} uncertain
 * @param {string} label
 * @param {Record<string, any>} evidence
 * @param {number} observedAt
 */
async function reconciliationRequest(
  ledger,
  runId,
  started,
  uncertain,
  label,
  evidence,
  observedAt,
) {
  const uncertaintyEvent = (await ledger.getEvents(runId)).find(
    (/** @type {Record<string, any>} */ { type }) =>
      type === 'workflow-activity-became-uncertain',
  );
  if (!uncertaintyEvent)
    throw new Error('Expected workflow uncertainty event.');
  return {
    runId,
    invocationId: uncertain.invocation.invocationId,
    cursor: cursorGuard(uncertain.workflowCursor),
    attemptId: started.attempt.attemptId,
    fencingToken: started.attempt.fencingToken,
    generation: started.attempt.generation,
    coordinatorEpoch: started.attempt.coordinatorEpoch,
    expectedVersion: uncertain.run.version,
    uncertaintyEventId: uncertaintyEvent.event_id,
    uncertaintySequence: uncertaintyEvent.sequence,
    transitionId: `${label}-reconcile`,
    reconciliationId: `${label}-decision`,
    reason: { code: 'verified-transcript-recovered', label },
    evidence,
    actor: ACTOR,
    observedAt,
  };
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} workflow cancellation`, () => {
    test.each(['runnable', 'claimed'])(
      'terminalizes %s work atomically and replays the first request',
      async (phase) => {
        const label = `${adapter.name}-${phase}`;
        const harness = await createHarness(adapter, label);
        try {
          const { ledger } = harness;
          const { runId, created } = await createWorkflow(ledger, label);
          const current =
            phase === 'claimed'
              ? await claimWorkflow(
                  ledger,
                  runId,
                  created,
                  label,
                  BASE_TIME + 1,
                )
              : created;
          const request = cancellationRequest(
            runId,
            current,
            `${label}-cancel`,
            BASE_TIME + 2,
          );
          const cancelled =
            await ledger.requestWorkflowRunCancellation(request);
          const replayed = await ledger.requestWorkflowRunCancellation(request);

          expect(cancelled).toMatchObject({
            applied: true,
            outcome: 'cancellation-requested',
            cancellationDeliveryRequired: false,
            run: { status: RunStatus.CANCELLED },
            workflowCursor: { disposition: 'CANCELLED' },
            invocation: { status: InvocationStatus.CANCELLED },
          });
          if (phase === 'claimed') {
            expect(cancelled.attempt).toMatchObject({
              status: AttemptStatus.CANCELLED,
              cancellationRequest: { requestId: request.requestId },
            });
          }
          expect(replayed).toMatchObject({
            applied: false,
            receipt: cancelled.receipt,
            cancellationDeliveryRequired: false,
            workflowCursor: cancelled.workflowCursor,
          });
          expect(
            (
              await ledger.listReadyWork({
                appId: APP_ID,
                revisionId: REVISION_ID,
                observedAt: Number.MAX_SAFE_INTEGER,
              })
            ).items,
          ).toEqual([]);

          await expect(
            ledger.requestWorkflowRunCancellation({
              ...request,
              reason: { ...CANCELLATION_REASON, message: 'changed' },
            }),
          ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
          await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
            events: expect.arrayContaining([
              expect.objectContaining({
                type: 'workflow-cancellation-requested',
              }),
            ]),
          });
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('records started intent once, rejects stale start, and commits an exact cancelled terminal', async () => {
      const label = `${adapter.name}-started-cancelled`;
      const harness = await createHarness(adapter, label);
      try {
        const { ledger } = harness;
        const { runId, created } = await createWorkflow(ledger, label);
        const claimed = await claimWorkflow(
          ledger,
          runId,
          created,
          label,
          BASE_TIME + 1,
        );
        const started = await startWorkflow(
          ledger,
          runId,
          claimed,
          label,
          BASE_TIME + 2,
        );
        const request = cancellationRequest(
          runId,
          started,
          `${label}-cancel`,
          BASE_TIME + 3,
        );
        const intent = await ledger.requestWorkflowRunCancellation(request);
        const replay = await ledger.requestWorkflowRunCancellation(request);

        expect(intent).toMatchObject({
          applied: true,
          cancellationDeliveryRequired: true,
          run: {
            status: RunStatus.RUNNING,
            cancellationRequest: { requestId: request.requestId },
          },
          workflowCursor: { disposition: 'ACTIVITY_RUNNING' },
          invocation: {
            status: InvocationStatus.RUNNING,
            cancellationRequest: { requestId: request.requestId },
          },
          attempt: {
            status: AttemptStatus.STARTED,
            cancellationRequest: { requestId: request.requestId },
          },
        });
        expect(replay).toMatchObject({
          applied: false,
          cancellationDeliveryRequired: false,
          receipt: intent.receipt,
        });
        await expect(
          ledger.markWorkflowActivityStarted({
            runId,
            invocationId: claimed.invocation.invocationId,
            cursor: cursorGuard(claimed.workflowCursor),
            attemptId: claimed.attempt.attemptId,
            fencingToken: claimed.attempt.fencingToken,
            generation: claimed.attempt.generation,
            coordinatorEpoch: claimed.attempt.coordinatorEpoch,
            expectedVersion: claimed.run.version,
            transitionId: `${label}-stale-start`,
            actor: ACTOR,
            observedAt: BASE_TIME + 4,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal(
            terminalRequest(
              runId,
              intent,
              `${label}-ambiguous-terminal`,
              protocolFailedAfterCancelEvidence(
                started.startFrame,
                CANCELLATION_REASON,
              ),
              BASE_TIME + 4,
            ),
          ),
        ).rejects.toThrow(/does not prove that the begun handler stopped/i);

        const terminalRequestValue = terminalRequest(
          runId,
          intent,
          `${label}-terminal`,
          cancelledEvidence(started.startFrame, CANCELLATION_REASON),
          BASE_TIME + 4,
        );
        const terminal =
          await ledger.commitVerifiedWorkflowActivityTerminal(
            terminalRequestValue,
          );
        const terminalReplay =
          await ledger.commitVerifiedWorkflowActivityTerminal(
            terminalRequestValue,
          );
        expect(terminal).toMatchObject({
          applied: true,
          run: { status: RunStatus.CANCELLED },
          workflowCursor: { disposition: 'CANCELLED' },
          invocation: { status: InvocationStatus.CANCELLED },
          attempt: { status: AttemptStatus.CANCELLED },
        });
        expect(terminalReplay).toMatchObject({
          applied: false,
          receipt: terminal.receipt,
        });
        expect((await ledger.getEvents(runId)).at(-1)).toMatchObject({
          type: 'workflow-activity-cancelled',
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('reserves bounded uncertainty closure before accepting started cancellation', async () => {
      const label = `${adapter.name}-started-closure-reserve`;
      const harness = await createHarness(adapter, label);
      try {
        const { ledger } = harness;
        const { runId, created } = await createWorkflow(ledger, label);
        const claimed = await claimWorkflow(
          ledger,
          runId,
          created,
          label,
          BASE_TIME + 1,
        );
        const started = await startWorkflow(
          ledger,
          runId,
          claimed,
          label,
          BASE_TIME + 2,
        );
        const before = await ledger.rebuildRun(runId);
        const oversizedCancellation = /** @type {Record<string, any>} */ (
          cancellationRequest(runId, started, `${label}-cancel`, BASE_TIME + 3)
        );
        oversizedCancellation.reason = {
          ...CANCELLATION_REASON,
          message: 'x'.repeat(48 * 1024),
        };

        await expect(
          ledger.requestWorkflowRunCancellation(oversizedCancellation),
        ).rejects.toThrow(/closure reserve|maximum encoded size/i);
        await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);

        await expect(
          ledger.markWorkflowActivityAttemptUncertain({
            runId,
            invocationId: started.invocation.invocationId,
            cursor: cursorGuard(started.workflowCursor),
            attemptId: started.attempt.attemptId,
            fencingToken: started.attempt.fencingToken,
            generation: started.attempt.generation,
            coordinatorEpoch: started.attempt.coordinatorEpoch,
            expectedVersion: started.run.version,
            transitionId: `${label}-uncertain`,
            reason: { message: 'x'.repeat(33 * 1024) },
            actor: ACTOR,
            observedAt: BASE_TIME + 3,
          }),
        ).rejects.toThrow(/must not exceed 32768 bytes/i);
        await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
      } finally {
        await harness.cleanup();
      }
    });

    test.each([
      { label: 'nonfinal', steps: [FIRST_STEP, SECOND_STEP] },
      { label: 'final', steps: [FIRST_STEP] },
    ])(
      'lets a completed $label activity win physically without continuing a cancelled run',
      async ({ label: path, steps }) => {
        const label = `${adapter.name}-completed-${path}`;
        const harness = await createHarness(adapter, label);
        try {
          const { ledger } = harness;
          const { runId, created } = await createWorkflow(ledger, label, steps);
          const claimed = await claimWorkflow(
            ledger,
            runId,
            created,
            label,
            BASE_TIME + 1,
          );
          const started = await startWorkflow(
            ledger,
            runId,
            claimed,
            label,
            BASE_TIME + 2,
          );
          const intent = await ledger.requestWorkflowRunCancellation(
            cancellationRequest(
              runId,
              started,
              `${label}-cancel`,
              BASE_TIME + 3,
            ),
          );
          const completed = await ledger.commitVerifiedWorkflowActivityTerminal(
            terminalRequest(
              runId,
              intent,
              `${label}-terminal`,
              completedEvidence(
                started.startFrame,
                { completed: path },
                CANCELLATION_REASON,
              ),
              BASE_TIME + 4,
            ),
          );

          expect(completed.invocation.status).toBe(InvocationStatus.COMPLETED);
          expect(completed.attempt.status).toBe(AttemptStatus.COMPLETED);
          if (path === 'nonfinal') {
            expect(completed).toMatchObject({
              run: { status: RunStatus.CANCELLED },
              workflowCursor: { disposition: 'CANCELLED', outputs: [] },
            });
            expect(completed).not.toHaveProperty('outputRef');
            expect(completed).not.toHaveProperty('nextInvocation');
            const rebuilt = await ledger.rebuildRun(runId);
            expect(rebuilt?.invocations).toHaveLength(1);
          } else {
            expect(completed).toMatchObject({
              run: { status: RunStatus.COMPLETED },
              workflowCursor: { disposition: 'COMPLETED' },
              outputRef: expect.any(Object),
            });
          }
        } finally {
          await harness.cleanup();
        }
      },
    );

    test('retains cancellation intent across uncertainty without retroactively authorizing the abandoned attempt', async () => {
      const label = `${adapter.name}-uncertain-then-cancel`;
      const harness = await createHarness(adapter, label);
      try {
        const { ledger } = harness;
        const { runId, created } = await createWorkflow(ledger, label);
        const claimed = await claimWorkflow(
          ledger,
          runId,
          created,
          label,
          BASE_TIME + 1,
        );
        const started = await startWorkflow(
          ledger,
          runId,
          claimed,
          label,
          BASE_TIME + 2,
        );
        const uncertain = await markUncertain(
          ledger,
          runId,
          started,
          label,
          BASE_TIME + 3,
        );
        const intent = await ledger.requestWorkflowRunCancellation(
          cancellationRequest(
            runId,
            uncertain,
            `${label}-cancel`,
            BASE_TIME + 4,
          ),
        );
        expect(intent).toMatchObject({
          cancellationDeliveryRequired: false,
          run: { status: RunStatus.BLOCKED },
          workflowCursor: { disposition: 'ACTIVITY_UNCERTAIN' },
          invocation: { status: InvocationStatus.UNCERTAIN },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        expect(intent.attempt).not.toHaveProperty('cancellationRequest');

        const cancelledRequest = await reconciliationRequest(
          ledger,
          runId,
          started,
          intent,
          `${label}-cancelled`,
          cancelledEvidence(started.startFrame, CANCELLATION_REASON),
          BASE_TIME + 5,
        );
        await expect(
          ledger.reconcileUncertainWorkflowActivityAttempt(cancelledRequest),
        ).rejects.toThrow(
          /workflow cancellation authority is not implemented/i,
        );

        const completedRequest = await reconciliationRequest(
          ledger,
          runId,
          started,
          intent,
          `${label}-completed`,
          completedEvidence(started.startFrame, { recovered: true }),
          BASE_TIME + 5,
        );
        const reconciled =
          await ledger.reconcileUncertainWorkflowActivityAttempt(
            completedRequest,
          );
        expect(reconciled).toMatchObject({
          run: { status: RunStatus.CANCELLED },
          workflowCursor: { disposition: 'CANCELLED', outputs: [] },
          invocation: { status: InvocationStatus.COMPLETED },
          attempt: { status: AttemptStatus.ABANDONED },
        });
        expect(reconciled).not.toHaveProperty('outputRef');
        expect(reconciled).not.toHaveProperty('nextInvocation');
      } finally {
        await harness.cleanup();
      }
    });

    test('authorizes cancelled reconciliation only when intent preceded uncertainty', async () => {
      const label = `${adapter.name}-cancel-then-uncertain`;
      const harness = await createHarness(adapter, label);
      try {
        const { ledger } = harness;
        const { runId, created } = await createWorkflow(ledger, label);
        const claimed = await claimWorkflow(
          ledger,
          runId,
          created,
          label,
          BASE_TIME + 1,
        );
        const started = await startWorkflow(
          ledger,
          runId,
          claimed,
          label,
          BASE_TIME + 2,
        );
        const intent = await ledger.requestWorkflowRunCancellation(
          cancellationRequest(runId, started, `${label}-cancel`, BASE_TIME + 3),
        );
        const uncertain = await markUncertain(
          ledger,
          runId,
          intent,
          label,
          BASE_TIME + 4,
        );
        expect(uncertain.attempt).toMatchObject({
          status: AttemptStatus.ABANDONED,
          cancellationRequest: { requestId: `${label}-cancel-request` },
        });
        const request = await reconciliationRequest(
          ledger,
          runId,
          started,
          uncertain,
          label,
          cancelledEvidence(started.startFrame, CANCELLATION_REASON),
          BASE_TIME + 5,
        );
        const reconciled =
          await ledger.reconcileUncertainWorkflowActivityAttempt(request);
        expect(reconciled).toMatchObject({
          run: { status: RunStatus.CANCELLED },
          workflowCursor: { disposition: 'CANCELLED' },
          invocation: { status: InvocationStatus.CANCELLED },
          attempt: {
            status: AttemptStatus.ABANDONED,
            cancellationRequest: { requestId: `${label}-cancel-request` },
          },
        });
      } finally {
        await harness.cleanup();
      }
    });

    test('cancels the successor when success wins the prior activity race', async () => {
      const label = `${adapter.name}-success-first`;
      const harness = await createHarness(adapter, label);
      try {
        const { ledger } = harness;
        const { runId, created } = await createWorkflow(ledger, label);
        const claimed = await claimWorkflow(
          ledger,
          runId,
          created,
          label,
          BASE_TIME + 1,
        );
        const started = await startWorkflow(
          ledger,
          runId,
          claimed,
          label,
          BASE_TIME + 2,
        );
        const succeeded = await ledger.commitVerifiedWorkflowActivityTerminal(
          terminalRequest(
            runId,
            started,
            `${label}-success`,
            completedEvidence(started.startFrame, { produced: true }),
            BASE_TIME + 3,
          ),
        );
        expect(succeeded).toMatchObject({
          run: { status: RunStatus.RUNNING },
          workflowCursor: {
            disposition: 'ACTIVITY_RUNNABLE',
            stepId: SECOND_STEP.id,
          },
        });
        const cancelled = await ledger.requestWorkflowRunCancellation(
          cancellationRequest(
            runId,
            {
              run: succeeded.run,
              workflowCursor: succeeded.workflowCursor,
              invocation: succeeded.nextInvocation,
            },
            `${label}-cancel-successor`,
            BASE_TIME + 4,
          ),
        );
        expect(cancelled).toMatchObject({
          run: { status: RunStatus.CANCELLED },
          workflowCursor: {
            disposition: 'CANCELLED',
            stepId: SECOND_STEP.id,
            outputs: [expect.objectContaining({ stepId: FIRST_STEP.id })],
          },
          invocation: { status: InvocationStatus.CANCELLED },
        });
      } finally {
        await harness.cleanup();
      }
    });
  });
}
