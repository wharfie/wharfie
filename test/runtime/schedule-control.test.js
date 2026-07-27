/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  createScheduleControl,
  reconcilePreparedScheduleWorkflowAdmission,
  resolvePreparedScheduleWorkflowAdmission,
} from '../../src/core/lib/db/tables/schedule-control.js';
import {
  LocalApplicationActivationDestination,
  createLocalApplicationActivation,
  getLocalApplicationRunCreationFence,
} from '../../src/core/lib/db/tables/local-application-activation.js';
import {
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { createScheduleRunCause } from '../../src/core/lib/ledger/schedule-occurrence.js';
import { createWorkflowRunId } from '../../src/core/lib/ledger/workflow-execution-contract.js';

const TABLE_NAME = 'schedule-control-test';
const APP_ID = 'scheduled-app';
const SCHEDULE_ID = 'hourly-refresh';
const WORKFLOW_ID = 'refresh';
const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;
const DEFINITION_A = `wsd_${'A'.repeat(43)}`;
const DEFINITION_B = `wsd_${'B'.repeat(42)}A`;
const PLAN_A = `wfp_${'A'.repeat(43)}`;
const ARTIFACT_A = `waf1_${'A'.repeat(43)}`;
const MINUTE = 60_000;

/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    // eslint-disable-next-line no-await-in-loop
    await cleanups.pop()?.();
  }
});

function createHarness() {
  const path = mkdtempSync(join(tmpdir(), 'wharfie-schedule-control-'));
  const db = createVanillaDB({ path });
  const control = createScheduleControl({
    db,
    tableName: TABLE_NAME,
    now: () => 9 * MINUTE + 123,
  });
  const ownership = createLedgerServiceOwnership({
    db,
    tableName: TABLE_NAME,
  });
  cleanups.push(async () => {
    await db.close();
    rmSync(path, { recursive: true, force: true });
  });
  return { db, control, ownership };
}

