/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
  createCoordinatorQuiescenceBarrier,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  ExecutionLedgerProjectionError,
  createExecutionLedger,
} from '../../src/core/lib/db/tables/execution-ledger.js';
import {
  LocalApplicationActivationAction,
  LocalApplicationActivationDestination,
  LocalApplicationAdmissionClosedError,
  createLocalApplicationActivation,
} from '../../src/core/lib/db/tables/local-application-activation.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createScheduleControl } from '../../src/core/lib/db/tables/schedule-control.js';
import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { createScheduleRunCause } from '../../src/core/lib/ledger/schedule-occurrence.js';
import {
  WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
  WORKFLOW_PLAN_PAYLOAD_KIND,
  createWorkflowPlanId,
  createWorkflowRunId,
} from '../../src/core/lib/ledger/workflow-execution-contract.js';
import { inspectLocalApplicationQuiescence } from '../../src/core/runtime/services/local-application-quiescence.js';
import { createExecutionLedgerOperatorView } from '../../src/core/runtime/operator/execution-ledger-view.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */

const TABLE_NAME = 'schedule-workflow-cutover';
const APP_ID = 'schedule-cutover-app';
const SCHEDULE_ID = 'minute-work';
const WORKFLOW_ID = 'scheduled-work';
const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;
const ARTIFACT_A = `waf1_${'A'.repeat(43)}`;
const ARTIFACT_B = `waf1_${'B'.repeat(42)}A`;
const DEFINITION_ID = `wsd_${'A'.repeat(43)}`;
const ACTIVATION_AT = 120_123;
const SCHEDULED_AT = 180_000;
const definition = Object.freeze({
  steps: Object.freeze([
    Object.freeze({
      id: 'work',
      kind: 'activity',
      activity: 'work',
      input: Object.freeze({ kind: 'workflow-input' }),
    }),
  ]),
});

function createHarness() {
  const dbRoot = mkdtempSync(join(tmpdir(), 'wharfie-schedule-cutover-db-'));
  const payloadRoot = mkdtempSync(
    join(tmpdir(), 'wharfie-schedule-cutover-payload-'),
  );
  const db = createVanillaDB({ path: dbRoot });
  const activation = createLocalApplicationActivation({
    db,
    tableName: TABLE_NAME,
  });
  const schedule = createScheduleControl({ db, tableName: TABLE_NAME });
  const payloadStore = createLocalExecutionPayloadStore({
    path: payloadRoot,
    storeId: 'schedule-cutover',
  });
  return {
    db,
    activation,
    schedule,
    payloadStore,
    async cleanup() {
      await db.close();
      rmSync(dbRoot, { recursive: true, force: true });
      rmSync(payloadRoot, { recursive: true, force: true });
    },
  };
}

/** @param {ReturnType<typeof createLocalApplicationActivation>} activation */
async function activateApplication(activation) {
  const begun = await activation.beginInstall({
    appId: APP_ID,
    target: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
    observedAt: 1,
  });
  const transitionId = begun.activation.transition.transitionId;
  await activation.markQuiescent({
    appId: APP_ID,
    transitionId,
    observedAt: 2,
  });
  await activation.markSelected({
    appId: APP_ID,
    transitionId,
    destination: LocalApplicationActivationDestination.TARGET,
    observedAt: 3,
  });
  await activation.markActivating({
    appId: APP_ID,
    transitionId,
    observedAt: 4,
  });
  await activation.completeActivation({
    appId: APP_ID,
    transitionId,
    observedAt: 5,
  });
}

/** @param {ReturnType<typeof createLocalApplicationActivation>} activation */
async function closeAdmission(activation) {
  await activation.beginChange({
    appId: APP_ID,
    action: LocalApplicationActivationAction.UPDATE,
    source: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
    target: { artifactId: ARTIFACT_B, revisionId: REVISION_B },
    observedAt: SCHEDULED_AT + 1,
  });
}

