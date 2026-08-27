/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_STATE_READINESS_RECORD_KIND,
  APPLICATION_STATE_READINESS_SORT_KEY,
  ApplicationStateReadinessConflictError,
  ApplicationStateReadinessRecordError,
  applicationStateReadinessAuthority,
  applicationStateReadinessDestination,
  createApplicationStateReadinessFence,
  createApplicationStateReadinessStore,
  getApplicationStateReadinessPartitionKey,
  validateApplicationStateReadinessRecord,
} from '../../src/core/lib/db/tables/application-state-readiness.js';
import {
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityStaleError,
  assertCoordinatorAuthorityToken,
  createCoordinatorAuthority,
  createCoordinatorAuthorityFence,
  getCoordinatorAuthorityPartitionKey,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import { normalizeApplicationStateDestination } from '../../src/core/runtime/effects/application-state.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../src/core/lib/db/base.js').TransactionWriteParams} Transaction */
/** @typedef {import('../../src/core/lib/db/base.js').GetParams} GetParams */
/** @typedef {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot} Snapshot */
/** @typedef {import('../../src/core/lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken} Token */
/** @typedef {import('../../src/core/lib/db/tables/application-state-readiness.js').ApplicationStateReadinessRecord} Readiness */
/** @typedef {ReturnType<typeof normalizeApplicationStateDestination>} Destination */
/** @typedef {'PREPARING' | 'ADOPTED'} Phase */

const TABLE_NAME = 'readiness-control';
const APP_ID = 'readiness-app';
const STORE_ID = storeId('original');
const OTHER_STORE_ID = storeId('replacement');
/** @type {Array<'vanilla' | 'mocked DynamoDB'>} */
const ADAPTERS = ['vanilla', 'mocked DynamoDB'];
/** @type {Phase[]} */
const PHASES = ['PREPARING', 'ADOPTED'];
/** @type {Array<() => Promise<void>>} */
let cleanups = [];

/** @param {string} value */
function storeId(value) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:test:readiness-store:v1',
    prefix: 'was',
    value,
    valuePath: 'readiness test store',
  });
}

/** @param {Partial<Destination['configuration']>} [configuration] @returns {Destination} */
function destination(configuration = {}) {
  return normalizeApplicationStateDestination({
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'vanilla',
      storeId: STORE_ID,
      tableName: 'wharfie-application-state-v2',
      namespace: APP_ID,
      ...configuration,
    },
  });
}

/** @param {DBClient} db @param {unknown} [token] */
function readiness(db, token) {
  return createApplicationStateReadinessStore({
    db,
    tableName: TABLE_NAME,
    ...(token === undefined ? {} : { coordinatorAuthority: token }),
  });
}

/** @param {DBClient} db */
function control(db) {
  return createCoordinatorAuthority({ db, tableName: TABLE_NAME });
}

/** @param {DBClient} db @param {string} [appId] @returns {Promise<Snapshot>} */
async function acquire(db, appId = APP_ID) {
  return (
    await control(db).acquire({
      appId,
      coordinatorId: 'coordinator-a',
      requestId: 'acquire-a',
      observedAt: 10,
    })
  ).authority;
}

/** @param {DBClient} db @param {Snapshot} previous @param {string} [suffix] @returns {Promise<Snapshot>} */
async function takeover(db, previous, suffix = 'b') {
  return (
    await control(db).takeover({
      appId: previous.appId,
      coordinatorId: `coordinator-${suffix}`,
      requestId: `takeover-${suffix}`,
      observedAuthority: previous,
      confirmAuthorityReplacement: true,
      observedAt: 20,
    })
  ).authority;
}

/** @param {unknown} token @param {Destination} [target] */
function barrier(token, target = destination()) {
  return createApplicationStateCoordinatorAuthorityRecord({
    storeId: target.configuration.storeId,
    namespace: target.configuration.namespace,
    authority: token,
  });
}

