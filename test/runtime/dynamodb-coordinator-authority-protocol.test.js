/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CONDITION_TYPE } from '../../src/core/lib/db/base.js';
import {
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityRecordVersionOverflowError,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityFence,
  getCoordinatorAuthorityPartitionKey,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  DynamoDBCoordinatorAuthorityObservationError,
  DynamoDBCoordinatorAuthorityTakeoverUnknownError,
  createDynamoDBCoordinatorAuthorityProtocol,
} from '../../src/core/lib/db/tables/dynamodb-coordinator-authority.js';
import {
  createMockedDynamoDB,
  createVanillaDB,
} from '../helpers/db-adapters.js';

const TABLE_NAME = 'execution-ledger';
const APP_ID = 'example-app';
const WINDOW_MS = 50;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

/** @typedef {ReturnType<typeof createDynamoDBCoordinatorAuthorityProtocol>} AuthorityProtocol */
/** @typedef {Awaited<ReturnType<AuthorityProtocol['observeReplacement']>>} ObservationResult */
/** @typedef {Extract<ObservationResult, {outcome: 'stable'}>} StableObservationResult */
/**
 * @typedef DynamoHarnessOptions
 * @property {bigint} [initialNanoseconds] Initial fake monotonic time.
 * @property {(milliseconds: number, signal?: AbortSignal) => void | Promise<void>} [duringWait] Interleaving injected into the default waiter.
 * @property {(milliseconds: number, signal?: AbortSignal) => Promise<void>} [waitForObservation] Complete custom waiter.
 * @property {() => bigint} [monotonicNow] Complete custom monotonic clock.
 */

/** @type {Array<() => Promise<void>>} */
let cleanups = [];

afterEach(async () => {
  jest.restoreAllMocks();
  const pending = cleanups;
  cleanups = [];
  const results = await Promise.allSettled(
    pending.map(async (cleanup) => await cleanup()),
  );
  const failures = results
    .filter((result) => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'DynamoDB authority cleanup failed');
  }
});

/** @param {DynamoHarnessOptions} [options] */
async function createDynamoHarness(options = {}) {
  const { db, fakeDocClient } = await createMockedDynamoDB({
    tableSchemas: { [TABLE_NAME]: ['run_id', 'sort_key'] },
  });
  cleanups.push(async () => await db.close());
  let clock = options.initialNanoseconds ?? 1_000_000n;
  let duringWait = options.duringWait;
  const waitForObservation =
    options.waitForObservation ??
    (async (milliseconds, signal) => {
      if (duringWait) await duringWait(milliseconds, signal);
      clock += BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
    });
  const monotonicNow = options.monotonicNow ?? (() => clock);
  const protocol = createDynamoDBCoordinatorAuthorityProtocol({
    db,
    tableName: TABLE_NAME,
    observationWindowMs: WINDOW_MS,
    monotonicNow,
    waitForObservation,
  });
  return {
    db,
    fakeDocClient,
    protocol,
    /** @param {number} milliseconds */
    advance(milliseconds) {
      clock += BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
    },
    readClock() {
      return clock;
    },
    /** @param {bigint} value */
    setClock(value) {
      clock = value;
    },
    /** @param {DynamoHarnessOptions['duringWait']} value */
    setDuringWait(value) {
      duringWait = value;
    },
  };
}

/** @param {AuthorityProtocol} protocol */
async function acquire(protocol, suffix = 'a', observedAt = 10) {
  return await protocol.acquire({
    appId: APP_ID,
    coordinatorId: `coordinator-${suffix}`,
    requestId: `acquire-${suffix}`,
    observedAt,
  });
}

/** @param {ObservationResult} result @returns {StableObservationResult} */
function requireStable(result) {
  if (result?.outcome !== 'stable') {
    throw new Error(`Expected stable observation, received ${result?.outcome}`);
  }
  return result;
}

