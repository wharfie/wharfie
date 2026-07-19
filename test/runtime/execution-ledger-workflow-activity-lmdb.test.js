/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLMDBDB } from '../helpers/db-adapters.js';
import { ActivityProtocolTranscriptValidator } from '../../src/core/runtime/activity-protocol.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { ExecutionLedgerReadyWorkKind } from '../../src/core/lib/ledger/ready-work.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';

const APP_ID = 'workflow-activity-lmdb-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-activity-lmdb-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'main';
const FIRST_STEP_ID = 'prepare';
const SECOND_STEP_ID = 'finish';
const FIRST_ACTIVITY_ID = 'prepare';
const SECOND_ACTIVITY_ID = 'finish';
const OBSERVED_AT = 1_700_000_000_000;

function workflowDefinition() {
  return {
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
  };
}

/**
 * @param {Record<string, any>} cursor - Current workflow cursor.
 * @returns {{version: number, continuationId: string, stepId: string, stepIndex: number}} Exact orchestration guard.
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
 * @param {Readonly<Record<string, any>>} startFrame - Durable host start frame.
 * @param {any} result - JSON activity result.
 * @returns {Record<string, any>} Complete verified activity evidence.
 */
function completedEvidence(startFrame, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(startFrame);
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

/**
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Open ledger.
 * @returns {Promise<Record<string, any>>} All currently eligible work.
 */
async function listReadyWork(ledger) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId: REVISION_ID,
    observedAt: Number.MAX_SAFE_INTEGER,
    limit: 100,
  });
}

