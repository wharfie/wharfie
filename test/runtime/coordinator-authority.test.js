/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
  COORDINATOR_AUTHORITY_RECORD_KIND,
  COORDINATOR_AUTHORITY_SCHEMA_VERSION,
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityEpochOverflowError,
  CoordinatorAuthorityRequestConflictError,
  CoordinatorAuthorityStaleError,
  CoordinatorAuthorityStatus,
  assertCoordinatorAuthorityCurrent,
  createCoordinatorAuthority,
  createCoordinatorAuthorityFence,
  createCoordinatorAuthorityToken,
  getCoordinatorAuthorityPartitionKey,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { CONDITION_TYPE } from '../../src/core/lib/db/base.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

const TABLE_NAME = 'execution-ledger';
const APP_ID = 'example-app';

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
      const path = mkdtempSync(join(tmpdir(), 'wharfie-authority-'));
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
    throw new AggregateError(failures, 'authority test cleanup failed');
  }
});

/** @param {AdapterCase} adapterCase */
async function createAdapter(adapterCase) {
  const adapter = await adapterCase.create();
  cleanups.push(adapter.cleanup);
  return adapter.db;
}

function acquireInput(
  coordinatorId = 'coordinator-a',
  requestId = 'acquire-a',
) {
  return {
    appId: APP_ID,
    coordinatorId,
    requestId,
    observedAt: 10,
  };
}