/** @param {any} fakeDocClient @returns {any[]} */
function authorityGetCalls(fakeDocClient) {
  const calls = /** @type {any[]} */ (fakeDocClient.__getCalls);
  return calls.filter(
    (request) =>
      request.TableName === TABLE_NAME &&
      request.Key?.sort_key === COORDINATOR_AUTHORITY_SORT_KEY,
  );
}

describe('DynamoDB coordinator authority RVN protocol', () => {
  test('requires the DynamoDB adapter identity', async () => {
    const path = mkdtempSync(join(tmpdir(), 'wharfie-rvn-protocol-'));
    const db = await createVanillaDB(path);
    cleanups.push(async () => {
      await db.close();
      rmSync(path, { recursive: true, force: true });
    });

    expect(() =>
      createDynamoDBCoordinatorAuthorityProtocol({
        db,
        tableName: TABLE_NAME,
        observationWindowMs: WINDOW_MS,
      }),
    ).toThrow(/DynamoDB/i);
  });

  test('returns inactive immediately for absent and released authority', async () => {
    const harness = await createDynamoHarness();
    const wait = jest.fn(async () => {});
    const protocol = createDynamoDBCoordinatorAuthorityProtocol({
      db: harness.db,
      tableName: TABLE_NAME,
      observationWindowMs: WINDOW_MS,
      monotonicNow: () => harness.readClock(),
      waitForObservation: wait,
    });

    await expect(
      protocol.observeReplacement({ appId: APP_ID }),
    ).resolves.toEqual({ outcome: 'inactive', authority: null });
    const acquired = await acquire(protocol);
    const released = await protocol.release({
      authority: acquired.authority,
      requestId: 'release-a',
      observedAt: 20,
    });
    await expect(
      protocol.observeReplacement({ appId: APP_ID }),
    ).resolves.toEqual({
      outcome: 'inactive',
      authority: released.authority,
    });
    expect(wait).not.toHaveBeenCalled();
  });

  test('uses two strongly consistent base-table reads across one monotonic window', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    harness.fakeDocClient.__getCalls.length = 0;
    const controller = new AbortController();
    /** @type {AbortSignal | undefined} */
    let observedSignal;
    harness.setDuringWait((_milliseconds, signal) => {
      observedSignal = signal;
    });

    const stable = requireStable(
      await harness.protocol.observeReplacement({
        appId: APP_ID,
        signal: controller.signal,
      }),
    );

    expect(stable.observation).toEqual({
      schemaVersion: 1,
      kind: 'dynamodb-coordinator-authority-rvn-observation',
      tableName: TABLE_NAME,
      appId: APP_ID,
      observationWindowMs: WINDOW_MS,
      elapsedNanoseconds: String(
        BigInt(WINDOW_MS) * NANOSECONDS_PER_MILLISECOND,
      ),
      recordVersion: acquired.authority.recordVersion,
      authority: acquired.authority,
    });
    expect(stable.takeover).toEqual(expect.any(Function));
    expect(authorityGetCalls(harness.fakeDocClient)).toHaveLength(2);
    expect(
      authorityGetCalls(harness.fakeDocClient).every(
        (request) => request.ConsistentRead === true,
      ),
    ).toBe(true);
    expect(observedSignal).toBe(controller.signal);
  });

  test.each([
    ['nonadvancing', 0],
    ['regressing', -1],
  ])(
    'rejects a %s monotonic observation interval',
    async (_name, advanceMs) => {
      let clock = 100_000_000n;
      const harness = await createDynamoHarness({
        monotonicNow: () => clock,
        waitForObservation: async () => {
          clock += BigInt(advanceMs) * NANOSECONDS_PER_MILLISECOND;
        },
      });
      await acquire(harness.protocol);

      await expect(
        harness.protocol.observeReplacement({ appId: APP_ID }),
      ).rejects.toBeInstanceOf(DynamoDBCoordinatorAuthorityObservationError);
    },
  );

  test('keeps waiting until partial waits span one complete monotonic window', async () => {
    let clock = 100_000_000n;
    let waitCalls = 0;
    const harness = await createDynamoHarness({
      monotonicNow: () => clock,
      waitForObservation: async () => {
        waitCalls += 1;
        clock += BigInt(WINDOW_MS - 1) * NANOSECONDS_PER_MILLISECOND;
      },
    });
    await acquire(harness.protocol);

    const stable = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );

    expect(waitCalls).toBe(2);
    expect(stable.observation.elapsedNanoseconds).toBe(
      String(BigInt((WINDOW_MS - 1) * 2) * NANOSECONDS_PER_MILLISECOND),
    );
  });

  test('does not use wall-clock time to authorize replacement', async () => {
    const harness = await createDynamoHarness();
    await acquire(harness.protocol, 'a', Number.MAX_SAFE_INTEGER);
    const wallClock = jest
      .spyOn(Date, 'now')
      .mockReturnValueOnce(Number.MAX_SAFE_INTEGER)
      .mockReturnValueOnce(0);

    const result = await harness.protocol.observeReplacement({ appId: APP_ID });

    expect(result.outcome).toBe('stable');
    expect(wallClock).not.toHaveBeenCalled();
  });

  test('reports renewal observed during the window without granting takeover', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    /** @type {any} */
    let renewed;
    harness.setDuringWait(async () => {
      renewed = await harness.protocol.renew({
        observedAuthority: acquired.authority,
        requestId: 'renew-during-observation',
        observedAt: 20,
      });
    });

    await expect(
      harness.protocol.observeReplacement({ appId: APP_ID }),
    ).resolves.toEqual({
      outcome: 'changed',
      reason: 'renewed',
      before: acquired.authority,
      after: expect.objectContaining({
        ...acquired.authority,
        recordVersion: 2,
        heartbeatAt: 20,
        updatedAt: 20,
        lastRequestId: 'renew-during-observation',
      }),
    });
    expect(renewed.authority.recordVersion).toBe(2);
  });

  test('treats a receiptful heartbeat during the window as an RVN renewal', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    const direct = createCoordinatorAuthority({
      db: harness.db,
      tableName: TABLE_NAME,
    });
    /** @type {any} */
    let heartbeat;
    harness.setDuringWait(async () => {
      heartbeat = await direct.heartbeat({
        authority: acquired.authority,
        requestId: 'heartbeat-during-observation',
        observedAt: 20,
      });
    });

    const result = await harness.protocol.observeReplacement({ appId: APP_ID });
    if (result.outcome !== 'changed') {
      throw new Error(
        `Expected changed observation, received ${result.outcome}`,
      );
    }

    expect(result).toEqual({
      outcome: 'changed',
      reason: 'renewed',
      before: acquired.authority,
      after: expect.objectContaining({
        ...acquired.authority,
        recordVersion: 2,
        heartbeatAt: 20,
        updatedAt: 20,
        lastRequestId: 'heartbeat-during-observation',
      }),
    });
    expect(result).not.toHaveProperty('takeover');
    expect(heartbeat).toMatchObject({
      applied: true,
      action: 'heartbeat',
      authority: result.after,
    });
  });

  test('distinguishes release and replacement observed during the window', async () => {
    const releasedHarness = await createDynamoHarness();
    const acquiredForRelease = await acquire(releasedHarness.protocol);
    releasedHarness.setDuringWait(async () => {
      await releasedHarness.protocol.release({
        authority: acquiredForRelease.authority,
        requestId: 'release-during-observation',
        observedAt: 20,
      });
    });
    await expect(
      releasedHarness.protocol.observeReplacement({ appId: APP_ID }),
    ).resolves.toMatchObject({
      outcome: 'changed',
      reason: 'released',
      before: acquiredForRelease.authority,
      after: { status: CoordinatorAuthorityStatus.RELEASED },
    });

    const replacedHarness = await createDynamoHarness();
    const acquiredForReplacement = await acquire(replacedHarness.protocol);
    const direct = createCoordinatorAuthority({
      db: replacedHarness.db,
      tableName: TABLE_NAME,
    });
    replacedHarness.setDuringWait(async () => {
      await direct.takeover({
        appId: APP_ID,
        coordinatorId: 'coordinator-b',
        requestId: 'manual-takeover-during-observation',
        observedAuthority: acquiredForReplacement.authority,
        confirmAuthorityReplacement: true,
        observedAt: 20,
      });
    });
    await expect(
      replacedHarness.protocol.observeReplacement({ appId: APP_ID }),
    ).resolves.toMatchObject({
      outcome: 'changed',
      reason: 'replaced',
      before: acquiredForReplacement.authority,
      after: { coordinatorId: 'coordinator-b', epoch: 2 },
    });
  });

  test('serializes a renewal racing the stable observation takeover', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    const stable = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );

    const raced = await Promise.allSettled([
      harness.protocol.renew({
        observedAuthority: acquired.authority,
        requestId: 'renew-race',
        observedAt: 20,
      }),
      stable.takeover({
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-race',
        observedAt: 21,
      }),
    ]);

    expect(
      raced.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    const current = await harness.protocol.get({ appId: APP_ID });
    if (!current) throw new Error('The authority race removed current state.');
    expect(
      (current.coordinatorId === 'coordinator-a' &&
        current.epoch === 1 &&
        current.recordVersion === 2) ||
        (current.coordinatorId === 'coordinator-b' && current.epoch === 2),
    ).toBe(true);
  });

  test('allows exactly one of two contenders observing the same RVN to take over', async () => {
    const harness = await createDynamoHarness();
    await acquire(harness.protocol);
    const first = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );
    const second = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );

    const raced = await Promise.allSettled([
      first.takeover({
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-b',
        observedAt: 20,
      }),
      second.takeover({
        coordinatorId: 'coordinator-c',
        requestId: 'takeover-c',
        observedAt: 21,
      }),
    ]);
    const winners = raced.filter((result) => result.status === 'fulfilled');
    expect(winners).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(
      1,
    );
    const winner = winners[0];
    if (winner.status !== 'fulfilled') throw new Error('missing winner');
    await expect(harness.protocol.get({ appId: APP_ID })).resolves.toEqual(
      winner.value.authority,
    );
  });

  test('fences a predecessor mutation after observation-backed takeover', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    const stable = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );
    await stable.takeover({
      coordinatorId: 'coordinator-b',
      requestId: 'takeover-b',
      observedAt: 20,
    });

    await expect(
      harness.db.transactionWrite({
        tableName: TABLE_NAME,
        conditionChecks: [createCoordinatorAuthorityFence(acquired.authority)],
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: {
              run_id: 'stale-mutation',
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
      harness.db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: 'stale-mutation',
        sortKeyName: 'sort_key',
        sortKeyValue: 'proof',
        consistentRead: true,
      }),
    ).resolves.toBeUndefined();
  });

  test('does not take over an authority released after stable observation', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    const stable = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );
    const released = await harness.protocol.release({
      authority: acquired.authority,
      requestId: 'release-after-observation',
      observedAt: 20,
    });

    await expect(
      stable.takeover({
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-after-release',
        observedAt: 21,
      }),
    ).rejects.toBeInstanceOf(CoordinatorAuthorityConflictError);
    await expect(harness.protocol.get({ appId: APP_ID })).resolves.toEqual(
      released.authority,
    );
  });

  test('reads back a takeover whose committed response is lost', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    let armed = false;
    const faulted = {
      ...harness.db,
      async transactionWrite(
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
      ) {
        await harness.db.transactionWrite(params);
        if (armed) {
          armed = false;
          throw new Error('simulated takeover response loss after commit');
        }
      },
    };
    const protocol = createDynamoDBCoordinatorAuthorityProtocol({
      db: faulted,
      tableName: TABLE_NAME,
      observationWindowMs: WINDOW_MS,
      monotonicNow: () => harness.readClock(),
      waitForObservation: async (milliseconds) => harness.advance(milliseconds),
    });
    const stable = requireStable(
      await protocol.observeReplacement({ appId: APP_ID }),
    );
    armed = true;

    const takeover = await stable.takeover({
      coordinatorId: 'coordinator-b',
      requestId: 'takeover-lost-after-commit',
      observedAt: 20,
    });
    expect(takeover).toMatchObject({
      authority: { coordinatorId: 'coordinator-b', epoch: 2 },
    });
    expect(takeover.authority.authorityId).not.toBe(
      acquired.authority.authorityId,
    );
  });

  test('reports an unknown takeover whose response is lost before commit', async () => {
    const harness = await createDynamoHarness();
    const acquired = await acquire(harness.protocol);
    const failure = new Error('simulated takeover response loss before commit');
    let failBeforeCommit = true;
    const faulted = {
      ...harness.db,
      async transactionWrite(
        /** @type {import('../../src/core/lib/db/base.js').TransactionWriteParams} */ params,
      ) {
        if (failBeforeCommit) {
          failBeforeCommit = false;
          throw failure;
        }
        await harness.db.transactionWrite(params);
      },
    };
    const protocol = createDynamoDBCoordinatorAuthorityProtocol({
      db: faulted,
      tableName: TABLE_NAME,
      observationWindowMs: WINDOW_MS,
      monotonicNow: () => harness.readClock(),
      waitForObservation: async (milliseconds) => harness.advance(milliseconds),
    });
    const stable = requireStable(
      await protocol.observeReplacement({ appId: APP_ID }),
    );

    const request = {
      coordinatorId: 'coordinator-b',
      requestId: 'takeover-lost-before-commit',
      observedAt: 20,
    };
    await expect(stable.takeover(request)).rejects.toBeInstanceOf(
      DynamoDBCoordinatorAuthorityTakeoverUnknownError,
    );
    await expect(harness.protocol.get({ appId: APP_ID })).resolves.toEqual(
      acquired.authority,
    );
    await expect(stable.takeover(request)).resolves.toMatchObject({
      applied: true,
      observation: stable.observation,
      authority: { coordinatorId: 'coordinator-b', epoch: 2 },
    });
  });

  test('fails closed on malformed authority state', async () => {
    const harness = await createDynamoHarness();
    await acquire(harness.protocol);
    const physical = await harness.db.get({
      tableName: TABLE_NAME,
      keyName: 'run_id',
      keyValue: getCoordinatorAuthorityPartitionKey(APP_ID),
      sortKeyName: 'sort_key',
      sortKeyValue: COORDINATOR_AUTHORITY_SORT_KEY,
      consistentRead: true,
    });
    await harness.db.put({
      tableName: TABLE_NAME,
      keyName: 'run_id',
      sortKeyName: 'sort_key',
      record: { ...physical, record_version: 'malformed-rvn' },
    });

    await expect(
      harness.protocol.observeReplacement({ appId: APP_ID }),
    ).rejects.toThrow(/record/i);
  });

  test('fails closed when stable takeover would overflow recordVersion', async () => {
    const harness = await createDynamoHarness();
    await acquire(harness.protocol);
    const physical = await harness.db.get({
      tableName: TABLE_NAME,
      keyName: 'run_id',
      keyValue: getCoordinatorAuthorityPartitionKey(APP_ID),
      sortKeyName: 'sort_key',
      sortKeyValue: COORDINATOR_AUTHORITY_SORT_KEY,
      consistentRead: true,
    });
    await harness.db.put({
      tableName: TABLE_NAME,
      keyName: 'run_id',
      sortKeyName: 'sort_key',
      record: { ...physical, record_version: Number.MAX_SAFE_INTEGER },
    });
    const stable = requireStable(
      await harness.protocol.observeReplacement({ appId: APP_ID }),
    );

    await expect(
      stable.takeover({
        coordinatorId: 'coordinator-b',
        requestId: 'takeover-rvn-overflow',
        observedAt: 20,
      }),
    ).rejects.toBeInstanceOf(CoordinatorAuthorityRecordVersionOverflowError);
    await expect(
      harness.protocol.get({ appId: APP_ID }),
    ).resolves.toMatchObject({
      recordVersion: Number.MAX_SAFE_INTEGER,
      epoch: 1,
    });
  });
});
