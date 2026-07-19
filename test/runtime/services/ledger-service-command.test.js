/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { EventEmitter } from 'node:events';

import {
  runLedgerServiceRuntime,
  waitForLedgerServiceShutdown,
} from '../../../src/core/runtime/services/ledger-service-command.js';

const REVISION_ID = `wrv1_${'A'.repeat(43)}`;

describe('hidden ledger-service runtime command', () => {
  it('uses only embedded identity, opens one lifecycle store, and closes it after a graceful stop', async () => {
    const db = { close: jest.fn(async () => {}) };
    const lifecycle = { kind: 'lifecycle-store' };
    const ownership = { kind: 'ownership-store' };
    const stopped = { status: 'STOPPED', generation: 1 };
    const service = {
      start: jest.fn(async () => ({ status: 'READY', generation: 1 })),
      stop: jest.fn(async () => stopped),
    };
    const readEmbeddedRevisionRuntimePair = jest.fn(async () => ({
      runtime: { appId: 'packaged-runtime', revisionId: REVISION_ID },
    }));
    const createControlDBClient = jest.fn(async () => db);
    const createLedgerServiceLifecycle = jest.fn(
      (/** @type {any} */ _options) => lifecycle,
    );
    const createLedgerServiceOwnership = jest.fn(
      (/** @type {any} */ _options) => ownership,
    );
    const createLedgerService = jest.fn(
      (/** @type {any} */ _options) => service,
    );
    const waitForShutdown = jest.fn(async () => 'SIGTERM');

    await expect(
      runLedgerServiceRuntime({
        readEmbeddedRevisionRuntimePair,
        createControlDBClient,
        createLedgerServiceLifecycle,
        createLedgerServiceOwnership,
        createLedgerService,
        waitForShutdown,
        tableName: 'ledger-table',
        sessionRoot: '/logical/control/session-namespace',
      }),
    ).resolves.toEqual(stopped);

    expect(readEmbeddedRevisionRuntimePair).toHaveBeenCalledTimes(1);
    expect(createLedgerServiceLifecycle).toHaveBeenCalledWith({
      db,
      tableName: 'ledger-table',
    });
    expect(createLedgerServiceOwnership).toHaveBeenCalledWith({
      db,
      tableName: 'ledger-table',
    });
    expect(createLedgerService).toHaveBeenCalledWith({
      appId: 'packaged-runtime',
      revisionId: REVISION_ID,
      lifecycle,
      ownership,
      sessionRoot: '/logical/control/session-namespace',
    });
    expect(service.start).toHaveBeenCalledTimes(1);
    expect(waitForShutdown).toHaveBeenCalledTimes(1);
    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('removes only its own signal listeners after the first graceful shutdown request', async () => {
    const processRef = /** @type {NodeJS.Process} */ (new EventEmitter());
    const waiting = waitForLedgerServiceShutdown({
      processRef,
    });

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

  it('registers graceful shutdown before durable readiness can be published', async () => {
    const db = { close: jest.fn(async () => {}) };
    /** @type {() => void} */
    let requestShutdown;
    const waitForShutdown = jest.fn(
      () =>
        new Promise((resolve) => {
          requestShutdown = () => resolve('SIGTERM');
        }),
    );
    const service = {
      start: jest.fn(async () => {
        expect(waitForShutdown).toHaveBeenCalledTimes(1);
        requestShutdown();
        return { status: 'READY', generation: 1 };
      }),
      stop: jest.fn(async () => ({ status: 'STOPPED', generation: 1 })),
    };

    await expect(
      runLedgerServiceRuntime({
        readEmbeddedRevisionRuntimePair: async () => ({
          runtime: { appId: 'packaged-runtime', revisionId: REVISION_ID },
        }),
        createControlDBClient: async () => db,
        createLedgerServiceLifecycle: () => ({ kind: 'lifecycle-store' }),
        createLedgerServiceOwnership: () => ({ kind: 'ownership-store' }),
        createLedgerService: () => service,
        waitForShutdown,
        tableName: 'ledger-table',
        sessionRoot: '/logical/control/session-namespace',
      }),
    ).resolves.toEqual({ status: 'STOPPED', generation: 1 });

    expect(service.stop).toHaveBeenCalledTimes(1);
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('closes control state if startup rejects before the resident service becomes ready', async () => {
    const db = { close: jest.fn(async () => {}) };
    const startupError = new Error('already active');
    const service = {
      start: jest.fn(async () => {
        throw startupError;
      }),
      stop: jest.fn(async () => {}),
    };

    await expect(
      runLedgerServiceRuntime({
        readEmbeddedRevisionRuntimePair: async () => ({
          runtime: { appId: 'packaged-runtime', revisionId: REVISION_ID },
        }),
        createControlDBClient: async () => db,
        createLedgerServiceLifecycle: () => ({ kind: 'lifecycle-store' }),
        createLedgerServiceOwnership: () => ({ kind: 'ownership-store' }),
        createLedgerService: () => service,
        waitForShutdown: async () => 'SIGTERM',
        tableName: 'ledger-table',
        sessionRoot: '/logical/control/session-namespace',
      }),
    ).rejects.toBe(startupError);

    expect(service.stop).not.toHaveBeenCalled();
    expect(db.close).toHaveBeenCalledTimes(1);
  });

  it('rejects a nonlocal control adapter before opening a resident service', async () => {
    const previous = process.env.WHARFIE_CONTROL_ADAPTER;
    process.env.WHARFIE_CONTROL_ADAPTER = 'dynamodb';
    try {
      await expect(
        runLedgerServiceRuntime({
          readEmbeddedRevisionRuntimePair: async () => ({
            runtime: { appId: 'packaged-runtime', revisionId: REVISION_ID },
          }),
        }),
      ).rejects.toThrow(/WHARFIE_CONTROL_ADAPTER=lmdb/i);
    } finally {
      if (previous === undefined) delete process.env.WHARFIE_CONTROL_ADAPTER;
      else process.env.WHARFIE_CONTROL_ADAPTER = previous;
    }
  });
});
