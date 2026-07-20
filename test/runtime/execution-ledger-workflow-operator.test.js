/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { resolveExecutionPayloadStoreId } from '../../src/core/lib/config/db.js';
import {
  AttemptStatus,
  ExecutionLedgerTransitionConflictError,
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
  reconcileExecutionLedgerRun,
  recoverExecutionLedgerRun,
} from '../../src/core/runtime/operator/execution-ledger-operator.js';
import {
  WorkflowLedgerRecoveryAction,
  runWorkflowLedgerActivity,
} from '../../src/core/runtime/workflow-ledger-run.js';

/**
 * @typedef {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 * @typedef {import('../../src/core/runtime/workflow-definition.js').WorkflowDefinition} WorkflowDefinition
 * @typedef {Readonly<{adapterName: 'vanilla', controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}>} OperatorConfiguration
 */

const APP_ID = 'workflow-operator-app';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const WORKFLOW_ID = 'operator-workflow';
const ACTIVITY_ID = 'operator-activity';
const ACTOR = Object.freeze({
  kind: 'resident-workflow',
  id: 'workflow-operator-test',
});
const TWO_STEP_DEFINITION = /** @type {WorkflowDefinition} */ (
  Object.freeze({
    steps: [
      {
        id: 'first',
        kind: 'activity',
        activity: ACTIVITY_ID,
        input: { kind: 'workflow-input' },
      },
      {
        id: 'second',
        kind: 'activity',
        activity: ACTIVITY_ID,
        input: { kind: 'step-output', step: 'first' },
      },
    ],
  })
);
const ONE_STEP_DEFINITION = /** @type {WorkflowDefinition} */ (
  Object.freeze({ steps: [TWO_STEP_DEFINITION.steps[0]] })
);

/** @param {string} root @param {string} tableName */
function createConfiguration(root, tableName) {
  const controlPath = path.join(root, 'control');
  const payloadPath = path.join(root, 'execution-payloads');
  return /** @type {OperatorConfiguration} */ (
    Object.freeze({
      adapterName: 'vanilla',
      controlPath,
      tableName,
      payloadPath,
      payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
      sessionPath: path.join(root, 'ledger-service-sessions'),
    })
  );
}

/** @param {OperatorConfiguration} configuration @param {{readOnly?: boolean}} [options] */
function openLedger(configuration, options = {}) {
  const db = createVanillaDB({
    path: configuration.controlPath,
    ...options,
  });
  return {
    db,
    ledger: createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: createLocalExecutionPayloadStore({
        path: configuration.payloadPath,
        storeId: configuration.payloadStoreId,
      }),
    }),
  };
}

/** @param {Record<string, any>} cursor */
function cursorGuard(cursor) {
  return {
    version: cursor.version,
    continuationId: cursor.continuationId,
    stepId: cursor.stepId,
    stepIndex: cursor.stepIndex,
  };
}

