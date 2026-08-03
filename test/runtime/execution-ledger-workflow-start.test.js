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
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createScheduleControl } from '../../src/core/lib/db/tables/schedule-control.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import {
  ExecutionLedgerReadyWorkKind,
  createExecutionLedgerReadyWorkScope,
  getExecutionLedgerReadyWorkSortKey,
} from '../../src/core/lib/ledger/ready-work.js';
import {
  createScheduleOccurrenceId,
  createScheduleRunCause,
} from '../../src/core/lib/ledger/schedule-occurrence.js';
import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  createWorkflowPlanId,
  createWorkflowRunId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';

const APP_ID = 'workflow-start-app';
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('workflow-start-revision')
  .digest('base64url')}`;
const WORKFLOW_ID = 'main';
const ACTIVITY_ID = 'greet';
const STEP_ID = 'first';
const OBSERVED_AT = 1_700_000_000_000;
const SCHEDULED_AT = 1_700_000_040_000;
const SCHEDULE_DEFINITION_ID = `wsd_${createHash('sha256')
  .update('workflow-start-schedule-definition')
  .digest('base64url')}`;
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

    test('binds a scheduled workflow cause into creation and exact replay', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-scheduled-workflow-start';
      const occurrenceId = createScheduleOccurrenceId({
        appId: APP_ID,
        scheduleId: 'nightly',
        scheduledAt: SCHEDULED_AT,
      });
      const runId = workflowRunId(occurrenceId);
      const cause = createScheduleRunCause({
        appId: APP_ID,
        scheduleId: 'nightly',
        definitionId: SCHEDULE_DEFINITION_ID,
        scheduledAt: SCHEDULED_AT,
      });
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const ownership = createLedgerServiceOwnership({ db, tableName });
        const claimed = await ownership.claimOwnership({
          serviceId: createLedgerServiceId({ appId: APP_ID }),
          appId: APP_ID,
          scopeId: 'workflow-start-resident',
          principalId: 'workflow-start-principal',
          sessionId: createLedgerServiceSessionId(),
          ownerKind: LedgerServiceOwnerKind.RESIDENT,
          expected: null,
          claimedAt: OBSERVED_AT,
        });
        const scheduleControl = createScheduleControl({ db, tableName });
        const activated = await scheduleControl.activate({
          appId: APP_ID,
          scheduleId: cause.scheduleId,
          revisionId: REVISION_ID,
          definitionId: cause.definitionId,
          owner: claimed.ownership,
          observedAt: OBSERVED_AT,
        });
        const definition = activityDefinition({ kind: 'workflow-input' });
        const planId = createWorkflowPlanId({
          schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
          kind: WORKFLOW_PLAN_PAYLOAD_KIND,
          appId: APP_ID,
          revisionId: REVISION_ID,
          workflowId: WORKFLOW_ID,
          definition,
        });
        const scheduleAdmission =
          await scheduleControl.prepareWorkflowAdmission({
            expectedCursor: activated.cursor,
            scheduledAt: SCHEDULED_AT,
            throughInclusive: SCHEDULED_AT,
            skipped: null,
            workflowId: WORKFLOW_ID,
            planId,
            runId,
            cause,
            owner: claimed.ownership,
            observedAt: SCHEDULED_AT,
          });
        const request = workflowRun(runId, {
          definition,
          cause,
          scheduleAdmission,
          actor: { kind: 'resident-schedule', id: APP_ID },
        });
        const requestWithoutAdmission = { ...request };
        delete requestWithoutAdmission.scheduleAdmission;

        await expect(
          ledger.createWorkflowRun({
            ...workflowRun(workflowRunId('admission-without-cause')),
            scheduleAdmission,
          }),
        ).rejects.toThrow(
          'cause and scheduleAdmission must be provided together',
        );
        await expect(
          ledger.createWorkflowRun(requestWithoutAdmission),
        ).rejects.toThrow(
          'cause and scheduleAdmission must be provided together',
        );
        const wrongStore = await adapter.create();
        try {
          const wrongStoreTransactionWrite =
            wrongStore.db.transactionWrite.bind(wrongStore.db);
          let wrongStoreWriteCount = 0;
          wrongStore.db.transactionWrite = async (input) => {
            wrongStoreWriteCount += 1;
            await wrongStoreTransactionWrite(input);
          };
          const wrongStoreLedger = createExecutionLedger({
            db: wrongStore.db,
            tableName,
          });
          await expect(
            wrongStoreLedger.createWorkflowRun(request),
          ).rejects.toBeInstanceOf(TypeError);
          expect(wrongStoreWriteCount).toBe(0);
        } finally {
          await wrongStore.cleanup();
        }

        const transactionWrite = db.transactionWrite.bind(db);
        const query = db.query.bind(db);
        let lostCombinedResponse = false;
        let hideCommittedRunRead = false;
        let hiddenCommittedRunRead = false;
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams | undefined} */
        let combinedWrite;
        db.query = async (input) => {
          const records = await query(input);
          if (
            hideCommittedRunRead &&
            records.some(
              (record) => record.record_type === 'execution_ledger_event',
            )
          ) {
            hideCommittedRunRead = false;
            hiddenCommittedRunRead = true;
            return [];
          }
          return records;
        };
        db.transactionWrite = async (input) => {
          await transactionWrite(input);
          const records = input.putRequests?.map(({ record }) => record) || [];
          if (
            !lostCombinedResponse &&
            records.some(
              (record) => record.record_type === 'execution_ledger_event',
            ) &&
            records.some(
              (record) => record.record_kind === 'schedule-occurrence',
            )
          ) {
            lostCombinedResponse = true;
            combinedWrite = input;
            hideCommittedRunRead = true;
            throw new Error('simulated committed schedule-start response loss');
          }
        };
        const created = await ledger.createWorkflowRun(request);
        expect(lostCombinedResponse).toBe(true);
        expect(hiddenCommittedRunRead).toBe(true);
        expect(combinedWrite).toBeDefined();
        const transactionItems = [
          ...(combinedWrite?.conditionChecks || []),
          ...(combinedWrite?.putRequests || []),
          ...(combinedWrite?.updateRequests || []),
          ...(combinedWrite?.deleteRequests || []),
        ];
        const transactionItemBytes = transactionItems.map((item) =>
          Buffer.byteLength(JSON.stringify(item), 'utf8'),
        );
        const transactionBytes = transactionItemBytes.reduce(
          (total, bytes) => total + bytes,
          0,
        );
        expect(transactionItems).toHaveLength(12);
        expect(transactionItemBytes.every((bytes) => bytes < 400 * 1024)).toBe(
          true,
        );
        expect(transactionBytes).toBeLessThan(4 * 1024 * 1024);
        expect(combinedWrite?.putRequests).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              record: expect.objectContaining({
                record_type: 'execution_ledger_event',
              }),
            }),
            expect.objectContaining({
              record: expect.objectContaining({
                record_kind: 'schedule-occurrence',
                run_id_value: runId,
              }),
            }),
          ]),
        );
        const transactionTargets = [
          ...(combinedWrite?.conditionChecks || []).map((conditionCheck) => [
            conditionCheck.keyName,
            conditionCheck.keyValue,
            conditionCheck.sortKeyName,
            conditionCheck.sortKeyValue,
          ]),
          ...(combinedWrite?.putRequests || []).map((putRequest) => [
            putRequest.keyName,
            putRequest.record[putRequest.keyName],
            putRequest.sortKeyName,
            putRequest.sortKeyName
              ? putRequest.record[putRequest.sortKeyName]
              : undefined,
          ]),
        ].map((target) => JSON.stringify(target));
        expect(new Set(transactionTargets).size).toBe(
          transactionTargets.length,
        );
        expect(combinedWrite?.conditionChecks).toEqual([
          expect.objectContaining({
            conditions: [
              expect.objectContaining({ conditionType: 'NOT_EXISTS' }),
            ],
          }),
          expect.objectContaining({
            sortKeyValue: 'ledger-service/v1/ownership',
          }),
        ]);
        expect(
          combinedWrite?.putRequests?.find(
            ({ record }) => record.record_kind === 'schedule-cursor',
          ),
        ).toEqual(
          expect.objectContaining({
            conditions: expect.arrayContaining([
              expect.objectContaining({
                conditionType: 'EQUALS',
                propertyName: 'version',
                propertyValue: activated.cursor.version,
              }),
            ]),
          }),
        );
        const restartedScheduleAdmission =
          await scheduleControl.prepareWorkflowAdmission({
            expectedCursor: activated.cursor,
            scheduledAt: SCHEDULED_AT,
            throughInclusive: SCHEDULED_AT,
            skipped: null,
            workflowId: WORKFLOW_ID,
            planId,
            runId,
            cause,
            owner: claimed.ownership,
            observedAt: SCHEDULED_AT,
          });
        const replayed = await ledger.createWorkflowRun({
          ...request,
          scheduleAdmission: restartedScheduleAdmission,
        });

        expect(created.applied).toBe(false);
        expect(created.run.trigger).toMatchObject({
          kind: 'workflow',
          workflowId: WORKFLOW_ID,
          cause,
        });
        expect(replayed).toMatchObject({
          applied: false,
          run: created.run,
          workflowCursor: created.workflowCursor,
        });
        await expect(
          scheduleControl.getOccurrence({
            occurrenceId: cause.occurrenceId,
          }),
        ).resolves.toMatchObject({
          appId: APP_ID,
          revisionId: REVISION_ID,
          scheduleId: cause.scheduleId,
          definitionId: cause.definitionId,
          workflowId: WORKFLOW_ID,
          planId,
          runId,
          cause,
        });
        await expect(ledger.rebuildRun(runId)).resolves.toMatchObject({
          run: { trigger: { cause } },
        });

        db.transactionWrite = transactionWrite;
        db.query = query;
        const delayedScheduledAt = SCHEDULED_AT + 60_000;
        const delayedCause = createScheduleRunCause({
          appId: APP_ID,
          scheduleId: 'delayed',
          definitionId: SCHEDULE_DEFINITION_ID,
          scheduledAt: delayedScheduledAt,
        });
        const delayedRunId = workflowRunId(delayedCause.occurrenceId);
        const delayedActivation = await scheduleControl.activate({
          appId: APP_ID,
          scheduleId: delayedCause.scheduleId,
          revisionId: REVISION_ID,
          definitionId: delayedCause.definitionId,
          owner: claimed.ownership,
          observedAt: SCHEDULED_AT,
        });
        const delayedAdmission = await scheduleControl.prepareWorkflowAdmission(
          {
            expectedCursor: delayedActivation.cursor,
            scheduledAt: delayedScheduledAt,
            throughInclusive: delayedScheduledAt,
            skipped: null,
            workflowId: WORKFLOW_ID,
            planId,
            runId: delayedRunId,
            cause: delayedCause,
            owner: claimed.ownership,
            observedAt: delayedScheduledAt,
          },
        );
        const delayedRequest = workflowRun(delayedRunId, {
          definition,
          cause: delayedCause,
          scheduleAdmission: delayedAdmission,
          actor: { kind: 'resident-schedule', id: APP_ID },
        });
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams | undefined} */
        let pendingCombinedWrite;
        let committedBetweenReconciliationReads = false;
        db.transactionWrite = async (input) => {
          const records = input.putRequests?.map(({ record }) => record) || [];
          if (
            records.some(
              (record) => record.record_type === 'execution_ledger_event',
            ) &&
            records.some(
              (record) =>
                record.record_kind === 'schedule-occurrence' &&
                record.occurrence_id === delayedCause.occurrenceId,
            )
          ) {
            pendingCombinedWrite = input;
            throw new Error('simulated in-flight schedule-start response loss');
          }
          await transactionWrite(input);
        };
        db.query = async (input) => {
          const records = await query(input);
          if (pendingCombinedWrite) {
            const commit = pendingCombinedWrite;
            pendingCombinedWrite = undefined;
            await transactionWrite(commit);
            committedBetweenReconciliationReads = true;
          }
          return records;
        };
        const recoveredDelayed = await ledger.createWorkflowRun(delayedRequest);
        expect(committedBetweenReconciliationReads).toBe(true);
        expect(recoveredDelayed).toMatchObject({
          applied: false,
          run: {
            runId: delayedRunId,
            trigger: { cause: delayedCause },
          },
        });
        await expect(
          scheduleControl.getOccurrence({
            occurrenceId: delayedCause.occurrenceId,
          }),
        ).resolves.toMatchObject({
          runId: delayedRunId,
          cause: delayedCause,
        });
        db.transactionWrite = transactionWrite;
        db.query = query;

        await expect(
          ledger.createWorkflowRun(workflowRun(runId)),
        ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
        await expect(
          ledger.createWorkflowRun({
            ...request,
            cause: {
              ...cause,
              definitionId: `wsd_${createHash('sha256')
                .update('changed-schedule-definition')
                .digest('base64url')}`,
            },
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
        await expect(
          ledger.createWorkflowRun({
            ...request,
            cause: createScheduleRunCause({
              appId: APP_ID,
              scheduleId: 'hourly',
              definitionId: SCHEDULE_DEFINITION_ID,
              scheduledAt: SCHEDULED_AT,
            }),
          }),
        ).rejects.toBeInstanceOf(ExecutionLedgerRunConflictError);
      } finally {
        await cleanup();
      }
    });

    test('creates timer- and signal-headed definitions with exact activation projections', async () => {
      const { db, cleanup } = await adapter.create();
      const tableName = 'execution-ledger-workflow-start-unsupported-head';
      try {
        const ledger = createExecutionLedger({ db, tableName });
        const headed = [
          {
            runId: workflowRunId('workflow-timer-head'),
            disposition: 'TIMER_WAITING',
            projection: 'timer',
            definition: {
              steps: [{ id: 'pause', kind: 'timer', delayMs: 1_000 }],
            },
          },
          {
            runId: workflowRunId('workflow-signal-head'),
            disposition: 'SIGNAL_WAITING',
            projection: 'signalWait',
            definition: {
              steps: [{ id: 'approval', kind: 'signal' }],
            },
          },
        ];

        for (const candidate of headed) {
          const created = await ledger.createWorkflowRun(
            workflowRun(candidate.runId, {
              definition: candidate.definition,
            }),
          );
          expect(created).toMatchObject({
            applied: true,
            run: { status: 'RUNNING', version: 1 },
            workflowCursor: {
              disposition: candidate.disposition,
              stepIndex: 0,
            },
            [candidate.projection]: { status: 'WAITING', version: 1 },
          });
          expect(created).not.toHaveProperty('invocation');
          await expect(ledger.getEvents(candidate.runId)).resolves.toHaveLength(
            1,
          );
          await expect(
            ledger.rebuildRun(candidate.runId),
          ).resolves.toMatchObject({
            run: created.run,
            workflowCursor: created.workflowCursor,
            timers: candidate.projection === 'timer' ? [created.timer] : [],
            signalWaits:
              candidate.projection === 'signalWait' ? [created.signalWait] : [],
          });
        }
        await expect(listReadyWork(ledger)).resolves.toMatchObject({
          items: [{ kind: 'TIMER', runId: headed[0].runId }],
        });
        await expect(ledger.listRuns({ appId: APP_ID })).resolves.toMatchObject(
          {
            items: expect.arrayContaining(
              headed.map(({ runId }) => expect.objectContaining({ runId })),
            ),
          },
        );
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
