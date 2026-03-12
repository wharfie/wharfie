/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VANILLA_DB_IMPORT = '../../../lambdas/lib/db/adapters/vanilla.js';
const LMDB_DB_IMPORT = '../../../lambdas/lib/db/adapters/lmdb.js';
const DYNAMO_DB_IMPORT = '../../../lambdas/lib/db/adapters/dynamodb.js';
const RESOURCES_IMPORT = '../../../lambdas/lib/actor/runtime/resources.js';

/**
 * @returns {string} - Result.
 */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'wharfie-db-contract-'));
}

/**
 * @param {'PRIMARY'|'SORT'} keyType - keyType.
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../../lambdas/lib/db/base.js').KeyCondition} - Result.
 */
function keyEquals(keyType, propertyName, propertyValue) {
  return {
    keyType,
    conditionType: 'EQUALS',
    propertyName,
    propertyValue,
  };
}

/**
 * @param {'PRIMARY'|'SORT'} keyType - keyType.
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../../lambdas/lib/db/base.js').KeyCondition} - Result.
 */
function beginsWith(keyType, propertyName, propertyValue) {
  return {
    keyType,
    conditionType: 'BEGINS_WITH',
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../../lambdas/lib/db/base.js').KeyCondition} - Result.
 */
function fieldEquals(propertyName, propertyValue) {
  return {
    conditionType: 'EQUALS',
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../lambdas/lib/db/base.js').DBClient>} - Result.
 */
async function createVanillaDB(tmpDir) {
  jest.resetModules();
  const mod = await import(VANILLA_DB_IMPORT);
  return mod.default({ path: tmpDir });
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../lambdas/lib/db/base.js').DBClient>} - Result.
 */
async function createLMDBDB(tmpDir) {
  jest.resetModules();
  const mod = await import(LMDB_DB_IMPORT);
  return mod.default({ path: tmpDir });
}

/**
 * @param {{
 *   name: string,
 *   create: (tmpDir: string) => Promise<import('../../../lambdas/lib/db/base.js').DBClient>
 * }} adapter - adapter.
 */
function runLocalDBContract(adapter) {
  describe(`${adapter.name} db adapter contract`, () => {
    /** @type {string} */
    let tmpDir = '';
    /** @type {import('../../../lambdas/lib/db/base.js').DBClient | undefined} */
    let db;

    afterEach(async () => {
      if (db) {
        await db.close();
        db = undefined;
      }

      if (tmpDir) {
        rmSync(tmpDir, { recursive: true, force: true });
        tmpDir = '';
      }
    });

    it('supports put/get/update/query/remove and batchWrite semantics', async () => {
      tmpDir = makeTmpDir();
      db = await adapter.create(tmpDir);

      const record = {
        pk: 'acct#1',
        sk: 'item#1',
        status: 'open',
        nested: { count: 1 },
      };

      await db.put({
        tableName: 'items',
        keyName: 'pk',
        sortKeyName: 'sk',
        record,
      });

      record.nested.count = 999;

      const stored = await db.get({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
      });

      expect(stored).toEqual({
        pk: 'acct#1',
        sk: 'item#1',
        status: 'open',
        nested: { count: 1 },
      });

      if (!stored) {
        throw new Error('Expected stored record to exist');
      }

      stored.nested.count = 555;

      const reread = await db.get({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
      });

      expect(reread?.nested?.count).toBe(1);

      await db.update({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
        conditions: [fieldEquals('status', 'open')],
        updates: [
          { property: ['nested', 'count'], propertyValue: 2 },
          { property: ['status'], propertyValue: 'closed' },
        ],
      });

      const updated = await db.get({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
      });

      expect(updated).toEqual({
        pk: 'acct#1',
        sk: 'item#1',
        status: 'closed',
        nested: { count: 2 },
      });

      await expect(
        db.update({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#1',
          sortKeyName: 'sk',
          sortKeyValue: 'item#1',
          conditions: [fieldEquals('status', 'open')],
          updates: [{ property: ['status'], propertyValue: 'stale' }],
        }),
      ).rejects.toThrow(/ConditionalCheckFailedException/i);

      const afterFailedUpdate = await db.get({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
      });

      expect(afterFailedUpdate?.status).toBe('closed');
      expect(afterFailedUpdate?.nested?.count).toBe(2);

      await db.put({
        tableName: 'items',
        keyName: 'pk',
        sortKeyName: 'sk',
        record: {
          pk: 'acct#1',
          sk: 'item#2',
          status: 'closed',
          nested: { count: 3 },
        },
      });
      await db.put({
        tableName: 'items',
        keyName: 'pk',
        sortKeyName: 'sk',
        record: {
          pk: 'acct#1',
          sk: 'other#1',
          status: 'open',
          nested: { count: 4 },
        },
      });

      const rows = await db.query({
        tableName: 'items',
        consistentRead: true,
        keyConditions: [
          keyEquals('PRIMARY', 'pk', 'acct#1'),
          beginsWith('SORT', 'sk', 'item#'),
          fieldEquals('status', 'closed'),
        ],
      });

      expect(rows.map((row) => row.sk).sort()).toEqual(['item#1', 'item#2']);

      await db.batchWrite({
        tableName: 'items',
        putRequests: [
          {
            keyName: 'pk',
            sortKeyName: 'sk',
            record: { pk: 'acct#2', sk: 'item#1', status: 'queued' },
          },
        ],
        deleteRequests: [
          {
            keyName: 'pk',
            keyValue: 'acct#1',
            sortKeyName: 'sk',
            sortKeyValue: 'item#2',
          },
        ],
      });

      await expect(
        db.get({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#2',
          sortKeyName: 'sk',
          sortKeyValue: 'item#1',
        }),
      ).resolves.toEqual({ pk: 'acct#2', sk: 'item#1', status: 'queued' });

      await expect(
        db.get({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#1',
          sortKeyName: 'sk',
          sortKeyValue: 'item#2',
        }),
      ).resolves.toBeUndefined();

      await db.remove({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
      });

      await expect(
        db.get({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#1',
          sortKeyName: 'sk',
          sortKeyValue: 'item#1',
        }),
      ).resolves.toBeUndefined();
    });
  });
}

runLocalDBContract({
  name: 'vanilla',
  create: createVanillaDB,
});

runLocalDBContract({
  name: 'lmdb',
  create: createLMDBDB,
});

describe('db adapter wiring', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  it('createActorSystemResources wires the dynamodb adapter without AWS calls', async () => {
    const close = jest.fn(async () => {});
    const factory = jest.fn((options = {}) => ({
      query: jest.fn(async () => []),
      put: jest.fn(async () => {}),
      update: jest.fn(async () => {}),
      get: jest.fn(async () => undefined),
      remove: jest.fn(async () => {}),
      batchWrite: jest.fn(async () => {}),
      close,
      options,
    }));

    jest.resetModules();
    jest.unstable_mockModule(DYNAMO_DB_IMPORT, () => ({
      default: factory,
    }));

    const { createActorSystemResources } = await import(RESOURCES_IMPORT);
    const { resources, close: closeResources } =
      await createActorSystemResources({
        db: {
          adapter: 'dynamodb',
          options: {
            region: 'us-east-1',
            endpoint: 'http://localhost:8000',
          },
        },
      });

    expect(factory).toHaveBeenCalledWith({
      region: 'us-east-1',
      endpoint: 'http://localhost:8000',
    });
    expect(typeof resources.db?.get).toBe('function');

    await closeResources();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
