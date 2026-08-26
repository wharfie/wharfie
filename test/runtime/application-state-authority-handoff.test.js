/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  createControlDBClient,
} from '../../src/core/lib/config/db.js';
import {
  ApplicationStateCoordinatorAuthorityStaleError,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  CoordinatorAuthorityStaleError,
  assertCoordinatorAuthorityCurrent,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

const APP_ID = 'application-state-handoff';
const CONTROL_TABLE_NAME = 'application-state-handoff-control';
const STORE_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:application-state-handoff:store',
  prefix: 'was',
  value: { fixture: APP_ID },
});
const STORE_SCOPE = Object.freeze({ storeId: STORE_ID, namespace: APP_ID });

/** @type {Array<() => Promise<void>>} */
let cleanups = [];

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      'application-state handoff cleanup failed',
    );
  }
});

function deferred() {
  /** @type {() => void} */
  let resume = () => {};
  const promise = new Promise((resolve) => {
    resume = () => resolve(undefined);
  });
  return { promise, resolve: resume };
}

/** @param {string} name */
function intent(name) {
  return {
    ...STORE_SCOPE,
    key: name,
    value: { name },
    destinationEffectId: `handoff-effect-${name}`,
    contractDigest: createCanonicalJsonSha256Id({
      domain: 'wharfie:test:application-state-handoff:contract',
      prefix: 'wac',
      value: { name },
    }),
  };
}

