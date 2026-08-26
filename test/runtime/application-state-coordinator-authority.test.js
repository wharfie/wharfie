/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_STATE_KEY_NAME,
  APPLICATION_STATE_SORT_KEY_NAME,
  APPLICATION_STATE_STORE_RESOURCE_ID,
  APPLICATION_STATE_STORE_SORT_KEY,
  ApplicationStateCoordinatorAuthorityConflictError,
  ApplicationStateCoordinatorAuthorityStaleError,
  ApplicationStateCorruptionError,
  ApplicationStateEffectNotAppliedError,
  ApplicationStateStoreIdentityError,
  createApplicationStateBusinessKey,
  createApplicationStateTable,
} from '../../src/core/lib/db/tables/application-state.js';
import {
  APPLICATION_STATE_COORDINATOR_AUTHORITY_RECORD_KIND,
  createApplicationStateCoordinatorAuthorityKey,
  createApplicationStateCoordinatorAuthorityRecord,
  validateApplicationStateCoordinatorAuthorityRecord,
} from '../../src/core/lib/db/tables/application-state-authority.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../src/core/lib/db/base.js').TransactionWriteParams} Transaction */
/** @typedef {import('../../src/core/lib/db/base.js').GetParams} GetParams */
/** @typedef {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken} Token */
/** @typedef {ReturnType<typeof createApplicationStateTable>} Table */
/** @typedef {Parameters<Table['putIfAbsent']>[0]} Mutation */
/** @typedef {'insert' | 'already-present' | 'not-applied' | 'not-applied-existing'} MutationKind */

const TABLE_NAME = 'application-state';
const APP_ID = 'fenced-app';
const STORE_ID = id('was', 'store');
const OTHER_STORE_ID = id('was', 'other-store');
const SCOPE = Object.freeze({ storeId: STORE_ID, namespace: APP_ID });
/** @type {MutationKind[]} */
const MUTATIONS = [
  'insert',
  'already-present',
  'not-applied',
  'not-applied-existing',
];
/** @type {Array<'vanilla' | 'mocked DynamoDB'>} */
const ADAPTERS = ['vanilla', 'mocked DynamoDB'];
/** @type {Array<'readCoordinatorAuthority' | 'adoptCoordinatorAuthority'>} */
const AUTHORITY_METHODS = [
  'readCoordinatorAuthority',
  'adoptCoordinatorAuthority',
];
/** @type {Array<() => Promise<void>>} */
let cleanups = [];

/** @param {string} prefix @param {unknown} value */
function id(prefix, value) {
  return createCanonicalJsonSha256Id({
    prefix,
    domain: `wharfie:test:application-state-authority:${prefix}:v1`,
    value,
    valuePath: 'destination authority test identity',
  });
}

/** @returns {Token} */
function authority(
  epoch = 1,
  appId = APP_ID,
  coordinatorId = `coordinator-${epoch}`,
) {
  return Object.freeze({
    schemaVersion: 1,
    appId,
    coordinatorId,
    authorityId: id('wca1', { appId, coordinatorId, epoch }),
    epoch,
  });
}

/** @param {Partial<Mutation>} [overrides] @returns {Mutation} */
function mutation(overrides = {}) {
  return {
    ...SCOPE,
    key: 'answer',
    value: { nested: { answer: 42 } },
    destinationEffectId: 'destination-effect',
    contractDigest: id('wac', 'contract'),
    ...overrides,
  };
}

/** @param {DBClient} db @param {Token} [token] @param {Partial<Parameters<typeof createApplicationStateTable>[0]>} [overrides] */
function table(db, token, overrides = {}) {
  return createApplicationStateTable({
    db,
    tableName: TABLE_NAME,
    createStoreId: () => STORE_ID,
    ...(token ? { coordinatorAuthority: token } : {}),
    ...overrides,
  });
}

function gate() {
  let enter = () => {};
  let release = () => {};
  const entered = new Promise((resolve) => {
    enter = () => resolve(undefined);
  });
  const waiting = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { enter, release, entered, waiting };
}

