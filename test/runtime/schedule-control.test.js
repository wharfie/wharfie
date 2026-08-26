/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import {
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
  createCoordinatorAuthorityFence,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
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

async function createCoordinatorHarness() {
  const harness = createHarness();
  await activateApplication(harness.db);
  const owner = await claimResident(harness.ownership);
  const authorities = createCoordinatorAuthority({
    db: harness.db,
    tableName: TABLE_NAME,
  });
  const { authority } = await authorities.acquire({
    appId: APP_ID,
    coordinatorId: 'coordinator-a',
    requestId: 'acquire-a',
    observedAt: 30,
  });
  const control = createScheduleControl({
    db: harness.db,
    tableName: TABLE_NAME,
    coordinatorAuthority: authority,
  });
  return { ...harness, control, owner, authorities, authority };
}

/**
 * @param {ReturnType<typeof createCoordinatorAuthority>} authorities
 * @param {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} observedAuthority
 */
async function takeOverCoordinator(authorities, observedAuthority) {
  return (
    await authorities.takeover({
      appId: APP_ID,
      coordinatorId: 'coordinator-b',
      requestId: 'takeover-b',
      observedAuthority,
      confirmAuthorityReplacement: true,
      observedAt: 40,
    })
  ).authority;
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} db
 * @param {number} [transactionNumber]
 */
function createTransactionBarrier(db, transactionNumber = 1) {
  /** @type {() => void} */
  let notifyReached = () => {};
  /** @type {() => void} */
  let release = () => {};
  const reached = new Promise((resolve) => {
    notifyReached = () => resolve(undefined);
  });
  const released = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let transactionCount = 0;
  const instrumented = {
    ...db,
    /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
    async transactionWrite(params) {
      transactionCount += 1;
      if (transactionCount === transactionNumber) {
        notifyReached();
        await released;
      }
      await db.transactionWrite(params);
    },
  };
  return { db: instrumented, reached, release };
}

/**
 * @param {ReturnType<typeof createScheduleControl>} control
 * @param {Readonly<Record<string, any>>} owner
 * @param {string} operation
 */
async function prepareCheckOnlyRequest(control, owner, operation) {
  const activated = await activateSchedule(control, owner);
  const progressed =
    operation === 'progressed advance'
      ? await control.advance({
          expectedCursor: activated.cursor,
          throughInclusive: 5 * MINUTE,
          owner,
          observedAt: 5 * MINUTE,
        })
      : activated;
  return {
    cursor: progressed.cursor,
    transactionNumber: operation === 'progressed advance' ? 2 : 1,
    /** @param {ReturnType<typeof createScheduleControl>} target */
    run(target) {
      return operation === 'activate'
        ? activateSchedule(target, owner)
        : target.advance({
            expectedCursor: activated.cursor,
            throughInclusive:
              operation === 'progressed advance'
                ? 4 * MINUTE
                : activated.cursor.horizon,
            owner,
            observedAt: 4 * MINUTE,
          });
    },
  };
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

describe('coordinator-bound schedule control', () => {
  test.each(['token', 'snapshot'])(
    'binds activate, advance, and preparation to a full stable %s across heartbeats',
    async (binding) => {
      const { db, owner, authorities, authority } =
        await createCoordinatorHarness();
      const token = createCoordinatorAuthorityToken(authority);
      const { authority: heartbeat } = await authorities.heartbeat({
        authority,
        requestId: 'heartbeat-a',
        observedAt: 31,
      });
      expect(heartbeat.recordVersion).toBeGreaterThan(authority.recordVersion);
      const control = createScheduleControl({
        db,
        tableName: TABLE_NAME,
        coordinatorAuthority: binding === 'token' ? token : authority,
      });
      const activated = await activateSchedule(control, owner);
      expect(activated.applied).toBe(true);
      const advanced = await control.advance({
        expectedCursor: activated.cursor,
        throughInclusive: 3 * MINUTE,
        owner,
        observedAt: 3 * MINUTE,
      });
      expect(advanced.applied).toBe(true);
      const input = occurrenceInput(advanced.cursor, owner);
      const prepared = await control.prepareWorkflowAdmission(input);
      const extension = resolvePreparedScheduleWorkflowAdmission(
        prepared,
        expectedFromInput(input),
        {
          ...storeContext(db),
          coordinatorAuthority: binding === 'token' ? heartbeat : token,
        },
      );
      expect(extension.coordinatorAuthority).toEqual(token);
      expect(Object.isFrozen(extension.coordinatorAuthority)).toBe(true);
      expect(extension.mode).toBe('create');
    },
  );

  test.each(['activate', 'advance', 'prepare'])(
    'rejects a different application authority before %s touches durable state',
    async (operation) => {
      const { db, control, owner, authorities } =
        await createCoordinatorHarness();
      const activated = await activateSchedule(control, owner);
      const { authority: otherAuthority } = await authorities.acquire({
        appId: 'another-app',
        coordinatorId: 'another-coordinator',
        requestId: 'acquire-another-app',
        observedAt: 30,
      });
      const inaccessibleDb = {
        ...db,
        async get() {
          throw new Error('wrong-app request must not read durable state');
        },
        async transactionWrite() {
          throw new Error('wrong-app request must not write durable state');
        },
      };
      const otherControl = createScheduleControl({
        db: inaccessibleDb,
        tableName: TABLE_NAME,
        coordinatorAuthority: otherAuthority,
      });
      const result =
        operation === 'activate'
          ? activateSchedule(otherControl, owner)
          : operation === 'advance'
            ? otherControl.advance({
                expectedCursor: activated.cursor,
                throughInclusive: 4 * MINUTE,
                owner,
                observedAt: 4 * MINUTE,
              })
            : otherControl.prepareWorkflowAdmission(
                occurrenceInput(activated.cursor, owner),
              );
      await expect(result).rejects.toThrow(/must bind the mutated appId/);
      await expect(
        control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(activated.cursor);
    },
  );

  test.each(['activate', 'advance'])(
    'fences an in-flight %s when B takes over before its transaction',
    async (operation) => {
      const { db, control, owner, authorities, authority } =
        await createCoordinatorHarness();
      const before =
        operation === 'advance'
          ? (await activateSchedule(control, owner)).cursor
          : null;
      /** @param {ReturnType<typeof createScheduleControl>} target */
      const mutate = (target) =>
        before
          ? target.advance({
              expectedCursor: before,
              throughInclusive: 4 * MINUTE,
              owner,
              observedAt: 4 * MINUTE,
            })
          : activateSchedule(target, owner);
      const barrier = createTransactionBarrier(db);
      const predecessor = createScheduleControl({
        db: barrier.db,
        tableName: TABLE_NAME,
        coordinatorAuthority: authority,
      });
      const outcome = mutate(predecessor).catch((error) => error);
      await barrier.reached;
      let successorAuthority;
      try {
        // The authority store uses the raw shared DB, not the paused wrapper.
        successorAuthority = await takeOverCoordinator(authorities, authority);
      } finally {
        barrier.release();
      }
      expect(await outcome).toBeInstanceOf(CoordinatorAuthorityStaleError);
      await expect(
        control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(before);

      const successor = createScheduleControl({
        db,
        tableName: TABLE_NAME,
        coordinatorAuthority: successorAuthority,
      });
      const accepted = await mutate(successor);
      expect(accepted.applied).toBe(true);
      expect(accepted.cursor.horizon).toBe(
        operation === 'advance' ? 4 * MINUTE : 2 * MINUTE,
      );
      await expect(
        successor.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(accepted.cursor);
    },
  );

  test.each(['activate', 'advance', 'progressed advance'])(
    'fences the %s check-only transaction and permits current B to replay',
    async (operation) => {
      const { db, control, owner, authorities, authority } =
        await createCoordinatorHarness();
      const request = await prepareCheckOnlyRequest(control, owner, operation);
      const barrier = createTransactionBarrier(db, request.transactionNumber);
      const predecessor = createScheduleControl({
        db: barrier.db,
        tableName: TABLE_NAME,
        coordinatorAuthority: authority,
      });
      const outcome = request.run(predecessor).catch((error) => error);
      await barrier.reached;
      let successorAuthority;
      try {
        successorAuthority = await takeOverCoordinator(authorities, authority);
      } finally {
        barrier.release();
      }
      expect(await outcome).toBeInstanceOf(CoordinatorAuthorityStaleError);
      await expect(
        control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(request.cursor);
      const successor = createScheduleControl({
        db,
        tableName: TABLE_NAME,
        coordinatorAuthority: successorAuthority,
      });
      await expect(request.run(successor)).resolves.toEqual({
        applied: false,
        cursor: request.cursor,
      });
    },
  );

  test.each(['activate', 'advance', 'progressed advance'])(
    'preserves a successful %s check-only response after an immediate takeover',
    async (operation) => {
      const { db, control, owner, authorities, authority } =
        await createCoordinatorHarness();
      const request = await prepareCheckOnlyRequest(control, owner, operation);
      let transactionCount = 0;
      let takenOver = false;
      const instrumented = {
        ...db,
        /** @param {import('../../src/core/lib/db/base.js').GetParams} params */
        async get(params) {
          if (
            takenOver &&
            params.sortKeyValue === COORDINATOR_AUTHORITY_SORT_KEY
          ) {
            throw new Error('successful checks must not re-read authority');
          }
          return await db.get(params);
        },
        /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
        async transactionWrite(params) {
          transactionCount += 1;
          await db.transactionWrite(params);
          if (transactionCount === request.transactionNumber) {
            expect(params.putRequests ?? []).toHaveLength(0);
            await takeOverCoordinator(authorities, authority);
            takenOver = true;
          }
        },
      };
      const predecessor = createScheduleControl({
        db: instrumented,
        tableName: TABLE_NAME,
        coordinatorAuthority: authority,
      });
      await expect(request.run(predecessor)).resolves.toEqual({
        applied: false,
        cursor: request.cursor,
      });
      expect(takenOver).toBe(true);
      expect(transactionCount).toBe(request.transactionNumber);
      await expect(authorities.get({ appId: APP_ID })).resolves.toMatchObject({
        coordinatorId: 'coordinator-b',
        epoch: authority.epoch + 1,
      });
    },
  );

  test.each(['activate', 'advance'])(
    'keeps a local-owner %s failure conditional when coordinator authority is current',
    async (operation) => {
      const { control, owner, ownership, authorities, authority } =
        await createCoordinatorHarness();
      const activated = await activateSchedule(control, owner);
      await ownership.releaseOwnership({
        serviceId: owner.serviceId,
        scopeId: owner.scopeId,
        principalId: owner.principalId,
        sessionId: owner.sessionId,
        generation: owner.generation,
      });
      const result =
        operation === 'activate'
          ? activateSchedule(control, owner, { definitionId: DEFINITION_B })
          : control.advance({
              expectedCursor: activated.cursor,
              throughInclusive: 4 * MINUTE,
              owner,
              observedAt: 4 * MINUTE,
            });
      await expect(result).rejects.toHaveProperty(
        'name',
        'ConditionalCheckFailedException',
      );
      await expect(
        control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
      ).resolves.toEqual(activated.cursor);
      await expect(authorities.get({ appId: APP_ID })).resolves.toEqual(
        authority,
      );
    },
  );

  test('returns exact committed advance readback after takeover and response loss without another transaction', async () => {
    const { db, control, owner, authorities, authority } =
      await createCoordinatorHarness();
    const activated = await activateSchedule(control, owner);
    let transactionCount = 0;
    const instrumented = {
      ...db,
      /** @param {import('../../src/core/lib/db/base.js').GetParams} params */
      async get(params) {
        if (params.sortKeyValue === COORDINATOR_AUTHORITY_SORT_KEY) {
          throw new Error('exact readback must not revalidate authority');
        }
        return await db.get(params);
      },
      /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
      async transactionWrite(params) {
        transactionCount += 1;
        await db.transactionWrite(params);
        await takeOverCoordinator(authorities, authority);
        throw new Error('simulated response loss after commit and takeover');
      },
    };
    const predecessor = createScheduleControl({
      db: instrumented,
      tableName: TABLE_NAME,
      coordinatorAuthority: authority,
    });
    const expectedCursor = {
      ...activated.cursor,
      horizon: 4 * MINUTE,
      version: activated.cursor.version + 1,
      updatedAt: 4 * MINUTE,
    };
    await expect(
      predecessor.advance({
        expectedCursor: activated.cursor,
        throughInclusive: 4 * MINUTE,
        owner,
        observedAt: 4 * MINUTE,
      }),
    ).resolves.toEqual({ applied: false, cursor: expectedCursor });
    expect(transactionCount).toBe(1);
    await expect(
      control.getCursor({ appId: APP_ID, scheduleId: SCHEDULE_ID }),
    ).resolves.toEqual(expectedCursor);
    await expect(authorities.get({ appId: APP_ID })).resolves.toMatchObject({
      coordinatorId: 'coordinator-b',
      epoch: authority.epoch + 1,
    });
  });

  test.each(['create', 'replay'])(
    'requires matching structural authority for prepared %s without duplicate checks or stale-token writes',
    async (mode) => {
      const { db, owner, authorities, authority } =
        await createCoordinatorHarness();
      let prohibitWrites = false;
      const instrumented = {
        ...db,
        /** @param {import('../../src/core/lib/db/base.js').GetParams} params */
        async get(params) {
          if (params.sortKeyValue === COORDINATOR_AUTHORITY_SORT_KEY) {
            throw new Error('prepared metadata must not read authority');
          }
          return await db.get(params);
        },
        /** @param {import('../../src/core/lib/db/base.js').TransactionWriteParams} params */
        async transactionWrite(params) {
          if (prohibitWrites) {
            throw new Error('prepared metadata must remain read-only');
          }
          await db.transactionWrite(params);
        },
      };
      const control = createScheduleControl({
        db: instrumented,
        tableName: TABLE_NAME,
        coordinatorAuthority: authority,
      });
      const activated = await activateSchedule(control, owner);
      const input = occurrenceInput(activated.cursor, owner);
      const expected = expectedFromInput(input);
      const first = await control.prepareWorkflowAdmission(input);
      const token = createCoordinatorAuthorityToken(authority);
      const context = {
        ...storeContext(instrumented),
        coordinatorAuthority: token,
      };
      const createExtension = resolvePreparedScheduleWorkflowAdmission(
        first,
        expected,
        context,
      );
      expect(createExtension.coordinatorAuthority).toEqual(token);
      expect(createExtension.conditionChecks).toHaveLength(1);
      expect(createExtension.conditionChecks[0].sortKeyValue).not.toBe(
        COORDINATOR_AUTHORITY_SORT_KEY,
      );
      expect(createExtension.putRequests).toHaveLength(2);
      if (mode === 'replay') {
        const activationFence = await getLocalApplicationRunCreationFence({
          db,
          tableName: TABLE_NAME,
          appId: APP_ID,
          revisionId: REVISION_A,
        });
        await db.transactionWrite({
          tableName: TABLE_NAME,
          conditionChecks: [
            activationFence,
            ...createExtension.conditionChecks,
            createCoordinatorAuthorityFence(token),
          ],
          putRequests: [...createExtension.putRequests],
        });
      }
      const successorAuthority = await takeOverCoordinator(
        authorities,
        authority,
      );
      prohibitWrites = true;
      // Preparation and resolution are structural even when A is now stale.
      const prepared = await control.prepareWorkflowAdmission({
        ...input,
        observedAt: input.observedAt + 1,
      });
      const extension = resolvePreparedScheduleWorkflowAdmission(
        prepared,
        expected,
        { ...context, coordinatorAuthority: authority },
      );
      expect(extension.mode).toBe(mode);
      expect(extension.coordinatorAuthority).toEqual(token);
      expect(extension.conditionChecks).toHaveLength(mode === 'create' ? 1 : 0);
      expect(extension.putRequests).toHaveLength(mode === 'create' ? 2 : 0);
      await expect(
        reconcilePreparedScheduleWorkflowAdmission(prepared, expected, context),
      ).resolves.toEqual(
        mode === 'create'
          ? { status: 'absent' }
          : { status: 'exact', occurrence: first.occurrence },
      );

      for (const invalidContext of [
        storeContext(instrumented),
        { ...context, coordinatorAuthority: successorAuthority },
      ]) {
        expect(() =>
          resolvePreparedScheduleWorkflowAdmission(
            prepared,
            expected,
            invalidContext,
          ),
        ).toThrow(/coordinator authority must match/);
        // eslint-disable-next-line no-await-in-loop
        await expect(
          reconcilePreparedScheduleWorkflowAdmission(
            prepared,
            expected,
            invalidContext,
          ),
        ).rejects.toThrow(/coordinator authority must match/);
      }
    },
  );

  test('permits same-app bound consumers of unbound preparations but rejects different-app consumers', async () => {
    const { db, control, ownership } = createHarness();
    await activateApplication(db);
    const owner = await claimResident(ownership);
    const activated = await activateSchedule(control, owner);
    const input = occurrenceInput(activated.cursor, owner);
    const prepared = await control.prepareWorkflowAdmission(input);
    const expected = expectedFromInput(input);
    const authorities = createCoordinatorAuthority({
      db,
      tableName: TABLE_NAME,
    });
    const { authority } = await authorities.acquire({
      appId: APP_ID,
      coordinatorId: 'coordinator-a',
      requestId: 'acquire-a',
      observedAt: 30,
    });
    const context = { ...storeContext(db), coordinatorAuthority: authority };
    expect(
      resolvePreparedScheduleWorkflowAdmission(prepared, expected, context),
    ).toMatchObject({ mode: 'create' });
    await expect(
      reconcilePreparedScheduleWorkflowAdmission(prepared, expected, context),
    ).resolves.toEqual({ status: 'absent' });
    const { authority: otherAuthority } = await authorities.acquire({
      appId: 'another-app',
      coordinatorId: 'another-coordinator',
      requestId: 'acquire-another-app',
      observedAt: 30,
    });
    const invalidContext = {
      ...storeContext(db),
      coordinatorAuthority: otherAuthority,
    };
    expect(() =>
      resolvePreparedScheduleWorkflowAdmission(
        prepared,
        expected,
        invalidContext,
      ),
    ).toThrow(/coordinator authority must match/);
    await expect(
      reconcilePreparedScheduleWorkflowAdmission(
        prepared,
        expected,
        invalidContext,
      ),
    ).rejects.toThrow(/coordinator authority must match/);
  });
});