/** @param {DBClient} db */
async function claimResident(db) {
  const ownership = createLedgerServiceOwnership({
    db,
    tableName: TABLE_NAME,
  });
  return (
    await ownership.claimOwnership({
      serviceId: createLedgerServiceId({ appId: APP_ID }),
      appId: APP_ID,
      scopeId: 'schedule-cutover-root',
      principalId: 'schedule-cutover-principal',
      sessionId: createLedgerServiceSessionId(),
      ownerKind: LedgerServiceOwnerKind.RESIDENT,
      expected: null,
      claimedAt: 10,
    })
  ).ownership;
}

/**
 * @param {ReturnType<typeof createScheduleControl>} schedule
 * @param {Readonly<Record<string, any>>} owner
 */
async function prepareScheduledRun(schedule, owner) {
  const activated = await schedule.activate({
    appId: APP_ID,
    scheduleId: SCHEDULE_ID,
    revisionId: REVISION_A,
    definitionId: DEFINITION_ID,
    owner,
    observedAt: ACTIVATION_AT,
  });
  const cause = createScheduleRunCause({
    appId: APP_ID,
    scheduleId: SCHEDULE_ID,
    definitionId: DEFINITION_ID,
    scheduledAt: SCHEDULED_AT,
  });
  const runId = createWorkflowRunId({
    appId: APP_ID,
    idempotencyKey: cause.occurrenceId,
  });
  const planId = createWorkflowPlanId({
    schemaVersion: WORKFLOW_EXECUTION_PAYLOAD_SCHEMA_VERSION,
    kind: WORKFLOW_PLAN_PAYLOAD_KIND,
    appId: APP_ID,
    revisionId: REVISION_A,
    workflowId: WORKFLOW_ID,
    definition,
  });
  const scheduleAdmissionInput = {
    expectedCursor: activated.cursor,
    scheduledAt: SCHEDULED_AT,
    throughInclusive: SCHEDULED_AT,
    skipped: null,
    workflowId: WORKFLOW_ID,
    planId,
    runId,
    cause,
    owner,
    observedAt: SCHEDULED_AT,
  };
  const scheduleAdmission = await schedule.prepareWorkflowAdmission(
    scheduleAdmissionInput,
  );
  return {
    activated,
    cause,
    runId,
    scheduleAdmissionInput,
    request: {
      runId,
      appId: APP_ID,
      revisionId: REVISION_A,
      workflowId: WORKFLOW_ID,
      definition,
      input: { requestedBy: 'schedule' },
      callerMetadata: { source: 'schedule-cutover-test' },
      cause,
      scheduleAdmission,
      transitionId: `create-${runId}`,
      actor: { kind: 'resident-schedule', id: APP_ID },
      observedAt: SCHEDULED_AT,
    },
  };
}

/**
 * @param {DBClient} db
 * @param {() => Promise<void>} beforeScheduleAdmission
 * @returns {DBClient}
 */
function interceptScheduleAdmission(db, beforeScheduleAdmission) {
  let intercepted = false;
  return /** @type {DBClient} */ (
    new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transactionWrite') {
          /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
          return async (params) => {
            if (
              !intercepted &&
              params.putRequests?.some(
                ({ record }) => record.record_kind === 'schedule-occurrence',
              )
            ) {
              intercepted = true;
              await beforeScheduleAdmission();
            }
            return await target.transactionWrite(params);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    })
  );
}

