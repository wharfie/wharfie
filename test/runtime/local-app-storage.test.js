/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import path from 'node:path';

import {
  resolveApplicationStateAdapterName,
  resolveApplicationStateStorePath,
  resolveControlAdapterName,
  resolveControlStorePath,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveLedgerServiceSessionPath,
} from '../../src/core/lib/config/db.js';
import {
  getLocalAppStorageLayout,
  withLocalAppStorageLayout,
} from '../../src/core/lib/config/local-app-storage-context.js';
import { resolveExecutionLedgerStoreConfiguration } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { resolveApplicationStateStoreConfiguration } from '../../src/core/runtime/application-state-store.js';
import {
  createLocalAppStorageLayout,
  resolveStableLocalAppDataRoot,
} from '../../src/core/runtime/local-app-storage.js';
import { resolvePackagedAppStorage } from '../../src/core/runtime/packaged-app-storage.js';

const DATA_ROOT = '/var/lib/wharfie-nodejs';

describe('local packaged app storage', () => {
  it('derives one immutable app-scoped durable layout', () => {
    const layout = createLocalAppStorageLayout({
      appId: 'storage-demo',
      dataRoot: DATA_ROOT,
    });

    expect(layout).toEqual({
      appId: 'storage-demo',
      dataRoot: DATA_ROOT,
      appRoot: `${DATA_ROOT}/applications/storage-demo`,
      stateRoot: `${DATA_ROOT}/applications/storage-demo/state`,
      controlPath: `${DATA_ROOT}/applications/storage-demo/state/control`,
      payloadPath: `${DATA_ROOT}/applications/storage-demo/state/control/execution-payloads`,
      applicationStatePath: `${DATA_ROOT}/applications/storage-demo/state/application-state`,
      sessionPath: `${DATA_ROOT}/applications/storage-demo/state/control/ledger-service-sessions`,
      executionLedgerTable: 'wharfie-execution-ledger-v10',
    });
    expect(Object.isFrozen(layout)).toBe(true);
  });

  it.each([
    { appId: '../redirect', dataRoot: DATA_ROOT },
    { appId: 'storage-demo', dataRoot: 'relative' },
    { appId: 'storage-demo', dataRoot: '/var/lib/../redirect' },
  ])('rejects unsafe layout input %#', (input) => {
    expect(() => createLocalAppStorageLayout(input)).toThrow();
  });

  it('resolves the embedded app identity without mutating the environment', async () => {
    const environmentBefore = { ...process.env };
    const layout = await resolvePackagedAppStorage({
      dataRoot: DATA_ROOT,
      readEmbeddedRevisionRuntimePair: async () => ({
        runtime: { appId: 'storage-demo' },
      }),
    });

    expect(layout.appRoot).toBe(`${DATA_ROOT}/applications/storage-demo`);
    expect(process.env).toEqual(environmentBefore);
  });

  it('anchors packaged storage to the account instead of ambient XDG or HOME values', async () => {
    await withEnvironment(
      {
        HOME: '/tmp/invocation-home',
        XDG_DATA_HOME: '/tmp/invocation-data',
      },
      async () => {
        const accountHome = '/home/service-user';
        const layout = await resolvePackagedAppStorage({
          platform: 'linux',
          getHomeDirectory: () => accountHome,
          readEmbeddedRevisionRuntimePair: async () => ({
            runtime: { appId: 'storage-demo' },
          }),
        });

        expect(layout.dataRoot).toBe(
          resolveStableLocalAppDataRoot({
            platform: 'linux',
            homeDirectory: accountHome,
          }),
        );
        expect(layout.dataRoot).toBe(
          '/home/service-user/.local/share/wharfie-nodejs',
        );
      },
    );
  });

  it('routes every default durable store through one async packaged context', async () => {
    const layout = createLocalAppStorageLayout({
      appId: 'storage-demo',
      dataRoot: DATA_ROOT,
    });
    await withEnvironment(
      {
        NODE_ENV: 'test',
        WHARFIE_CONTROL_ADAPTER: undefined,
        WHARFIE_CONTROL_PATH: undefined,
        WHARFIE_EXECUTION_PAYLOAD_PATH: undefined,
        WHARFIE_EXECUTION_PAYLOAD_STORE_ID: undefined,
        WHARFIE_EXECUTION_LEDGER_TABLE: undefined,
        WHARFIE_LEDGER_SERVICE_SESSION_PATH: undefined,
        WHARFIE_APPLICATION_STATE_ADAPTER: undefined,
        WHARFIE_APPLICATION_STATE_PATH: undefined,
      },
      async () => {
        expect(getLocalAppStorageLayout()).toBeUndefined();
        await withLocalAppStorageLayout(layout, async () => {
          await Promise.resolve();
          expect(getLocalAppStorageLayout()).toBe(layout);
          expect(resolveControlAdapterName()).toBe('lmdb');
          expect(resolveControlStorePath()).toBe(layout.controlPath);
          expect(resolveExecutionPayloadPath()).toBe(layout.payloadPath);
          expect(resolveExecutionLedgerTableName()).toBe(
            layout.executionLedgerTable,
          );
          expect(resolveLedgerServiceSessionPath()).toBe(layout.sessionPath);
          expect(resolveApplicationStateAdapterName()).toBe('lmdb');
          expect(resolveApplicationStateStorePath()).toBe(
            layout.applicationStatePath,
          );

          expect(resolveExecutionLedgerStoreConfiguration()).toMatchObject({
            adapterName: 'lmdb',
            controlPath: layout.controlPath,
            tableName: layout.executionLedgerTable,
            payloadPath: layout.payloadPath,
            sessionPath: layout.sessionPath,
          });
          expect(resolveApplicationStateStoreConfiguration()).toEqual({
            adapterName: 'lmdb',
            storePath: layout.applicationStatePath,
            tableName: 'wharfie-application-state-v2',
          });
        });
        expect(getLocalAppStorageLayout()).toBeUndefined();
      },
    );
  });

  it('keeps explicit foreground overrides visible for service preflight to reject', async () => {
    const layout = createLocalAppStorageLayout({
      appId: 'storage-demo',
      dataRoot: DATA_ROOT,
    });
    const redirected = path.join(DATA_ROOT, 'redirected-control');
    await withEnvironment(
      { WHARFIE_CONTROL_PATH: redirected },
      async () =>
        await withLocalAppStorageLayout(layout, async () => {
          expect(resolveControlStorePath()).toBe(redirected);
        }),
    );
  });

  it('requires an immutable layout and a callable bootstrap', () => {
    expect(() =>
      withLocalAppStorageLayout({ controlPath: '/tmp/control' }, () => {}),
    ).toThrow(/immutable/);
    expect(() =>
      withLocalAppStorageLayout(Object.freeze({}), () => {}),
    ).toThrow(/malformed/);
    const layout = createLocalAppStorageLayout({
      appId: 'storage-demo',
      dataRoot: DATA_ROOT,
    });
    expect(() =>
      withLocalAppStorageLayout(layout, /** @type {any} */ (null)),
    ).toThrow(/handler/);
  });
});

/**
 * @template T
 * @param {Record<string, string | undefined>} overrides - Temporary values.
 * @param {() => T | Promise<T>} handler - Scoped assertion.
 * @returns {Promise<T>} - Handler result.
 */
async function withEnvironment(overrides, handler) {
  /** @type {Record<string, string | undefined>} */
  const previous = {};
  for (const [name, value] of Object.entries(overrides)) {
    previous[name] = process.env[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await handler();
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