/** @param {import('../../src/core/lib/db/base.js').DBClient} db @param {string} [revisionId] */
async function activateApplication(db, revisionId = REVISION_A) {
  const activation = createLocalApplicationActivation({
    db,
    tableName: TABLE_NAME,
  });
  const installing = await activation.beginInstall({
    appId: APP_ID,
    target: { artifactId: ARTIFACT_A, revisionId },
    observedAt: 1,
  });
  const transitionId = installing.activation.transition.transitionId;
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

/** @param {ReturnType<typeof createLedgerServiceOwnership>} ownership @param {Record<string, any>} [overrides] */
async function claimResident(ownership, overrides = {}) {
  return (
    await ownership.claimOwnership({
      serviceId: createLedgerServiceId({ appId: APP_ID }),
      appId: APP_ID,
      scopeId: 'local-root',
      principalId: 'developer',
      sessionId: createLedgerServiceSessionId(),
      ownerKind: LedgerServiceOwnerKind.RESIDENT,
      expected: null,
      claimedAt: 10,
      ...overrides,
    })
  ).ownership;
}

/** @param {ReturnType<typeof createScheduleControl>} control @param {Readonly<Record<string, any>>} owner @param {Record<string, any>} [overrides] */
async function activateSchedule(control, owner, overrides = {}) {
  return await control.activate({
    appId: APP_ID,
    scheduleId: SCHEDULE_ID,
    revisionId: REVISION_A,
    definitionId: DEFINITION_A,
    owner,
    observedAt: 2 * MINUTE + 999,
    ...overrides,
  });
}

/** @param {Readonly<Record<string, any>>} cursor @param {Readonly<Record<string, any>>} owner @param {Record<string, any>} [overrides] */
function occurrenceInput(cursor, owner, overrides = {}) {
  const scheduledAt = cursor.horizon + 2 * MINUTE;
  const cause = createScheduleRunCause({
    appId: APP_ID,
    scheduleId: SCHEDULE_ID,
    definitionId: cursor.definitionId,
    scheduledAt,
  });
  return {
    expectedCursor: cursor,
    scheduledAt,
    throughInclusive: cursor.horizon + 3 * MINUTE,
    skipped: {
      count: 1,
      firstScheduledAtMs: cursor.horizon + MINUTE,
      lastScheduledAtMs: cursor.horizon + MINUTE,
    },
    workflowId: WORKFLOW_ID,
    planId: PLAN_A,
    runId: createWorkflowRunId({
      appId: APP_ID,
      idempotencyKey: cause.occurrenceId,
    }),
    cause,
    owner,
    observedAt: 8 * MINUTE,
    ...overrides,
  };
}

/** @param {Record<string, any>} input @param {Readonly<Record<string, any>>} [cursor] */
function expectedFromInput(input, cursor = input.expectedCursor) {
  return {
    appId: cursor.appId,
    revisionId: cursor.revisionId,
    scheduleId: cursor.scheduleId,
    definitionId: cursor.definitionId,
    workflowId: input.workflowId,
    planId: input.planId,
    runId: input.runId,
    cause: input.cause,
  };
}

/** @param {import('../../src/core/lib/db/base.js').DBClient} db */
function storeContext(db) {
  return { db, tableName: TABLE_NAME };
}

describe('atomic schedule control', () => {
  test('activates at a minute boundary and preserves exact-definition progress', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);

    const first = await activateSchedule(control, owner);
    expect(first).toEqual({
      applied: true,
      cursor: {
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
        revisionId: REVISION_A,
        definitionId: DEFINITION_A,
        activationBoundary: 2 * MINUTE,
        horizon: 2 * MINUTE,
        version: 1,
        updatedAt: 2 * MINUTE + 999,
      },
    });

    const advanced = await control.advance({
      expectedCursor: first.cursor,
      throughInclusive: 5 * MINUTE,
      owner,
      observedAt: 5 * MINUTE + 5,
    });
    const replay = await activateSchedule(control, owner, {
      observedAt: 9 * MINUTE,
    });
    expect(replay).toEqual({ applied: false, cursor: advanced.cursor });

    const changed = await activateSchedule(control, owner, {
      revisionId: REVISION_B,
      definitionId: DEFINITION_B,
      observedAt: 9 * MINUTE + 999,
    }).catch((error) => error);
    // The selected application revision remains A, so definition B cannot
    // become schedulable before the activation selection changes.
    expect(changed.name).toBe('LocalApplicationAdmissionClosedError');
    expect(
      await control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
    ).toEqual(advanced.cursor);
  });

  test('resets a changed definition on the same selected revision', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const first = await activateSchedule(control, owner);
    const advanced = await control.advance({
      expectedCursor: first.cursor,
      throughInclusive: 5 * MINUTE,
      owner,
      observedAt: 5 * MINUTE,
    });

    const changed = await activateSchedule(control, owner, {
      definitionId: DEFINITION_B,
      observedAt: 9 * MINUTE + 999,
    });
    expect(changed).toEqual({
      applied: true,
      cursor: {
        ...advanced.cursor,
        definitionId: DEFINITION_B,
        activationBoundary: 9 * MINUTE,
        horizon: 9 * MINUTE,
        version: 3,
        updatedAt: 9 * MINUTE + 999,
      },
    });
  });

  test('uses the durable updatedAt floor when a definition changes after the wall clock regresses', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const first = await activateSchedule(control, owner);
    const advanced = await control.advance({
      expectedCursor: first.cursor,
      throughInclusive: 7 * MINUTE,
      owner,
      observedAt: 7 * MINUTE + 42,
    });

    const changed = await activateSchedule(control, owner, {
      definitionId: DEFINITION_B,
      observedAt: 4 * MINUTE + 999,
    });
    expect(changed).toEqual({
      applied: true,
      cursor: {
        ...advanced.cursor,
        definitionId: DEFINITION_B,
        activationBoundary: 7 * MINUTE,
        horizon: 7 * MINUTE,
        version: advanced.cursor.version + 1,
        updatedAt: 7 * MINUTE + 42,
      },
    });
  });

  test('fences no-due advancement by ACTIVE selection, owner, and cursor CAS', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);
    const advanced = await control.advance({
      expectedCursor: activated.cursor,
      throughInclusive: 3 * MINUTE,
      owner,
      observedAt: 3 * MINUTE,
    });

    await expect(
      control.advance({
        expectedCursor: activated.cursor,
        throughInclusive: 4 * MINUTE,
        owner,
        observedAt: 4 * MINUTE,
      }),
    ).rejects.toHaveProperty('name', 'ConditionalCheckFailedException');

    await ownership.releaseOwnership({
      serviceId: owner.serviceId,
      scopeId: owner.scopeId,
      principalId: owner.principalId,
      sessionId: owner.sessionId,
      generation: owner.generation,
    });
    await expect(
      control.advance({
        expectedCursor: advanced.cursor,
        throughInclusive: 4 * MINUTE,
        owner,
        observedAt: 4 * MINUTE,
      }),
    ).rejects.toHaveProperty('name', 'ConditionalCheckFailedException');
  });

  test('reconciles an advance whose committed response was lost', async () => {
    const { db, ownership } = createHarness();
    let loseNextResponse = false;
    const instrumented = {
      ...db,
      /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
      async transactionWrite(params) {
        await db.transactionWrite(params);
        if (loseNextResponse) {
          loseNextResponse = false;
          throw new Error('simulated response loss');
        }
      },
    };
    const control = createScheduleControl({
      db: instrumented,
      tableName: TABLE_NAME,
    });
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);

    loseNextResponse = true;
    await expect(
      control.advance({
        expectedCursor: activated.cursor,
        throughInclusive: 4 * MINUTE,
        owner,
        observedAt: 4 * MINUTE,
      }),
    ).resolves.toMatchObject({
      applied: false,
      cursor: { horizon: 4 * MINUTE, version: 2 },
    });
  });

  test('prepares private atomic create rows and reconciles both sides together', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);
    const input = occurrenceInput(activated.cursor, owner);
    const expected = expectedFromInput(input);
    const prepared = await control.prepareWorkflowAdmission(input);
    const extension = resolvePreparedScheduleWorkflowAdmission(
      prepared,
      expected,
      storeContext(db),
    );

    expect(extension.mode).toBe('create');
    expect(extension.conditionChecks).toHaveLength(1);
    expect(extension.conditionChecks[0].conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyName: 'owner_kind',
          propertyValue: 'resident',
        }),
        expect.objectContaining({
          propertyName: 'generation',
          propertyValue: owner.generation,
        }),
      ]),
    );
    expect(extension.putRequests).toHaveLength(2);
    expect(Object.isFrozen(extension)).toBe(true);
    expect(Object.isFrozen(extension.conditionChecks)).toBe(true);
    expect(Object.isFrozen(extension.putRequests)).toBe(true);
    expect(() => {
      extension.conditionChecks[0].conditions[0].propertyValue = 'forged';
    }).toThrow(TypeError);
    expect(() => {
      extension.putRequests[0].record.horizon = 99 * MINUTE;
    }).toThrow(TypeError);
    const resolvedAgain = resolvePreparedScheduleWorkflowAdmission(
      prepared,
      expected,
      storeContext(db),
    );
    expect(resolvedAgain.conditionChecks).toBe(extension.conditionChecks);
    expect(resolvedAgain.putRequests).toBe(extension.putRequests);
    expect(resolvedAgain.conditionChecks[0].conditions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          propertyName: 'owner_kind',
          propertyValue: 'resident',
        }),
      ]),
    );
    await expect(
      reconcilePreparedScheduleWorkflowAdmission(
        prepared,
        expected,
        storeContext(db),
      ),
    ).resolves.toEqual({ status: 'absent' });

    const activationFence = await getLocalApplicationRunCreationFence({
      db,
      tableName: TABLE_NAME,
      appId: APP_ID,
      revisionId: REVISION_A,
    });
    await db.transactionWrite({
      tableName: TABLE_NAME,
      conditionChecks: [activationFence, ...extension.conditionChecks],
      putRequests: [
        ...extension.putRequests,
        {
          keyName: 'run_id',
          sortKeyName: 'sort_key',
          record: {
            run_id: input.runId,
            sort_key: 'test/workflow-run',
            record_kind: 'test-workflow-run',
          },
          conditions: [
            { conditionType: 'NOT_EXISTS', propertyName: 'sort_key' },
          ],
        },
      ],
    });

    const reconciled = await reconcilePreparedScheduleWorkflowAdmission(
      prepared,
      expected,
      storeContext(db),
    );
    expect(reconciled).toEqual({
      status: 'exact',
      occurrence: {
        ...expected,
        occurrenceId: input.cause.occurrenceId,
        scheduledAt: input.scheduledAt,
        windowAfterExclusive: activated.cursor.horizon,
        throughInclusive: input.throughInclusive,
        scannedMinuteCount: 3,
        skipped: input.skipped,
        createdAt: input.observedAt,
      },
    });
    expect(Object.isFrozen(reconciled.occurrence)).toBe(true);
    expect(
      await control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
    ).toMatchObject({
      horizon: input.throughInclusive,
      version: 2,
    });
    await expect(
      control.getOccurrence({ occurrenceId: input.cause.occurrenceId }),
    ).resolves.toEqual(reconciled.occurrence);
  });

  test('returns an exact write-free replay after ambiguous response loss', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);
    const input = occurrenceInput(activated.cursor, owner);
    const expected = expectedFromInput(input);
    const first = await control.prepareWorkflowAdmission(input);
    const extension = resolvePreparedScheduleWorkflowAdmission(
      first,
      expected,
      storeContext(db),
    );
    const activationFence = await getLocalApplicationRunCreationFence({
      db,
      tableName: TABLE_NAME,
      appId: APP_ID,
      revisionId: REVISION_A,
    });
    await db.transactionWrite({
      tableName: TABLE_NAME,
      conditionChecks: [activationFence, ...extension.conditionChecks],
      putRequests: [...extension.putRequests],
    });

    const replay = await control.prepareWorkflowAdmission({
      ...input,
      observedAt: input.observedAt + 1,
    });
    expect(
      resolvePreparedScheduleWorkflowAdmission(
        replay,
        expected,
        storeContext(db),
      ),
    ).toEqual({
      mode: 'replay',
      conditionChecks: [],
      putRequests: [],
    });
    await expect(
      reconcilePreparedScheduleWorkflowAdmission(
        first,
        expected,
        storeContext(db),
      ),
    ).resolves.toMatchObject({ status: 'exact' });
  });

  test('rejects a persisted occurrence whose scan window exceeds the hard bound', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);
    const input = occurrenceInput(activated.cursor, owner);
    const expected = expectedFromInput(input);
    const prepared = await control.prepareWorkflowAdmission(input);
    const extension = resolvePreparedScheduleWorkflowAdmission(
      prepared,
      expected,
      storeContext(db),
    );
    const malformedThrough =
      activated.cursor.horizon + (366 * 24 * 60 + 1) * MINUTE;
    const malformedPuts = extension.putRequests.map((request) =>
      request.record.record_kind === 'schedule-occurrence'
        ? {
            ...request,
            record: {
              ...request.record,
              through_inclusive: malformedThrough,
              scanned_minute_count: 366 * 24 * 60 + 1,
              created_at: malformedThrough,
            },
          }
        : request,
    );
    const activationFence = await getLocalApplicationRunCreationFence({
      db,
      tableName: TABLE_NAME,
      appId: APP_ID,
      revisionId: REVISION_A,
    });
    await db.transactionWrite({
      tableName: TABLE_NAME,
      conditionChecks: [activationFence, ...extension.conditionChecks],
      putRequests: malformedPuts,
    });

    await expect(
      control.getOccurrence({ occurrenceId: input.cause.occurrenceId }),
    ).rejects.toThrow(/window is invalid/);
  });

  test('rejects forged preparations, moved identities, invalid run IDs, and durable conflicts', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);
    const input = occurrenceInput(activated.cursor, owner);
    const expected = expectedFromInput(input);
    const prepared = await control.prepareWorkflowAdmission(input);

    const otherDbReference = { ...db };
    expect(() =>
      resolvePreparedScheduleWorkflowAdmission(prepared, expected, {
        db: otherDbReference,
        tableName: TABLE_NAME,
      }),
    ).toThrow(/another durable store/);
    expect(() =>
      resolvePreparedScheduleWorkflowAdmission(prepared, expected, {
        db,
        tableName: `${TABLE_NAME}-other`,
      }),
    ).toThrow(/another durable store/);
    await expect(
      reconcilePreparedScheduleWorkflowAdmission(prepared, expected, {
        db: otherDbReference,
        tableName: TABLE_NAME,
      }),
    ).rejects.toThrow(/another durable store/);
    await expect(
      control.getOccurrence({ occurrenceId: input.cause.occurrenceId }),
    ).resolves.toBeNull();

    expect(() =>
      resolvePreparedScheduleWorkflowAdmission({}, expected, storeContext(db)),
    ).toThrow(/not created by this module/);
    expect(() =>
      resolvePreparedScheduleWorkflowAdmission(
        prepared,
        {
          ...expected,
          workflowId: 'another-workflow',
        },
        storeContext(db),
      ),
    ).toThrow(/identity changed/);
    await expect(
      control.prepareWorkflowAdmission({
        ...input,
        runId: createWorkflowRunId({
          appId: APP_ID,
          idempotencyKey: 'wrong-idempotency-key',
        }),
      }),
    ).rejects.toThrow(/identities conflict/);
    await expect(
      control.prepareWorkflowAdmission({
        ...input,
        observedAt: input.throughInclusive - 1,
      }),
    ).rejects.toThrow(/must not precede/);
    await expect(
      control.prepareWorkflowAdmission({
        ...input,
        skipped: {
          ...input.skipped,
          count: 3,
        },
      }),
    ).rejects.toThrow(/evaluated window/);
    await expect(
      control.prepareWorkflowAdmission({
        ...input,
        skipped: {
          count: 2,
          firstScheduledAtMs: activated.cursor.horizon + MINUTE,
          lastScheduledAtMs: activated.cursor.horizon + MINUTE,
        },
      }),
    ).rejects.toThrow(/evaluated window/);
    await expect(
      control.getCursor(
        /** @type {any} */ ({
          appId: APP_ID,
          scheduleId: SCHEDULE_ID,
          policy: 'invented',
        }),
      ),
    ).rejects.toThrow(/must contain/);
    await expect(
      control.advance({
        expectedCursor: activated.cursor,
        throughInclusive:
          activated.cursor.horizon + (366 * 24 * 60 + 1) * MINUTE,
        owner,
        observedAt: activated.cursor.horizon + (366 * 24 * 60 + 1) * MINUTE,
      }),
    ).rejects.toThrow(/minute bound/);

    const extension = resolvePreparedScheduleWorkflowAdmission(
      prepared,
      expected,
      storeContext(db),
    );
    const activationFence = await getLocalApplicationRunCreationFence({
      db,
      tableName: TABLE_NAME,
      appId: APP_ID,
      revisionId: REVISION_A,
    });
    await db.transactionWrite({
      tableName: TABLE_NAME,
      conditionChecks: [activationFence, ...extension.conditionChecks],
      putRequests: [...extension.putRequests],
    });
    await expect(
      control.prepareWorkflowAdmission({
        ...input,
        workflowId: 'another-workflow',
      }),
    ).rejects.toThrow(/conflicts with durable state/);
  });
});
