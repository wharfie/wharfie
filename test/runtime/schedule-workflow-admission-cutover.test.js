/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { createExecutionLedger } from '../../src/core/lib/db/tables/execution-ledger.js';
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
  const scheduleAdmission = await schedule.prepareWorkflowAdmission({
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
  });
  return {
    activated,
    cause,
    runId,
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