describe('scheduled workflow activation cutover', () => {
  test('carries the prepared barrier generation through cutover and keeps exact replay write-free', async () => {
    const harness = createHarness();
    const transactions = jest.spyOn(harness.db, 'transactionWrite');
    try {
      await activateApplication(harness.activation);
      const owner = await claimResident(harness.db);
      const authorities = createCoordinatorAuthority({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const { authority } = await authorities.acquire({
        appId: APP_ID,
        coordinatorId: 'schedule-barrier-coordinator',
        requestId: 'acquire-schedule-barrier-coordinator',
        observedAt: 10,
      });
      const prepared = await prepareScheduledRun(harness.schedule, owner);
      const barriers = createCoordinatorQuiescenceBarrier({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const closed = await barriers.close({
        authority,
        requestId: 'close-before-scheduled-admission',
        predecessor: null,
        observedAt: SCHEDULED_AT + 1,
      });
      const reopened = await barriers.reopen({
        authority,
        requestId: 'reopen-before-scheduled-admission',
        predecessor: closed.barrier,
        observedAt: SCHEDULED_AT + 2,
      });
      const ledger = createExecutionLedger({
        db: harness.db,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
      });

      transactions.mockClear();
      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).rejects.toThrow();
      const staleAttempt = transactions.mock.calls.find(([params]) =>
        params.putRequests?.some(
          ({ record }) => record.record_kind === 'schedule-occurrence',
        ),
      )?.[0];
      expect(
        staleAttempt?.conditionChecks?.filter(
          ({ sortKeyValue }) =>
            sortKeyValue === COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
        ),
      ).toHaveLength(1);
      await expect(ledger.rebuildRun(prepared.runId)).resolves.toBeNull();
      await expect(
        harness.schedule.getOccurrence({
          occurrenceId: prepared.cause.occurrenceId,
        }),
      ).resolves.toBeNull();
      await expect(
        harness.schedule.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(prepared.activated.cursor);

      const freshAdmission = await harness.schedule.prepareWorkflowAdmission({
        ...prepared.scheduleAdmissionInput,
        observedAt: SCHEDULED_AT + 3,
      });
      transactions.mockClear();
      const created = await ledger.createWorkflowRun({
        ...prepared.request,
        scheduleAdmission: freshAdmission,
      });
      expect(created).toMatchObject({
        applied: true,
        run: { runId: prepared.runId, status: 'RUNNING' },
      });
      const accepted = transactions.mock.calls.find(([params]) =>
        params.putRequests?.some(
          ({ record }) => record.record_kind === 'schedule-occurrence',
        ),
      )?.[0];
      const acceptedBarrierChecks = accepted?.conditionChecks?.filter(
        ({ sortKeyValue }) =>
          sortKeyValue === COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
      );
      expect(acceptedBarrierChecks).toHaveLength(1);
      expect(acceptedBarrierChecks?.[0].conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            propertyName: 'state',
            propertyValue: 'OPEN',
          }),
          expect.objectContaining({
            propertyName: 'version',
            propertyValue: reopened.barrier.version,
          }),
        ]),
      );

      await barriers.close({
        authority,
        requestId: 'close-after-scheduled-admission',
        predecessor: reopened.barrier,
        observedAt: SCHEDULED_AT + 4,
      });
      transactions.mockClear();
      const replayAdmission = await harness.schedule.prepareWorkflowAdmission({
        ...prepared.scheduleAdmissionInput,
        observedAt: SCHEDULED_AT + 5,
      });
      await expect(
        ledger.createWorkflowRun({
          ...prepared.request,
          scheduleAdmission: replayAdmission,
        }),
      ).resolves.toMatchObject({ applied: false, run: created.run });
      expect(transactions).not.toHaveBeenCalled();
    } finally {
      transactions.mockRestore();
      await harness.cleanup();
    }
  });

  test.each(['create', 'replay'])(
    'a bound prepared %s requires the exact consuming ledger authority',
    async (mode) => {
      const harness = createHarness();
      const transactions = jest.spyOn(harness.db, 'transactionWrite');
      try {
        const owner = await claimResident(harness.db);
        const authority = createCoordinatorAuthority({
          db: harness.db,
          tableName: TABLE_NAME,
        });
        const first = await authority.acquire({
          appId: APP_ID,
          coordinatorId: 'schedule-coordinator-a',
          requestId: 'acquire-schedule-coordinator-a',
          observedAt: 10,
        });
        const boundSchedule = createScheduleControl({
          db: harness.db,
          tableName: TABLE_NAME,
          coordinatorAuthority: first.authority,
        });
        const prepared = await prepareScheduledRun(boundSchedule, owner);
        const ledger = createExecutionLedger({
          db: harness.db,
          tableName: TABLE_NAME,
          payloadStore: harness.payloadStore,
          coordinatorAuthority: first.authority,
        });
        const token = createCoordinatorAuthorityToken(first.authority);
        if (mode === 'replay') {
          await expect(
            ledger.createWorkflowRun(prepared.request),
          ).resolves.toMatchObject({
            applied: true,
            coordinatorAuthority: token,
          });
          await expect(
            boundSchedule.getOccurrence({
              occurrenceId: prepared.cause.occurrenceId,
            }),
          ).resolves.toMatchObject({ coordinatorAuthority: token });
          await expect(ledger.getEvents(prepared.runId)).resolves.toEqual([
            expect.objectContaining({
              type: 'workflow-run-created',
              fence: { coordinatorEpoch: 0, invocationGeneration: 0 },
              payload: expect.objectContaining({
                coordinatorAuthority: token,
              }),
            }),
          ]);
          const rebuilt = await ledger.rebuildRun(prepared.runId);
          if (!rebuilt) throw new Error('Expected retained workflow run.');
          const operatorView = createExecutionLedgerOperatorView(rebuilt);
          const serializedOperatorView = JSON.stringify(operatorView);
          for (const privateValue of [
            'coordinatorAuthority',
            'authorityId',
            'coordinatorId',
            token.authorityId,
            token.coordinatorId,
          ]) {
            expect(serializedOperatorView).not.toContain(privateValue);
          }
        }
        const successor = await authority.takeover({
          appId: APP_ID,
          coordinatorId: 'schedule-coordinator-b',
          requestId: 'replace-schedule-coordinator-a',
          observedAuthority: first.authority,
          confirmAuthorityReplacement: true,
          observedAt: SCHEDULED_AT + 1,
        });
        const unboundLedger = createExecutionLedger({
          db: harness.db,
          tableName: TABLE_NAME,
          payloadStore: harness.payloadStore,
        });
        const successorLedger = unboundLedger.bindCoordinatorAuthority(
          successor.authority,
        );
        transactions.mockClear();

        for (const otherLedger of [unboundLedger, successorLedger]) {
          await expect(
            otherLedger.createWorkflowRun(prepared.request),
          ).rejects.toThrow(/coordinator authority must match/i);
        }
        expect(transactions).not.toHaveBeenCalled();

        if (mode === 'replay') {
          await expect(
            ledger.createWorkflowRun(prepared.request),
          ).resolves.toMatchObject({
            applied: false,
            coordinatorAuthority: token,
            run: { runId: prepared.runId },
          });
          expect(transactions).not.toHaveBeenCalled();
          await expect(ledger.getEvents(prepared.runId)).resolves.toHaveLength(
            1,
          );
          const successorSchedule = createScheduleControl({
            db: harness.db,
            tableName: TABLE_NAME,
            coordinatorAuthority: successor.authority,
          });
          const successorAdmission =
            await successorSchedule.prepareWorkflowAdmission({
              ...prepared.scheduleAdmissionInput,
              observedAt: SCHEDULED_AT + 2,
            });
          await expect(
            successorLedger.createWorkflowRun({
              ...prepared.request,
              scheduleAdmission: successorAdmission,
            }),
          ).resolves.toMatchObject({
            applied: false,
            coordinatorAuthority: token,
            run: { runId: prepared.runId },
          });
          expect(transactions).not.toHaveBeenCalled();
        } else {
          await expect(
            ledger.createWorkflowRun(prepared.request),
          ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
          await expect(ledger.rebuildRun(prepared.runId)).resolves.toBeNull();
          await expect(
            boundSchedule.getOccurrence({
              occurrenceId: prepared.cause.occurrenceId,
            }),
          ).resolves.toBeNull();
          await expect(
            boundSchedule.getCursor({
              appId: APP_ID,
              scheduleId: SCHEDULE_ID,
            }),
          ).resolves.toEqual(prepared.activated.cursor);
        }
      } finally {
        transactions.mockRestore();
        await harness.cleanup();
      }
    },
  );

  test('rejects a scheduled workflow whose occurrence and creation retain different authorities', async () => {
    const harness = createHarness();
    const transactions = jest.spyOn(harness.db, 'transactionWrite');
    try {
      const owner = await claimResident(harness.db);
      const authority = createCoordinatorAuthority({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const first = await authority.acquire({
        appId: APP_ID,
        coordinatorId: 'schedule-coordinator-a',
        requestId: 'acquire-schedule-coordinator-a',
        observedAt: 10,
      });
      const schedule = createScheduleControl({
        db: harness.db,
        tableName: TABLE_NAME,
        coordinatorAuthority: first.authority,
      });
      const prepared = await prepareScheduledRun(schedule, owner);
      const ledger = createExecutionLedger({
        db: harness.db,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
        coordinatorAuthority: first.authority,
      });
      await ledger.createWorkflowRun(prepared.request);
      const occurrenceWrite = transactions.mock.calls
        .flatMap((/** @type {any[]} */ [params]) => params.putRequests ?? [])
        .find(
          (/** @type {Record<string, any>} */ { record }) =>
            record.record_kind === 'schedule-occurrence',
        );
      if (!occurrenceWrite) {
        throw new Error('Expected the atomic schedule occurrence write.');
      }
      const successor = await authority.takeover({
        appId: APP_ID,
        coordinatorId: 'schedule-coordinator-b',
        requestId: 'replace-schedule-coordinator-a',
        observedAuthority: first.authority,
        confirmAuthorityReplacement: true,
        observedAt: SCHEDULED_AT + 1,
      });
      await harness.db.update({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: occurrenceWrite.record.run_id,
        sortKeyName: 'sort_key',
        sortKeyValue: occurrenceWrite.record.sort_key,
        updates: [
          {
            property: ['coordinator_authority'],
            propertyValue: createCoordinatorAuthorityToken(successor.authority),
          },
        ],
      });

      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).rejects.toMatchObject({
        name: ExecutionLedgerProjectionError.name,
        reason: 'scheduled workflow admission coordinator authority mismatch',
      });
    } finally {
      transactions.mockRestore();
      await harness.cleanup();
    }
  });

  test('coordinator takeover fences the combined occurrence and workflow transaction atomically', async () => {
    const harness = createHarness();
    try {
      const owner = await claimResident(harness.db);
      const authority = createCoordinatorAuthority({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const first = await authority.acquire({
        appId: APP_ID,
        coordinatorId: 'schedule-coordinator-a',
        requestId: 'acquire-schedule-coordinator-a',
        observedAt: 10,
      });
      let replacements = 0;
      const racingDb = interceptScheduleAdmission(harness.db, async () => {
        replacements += 1;
        await authority.takeover({
          appId: APP_ID,
          coordinatorId: 'schedule-coordinator-b',
          requestId: 'replace-schedule-coordinator-a',
          observedAuthority: first.authority,
          confirmAuthorityReplacement: true,
          observedAt: SCHEDULED_AT + 1,
        });
      });
      const schedule = createScheduleControl({
        db: racingDb,
        tableName: TABLE_NAME,
        coordinatorAuthority: first.authority,
      });
      const prepared = await prepareScheduledRun(schedule, owner);
      const ledger = createExecutionLedger({
        db: racingDb,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
        coordinatorAuthority: first.authority,
      });

      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      expect(replacements).toBe(1);
      await expect(ledger.rebuildRun(prepared.runId)).resolves.toBeNull();
      await expect(ledger.getEvents(prepared.runId)).resolves.toEqual([]);
      await expect(
        schedule.getOccurrence({ occurrenceId: prepared.cause.occurrenceId }),
      ).resolves.toBeNull();
      await expect(
        schedule.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(prepared.activated.cursor);
      await expect(
        createLedgerServiceOwnership({
          db: harness.db,
          tableName: TABLE_NAME,
        }).getOwnership({ serviceId: owner.serviceId }),
      ).resolves.toEqual(owner);
    } finally {
      await harness.cleanup();
    }
  });

  test('a replacement resident preserves progress while the stale owner loses its fence', async () => {
    const harness = createHarness();
    try {
      await activateApplication(harness.activation);
      const ownership = createLedgerServiceOwnership({
        db: harness.db,
        tableName: TABLE_NAME,
      });
      const firstOwner = await claimResident(harness.db);
      const activated = await harness.schedule.activate({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
        revisionId: REVISION_A,
        definitionId: DEFINITION_ID,
        owner: firstOwner,
        observedAt: ACTIVATION_AT,
      });
      const advanced = await harness.schedule.advance({
        expectedCursor: activated.cursor,
        throughInclusive: SCHEDULED_AT,
        owner: firstOwner,
        observedAt: SCHEDULED_AT,
      });
      await ownership.releaseOwnership({
        serviceId: firstOwner.serviceId,
        scopeId: firstOwner.scopeId,
        principalId: firstOwner.principalId,
        sessionId: firstOwner.sessionId,
        generation: firstOwner.generation,
      });
      const replacementOwner = await claimResident(harness.db);

      await expect(
        harness.schedule.activate({
          appId: APP_ID,
          scheduleId: SCHEDULE_ID,
          revisionId: REVISION_A,
          definitionId: DEFINITION_ID,
          owner: replacementOwner,
          observedAt: SCHEDULED_AT + 60_000,
        }),
      ).resolves.toEqual({ applied: false, cursor: advanced.cursor });
      const replacementAdvance = await harness.schedule.advance({
        expectedCursor: advanced.cursor,
        throughInclusive: SCHEDULED_AT + 60_000,
        owner: replacementOwner,
        observedAt: SCHEDULED_AT + 60_000,
      });
      expect(replacementAdvance).toMatchObject({
        applied: true,
        cursor: {
          activationBoundary: activated.cursor.activationBoundary,
          horizon: SCHEDULED_AT + 60_000,
          version: advanced.cursor.version + 1,
        },
      });
      await expect(
        harness.schedule.advance({
          expectedCursor: advanced.cursor,
          throughInclusive: SCHEDULED_AT + 60_000,
          owner: firstOwner,
          observedAt: SCHEDULED_AT + 60_000,
        }),
      ).rejects.toHaveProperty('name', 'ConditionalCheckFailedException');
    } finally {
      await harness.cleanup();
    }
  });

  test('same-occurrence cursor competitors converge on one workflow admission', async () => {
    const harness = createHarness();
    try {
      await activateApplication(harness.activation);
      const owner = await claimResident(harness.db);
      const first = await prepareScheduledRun(harness.schedule, owner);
      const second = await prepareScheduledRun(harness.schedule, owner);
      const ledger = createExecutionLedger({
        db: harness.db,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
      });

      const results = await Promise.all([
        ledger.createWorkflowRun(first.request),
        ledger.createWorkflowRun(second.request),
      ]);
      expect(results.map(({ applied }) => applied).sort()).toEqual([
        false,
        true,
      ]);
      expect(results[0].run).toEqual(results[1].run);
      await expect(ledger.getEvents(first.runId)).resolves.toHaveLength(1);
      await expect(
        harness.schedule.getOccurrence({
          occurrenceId: first.cause.occurrenceId,
        }),
      ).resolves.toMatchObject({ runId: first.runId, cause: first.cause });
      await expect(
        harness.schedule.getCursor({
          appId: APP_ID,
          scheduleId: SCHEDULE_ID,
        }),
      ).resolves.toMatchObject({
        horizon: SCHEDULED_AT,
        version: first.activated.cursor.version + 1,
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('source-mode admission loses atomically when a managed activation appears', async () => {
    const harness = createHarness();
    try {
      const owner = await claimResident(harness.db);
      const racingDb = interceptScheduleAdmission(harness.db, async () => {
        await harness.activation.beginInstall({
          appId: APP_ID,
          target: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
          observedAt: SCHEDULED_AT + 1,
        });
      });
      const racingSchedule = createScheduleControl({
        db: racingDb,
        tableName: TABLE_NAME,
      });
      const prepared = await prepareScheduledRun(racingSchedule, owner);
      const ledger = createExecutionLedger({
        db: racingDb,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
      });

      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
      await expect(ledger.rebuildRun(prepared.runId)).resolves.toBeNull();
      await expect(
        harness.schedule.getOccurrence({
          occurrenceId: prepared.cause.occurrenceId,
        }),
      ).resolves.toBeNull();
      await expect(
        harness.schedule.getCursor({
          appId: APP_ID,
          scheduleId: SCHEDULE_ID,
        }),
      ).resolves.toEqual(prepared.activated.cursor);
      await expect(
        harness.activation.get({ appId: APP_ID }),
      ).resolves.toMatchObject({
        phase: 'QUIESCING',
        selected: null,
        desired: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('a QUIESCING transition wins without advancing the cursor or creating either projection', async () => {
    const harness = createHarness();
    try {
      await activateApplication(harness.activation);
      const owner = await claimResident(harness.db);
      const racingDb = interceptScheduleAdmission(harness.db, async () => {
        await closeAdmission(harness.activation);
      });
      const racingSchedule = createScheduleControl({
        db: racingDb,
        tableName: TABLE_NAME,
      });
      const prepared = await prepareScheduledRun(racingSchedule, owner);
      const ledger = createExecutionLedger({
        db: racingDb,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
      });

      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).rejects.toBeInstanceOf(LocalApplicationAdmissionClosedError);
      await expect(ledger.rebuildRun(prepared.runId)).resolves.toBeNull();
      await expect(
        harness.schedule.getOccurrence({
          occurrenceId: prepared.cause.occurrenceId,
        }),
      ).resolves.toBeNull();
      await expect(
        harness.schedule.getCursor({
          appId: APP_ID,
          scheduleId: SCHEDULE_ID,
        }),
      ).resolves.toEqual(prepared.activated.cursor);
    } finally {
      await harness.cleanup();
    }
  });

  test('an exact occurrence and workflow pair still replays after admission closes', async () => {
    const harness = createHarness();
    try {
      await activateApplication(harness.activation);
      const owner = await claimResident(harness.db);
      const prepared = await prepareScheduledRun(harness.schedule, owner);
      const ledger = createExecutionLedger({
        db: harness.db,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
      });
      const created = await ledger.createWorkflowRun(prepared.request);
      expect(created).toMatchObject({
        applied: true,
        run: { runId: prepared.runId, status: 'RUNNING' },
      });

      await closeAdmission(harness.activation);
      await expect(
        harness.activation.get({ appId: APP_ID }),
      ).resolves.toMatchObject({
        phase: 'QUIESCING',
        selected: { artifactId: ARTIFACT_A, revisionId: REVISION_A },
      });

      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).resolves.toMatchObject({
        applied: false,
        run: created.run,
      });
      await expect(ledger.getEvents(prepared.runId)).resolves.toHaveLength(1);
      await expect(
        harness.schedule.getOccurrence({
          occurrenceId: prepared.cause.occurrenceId,
        }),
      ).resolves.toMatchObject({
        runId: prepared.runId,
        cause: prepared.cause,
      });
    } finally {
      await harness.cleanup();
    }
  });

  test('a winning schedule admission is visible to the following quiescence scan', async () => {
    const harness = createHarness();
    try {
      await activateApplication(harness.activation);
      const owner = await claimResident(harness.db);
      const prepared = await prepareScheduledRun(harness.schedule, owner);
      const ledger = createExecutionLedger({
        db: harness.db,
        tableName: TABLE_NAME,
        payloadStore: harness.payloadStore,
      });

      await expect(
        ledger.createWorkflowRun(prepared.request),
      ).resolves.toMatchObject({
        applied: true,
        run: { runId: prepared.runId, status: 'RUNNING' },
      });
      await closeAdmission(harness.activation);

      await expect(
        inspectLocalApplicationQuiescence({ ledger, appId: APP_ID }),
      ).resolves.toMatchObject({
        quiescent: false,
        blockerCount: 1,
        blockers: [
          {
            runId: prepared.runId,
            revisionId: REVISION_A,
            kind: 'workflow',
            status: 'RUNNING',
            updatedAt: SCHEDULED_AT,
          },
        ],
      });
    } finally {
      await harness.cleanup();
    }
  });
});
