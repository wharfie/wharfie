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
 * @param {Readonly<Record<string, any>>} startFrame - Durable host start frame.
 * @param {'failed'|'protocol-failed'} type - Supported workflow failure terminal.
 * @returns {Record<string, any>} Complete verified failure evidence.
 */
function failedEvidence(startFrame, type) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(startFrame);
  const terminal = transcript.acceptComponentFrame({
    protocol: 'wharfie.activity',
    protocolVersion: 1,
    type,
    attemptId: acceptedStart.attemptId,
    sequence: 1,
    error: {
      code:
        type === 'failed'
          ? 'second-step-failed'
          : 'second-step-protocol-failed',
      name: type === 'failed' ? 'SecondStepError' : 'ActivityProtocolFailure',
      message:
        type === 'failed'
          ? 'The second workflow activity failed.'
          : 'The second workflow activity violated its protocol.',
      details: { stepId: SECOND_STEP_ID },
    },
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
 * Advance a two-step workflow through one durable output and the second
 * activity's STARTED boundary.
 * @param {ReturnType<typeof createExecutionLedger>} ledger - Open ledger.
 * @param {string} runId - Workflow run ID.
 * @param {string} label - Stable transition identity prefix.
 * @param {string} name - Logical workflow input.
 * @returns {Promise<{firstCompleted: Record<string, any>, secondStarted: Record<string, any>}>} Second-step authority.
 */
async function startSecondWorkflowActivity(ledger, runId, label, name) {
  const created = await ledger.createWorkflowRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: workflowDefinition(),
    input: { name },
    callerMetadata: { source: `${label}-test` },
    transitionId: `${label}-create`,
    actor: { kind: 'submitter', id: `${label}-test` },
    observedAt: OBSERVED_AT,
  });
  const firstClaimed = await ledger.claimWorkflowActivity({
    runId,
    invocationId: created.invocation.invocationId,
    cursor: cursorGuard(created.workflowCursor),
    fencingToken: `${label}-first-fence`,
    expectedGeneration: 0,
    expectedVersion: created.run.version,
    transitionId: `${label}-claim-first`,
    observedAt: OBSERVED_AT + 1,
  });
  const firstStarted = await ledger.markWorkflowActivityStarted({
    runId,
    invocationId: firstClaimed.invocation.invocationId,
    cursor: cursorGuard(firstClaimed.workflowCursor),
    attemptId: firstClaimed.attempt.attemptId,
    fencingToken: firstClaimed.attempt.fencingToken,
    generation: firstClaimed.attempt.generation,
    expectedVersion: firstClaimed.run.version,
    transitionId: `${label}-start-first`,
    observedAt: OBSERVED_AT + 2,
  });
  const firstCompleted = await ledger.commitVerifiedWorkflowActivityTerminal({
    runId,
    invocationId: firstStarted.invocation.invocationId,
    cursor: cursorGuard(firstStarted.workflowCursor),
    attemptId: firstStarted.attempt.attemptId,
    fencingToken: firstStarted.attempt.fencingToken,
    generation: firstStarted.attempt.generation,
    expectedVersion: firstStarted.run.version,
    transitionId: `${label}-complete-first`,
    evidence: completedEvidence(firstStarted.startFrame, {
      prepared: true,
      name,
    }),
    observedAt: OBSERVED_AT + 3,
  });
  const secondClaimed = await ledger.claimWorkflowActivity({
    runId,
    invocationId: firstCompleted.nextInvocation.invocationId,
    cursor: cursorGuard(firstCompleted.workflowCursor),
    fencingToken: `${label}-second-fence`,
    expectedGeneration: 0,
    expectedVersion: firstCompleted.run.version,
    transitionId: `${label}-claim-second`,
    observedAt: OBSERVED_AT + 4,
  });
  const secondStarted = await ledger.markWorkflowActivityStarted({
    runId,
    invocationId: secondClaimed.invocation.invocationId,
    cursor: cursorGuard(secondClaimed.workflowCursor),
    attemptId: secondClaimed.attempt.attemptId,
    fencingToken: secondClaimed.attempt.fencingToken,
    generation: secondClaimed.attempt.generation,
    expectedVersion: secondClaimed.run.version,
    transitionId: `${label}-start-second`,
    observedAt: OBSERVED_AT + 5,
  });
  return { firstCompleted, secondStarted };
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
      const succeeded = await ledger.commitVerifiedWorkflowActivityTerminal({
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

  test('releases a reopened claim, blocks a reopened started attempt, and reconciles it durably', async () => {
    const databaseDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-recovery-lmdb-'),
    );
    const payloadDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-recovery-payload-'),
    );
    const tableName = 'execution-ledger-workflow-recovery-lmdb';
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'workflow-recovery-lmdb-reopen',
    });
    const payloadStore = createLocalExecutionPayloadStore({
      path: payloadDirectory,
      storeId: 'workflow-recovery-lmdb',
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
        input: { name: 'Grace' },
        callerMetadata: { source: 'workflow-recovery-lmdb-test' },
        transitionId: 'create-workflow-recovery-lmdb',
        actor: { kind: 'submitter', id: 'workflow-recovery-lmdb-test' },
        observedAt: OBSERVED_AT,
      });
      const firstClaim = await ledger.claimWorkflowActivity({
        runId,
        invocationId: created.invocation.invocationId,
        cursor: cursorGuard(created.workflowCursor),
        fencingToken: 'recovery-first-fence',
        expectedGeneration: 0,
        expectedVersion: created.run.version,
        transitionId: 'claim-workflow-before-release',
        observedAt: OBSERVED_AT + 1,
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        workflowCursor: firstClaim.workflowCursor,
        attempts: [
          expect.objectContaining({
            attemptId: firstClaim.attempt.attemptId,
            status: 'CLAIMED',
          }),
        ],
      });

      const released = await ledger.abandonUnstartedWorkflowActivityAttempt({
        runId,
        invocationId: firstClaim.invocation.invocationId,
        cursor: cursorGuard(firstClaim.workflowCursor),
        attemptId: firstClaim.attempt.attemptId,
        fencingToken: firstClaim.attempt.fencingToken,
        generation: firstClaim.attempt.generation,
        expectedVersion: firstClaim.run.version,
        transitionId: 'release-reopened-workflow-claim',
        reason: { code: 'coordinator-reopened' },
        observedAt: OBSERVED_AT + 2,
      });
      expect(released).toMatchObject({
        run: { status: 'RUNNING', version: 3 },
        invocation: { status: 'RUNNABLE', generation: 1 },
        attempt: {
          attemptId: firstClaim.attempt.attemptId,
          status: 'ABANDONED',
        },
        workflowCursor: {
          disposition: 'ACTIVITY_RUNNABLE',
          stepId: FIRST_STEP_ID,
          version: 3,
        },
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      const rebuiltReleased = await ledger.rebuildRun(runId);
      expect(rebuiltReleased).not.toBeNull();
      if (!rebuiltReleased) {
        throw new Error('Expected the released workflow to rebuild.');
      }
      expect(rebuiltReleased).toMatchObject({
        run: released.run,
        workflowCursor: released.workflowCursor,
        attempts: [released.attempt],
      });
      await expect(listReadyWork(ledger)).resolves.toEqual({
        items: [
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            runVersion: released.run.version,
            cursorVersion: released.workflowCursor.version,
            invocationId: released.invocation.invocationId,
            generation: 1,
            stepId: FIRST_STEP_ID,
          }),
        ],
      });

      const secondClaim = await ledger.claimWorkflowActivity({
        runId,
        invocationId: released.invocation.invocationId,
        cursor: cursorGuard(rebuiltReleased.workflowCursor),
        fencingToken: 'recovery-second-fence',
        expectedGeneration: released.invocation.generation,
        expectedVersion: rebuiltReleased.run.version,
        transitionId: 'reclaim-workflow-after-release',
        observedAt: OBSERVED_AT + 3,
      });
      expect(secondClaim).toMatchObject({
        invocation: { status: 'RUNNING', generation: 2 },
        attempt: { status: 'CLAIMED', generation: 2 },
        workflowCursor: { disposition: 'ACTIVITY_RUNNING', version: 4 },
      });
      const started = await ledger.markWorkflowActivityStarted({
        runId,
        invocationId: secondClaim.invocation.invocationId,
        cursor: cursorGuard(secondClaim.workflowCursor),
        attemptId: secondClaim.attempt.attemptId,
        fencingToken: secondClaim.attempt.fencingToken,
        generation: secondClaim.attempt.generation,
        expectedVersion: secondClaim.run.version,
        transitionId: 'start-reclaimed-workflow-attempt',
        observedAt: OBSERVED_AT + 4,
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        workflowCursor: started.workflowCursor,
        attempts: expect.arrayContaining([
          released.attempt,
          expect.objectContaining({
            attemptId: started.attempt.attemptId,
            status: 'STARTED',
          }),
        ]),
      });

      const uncertain = await ledger.markWorkflowActivityAttemptUncertain({
        runId,
        invocationId: started.invocation.invocationId,
        cursor: cursorGuard(started.workflowCursor),
        attemptId: started.attempt.attemptId,
        fencingToken: started.attempt.fencingToken,
        generation: started.attempt.generation,
        expectedVersion: started.run.version,
        transitionId: 'block-reopened-started-workflow-attempt',
        reason: { code: 'runner-outcome-lost-after-reopen' },
        observedAt: OBSERVED_AT + 5,
      });
      expect(uncertain).toMatchObject({
        run: { status: 'BLOCKED', version: 6 },
        invocation: { status: 'UNCERTAIN' },
        attempt: { status: 'ABANDONED' },
        workflowCursor: {
          disposition: 'ACTIVITY_UNCERTAIN',
          version: 6,
        },
      });
      await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });
      const uncertaintyEvent = (await ledger.getEvents(runId)).find(
        ({ type }) => type === 'workflow-activity-became-uncertain',
      );
      expect(uncertaintyEvent).toBeDefined();
      if (!uncertaintyEvent) {
        throw new Error('Expected the durable workflow uncertainty event.');
      }

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        run: uncertain.run,
        workflowCursor: uncertain.workflowCursor,
        attempts: expect.arrayContaining([released.attempt, uncertain.attempt]),
      });
      const retainedUncertainAttempt = await ledger.getAttempt(
        runId,
        uncertain.invocation.invocationId,
        uncertain.attempt.attemptId,
      );
      const recoveredResult = { recovered: true, name: 'Grace' };
      const reconciled = await ledger.reconcileUncertainWorkflowActivityAttempt(
        {
          runId,
          invocationId: uncertain.invocation.invocationId,
          cursor: cursorGuard(uncertain.workflowCursor),
          attemptId: uncertain.attempt.attemptId,
          fencingToken: uncertain.attempt.fencingToken,
          generation: uncertain.attempt.generation,
          coordinatorEpoch: uncertain.attempt.coordinatorEpoch,
          expectedVersion: uncertain.run.version,
          uncertaintyEventId: uncertaintyEvent.event_id,
          uncertaintySequence: uncertaintyEvent.sequence,
          transitionId: 'reconcile-reopened-uncertain-workflow-attempt',
          reconciliationId: 'reopened-uncertain-workflow-decision',
          reason: { code: 'stopped-runner-transcript-recovered' },
          evidence: completedEvidence(started.startFrame, recoveredResult),
          observedAt: OBSERVED_AT + 6,
        },
      );
      expect(reconciled).toMatchObject({
        run: { status: 'RUNNING', version: 7 },
        invocation: {
          invocationId: uncertain.invocation.invocationId,
          status: 'COMPLETED',
        },
        attempt: retainedUncertainAttempt,
        workflowCursor: {
          disposition: 'ACTIVITY_RUNNABLE',
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          version: 7,
        },
        nextInvocation: {
          activityId: SECOND_ACTIVITY_ID,
          status: 'RUNNABLE',
          generation: 0,
        },
      });
      expect(reconciled.attempt).toEqual(retainedUncertainAttempt);

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      const rebuiltReconciled = await ledger.rebuildRun(runId);
      expect(rebuiltReconciled).not.toBeNull();
      if (!rebuiltReconciled) {
        throw new Error('Expected the reconciled workflow to rebuild.');
      }
      expect(rebuiltReconciled).toMatchObject({
        run: reconciled.run,
        workflowCursor: reconciled.workflowCursor,
        invocations: expect.arrayContaining([
          expect.objectContaining({
            invocationId: reconciled.invocation.invocationId,
            status: 'COMPLETED',
          }),
          expect.objectContaining({
            invocationId: reconciled.nextInvocation.invocationId,
            status: 'RUNNABLE',
          }),
        ]),
        attempts: expect.arrayContaining([
          released.attempt,
          retainedUncertainAttempt,
        ]),
      });
      await expect(
        payloadStore.readJson(reconciled.outputRef),
      ).resolves.toEqual({
        schemaVersion: 1,
        kind: 'workflowOutput',
        value: recoveredResult,
      });
      await expect(
        payloadStore.readJson(reconciled.nextInvocation.requestRef),
      ).resolves.toEqual({
        input: recoveredResult,
        callerMetadata: { source: 'workflow-recovery-lmdb-test' },
      });
      await expect(listReadyWork(ledger)).resolves.toEqual({
        items: [
          expect.objectContaining({
            runId,
            kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
            runVersion: reconciled.run.version,
            cursorVersion: reconciled.workflowCursor.version,
            invocationId: reconciled.nextInvocation.invocationId,
            generation: 0,
            stepId: SECOND_STEP_ID,
            stepIndex: 1,
          }),
        ],
      });
      const successorClaim = await ledger.claimWorkflowActivity({
        runId,
        invocationId: reconciled.nextInvocation.invocationId,
        cursor: cursorGuard(rebuiltReconciled.workflowCursor),
        fencingToken: 'reconciled-successor-fence',
        expectedGeneration: 0,
        expectedVersion: rebuiltReconciled.run.version,
        transitionId: 'claim-reconciled-successor',
        observedAt: OBSERVED_AT + 7,
      });
      expect(successorClaim).toMatchObject({
        run: { version: 8, status: 'RUNNING' },
        invocation: { status: 'RUNNING', generation: 1 },
        attempt: { status: 'CLAIMED', generation: 1 },
        workflowCursor: {
          disposition: 'ACTIVITY_RUNNING',
          stepId: SECOND_STEP_ID,
          version: 8,
        },
      });
      await expect(ledger.getEvents(runId)).resolves.toHaveLength(8);
    } finally {
      if (!closed) await db.close();
      rmSync(databaseDirectory, { recursive: true, force: true });
      rmSync(payloadDirectory, { recursive: true, force: true });
    }
  });

  test('persists a direct second-step failed terminal without extending its output prefix', async () => {
    const databaseDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-failed-lmdb-'),
    );
    const payloadDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-failed-payload-'),
    );
    const tableName = 'execution-ledger-workflow-failed-lmdb';
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'workflow-failed-lmdb-reopen',
    });
    const payloadStore = createLocalExecutionPayloadStore({
      path: payloadDirectory,
      storeId: 'workflow-failed-lmdb',
    });
    let db = await createLMDBDB(databaseDirectory);
    let closed = false;
    try {
      let ledger = createExecutionLedger({ db, tableName, payloadStore });
      const { firstCompleted, secondStarted } =
        await startSecondWorkflowActivity(
          ledger,
          runId,
          'workflow-failed-lmdb',
          'Margaret',
        );
      const priorOutputs = structuredClone(
        firstCompleted.workflowCursor.outputs,
      );
      expect(priorOutputs).toHaveLength(1);
      expect(secondStarted).toMatchObject({
        run: { status: 'RUNNING' },
        invocation: {
          invocationId: firstCompleted.nextInvocation.invocationId,
          status: 'RUNNING',
        },
        attempt: { status: 'STARTED' },
        workflowCursor: {
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          disposition: 'ACTIVITY_RUNNING',
          outputs: priorOutputs,
        },
      });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        run: secondStarted.run,
        workflowCursor: secondStarted.workflowCursor,
        attempts: expect.arrayContaining([secondStarted.attempt]),
      });

      const evidence = failedEvidence(secondStarted.startFrame, 'failed');
      const failureRequest = {
        runId,
        invocationId: secondStarted.invocation.invocationId,
        cursor: cursorGuard(secondStarted.workflowCursor),
        attemptId: secondStarted.attempt.attemptId,
        fencingToken: secondStarted.attempt.fencingToken,
        generation: secondStarted.attempt.generation,
        expectedVersion: secondStarted.run.version,
        transitionId: 'workflow-failed-lmdb-fail-second',
        evidence,
        observedAt: OBSERVED_AT + 6,
      };
      const failed =
        await ledger.commitVerifiedWorkflowActivityTerminal(failureRequest);
      expect(failed).toMatchObject({
        applied: true,
        receipt: { type: 'workflow-activity-failed' },
        run: { status: 'FAILED' },
        invocation: {
          invocationId: secondStarted.invocation.invocationId,
          status: 'FAILED',
          terminal: {
            type: 'failed',
            attemptId: secondStarted.attempt.attemptId,
          },
        },
        attempt: {
          attemptId: secondStarted.attempt.attemptId,
          status: 'FAILED',
          terminal: {
            type: 'failed',
            attemptId: secondStarted.attempt.attemptId,
          },
          evidenceRef: {
            payloadSchema: 'wharfie.execution.activity-evidence.v1',
          },
        },
        workflowCursor: {
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          disposition: 'FAILED',
          outputs: priorOutputs,
        },
      });
      expect(failed.workflowCursor.outputs).toEqual(priorOutputs);
      expect(failed).not.toHaveProperty('outputRef');
      expect(failed).not.toHaveProperty('nextInvocation');
      await expect(
        payloadStore.readJson(failed.attempt.evidenceRef),
      ).resolves.toEqual(evidence);
      await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      const rebuilt = await ledger.rebuildRun(runId);
      expect(rebuilt).not.toBeNull();
      if (!rebuilt) throw new Error('Expected the failed workflow to rebuild.');
      expect(rebuilt.run).toEqual(failed.run);
      expect(rebuilt.workflowCursor).toEqual(failed.workflowCursor);
      expect(rebuilt.workflowCursor).toMatchObject({
        disposition: 'FAILED',
        outputs: priorOutputs,
      });
      expect(rebuilt.invocations).toHaveLength(2);
      const rebuiltInvocations = /** @type {Record<string, any>[]} */ (
        rebuilt.invocations
      );
      const rebuiltAttempts = /** @type {Record<string, any>[]} */ (
        rebuilt.attempts
      );
      expect(
        rebuiltInvocations.find(
          ({ invocationId }) =>
            invocationId === secondStarted.invocation.invocationId,
        ),
      ).toEqual(failed.invocation);
      expect(
        rebuiltAttempts.find(
          ({ attemptId }) => attemptId === secondStarted.attempt.attemptId,
        ),
      ).toEqual(failed.attempt);
      await expect(
        ledger.getAttempt(
          runId,
          secondStarted.invocation.invocationId,
          secondStarted.attempt.attemptId,
        ),
      ).resolves.toEqual(failed.attempt);
      await expect(
        payloadStore.readJson(failed.attempt.evidenceRef),
      ).resolves.toEqual(evidence);
      await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });

      const replayed =
        await ledger.commitVerifiedWorkflowActivityTerminal(failureRequest);
      expect(replayed).toEqual({ ...failed, applied: false });
      expect(replayed).not.toHaveProperty('outputRef');
      expect(replayed).not.toHaveProperty('nextInvocation');
    } finally {
      if (!closed) await db.close();
      rmSync(databaseDirectory, { recursive: true, force: true });
      rmSync(payloadDirectory, { recursive: true, force: true });
    }
  });

  test('persists reconciled second-step protocol failure without rewriting its abandoned attempt', async () => {
    const databaseDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-protocol-failed-lmdb-'),
    );
    const payloadDirectory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-protocol-failed-payload-'),
    );
    const tableName = 'execution-ledger-workflow-protocol-failed-lmdb';
    const runId = createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: 'workflow-protocol-failed-lmdb-reopen',
    });
    const payloadStore = createLocalExecutionPayloadStore({
      path: payloadDirectory,
      storeId: 'workflow-protocol-failed-lmdb',
    });
    let db = await createLMDBDB(databaseDirectory);
    let closed = false;
    try {
      let ledger = createExecutionLedger({ db, tableName, payloadStore });
      const { firstCompleted, secondStarted } =
        await startSecondWorkflowActivity(
          ledger,
          runId,
          'workflow-protocol-failed-lmdb',
          'Frances',
        );
      const priorOutputs = structuredClone(
        firstCompleted.workflowCursor.outputs,
      );
      expect(priorOutputs).toHaveLength(1);
      const uncertain = await ledger.markWorkflowActivityAttemptUncertain({
        runId,
        invocationId: secondStarted.invocation.invocationId,
        cursor: cursorGuard(secondStarted.workflowCursor),
        attemptId: secondStarted.attempt.attemptId,
        fencingToken: secondStarted.attempt.fencingToken,
        generation: secondStarted.attempt.generation,
        expectedVersion: secondStarted.run.version,
        transitionId: 'workflow-protocol-failed-lmdb-uncertain-second',
        reason: { code: 'second-step-runner-outcome-lost' },
        observedAt: OBSERVED_AT + 6,
      });
      const retainedAttempt = structuredClone(uncertain.attempt);
      expect(retainedAttempt).toMatchObject({ status: 'ABANDONED' });
      expect(retainedAttempt).not.toHaveProperty('terminal');
      expect(retainedAttempt).not.toHaveProperty('evidenceRef');
      expect(uncertain).toMatchObject({
        run: { status: 'BLOCKED' },
        invocation: { status: 'UNCERTAIN' },
        workflowCursor: {
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          disposition: 'ACTIVITY_UNCERTAIN',
          outputs: priorOutputs,
        },
      });
      const uncertaintyEvent = (await ledger.getEvents(runId)).find(
        ({ type }) => type === 'workflow-activity-became-uncertain',
      );
      expect(uncertaintyEvent).toBeDefined();
      if (!uncertaintyEvent) {
        throw new Error('Expected the second-step uncertainty event.');
      }

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
        run: uncertain.run,
        workflowCursor: uncertain.workflowCursor,
        attempts: expect.arrayContaining([retainedAttempt]),
      });
      await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });

      const evidence = failedEvidence(
        secondStarted.startFrame,
        'protocol-failed',
      );
      const reconciliationRequest = {
        runId,
        invocationId: secondStarted.invocation.invocationId,
        cursor: cursorGuard(uncertain.workflowCursor),
        attemptId: secondStarted.attempt.attemptId,
        fencingToken: secondStarted.attempt.fencingToken,
        generation: secondStarted.attempt.generation,
        coordinatorEpoch: secondStarted.attempt.coordinatorEpoch,
        expectedVersion: uncertain.run.version,
        uncertaintyEventId: uncertaintyEvent.event_id,
        uncertaintySequence: uncertaintyEvent.sequence,
        transitionId: 'workflow-protocol-failed-lmdb-reconcile-second',
        reconciliationId:
          'workflow-protocol-failed-lmdb-reconciliation-decision',
        reason: { code: 'protocol-failure-transcript-recovered' },
        evidence,
        observedAt: OBSERVED_AT + 7,
      };
      const reconciled = await ledger.reconcileUncertainWorkflowActivityAttempt(
        reconciliationRequest,
      );
      expect(reconciled).toMatchObject({
        applied: true,
        receipt: { type: 'workflow-activity-uncertainty-reconciled' },
        run: { status: 'FAILED' },
        invocation: {
          invocationId: secondStarted.invocation.invocationId,
          status: 'FAILED',
          terminal: {
            type: 'protocol-failed',
            attemptId: secondStarted.attempt.attemptId,
          },
        },
        attempt: retainedAttempt,
        workflowCursor: {
          stepId: SECOND_STEP_ID,
          stepIndex: 1,
          disposition: 'PROTOCOL_FAILED',
          outputs: priorOutputs,
        },
      });
      expect(reconciled.invocation).not.toHaveProperty('uncertainty');
      expect(reconciled.attempt).toEqual(retainedAttempt);
      expect(reconciled.workflowCursor.outputs).toEqual(priorOutputs);
      expect(reconciled).not.toHaveProperty('outputRef');
      expect(reconciled).not.toHaveProperty('nextInvocation');
      await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });
      const reconciliationEvent = (await ledger.getEvents(runId)).at(-1);
      expect(reconciliationEvent).toMatchObject({
        type: 'workflow-activity-uncertainty-reconciled',
        payload: {
          reconciliation: {
            reconciliationId: reconciliationRequest.reconciliationId,
            invocationId: secondStarted.invocation.invocationId,
            attemptId: secondStarted.attempt.attemptId,
            uncertaintyEventId: uncertaintyEvent.event_id,
            uncertaintySequence: uncertaintyEvent.sequence,
            verifier: {
              kind: 'wharfie.activity-protocol',
              protocol: 'wharfie.activity',
              protocolVersion: 1,
            },
            evidenceRef: {
              payloadSchema: 'wharfie.execution.activity-evidence.v1',
            },
            terminal: {
              type: 'protocol-failed',
              attemptId: secondStarted.attempt.attemptId,
            },
          },
        },
      });
      const reconciliationEvidenceRef =
        reconciliationEvent?.payload?.reconciliation?.evidenceRef;
      expect(reconciliationEvidenceRef).toBeDefined();
      if (!reconciliationEvidenceRef) {
        throw new Error('Expected durable reconciliation evidence authority.');
      }
      await expect(
        payloadStore.readJson(reconciliationEvidenceRef),
      ).resolves.toEqual(evidence);

      await db.close();
      closed = true;
      db = await createLMDBDB(databaseDirectory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName, payloadStore });
      const rebuilt = await ledger.rebuildRun(runId);
      expect(rebuilt).not.toBeNull();
      if (!rebuilt) {
        throw new Error('Expected the protocol-failed workflow to rebuild.');
      }
      expect(rebuilt.run).toEqual(reconciled.run);
      expect(rebuilt.workflowCursor).toEqual(reconciled.workflowCursor);
      expect(rebuilt.workflowCursor).toMatchObject({
        disposition: 'PROTOCOL_FAILED',
        outputs: priorOutputs,
      });
      expect(rebuilt.invocations).toHaveLength(2);
      const rebuiltInvocations = /** @type {Record<string, any>[]} */ (
        rebuilt.invocations
      );
      const rebuiltAttempts = /** @type {Record<string, any>[]} */ (
        rebuilt.attempts
      );
      expect(
        rebuiltInvocations.find(
          ({ invocationId }) =>
            invocationId === secondStarted.invocation.invocationId,
        ),
      ).toEqual(reconciled.invocation);
      expect(
        rebuiltAttempts.find(
          ({ attemptId }) => attemptId === secondStarted.attempt.attemptId,
        ),
      ).toEqual(retainedAttempt);
      await expect(
        ledger.getAttempt(
          runId,
          secondStarted.invocation.invocationId,
          secondStarted.attempt.attemptId,
        ),
      ).resolves.toEqual(retainedAttempt);
      const rebuiltReconciliationEvent = (await ledger.getEvents(runId)).at(-1);
      expect(rebuiltReconciliationEvent).toEqual(reconciliationEvent);
      await expect(
        payloadStore.readJson(reconciliationEvidenceRef),
      ).resolves.toEqual(evidence);
      await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });

      const replayed = await ledger.reconcileUncertainWorkflowActivityAttempt(
        reconciliationRequest,
      );
      expect(replayed).toEqual({ ...reconciled, applied: false });
      expect(replayed.attempt).toEqual(retainedAttempt);
      expect(replayed).not.toHaveProperty('outputRef');
      expect(replayed).not.toHaveProperty('nextInvocation');
    } finally {
      if (!closed) await db.close();
      rmSync(databaseDirectory, { recursive: true, force: true });
      rmSync(payloadDirectory, { recursive: true, force: true });
    }
  });
});
