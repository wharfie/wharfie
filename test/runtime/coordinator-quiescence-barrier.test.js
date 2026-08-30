/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONDITION_TYPE } from '../../src/core/lib/db/base.js';
import {
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
  CoordinatorQuiescenceBarrierClosedError,
  CoordinatorQuiescenceBarrierConflictError,
  CoordinatorQuiescenceBarrierRecordError,
  CoordinatorQuiescenceBarrierRequestConflictError,
  CoordinatorQuiescenceBarrierState,
  CoordinatorQuiescenceBarrierTransitionUnknownError,
  createCoordinatorQuiescenceAdmissionFence,
  createCoordinatorQuiescenceBarrier,
  getCoordinatorQuiescenceBarrierPartitionKey,
} from '../../src/core/lib/db/tables/coordinator-quiescence-barrier.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

const TABLE_NAME = 'execution-ledger';
const APP_ID = 'quiescence-app';

/**
 * @typedef {{
 *   name: string,
 *   create: () => Promise<{
 *     db: import('../../src/core/lib/db/base.js').DBClient,
 *     cleanup: () => Promise<void>,
 *   }>,
 * }} AdapterCase
 */

/** @type {AdapterCase[]} */
const adapterCases = [
  {
    name: 'vanilla',
    async create() {
      const path = mkdtempSync(join(tmpdir(), 'wharfie-quiescence-barrier-'));
      const db = await createVanillaDB(path);
      return {
        db,
        async cleanup() {
          await db.close();
          rmSync(path, { recursive: true, force: true });
        },
      };
    },
  },
  {
    name: 'mocked DynamoDB',
    async create() {
      const { db } = await createMockedDynamoDB({
        tableSchemas: { [TABLE_NAME]: ['run_id', 'sort_key'] },
      });
      return {
        db,
        async cleanup() {
          await db.close();
        },
      };
    },
  },
];

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
    throw new AggregateError(failures, 'quiescence barrier cleanup failed');
  }
});

/** @param {AdapterCase} adapterCase */
async function createAdapter(adapterCase) {
  const adapter = await adapterCase.create();
  cleanups.push(adapter.cleanup);
  return adapter.db;
}

/** @param {import('../../src/core/lib/db/base.js').DBClient} db */
async function acquireAuthority(db) {
  const authority = createCoordinatorAuthority({
    db,
    tableName: TABLE_NAME,
  });
  const acquired = await authority.acquire({
    appId: APP_ID,
    coordinatorId: 'coordinator-a',
    requestId: 'acquire-a',
    observedAt: 1,
  });
  return { authority, acquired: acquired.authority };
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  expect(Object.isFrozen(value)).toBe(true);
  if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) expectDeepFrozen(nested);
  }
}

/** @param {unknown} value @returns {unknown} */
function reverseObjectKeys(value) {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, nested]) => [key, reverseObjectKeys(nested)]),
  );
}

/**
 * @param {import('../../src/core/lib/db/base.js').DBClient} db
 * @param {import('../../src/core/lib/db/base.js').TransactionConditionCheck} conditionCheck
 * @param {string} id
 */
async function commitProof(db, conditionCheck, id) {
  await db.transactionWrite({
    tableName: TABLE_NAME,
    conditionChecks: [conditionCheck],
    putRequests: [
      {
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: {
          run_id: `proof-${id}`,
          sort_key: 'proof',
          value: id,
        },
        conditions: [
          {
            conditionType: CONDITION_TYPE.NOT_EXISTS,
            propertyName: 'sort_key',
          },
        ],
      },
    ],
  });
}