/** @param {DBClient} db @param {(params: Transaction) => boolean} predicate */
function pauseTransaction(db, predicate) {
  const barrier = gate();
  let armed = true;
  /** @type {Transaction | undefined} */
  let transaction;
  return {
    ...barrier,
    readTransaction: () => transaction,
    db: {
      ...db,
      async transactionWrite(/** @type {Transaction} */ params) {
        if (armed && predicate(params)) {
          armed = false;
          transaction = params;
          barrier.enter();
          await barrier.waiting;
        }
        await db.transactionWrite(params);
      },
    },
  };
}

/** @param {DBClient} db */
function pauseIdentityRead(db) {
  const barrier = gate();
  let armed = true;
  return {
    ...barrier,
    db: {
      ...db,
      async get(/** @type {GetParams} */ params) {
        if (armed && params.keyValue === APPLICATION_STATE_STORE_RESOURCE_ID) {
          armed = false;
          barrier.enter();
          await barrier.waiting;
        }
        return await db.get(params);
      },
    },
  };
}

/** @param {Transaction} params */
function isAdoption(params) {
  return (
    params.putRequests?.some(
      (put) =>
        put.record.record_kind ===
        APPLICATION_STATE_COORDINATOR_AUTHORITY_RECORD_KIND,
    ) === true
  );
}

/** @param {Transaction} params @param {MutationKind} kind */
function isMutation(params, kind) {
  return (
    params.putRequests?.some(({ record }) =>
      kind === 'insert'
        ? record.record_kind === 'application-state-value'
        : kind === 'already-present'
          ? record.record_kind === 'application-state-effect-receipt' &&
            record.inserted === false
          : record.record_kind === 'application-state-effect-resolution',
    ) === true
  );
}

/** @param {Table} target @param {MutationKind} kind @param {Mutation} input */
async function runMutation(target, kind, input) {
  return isNotApplied(kind)
    ? await target.resolvePutIfAbsentNotApplied(input)
    : await target.putIfAbsent(input);
}

/** @param {MutationKind} kind */
function isNotApplied(kind) {
  return kind === 'not-applied' || kind === 'not-applied-existing';
}

/** @param {Table} target @param {MutationKind} kind */
async function seedMutation(target, kind) {
  if (kind === 'already-present' || kind === 'not-applied-existing') {
    await target.putIfAbsent(
      mutation({
        destinationEffectId: 'previous-effect',
        contractDigest: id('wac', 'previous-contract'),
        ...(kind === 'not-applied-existing'
          ? { value: { nested: { answer: 7 } } }
          : {}),
      }),
    );
  }
}

/** @param {Table} target @param {Mutation} [input] */
async function destinationSnapshot(target, input = mutation()) {
  const key = createApplicationStateBusinessKey(input.namespace, input.key);
  return {
    business: await target.readBusinessByPhysicalKey(
      key.resourceId,
      key.sortKey,
    ),
    receipt: await target.readReceipt(input.destinationEffectId),
    resolution: await target.readNotAppliedResolution(
      input.destinationEffectId,
    ),
  };
}