describe.each(adapterCases)(
  'coordinator authority over $name',
  (adapterCase) => {
    test('acquires, heartbeats diagnostically, releases, and reacquires at a newer epoch', async () => {
      const db = await createAdapter(adapterCase);
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });

      const acquired = await store.acquire(acquireInput());
      expect(acquired).toMatchObject({
        applied: true,
        action: 'acquire',
        authority: {
          schemaVersion: 1,
          appId: APP_ID,
          coordinatorId: 'coordinator-a',
          epoch: 1,
          status: CoordinatorAuthorityStatus.ACTIVE,
          recordVersion: 1,
          acquisitionRequestId: 'acquire-a',
          acquiredAt: 10,
          heartbeatAt: 10,
          releasedAt: null,
          updatedAt: 10,
          lastRequestId: 'acquire-a',
        },
      });

      const token = createCoordinatorAuthorityToken(acquired.authority);
      expect(token).toEqual({
        schemaVersion: 1,
        appId: APP_ID,
        coordinatorId: 'coordinator-a',
        authorityId: acquired.authority.authorityId,
        epoch: 1,
      });
      expect(Object.isFrozen(token)).toBe(true);

      const fenceBeforeHeartbeat = createCoordinatorAuthorityFence(token);
      const heartbeat = await store.heartbeat({
        authority: acquired.authority,
        requestId: 'heartbeat-a',
        observedAt: 20,
      });
      expect(heartbeat.authority).toMatchObject({
        authorityId: token.authorityId,
        epoch: 1,
        status: CoordinatorAuthorityStatus.ACTIVE,
        recordVersion: 2,
        heartbeatAt: 20,
        updatedAt: 20,
      });
      expect(createCoordinatorAuthorityFence(heartbeat.authority)).toEqual(
        fenceBeforeHeartbeat,
      );
      await expect(
        assertCoordinatorAuthorityCurrent({
          db,
          tableName: TABLE_NAME,
          authority: token,
        }),
      ).resolves.toMatchObject({ recordVersion: 2 });

      const released = await store.release({
        authority: token,
        requestId: 'release-a',
        observedAt: 30,
      });
      expect(released.authority).toMatchObject({
        authorityId: token.authorityId,
        epoch: 1,
        status: CoordinatorAuthorityStatus.RELEASED,
        recordVersion: 3,
        releasedAt: 30,
      });
      await expect(
        assertCoordinatorAuthorityCurrent({
          db,
          tableName: TABLE_NAME,
          authority: token,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);

      const reacquired = await store.acquire({
        ...acquireInput('coordinator-b', 'acquire-b'),
        observedAt: 40,
      });
      expect(reacquired.authority).toMatchObject({
        coordinatorId: 'coordinator-b',
        epoch: 2,
        status: CoordinatorAuthorityStatus.ACTIVE,
        recordVersion: 4,
      });
      await expect(store.get({ appId: APP_ID })).resolves.toEqual(
        reacquired.authority,
      );
    });

    test('allows exactly one confirmed takeover and fences the predecessor', async () => {
      const db = await createAdapter(adapterCase);
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await store.acquire(acquireInput());
      const predecessor = acquired.authority;

      const requests = [
        {
          appId: APP_ID,
          coordinatorId: 'coordinator-b',
          requestId: 'takeover-b',
          observedAuthority: predecessor,
          confirmAuthorityReplacement: true,
          observedAt: 20,
        },
        {
          appId: APP_ID,
          coordinatorId: 'coordinator-c',
          requestId: 'takeover-c',
          observedAuthority: predecessor,
          confirmAuthorityReplacement: true,
          observedAt: 21,
        },
      ];
      const raced = await Promise.allSettled(
        requests.map(async (request) => await store.takeover(request)),
      );
      const winners = raced
        .map((result, index) => ({ result, index }))
        .filter(({ result }) => result.status === 'fulfilled');
      const losers = raced.filter((result) => result.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].reason).toBeInstanceOf(
        CoordinatorAuthorityConflictError,
      );

      const winner = winners[0];
      if (!winner || winner.result.status !== 'fulfilled') {
        throw new Error('Expected exactly one fulfilled takeover.');
      }
      const winnerResult = winner.result.value;
      expect(winnerResult.authority).toMatchObject({
        epoch: 2,
        status: CoordinatorAuthorityStatus.ACTIVE,
        recordVersion: 2,
      });
      await expect(
        store.takeover(requests[winner.index]),
      ).resolves.toMatchObject({
        applied: false,
        authority: winnerResult.authority,
      });
      await expect(
        assertCoordinatorAuthorityCurrent({
          db,
          tableName: TABLE_NAME,
          authority: predecessor,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityStaleError);

      await expect(
        db.transactionWrite({
          tableName: TABLE_NAME,
          conditionChecks: [createCoordinatorAuthorityFence(predecessor)],
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: {
                run_id: 'stale-write',
                sort_key: 'proof',
                value: 'must-not-commit',
              },
              conditions: [
                {
                  conditionType: CONDITION_TYPE.NOT_EXISTS,
                  propertyName: 'sort_key',
                },
              ],
            },
          ],
        }),
      ).rejects.toMatchObject({ name: 'ConditionalCheckFailedException' });
      await expect(
        db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'stale-write',
          sortKeyName: 'sort_key',
          sortKeyValue: 'proof',
          consistentRead: true,
        }),
      ).resolves.toBeUndefined();
    });

    test('retains stable request intent and reads back an ambiguous committed response', async () => {
      const db = await createAdapter(adapterCase);
      let loseResponse = true;
      const faulted = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          await db.transactionWrite(params);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('simulated response loss after commit');
          }
        },
      };
      const store = createCoordinatorAuthority({
        db: faulted,
        tableName: TABLE_NAME,
      });

      const acquired = await store.acquire(acquireInput());
      expect(acquired).toMatchObject({
        applied: true,
        authority: { epoch: 1, status: CoordinatorAuthorityStatus.ACTIVE },
      });
      await expect(store.acquire(acquireInput())).resolves.toMatchObject({
        applied: false,
        authority: acquired.authority,
      });
      await expect(
        store.acquire(acquireInput('coordinator-b', 'acquire-a')),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityRequestConflictError);
    });

    test('replays an identical request that commits between its receipt and predecessor reads', async () => {
      const db = await createAdapter(adapterCase);
      const direct = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      /** @type {undefined | (() => Promise<unknown>)} */
      let injectWinner;
      const interleavedDb = {
        ...db,
        async get(
          /** @type {import('../../src/core/lib/db/base.js').GetParams} */ params,
        ) {
          if (
            injectWinner &&
            params.sortKeyValue === COORDINATOR_AUTHORITY_SORT_KEY
          ) {
            const win = injectWinner;
            injectWinner = undefined;
            await win();
          }
          return await db.get(params);
        },
      };
      const interleaved = createCoordinatorAuthority({
        db: interleavedDb,
        tableName: TABLE_NAME,
      });
      const acquire = acquireInput();
      injectWinner = async () => await direct.acquire(acquire);
      await expect(interleaved.acquire(acquire)).resolves.toMatchObject({
        applied: false,
        authority: { coordinatorId: 'coordinator-a', epoch: 1 },
      });

      const predecessor = await direct.get({ appId: APP_ID });
      const takeover = {
        appId: APP_ID,
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-interleaved',
        observedAuthority: predecessor,
        confirmAuthorityReplacement: true,
        observedAt: 20,
      };
      injectWinner = async () => await direct.takeover(takeover);
      await expect(interleaved.takeover(takeover)).resolves.toMatchObject({
        applied: false,
        authority: { coordinatorId: 'coordinator-b', epoch: 2 },
      });
    });

    test('fails closed before overflowing the monotonic epoch', async () => {
      const db = await createAdapter(adapterCase);
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const requestId = 'overflow-seed';
      const coordinatorId = 'coordinator-max';
      const authorityId = createCanonicalJsonSha256Id({
        domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
        prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
        value: {
          schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
          appId: APP_ID,
          coordinatorId,
          epoch: Number.MAX_SAFE_INTEGER,
          requestId,
        },
        valuePath: 'overflow authority',
      });
      await db.transactionWrite({
        tableName: TABLE_NAME,
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: {
              run_id: getCoordinatorAuthorityPartitionKey(APP_ID),
              sort_key: COORDINATOR_AUTHORITY_SORT_KEY,
              schema_version: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
              record_kind: COORDINATOR_AUTHORITY_RECORD_KIND,
              app_id: APP_ID,
              coordinator_id: coordinatorId,
              authority_id: authorityId,
              epoch: Number.MAX_SAFE_INTEGER,
              status: CoordinatorAuthorityStatus.ACTIVE,
              record_version: 1,
              acquisition_request_id: requestId,
              acquired_at: 1,
              heartbeat_at: 1,
              released_at: null,
              updated_at: 1,
              last_request_id: requestId,
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
      const observed = await store.get({ appId: APP_ID });
      await expect(
        store.takeover({
          appId: APP_ID,
          coordinatorId: 'coordinator-next',
          requestId: 'overflow-takeover',
          observedAuthority: observed,
          confirmAuthorityReplacement: true,
          observedAt: 2,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityEpochOverflowError);
      await expect(store.get({ appId: APP_ID })).resolves.toEqual(observed);
    });
  },
);
