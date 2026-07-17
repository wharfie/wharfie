/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../../src/core/lib/db/adapters/vanilla.js';
import { createOperationsTable } from '../../src/core/lib/db/tables/operations.js';
import Operation from '../../src/core/lib/graph/operation.js';
import {
  closeDB,
  createOperationsDBClient,
  resolveOperationsAdapterName,
  resolveOperationsTableName,
  resolveStateAdapterName,
} from '../../src/core/lib/config/db.js';
import { __resolveAdapterName as __resolveStateStoreAdapter } from '../../src/core/lib/db/state/store.js';

describe('Unified DB config', () => {
  afterEach(async () => {
    await closeDB();
  });

  test('state adapter selection never infers DynamoDB from AWS env vars', async () => {
    await withEnv(
      {
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_DB_ADAPTER: undefined,
        WHARFIE_STATE_ADAPTER: undefined,
      },
      async () => {
        expect(resolveStateAdapterName()).toBe('vanilla');
        expect(__resolveStateStoreAdapter()).toBe('vanilla');
      },
    );
  });

  test('operations control has isolated test defaults and durable local defaults', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_CONTROL_ADAPTER: undefined,
        WHARFIE_CONTROL_PATH: undefined,
        WHARFIE_OPERATIONS_TABLE: undefined,
        OPERATIONS_TABLE: 'ignored-legacy-name',
      },
      async () => {
        expect(resolveOperationsAdapterName()).toBe('vanilla');
        expect(resolveOperationsTableName()).toBe('wharfie-operations');

        const first = await createOperationsDBClient();
        const second = await createOperationsDBClient();
        try {
          await first.put({
            tableName: 'isolation-probe',
            keyName: 'id',
            record: { id: 'only-in-first' },
          });
          expect(
            await second.get({
              tableName: 'isolation-probe',
              keyName: 'id',
              keyValue: 'only-in-first',
            }),
          ).toBeUndefined();
        } finally {
          await first.close();
          await second.close();
        }
      },
    );

    await withEnv(
      {
        NODE_ENV: 'development',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_CONTROL_ADAPTER: undefined,
      },
      async () => {
        expect(resolveOperationsAdapterName()).toBe('lmdb');
      },
    );
  });

  test('operations control honors explicit adapter selection', async () => {
    await withEnv({ WHARFIE_CONTROL_ADAPTER: 'LMDB' }, async () => {
      expect(resolveOperationsAdapterName()).toBe('lmdb');
    });
    await withEnv({ WHARFIE_CONTROL_ADAPTER: 'dynamodb' }, async () => {
      expect(resolveOperationsAdapterName()).toBe('dynamodb');
    });
    await withEnv({ WHARFIE_CONTROL_ADAPTER: 'vanilla' }, async () => {
      expect(resolveOperationsAdapterName()).toBe('vanilla');
    });
  });

  test('operations table factory requires an explicit tableName', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wharfie-ops-table-'));
    const db = createVanillaDB({ path: dir });
    try {
      expect(() => createOperationsTable({ db })).toThrow(/tableName/i);
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('operations table names resolve at call time and isolate runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wharfie-ops-config-'));
    const db = createVanillaDB({ path: dir });

    try {
      await withEnv({ WHARFIE_OPERATIONS_TABLE: ' ops-a ' }, async () => {
        const storeA = createOperationsTable({
          db,
          tableName: resolveOperationsTableName(),
        });
        await storeA.createOperation(makeOperation('run-a'));
        expect(
          await storeA.getOperation('app:config-test', 'run-a'),
        ).not.toBeNull();

        await withEnv({ WHARFIE_OPERATIONS_TABLE: 'ops-b' }, async () => {
          const storeB = createOperationsTable({
            db,
            tableName: resolveOperationsTableName(),
          });
          expect(
            await storeB.getOperation('app:config-test', 'run-a'),
          ).toBeNull();

          await storeB.createOperation(makeOperation('run-b'));
          expect(
            await storeA.getOperation('app:config-test', 'run-b'),
          ).toBeNull();
        });
      });
    } finally {
      await db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * @param {string} id
 * @returns {Operation}
 */
function makeOperation(id) {
  return new Operation({
    resource_id: 'app:config-test',
    resource_version: 1,
    id,
    type: Operation.Type.PIPELINE,
  });
}

/**
 * Temporarily applies env var overrides for the duration of the callback.
 *
 * @template T
 * @param {Record<string, string | undefined>} overrides - overrides.
 * @param {() => T | Promise<T>} fn - fn.
 * @returns {Promise<T>} - Result.
 */
async function withEnv(overrides, fn) {
  /** @type {Record<string, string | undefined>} */
  const previous = {};

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