/** @param {'vanilla' | 'mocked DynamoDB'} name @returns {Promise<DBClient>} */
async function createAdapter(name) {
  if (name === 'mocked DynamoDB') {
    const { db } = await createMockedDynamoDB({
      tableSchemas: { [TABLE_NAME]: ['resource_id', 'sort_key'] },
    });
    cleanups.push(async () => {
      await db.close();
    });
    return db;
  }
  const root = mkdtempSync(join(tmpdir(), 'wharfie-destination-authority-'));
  const db = await createVanillaDB(root);
  cleanups.push(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return db;
}

afterEach(async () => {
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const errors = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (errors.length)
    throw new AggregateError(errors, 'destination authority cleanup failed');
});

describe.each(ADAPTERS)(
  'destination coordinator fence over %s',
  (/** @type {'vanilla' | 'mocked DynamoDB'} */ adapterName) => {
    test('bootstraps identity and initial fence in one transaction and snapshots the token', async () => {
      const db = await createAdapter(adapterName);
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const token = { ...authority() };
      const options = {
        db: { ...db, transactionWrite },
        tableName: TABLE_NAME,
        createStoreId: () => STORE_ID,
        coordinatorAuthority: token,
      };
      const bound = createApplicationStateTable(options);
      token.epoch = 99;
      token.coordinatorId = 'changed';
      options.createStoreId = () => OTHER_STORE_ID;
      const identity = await bound.ensureStoreIdentity();
      expect(identity.store_id).toBe(STORE_ID);
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      expect(transactionWrite.mock.calls[0][0].putRequests).toHaveLength(2);
      const record = await bound.readCoordinatorAuthority(SCOPE);
      expect(record).toMatchObject({
        store_id: STORE_ID,
        namespace: APP_ID,
        coordinator_id: 'coordinator-1',
        epoch: 1,
      });
      expect(Object.isFrozen(record)).toBe(true);
      expect(
        validateApplicationStateCoordinatorAuthorityRecord(record),
      ).toEqual(record);
      expect(await bound.adoptCoordinatorAuthority(SCOPE)).toEqual(record);
      expect(transactionWrite).toHaveBeenCalledTimes(1);
    });

    test('existing identity does not adopt implicitly and bound mutations require explicit adoption', async () => {
      const db = await createAdapter(adapterName);
      const unbound = table(db);
      await unbound.ensureStoreIdentity();
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const bound = table({ ...db, transactionWrite }, authority());
      await bound.ensureStoreIdentity();
      expect(await bound.readCoordinatorAuthority(SCOPE)).toBeNull();
      await expect(bound.putIfAbsent(mutation())).rejects.toBeInstanceOf(
        ApplicationStateCoordinatorAuthorityStaleError,
      );
      await expect(
        bound.resolvePutIfAbsentNotApplied(mutation()),
      ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
      expect(transactionWrite).not.toHaveBeenCalled();
      const first = await bound.adoptCoordinatorAuthority(SCOPE);
      expect(await bound.adoptCoordinatorAuthority(SCOPE)).toEqual(first);
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      await expect(bound.putIfAbsent(mutation())).resolves.toMatchObject({
        inserted: true,
      });
      await expect(unbound.adoptCoordinatorAuthority(SCOPE)).rejects.toThrow(
        /bound authority/,
      );
    });

    test('advances only higher epochs, rejects equal-epoch different tokens, and never implicitly downgrades', async () => {
      const db = await createAdapter(adapterName);
      const first = table(db, authority());
      await first.ensureStoreIdentity();
      const next = table(db, authority(4));
      const retained = await next.adoptCoordinatorAuthority(SCOPE);
      for (const token of [
        authority(),
        authority(3),
        authority(4, APP_ID, 'other-coordinator'),
      ]) {
        const stale = table(db, token);
        await stale.ensureStoreIdentity();
        await expect(
          stale.adoptCoordinatorAuthority(SCOPE),
        ).rejects.toBeInstanceOf(
          ApplicationStateCoordinatorAuthorityStaleError,
        );
        expect(await next.readCoordinatorAuthority(SCOPE)).toEqual(retained);
      }
    });

    test('a retained ADOPTED floor rejects deletion for same-token replay and higher-token adoption without writes', async () => {
      const db = await createAdapter(adapterName);
      const original = table(db, authority());
      await original.ensureStoreIdentity();
      const floor = await original.readCoordinatorAuthority(SCOPE);
      const key = createApplicationStateCoordinatorAuthorityKey(APP_ID);
      await db.remove({
        tableName: TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: key.resourceId,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: key.sortKey,
      });
      for (const token of [authority(), authority(2)]) {
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const guarded = table({ ...db, transactionWrite }, token);
        await expect(
          guarded.assertCoordinatorAuthorityAdoptionPrecondition(SCOPE, {
            destinationAuthorityFloor: floor,
          }),
        ).rejects.toBeInstanceOf(
          ApplicationStateCoordinatorAuthorityStaleError,
        );
        await expect(
          guarded.adoptCoordinatorAuthority(SCOPE, {
            destinationAuthorityFloor: floor,
          }),
        ).rejects.toBeInstanceOf(
          ApplicationStateCoordinatorAuthorityStaleError,
        );
        expect(transactionWrite).not.toHaveBeenCalled();
      }
      expect(await original.readCoordinatorAuthority(SCOPE)).toBeNull();
    });

    test('a retained ADOPTED floor rejects rollback for same-token replay and higher-token adoption without writes', async () => {
      const db = await createAdapter(adapterName);
      const original = table(db, authority());
      await original.ensureStoreIdentity();
      const current = table(db, authority(3));
      const floor = await current.adoptCoordinatorAuthority(SCOPE);
      const rollback = createApplicationStateCoordinatorAuthorityRecord({
        ...SCOPE,
        authority: authority(),
      });
      await db.put({
        tableName: TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: rollback,
      });
      for (const token of [authority(3), authority(4)]) {
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const guarded = table({ ...db, transactionWrite }, token);
        await expect(
          guarded.adoptCoordinatorAuthority(SCOPE, {
            destinationAuthorityFloor: floor,
          }),
        ).rejects.toBeInstanceOf(
          ApplicationStateCoordinatorAuthorityStaleError,
        );
        expect(transactionWrite).not.toHaveBeenCalled();
      }
      expect(await original.readCoordinatorAuthority(SCOPE)).toEqual(rollback);

      const equalEpochDifferent =
        createApplicationStateCoordinatorAuthorityRecord({
          ...SCOPE,
          authority: authority(3, APP_ID, 'different-coordinator'),
        });
      await db.put({
        tableName: TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        record: equalEpochDifferent,
      });
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      await expect(
        table(
          { ...db, transactionWrite },
          authority(4),
        ).adoptCoordinatorAuthority(SCOPE, {
          destinationAuthorityFloor: floor,
        }),
      ).rejects.toBeInstanceOf(ApplicationStateCoordinatorAuthorityStaleError);
      expect(transactionWrite).not.toHaveBeenCalled();
      expect(await original.readCoordinatorAuthority(SCOPE)).toEqual(
        equalEpochDifferent,
      );
    });

    test('a strictly higher valid barrier covers an older ADOPTED floor and remains the exact CAS predecessor', async () => {
      const db = await createAdapter(adapterName);
      const original = table(db, authority());
      await original.ensureStoreIdentity();
      const floor = await original.readCoordinatorAuthority(SCOPE);
      const second = table(db, authority(2));
      const secondBarrier = await second.adoptCoordinatorAuthority(SCOPE);
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const replay = table({ ...db, transactionWrite }, authority(2));
      await expect(
        replay.adoptCoordinatorAuthority(SCOPE, {
          destinationAuthorityFloor: floor,
        }),
      ).resolves.toEqual(secondBarrier);
      expect(transactionWrite).not.toHaveBeenCalled();
      const third = table({ ...db, transactionWrite }, authority(3));
      await expect(
        third.assertCoordinatorAuthorityAdoptionPrecondition(SCOPE, {
          destinationAuthorityFloor: floor,
        }),
      ).resolves.toEqual(secondBarrier);
      await expect(
        third.adoptCoordinatorAuthority(SCOPE, {
          destinationAuthorityFloor: floor,
        }),
      ).resolves.toMatchObject({ epoch: 3 });
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      expect(
        transactionWrite.mock.calls[0][0].putRequests?.[0]?.conditions,
      ).toEqual(
        expect.arrayContaining([
          {
            conditionType: 'EQUALS',
            propertyName: 'record_digest',
            propertyValue: secondBarrier.record_digest,
          },
        ]),
      );
    });

    test('a delayed first adoption cannot overwrite a newer token installed during its CAS window', async () => {
      const db = await createAdapter(adapterName);
      await table(db).ensureStoreIdentity();
      const paused = pauseTransaction(db, isAdoption);
      const old = table(paused.db, authority());
      const pending = old.adoptCoordinatorAuthority(SCOPE);
      await paused.entered;
      const newer = table(db, authority(2));
      const retained = await newer.adoptCoordinatorAuthority(SCOPE);
      paused.release();
      await expect(pending).rejects.toBeInstanceOf(
        ApplicationStateCoordinatorAuthorityStaleError,
      );
      expect(await newer.readCoordinatorAuthority(SCOPE)).toEqual(retained);
    });

    test('lost advancement CAS cannot silently rebase; an explicit retry may advance the new predecessor', async () => {
      const db = await createAdapter(adapterName);
      await table(db, authority()).ensureStoreIdentity();
      const paused = pauseTransaction(db, isAdoption);
      const third = table(paused.db, authority(3));
      const pending = third.adoptCoordinatorAuthority(SCOPE);
      await paused.entered;
      const second = table(db, authority(2));
      const retained = await second.adoptCoordinatorAuthority(SCOPE);
      paused.release();
      await expect(pending).rejects.toBeInstanceOf(
        ApplicationStateCoordinatorAuthorityConflictError,
      );
      expect(await second.readCoordinatorAuthority(SCOPE)).toEqual(retained);
      await expect(
        third.adoptCoordinatorAuthority(SCOPE),
      ).resolves.toMatchObject({ epoch: 3 });
    });

    test('bootstrap loses identity and fence together and does not overwrite the winner', async () => {
      const db = await createAdapter(adapterName);
      const paused = pauseTransaction(db, isAdoption);
      const old = table(paused.db, authority());
      const pending = old.ensureStoreIdentity();
      await paused.entered;
      const newer = table(db, authority(2));
      const identity = await newer.ensureStoreIdentity();
      const retained = await newer.readCoordinatorAuthority(SCOPE);
      paused.release();
      expect(await pending).toEqual(identity);
      expect(await newer.readCoordinatorAuthority(SCOPE)).toEqual(retained);
      await expect(old.adoptCoordinatorAuthority(SCOPE)).rejects.toBeInstanceOf(
        ApplicationStateCoordinatorAuthorityStaleError,
      );
    });

    test('a surviving namespace fence prevents bound bootstrap from recreating a missing identity', async () => {
      const db = await createAdapter(adapterName);
      const old = table(db, authority());
      await old.ensureStoreIdentity();
      const retained = await old.readCoordinatorAuthority(SCOPE);
      await db.remove({
        tableName: TABLE_NAME,
        keyName: APPLICATION_STATE_KEY_NAME,
        keyValue: APPLICATION_STATE_STORE_RESOURCE_ID,
        sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
        sortKeyValue: APPLICATION_STATE_STORE_SORT_KEY,
      });
      const newer = table(db, authority(2), {
        createStoreId: () => OTHER_STORE_ID,
      });
      await expect(newer.ensureStoreIdentity()).rejects.toThrow();
      expect(await newer.readStoreIdentity()).toBeNull();
      const key = createApplicationStateCoordinatorAuthorityKey(APP_ID);
      expect(
        await db.get({
          tableName: TABLE_NAME,
          keyName: APPLICATION_STATE_KEY_NAME,
          keyValue: key.resourceId,
          sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
          sortKeyValue: key.sortKey,
          consistentRead: true,
        }),
      ).toEqual(retained);
    });

    test.each([false, true])(
      'adoption response loss reads back only the exact current token (superseded=%s)',
      async (superseded) => {
        const db = await createAdapter(adapterName);
        await table(db).ensureStoreIdentity();
        let lost = false;
        const wrapped = {
          ...db,
          async transactionWrite(/** @type {Transaction} */ params) {
            await db.transactionWrite(params);
            if (!lost && isAdoption(params)) {
              lost = true;
              if (superseded)
                await table(db, authority(2)).adoptCoordinatorAuthority(SCOPE);
              throw new Error('lost adoption response');
            }
          },
        };
        const old = table(wrapped, authority());
        if (superseded) {
          await expect(
            old.adoptCoordinatorAuthority(SCOPE),
          ).rejects.toBeInstanceOf(
            ApplicationStateCoordinatorAuthorityStaleError,
          );
          expect(await table(db).readCoordinatorAuthority(SCOPE)).toMatchObject(
            { epoch: 2 },
          );
        } else {
          const retained = await old.adoptCoordinatorAuthority(SCOPE);
          expect(retained).toMatchObject({ epoch: 1 });
          expect(await old.adoptCoordinatorAuthority(SCOPE)).toEqual(retained);
        }
      },
    );

    describe.each([false, true])(
      'stale transaction with unbound=%s',
      (unbound) => {
        test.each(MUTATIONS)(
          'fences a delayed %s transaction without leaving any effect rows',
          async (kind) => {
            const db = await createAdapter(adapterName);
            const original = table(db, unbound ? undefined : authority());
            await original.ensureStoreIdentity();
            await seedMutation(original, kind);
            const before = await destinationSnapshot(original);
            const paused = pauseTransaction(db, (params) =>
              isMutation(params, kind),
            );
            const old = table(paused.db, unbound ? undefined : authority());
            const pending = runMutation(old, kind, mutation());
            await paused.entered;
            const key = createApplicationStateCoordinatorAuthorityKey(APP_ID);
            const guard = paused
              .readTransaction()
              ?.conditionChecks?.find(
                (check) => check.keyValue === key.resourceId,
              );
            expect(guard).toBeDefined();
            expect(guard?.conditions).toEqual(
              expect.arrayContaining([
                unbound
                  ? {
                      conditionType: 'NOT_EXISTS',
                      propertyName: APPLICATION_STATE_KEY_NAME,
                    }
                  : {
                      conditionType: 'EQUALS',
                      propertyName: 'epoch',
                      propertyValue: 1,
                    },
              ]),
            );
            if (kind === 'not-applied-existing') {
              const businessKey = createApplicationStateBusinessKey(
                APP_ID,
                mutation().key,
              );
              expect(before.business).not.toBeNull();
              expect(
                paused
                  .readTransaction()
                  ?.conditionChecks?.find(
                    (check) => check.keyValue === businessKey.resourceId,
                  )?.conditions,
              ).toEqual([
                {
                  conditionType: 'EQUALS',
                  propertyName: 'record_digest',
                  propertyValue: before.business?.record_digest,
                },
              ]);
            }
            const newer = table(db, authority(2));
            const adopted = await newer.adoptCoordinatorAuthority(SCOPE);
            paused.release();
            await expect(pending).rejects.toBeInstanceOf(
              ApplicationStateCoordinatorAuthorityStaleError,
            );
            expect(await destinationSnapshot(newer)).toEqual(before);
            expect(await newer.readCoordinatorAuthority(SCOPE)).toEqual(
              adopted,
            );
            await runMutation(newer, kind, mutation());
            const after = await destinationSnapshot(newer);
            expect(
              isNotApplied(kind) ? after.resolution : after.receipt,
            ).not.toBeNull();
            if (kind === 'not-applied-existing') {
              expect(after.business).toEqual(before.business);
              expect(after.resolution?.business_observation).toEqual({
                kind: 'present-other',
                recordDigest: before.business?.record_digest,
                createdByDestinationEffectId: 'previous-effect',
              });
            }
          },
        );
      },
    );

    test.each(MUTATIONS)(
      'returns an exact committed %s after response loss and a newer destination adoption',
      async (kind) => {
        const db = await createAdapter(adapterName);
        const original = table(db, authority());
        await original.ensureStoreIdentity();
        await seedMutation(original, kind);
        const before = await destinationSnapshot(original);
        let lost = false;
        const wrapped = {
          ...db,
          async transactionWrite(/** @type {Transaction} */ params) {
            await db.transactionWrite(params);
            if (!lost && isMutation(params, kind)) {
              lost = true;
              await table(db, authority(2)).adoptCoordinatorAuthority(SCOPE);
              throw new Error('lost effect response');
            }
          },
        };
        const old = table(wrapped, authority());
        const result = await runMutation(old, kind, mutation());
        const snapshot = await destinationSnapshot(original);
        expect(result).toEqual(
          isNotApplied(kind)
            ? { kind: 'not-applied', resolution: snapshot.resolution }
            : snapshot.receipt,
        );
        if (kind === 'not-applied-existing') {
          expect(snapshot.business).toEqual(before.business);
          expect(snapshot.resolution?.business_observation).toEqual({
            kind: 'present-other',
            recordDigest: before.business?.record_digest,
            createdByDestinationEffectId: 'previous-effect',
          });
        }
        expect(await original.readCoordinatorAuthority(SCOPE)).toMatchObject({
          epoch: 2,
        });
        expect(lost).toBe(true);
        const transactionWrite = jest.fn(async () => {
          throw new Error('committed response-loss replay must not write');
        });
        for (const token of [undefined, authority()]) {
          expect(
            await runMutation(
              table({ ...db, transactionWrite }, token),
              kind,
              mutation(),
            ),
          ).toEqual(result);
        }
        expect(transactionWrite).not.toHaveBeenCalled();
      },
    );

    test('retained positive and negative outcomes replay through old and unbound tables with zero writes', async () => {
      const db = await createAdapter(adapterName);
      const old = table(db, authority());
      await old.ensureStoreIdentity();
      const positiveInput = mutation();
      const negativeInput = mutation({
        key: 'absent',
        destinationEffectId: 'negative-effect',
        contractDigest: id('wac', 'negative-contract'),
      });
      const positive = await old.putIfAbsent(positiveInput);
      const negative = await old.resolvePutIfAbsentNotApplied(negativeInput);
      await table(db, authority(2)).adoptCoordinatorAuthority(SCOPE);
      const transactionWrite = jest.fn(async () => {
        throw new Error('replay must not write');
      });
      for (const token of [undefined, authority()]) {
        const replay = table({ ...db, transactionWrite }, token);
        expect(await replay.putIfAbsent(positiveInput)).toEqual(positive);
        expect(
          await replay.resolvePutIfAbsentNotApplied(positiveInput),
        ).toEqual({ kind: 'outcome', receipt: positive });
        expect(await replay.recoverPutIfAbsent(positiveInput)).toEqual(
          positive,
        );
        expect(
          await replay.resolvePutIfAbsentNotApplied(negativeInput),
        ).toEqual(negative);
        expect(await replay.recoverPutIfAbsent(negativeInput)).toBeNull();
        await expect(replay.putIfAbsent(negativeInput)).rejects.toBeInstanceOf(
          ApplicationStateEffectNotAppliedError,
        );
      }
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    test.each(MUTATIONS)(
      'captures %s mutation and scope before the first await',
      async (kind) => {
        const db = await createAdapter(adapterName);
        const original = table(db, authority());
        await original.ensureStoreIdentity();
        await seedMutation(original, kind);
        const paused = pauseIdentityRead(db);
        const input = mutation();
        const expected = JSON.parse(JSON.stringify(input));
        const pending = runMutation(table(paused.db, authority()), kind, input);
        await paused.entered;
        input.namespace = 'redirected-app';
        input.storeId = OTHER_STORE_ID;
        input.key = 'redirected-key';
        input.value.nested.answer = 99;
        input.destinationEffectId = 'redirected-effect';
        input.contractDigest = id('wac', 'redirected-contract');
        input.maxAttempts = 0;
        paused.release();
        await pending;
        const snapshot = await destinationSnapshot(original, expected);
        expect(
          isNotApplied(kind) ? snapshot.resolution : snapshot.receipt,
        ).toMatchObject({
          destination_effect_id: expected.destinationEffectId,
          contract_digest: expected.contractDigest,
        });
        if (kind === 'insert')
          expect(snapshot.business?.value).toEqual(expected.value);
        expect(await original.readReceipt('redirected-effect')).toBeNull();
        expect(
          await original.readNotAppliedResolution('redirected-effect'),
        ).toBeNull();
      },
    );

    test.each(AUTHORITY_METHODS)(
      'captures %s scope before its first await',
      async (method) => {
        const db = await createAdapter(adapterName);
        await table(db, authority()).ensureStoreIdentity();
        const paused = pauseIdentityRead(db);
        /** @type {{storeId: string, namespace: string}} */
        const input = { ...SCOPE };
        const bound = table(paused.db, authority(2));
        const pending = bound[method](input);
        await paused.entered;
        input.storeId = OTHER_STORE_ID;
        input.namespace = 'redirected-app';
        paused.release();
        expect(await pending).toMatchObject({
          store_id: STORE_ID,
          namespace: APP_ID,
          epoch: method === 'readCoordinatorAuthority' ? 1 : 2,
        });
      },
    );

    test('rejects a cross-app scope and malformed inputs before any reads or writes', async () => {
      const db = await createAdapter(adapterName);
      const get = jest.fn(
        async (/** @type {GetParams} */ params) => await db.get(params),
      );
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const bound = table({ ...db, get, transactionWrite }, authority());
      const wrongScope = { ...SCOPE, namespace: 'other-app' };
      await expect(bound.readCoordinatorAuthority(wrongScope)).rejects.toThrow(
        /namespace/,
      );
      await expect(bound.adoptCoordinatorAuthority(wrongScope)).rejects.toThrow(
        /namespace/,
      );
      await expect(bound.putIfAbsent(mutation(wrongScope))).rejects.toThrow(
        /namespace/,
      );
      await expect(
        bound.resolvePutIfAbsentNotApplied(mutation(wrongScope)),
      ).rejects.toThrow(/namespace/);
      await expect(
        bound.recoverPutIfAbsent(mutation(wrongScope)),
      ).rejects.toThrow(/namespace/);
      await expect(
        bound.putIfAbsent(mutation({ maxAttempts: 0 })),
      ).rejects.toThrow(/maxAttempts/);
      await expect(
        bound.resolvePutIfAbsentNotApplied(mutation({ key: '' })),
      ).rejects.toThrow(/key/);
      await expect(
        bound.putIfAbsent(
          /** @type {any} */ ({ ...mutation(), unexpected: true }),
        ),
      ).rejects.toThrow(/unsupported/);
      expect(get).not.toHaveBeenCalled();
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    test('keeps namespace epochs independent in one store and rejects a wrong store binding', async () => {
      const db = await createAdapter(adapterName);
      const first = table(db, authority());
      await first.ensureStoreIdentity();
      const otherScope = { storeId: STORE_ID, namespace: 'other-app' };
      const other = table(db, authority(1, otherScope.namespace));
      await other.adoptCoordinatorAuthority(otherScope);
      await table(db, authority(9)).adoptCoordinatorAuthority(SCOPE);
      await expect(
        other.putIfAbsent(
          mutation({ ...otherScope, destinationEffectId: 'other-app-effect' }),
        ),
      ).resolves.toMatchObject({ inserted: true });
      expect(await other.readCoordinatorAuthority(otherScope)).toMatchObject({
        epoch: 1,
      });
      await expect(
        table(db).putIfAbsent(
          mutation({
            namespace: 'unadopted-app',
            destinationEffectId: 'unadopted-effect',
          }),
        ),
      ).resolves.toMatchObject({ inserted: true });
      for (const method of AUTHORITY_METHODS) {
        await expect(
          first[method]({ ...SCOPE, storeId: OTHER_STORE_ID }),
        ).rejects.toBeInstanceOf(ApplicationStateStoreIdentityError);
      }
    });

    test.each(['extra-field', 'changed-epoch', 'bad-digest', 'foreign-store'])(
      'rejects retained fence %s before any new bound or unbound mutation',
      async (corruption) => {
        const db = await createAdapter(adapterName);
        const bound = table(db, authority());
        await bound.ensureStoreIdentity();
        const original = await bound.readCoordinatorAuthority(SCOPE);
        const record =
          corruption === 'foreign-store'
            ? createApplicationStateCoordinatorAuthorityRecord({
                storeId: OTHER_STORE_ID,
                namespace: APP_ID,
                authority: authority(),
              })
            : {
                ...original,
                ...(corruption === 'extra-field'
                  ? { unexpected: true }
                  : corruption === 'changed-epoch'
                    ? { epoch: 99 }
                    : { record_digest: id('waaf1', 'invalid') }),
              };
        await db.put({
          tableName: TABLE_NAME,
          keyName: APPLICATION_STATE_KEY_NAME,
          sortKeyName: APPLICATION_STATE_SORT_KEY_NAME,
          record,
        });
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const expectedError =
          corruption === 'foreign-store'
            ? ApplicationStateStoreIdentityError
            : ApplicationStateCorruptionError;
        for (const token of [undefined, authority()]) {
          const candidate = table({ ...db, transactionWrite }, token);
          await expect(
            candidate.readCoordinatorAuthority(SCOPE),
          ).rejects.toBeInstanceOf(expectedError);
          await expect(
            candidate.putIfAbsent(mutation()),
          ).rejects.toBeInstanceOf(expectedError);
          await expect(
            candidate.resolvePutIfAbsentNotApplied(mutation()),
          ).rejects.toBeInstanceOf(expectedError);
          if (token)
            await expect(
              candidate.adoptCoordinatorAuthority(SCOPE),
            ).rejects.toBeInstanceOf(expectedError);
        }
        expect(transactionWrite).not.toHaveBeenCalled();
      },
    );
  },
);
