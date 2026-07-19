/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterAll, describe, expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLMDBDB, getAdapterMatrix } from '../helpers/db-adapters.js';
import {
  ExecutionLedgerConflictError,
  ExecutionLedgerProjectionError,
  ExecutionLedgerRunConflictError,
  InvocationStatus,
  RunStatus,
  createExecutionLedger as createProductionExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
} from '../../src/core/lib/ledger/ready-work.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';

const APP_ID = 'workflow-start-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-start-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'main';
const ACTIVITY_ID = 'greet';
const STEP_ID = 'first';
const OBSERVED_AT = 1_700_000_000_000;
const PAYLOAD_ROOT = mkdtempSync(
  join(tmpdir(), 'wharfie-workflow-start-payload-'),
);
const PAYLOAD_STORE = createLocalExecutionPayloadStore({
  path: PAYLOAD_ROOT,
  storeId: 'workflow-start-test',
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
 * @param {Record<string, any>} input - Activity input selector.
 * @param {Record<string, any>} [overrides] - First-step overrides.
 * @returns {Record<string, any>} One activity-headed workflow definition.
 */
function activityDefinition(input, overrides = {}) {
  return {
    steps: [
      {
        id: STEP_ID,
        kind: 'activity',
        activity: ACTIVITY_ID,
        input,
        ...overrides,
      },
    ],
  };
}

/**
 * @param {string} runId - Durable run identity.
 * @param {Record<string, any>} [overrides] - Start request overrides.
 * @returns {Record<string, any>} Workflow start request.
 */
function workflowRun(runId, overrides = {}) {
  return {
    runId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    workflowId: WORKFLOW_ID,
    definition: activityDefinition({ kind: 'workflow-input' }),
    input: { name: 'Ada' },
    callerMetadata: { source: 'workflow-start-test' },
    transitionId: `create-${runId}`,
    actor: { kind: 'submitter', id: 'workflow-start-test' },
    observedAt: OBSERVED_AT,
    ...overrides,
  };
}

/**
 * @param {string} idempotencyKey - Caller-owned stable submission identity.
 * @returns {string} App-scoped workflow run identity.
 */
function workflowRunId(idempotencyKey) {
  return createWorkflowRunId({ appId: APP_ID, idempotencyKey });
}

/**
 * @param {ReturnType<typeof createProductionExecutionLedger>} ledger - Ledger instance.
 * @returns {Promise<Record<string, any>>} Exact-revision ready-work page.
 */
async function listReadyWork(ledger) {
  return await ledger.listReadyWork({
    appId: APP_ID,
    revisionId: REVISION_ID,
    observedAt: Number.MAX_SAFE_INTEGER,
    limit: 100,
  });
}

/**
 * Read every V10 record in one run partition for atomicity and corruption
 * checks without relying on a private projection sort-key constructor.
 * @param {import('../../src/core/lib/db/base.js').DBClient} db - DB adapter.
 * @param {string} tableName - Ledger table.
 * @param {string} runId - Run partition.
 * @returns {Promise<Record<string, any>[]>} Raw ledger records.
 */
async function readRunRecords(db, tableName, runId) {
  return await db.query({
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
}

for (const adapter of getAdapterMatrix()) {
  describe(`${adapter.name} execution-ledger workflow start`, () => {
    test.each([
      {
        label: 'workflow-input',
        definition: activityDefinition({ kind: 'workflow-input' }),
        startInput: { name: 'Ada' },
        expectedActivityInput: { name: 'Ada' },
      },
      {
        label: 'literal',
        definition: activityDefinition({
          kind: 'literal',
          value: { name: 'Literal Ada', source: 'definition' },
        }),
        startInput: { ignored: true },
        expectedActivityInput: {
          name: 'Literal Ada',
          source: 'definition',
        },
      },
    ])(
      'atomically starts one $label activity-headed workflow',
      async ({ label, definition, startInput, expectedActivityInput }) => {
        const { db, cleanup } = await adapter.create();
        const tableName = `execution-ledger-workflow-${label}`;
        const runId = workflowRunId(`workflow-${label}`);
        try {
          const ledger = createExecutionLedger({ db, tableName });
          const request = workflowRun(runId, {
            definition,
            input: startInput,
          });
          const created = await ledger.createWorkflowRun(request);
          const cursor = created.workflowCursor;

          expect(created.applied).toBe(true);
          expect(cursor).toEqual({
            schemaVersion: 10,
            runId,
            appId: APP_ID,
            revisionId: REVISION_ID,
            workflowId: WORKFLOW_ID,
            planId: expect.any(String),
            planRef: expect.objectContaining({
              payloadSchema: 'wharfie.execution.workflow-plan.v1',
            }),
            startRef: expect.objectContaining({
              payloadSchema: 'wharfie.execution.workflow-start-request.v1',
            }),
            stepId: STEP_ID,
            stepIndex: 0,
            continuationId: expect.any(String),
            disposition: 'ACTIVITY_RUNNABLE',
            invocationId: expect.any(String),
            outputs: [],
            version: 1,
            lastSequence: 1,
            createdAt: OBSERVED_AT,
            updatedAt: OBSERVED_AT,
          });
          expect(created.run).toMatchObject({
            schemaVersion: 10,
            runId,
            appId: APP_ID,
            revisionId: REVISION_ID,
            trigger: {
              kind: 'workflow',
              workflowId: WORKFLOW_ID,
              planId: cursor.planId,
              planRef: cursor.planRef,
            },
            requestRef: cursor.startRef,
            status: RunStatus.RUNNING,
            version: 1,
            lastSequence: 1,
            createdAt: OBSERVED_AT,
            updatedAt: OBSERVED_AT,
          });
          expect(created.invocation).toMatchObject({
            schemaVersion: 10,
            runId,
            invocationId: cursor.invocationId,
            appId: APP_ID,
            revisionId: REVISION_ID,
            activityId: ACTIVITY_ID,
            requestRef: expect.objectContaining({
              payloadSchema: 'wharfie.execution.activity-request.v1',
            }),
            status: InvocationStatus.RUNNABLE,
            generation: 0,
            version: 1,
            lastSequence: 1,
            createdAt: OBSERVED_AT,
            updatedAt: OBSERVED_AT,
          });
          await expect(PAYLOAD_STORE.readJson(cursor.planRef)).resolves.toEqual(
            {
              schemaVersion: 1,
              kind: 'workflowPlan',
              appId: APP_ID,
              revisionId: REVISION_ID,
              workflowId: WORKFLOW_ID,
              definition,
            },
          );
          await expect(
            PAYLOAD_STORE.readJson(cursor.startRef),
          ).resolves.toEqual({
            schemaVersion: 1,
            kind: 'workflowStart',
            input: startInput,
            callerMetadata: request.callerMetadata,
          });
          await expect(
            PAYLOAD_STORE.readJson(created.invocation.requestRef),
          ).resolves.toEqual({
            input: expectedActivityInput,
            callerMetadata: request.callerMetadata,
          });

          const ready = await listReadyWork(ledger);
          expect(ready.items).toEqual([
            expect.objectContaining({
              appId: APP_ID,
              revisionId: REVISION_ID,
              runId,
              kind: ExecutionLedgerReadyWorkKind.ACTIVITY,
              availableAt: OBSERVED_AT,
              runVersion: 1,
              lastSequence: 1,
              invocationId: cursor.invocationId,
              generation: 0,
              cursorVersion: 1,
              continuationId: cursor.continuationId,
              stepId: STEP_ID,
              stepIndex: 0,
            }),
          ]);
          await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
          await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
            run: created.run,
            workflowCursor: cursor,
            invocations: [created.invocation],
            events: [expect.objectContaining({ sequence: 1 })],
          });
          await expect(ledger.listRuns({ appId: APP_ID })).resolves.toEqual({
            items: [
              expect.objectContaining({
                runId,
                kind: 'workflow',
                version: 1,
                lastSequence: 1,
              }),
            ],
          });
        } finally {
          await cleanup();
        }
      },
    );

    test('replays an exact start and rejects changed immutable work', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-replay';
      const runId = workflowRunId('workflow-replay');
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const request = workflowRun(runId);
        const created = await ledger.createWorkflowRun(request);
        const replayed = await ledger.createWorkflowRun(request);
        const retriedWithFreshEnvelope = await ledger.createWorkflowRun({
          ...request,
          transitionId: 'retry-with-fresh-envelope',
          observedAt: OBSERVED_AT + 1,
        });

        expect(replayed).toMatchObject({
          applied: false,
          receipt: created.receipt,
          run: created.run,
          workflowCursor: created.workflowCursor,
          invocation: created.invocation,
        });
        expect(retriedWithFreshEnvelope).toMatchObject({
          applied: false,
          run: created.run,
          workflowCursor: created.workflowCursor,
          invocation: created.invocation,
        });
        expect(retriedWithFreshEnvelope).not.toHaveProperty('receipt');
        await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [
            expect.objectContaining({
              runId,
              continuationId: created.workflowCursor.continuationId,
              invocationId: created.invocation.invocationId,
            }),
          ],
        });

        const conflicts = [
          { input: { name: 'Grace' }, transitionId: 'changed-input' },
          {
            callerMetadata: { source: 'another-caller' },
            transitionId: 'changed-metadata',
          },
          { workflowId: 'other-workflow', transitionId: 'changed-workflow' },
          {
            definition: activityDefinition(
              { kind: 'workflow-input' },
              { activity: 'other-activity' },
            ),
            transitionId: 'changed-definition',
          },
          {
            actor: { kind: 'submitter', id: 'another-caller' },
            transitionId: 'changed-actor',
          },
        ];
        for (const conflict of conflicts) {
          await expect(
            ledger.createWorkflowRun(workflowRun(runId, conflict)),
          ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
        }

        await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
        await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
          run: created.run,
          workflowCursor: created.workflowCursor,
          invocations: [created.invocation],
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects timer- and signal-headed definitions without creating a run', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-unsupported-head';
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const unsupported = [
          {
            runId: workflowRunId('workflow-timer-head'),
            definition: {
              steps: [{ id: 'pause', kind: 'timer', delayMs: 1_000 }],
            },
          },
          {
            runId: workflowRunId('workflow-signal-head'),
            definition: {
              steps: [{ id: 'approval', kind: 'signal' }],
            },
          },
        ];

        for (const candidate of unsupported) {
          await expect(
            ledger.createWorkflowRun(
              workflowRun(candidate.runId, {
                definition: candidate.definition,
              }),
            ),
          ).rejects.toThrow(/first.*activity|activity.*first/i);
          await expect(ledger.getRun(candidate.runId)).resolves.toBeNull();
          await expect(ledger.getEvents(candidate.runId)).resolves.toEqual([]);
          await expect(
            readRunRecords(db, tableName, candidate.runId),
          ).resolves.toEqual([]);
        }
        await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });
        await expect(ledger.listRuns({ appId: APP_ID })).resolves.toEqual({
          items: [],
        });
      } finally {
        await cleanup();
      }
    });

    test('leaves no ledger authority when the start transaction fails', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-transaction-failure';
      const runId = workflowRunId('workflow-failed-transaction');
      try {
        const directLedger = createExecutionLedger({ db, tableName });
        let failNextTransaction = true;
        const failingDb = {
          ...db,
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Transaction request. */
          async transactionWrite(params) {
            if (failNextTransaction) {
              failNextTransaction = false;
              throw new Error('injected workflow start transaction failure');
            }
            return await db.transactionWrite(params);
          },
        };
        const failingLedger = createExecutionLedger({
          db: failingDb,
          tableName,
        });

        await expect(
          failingLedger.createWorkflowRun(workflowRun(runId)),
        ).rejects.toThrow('injected workflow start transaction failure');
        await expect(directLedger.getRun(runId)).resolves.toBeNull();
        await expect(directLedger.getEvents(runId)).resolves.toEqual([]);
        await expect(readRunRecords(db, tableName, runId)).resolves.toEqual([]);
        await expect(listReadyWork(directLedger)).resolves.toEqual({
          items: [],
        });
        await expect(directLedger.listRuns({ appId: APP_ID })).resolves.toEqual(
          { items: [] },
        );

        await expect(
          directLedger.createWorkflowRun(workflowRun(runId)),
        ).resolves.toMatchObject({ applied: true });
        await expect(directLedger.getEvents(runId)).resolves.toHaveLength(1);
      } finally {
        await cleanup();
      }
    });

    test('loses an exact concurrent workflow create and returns the durable winner', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-exact-race';
      const runId = workflowRunId('workflow-exact-race');
      try {
        const directLedger = createExecutionLedger({ db, tableName });
        let injectWinner = true;
        const guardedDb = {
          ...db,
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing transaction. */
          async transactionWrite(params) {
            if (injectWinner) {
              injectWinner = false;
              await directLedger.createWorkflowRun(
                workflowRun(runId, { transitionId: 'exact-race-winner' }),
              );
            }
            return await db.transactionWrite(params);
          },
        };
        const losingLedger = createExecutionLedger({
          db: guardedDb,
          tableName,
        });

        const loser = await losingLedger.createWorkflowRun(workflowRun(runId));
        expect(loser).toMatchObject({
          applied: false,
          run: { runId, version: 1 },
          workflowCursor: { version: 1, stepId: STEP_ID },
          invocation: { status: InvocationStatus.RUNNABLE },
        });
        expect(loser).not.toHaveProperty('receipt');
        await expect(directLedger.getEvents(runId)).resolves.toHaveLength(1);
        await expect(listReadyWork(directLedger)).resolves.toMatchObject({
          items: [expect.objectContaining({ runId, cursorVersion: 1 })],
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects a conflicting concurrent workflow winner without mixed state', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-conflict-race';
      const runId = workflowRunId('workflow-conflict-race');
      try {
        const directLedger = createExecutionLedger({ db, tableName });
        let injectWinner = true;
        /** @type {Record<string, any> | undefined} */
        let winner;
        const guardedDb = {
          ...db,
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params - Losing transaction. */
          async transactionWrite(params) {
            if (injectWinner) {
              injectWinner = false;
              winner = await directLedger.createWorkflowRun(
                workflowRun(runId, {
                  input: { name: 'Grace' },
                  transitionId: 'conflict-race-winner',
                }),
              );
            }
            return await db.transactionWrite(params);
          },
        };
        const losingLedger = createExecutionLedger({
          db: guardedDb,
          tableName,
        });

        await expect(
          losingLedger.createWorkflowRun(workflowRun(runId)),
        ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
        expect(winner).toMatchObject({ applied: true, run: { runId } });
        if (!winner) throw new Error('Expected the injected workflow winner.');
        await expect(directLedger.getEvents(runId)).resolves.toHaveLength(1);
        await expect(directLedger.rebuildRun(runId)).resolves.toMatchObject({
          run: winner.run,
          workflowCursor: winner.workflowCursor,
          invocations: [winner.invocation],
        });
        await expect(listReadyWork(directLedger)).resolves.toMatchObject({
          items: [expect.objectContaining({ runId, cursorVersion: 1 })],
        });
      } finally {
        await cleanup();
      }
    });

    test('rejects generic claim and manual cancellation for a workflow run', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-generic-mutations';
      const runId = workflowRunId('workflow-generic-mutations');
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const created = await ledger.createWorkflowRun(workflowRun(runId));
        const before = await ledger.rebuildRun(runId);

        await expect(
          ledger.claimInvocation({
            runId,
            invocationId: created.invocation.invocationId,
            fencingToken: 'generic-workflow-fence',
            expectedGeneration: 0,
            expectedVersion: created.run.version,
            transitionId: 'generic-workflow-claim',
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);
        await expect(
          ledger.requestManualRunCancellation({
            runId,
            invocationId: created.invocation.invocationId,
            expectedVersion: created.run.version,
            expectedGeneration: 0,
            transitionId: 'generic-workflow-cancel',
            requestId: 'generic-workflow-cancel',
            actor: { kind: 'operator', id: 'workflow-start-test' },
            reason: {
              code: 'operator-requested-cancellation',
              name: 'CancellationError',
              message: 'The operator requested cancellation.',
              details: { runId },
            },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerConflictError);

        await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
        await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [expect.objectContaining({ runId, runVersion: 1 })],
        });
      } finally {
        await cleanup();
      }
    });

    test('repairs a missing cursor-bound workflow ready row', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-ready-repair';
      const runId = workflowRunId('workflow-ready-repair');
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const created = await ledger.createWorkflowRun(workflowRun(runId));
        const before = await listReadyWork(ledger);
        const scope = createExecutionLedgerReadyWorkScope({
          appId: APP_ID,
          revisionId: REVISION_ID,
        });
        await db.batchWrite({
          tableName,
          deleteRequests: [
            {
              keyName: 'run_id',
              keyValue: scope.readyWorkId,
              sortKeyName: 'sort_key',
              sortKeyValue: getExecutionLedgerReadyWorkSortKey({
                availableAt: OBSERVED_AT,
                runId,
              }),
            },
          ],
        });
        await expect(listReadyWork(ledger)).resolves.toEqual({ items: [] });

        await expect(
          ledger.repairReadyWork({
            appId: APP_ID,
            revisionId: REVISION_ID,
            runId,
          }),
        ).resolves.toMatchObject({
          applied: true,
          expected: {
            runId,
            cursorVersion: 1,
            continuationId: created.workflowCursor.continuationId,
            stepId: STEP_ID,
            stepIndex: 0,
          },
        });
        await expect(listReadyWork(ledger)).resolves.toEqual(before);
        await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
      } finally {
        await cleanup();
      }
    });

    test('fails closed when the workflow cursor projection is corrupted', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-cursor-corruption';
      const runId = workflowRunId('workflow-cursor-corruption');
      try {
        const ledger = createExecutionLedger({ db, tableName });
        await ledger.createWorkflowRun(workflowRun(runId));
        const records = await readRunRecords(db, tableName, runId);
        const cursorRecord = records.find(
          (record) =>
            record.record_type ===
            'execution_ledger_workflow_cursor_projection',
        );
        expect(cursorRecord).toBeDefined();
        if (!cursorRecord)
          throw new Error('Expected a workflow cursor record.');
        await db.update({
          tableName,
          keyName: 'run_id',
          keyValue: runId,
          sortKeyName: 'sort_key',
          sortKeyValue: cursorRecord.sort_key,
          updates: [
            {
              property: ['data', 'stepId'],
              propertyValue: 'forged-step',
            },
          ],
        });

        await expect(ledger.rebuildRun(runId)).rejects.toBeInstanceOf(
          ExecutionLedgerProjectionError,
        );
      } finally {
        await cleanup();
      }
    });
  });
}

describe('LMDB workflow start persistence', () => {
  test('retains the workflow cursor and cursor-bound activity row across reopen', async () => {
    const directory = mkdtempSync(
      join(tmpdir(), 'wharfie-workflow-start-reopen-'),
    );
    const tableName = 'execution-ledger-workflow-start-reopen';
    const runId = workflowRunId('workflow-start-reopen');
    let db = await createLMDBDB(directory);
    let closed = false;
    try {
      let ledger = createExecutionLedger({ db, tableName });
      await ledger.createWorkflowRun(workflowRun(runId));
      const before = await ledger.rebuildRun(runId);
      const readyBefore = await listReadyWork(ledger);

      await db.close();
      closed = true;
      db = await createLMDBDB(directory);
      closed = false;
      ledger = createExecutionLedger({ db, tableName });

      await expect(ledger.rebuildRun(runId)).resolves.toEqual(before);
      await expect(listReadyWork(ledger)).resolves.toEqual(readyBefore);
      await expect(ledger.getEvents(runId)).resolves.toHaveLength(1);
    } finally {
      if (!closed) await db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