/** @param {DBClient} db @param {Snapshot} token @param {Phase} phase @returns {Promise<Readiness>} */
async function establish(db, token, phase) {
  const bound = readiness(db, token);
  const preparation = await bound.prepare({ destination: destination() });
  return phase === 'PREPARING'
    ? preparation
    : await bound.markAdopted({
        preparation,
        destinationAuthority: barrier(token),
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

/** @param {Transaction} params @param {Phase} [phase] */
function isReadinessWrite(params, phase) {
  return (
    params.putRequests?.some(
      ({ record }) =>
        record.record_kind === APPLICATION_STATE_READINESS_RECORD_KIND &&
        (phase === undefined || record.status === phase),
    ) === true
  );
}

/** @param {DBClient} db @param {Phase} phase */
function pauseTransaction(db, phase) {
  const paused = gate();
  let armed = true;
  /** @type {Transaction | undefined} */
  let transaction;
  const transactionWrite = jest.fn(
    async (/** @type {Transaction} */ params) => {
      if (armed && isReadinessWrite(params, phase)) {
        armed = false;
        transaction = params;
        paused.enter();
        await paused.waiting;
      }
      await db.transactionWrite(params);
    },
  );
  return {
    ...paused,
    db: { ...db, transactionWrite },
    transactionWrite,
    readTransaction: () => transaction,
  };
}

/** @param {DBClient} db @param {string} sortKey */
function pauseRead(db, sortKey) {
  const paused = gate();
  let armed = true;
  return {
    ...paused,
    db: {
      ...db,
      async get(/** @type {GetParams} */ params) {
        if (armed && params.sortKeyValue === sortKey) {
          armed = false;
          paused.enter();
          await paused.waiting;
        }
        return await db.get(params);
      },
    },
  };
}

/** @param {'vanilla' | 'mocked DynamoDB'} adapterName @returns {Promise<DBClient>} */
async function createAdapter(adapterName) {
  if (adapterName === 'mocked DynamoDB') {
    const { db } = await createMockedDynamoDB({
      tableSchemas: { [TABLE_NAME]: ['run_id', 'sort_key'] },
    });
    cleanups.push(async () => await db.close());
    return db;
  }
  const root = mkdtempSync(join(tmpdir(), 'wharfie-readiness-kernel-'));
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
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length)
    throw new AggregateError(failures, 'readiness kernel cleanup failed');
});

describe.each(ADAPTERS)(
  'application-state readiness over %s',
  (/** @type {'vanilla' | 'mocked DynamoDB'} */ adapterName) => {
    test('unbound get is a read-only lookup, including an empty control store', async () => {
      const db = await createAdapter(adapterName);
      const transactionWrite = jest.fn(async () => {
        throw new Error('read must not write');
      });
      const reader = readiness({ ...db, transactionWrite });
      expect(await reader.get({ appId: APP_ID })).toBeNull();
      const token = await acquire(db);
      const prepared = await establish(db, token, 'PREPARING');
      expect(await reader.get({ appId: APP_ID })).toEqual(prepared);
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    test('prepares an exact frozen destination pin under current authority and same-token replay does not write', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const bound = readiness({ ...db, transactionWrite }, token);
      const prepared = await bound.prepare({ destination: destination() });
      expect(prepared).toMatchObject({
        app_id: APP_ID,
        store_id: STORE_ID,
        epoch: 1,
        status: 'PREPARING',
      });
      expect(prepared.destination_authority_digest).toBe(
        barrier(token).record_digest,
      );
      expect(Object.isFrozen(prepared)).toBe(true);
      expect(validateApplicationStateReadinessRecord(prepared)).toEqual(
        prepared,
      );
      expect(applicationStateReadinessDestination(prepared)).toEqual(
        destination(),
      );
      expect(applicationStateReadinessAuthority(prepared)).toEqual(
        assertCoordinatorAuthorityToken(token),
      );
      expect(await bound.prepare({ destination: destination() })).toEqual(
        prepared,
      );
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      expect(transactionWrite.mock.calls[0][0].conditionChecks).toEqual([
        createCoordinatorAuthorityFence(token),
      ]);
      expect(
        transactionWrite.mock.calls[0][0].putRequests?.[0].conditions,
      ).toEqual([
        { conditionType: 'NOT_EXISTS', propertyName: 'run_id' },
        { conditionType: 'NOT_EXISTS', propertyName: 'sort_key' },
      ]);
      expect(() => createApplicationStateReadinessFence(prepared)).toThrow(
        /ADOPTED/,
      );
    });

    test('adopts only an exact preparation and destination barrier; all same-token replays remain read-only', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const preparation = await establish(db, token, 'PREPARING');
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const bound = readiness({ ...db, transactionWrite }, token);
      const input = { preparation, destinationAuthority: barrier(token) };
      const adopted = await bound.markAdopted(input);
      expect(adopted.status).toBe('ADOPTED');
      expect(adopted.record_digest).not.toBe(preparation.record_digest);
      expect(await bound.markAdopted(input)).toEqual(adopted);
      expect(
        await bound.markAdopted({ ...input, preparation: adopted }),
      ).toEqual(adopted);
      expect(await bound.prepare({ destination: destination() })).toEqual(
        adopted,
      );
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      const conditions =
        transactionWrite.mock.calls[0][0].putRequests?.[0].conditions;
      expect(conditions).toHaveLength(Object.keys(preparation).length);
      expect(conditions).toEqual(
        expect.arrayContaining([
          {
            conditionType: 'EQUALS',
            propertyName: 'record_digest',
            propertyValue: preparation.record_digest,
          },
          {
            conditionType: 'EQUALS',
            propertyName: 'status',
            propertyValue: 'PREPARING',
          },
        ]),
      );
      const fence = createApplicationStateReadinessFence(adopted);
      expect(fence).toMatchObject({
        keyName: 'run_id',
        keyValue: adopted.run_id,
        sortKeyName: 'sort_key',
        sortKeyValue: adopted.sort_key,
      });
      expect(fence.conditions).toHaveLength(Object.keys(adopted).length);
      expect(
        fence.conditions.every(
          ({ propertyValue }) => typeof propertyValue !== 'object',
        ),
      ).toBe(true);
    });

    test('advances ADOPTED directly from the exact retained floor without exposing PREPARING', async () => {
      const db = await createAdapter(adapterName);
      const first = await acquire(db);
      const original = await establish(db, first, 'ADOPTED');
      const second = await takeover(db, first);
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const bound = readiness({ ...db, transactionWrite }, second);
      const input = {
        predecessor: original,
        destinationAuthority: barrier(second),
      };

      const adopted = await bound.advanceAdopted(input);
      expect(adopted).toMatchObject({
        status: 'ADOPTED',
        store_id: STORE_ID,
        epoch: second.epoch,
      });
      expect(adopted.destination_authority_digest).toBe(
        barrier(second).record_digest,
      );
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      expect(
        transactionWrite.mock.calls[0][0].putRequests?.[0]?.record.status,
      ).toBe('ADOPTED');
      expect(await bound.advanceAdopted(input)).toEqual(adopted);
      expect(transactionWrite).toHaveBeenCalledTimes(1);
      await expect(
        bound.advanceAdopted({
          predecessor: original,
          destinationAuthority: barrier(first),
        }),
      ).rejects.toThrow(/exact current destination authority/);
      expect(await readiness(db).get({ appId: APP_ID })).toEqual(adopted);
    });

    test('a higher current epoch advances PREPARING without replacing the destination pin', async () => {
      const db = await createAdapter(adapterName);
      const first = await acquire(db);
      const old = await establish(db, first, 'PREPARING');
      const second = await takeover(db, first);
      const next = await readiness(db, second).prepare({
        destination: destination(),
      });
      expect(next).toMatchObject({
        epoch: 2,
        status: 'PREPARING',
        store_id: STORE_ID,
      });
      expect(applicationStateReadinessDestination(next)).toEqual(
        applicationStateReadinessDestination(old),
      );
      await expect(
        readiness(db, first).prepare({ destination: destination() }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      expect(await readiness(db).get({ appId: APP_ID })).toEqual(next);
    });

    test('a higher current epoch cannot erase ADOPTED through prepare', async () => {
      const db = await createAdapter(adapterName);
      const first = await acquire(db);
      const adopted = await establish(db, first, 'ADOPTED');
      const second = await takeover(db, first);
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );

      await expect(
        readiness({ ...db, transactionWrite }, second).prepare({
          destination: destination(),
        }),
      ).rejects.toMatchObject({
        code: 'WHARFIE_APPLICATION_STATE_READINESS_CONFLICT',
        reason:
          'ADOPTED authority must advance through exact destination evidence',
      });
      expect(transactionWrite).not.toHaveBeenCalled();
      expect(await readiness(db).get({ appId: APP_ID })).toEqual(adopted);
    });

    test.each(['storeId', 'provider'])(
      'a later epoch cannot replace the retained destination %s',
      async (field) => {
        const db = await createAdapter(adapterName);
        const first = await acquire(db);
        const original = await establish(db, first, 'ADOPTED');
        const second = await takeover(db, first);
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const changed = destination(
          field === 'storeId'
            ? { storeId: OTHER_STORE_ID }
            : { provider: 'lmdb' },
        );
        await expect(
          readiness({ ...db, transactionWrite }, second).prepare({
            destination: changed,
          }),
        ).rejects.toBeInstanceOf(ApplicationStateReadinessConflictError);
        expect(await readiness(db).get({ appId: APP_ID })).toEqual(original);
        expect(transactionWrite).not.toHaveBeenCalled();
      },
    );

    test('unbound mutations and a counterfeit equal-epoch token cannot create readiness', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      const reader = readiness({ ...db, transactionWrite });
      await expect(
        reader.prepare({ destination: destination() }),
      ).rejects.toThrow(/bound authority/);
      await expect(
        reader.markAdopted({ preparation: {}, destinationAuthority: {} }),
      ).rejects.toThrow(/bound authority/);
      const counterfeit = {
        ...assertCoordinatorAuthorityToken(token),
        coordinatorId: 'counterfeit',
      };
      await expect(
        readiness({ ...db, transactionWrite }, counterfeit).prepare({
          destination: destination(),
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      expect(await reader.get({ appId: APP_ID })).toBeNull();
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    test.each([
      'kind',
      'version',
      'bindingId',
      'provider',
      'tableName',
      'namespace',
      'extra-field',
    ])(
      'rejects malformed destination %s before reading authority',
      async (field) => {
        const db = await createAdapter(adapterName);
        const token = await acquire(db);
        const get = jest.fn(
          async (/** @type {GetParams} */ params) => await db.get(params),
        );
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const value = JSON.parse(JSON.stringify(destination()));
        if (field === 'extra-field') value.configuration.extra = true;
        else if (field === 'version') value.version = 1;
        else if (field === 'kind' || field === 'bindingId')
          value[field] = 'other';
        else value.configuration[field] = 'other';
        await expect(
          readiness({ ...db, get, transactionWrite }, token).prepare({
            destination: value,
          }),
        ).rejects.toThrow();
        expect(get).not.toHaveBeenCalled();
        expect(transactionWrite).not.toHaveBeenCalled();
      },
    );

    test.each([
      'store',
      'app',
      'coordinator',
      'authorityId',
      'epoch',
      'extra-field',
      'null',
    ])(
      'rejects destination readback with wrong %s before any DB access',
      async (mismatch) => {
        const db = await createAdapter(adapterName);
        const token = await acquire(db);
        const preparation = await establish(db, token, 'PREPARING');
        const stable = assertCoordinatorAuthorityToken(token);
        let destinationAuthority = barrier(token);
        if (mismatch === 'store')
          destinationAuthority = barrier(
            token,
            destination({ storeId: OTHER_STORE_ID }),
          );
        else if (mismatch === 'app')
          destinationAuthority = barrier(
            { ...stable, appId: 'other-app' },
            destination({ namespace: 'other-app' }),
          );
        else if (mismatch === 'coordinator')
          destinationAuthority = barrier({ ...stable, coordinatorId: 'other' });
        else if (mismatch === 'authorityId')
          destinationAuthority = barrier({
            ...stable,
            authorityId: createCanonicalJsonSha256Id({
              domain: 'wharfie:test:readiness-authority:v1',
              prefix: 'wca1',
              value: 'other-authority',
              valuePath: 'readiness test authority',
            }),
          });
        else if (mismatch === 'epoch')
          destinationAuthority = barrier({ ...stable, epoch: 2 });
        else if (mismatch === 'extra-field')
          destinationAuthority = { ...destinationAuthority, extra: true };
        const get = jest.fn(
          async (/** @type {GetParams} */ params) => await db.get(params),
        );
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        await expect(
          readiness({ ...db, get, transactionWrite }, token).markAdopted({
            preparation,
            destinationAuthority:
              mismatch === 'null' ? null : destinationAuthority,
          }),
        ).rejects.toThrow();
        expect(get).not.toHaveBeenCalled();
        expect(transactionWrite).not.toHaveBeenCalled();
        expect(await readiness(db).get({ appId: APP_ID })).toEqual(preparation);
      },
    );

    test.each([
      'extra-field',
      'changed-digest',
      'changed-epoch',
      'mixed-app',
      'mixed-store',
      'changed-phase',
      'changed-barrier',
    ])(
      'corrupt retained %s fails closed on read and both mutations',
      async (corruption) => {
        const db = await createAdapter(adapterName);
        const token = await acquire(db);
        const preparation = await establish(db, token, 'PREPARING');
        const record = {
          ...preparation,
          ...(corruption === 'extra-field'
            ? { extra: true }
            : corruption === 'changed-digest'
              ? { record_digest: `wasr1_${'A'.repeat(43)}` }
              : corruption === 'changed-epoch'
                ? { epoch: 2 }
                : corruption === 'mixed-app'
                  ? { app_id: 'other-app' }
                  : corruption === 'mixed-store'
                    ? { store_id: OTHER_STORE_ID }
                    : corruption === 'changed-phase'
                      ? { status: 'ADOPTED' }
                      : {
                          destination_authority_digest: `waaf1_${'A'.repeat(43)}`,
                        }),
        };
        await db.put({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          sortKeyName: 'sort_key',
          record,
        });
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const bound = readiness({ ...db, transactionWrite }, token);
        expect(() => validateApplicationStateReadinessRecord(record)).toThrow();
        await expect(bound.get({ appId: APP_ID })).rejects.toBeInstanceOf(
          ApplicationStateReadinessRecordError,
        );
        await expect(
          bound.prepare({ destination: destination() }),
        ).rejects.toBeInstanceOf(ApplicationStateReadinessRecordError);
        await expect(
          bound.markAdopted({
            preparation,
            destinationAuthority: barrier(token),
          }),
        ).rejects.toBeInstanceOf(ApplicationStateReadinessRecordError);
        expect(transactionWrite).not.toHaveBeenCalled();
      },
    );

    describe.each(PHASES)('delayed %s transition', (phase) => {
      test.each([false, true])(
        'cannot commit after source takeover (successor pin=%s)',
        async (successorPin) => {
          const db = await createAdapter(adapterName);
          const first = await acquire(db);
          const preparation =
            phase === 'ADOPTED'
              ? await establish(db, first, 'PREPARING')
              : null;
          const paused = pauseTransaction(db, phase);
          const old = readiness(paused.db, first);
          const pending =
            phase === 'PREPARING'
              ? old.prepare({ destination: destination() })
              : old.markAdopted({
                  preparation,
                  destinationAuthority: barrier(first),
                });
          await paused.entered;
          expect(paused.readTransaction()?.conditionChecks).toEqual([
            createCoordinatorAuthorityFence(first),
          ]);
          const second = await takeover(db, first);
          const retained = successorPin
            ? await readiness(db, second).prepare({
                destination: destination(),
              })
            : preparation;
          paused.release();
          await expect(pending).rejects.toBeInstanceOf(
            CoordinatorAuthorityStaleError,
          );
          expect(await readiness(db).get({ appId: APP_ID })).toEqual(retained);
          expect(paused.transactionWrite).toHaveBeenCalledTimes(1);
        },
      );
    });

    test('a delayed first preparation cannot rebase onto a competing destination pin', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const paused = pauseTransaction(db, 'PREPARING');
      const pending = readiness(paused.db, token).prepare({
        destination: destination(),
      });
      await paused.entered;
      const winner = await readiness(db, token).prepare({
        destination: destination({ storeId: OTHER_STORE_ID }),
      });
      paused.release();
      await expect(pending).rejects.toBeInstanceOf(
        ApplicationStateReadinessConflictError,
      );
      expect(await readiness(db).get({ appId: APP_ID })).toEqual(winner);
      expect(paused.transactionWrite).toHaveBeenCalledTimes(1);
    });

    test('a delayed direct ADOPTED advancement returns the same-token winner; explicit retry reads it', async () => {
      const db = await createAdapter(adapterName);
      const first = await acquire(db);
      const original = await establish(db, first, 'ADOPTED');
      const second = await takeover(db, first);
      const paused = pauseTransaction(db, 'ADOPTED');
      const bound = readiness(paused.db, second);
      const input = {
        predecessor: original,
        destinationAuthority: barrier(second),
      };
      const pending = bound.advanceAdopted(input);
      await paused.entered;
      const winner = await readiness(db, second).advanceAdopted(input);
      paused.release();
      expect(await pending).toEqual(winner);
      expect(await bound.advanceAdopted(input)).toEqual(winner);
      expect(paused.transactionWrite).toHaveBeenCalledTimes(1);
    });

    test('a lost adoption CAS returns the exact same-token winner without a second write', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const preparation = await establish(db, token, 'PREPARING');
      const paused = pauseTransaction(db, 'ADOPTED');
      const input = { preparation, destinationAuthority: barrier(token) };
      const pending = readiness(paused.db, token).markAdopted(input);
      await paused.entered;
      const winner = await readiness(db, token).markAdopted(input);
      paused.release();
      expect(await pending).toEqual(winner);
      expect(paused.transactionWrite).toHaveBeenCalledTimes(1);
    });

    describe.each(PHASES)('%s response loss', (phase) => {
      test.each(['current', 'taken-over', 'released'])(
        'returns only an exact retained result with current authority (%s)',
        async (outcome) => {
          const db = await createAdapter(adapterName);
          const token = await acquire(db);
          const preparation =
            phase === 'ADOPTED'
              ? await establish(db, token, 'PREPARING')
              : null;
          let lost = false;
          const transactionWrite = jest.fn(
            async (/** @type {Transaction} */ params) => {
              await db.transactionWrite(params);
              if (!lost && isReadinessWrite(params, phase)) {
                lost = true;
                if (outcome === 'taken-over') {
                  const second = await takeover(db, token);
                  if (phase === 'ADOPTED') {
                    const predecessor = await readiness(db).get({
                      appId: APP_ID,
                    });
                    await readiness(db, second).advanceAdopted({
                      predecessor,
                      destinationAuthority: barrier(second),
                    });
                  } else {
                    await establish(db, second, phase);
                  }
                } else if (outcome === 'released') {
                  await control(db).release({
                    authority: token,
                    requestId: 'release-a',
                    observedAt: 30,
                  });
                }
                throw new Error('lost readiness response');
              }
            },
          );
          const bound = readiness({ ...db, transactionWrite }, token);
          const pending =
            phase === 'PREPARING'
              ? bound.prepare({ destination: destination() })
              : bound.markAdopted({
                  preparation,
                  destinationAuthority: barrier(token),
                });
          if (outcome === 'current') {
            const result = await pending;
            expect(result).toEqual(await readiness(db).get({ appId: APP_ID }));
            expect(result.status).toBe(phase);
            expect(await bound.prepare({ destination: destination() })).toEqual(
              result,
            );
          } else {
            await expect(pending).rejects.toBeInstanceOf(
              CoordinatorAuthorityStaleError,
            );
            expect(await readiness(db).get({ appId: APP_ID })).toMatchObject({
              epoch: outcome === 'taken-over' ? 2 : 1,
              status: phase,
            });
          }
          expect(lost).toBe(true);
          expect(transactionWrite).toHaveBeenCalledTimes(1);
        },
      );
    });

    test('a lost preparation response does not return a different later phase as the exact transition result', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      let lost = false;
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) => {
          await db.transactionWrite(params);
          if (!lost && isReadinessWrite(params, 'PREPARING')) {
            lost = true;
            await establish(db, token, 'ADOPTED');
            throw new Error('lost preparation response');
          }
        },
      );
      const bound = readiness({ ...db, transactionWrite }, token);
      await expect(
        bound.prepare({ destination: destination() }),
      ).rejects.toThrow('lost preparation response');
      expect(await bound.prepare({ destination: destination() })).toMatchObject(
        { status: 'ADOPTED', epoch: 1 },
      );
      expect(transactionWrite).toHaveBeenCalledTimes(1);
    });

    test.each(['released', 'taken-over'])(
      'exact ADOPTED readiness is not a historical receipt after authority is %s',
      async (outcome) => {
        const db = await createAdapter(adapterName);
        const token = await acquire(db);
        const adopted = await establish(db, token, 'ADOPTED');
        if (outcome === 'released')
          await control(db).release({
            authority: token,
            requestId: 'release-a',
            observedAt: 30,
          });
        else await takeover(db, token);
        const transactionWrite = jest.fn(
          async (/** @type {Transaction} */ params) =>
            await db.transactionWrite(params),
        );
        const bound = readiness({ ...db, transactionWrite }, token);
        await expect(
          bound.prepare({ destination: destination() }),
        ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
        await expect(
          bound.markAdopted({
            preparation: adopted,
            destinationAuthority: barrier(token),
          }),
        ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
        expect(await bound.get({ appId: APP_ID })).toEqual(adopted);
        expect(transactionWrite).not.toHaveBeenCalled();
      },
    );

    test('constructor token/options and prepare destination are captured before the first await', async () => {
      const db = await createAdapter(adapterName);
      const original = await acquire(db);
      const mutableToken = { ...assertCoordinatorAuthorityToken(original) };
      const paused = pauseRead(db, COORDINATOR_AUTHORITY_SORT_KEY);
      const options = {
        db: paused.db,
        tableName: TABLE_NAME,
        coordinatorAuthority: mutableToken,
      };
      const bound = createApplicationStateReadinessStore(options);
      mutableToken.epoch = 99;
      mutableToken.appId = 'redirected-app';
      options.tableName = 'redirected-table';
      const value = JSON.parse(JSON.stringify(destination()));
      const input = { destination: value };
      const pending = bound.prepare(input);
      await paused.entered;
      value.configuration.storeId = OTHER_STORE_ID;
      value.configuration.namespace = 'redirected-app';
      value.configuration.provider = 'lmdb';
      input.destination = { changed: true };
      paused.release();
      const prepared = await pending;
      expect(applicationStateReadinessAuthority(prepared)).toEqual(
        assertCoordinatorAuthorityToken(original),
      );
      expect(applicationStateReadinessDestination(prepared)).toEqual(
        destination(),
      );
    });

    test('markAdopted captures both nested physical records before its first await', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const preparation = await establish(db, token, 'PREPARING');
      const paused = pauseRead(db, COORDINATOR_AUTHORITY_SORT_KEY);
      const input = JSON.parse(
        JSON.stringify({ preparation, destinationAuthority: barrier(token) }),
      );
      const pending = readiness(paused.db, token).markAdopted(input);
      await paused.entered;
      input.preparation.epoch = 99;
      input.preparation.store_id = OTHER_STORE_ID;
      input.destinationAuthority.store_id = OTHER_STORE_ID;
      input.destinationAuthority.epoch = 99;
      input.preparation = null;
      paused.release();
      expect(await pending).toMatchObject({
        status: 'ADOPTED',
        epoch: 1,
        store_id: STORE_ID,
      });
    });

    test('get captures scope and each app has its own independent destination pin', async () => {
      const db = await createAdapter(adapterName);
      const first = await acquire(db);
      const original = await establish(db, first, 'PREPARING');
      const other = await acquire(db, 'other-app');
      const otherPin = await readiness(db, other).prepare({
        destination: destination({
          namespace: 'other-app',
          storeId: OTHER_STORE_ID,
          provider: 'lmdb',
        }),
      });
      const paused = pauseRead(db, APPLICATION_STATE_READINESS_SORT_KEY);
      const scope = { appId: APP_ID };
      const pending = readiness(paused.db).get(scope);
      await paused.entered;
      scope.appId = 'other-app';
      paused.release();
      expect(await pending).toEqual(original);
      expect(await readiness(db).get({ appId: 'other-app' })).toEqual(otherPin);
      expect(original.run_id).not.toBe(otherPin.run_id);
    });

    test('rejects malformed scope, cross-app binding, and a foreign preparation before any reads', async () => {
      const db = await createAdapter(adapterName);
      const first = await acquire(db);
      const old = await establish(db, first, 'PREPARING');
      const second = await takeover(db, first);
      const current = await establish(db, second, 'PREPARING');
      const get = jest.fn(
        async (/** @type {GetParams} */ params) => await db.get(params),
      );
      const bound = readiness({ ...db, get }, first);
      await expect(bound.get({ appId: 'other-app' })).rejects.toThrow(/appId/);
      await expect(
        bound.get(/** @type {any} */ ({ appId: APP_ID, extra: true })),
      ).rejects.toThrow(/unsupported/);
      await expect(
        bound.markAdopted({
          preparation: current,
          destinationAuthority: barrier(second),
        }),
      ).rejects.toThrow(/bound authority/);
      await expect(
        bound.markAdopted(
          /** @type {any} */ ({
            preparation: old,
            destinationAuthority: barrier(first),
            extra: true,
          }),
        ),
      ).rejects.toThrow(/unsupported/);
      expect(get).not.toHaveBeenCalled();
    });

    test('markAdopted never recreates a missing retained preparation', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db);
      const preparation = await establish(db, token, 'PREPARING');
      await db.remove({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: preparation.run_id,
        sortKeyName: 'sort_key',
        sortKeyValue: preparation.sort_key,
      });
      const transactionWrite = jest.fn(
        async (/** @type {Transaction} */ params) =>
          await db.transactionWrite(params),
      );
      await expect(
        readiness({ ...db, transactionWrite }, token).markAdopted({
          preparation,
          destinationAuthority: barrier(token),
        }),
      ).rejects.toBeInstanceOf(ApplicationStateReadinessConflictError);
      expect(await readiness(db).get({ appId: APP_ID })).toBeNull();
      expect(transactionWrite).not.toHaveBeenCalled();
    });

    test('a valid record returned from another app or authority partition cannot masquerade as this app readiness', async () => {
      const db = await createAdapter(adapterName);
      const token = await acquire(db, 'other-app');
      const foreign = await readiness(db, token).prepare({
        destination: destination({ namespace: 'other-app' }),
      });
      const wrapped = {
        ...db,
        async get(/** @type {GetParams} */ params) {
          if (
            params.keyValue === getApplicationStateReadinessPartitionKey(APP_ID)
          )
            return foreign;
          return await db.get(params);
        },
      };
      await expect(
        readiness(wrapped).get({ appId: APP_ID }),
      ).rejects.toBeInstanceOf(ApplicationStateReadinessRecordError);
      expect(getApplicationStateReadinessPartitionKey(APP_ID)).not.toBe(
        getCoordinatorAuthorityPartitionKey(APP_ID),
      );
    });
  },
);
