// @ts-nocheck -- intentionally loose deterministic authority protocol and timing doubles.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
  COORDINATOR_AUTHORITY_SCHEMA_VERSION,
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityEpochOverflowError,
  CoordinatorAuthorityRequestConflictError,
  CoordinatorAuthorityRenewalUnknownError,
  CoordinatorAuthorityStaleError,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthorityToken,
} from '../../../src/core/lib/db/tables/coordinator-authority.js';
import { DynamoDBCoordinatorAuthorityTakeoverUnknownError } from '../../../src/core/lib/db/tables/dynamodb-coordinator-authority.js';
import { createCanonicalJsonSha256Id } from '../../../src/core/runtime/content-id.js';
import {
  ResidentCoordinatorAuthorityLostError,
  createResidentCoordinatorAuthoritySupervisor,
} from '../../../src/core/runtime/services/resident-coordinator-authority.js';

const APP_ID = 'resident-authority-app';
const COORDINATOR_ID = 'resident-session-a';
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;

function deferred() {
  /** @type {(value?: any) => void} */
  let resolveDeferred;
  /** @type {(reason?: unknown) => void} */
  let rejectDeferred;
  const promise = new Promise((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  return {
    promise,
    resolve: /** @type {(value?: any) => void} */ (resolveDeferred),
    reject: /** @type {(reason?: unknown) => void} */ (rejectDeferred),
  };
}

async function waitUntil(predicate, label = 'condition') {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error(`Timed out waiting for ${label}.`);
}

function createAuthority(overrides = {}) {
  const coordinatorId = overrides.coordinatorId ?? COORDINATOR_ID;
  const epoch = overrides.epoch ?? 1;
  const acquisitionRequestId =
    overrides.acquisitionRequestId ?? `acquire-${epoch}`;
  const acquiredAt = overrides.acquiredAt ?? epoch * 10;
  const heartbeatAt = overrides.heartbeatAt ?? acquiredAt;
  const updatedAt = overrides.updatedAt ?? heartbeatAt;
  const lastRequestId = overrides.lastRequestId ?? acquisitionRequestId;
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    appId: APP_ID,
    coordinatorId,
    authorityId: createCanonicalJsonSha256Id({
      domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
      prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
      value: {
        schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
        appId: APP_ID,
        coordinatorId,
        epoch,
        requestId: acquisitionRequestId,
      },
    }),
    epoch,
    status: overrides.status ?? CoordinatorAuthorityStatus.ACTIVE,
    recordVersion: overrides.recordVersion ?? 1,
    acquisitionRequestId,
    acquiredAt,
    heartbeatAt,
    releasedAt: overrides.releasedAt ?? null,
    updatedAt,
    lastRequestId,
  });
}

function renewAuthority(predecessor, requestId, observedAt) {
  return createAuthority({
    coordinatorId: predecessor.coordinatorId,
    epoch: predecessor.epoch,
    acquisitionRequestId: predecessor.acquisitionRequestId,
    acquiredAt: predecessor.acquiredAt,
    heartbeatAt: Math.max(predecessor.heartbeatAt, observedAt),
    updatedAt: Math.max(predecessor.updatedAt, observedAt),
    recordVersion: predecessor.recordVersion + 1,
    lastRequestId: requestId,
  });
}

function releaseAuthority(predecessor, requestId, observedAt) {
  const releasedAt = Math.max(predecessor.heartbeatAt, observedAt);
  return createAuthority({
    coordinatorId: predecessor.coordinatorId,
    epoch: predecessor.epoch,
    acquisitionRequestId: predecessor.acquisitionRequestId,
    acquiredAt: predecessor.acquiredAt,
    heartbeatAt: predecessor.heartbeatAt,
    status: CoordinatorAuthorityStatus.RELEASED,
    recordVersion: predecessor.recordVersion + 1,
    releasedAt,
    updatedAt: Math.max(predecessor.updatedAt, releasedAt),
    lastRequestId: requestId,
  });
}

