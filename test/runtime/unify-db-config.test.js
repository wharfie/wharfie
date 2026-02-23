/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import createVanillaDB from '../..//lambdas/lib/db/adapters/vanilla.js';
import { createOperationsTable } from '../..//lambdas/lib/db/tables/operations.js';
import Resource from '../..//lambdas/lib/graph/resource.js';
import {
  closeDB,
  resolveOperationsTableName,
  resolveStateAdapterName,
} from '../../lambdas/lib/config/db.js';
import {
  __setMockState as __resetOperationsStore,
  getOperationsStore,
} from '../../lambdas/lib/db/operations/store.js';
import { __resolveAdapterName as __resolveStateStoreAdapter } from '../../lambdas/lib/db/state/store.js';

describe('Unified DB config', () => {
  afterEach(async () => {
    // Ensure we never leak a shared singleton between tests.
    try {
      await closeDB();
    } finally {
      __resetOperationsStore();
    }
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

  test('operations store resolves table name at call time and isolates tables', async () => {
    await withEnv({ OPERATIONS_TABLE: 'ops-a' }, async () => {
      expect(resolveOperationsTableName()).toBe('ops-a');

      const storeA = await getOperationsStore();
      const r1 = makeResource('r1');
      await storeA.putResource(r1);

      const foundA = await storeA.getResource('r1');
      expect(foundA?.id).toBe('r1');

      // Flip env var AFTER the module is already imported.
      await withEnv({ OPERATIONS_TABLE: 'ops-b' }, async () => {
        expect(resolveOperationsTableName()).toBe('ops-b');

        const storeB = await getOperationsStore();
        const foundB = await storeB.getResource('r1');
        expect(foundB).toBe(null);

        const r2 = makeResource('r2');
        await storeB.putResource(r2);

        const foundA2 = await storeA.getResource('r2');
        expect(foundA2).toBe(null);
      });
    });
  });
});

/**
 * @param {string} id
 */
function makeResource(id) {
  return new Resource({
    id,
    region: 'us-east-1',
    athena_workgroup: 'primary',
    daemon_config: {
      Role: 'arn:aws:iam::123456789012:role/test',
    },
    resource_properties: {},
    // @ts-ignore
    source_properties: { name: 'src' },
    // @ts-ignore
    destination_properties: { name: 'dst' },
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
