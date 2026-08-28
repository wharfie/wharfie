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
  COORDINATOR_AUTHORITY_REQUEST_SORT_KEY_PREFIX,
  COORDINATOR_AUTHORITY_SCHEMA_VERSION,
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityEpochOverflowError,
  CoordinatorAuthorityRecordVersionOverflowError,
  CoordinatorAuthorityRenewalUnknownError,
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
import { encodeLedgerKeySegment } from '../../src/core/lib/ledger/record-key.js';
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

    test('renews an exact record version without retaining a request receipt', async () => {
      const db = await createAdapter(adapterCase);
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await store.acquire(acquireInput());
      const token = createCoordinatorAuthorityToken(acquired.authority);

      const request = {
        observedAuthority: acquired.authority,
        requestId: 'renew-a',
        observedAt: 20,
      };
      const renewed = await store.renewRecordVersion(request);

      expect(renewed).toMatchObject({
        applied: true,
        authority: {
          ...token,
          status: CoordinatorAuthorityStatus.ACTIVE,
          recordVersion: 2,
          heartbeatAt: 20,
          updatedAt: 20,
          lastRequestId: 'renew-a',
        },
      });
      expect(Object.keys(renewed).sort()).toEqual(['applied', 'authority']);
      expect(createCoordinatorAuthorityFence(renewed.authority)).toEqual(
        createCoordinatorAuthorityFence(acquired.authority),
      );
      await expect(
        db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: getCoordinatorAuthorityPartitionKey(APP_ID),
          sortKeyName: 'sort_key',
          sortKeyValue: `${COORDINATOR_AUTHORITY_REQUEST_SORT_KEY_PREFIX}${encodeLedgerKeySegment(
            'renew-a',
          )}`,
          consistentRead: true,
        }),
      ).resolves.toBeUndefined();
      await expect(store.renewRecordVersion(request)).resolves.toEqual({
        applied: false,
        authority: renewed.authority,
      });
    });

    test('fails an exact renewal closed when its response is lost before commit', async () => {
      const db = await createAdapter(adapterCase);
      const direct = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await direct.acquire(acquireInput());
      const failure = new Error(
        'simulated renewal response loss before commit',
      );
      let failBeforeCommit = true;
      const faulted = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          if (failBeforeCommit) {
            failBeforeCommit = false;
            throw failure;
          }
          await db.transactionWrite(params);
        },
      };
      const store = createCoordinatorAuthority({
        db: faulted,
        tableName: TABLE_NAME,
      });

      const request = {
        observedAuthority: acquired.authority,
        requestId: 'renew-before-commit',
        observedAt: 20,
      };
      await expect(store.renewRecordVersion(request)).rejects.toBeInstanceOf(
        CoordinatorAuthorityRenewalUnknownError,
      );
      await expect(direct.get({ appId: APP_ID })).resolves.toEqual(
        acquired.authority,
      );
      await expect(store.renewRecordVersion(request)).resolves.toMatchObject({
        applied: true,
        authority: { recordVersion: 2, lastRequestId: request.requestId },
      });
    });

    test('reads back an exact renewal whose committed response is lost', async () => {
      const db = await createAdapter(adapterCase);
      const direct = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await direct.acquire(acquireInput());
      let loseResponse = true;
      const faulted = {
        ...db,
        async transactionWrite(
          /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
        ) {
          await db.transactionWrite(params);
          if (loseResponse) {
            loseResponse = false;
            throw new Error('simulated renewal response loss after commit');
          }
        },
      };
      const store = createCoordinatorAuthority({
        db: faulted,
        tableName: TABLE_NAME,
      });

      const renewed = await store.renewRecordVersion({
        observedAuthority: acquired.authority,
        requestId: 'renew-after-commit',
        observedAt: 20,
      });
      expect(renewed).toMatchObject({
        applied: true,
        authority: {
          recordVersion: 2,
          lastRequestId: 'renew-after-commit',
        },
      });
      await expect(direct.get({ appId: APP_ID })).resolves.toEqual(
        renewed.authority,
      );
      await expect(
        store.renewRecordVersion({
          observedAuthority: acquired.authority,
          requestId: 'renew-after-commit',
          observedAt: 20,
        }),
      ).resolves.toEqual({ applied: false, authority: renewed.authority });
    });

    test('rejects a stale exact renewal after another renewal advances the RVN', async () => {
      const db = await createAdapter(adapterCase);
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await store.acquire(acquireInput());
      await store.renewRecordVersion({
        observedAuthority: acquired.authority,
        requestId: 'renew-winner',
        observedAt: 20,
      });

      await expect(
        store.renewRecordVersion({
          observedAuthority: acquired.authority,
          requestId: 'renew-stale',
          observedAt: 21,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityConflictError);
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

    test('fails closed before overflowing the monotonic record version', async () => {
      const db = await createAdapter(adapterCase);
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await store.acquire(acquireInput());
      const physical = await db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: getCoordinatorAuthorityPartitionKey(APP_ID),
        sortKeyName: 'sort_key',
        sortKeyValue: COORDINATOR_AUTHORITY_SORT_KEY,
        consistentRead: true,
      });
      await db.put({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: {
          ...physical,
          record_version: Number.MAX_SAFE_INTEGER,
        },
      });
      const observed = await store.get({ appId: APP_ID });

      await expect(
        store.renewRecordVersion({
          observedAuthority: observed,
          requestId: 'renew-overflow',
          observedAt: 20,
        }),
      ).rejects.toBeInstanceOf(CoordinatorAuthorityRecordVersionOverflowError);
      await expect(store.get({ appId: APP_ID })).resolves.toEqual(observed);
      expect(observed).toMatchObject({
        authorityId: acquired.authority.authorityId,
        recordVersion: Number.MAX_SAFE_INTEGER,
      });
    });
  },
);