describe('LMDB workflow activity persistence', () => {
  test('recovers a started activity and durably installs its successor across reopens', async () => {
    const databaseDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-activity-lmdb-'),
    );
    const payloadDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-activity-payload-'),
    );
    const tableName = 'execution-ledger-workflow-activity-lmdb';
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'workflow-activity-lmdb-reopen',
    });
    const payloadStore = createLocalExecutionPayloadStore({
      path: payloadDirectory,
      storeId: 'workflow-activity-lmdb',
    });
    let db = await createLMDBDB(databaseDirectory);
    let closed = false;
    try {
      let ledger = createExecutionLedger({ db, tableName, payloadStore });
      const created = await ledger.createWorkflowRun({
        runId,
        appId: APP_ID,
        revisionId: REVISION_ID,
        workflowId: WORKFLOW_ID,
        definition: workflowDefinition(),
        input: { name: 'Ada' },
        callerMetadata: { source: 'workflow-activity-lmdb-test' },
        transitionId: 'create-workflow-activity-lmdb',
        actor: { kind: 'submitter', id: 'workflow-activity-lmdb-test' },
        observedAt: OBSERVED_AT,
      });
      const claimed = await ledger.claimWorkflowActivity({
        runId,
        invocationId: created.workflowCursor.invocationId,
        cursor: cursorGuard(created.workflowCursor),
        fencingToken: 'first-activity-fence',
        expectedGeneration: 0,
        expectedVersion: created.run.version,
        transitionId: 'claim-first-workflow-activity',
        observedAt: OBSERVED_AT + 1,
      });
      const started = await ledger.markWorkflowActivityStarted({
        runId,
        invocationId: claimed.workflowCursor.invocationId,
        cursor: cursorGuard(claimed.workflowCursor),
        attemptId: claimed.attempt.attemptId,
        fencingToken: 'first-activity-fence',
        generation: claimed.attempt.generation,
        expectedVersion: claimed.run.version,
        transitionId: 'start-first-workflow-activity',
        observedAt: OBSERVED_AT + 2,
      });
      expect(started).toMatchObject({
        applied: true,
        dispatchAuthorized: true,
        workflowCursor: {
          stepId: FIRST_STEP_ID,
          stepIndex: 0,
          disposition: 'ACTIVITY_RUNNING',
        },
        attempt: { status: 'STARTED' },
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });

      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        run: { runId, version: started.run.version, status: 'RUNNING' },
        workflowCursor: started.workflowCursor,
        attempts: [
          {
            attemptId: started.attempt.attemptId,
            status: 'STARTED',
          },
        ],
      });
      const firstResult = { prepared: true, name: 'Ada' };
      const succeeded = await ledger.commitVerifiedWorkflowActivitySuccess({
        runId,
        invocationId: started.workflowCursor.invocationId,
        cursor: cursorGuard(started.workflowCursor),
        attemptId: started.attempt.attemptId,
        fencingToken: 'first-activity-fence',
        generation: started.attempt.generation,
        expectedVersion: started.run.version,
        transitionId: 'succeed-first-workflow-activity',
        evidence: completedEvidence(started.startFrame, firstResult),
        observedAt: OBSERVED_AT + 3,
      });
      expect(succeeded).toMatchObject({
        applied: true,
        run: { status: 'RUNNING' },
        invocation: {
          invocationId: started.workflowCursor.invocationId,
          status: 'COMPLETED',
        },
        attempt: {
          attemptId: started.attempt.attemptId,
          status: 'COMPLETED',
        },
        workflowCursor: {
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          disposition: 'ACTIVITY_RUNNABLE',
          outputs: [
            {
              stepId: FIRST_STEP_ID,
              stepIndex: 0,
              outputRef: succeeded.outputRef,
            },
          ],
        },
        nextInvocation: {
          activityId: SECOND_ACTIVITY_ID,
          status: 'RUNNABLE',
          generation: 0,
        },
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });

      const rebuilt = await ledger.rebuildRun(runId);
      expect(rebuilt).not.toBeNull();
      if (!rebuilt) throw new Error('Expected the workflow run to rebuild.');
      expect(rebuilt).toMatchObject({
        run: {
          runId,
          version: succeeded.run.version,
          status: 'RUNNING',
        },
        workflowCursor: succeeded.workflowCursor,
        invocations: expect.arrayContaining([
          expect.objectContaining({
            invocationId: succeeded.invocation.invocationId,
            status: 'COMPLETED',
          }),
          expect.objectContaining({
            invocationId: succeeded.nextInvocation.invocationId,
            activityId: SECOND_ACTIVITY_ID,
            status: 'RUNNABLE',
            generation: 0,
          }),
        ]),
        attempts: [
          expect.objectContaining({
            attemptId: started.attempt.attemptId,
            status: 'COMPLETED',
          }),
        ],
      });
      await expect(
        payloadStore.readJson(succeeded.nextInvocation.requestRef),
      ).resolves.toEqual({
        input: firstResult,
        callerMetadata: { source: 'workflow-activity-lmdb-test' },
      });
      await expect(listReadyWork(ledger)).resolves.toEqual({
        items: [
          expect.objectContaining({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            runVersion: succeeded.run.version,
            lastSequence: succeeded.run.lastSequence,
            invocationId: succeeded.nextInvocation.invocationId,
            generation: 0,
            cursorVersion: succeeded.workflowCursor.version,
            continuationId: succeeded.workflowCursor.continuationId,
            stepId: SECOND_STEP_ID,
            stepIndex: 1,
          }),
        ],
      });

      const successorClaim = await ledger.claimWorkflowActivity({
        runId,
        invocationId: succeeded.nextInvocation.invocationId,
        cursor: cursorGuard(rebuilt.workflowCursor),
        fencingToken: 'second-activity-fence',
        expectedGeneration: 0,
        expectedVersion: rebuilt.run.version,
        transitionId: 'claim-second-workflow-activity',
        observedAt: OBSERVED_AT + 4,
      });
      expect(successorClaim).toMatchObject({
        applied: true,
        run: { version: succeeded.run.version + 1, status: 'RUNNING' },
        invocation: {
          invocationId: succeeded.nextInvocation.invocationId,
          status: 'RUNNING',
          generation: 1,
        },
        workflowCursor: {
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          disposition: 'ACTIVITY_RUNNING',
          version: succeeded.workflowCursor.version + 1,
        },
        attempt: { status: 'CLAIMED', generation: 1 },
      });
      await expect(listReadyWork(ledger)).resolves.toEqual({
        items: [
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.RECOVERY,
            invocationId: succeeded.nextInvocation.invocationId,
            attemptId: successorClaim.attempt.attemptId,
            generation: 1,
            cursorVersion: successorClaim.workflowCursor.version,
            continuationId: successorClaim.workflowCursor.continuationId,
            stepId: SECOND_STEP_ID,
            stepIndex: 1,
          }),
        ],
      });
      await expect(ledger.getEvents(runId)).resolves.toHaveLength(5);
    } finally {
      if (!closed) await db.close();
      rmSync(databaseDirectory, { recursive: true, force: true });
      rmSync(payloadDirectory, { recursive: true, force: true });
    }
  });
});