async function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-app-state-handoff-'));
  const applicationPath = join(root, 'application');
  const controlPath = join(root, 'control');
  /** @type {import('../../src/core/lib/db/base.js').DBClient | undefined} */
  let applicationDb;
  /** @type {import('../../src/core/lib/db/base.js').DBClient | null} */
  let controlDb = null;
  cleanups.push(async () => {
    try {
      await applicationDb?.close();
    } finally {
      try {
        await controlDb?.close();
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
  controlDb = await createControlDBClient('lmdb', { path: controlPath });
  applicationDb = await createApplicationStateDBClient('lmdb', {
    path: applicationPath,
  });
  const control = createCoordinatorAuthority({
    db: controlDb,
    tableName: CONTROL_TABLE_NAME,
  });
  const acquired = await control.acquire({
    appId: APP_ID,
    coordinatorId: 'coordinator-a',
    requestId: 'acquire-a',
    observedAt: 1,
  });
  const authorityA = createCoordinatorAuthorityToken(acquired.authority);
  const tableA = createApplicationStateTable({
    db: applicationDb,
    tableName: APPLICATION_STATE_TABLE_NAME,
    createStoreId: () => STORE_ID,
    coordinatorAuthority: authorityA,
  });
  await tableA.ensureStoreIdentity();
  await tableA.adoptCoordinatorAuthority(STORE_SCOPE);

  return {
    control,
    controlDb,
    applicationDb,
    authorityA,
    tableA,
    async takeover() {
      const observedAuthority = await control.get({ appId: APP_ID });
      const result = await control.takeover({
        appId: APP_ID,
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-b',
        observedAuthority,
        confirmAuthorityReplacement: true,
        observedAt: 2,
      });
      return createCoordinatorAuthorityToken(result.authority);
    },
    async reopenApplication(readOnly = false) {
      await applicationDb?.close();
      applicationDb = undefined;
      applicationDb = await createApplicationStateDBClient('lmdb', {
        path: applicationPath,
        readOnly,
      });
      return applicationDb;
    },
  };
}

describe('application-state destination handoff over separate LMDB stores', () => {
  test('fences a paused predecessor only when the successor destination barrier commits', async () => {
    const harness = await createHarness();
    const accepted = await harness.tableA.putIfAbsent(intent('accepted'));
    const authorityB = await harness.takeover();
    await expect(
      assertCoordinatorAuthorityCurrent({
        db: harness.controlDb,
        tableName: CONTROL_TABLE_NAME,
        authority: harness.authorityA,
      }),
    ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);

    // Control takeover is not a transaction against this separate destination.
    // Its old barrier remains authoritative here until destination adoption.
    await expect(
      harness.tableA.readCoordinatorAuthority(STORE_SCOPE),
    ).resolves.toMatchObject({ epoch: 1, coordinator_id: 'coordinator-a' });
    await expect(
      harness.tableA.putIfAbsent(intent('before-destination-barrier')),
    ).resolves.toMatchObject({ inserted: true });

    const entered = deferred();
    const resume = deferred();
    const transactionWrite = jest.fn(
      async (
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */
        params,
      ) => {
        if (
          params.putRequests?.some(
            ({ record }) => record.record_kind === 'application-state-value',
          )
        ) {
          entered.resolve();
          await resume.promise;
        }
        return await harness.applicationDb.transactionWrite(params);
      },
    );
    const pausedA = createApplicationStateTable({
      db: { ...harness.applicationDb, transactionWrite },
      tableName: APPLICATION_STATE_TABLE_NAME,
      coordinatorAuthority: harness.authorityA,
    });
    const delayed = pausedA.putIfAbsent(intent('paused-old-writer'));
    // Attach a rejection handler immediately so cleanup cannot manufacture an
    // unhandled rejection if a later assertion fails while this write is held.
    const settled = delayed.then(
      (value) => ({ value, error: undefined }),
      (error) => ({ value: undefined, error }),
    );
    try {
      await Promise.race([
        entered.promise,
        settled.then(({ error }) => {
          throw (
            error ??
            new Error('The predecessor never reached its write barrier.')
          );
        }),
      ]);
      const tableB = createApplicationStateTable({
        db: harness.applicationDb,
        tableName: APPLICATION_STATE_TABLE_NAME,
        coordinatorAuthority: authorityB,
      });
      await tableB.adoptCoordinatorAuthority(STORE_SCOPE);
      resume.resolve();
      const result = await settled;
      expect(result.error).toBeInstanceOf(
        ApplicationStateCoordinatorAuthorityStaleError,
      );
      expect(result.value).toBeUndefined();
      await expect(
        tableB.recoverPutIfAbsent(intent('paused-old-writer')),
      ).resolves.toBeNull();
      await expect(
        tableB.putIfAbsent(intent('successor-write')),
      ).resolves.toMatchObject({ inserted: true });

      const attemptsBeforeReplay = transactionWrite.mock.calls.length;
      await expect(pausedA.putIfAbsent(intent('accepted'))).resolves.toEqual(
        accepted,
      );
      expect(transactionWrite).toHaveBeenCalledTimes(attemptsBeforeReplay);
      const barrier = await tableB.readCoordinatorAuthority(STORE_SCOPE);
      await harness.control.release({
        authority: authorityB,
        requestId: 'release-b',
        observedAt: 3,
      });
      // Graceful control release does not erase or roll back this high-water
      // barrier, and closing an individual catalog must not do so either.
      await expect(
        tableB.readCoordinatorAuthority(STORE_SCOPE),
      ).resolves.toEqual(barrier);
    } finally {
      resume.resolve();
      await settled;
    }
  });

  test('retains the barrier and exact positive and negative dispositions across writable and read-only reopen', async () => {
    const harness = await createHarness();
    const positiveIntent = intent('retained-positive');
    const negativeIntent = intent('retained-negative');
    const positive = await harness.tableA.putIfAbsent(positiveIntent);
    const negative =
      await harness.tableA.resolvePutIfAbsentNotApplied(negativeIntent);
    if (negative.kind !== 'not-applied') {
      throw new Error(
        'Expected a retained negative disposition for this fixture.',
      );
    }
    const authorityB = await harness.takeover();
    const tableB = createApplicationStateTable({
      db: harness.applicationDb,
      tableName: APPLICATION_STATE_TABLE_NAME,
      coordinatorAuthority: authorityB,
    });
    const barrier = await tableB.adoptCoordinatorAuthority(STORE_SCOPE);

    const readOnlyDb = await harness.reopenApplication(true);
    const forbiddenWrite = jest.fn(async () => {
      throw new Error('read-only recovery attempted a transaction');
    });
    const readOnlyTable = createApplicationStateTable({
      db: { ...readOnlyDb, transactionWrite: forbiddenWrite },
      tableName: APPLICATION_STATE_TABLE_NAME,
    });
    await expect(
      readOnlyTable.readCoordinatorAuthority(STORE_SCOPE),
    ).resolves.toEqual(barrier);
    await expect(
      readOnlyTable.recoverPutIfAbsent(positiveIntent),
    ).resolves.toEqual(positive);
    await expect(
      readOnlyTable.recoverPutIfAbsent(negativeIntent),
    ).resolves.toBeNull();
    await expect(
      readOnlyTable.readNotAppliedResolution(
        negativeIntent.destinationEffectId,
      ),
    ).resolves.toEqual(negative.resolution);
    expect(forbiddenWrite).not.toHaveBeenCalled();

    const reopenedDb = await harness.reopenApplication();
    const stale = createApplicationStateTable({
      db: reopenedDb,
      tableName: APPLICATION_STATE_TABLE_NAME,
      coordinatorAuthority: harness.authorityA,
    });
    const unbound = createApplicationStateTable({
      db: reopenedDb,
      tableName: APPLICATION_STATE_TABLE_NAME,
    });
    await expect(
      stale.adoptCoordinatorAuthority(STORE_SCOPE),
    ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
    await expect(
      stale.putIfAbsent(intent('stale-after-reopen')),
    ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
    await expect(
      unbound.putIfAbsent(intent('unbound-after-reopen')),
    ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
    await expect(stale.putIfAbsent(positiveIntent)).resolves.toEqual(positive);
    await expect(
      stale.resolvePutIfAbsentNotApplied(negativeIntent),
    ).resolves.toEqual(negative);
    await expect(unbound.putIfAbsent(positiveIntent)).resolves.toEqual(
      positive,
    );
    await expect(
      unbound.resolvePutIfAbsentNotApplied(negativeIntent),
    ).resolves.toEqual(negative);
    const successor = createApplicationStateTable({
      db: reopenedDb,
      tableName: APPLICATION_STATE_TABLE_NAME,
      coordinatorAuthority: authorityB,
    });
    await expect(
      successor.adoptCoordinatorAuthority(STORE_SCOPE),
    ).resolves.toEqual(barrier);
    await expect(
      successor.putIfAbsent(intent('successor-after-reopen')),
    ).resolves.toMatchObject({ inserted: true });
  });

  test.each(['positive', 'negative'])(
    'recovers a committed %s disposition after response loss and destination replacement',
    async (kind) => {
      const harness = await createHarness();
      const request = intent(`response-loss-${kind}`);
      let replaced = false;
      const transactionWrite = jest.fn(
        async (
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */
          params,
        ) => {
          const result = await harness.applicationDb.transactionWrite(params);
          if (
            !replaced &&
            params.putRequests?.some(({ record }) =>
              [
                'application-state-effect-receipt',
                'application-state-effect-resolution',
              ].includes(record.record_kind),
            )
          ) {
            replaced = true;
            const authorityB = await harness.takeover();
            const tableB = createApplicationStateTable({
              db: harness.applicationDb,
              tableName: APPLICATION_STATE_TABLE_NAME,
              coordinatorAuthority: authorityB,
            });
            await tableB.adoptCoordinatorAuthority(STORE_SCOPE);
            throw new Error(
              'simulated lost response after destination adoption',
            );
          }
          return result;
        },
      );
      const tableA = createApplicationStateTable({
        db: { ...harness.applicationDb, transactionWrite },
        tableName: APPLICATION_STATE_TABLE_NAME,
        coordinatorAuthority: harness.authorityA,
      });
      const invoke = async () =>
        kind === 'positive'
          ? await tableA.putIfAbsent(request)
          : await tableA.resolvePutIfAbsentNotApplied(request);
      const outcome = await invoke();
      expect(replaced).toBe(true);
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      await expect(invoke()).resolves.toEqual(outcome);
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      await expect(
        tableA.readCoordinatorAuthority(STORE_SCOPE),
      ).resolves.toMatchObject({ epoch: 2, coordinator_id: 'coordinator-b' });
    },
  );
});
