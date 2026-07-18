/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  resolveApplicationStateAdapterName,
} from '../../src/core/lib/config/db.js';
import {
  resolveApplicationStateStoreConfiguration,
  validateApplicationStateStoreConfiguration,
  withApplicationStateDB,
} from '../../src/core/runtime/application-state-store.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('application-state store boundary', () => {
  it('resolves an immutable isolated test store and a fixed table', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs24.x',
        WHARFIE_DB_ADAPTER: 'dynamodb',
        WHARFIE_CONTROL_PATH: '/tmp/not-application-control',
        WHARFIE_STATE_DB_PATH: '/tmp/not-legacy-actor-state',
        WHARFIE_APPLICATION_STATE_ADAPTER: undefined,
        WHARFIE_APPLICATION_STATE_PATH: undefined,
        WHARFIE_APPLICATION_STATE_TABLE: 'caller-controlled-table',
      },
      () => {
        const first = resolveApplicationStateStoreConfiguration();
        const second = resolveApplicationStateStoreConfiguration();

        expect(first).toEqual({
          adapterName: 'vanilla',
          storePath: expect.stringContaining('wharfie-application-state-'),
          tableName: 'wharfie-application-state-v1',
        });
        expect(Object.isFrozen(first)).toBe(true);
        expect(second.storePath).not.toBe(first.storePath);
        expect(first.storePath).not.toContain('not-application-control');
        expect(first.storePath).not.toContain('not-legacy-actor-state');
      },
    );
  });

  it('defaults normal local application state to LMDB without cloud inference', async () => {
    await withEnv(
      {
        NODE_ENV: 'development',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_ECS_FARGATE',
        WHARFIE_DB_ADAPTER: 'dynamodb',
        WHARFIE_APPLICATION_STATE_ADAPTER: undefined,
      },
      () => {
        expect(resolveApplicationStateAdapterName()).toBe('lmdb');
      },
    );

    await withEnv({ WHARFIE_APPLICATION_STATE_ADAPTER: ' DynamoDB ' }, () => {
      expect(resolveApplicationStateAdapterName()).toBe('dynamodb');
    });
  });

  it('opens, routes, and closes the dedicated store around one operation', async () => {
    const storePath = mkdtempSync(
      join(tmpdir(), 'wharfie-application-state-store-'),
    );
    temporaryDirectories.push(storePath);
    const configuration = validateApplicationStateStoreConfiguration({
      adapterName: 'vanilla',
      storePath,
      tableName: APPLICATION_STATE_TABLE_NAME,
    });

    const context = await withApplicationStateDB(
      async (db, operation) => {
        await db.put({
          tableName: operation.tableName,
          keyName: 'record_id',
          record: { record_id: 'application:a', value: 42 },
        });
        return operation;
      },
      { configuration },
    );
    expect(context).toEqual({ ...configuration, readOnly: false });
    expect(Object.isFrozen(context)).toBe(true);

    const reader = await createApplicationStateDBClient('vanilla', {
      path: storePath,
      readOnly: true,
    });
    try {
      await expect(
        reader.get({
          tableName: APPLICATION_STATE_TABLE_NAME,
          keyName: 'record_id',
          keyValue: 'application:a',
        }),
      ).resolves.toEqual({ record_id: 'application:a', value: 42 });
      await expect(
        reader.put({
          tableName: APPLICATION_STATE_TABLE_NAME,
          keyName: 'record_id',
          record: { record_id: 'application:b' },
        }),
      ).rejects.toThrow('Vanilla DB client is read-only.');
    } finally {
      await reader.close();
    }
  });

  it('does not materialize a missing LMDB root during a read-only open', async () => {
    const parent = mkdtempSync(
      join(tmpdir(), 'wharfie-application-state-read-only-'),
    );
    temporaryDirectories.push(parent);
    const storePath = join(parent, 'missing-store');

    await expect(
      createApplicationStateDBClient('lmdb', {
        path: storePath,
        readOnly: true,
      }),
    ).rejects.toThrow(/read-only local volume does not exist/i);
    expect(existsSync(storePath)).toBe(false);
  });

  it('rejects ambiguous routing and misspelled access options', async () => {
    expect(() =>
      validateApplicationStateStoreConfiguration({
        adapterName: 'vanilla',
        storePath: '/tmp/application-state',
        tableName: 'wharfie-execution-ledger-v6',
      }),
    ).toThrow(/tableName must be 'wharfie-application-state-v1'/i);
    expect(() =>
      validateApplicationStateStoreConfiguration({
        adapterName: 'vanilla',
        storePath: '/tmp/application-state',
        tableName: APPLICATION_STATE_TABLE_NAME,
        storeId: 'identity-does-not-belong-in-config',
      }),
    ).toThrow(/configuration\.storeId is not supported/i);

    await expect(
      createApplicationStateDBClient(/** @type {any} */ ('sqlite')),
    ).rejects.toThrow(/Unsupported application-state adapter: sqlite/i);
    await expect(
      createApplicationStateDBClient(
        'vanilla',
        /** @type {any} */ ({
          timeout: 10,
        }),
      ),
    ).rejects.toThrow(/option 'timeout' is not supported/i);
    await expect(
      withApplicationStateDB(
        async () => undefined,
        /** @type {any} */ ({
          readonly: true,
        }),
      ),
    ).rejects.toThrow(/option 'readonly' is not supported/i);
  });
});

/**
 * @template T
 * @param {Record<string, string | undefined>} overrides - Temporary values.
 * @param {() => T | Promise<T>} handler - Scoped operation.
 * @returns {Promise<T>} - Handler result.
 */
async function withEnv(overrides, handler) {
  /** @type {Record<string, string | undefined>} */
  const previous = {};
  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await handler();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
