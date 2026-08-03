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
  ExecutionLedgerProjectionError,
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
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

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
 * @param {Readonly<Record<string, any>>} startFrame - Ledger-authorized Activity Protocol start.
 * @param {string} marker - Stable failure marker.
 * @returns {Record<string, any>} Complete failed transcript evidence.
 */
function failedEvidence(startFrame, marker) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const start = transcript.acceptHostFrame(startFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
    type: 'failed',
    attemptId: start.attemptId,
    sequence: 1,
    error: {
      code: 'application-failed',
      name: 'ApplicationFailure',
      message: 'The workflow activity failed as requested by the test.',
      details: { marker },
    },
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
 * @param {{run: Record<string, any>, workflowCursor: Record<string, any>, invocation: Record<string, any>}} authority - Runnable activity authority.
 * @param {string} label - Stable transition label.
 * @param {number} observedAt - Claim observation.
 * @returns {Promise<{claimed: Record<string, any>, started: Record<string, any>}>} Started activity fixture.
 */
async function claimAndStartWorkflowActivity(
  ledger,
  authority,
  label,
  observedAt,
) {
  const fencingToken = `${label}-fence`;
  const claimed = await ledger.claimWorkflowActivity({
    runId: authority.run.runId,
    invocationId: authority.invocation.invocationId,
    cursor: cursorGuard(authority.workflowCursor),
    fencingToken,
    expectedGeneration: authority.invocation.generation,
    expectedVersion: authority.run.version,
    transitionId: `${label}-claim`,
    actor: ACTOR,
    observedAt,
  });
  const started = await ledger.markWorkflowActivityStarted({
    runId: authority.run.runId,
    invocationId: authority.invocation.invocationId,
    cursor: cursorGuard(claimed.workflowCursor),
    attemptId: claimed.attempt.attemptId,
    fencingToken,
    generation: claimed.attempt.generation,
    expectedVersion: claimed.run.version,
    transitionId: `${label}-start`,
    actor: ACTOR,
    observedAt: observedAt + 1,
  });
  return { claimed, started };
}

/**
 * Rewrite a rejected delivery and all of its content-bound per-run records so
 * only semantic classification verification can detect the contradiction.
 * @param {import('../../src/core/lib/db/base.js').DBClient} db - DB adapter.
 * @param {string} tableName - Ledger table.
 * @param {string} runId - Workflow run identity.
 * @param {string} deliveryId - Rejected delivery identity.
 * @param {'early-signal'|'unexpected-signal'|'late-signal'} rejectionReason - Contradictory reason.
 * @returns {Promise<void>} Tamper completion.
 */
async function rewriteRejectedSignalReason(
  db,
  tableName,
  runId,
  deliveryId,
  rejectionReason,
) {
  const records = await db.query({
    tableName,
    consistentRead: true,
    keyConditions: [
      {
        keyType: 'PRIMARY',
        conditionType: 'EQUALS',
        propertyName: 'run_id',
        propertyValue: runId,
      },
      {
        keyType: 'SORT',
        conditionType: 'BEGINS_WITH',
        propertyName: 'sort_key',
        propertyValue: 'ledger/v10/',
      },
    ],
  });
  const event = structuredClone(
    records.find(
      (record) =>
        record.record_type === 'execution_ledger_event' &&
        record.payload?.signalDelivery?.deliveryId === deliveryId,
    ),
  );
  const projection = structuredClone(
    records.find(
      (record) =>
        record.record_type ===
          'execution_ledger_workflow_signal_delivery_projection' &&
        record.delivery_id === deliveryId,
    ),
  );
  if (!event || !projection) {
    throw new Error('Expected rejected delivery records to tamper.');
  }
  const receipt = structuredClone(
    records.find(
      (record) =>
        record.record_type === 'execution_ledger_transition' &&
        record.transition_id === event.transition_id,
    ),
  );
  if (!receipt) throw new Error('Expected rejected delivery receipt.');

  event.payload.signalDelivery.rejectionReason = rejectionReason;
  projection.data.rejectionReason = rejectionReason;
  event.event_id = createCanonicalJsonSha256Id({
    domain: 'wharfie:execution-ledger-event:v10',
    prefix: 'wle',
    value: {
      schemaVersion: event.schema_version,
      runId,
      sequence: event.sequence,
      transitionId: event.transition_id,
      requestDigest: event.request_digest,
      type: event.type,
      observedAt: event.observed_at,
      actor: event.actor,
      fence: event.fence,
      payload: event.payload,
    },
    valuePath: 'ledger event identity',
  });
  receipt.event_id = event.event_id;
  for (const record of [event, receipt, projection]) {
    await db.put({
      tableName,
      keyName: 'run_id',
      sortKeyName: 'sort_key',
      record,
    });
  }
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
        await expect(
          ledger.readRunOutput({ appId: APP_ID, runId }),
        ).resolves.toEqual({
          scope: {
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          },
          snapshot: {
            runKind: 'workflow',
            status: RunStatus.RUNNING,
            version: firstSuccess.run.version,
            lastSequence: firstSuccess.run.lastSequence,
          },
          outputs: [
            {
              stepId: 'produce',
              stepIndex: 0,
              value: { produced: 'first-output' },
            },
          ],
          terminal: null,
        });

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
          run: { version: 4, lastSequence: 4 },
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
        await expect(
          ledger.readRunOutput({ appId: APP_ID, runId }),
        ).resolves.toEqual({
          scope: {
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          },
          snapshot: {
            runKind: 'workflow',
            status: RunStatus.COMPLETED,
            version: finalSuccess.run.version,
            lastSequence: finalSuccess.run.lastSequence,
          },
          outputs: [
            {
              stepId: 'produce',
              stepIndex: 0,
              value: { produced: 'first-output' },
            },
            {
              stepId: 'consume',
              stepIndex: 1,
              value: { consumed: true },
            },
          ],
          terminal: {
            type: 'completed',
            result: { consumed: true },
          },
        });
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

    test('advances activity through timer and signal waits with exact historical replay', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-wait-chain';
      const runId = workflowRunId(`${adapter.name}-wait-chain`);
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const created = await ledger.createWorkflowRun(
          workflowRun(runId, [
            FIRST_STEP,
            { id: 'pause', kind: 'timer', delayMs: 10 },
            { id: 'approval', kind: 'signal' },
            {
              id: 'finish',
              kind: 'activity',
              activity: 'finish',
              input: { kind: 'step-output', step: 'approval' },
            },
          ]),
        );
        const first = await claimAndStartWorkflowActivity(
          ledger,
          created,
          'wait-chain-first',
          CREATED_AT + 1,
        );

        const earlyBeforeSuccess = await ledger.deliverWorkflowSignal({
          appId: APP_ID,
          runId,
          signalId: 'approval',
          deliveryId: 'wait-chain-early-before-success',
          payload: { approved: false },
          actor: ACTOR,
          observedAt: CREATED_AT + 3,
        });
        expect(earlyBeforeSuccess).toMatchObject({
          applied: true,
          outcome: 'rejected',
          rejectionReason: 'early-signal',
          run: { version: 4, lastSequence: 4 },
          workflowCursor: first.started.workflowCursor,
          signalDelivery: { status: 'REJECTED' },
        });

        const firstSuccessRequest = {
          runId,
          invocationId: first.started.invocation.invocationId,
          cursor: cursorGuard(first.started.workflowCursor),
          attemptId: first.started.attempt.attemptId,
          fencingToken: first.started.attempt.fencingToken,
          generation: first.started.attempt.generation,
          expectedVersion: earlyBeforeSuccess.run.version,
          transitionId: 'wait-chain-first-success',
          evidence: completedEvidence(first.started.startFrame, {
            produced: true,
          }),
          actor: ACTOR,
          observedAt: CREATED_AT + 4,
        };
        const firstSuccess =
          await ledger.commitVerifiedWorkflowActivityTerminal(
            firstSuccessRequest,
          );
        expect(firstSuccess).toMatchObject({
          applied: true,
          run: { version: 5, lastSequence: 5 },
          workflowCursor: {
            disposition: 'TIMER_WAITING',
            stepId: 'pause',
            stepIndex: 1,
          },
          nextTimer: { status: 'WAITING', stepId: 'pause' },
          outputRef: expect.any(Object),
        });
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal(firstSuccessRequest),
        ).resolves.toMatchObject({
          applied: false,
          run: firstSuccess.run,
          workflowCursor: firstSuccess.workflowCursor,
          nextTimer: firstSuccess.nextTimer,
          outputRef: firstSuccess.outputRef,
        });
        await expect(
          ledger.deliverWorkflowSignal({
            appId: APP_ID,
            runId,
            signalId: 'approval',
            deliveryId: 'wait-chain-early-before-success',
            payload: { approved: false },
            actor: ACTOR,
            observedAt: CREATED_AT + 3,
          }),
        ).resolves.toMatchObject({
          applied: false,
          outcome: 'rejected',
          rejectionReason: 'early-signal',
          run: earlyBeforeSuccess.run,
          workflowCursor: first.started.workflowCursor,
        });
        expect((await listReadyWork(ledger)).items).toEqual([
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.TIMER,
            timerId: firstSuccess.nextTimer.timerId,
          }),
        ]);

        await expect(
          ledger.fireWorkflowTimer({
            runId,
            timerId: firstSuccess.nextTimer.timerId,
            actor: ACTOR,
            observedAt: firstSuccess.nextTimer.dueAt - 1,
          }),
        ).resolves.toMatchObject({
          applied: false,
          outcome: 'not-due',
          run: firstSuccess.run,
          timer: firstSuccess.nextTimer,
        });
        const timerEarlyAt = firstSuccess.nextTimer.dueAt + 5;
        const timerEarlySignal = await ledger.deliverWorkflowSignal({
          appId: APP_ID,
          runId,
          signalId: 'approval',
          deliveryId: 'wait-chain-early-at-timer',
          payload: { approved: false },
          actor: ACTOR,
          observedAt: timerEarlyAt,
        });
        expect(timerEarlySignal).toMatchObject({
          outcome: 'rejected',
          rejectionReason: 'early-signal',
          run: { version: 6 },
        });
        await expect(
          ledger.fireWorkflowTimer({
            runId,
            timerId: firstSuccess.nextTimer.timerId,
            actor: ACTOR,
            observedAt: firstSuccess.nextTimer.dueAt,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        const fired = await ledger.fireWorkflowTimer({
          runId,
          timerId: firstSuccess.nextTimer.timerId,
          actor: ACTOR,
          observedAt: timerEarlyAt + 1,
        });
        expect(fired).toMatchObject({
          applied: true,
          outcome: 'fired',
          run: { version: 7 },
          timer: { status: 'FIRED' },
          workflowCursor: {
            disposition: 'SIGNAL_WAITING',
            stepId: 'approval',
            stepIndex: 2,
          },
          nextSignalWait: { status: 'WAITING', signalId: 'approval' },
        });
        await expect(
          ledger.fireWorkflowTimer({
            runId,
            timerId: firstSuccess.nextTimer.timerId,
            actor: ACTOR,
            observedAt: timerEarlyAt + 1,
          }),
        ).resolves.toMatchObject({
          applied: false,
          outcome: 'fired',
          run: fired.run,
          workflowCursor: fired.workflowCursor,
          timer: fired.timer,
          nextSignalWait: fired.nextSignalWait,
        });
        await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });

        const unexpectedAt = timerEarlyAt + 6;
        const unexpected = await ledger.deliverWorkflowSignal({
          appId: APP_ID,
          runId,
          signalId: 'not-declared',
          deliveryId: 'wait-chain-unexpected',
          payload: { ignored: true },
          actor: ACTOR,
          observedAt: unexpectedAt,
        });
        expect(unexpected).toMatchObject({
          outcome: 'rejected',
          rejectionReason: 'unexpected-signal',
          run: { version: 8 },
        });
        const acceptedRequest = {
          appId: APP_ID,
          runId,
          signalId: 'approval',
          deliveryId: 'wait-chain-accepted',
          payload: { approved: true },
          actor: ACTOR,
          observedAt: unexpectedAt + 1,
        };
        await expect(
          ledger.deliverWorkflowSignal({
            ...acceptedRequest,
            observedAt: timerEarlyAt + 2,
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        const accepted = await ledger.deliverWorkflowSignal(acceptedRequest);
        expect(accepted).toMatchObject({
          applied: true,
          outcome: 'accepted',
          run: { version: 9 },
          signalWait: { status: 'CONSUMED' },
          signalDelivery: { status: 'ACCEPTED' },
          workflowCursor: {
            disposition: 'ACTIVITY_RUNNABLE',
            stepId: 'finish',
            stepIndex: 3,
          },
          nextInvocation: { activityId: 'finish', status: 'RUNNABLE' },
        });
        await expect(
          ledger.deliverWorkflowSignal(acceptedRequest),
        ).resolves.toMatchObject({
          applied: false,
          outcome: 'accepted',
          run: accepted.run,
          workflowCursor: accepted.workflowCursor,
          signalDelivery: accepted.signalDelivery,
          nextInvocation: accepted.nextInvocation,
        });
        await expect(
          ledger.deliverWorkflowSignal({
            ...acceptedRequest,
            payload: { approved: 'changed' },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);

        const late = await ledger.deliverWorkflowSignal({
          appId: APP_ID,
          runId,
          signalId: 'approval',
          deliveryId: 'wait-chain-late',
          payload: { approved: false },
          actor: ACTOR,
          observedAt: unexpectedAt + 2,
        });
        expect(late).toMatchObject({
          outcome: 'rejected',
          rejectionReason: 'late-signal',
          run: { version: 10 },
        });

        const finalActivity = await claimAndStartWorkflowActivity(
          ledger,
          {
            run: late.run,
            workflowCursor: accepted.workflowCursor,
            invocation: accepted.nextInvocation,
          },
          'wait-chain-final',
          unexpectedAt + 3,
        );
        const runningLate = await ledger.deliverWorkflowSignal({
          appId: APP_ID,
          runId,
          signalId: 'approval',
          deliveryId: 'wait-chain-late-running',
          payload: { approved: false },
          actor: ACTOR,
          observedAt: unexpectedAt + 5,
        });
        expect(runningLate).toMatchObject({
          outcome: 'rejected',
          rejectionReason: 'late-signal',
          run: { version: 13 },
        });
        const completed = await ledger.commitVerifiedWorkflowActivityTerminal({
          runId,
          invocationId: finalActivity.started.invocation.invocationId,
          cursor: cursorGuard(finalActivity.started.workflowCursor),
          attemptId: finalActivity.started.attempt.attemptId,
          fencingToken: finalActivity.started.attempt.fencingToken,
          generation: finalActivity.started.attempt.generation,
          expectedVersion: runningLate.run.version,
          transitionId: 'wait-chain-final-success',
          evidence: completedEvidence(finalActivity.started.startFrame, {
            persisted: true,
          }),
          actor: ACTOR,
          observedAt: unexpectedAt + 6,
        });
        expect(completed).toMatchObject({
          run: { status: RunStatus.COMPLETED, version: 14 },
          workflowCursor: { disposition: 'COMPLETED' },
        });
        await expect(
          ledger.readRunOutput({ appId: APP_ID, runId }),
        ).resolves.toEqual({
          scope: {
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          },
          snapshot: {
            runKind: 'workflow',
            status: RunStatus.COMPLETED,
            version: completed.run.version,
            lastSequence: completed.run.lastSequence,
          },
          outputs: [
            {
              stepId: 'produce',
              stepIndex: 0,
              value: { produced: true },
            },
            {
              stepId: 'pause',
              stepIndex: 1,
              value: {
                scheduledAt: firstSuccess.nextTimer.scheduledAt,
                dueAt: firstSuccess.nextTimer.dueAt,
                firedAt: fired.timer.firedAt,
              },
            },
            {
              stepId: 'approval',
              stepIndex: 2,
              value: { approved: true },
            },
            {
              stepId: 'finish',
              stepIndex: 3,
              value: { persisted: true },
            },
          ],
          terminal: {
            type: 'completed',
            result: { persisted: true },
          },
        });
        await expect(
          ledger.commitVerifiedWorkflowActivityTerminal(firstSuccessRequest),
        ).resolves.toMatchObject({
          applied: false,
          run: firstSuccess.run,
          workflowCursor: firstSuccess.workflowCursor,
          nextTimer: firstSuccess.nextTimer,
          outputRef: firstSuccess.outputRef,
        });
        await expect(
          ledger.getWorkflowTimer(runId, firstSuccess.nextTimer.timerId),
        ).resolves.toEqual(fired.timer);
        await expect(
          ledger.getWorkflowSignalWait(
            runId,
            fired.nextSignalWait.signalWaitId,
          ),
        ).resolves.toEqual(accepted.signalWait);
        await expect(
          ledger.getWorkflowSignalDelivery(runId, acceptedRequest.deliveryId),
        ).resolves.toEqual(accepted.signalDelivery);
        await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });
        await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
          run: completed.run,
          workflowCursor: completed.workflowCursor,
          timers: [fired.timer],
          signalWaits: [accepted.signalWait],
          signalDeliveries: expect.arrayContaining([
            earlyBeforeSuccess.signalDelivery,
            timerEarlySignal.signalDelivery,
            unexpected.signalDelivery,
            accepted.signalDelivery,
            late.signalDelivery,
            runningLate.signalDelivery,
          ]),
        });

        await rewriteRejectedSignalReason(
          db,
          tableName,
          runId,
          'wait-chain-early-before-success',
          'late-signal',
        );
        await expect(ledger.rebuildRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    }, 30_000);

    test('uses terminal precedence for declared future signals', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-terminal-signal';
      const runId = workflowRunId(`${adapter.name}-terminal-signal`);
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const created = await ledger.createWorkflowRun(
          workflowRun(runId, [
            FIRST_STEP,
            { id: 'future-signal', kind: 'signal' },
          ]),
        );
        const activity = await claimAndStartWorkflowActivity(
          ledger,
          created,
          'terminal-signal',
          CREATED_AT + 1,
        );
        const failed = await ledger.commitVerifiedWorkflowActivityTerminal({
          runId,
          invocationId: activity.started.invocation.invocationId,
          cursor: cursorGuard(activity.started.workflowCursor),
          attemptId: activity.started.attempt.attemptId,
          fencingToken: activity.started.attempt.fencingToken,
          generation: activity.started.attempt.generation,
          expectedVersion: activity.started.run.version,
          transitionId: 'terminal-signal-failed',
          evidence: failedEvidence(activity.started.startFrame, 'terminal'),
          actor: ACTOR,
          observedAt: CREATED_AT + 3,
        });
        expect(failed.run.status).toBe(RunStatus.FAILED);

        const rejected = await ledger.deliverWorkflowSignal({
          appId: APP_ID,
          runId,
          signalId: 'future-signal',
          deliveryId: 'terminal-future-signal',
          payload: { tooLate: true },
          actor: ACTOR,
          observedAt: CREATED_AT + 4,
        });
        expect(rejected).toMatchObject({
          applied: true,
          outcome: 'rejected',
          rejectionReason: 'late-signal',
          run: { status: RunStatus.FAILED },
          signalDelivery: {
            status: 'REJECTED',
            rejectionReason: 'late-signal',
          },
        });
        await expect(
          ledger.readRunOutput({ appId: APP_ID, runId }),
        ).resolves.toEqual({
          scope: {
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          },
          snapshot: {
            runKind: 'workflow',
            status: RunStatus.FAILED,
            version: rejected.run.version,
            lastSequence: rejected.run.lastSequence,
          },
          outputs: [],
          terminal: {
            type: 'failed',
            error: {
              code: 'application-failed',
              name: 'ApplicationFailure',
              message: 'The workflow activity failed as requested by the test.',
              details: { marker: 'terminal' },
            },
          },
        });
      } finally {
        await cleanup();
      }
    });

    test('returns the durable signal decision when an exact delivery race changes classification', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-signal-race';
      const runId = workflowRunId(`${adapter.name}-signal-race`);
      try {
        const directLedger = createExecutionLedger({ db, tableName });
        const created = await directLedger.createWorkflowRun(
          workflowRun(runId, [{ id: 'approval', kind: 'signal' }]),
        );
        const request = {
          appId: APP_ID,
          runId,
          signalId: 'approval',
          deliveryId: 'classification-race',
          payload: { approved: true },
          actor: ACTOR,
          observedAt: CREATED_AT + 3,
        };
        let injectWinner = true;
        const racingDb = {
          ...db,
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing accepted transaction. */
          async transactionWrite(params) {
            if (injectWinner) {
              injectWinner = false;
              await directLedger.requestWorkflowRunCancellation({
                runId,
                cursor: cursorGuard(created.workflowCursor),
                expectedVersion: created.run.version,
                transitionId: 'classification-race-cancel',
                requestId: 'classification-race-cancel-request',
                reason: {
                  code: 'test-cancellation',
                  name: 'TestCancellation',
                  message: 'Cancel the wait before the racing signal commits.',
                  details: {},
                },
                signalWaitId: created.signalWait.signalWaitId,
                expectedSignalWaitVersion: created.signalWait.version,
                actor: ACTOR,
                observedAt: CREATED_AT + 1,
              });
              await directLedger.deliverWorkflowSignal({
                ...request,
                observedAt: CREATED_AT + 2,
              });
            }
            return await db.transactionWrite(params);
          },
        };
        const racingLedger = createExecutionLedger({
          db: racingDb,
          tableName,
        });
        const result = await racingLedger.deliverWorkflowSignal(request);
        expect(result).toMatchObject({
          applied: false,
          outcome: 'rejected',
          rejectionReason: 'late-signal',
          run: { status: RunStatus.CANCELLED, version: 3 },
          signalDelivery: {
            status: 'REJECTED',
            rejectionReason: 'late-signal',
          },
        });
        expect(result).not.toHaveProperty('nextInvocation');
        await expect(directLedger.getEvents(runId)).resolves.toHaveLength(3);
        await expect(
          directLedger.getWorkflowSignalWait(
            runId,
            created.signalWait.signalWaitId,
          ),
        ).resolves.toMatchObject({ status: 'CANCELLED' });
      } finally {
        await cleanup();
      }
    });
  });
}
