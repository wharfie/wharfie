/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../../src/core/lib/db/adapters/vanilla.js';
import createLMDB from '../../../src/core/lib/db/adapters/lmdb.js';
import {
  LedgerServiceLifecycleStatus,
  LedgerServiceOwnerKind,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
  createLedgerServiceSessionId,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  LocalServiceSessionActiveError,
  acquireLocalServiceSession,
  getLocalServiceSessionPrincipalId,
  getLocalServiceSessionScopeId,
  probeLocalServiceSession,
} from '../../../src/core/runtime/local-service-session.js';
import {
  LedgerServiceRuntimeStatus,
  createLedgerService,
} from '../../../src/core/runtime/services/ledger-service.js';

const APP_ID = 'resident-demo';
const REVISION_A = `wrv1_${'A'.repeat(43)}`;
const REVISION_B = `wrv1_${'B'.repeat(42)}A`;

/** @type {Array<() => Promise<void>>} */
const cleanups = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    // The DB should release its file handles before its root disappears.
    // eslint-disable-next-line no-await-in-loop
    await cleanups.pop()?.();
  }
  jest.restoreAllMocks();
});

/**
 * @param {{adapter?: 'lmdb'}} [options] - Optional durable adapter selection.
 * @returns {{lifecycle: ReturnType<typeof createLedgerServiceLifecycle>, ownership: ReturnType<typeof createLedgerServiceOwnership>, sessionRoot: string}} - Isolated durable lifecycle dependencies.
 */
function createDependencies(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-resident-service-'));
  const db =
    options.adapter === 'lmdb'
      ? createLMDB({ path: join(root, 'control') })
      : createVanillaDB({ path: join(root, 'control') });
  cleanups.push(async () => {
    await db.close();
    rmSync(root, { recursive: true, force: true });
  });
  return {
    lifecycle: createLedgerServiceLifecycle({
      db,
      tableName: 'wharfie-execution-ledger-v2',
    }),
    ownership: createLedgerServiceOwnership({
      db,
      tableName: 'wharfie-execution-ledger-v2',
    }),
    sessionRoot: join(root, 'service-namespace'),
  };
}