function createControlledTiming() {
  let clock = 0n;
  /** @type {Array<{milliseconds: number, active: boolean, resolve: () => void}>} */
  const pending = [];
  const waitForInterval = jest.fn(
    async (milliseconds, signal) =>
      await new Promise((resolve, reject) => {
        const entry = {
          milliseconds,
          active: true,
          resolve: () => {},
        };
        const onAbort = () => {
          if (!entry.active) return;
          entry.active = false;
          signal?.removeEventListener('abort', onAbort);
          reject(signal?.reason);
        };
        entry.resolve = () => {
          if (!entry.active) return;
          entry.active = false;
          signal?.removeEventListener('abort', onAbort);
          clock += BigInt(milliseconds) * NANOSECONDS_PER_MILLISECOND;
          resolve();
        };
        if (signal?.aborted) {
          onAbort();
          return;
        }
        signal?.addEventListener('abort', onAbort, { once: true });
        pending.push(entry);
      }),
  );
  return {
    monotonicNow: () => clock,
    waitForInterval,
    pendingCount: () => pending.filter((entry) => entry.active).length,
    async advanceNext() {
      const entry = pending.find((candidate) => candidate.active);
      if (!entry) throw new Error('No controlled interval is pending.');
      entry.resolve();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function createHarness(overrides = {}) {
  const timing = overrides.timing ?? createControlledTiming();
  let wallClock = 100;
  const initial = overrides.initial ?? createAuthority();
  const protocol = /** @type {any} */ ({
    get: overrides.get ?? jest.fn(async () => initial),
    acquire:
      overrides.acquire ??
      jest.fn(async () => ({ applied: true, authority: initial })),
    renew:
      overrides.renew ??
      jest.fn(async (input) => ({
        applied: true,
        authority: renewAuthority(
          input.observedAuthority,
          input.requestId,
          input.observedAt,
        ),
      })),
    release:
      overrides.release ??
      jest.fn(async (input) => ({ applied: true, authority: input.authority })),
    observeReplacement:
      overrides.observeReplacement ??
      jest.fn(async () => ({ outcome: 'inactive', authority: null })),
  });
  const createRequestId = jest.fn(
    ({ action, sequence }) => `${action}-request-${sequence}`,
  );
  const random = jest.fn(() => 0.5);
  const supervisor = createResidentCoordinatorAuthoritySupervisor({
    protocol,
    appId: APP_ID,
    coordinatorId: COORDINATOR_ID,
    renewalIntervalMs: 10,
    retryDelayMs: 2,
    renewalJitterRatio: 0.2,
    observedAtNow: () => wallClock++,
    monotonicNow: timing.monotonicNow,
    waitForInterval: timing.waitForInterval,
    random,
    createRequestId,
  });
  return { supervisor, protocol, timing, initial, createRequestId, random };
}

describe('resident DynamoDB coordinator authority supervisor', () => {
  test('snapshots constructor fields and protocol methods before validation and use', async () => {
    const harness = createHarness();
    let appIdReads = 0;
    let acquireReads = 0;
    const firstAcquire = harness.protocol.acquire;
    const protocol = {
      ...harness.protocol,
      get acquire() {
        acquireReads += 1;
        return acquireReads === 1
          ? firstAcquire
          : async () => {
              throw new Error('drifted acquire accessor was invoked');
            };
      },
    };
    const supervisor = createResidentCoordinatorAuthoritySupervisor({
      protocol,
      get appId() {
        appIdReads += 1;
        return appIdReads === 1 ? APP_ID : 'drifted-app';
      },
      coordinatorId: COORDINATOR_ID,
      renewalIntervalMs: 10,
      retryDelayMs: 2,
      renewalJitterRatio: 0.2,
      observedAtNow: () => 100,
      monotonicNow: harness.timing.monotonicNow,
      waitForInterval: harness.timing.waitForInterval,
      random: harness.random,
      createRequestId: harness.createRequestId,
    });

    await expect(
      supervisor.run({ handler: async () => 'snapshotted' }),
    ).resolves.toBe('snapshotted');
    expect(appIdReads).toBe(1);
    expect(acquireReads).toBe(1);
    expect(firstAcquire).toHaveBeenCalledTimes(1);
  });

  test('snapshots run signal and handler accessors exactly once', async () => {
    const harness = createHarness();
    const external = new AbortController();
    const firstHandler = jest.fn(async () => 'first-handler');
    const driftedHandler = jest.fn(async () => 'drifted-handler');
    let signalReads = 0;
    let handlerReads = 0;
    const input = /** @type {any} */ ({});
    Object.defineProperties(input, {
      signal: {
        enumerable: true,
        get() {
          signalReads += 1;
          return signalReads === 1 ? external.signal : Object.freeze({});
        },
      },
      handler: {
        enumerable: true,
        get() {
          handlerReads += 1;
          return handlerReads === 1 ? firstHandler : driftedHandler;
        },
      },
    });

    await expect(harness.supervisor.run(input)).resolves.toBe('first-handler');
    expect(signalReads).toBe(1);
    expect(handlerReads).toBe(1);
    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(driftedHandler).not.toHaveBeenCalled();
  });

  test('binds one stable token, returns the handler result, and releases after drain', async () => {
    const harness = createHarness();
    const order = [];

    await expect(
      harness.supervisor.run({
        handler: async (context) => {
          order.push('handler');
          expect(context.authority).toEqual(harness.initial);
          expect(context.coordinatorAuthority).toEqual(
            createCoordinatorAuthorityToken(harness.initial),
          );
          expect(Object.isFrozen(context)).toBe(true);
          expect(Object.isFrozen(context.authority)).toBe(true);
          expect(Object.isFrozen(context.coordinatorAuthority)).toBe(true);
          return Object.freeze({ processed: 3 });
        },
      }),
    ).resolves.toEqual({ processed: 3 });

    expect(harness.protocol.renew).not.toHaveBeenCalled();
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
    expect(harness.protocol.release.mock.calls[0][0].authority).toEqual(
      harness.initial,
    );
    order.push('released');
    expect(order).toEqual(['handler', 'released']);
  });

  test('keeps renewing during external-signal drain and releases the latest full snapshot', async () => {
    const harness = createHarness();
    const shutdown = new AbortController();
    const drained = deferred();
    /** @type {any} */
    let context;
    const run = harness.supervisor.run({
      signal: shutdown.signal,
      handler: async (value) => {
        context = value;
        await new Promise((resolve) =>
          value.signal.addEventListener('abort', resolve, { once: true }),
        );
        await drained.promise;
        return 'drained';
      },
    });

    await waitUntil(() => context !== undefined, 'handler start');
    await waitUntil(() => harness.timing.pendingCount() === 1, 'first renewal');
    await harness.timing.advanceNext();
    await waitUntil(
      () => harness.protocol.renew.mock.calls.length === 1,
      'first renewal write',
    );
    await waitUntil(
      () => harness.timing.pendingCount() === 1,
      'second renewal',
    );

    const shutdownReason = new Error('operator shutdown');
    shutdown.abort(shutdownReason);
    expect(context.signal.aborted).toBe(true);
    expect(context.signal.reason).toBe(shutdownReason);
    expect(harness.protocol.release).not.toHaveBeenCalled();

    await harness.timing.advanceNext();
    await waitUntil(
      () => harness.protocol.renew.mock.calls.length === 2,
      'renewal during drain',
    );
    drained.resolve();

    await expect(run).resolves.toBe('drained');
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
    expect(
      harness.protocol.release.mock.calls[0][0].authority.recordVersion,
    ).toBe(3);
    expect(context.coordinatorAuthority).toEqual(
      createCoordinatorAuthorityToken(harness.initial),
    );
  });

  test('retries one unknown renewal with the exact retained tuple', async () => {
    const timing = createControlledTiming();
    const initial = createAuthority();
    const renew = jest
      .fn()
      .mockRejectedValueOnce(
        new CoordinatorAuthorityRenewalUnknownError(APP_ID, 'renew-request-2'),
      )
      .mockImplementationOnce(async (input) => ({
        applied: true,
        authority: renewAuthority(
          input.observedAuthority,
          input.requestId,
          input.observedAt,
        ),
      }));
    const harness = createHarness({ timing, initial, renew });
    const shutdown = new AbortController();
    /** @type {AbortSignal | undefined} */
    let handlerSignal;
    const run = harness.supervisor.run({
      signal: shutdown.signal,
      handler: async ({ signal }) => {
        handlerSignal = signal;
        await new Promise((resolve) =>
          signal.addEventListener('abort', resolve, { once: true }),
        );
        return 'done';
      },
    });

    await waitUntil(() => timing.pendingCount() === 1, 'renewal interval');
    await timing.advanceNext();
    await waitUntil(
      () => renew.mock.calls.length === 1 && timing.pendingCount() === 1,
      'unknown renewal retry',
    );
    const retainedIntent = renew.mock.calls[0][0];
    await timing.advanceNext();
    await waitUntil(() => renew.mock.calls.length === 2, 'exact renewal retry');

    expect(renew.mock.calls[1][0]).toBe(retainedIntent);
    expect(handlerSignal?.aborted).toBe(false);
    shutdown.abort(new Error('stop after proved renewal'));
    await expect(run).resolves.toBe('done');
    expect(
      harness.protocol.release.mock.calls[0][0].authority.recordVersion,
    ).toBe(2);
  });

  test('fails closed after a second unknown renewal and drains before release', async () => {
    const timing = createControlledTiming();
    const renew = jest.fn(async (input) => {
      throw new CoordinatorAuthorityRenewalUnknownError(
        APP_ID,
        input.requestId,
      );
    });
    const harness = createHarness({ timing, renew });
    /** @type {AbortSignal | undefined} */
    let handlerSignal;
    const run = harness.supervisor.run({
      handler: async ({ signal }) => {
        handlerSignal = signal;
        await new Promise((resolve) =>
          signal.addEventListener('abort', resolve, { once: true }),
        );
      },
    });
    const outcome = run.catch((error) => error);

    await waitUntil(() => timing.pendingCount() === 1, 'renewal interval');
    await timing.advanceNext();
    await waitUntil(
      () => renew.mock.calls.length === 1 && timing.pendingCount() === 1,
      'unknown renewal retry delay',
    );
    const retainedIntent = renew.mock.calls[0][0];
    await timing.advanceNext();

    expect(await outcome).toBeInstanceOf(ResidentCoordinatorAuthorityLostError);
    expect(renew).toHaveBeenCalledTimes(2);
    expect(renew.mock.calls[1][0]).toBe(retainedIntent);
    expect(handlerSignal?.reason).toBeInstanceOf(
      ResidentCoordinatorAuthorityLostError,
    );
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
    expect(harness.protocol.release.mock.calls[0][0].authority).toEqual(
      harness.initial,
    );
  });

  test.each([
    ['stale', new CoordinatorAuthorityStaleError(APP_ID)],
    [
      'conflicting',
      new CoordinatorAuthorityConflictError(APP_ID, 'renewal raced'),
    ],
  ])('fails closed on a %s renewal', async (_label, renewalError) => {
    const timing = createControlledTiming();
    const harness = createHarness({
      timing,
      renew: jest.fn(async () => {
        throw renewalError;
      }),
    });
    /** @type {AbortSignal | undefined} */
    let signal;
    const run = harness.supervisor.run({
      handler: async (context) => {
        signal = context.signal;
        await new Promise((resolve) =>
          context.signal.addEventListener('abort', resolve, { once: true }),
        );
      },
    });
    const outcome = run.catch((error) => error);

    await waitUntil(() => timing.pendingCount() === 1, 'renewal interval');
    await timing.advanceNext();

    expect(await outcome).toBeInstanceOf(ResidentCoordinatorAuthorityLostError);
    expect(signal?.reason.cause).toBe(renewalError);
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
  });

  test('restarts changed observations and takes over only one stable predecessor', async () => {
    const successor = createAuthority({
      epoch: 2,
      recordVersion: 4,
      acquisitionRequestId: 'takeover-request-3',
      acquiredAt: 200,
    });
    const acquire = jest.fn(async () => {
      throw new CoordinatorAuthorityConflictError(APP_ID, 'active');
    });
    const takeover = jest.fn(async () => ({
      applied: true,
      authority: successor,
    }));
    const observeReplacement = jest
      .fn()
      .mockResolvedValueOnce({
        outcome: 'changed',
        reason: 'renewed',
        before: createAuthority(),
        after: createAuthority({ recordVersion: 2 }),
      })
      .mockResolvedValueOnce({
        outcome: 'stable',
        observation: Object.freeze({ recordVersion: 2 }),
        takeover,
      });
    const harness = createHarness({
      initial: successor,
      acquire,
      observeReplacement,
    });

    await expect(
      harness.supervisor.run({ handler: async () => 'successor' }),
    ).resolves.toBe('successor');

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(observeReplacement).toHaveBeenCalledTimes(2);
    expect(takeover).toHaveBeenCalledTimes(1);
    expect(takeover.mock.calls[0][0]).toEqual({
      coordinatorId: COORDINATOR_ID,
      requestId: 'takeover-request-2',
      observedAt: 101,
    });
    expect(harness.protocol.release.mock.calls[0][0].authority).toEqual(
      successor,
    );
  });

  test('never admits a historical acquire receipt and rotates acquisition identity', async () => {
    const historical = createAuthority({
      acquisitionRequestId: 'acquire-request-1',
      lastRequestId: 'acquire-request-1',
    });
    const released = createAuthority({
      acquisitionRequestId: 'acquire-request-1',
      status: CoordinatorAuthorityStatus.RELEASED,
      recordVersion: 2,
      releasedAt: 20,
      updatedAt: 20,
      lastRequestId: 'release-historical',
    });
    const current = createAuthority({
      epoch: 2,
      recordVersion: 3,
      acquisitionRequestId: 'acquire-request-2',
      acquiredAt: 30,
      lastRequestId: 'acquire-request-2',
    });
    const acquire = jest
      .fn()
      .mockResolvedValueOnce({ applied: false, authority: historical })
      .mockResolvedValueOnce({ applied: true, authority: current });
    const get = jest
      .fn()
      .mockResolvedValueOnce(released)
      .mockResolvedValueOnce(current);
    const harness = createHarness({ initial: current, acquire, get });
    const handler = jest.fn(async ({ authority }) => authority);

    await expect(harness.supervisor.run({ handler })).resolves.toEqual(current);

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[0][0].requestId).toBe('acquire-request-1');
    expect(acquire.mock.calls[1][0].requestId).toBe('acquire-request-2');
    expect(get).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].authority).toEqual(current);
  });

  test('never admits a historical takeover receipt and re-observes with fresh identities', async () => {
    const historical = createAuthority({
      epoch: 2,
      recordVersion: 2,
      acquisitionRequestId: 'takeover-request-2',
      acquiredAt: 20,
      lastRequestId: 'takeover-request-2',
    });
    const replacement = createAuthority({
      coordinatorId: 'other-resident-session',
      epoch: 3,
      recordVersion: 3,
      acquisitionRequestId: 'other-takeover',
      acquiredAt: 30,
      lastRequestId: 'other-takeover',
    });
    const winner = createAuthority({
      epoch: 4,
      recordVersion: 4,
      acquisitionRequestId: 'takeover-request-4',
      acquiredAt: 40,
      lastRequestId: 'takeover-request-4',
    });
    const acquire = jest.fn(async () => {
      throw new CoordinatorAuthorityConflictError(APP_ID, 'active');
    });
    const historicalTakeover = jest.fn(async () => ({
      applied: false,
      authority: historical,
    }));
    const winningTakeover = jest.fn(async () => ({
      applied: true,
      authority: winner,
    }));
    const observeReplacement = jest
      .fn()
      .mockResolvedValueOnce({
        outcome: 'stable',
        observation: Object.freeze({ recordVersion: 1 }),
        takeover: historicalTakeover,
      })
      .mockResolvedValueOnce({
        outcome: 'stable',
        observation: Object.freeze({ recordVersion: 3 }),
        takeover: winningTakeover,
      });
    const get = jest
      .fn()
      .mockResolvedValueOnce(replacement)
      .mockResolvedValueOnce(winner);
    const harness = createHarness({
      initial: winner,
      acquire,
      observeReplacement,
      get,
    });

    await expect(
      harness.supervisor.run({
        handler: async ({ authority }) => authority,
      }),
    ).resolves.toEqual(winner);

    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[0][0].requestId).toBe('acquire-request-1');
    expect(acquire.mock.calls[1][0].requestId).toBe('acquire-request-3');
    expect(historicalTakeover.mock.calls[0][0].requestId).toBe(
      'takeover-request-2',
    );
    expect(winningTakeover.mock.calls[0][0].requestId).toBe(
      'takeover-request-4',
    );
    expect(observeReplacement).toHaveBeenCalledTimes(2);
  });

  test('retries takeover ambiguity through the retained stable closure and intent', async () => {
    const timing = createControlledTiming();
    const successor = createAuthority({
      epoch: 2,
      recordVersion: 2,
      acquisitionRequestId: 'takeover-request-2',
      acquiredAt: 200,
    });
    const takeover = jest
      .fn()
      .mockRejectedValueOnce(
        new DynamoDBCoordinatorAuthorityTakeoverUnknownError(
          APP_ID,
          'takeover-request-2',
        ),
      )
      .mockResolvedValueOnce({ applied: true, authority: successor });
    const observeReplacement = jest.fn(async () => ({
      outcome: 'stable',
      observation: Object.freeze({ recordVersion: 1 }),
      takeover,
    }));
    const harness = createHarness({
      timing,
      initial: successor,
      acquire: jest.fn(async () => {
        throw new CoordinatorAuthorityConflictError(APP_ID, 'active');
      }),
      observeReplacement,
    });
    const handler = jest.fn(async () => 'taken');
    const run = harness.supervisor.run({ handler });

    await waitUntil(
      () => takeover.mock.calls.length === 1 && timing.pendingCount() === 1,
      'takeover retry delay',
    );
    const retainedIntent = takeover.mock.calls[0][0];
    await timing.advanceNext();

    await expect(run).resolves.toBe('taken');
    expect(observeReplacement).toHaveBeenCalledTimes(1);
    expect(takeover).toHaveBeenCalledTimes(2);
    expect(takeover.mock.calls[1][0]).toBe(retainedIntent);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('retries opaque acquisition failure with one exact receipt-backed intent', async () => {
    const timing = createControlledTiming();
    const initial = createAuthority();
    const acquire = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('post-write receipt read failed'))
      .mockResolvedValueOnce({ applied: false, authority: initial });
    const harness = createHarness({ timing, initial, acquire });
    const run = harness.supervisor.run({ handler: async () => 'acquired' });

    await waitUntil(
      () => acquire.mock.calls.length === 1 && timing.pendingCount() === 1,
      'acquisition retry delay',
    );
    const retainedIntent = acquire.mock.calls[0][0];
    await timing.advanceNext();

    await expect(run).resolves.toBe('acquired');
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[1][0]).toBe(retainedIntent);
  });

  test('replays the exact acquisition intent when its admission read is unknown', async () => {
    const timing = createControlledTiming();
    const initial = createAuthority({
      acquisitionRequestId: 'acquire-request-1',
      lastRequestId: 'acquire-request-1',
    });
    const acquire = jest.fn(async () => ({
      applied: false,
      authority: initial,
    }));
    const get = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('strong read response malformed'))
      .mockResolvedValueOnce(initial);
    const harness = createHarness({ timing, initial, acquire, get });
    const run = harness.supervisor.run({ handler: async () => 'proved' });

    await waitUntil(
      () =>
        acquire.mock.calls.length === 1 &&
        get.mock.calls.length === 1 &&
        timing.pendingCount() === 1,
      'admission read retry delay',
    );
    const retainedIntent = acquire.mock.calls[0][0];
    await timing.advanceNext();

    await expect(run).resolves.toBe('proved');
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[1][0]).toBe(retainedIntent);
    expect(get).toHaveBeenCalledTimes(2);
  });

  test('settles a cancelled late-commit acquisition and releases its orphan', async () => {
    const acquired = deferred();
    const lateCommit = deferred();
    const winner = createAuthority({
      acquisitionRequestId: 'acquire-request-1',
      lastRequestId: 'acquire-request-1',
    });
    /** @type {ReturnType<typeof createAuthority> | null} */
    let current = null;
    const events = [];
    let acquireAttempt = 0;
    const acquire = jest.fn(async () => {
      acquireAttempt += 1;
      if (acquireAttempt === 1) {
        events.push('initial-acquire');
        return await acquired.promise;
      }
      events.push('retained-acquire-replay');
      await lateCommit.promise;
      return { applied: false, authority: current };
    });
    const get = jest.fn(async () => {
      events.push(current === null ? 'read-not-owned' : 'read-owned');
      return current;
    });
    const release = jest.fn(async (input) => {
      events.push('release');
      current = releaseAuthority(
        input.authority,
        input.requestId,
        input.observedAt,
      );
      return { applied: true, authority: current };
    });
    const harness = createHarness({
      initial: winner,
      acquire,
      get,
      release,
    });
    const cancellation = new AbortController();
    const reason = new Error('cancel ambiguous acquisition');
    const handler = jest.fn();
    const run = harness.supervisor.run({
      signal: cancellation.signal,
      handler,
    });
    const outcome = run.catch((error) => error);

    await waitUntil(
      () => acquire.mock.calls.length === 1,
      'ambiguous acquisition call',
    );
    const retainedIntent = acquire.mock.calls[0][0];
    cancellation.abort(reason);
    acquired.reject(new Error('acquisition response lost'));
    await waitUntil(
      () => get.mock.calls.length === 1 && acquire.mock.calls.length === 2,
      'cancelled acquisition retained replay',
    );
    events.push('late-acquire-commit');
    current = winner;
    lateCommit.resolve();

    expect(await outcome).toBe(reason);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[1][0]).toBe(retainedIntent);
    expect(get).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0].authority).toStrictEqual(winner);
    expect(current?.status).toBe(CoordinatorAuthorityStatus.RELEASED);
    expect(events).toEqual([
      'initial-acquire',
      'read-not-owned',
      'retained-acquire-replay',
      'late-acquire-commit',
      'read-owned',
      'release',
    ]);
  });

  test('settles a cancelled acquisition after a TypeError current read', async () => {
    const acquired = deferred();
    const winner = createAuthority({
      acquisitionRequestId: 'acquire-request-1',
      lastRequestId: 'acquire-request-1',
    });
    const acquire = jest
      .fn()
      .mockImplementationOnce(async () => await acquired.promise)
      .mockResolvedValueOnce({ applied: false, authority: winner });
    const get = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('settlement read malformed'))
      .mockResolvedValueOnce(winner);
    const harness = createHarness({ initial: winner, acquire, get });
    const cancellation = new AbortController();
    const reason = new Error('cancel ambiguous acquisition');
    const handler = jest.fn();
    const run = harness.supervisor.run({
      signal: cancellation.signal,
      handler,
    });
    const outcome = run.catch((error) => error);

    await waitUntil(() => acquire.mock.calls.length === 1, 'acquisition call');
    const retainedIntent = acquire.mock.calls[0][0];
    cancellation.abort(reason);
    acquired.reject(new Error('acquisition response lost'));

    expect(await outcome).toBe(reason);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(acquire.mock.calls[1][0]).toBe(retainedIntent);
    expect(get).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
    expect(harness.protocol.release.mock.calls[0][0].authority).toStrictEqual(
      winner,
    );
  });

  test('settles a cancelled late-commit takeover and releases its orphan', async () => {
    const taken = deferred();
    const lateCommit = deferred();
    const predecessor = createAuthority({
      coordinatorId: 'resident-session-b',
      acquisitionRequestId: 'predecessor-acquire',
      lastRequestId: 'predecessor-acquire',
    });
    const winner = createAuthority({
      epoch: 2,
      recordVersion: 2,
      acquisitionRequestId: 'takeover-request-2',
      acquiredAt: 20,
      lastRequestId: 'takeover-request-2',
    });
    let current = predecessor;
    const events = [];
    let takeoverAttempt = 0;
    const takeover = jest.fn(async () => {
      takeoverAttempt += 1;
      if (takeoverAttempt === 1) {
        events.push('initial-takeover');
        return await taken.promise;
      }
      events.push('retained-takeover-replay');
      await lateCommit.promise;
      return { applied: false, authority: current };
    });
    const get = jest.fn(async () => {
      events.push(current === predecessor ? 'read-predecessor' : 'read-owned');
      return current;
    });
    const release = jest.fn(async (input) => {
      events.push('release');
      current = releaseAuthority(
        input.authority,
        input.requestId,
        input.observedAt,
      );
      return { applied: true, authority: current };
    });
    const harness = createHarness({
      initial: predecessor,
      acquire: jest.fn(async () => {
        throw new CoordinatorAuthorityConflictError(APP_ID, 'active');
      }),
      observeReplacement: jest.fn(async () => ({
        outcome: 'stable',
        observation: Object.freeze({ recordVersion: 1 }),
        takeover,
      })),
      get,
      release,
    });
    const cancellation = new AbortController();
    const reason = new Error('cancel ambiguous takeover');
    const handler = jest.fn();
    const run = harness.supervisor.run({
      signal: cancellation.signal,
      handler,
    });
    const outcome = run.catch((error) => error);

    await waitUntil(() => takeover.mock.calls.length === 1, 'takeover call');
    const retainedIntent = takeover.mock.calls[0][0];
    cancellation.abort(reason);
    taken.reject(
      new DynamoDBCoordinatorAuthorityTakeoverUnknownError(
        APP_ID,
        'takeover-request-2',
      ),
    );
    await waitUntil(
      () => get.mock.calls.length === 1 && takeover.mock.calls.length === 2,
      'cancelled takeover retained replay',
    );
    events.push('late-takeover-commit');
    current = winner;
    lateCommit.resolve();

    expect(await outcome).toBe(reason);
    expect(harness.protocol.acquire).toHaveBeenCalledTimes(1);
    expect(harness.protocol.observeReplacement).toHaveBeenCalledTimes(1);
    expect(takeover).toHaveBeenCalledTimes(2);
    expect(takeover.mock.calls[1][0]).toBe(retainedIntent);
    expect(get).toHaveBeenCalledTimes(2);
    expect(handler).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(release.mock.calls[0][0].authority).toStrictEqual(winner);
    expect(current.status).toBe(CoordinatorAuthorityStatus.RELEASED);
    expect(events).toEqual([
      'initial-takeover',
      'read-predecessor',
      'retained-takeover-replay',
      'late-takeover-commit',
      'read-owned',
      'release',
    ]);
  });

  test('does not retry terminal acquisition domain failures', async () => {
    const failure = new CoordinatorAuthorityEpochOverflowError(APP_ID);
    const harness = createHarness({
      acquire: jest.fn(async () => {
        throw failure;
      }),
    });
    const handler = jest.fn();

    await expect(harness.supervisor.run({ handler })).rejects.toBe(failure);
    expect(harness.protocol.acquire).toHaveBeenCalledTimes(1);
    expect(harness.protocol.get).not.toHaveBeenCalled();
    expect(harness.timing.waitForInterval).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(harness.protocol.release).not.toHaveBeenCalled();
  });

  test('releases a successful acquisition cancelled before handler startup', async () => {
    const acquired = deferred();
    const harness = createHarness({
      acquire: jest.fn(async () => await acquired.promise),
    });
    const cancellation = new AbortController();
    const handler = jest.fn();
    const reason = new Error('cancel startup');
    const run = harness.supervisor.run({
      signal: cancellation.signal,
      handler,
    });

    await waitUntil(
      () => harness.protocol.acquire.mock.calls.length === 1,
      'acquisition call',
    );
    cancellation.abort(reason);
    acquired.resolve({ applied: true, authority: harness.initial });

    await expect(run).rejects.toBe(reason);
    expect(handler).not.toHaveBeenCalled();
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
    expect(harness.protocol.release.mock.calls[0][0].authority).toEqual(
      harness.initial,
    );
  });

  test('tolerates a stale release after replacement without hiding the handler result', async () => {
    const harness = createHarness({
      release: jest.fn(async () => {
        throw new CoordinatorAuthorityStaleError(APP_ID);
      }),
    });

    await expect(
      harness.supervisor.run({ handler: async () => 'already replaced' }),
    ).resolves.toBe('already replaced');
    expect(harness.protocol.release).toHaveBeenCalledTimes(1);
  });

  test('keeps exact-retrying one immutable release intent across opaque failures', async () => {
    const timing = createControlledTiming();
    const release = jest
      .fn()
      .mockRejectedValueOnce(new TypeError('release response malformed'))
      .mockRejectedValueOnce(new Error('release readback unavailable'))
      .mockResolvedValueOnce({ applied: false });
    const harness = createHarness({ timing, release });
    const run = harness.supervisor.run({ handler: async () => 'released' });

    await waitUntil(
      () => release.mock.calls.length === 1 && timing.pendingCount() === 1,
      'release retry delay',
    );
    const retainedIntent = release.mock.calls[0][0];
    await timing.advanceNext();
    await waitUntil(
      () => release.mock.calls.length === 2 && timing.pendingCount() === 1,
      'second release retry delay',
    );
    await timing.advanceNext();

    await expect(run).resolves.toBe('released');
    expect(release).toHaveBeenCalledTimes(3);
    expect(release.mock.calls[1][0]).toBe(retainedIntent);
    expect(release.mock.calls[2][0]).toBe(retainedIntent);
  });

  test('exact-retries release after a late same-owner renewal wins its CAS', async () => {
    const timing = createControlledTiming();
    let current = createAuthority();
    const release = jest.fn(async (input) => {
      if (release.mock.calls.length === 1) {
        // Model a renewal that reported an unknown outcome, then committed
        // after release read the old ACTIVE predecessor but before its CAS.
        current = renewAuthority(current, 'late-renewal', 200);
        throw new CoordinatorAuthorityConflictError(
          APP_ID,
          'late renewal advanced the release predecessor',
        );
      }
      current = releaseAuthority(current, input.requestId, input.observedAt);
      return { applied: true, authority: current };
    });
    const harness = createHarness({ timing, release });
    const run = harness.supervisor.run({ handler: async () => 'drained' });

    await waitUntil(
      () => release.mock.calls.length === 1 && timing.pendingCount() === 1,
      'release retry after late renewal',
    );
    const retainedIntent = release.mock.calls[0][0];
    await timing.advanceNext();

    await expect(run).resolves.toBe('drained');
    expect(release).toHaveBeenCalledTimes(2);
    expect(release.mock.calls[1][0]).toBe(retainedIntent);
    expect(current).toMatchObject({
      status: CoordinatorAuthorityStatus.RELEASED,
      recordVersion: 3,
      lastRequestId: retainedIntent.requestId,
    });
  });

  test('does not retry a terminal release request conflict', async () => {
    const failure = new CoordinatorAuthorityRequestConflictError(
      APP_ID,
      'release-request-2',
    );
    const release = jest.fn(async () => {
      throw failure;
    });
    const harness = createHarness({ release });

    await expect(
      harness.supervisor.run({ handler: async () => 'drained' }),
    ).rejects.toBe(failure);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