describe.each(adapterCases)(
  'coordinator quiescence barrier over $name',
  (adapterCase) => {
    test('treats absence as conditionally open and preserves commits that linearize before close', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });

      await expect(store.get({ appId: APP_ID })).resolves.toBeNull();
      const prepared = await store.prepareFreshAdmission({ appId: APP_ID });
      expect(prepared).toEqual({
        barrier: null,
        conditionCheck: {
          keyName: 'run_id',
          keyValue: getCoordinatorQuiescenceBarrierPartitionKey(APP_ID),
          sortKeyName: 'sort_key',
          sortKeyValue: COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
          conditions: [
            {
              conditionType: CONDITION_TYPE.NOT_EXISTS,
              propertyName: 'sort_key',
            },
          ],
        },
      });
      expectDeepFrozen(prepared);

      await commitProof(db, prepared.conditionCheck, 'before-close');
      const closed = await store.close({
        authority: acquired,
        requestId: 'close-first',
        predecessor: null,
        observedAt: 10,
      });
      expect(closed).toMatchObject({
        applied: true,
        action: 'close',
        barrier: {
          appId: APP_ID,
          state: CoordinatorQuiescenceBarrierState.CLOSED,
          version: 1,
          authority: {
            schemaVersion: 1,
            appId: APP_ID,
            coordinatorId: 'coordinator-a',
            authorityId: acquired.authorityId,
            epoch: 1,
          },
          lastAction: 'close',
          lastRequestId: 'close-first',
          updatedAt: 10,
        },
        receipt: {
          appId: APP_ID,
          requestId: 'close-first',
          action: 'close',
          predecessor: null,
        },
      });
      expectDeepFrozen(closed);
      await expect(
        db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'proof-before-close',
          sortKeyName: 'sort_key',
          sortKeyValue: 'proof',
          consistentRead: true,
        }),
      ).resolves.toMatchObject({ value: 'before-close' });
      await expect(
        store.prepareFreshAdmission({ appId: APP_ID }),
      ).rejects.toMatchObject({
        name: 'CoordinatorQuiescenceBarrierClosedError',
        code: 'WHARFIE_COORDINATOR_QUIESCENCE_BARRIER_CLOSED',
        appId: APP_ID,
        version: 1,
      });
    });

    test('lets close win against a delayed missing fence and exact receipt replay remains read-only while closed', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      const delayed = await store.prepareFreshAdmission({ appId: APP_ID });
      const request = {
        authority: acquired,
        requestId: 'close-winner',
        predecessor: null,
        observedAt: 20,
      };
      const winner = await store.close(request);

      await expect(
        commitProof(db, delayed.conditionCheck, 'delayed-missing'),
      ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
      await expect(store.close(request)).resolves.toEqual({
        applied: false,
        action: 'close',
        barrier: winner.barrier,
        receipt: winner.receipt,
      });
      await expect(
        store.close({ ...request, requestId: 'different-close' }),
      ).rejects.toBeInstanceOf(CoordinatorQuiescenceBarrierConflictError);
      await expect(
        store.reopen({
          authority: acquired,
          requestId: 'close-winner',
          predecessor: winner.barrier,
          observedAt: 21,
        }),
      ).rejects.toBeInstanceOf(
        CoordinatorQuiescenceBarrierRequestConflictError,
      );
    });

    test('advances every transition version so a pre-close OPEN fence cannot pass after reopen', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      const firstClose = await store.close({
        authority: acquired,
        requestId: 'close-v1',
        predecessor: null,
        observedAt: 30,
      });
      const firstOpen = await store.reopen({
        authority: acquired,
        requestId: 'open-v2',
        predecessor: firstClose.barrier,
        observedAt: 31,
      });
      const staleAdmission = await store.prepareFreshAdmission({
        appId: APP_ID,
      });
      expect(staleAdmission.barrier).toEqual(firstOpen.barrier);

      const secondClose = await store.close({
        authority: acquired,
        requestId: 'close-v3',
        predecessor: firstOpen.barrier,
        observedAt: 32,
      });
      const secondOpen = await store.reopen({
        authority: acquired,
        requestId: 'open-v4',
        predecessor: secondClose.barrier,
        observedAt: 33,
      });
      expect(secondOpen.barrier).toMatchObject({
        state: CoordinatorQuiescenceBarrierState.OPEN,
        version: 4,
        lastRequestId: 'open-v4',
      });

      await expect(
        commitProof(db, staleAdmission.conditionCheck, 'stale-open'),
      ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
      const freshAdmission = await store.prepareFreshAdmission({
        appId: APP_ID,
      });
      await expect(
        commitProof(db, freshAdmission.conditionCheck, 'fresh-open'),
      ).resolves.toBeUndefined();
    });

    test('adopts a retained CLOSED predecessor under a strictly newer exact authority before reopening', async () => {
      const db = await createAdapter(adapterCase);
      const { authority, acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      const closed = await store.close({
        authority: acquired,
        requestId: 'close-before-takeover',
        predecessor: null,
        observedAt: 40,
      });
      const takeover = await authority.takeover({
        appId: APP_ID,
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-b',
        observedAuthority: acquired,
        confirmAuthorityReplacement: true,
        observedAt: 41,
      });

      const adopted = await store.adopt({
        authority: {
          schemaVersion: 1,
          appId: APP_ID,
          coordinatorId: 'coordinator-b',
          authorityId: takeover.authority.authorityId,
          epoch: 2,
        },
        requestId: 'adopt-b',
        predecessor: closed.barrier,
        observedAt: 42,
      });
      expect(adopted.barrier).toMatchObject({
        state: CoordinatorQuiescenceBarrierState.CLOSED,
        version: 2,
        authority: {
          coordinatorId: 'coordinator-b',
          epoch: 2,
        },
        lastAction: 'adopt',
      });
      await expect(
        store.prepareFreshAdmission({ appId: APP_ID }),
      ).rejects.toBeInstanceOf(CoordinatorQuiescenceBarrierClosedError);

      const reopened = await store.reopen({
        authority: takeover.authority,
        requestId: 'reopen-b',
        predecessor: adopted.barrier,
        observedAt: 43,
      });
      expect(reopened.barrier).toMatchObject({
        state: CoordinatorQuiescenceBarrierState.OPEN,
        version: 3,
        authority: {
          schemaVersion: 1,
          appId: APP_ID,
          coordinatorId: 'coordinator-b',
          authorityId: takeover.authority.authorityId,
          epoch: 2,
        },
      });
      await expect(
        store.adopt({
          authority: {
            schemaVersion: 1,
            appId: APP_ID,
            coordinatorId: 'coordinator-b',
            authorityId: takeover.authority.authorityId,
            epoch: 2,
          },
          requestId: 'adopt-same-epoch',
          predecessor: adopted.barrier,
          observedAt: 44,
        }),
      ).rejects.toThrow('strictly newer authority epoch');
    });

    test('rejects a predecessor transaction after authority takeover and permits the successor to close', async () => {
      const db = await createAdapter(adapterCase);
      const { authority, acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      const closed = await store.close({
        authority: acquired,
        requestId: 'seed-close',
        predecessor: null,
        observedAt: 50,
      });
      const opened = await store.reopen({
        authority: acquired,
        requestId: 'seed-open',
        predecessor: closed.barrier,
        observedAt: 51,
      });
      const takeover = await authority.takeover({
        appId: APP_ID,
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-for-close',
        observedAuthority: acquired,
        confirmAuthorityReplacement: true,
        observedAt: 52,
      });

      await expect(
        store.close({
          authority: acquired,
          requestId: 'stale-close',
          predecessor: opened.barrier,
          observedAt: 53,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
      await expect(
        store.close({
          authority: takeover.authority,
          requestId: 'successor-close',
          predecessor: opened.barrier,
          observedAt: 54,
        }),
      ).resolves.toMatchObject({
        applied: true,
        barrier: {
          state: CoordinatorQuiescenceBarrierState.CLOSED,
          version: 3,
          authority: {
            schemaVersion: 1,
            appId: APP_ID,
            coordinatorId: 'coordinator-b',
            authorityId: takeover.authority.authorityId,
            epoch: 2,
          },
        },
      });
    });

    test('strongly reads back a committed response loss and fails closed before commit', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      let loseAfterCommit = true;
      const afterCommitDb = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          await db.transactionWrite(params);
          if (loseAfterCommit) {
            loseAfterCommit = false;
            throw new Error('simulated barrier response loss after commit');
          }
        },
      };
      const afterCommit = createCoordinatorQuiescenceBarrier({
        db: afterCommitDb,
        tableName: TABLE_NAME,
      });
      const request = {
        authority: acquired,
        requestId: 'ambiguous-close',
        predecessor: null,
        observedAt: 60,
      };
      const readback = await afterCommit.close(request);
      expect(readback).toMatchObject({
        applied: true,
        barrier: { state: CoordinatorQuiescenceBarrierState.CLOSED },
      });
      await expect(afterCommit.close(request)).resolves.toMatchObject({
        applied: false,
        barrier: readback.barrier,
        receipt: readback.receipt,
      });

      const reopened = await afterCommit.reopen({
        authority: acquired,
        requestId: 'open-after-readback',
        predecessor: readback.barrier,
        observedAt: 61,
      });
      let failBeforeCommit = true;
      const beforeCommitDb = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          if (failBeforeCommit) {
            failBeforeCommit = false;
            throw new Error('simulated barrier response loss before commit');
          }
          await db.transactionWrite(params);
        },
      };
      const beforeCommit = createCoordinatorQuiescenceBarrier({
        db: beforeCommitDb,
        tableName: TABLE_NAME,
      });
      const uncertainRequest = {
        authority: acquired,
        requestId: 'unknown-close',
        predecessor: reopened.barrier,
        observedAt: 62,
      };
      await expect(beforeCommit.close(uncertainRequest)).rejects.toBeInstanceOf(
        CoordinatorQuiescenceBarrierTransitionUnknownError,
      );
      await expect(beforeCommit.get({ appId: APP_ID })).resolves.toEqual(
        reopened.barrier,
      );
      await expect(beforeCommit.close(uncertainRequest)).resolves.toMatchObject(
        {
          applied: true,
          barrier: {
            state: CoordinatorQuiescenceBarrierState.CLOSED,
            version: reopened.barrier.version + 1,
          },
        },
      );
    });

    test('accepts an exact retained receipt independent of provider map key order', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      const request = {
        authority: acquired,
        requestId: 'reordered-receipt-close',
        predecessor: null,
        observedAt: 65,
      };
      const accepted = await store.close(request);
      const reorderedDb = {
        ...db,
        async get(
          /** @type {import('../../src/core/lib/db/base.js').GetParams} */ params,
        ) {
          const record = await db.get(params);
          return record?.record_kind ===
            'coordinator-quiescence-barrier-request'
            ? {
                ...record,
                predecessor: reverseObjectKeys(record.predecessor),
                barrier: reverseObjectKeys(record.barrier),
              }
            : record;
        },
      };
      const reordered = createCoordinatorQuiescenceBarrier({
        db: reorderedDb,
        tableName: TABLE_NAME,
      });

      await expect(reordered.close(request)).resolves.toEqual({
        applied: false,
        action: 'close',
        barrier: accepted.barrier,
        receipt: accepted.receipt,
      });
    });

    test('reports stale authority when takeover also changed the preflight predecessor', async () => {
      const db = await createAdapter(adapterCase);
      const { authority, acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      const closed = await store.close({
        authority: acquired,
        requestId: 'close-before-preflight-takeover',
        predecessor: null,
        observedAt: 66,
      });
      const takeover = await authority.takeover({
        appId: APP_ID,
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-before-preflight-mismatch',
        observedAuthority: acquired,
        confirmAuthorityReplacement: true,
        observedAt: 67,
      });
      await store.adopt({
        authority: takeover.authority,
        requestId: 'adopt-before-stale-preflight',
        predecessor: closed.barrier,
        observedAt: 68,
      });

      await expect(
        store.reopen({
          authority: acquired,
          requestId: 'stale-reopen-after-adopt',
          predecessor: closed.barrier,
          observedAt: 69,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
    });

    test('reports takeover before an uncommitted non-conditional write outcome', async () => {
      const db = await createAdapter(adapterCase);
      const { authority, acquired } = await acquireAuthority(db);
      let replaced = false;
      const failingDb = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ _params,
        ) {
          if (!replaced) {
            replaced = true;
            await authority.takeover({
              appId: APP_ID,
              coordinatorId: 'coordinator-b',
              requestId: 'takeover-during-unknown-write',
              observedAuthority: acquired,
              confirmAuthorityReplacement: true,
              observedAt: 72,
            });
          }
          throw new Error('simulated non-conditional transport failure');
        },
      };
      const store = createCoordinatorQuiescenceBarrier({
        db: failingDb,
        tableName: TABLE_NAME,
      });

      await expect(
        store.close({
          authority: acquired,
          requestId: 'close-with-takeover-during-write',
          predecessor: null,
          observedAt: 71,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);
    });

    test('retains every cause when an ambiguous write and authority diagnostic both fail', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      const writeFailure = new Error('simulated ambiguous barrier write');
      const authorityReadFailure = new Error(
        'simulated authority diagnostic read failure',
      );
      const failingDb = {
        ...db,
        async get(
          /** @type {import('../../src/core/lib/db/base.js').GetParams} */ params,
        ) {
          if (params.sortKeyValue === COORDINATOR_AUTHORITY_SORT_KEY) {
            throw authorityReadFailure;
          }
          return await db.get(params);
        },
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ _params,
        ) {
          throw writeFailure;
        },
      };
      const store = createCoordinatorQuiescenceBarrier({
        db: failingDb,
        tableName: TABLE_NAME,
      });

      let failure;
      try {
        await store.close({
          authority: acquired,
          requestId: 'close-with-unavailable-authority-diagnostic',
          predecessor: null,
          observedAt: 73,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(
        CoordinatorQuiescenceBarrierTransitionUnknownError,
      );
      expect(failure).toMatchObject({
        cause: expect.any(AggregateError),
      });
      const cause = /** @type {Error & {errors: unknown[]}} */ (
        /** @type {CoordinatorQuiescenceBarrierTransitionUnknownError} */ (
          failure
        ).cause
      );
      expect(cause.errors).toEqual([writeFailure, authorityReadFailure]);
    });

    test('fails closed when retained barrier bytes do not match their digest', async () => {
      const db = await createAdapter(adapterCase);
      const { acquired } = await acquireAuthority(db);
      const store = createCoordinatorQuiescenceBarrier({
        db,
        tableName: TABLE_NAME,
      });
      await store.close({
        authority: acquired,
        requestId: 'close-before-corruption',
        predecessor: null,
        observedAt: 70,
      });
      const keyValue = getCoordinatorQuiescenceBarrierPartitionKey(APP_ID);
      const raw = await db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue,
        sortKeyName: 'sort_key',
        sortKeyValue: COORDINATOR_QUIESCENCE_BARRIER_SORT_KEY,
        consistentRead: true,
      });
      if (!raw) throw new Error('Expected retained barrier record.');
      await db.put({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: { ...raw, updated_at: raw.updated_at + 1 },
      });

      await expect(store.get({ appId: APP_ID })).rejects.toBeInstanceOf(
        CoordinatorQuiescenceBarrierRecordError,
      );
      await expect(
        store.prepareFreshAdmission({ appId: APP_ID }),
      ).rejects.toBeInstanceOf(CoordinatorQuiescenceBarrierRecordError);
    });
  },
);

test('the pure fresh-admission fence rejects CLOSED and app-mismatched snapshots', () => {
  const barrier = /** @type {any} */ ({
    schemaVersion: 1,
    appId: APP_ID,
    state: CoordinatorQuiescenceBarrierState.CLOSED,
    version: 1,
    authority: {
      schemaVersion: 1,
      appId: APP_ID,
      coordinatorId: 'coordinator-a',
      authorityId: 'wca1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      epoch: 1,
    },
    lastAction: 'close',
    lastRequestId: 'close',
    updatedAt: 1,
  });
  expect(() =>
    createCoordinatorQuiescenceAdmissionFence({
      appId: APP_ID,
      barrier,
    }),
  ).toThrow(CoordinatorQuiescenceBarrierClosedError);
  expect(() =>
    createCoordinatorQuiescenceAdmissionFence({
      appId: 'other-app',
      barrier,
    }),
  ).toThrow('must match appId');
});