describe('resident ledger service lifecycle', () => {
  it('holds one local owner, persists READY, and lets a later revision recover after graceful stop', async () => {
    const { lifecycle, ownership, sessionRoot } = createDependencies();
    let observedAt = 100;
    const now = () => observedAt++;
    const first = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_A,
      lifecycle,
      ownership,
      sessionRoot,
      now,
    });

    const ready = await first.start();
    expect(ready).toMatchObject({
      serviceId: createLedgerServiceId({ appId: APP_ID }),
      appId: APP_ID,
      revisionId: REVISION_A,
      generation: 1,
      status: LedgerServiceLifecycleStatus.READY,
    });
    expect(first.getRuntimeStatus()).toBe(LedgerServiceRuntimeStatus.READY);
    expect(first.ownsLocalSession()).toBe(true);

    const concurrent = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_B,
      lifecycle,
      ownership,
      sessionRoot,
      now,
    });
    await expect(concurrent.start()).rejects.toBeInstanceOf(
      LocalServiceSessionActiveError,
    );
    expect(concurrent.getRuntimeStatus()).toBe(
      LedgerServiceRuntimeStatus.FAILED,
    );

    const stopped = await first.stop();
    expect(stopped).toMatchObject({
      generation: 1,
      status: LedgerServiceLifecycleStatus.STOPPED,
    });
    expect(first.ownsLocalSession()).toBe(false);
    await expect(first.stop()).resolves.toEqual(stopped);

    const successor = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_B,
      lifecycle,
      ownership,
      sessionRoot,
      now,
    });
    await expect(successor.start()).resolves.toMatchObject({
      appId: APP_ID,
      revisionId: REVISION_B,
      generation: 2,
      status: LedgerServiceLifecycleStatus.READY,
    });
    await successor.stop();
  });

  it('releases local ownership without fabricating STOPPED when a durable READY transition fails', async () => {
    const { lifecycle, ownership, sessionRoot } = createDependencies();
    const markReady = jest.fn(async () => {
      throw new Error('durable lifecycle backend unavailable');
    });
    const failingLifecycle = {
      ...lifecycle,
      markReady,
    };
    const failed = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_A,
      lifecycle: failingLifecycle,
      ownership,
      sessionRoot,
    });

    await expect(failed.start()).rejects.toThrow(
      /durable lifecycle backend unavailable/i,
    );
    expect(failed.getRuntimeStatus()).toBe(LedgerServiceRuntimeStatus.FAILED);
    expect(failed.ownsLocalSession()).toBe(false);

    const persisted = await lifecycle.get({
      serviceId: createLedgerServiceId({ appId: APP_ID }),
    });
    expect(persisted).toMatchObject({
      status: LedgerServiceLifecycleStatus.STARTING,
      generation: 1,
    });

    const successor = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_B,
      lifecycle,
      ownership,
      sessionRoot,
    });
    await expect(successor.start()).resolves.toMatchObject({
      status: LedgerServiceLifecycleStatus.READY,
      generation: 2,
      revisionId: REVISION_B,
    });
    await successor.stop();
  });

  it('lets exactly one fresh session replace an absent stale owner without reusing its endpoint', async () => {
    const { lifecycle, ownership, sessionRoot } = createDependencies({
      adapter: 'lmdb',
    });
    const serviceId = createLedgerServiceId({ appId: APP_ID });
    const staleSessionId = createLedgerServiceSessionId();
    const stale = await ownership.claimOwnership({
      serviceId,
      appId: APP_ID,
      scopeId: getLocalServiceSessionScopeId({ sessionRoot }),
      principalId: getLocalServiceSessionPrincipalId(),
      sessionId: staleSessionId,
      ownerKind: LedgerServiceOwnerKind.RESIDENT,
      expected: null,
      claimedAt: 1,
    });

    let staleObservations = 0;
    /** @type {() => void} */
    let releaseBarrier = () => {};
    const barrier = new Promise((resolve) => {
      releaseBarrier = () => resolve(undefined);
    });
    const synchronizedOwnership = {
      ...ownership,
      getOwnership: async (/** @type {{serviceId: string}} */ input) => {
        const observed = await ownership.getOwnership(input);
        if (observed?.sessionId === staleSessionId && staleObservations < 2) {
          staleObservations += 1;
          if (staleObservations === 2) releaseBarrier();
          await barrier;
        }
        return observed;
      },
    };
    /** @type {Array<Readonly<{sessionId: string, endpoint: string}>>} */
    const candidates = [];
    const captureSession = async (
      /** @type {{serviceId: string, sessionId: string, sessionRoot?: string}} */ input,
    ) => {
      const session = await acquireLocalServiceSession(input);
      candidates.push(session);
      return session;
    };
    const first = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_A,
      lifecycle,
      ownership: synchronizedOwnership,
      sessionRoot,
      acquireSession: captureSession,
    });
    const second = createLedgerService({
      appId: APP_ID,
      revisionId: REVISION_B,
      lifecycle,
      ownership: synchronizedOwnership,
      sessionRoot,
      acquireSession: captureSession,
    });

    const results = await Promise.allSettled([first.start(), second.start()]);
    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');
    expect(staleObservations).toBe(2);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].sessionId).not.toBe(candidates[1].sessionId);
    expect(candidates[0].endpoint).not.toBe(candidates[1].endpoint);

    const currentOwner = await ownership.getOwnership({ serviceId });
    expect(currentOwner).toEqual(
      expect.objectContaining({
        generation: stale.ownership.generation + 1,
        sessionId: expect.stringMatching(/^wss_[A-Za-z0-9_-]{43}$/),
      }),
    );
    expect(currentOwner?.sessionId).not.toBe(staleSessionId);
    await expect(
      ownership.releaseOwnership({
        serviceId,
        scopeId: stale.ownership.scopeId,
        principalId: stale.ownership.principalId,
        sessionId: staleSessionId,
        generation: stale.ownership.generation,
      }),
    ).rejects.toMatchObject({ reason: 'stale session' });

    const winner = first.ownsLocalSession() ? first : second;
    const loser = winner === first ? second : first;
    const winnerSession = candidates.find(
      (candidate) => candidate.sessionId === currentOwner?.sessionId,
    );
    const loserSession = candidates.find(
      (candidate) => candidate.sessionId !== currentOwner?.sessionId,
    );
    expect(winnerSession).toBeDefined();
    expect(loserSession).toBeDefined();
    await expect(
      probeLocalServiceSession({
        serviceId,
        sessionId: /** @type {string} */ (winnerSession?.sessionId),
        sessionRoot,
      }),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      probeLocalServiceSession({
        serviceId,
        sessionId: /** @type {string} */ (loserSession?.sessionId),
        sessionRoot,
      }),
    ).resolves.toMatchObject({ status: 'absent' });
    await winner.stop();
    await loser.stop();
  });
});
