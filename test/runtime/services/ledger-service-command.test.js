/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

import {
  runLedgerServiceRuntime,
  waitForLedgerServiceShutdown,
} from '../../../src/core/runtime/services/ledger-service-command.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

/** @returns {import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair} */
function embeddedPair() {
  return /** @type {any} */ ({
    revision: { revisionId: REVISION_ID },
    runtime: { appId: 'packaged-runtime', revisionId: REVISION_ID },
  });
}

describe('hidden ledger-service runtime command', () => {
  it('binds the resident service to embedded assets and drains it on shutdown', async () => {
    const manifest = { app: { id: 'packaged-runtime' } };
    const pair = embeddedPair();
    const readEmbeddedAppManifest = jest.fn(async () => manifest);
    const readEmbeddedRevisionRuntimePair = jest.fn(async () => pair);
    const waitForShutdown = jest.fn(async () => 'SIGTERM');
    /** @type {AbortSignal | undefined} */
    let residentSignal;
    const runResidentActivityService = jest.fn(
      (
        /** @type {Parameters<typeof import('../../../src/core/runtime/services/resident-activity-worker.js').runLocalResidentActivityService>[0]} */ {
          execution,
          signal,
        },
      ) =>
        new Promise((resolve) => {
          expect(execution).toEqual({
            kind: 'embedded',
            manifest,
            embeddedRevision: pair,
          });
          if (!signal) throw new Error('Expected the resident abort signal.');
          residentSignal = signal;
          signal.addEventListener('abort', () => resolve({ processed: 2 }), {
            once: true,
          });
        }),
    );

    await expect(
      runLedgerServiceRuntime({
        readEmbeddedAppManifest,
        readEmbeddedRevisionRuntimePair,
        runResidentActivityService,
        waitForShutdown,
      }),
    ).resolves.toEqual({ processed: 2 });

    expect(readEmbeddedAppManifest).toHaveBeenCalledTimes(1);
    expect(readEmbeddedRevisionRuntimePair).toHaveBeenCalledTimes(1);
    expect(waitForShutdown).toHaveBeenCalledTimes(1);
    expect(runResidentActivityService).toHaveBeenCalledTimes(1);
    if (!residentSignal) throw new Error('Expected resident startup.');
    expect(residentSignal.aborted).toBe(true);
    expect(residentSignal.reason).toMatchObject({
      code: 'resident-worker-shutdown-requested',
      details: { signal: 'SIGTERM' },
    });
  });

  it('registers graceful shutdown before reading either embedded asset', async () => {
    const waitForShutdown = jest.fn(() => new Promise(() => {}));
    const readEmbeddedAppManifest = jest.fn(async () => {
      expect(waitForShutdown).toHaveBeenCalledTimes(1);
      return { app: { id: 'packaged-runtime' } };
    });
    const readEmbeddedRevisionRuntimePair = jest.fn(async () => {
      expect(waitForShutdown).toHaveBeenCalledTimes(1);
      return embeddedPair();
    });

    await expect(
      runLedgerServiceRuntime({
        readEmbeddedAppManifest,
        readEmbeddedRevisionRuntimePair,
        runResidentActivityService: async () => ({ processed: 0 }),
        waitForShutdown,
      }),
    ).rejects.toThrow(/stopped without a shutdown request/i);
  });

  it('propagates resident startup failure and cancels the pending signal wait', async () => {
    const startupError = new Error('already active');
    /** @type {AbortSignal | undefined} */
    let waitSignal;
    const waitForShutdown = jest.fn(
      (/** @type {{signal?: AbortSignal}} */ options = {}) =>
        new Promise((resolve) => {
          const signal = options.signal;
          if (!signal) throw new Error('Expected the wait abort signal.');
          waitSignal = signal;
          signal.addEventListener('abort', () => resolve(undefined), {
            once: true,
          });
        }),
    );

    await expect(
      runLedgerServiceRuntime({
        readEmbeddedAppManifest: async () => ({
          app: { id: 'packaged-runtime' },
        }),
        readEmbeddedRevisionRuntimePair: async () => embeddedPair(),
        runResidentActivityService: async () => {
          throw startupError;
        },
        waitForShutdown,
      }),
    ).rejects.toBe(startupError);

    if (!waitSignal) throw new Error('Expected shutdown wait startup.');
    expect(waitSignal.aborted).toBe(true);
  });

  it('removes only its own signal listeners after the first graceful shutdown request', async () => {
    const processRef = /** @type {NodeJS.Process} */ (new EventEmitter());
    const waiting = waitForLedgerServiceShutdown({ processRef });

    processRef.emit('SIGTERM');
    await expect(waiting).resolves.toBe('SIGTERM');
    expect(processRef.listenerCount('SIGINT')).toBe(0);
    expect(processRef.listenerCount('SIGTERM')).toBe(0);
  });

  it('removes unneeded signal listeners when startup cleanup aborts the wait', async () => {
    const processRef = /** @type {NodeJS.Process} */ (new EventEmitter());
    const controller = new AbortController();
    const waiting = waitForLedgerServiceShutdown({
      processRef,
      signal: controller.signal,
    });

    controller.abort();
    await expect(waiting).resolves.toBeUndefined();
    expect(processRef.listenerCount('SIGINT')).toBe(0);
    expect(processRef.listenerCount('SIGTERM')).toBe(0);
  });
});