/** @param {Readonly<Record<string, any>>} start @param {unknown} result */
function completedEvidence(start, result) {
  const transcript = new ActivityProtocolTranscriptValidator();
  const acceptedStart = transcript.acceptHostFrame(start);
  const terminal = transcript.acceptComponentFrame({
    protocol: ACTIVITY_PROTOCOL_NAME,
    protocolVersion: ACTIVITY_PROTOCOL_VERSION,
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
 * @param {ExecutionLedgerStore} ledger
 * @param {string} idempotencyKey
 * @param {WorkflowDefinition} definition
 */
async function createWorkflow(ledger, idempotencyKey, definition) {
  const runId = createWorkflowRunId({ appId: APP_ID, idempotencyKey });
  const created = await ledger.createWorkflowRun({
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition,
    input: { scenario: idempotencyKey },
    callerMetadata: { source: 'workflow-operator-test' },
    transitionId: `create:${idempotencyKey}`,
    actor: ACTOR,
  });
  return { runId, created };
}

/** @param {OperatorConfiguration} configuration @param {string} runId */
async function readState(configuration, runId) {
  const { db, ledger } = openLedger(configuration, { readOnly: true });
  try {
    return {
      view: await ledger.rebuildRun(runId),
      ready: await ledger.listReadyWork({
        appId: APP_ID,
        revisionId: REVISION_ID,
        observedAt: Number.MAX_SAFE_INTEGER,
        limit: 100,
      }),
    };
  } finally {
    await db.close();
  }
}

describe('generic workflow execution-ledger operator boundary', () => {
  it('reconciles retained evidence once and replays from the original uncertainty after the cursor advances', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-workflow-operator-reconcile-'),
    );
    const configuration = createConfiguration(root, 'workflow-reconcile');
    const { db, ledger } = openLedger(configuration);
    let closed = false;
    try {
      const { runId, created } = await createWorkflow(
        ledger,
        'reconcile-advanced-cursor',
        TWO_STEP_DEFINITION,
      );
      /** @type {Readonly<Record<string, any>> | undefined} */
      let dispatchedStart;
      const uncertain = await runWorkflowLedgerActivity({
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
        createFencingToken: () => 'workflow-reconcile-fence',
        executeAttempt: async (start) => {
          dispatchedStart = start;
          throw new Error('The physical result response was lost.');
        },
      });
      expect(uncertain).toMatchObject({
        disposition: 'blocked',
        dispatched: true,
        run: { status: RunStatus.BLOCKED },
        workflowCursor: {
          disposition: WorkflowCursorDisposition.ACTIVITY_UNCERTAIN,
          stepId: 'first',
          stepIndex: 0,
        },
        invocation: { status: InvocationStatus.UNCERTAIN },
        attempt: { status: AttemptStatus.ABANDONED },
      });
      expect(dispatchedStart).toBeDefined();
      if (!dispatchedStart) {
        throw new Error('Expected the retained workflow activity start frame.');
      }
      const retainedAttempt = JSON.parse(JSON.stringify(uncertain.attempt));
      const uncertaintyEvents = (await ledger.getEvents(runId)).filter(
        (event) => event.type === 'workflow-activity-became-uncertain',
      );
      expect(uncertaintyEvents).toHaveLength(1);
      const uncertaintyEventId = uncertaintyEvents[0].event_id;

      await db.close();
      closed = true;

      const reconciliationId = 'confirm-first-step-completed';
      const evidence = completedEvidence(dispatchedStart, {
        recovered: true,
      });
      const reconciled = await reconcileExecutionLedgerRun({
        runId,
        reconciliationId,
        evidence,
        expectedAppId: APP_ID,
        configuration,
      });
      expect(reconciled).toMatchObject({
        reconciliation: { reconciliationId, changed: true },
        view: {
          run: { runId, status: RunStatus.RUNNING },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: 'second',
            stepIndex: 1,
          },
          invocations: expect.arrayContaining([
            expect.objectContaining({
              invocationId: uncertain.invocation.invocationId,
              status: InvocationStatus.COMPLETED,
            }),
            expect.objectContaining({
              status: InvocationStatus.RUNNABLE,
              workflow: expect.objectContaining({
                stepId: 'second',
                stepIndex: 1,
              }),
            }),
          ]),
        },
      });

      const afterFirst = await readState(configuration, runId);
      expect(afterFirst.view?.attempts).toEqual([retainedAttempt]);
      expect(
        afterFirst.view?.events.filter(
          (/** @type {Record<string, any>} */ event) =>
            event.type === 'workflow-activity-uncertainty-reconciled',
        ),
      ).toEqual([
        expect.objectContaining({
          transition_id: `reconcile:${reconciliationId}`,
          payload: expect.objectContaining({
            reconciliation: expect.objectContaining({
              reconciliationId,
              uncertaintyEventId,
            }),
          }),
        }),
      ]);
      expect(afterFirst.ready.items).toEqual([
        expect.objectContaining({
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
          stepId: 'second',
          stepIndex: 1,
          generation: 0,
        }),
      ]);

      const replayed = await reconcileExecutionLedgerRun({
        runId,
        reconciliationId,
        evidence,
        expectedAppId: APP_ID,
        configuration,
      });
      expect(replayed).toMatchObject({
        reconciliation: { reconciliationId, changed: false },
        view: {
          run: { runId, status: RunStatus.RUNNING },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
            stepId: 'second',
            stepIndex: 1,
          },
        },
      });
      expect(await readState(configuration, runId)).toEqual(afterFirst);

      await expect(
        reconcileExecutionLedgerRun({
          runId,
          reconciliationId,
          evidence: completedEvidence(dispatchedStart, {
            recovered: false,
          }),
          reason: 'A conflicting operator decision must not reuse the receipt.',
          expectedAppId: APP_ID,
          configuration,
        }),
      ).rejects.toBeInstanceOf(ExecutionLedgerTransitionConflictError);
      expect(await readState(configuration, runId)).toEqual(afterFirst);
    } finally {
      if (!closed) await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('releases a claimed workflow activity through generic recovery', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-workflow-operator-recover-'),
    );
    const configuration = createConfiguration(root, 'workflow-recover');
    const { db, ledger } = openLedger(configuration);
    let closed = false;
    try {
      const { runId, created } = await createWorkflow(
        ledger,
        'recover-claimed-activity',
        ONE_STEP_DEFINITION,
      );
      const claimed = await ledger.claimWorkflowActivity({
        runId,
        invocationId: created.invocation.invocationId,
        cursor: cursorGuard(created.workflowCursor),
        fencingToken: 'workflow-recovery-fence',
        expectedGeneration: created.invocation.generation,
        expectedVersion: created.run.version,
        transitionId: 'claim-before-resident-stops',
        actor: ACTOR,
        coordinatorEpoch: 0,
      });
      await db.close();
      closed = true;

      const recovered = await recoverExecutionLedgerRun({
        runId,
        expectedAppId: APP_ID,
        configuration,
      });
      expect(recovered).toMatchObject({
        recovery: {
          found: true,
          mayExecute: true,
          action: WorkflowLedgerRecoveryAction.RELEASED_UNSTARTED_CLAIM,
          changed: true,
        },
        view: {
          run: { runId, status: RunStatus.RUNNING },
          workflowCursor: {
            disposition: WorkflowCursorDisposition.ACTIVITY_RUNNABLE,
          },
          invocations: [
            expect.objectContaining({
              invocationId: created.invocation.invocationId,
              status: InvocationStatus.RUNNABLE,
              generation: 1,
            }),
          ],
          attempts: [
            expect.objectContaining({
              attemptId: claimed.attempt.attemptId,
              status: AttemptStatus.ABANDONED,
              generation: 1,
            }),
          ],
        },
      });

      const after = await readState(configuration, runId);
      expect(
        after.view?.events.map(
          (/** @type {Record<string, any>} */ event) => event.type,
        ),
      ).toEqual([
        'workflow-run-created',
        'workflow-activity-claimed',
        'workflow-activity-abandoned-before-start',
      ]);
      expect(after.ready.items).toEqual([
        expect.objectContaining({
          runId,
          kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
          generation: 1,
        }),
      ]);
    } finally {
      if (!closed) await db.close();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
