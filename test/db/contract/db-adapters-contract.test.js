/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockedDynamoDB } from '../../helpers/db-adapters.js';

const VANILLA_DB_IMPORT = '../../../src/core/lib/db/adapters/vanilla.js';
const LMDB_DB_IMPORT = '../../../src/core/lib/db/adapters/lmdb.js';
const DYNAMO_DB_IMPORT = '../../../src/core/lib/db/adapters/dynamodb.js';
const RESOURCES_IMPORT = '../../../src/core/runtime/resources.js';

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
 * @returns {import('../../../src/core/lib/db/base.js').KeyCondition} - Result.
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
 * @returns {import('../../../src/core/lib/db/base.js').KeyCondition} - Result.
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
 * @returns {import('../../../src/core/lib/db/base.js').KeyCondition} - Result.
 */
function fieldEquals(propertyName, propertyValue) {
  return {
    conditionType: 'EQUALS',
    propertyName,
    propertyValue,
  };
}

/**
 * @param {import('../../../src/core/lib/db/base.js').ConditionTypeEnum} conditionType - conditionType.
 * @param {string} propertyName - propertyName.
 * @param {any} [propertyValue] - propertyValue.
 * @returns {import('../../../src/core/lib/db/base.js').KeyCondition} - Result.
 */
function fieldCondition(conditionType, propertyName, propertyValue) {
  return {
    conditionType,
    propertyName,
    ...(propertyValue === undefined ? {} : { propertyValue }),
  };
}

/**
 * @param {import('../../../src/core/lib/db/base.js').DBClient} db - DB adapter.
 * @returns {Promise<void>} - Result.
 */
async function expectTransactionWriteContract(db) {
  const tableName = 'transaction-items';
  await db.batchWrite({
    tableName,
    putRequests: [
      {
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'account', sk: 'state', status: 'open', count: 1 },
      },
      {
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'guard', sk: 'state', status: 'ready' },
      },
      {
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'obsolete', sk: 'state', status: 'old' },
      },
    ],
  });

  await db.transactionWrite({
    tableName,
    conditionChecks: [
      {
        keyName: 'pk',
        keyValue: 'guard',
        sortKeyName: 'sk',
        sortKeyValue: 'state',
        conditions: [fieldEquals('status', 'ready')],
      },
    ],
    putRequests: [
      {
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'created', sk: 'state', status: 'new' },
        conditions: [fieldCondition('NOT_EXISTS', 'pk')],
      },
    ],
    updateRequests: [
      {
        keyName: 'pk',
        keyValue: 'account',
        sortKeyName: 'sk',
        sortKeyValue: 'state',
        conditions: [
          fieldCondition('EXISTS', 'status'),
          fieldEquals('status', 'open'),
        ],
        updates: [
          { property: ['status'], propertyValue: 'closed' },
          { property: ['count'], propertyValue: 2 },
        ],
      },
    ],
    deleteRequests: [
      {
        keyName: 'pk',
        keyValue: 'obsolete',
        sortKeyName: 'sk',
        sortKeyValue: 'state',
        conditions: [fieldCondition('EXISTS', 'pk')],
      },
    ],
  });

  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'account',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toEqual({
    pk: 'account',
    sk: 'state',
    status: 'closed',
    count: 2,
  });
  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'created',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toEqual({ pk: 'created', sk: 'state', status: 'new' });
  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'obsolete',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toBeUndefined();

  await expect(
    db.transactionWrite({
      tableName,
      putRequests: [
        {
          keyName: 'pk',
          sortKeyName: 'sk',
          record: { pk: 'must-not-exist', sk: 'state' },
        },
      ],
      updateRequests: [
        {
          keyName: 'pk',
          keyValue: 'account',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          conditions: [fieldEquals('status', 'open')],
          updates: [{ property: ['count'], propertyValue: 999 }],
        },
      ],
      deleteRequests: [
        {
          keyName: 'pk',
          keyValue: 'guard',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
        },
      ],
    }),
  ).rejects.toThrow(/ConditionalCheckFailed/i);

  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'must-not-exist',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toBeUndefined();
  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'account',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toMatchObject({ count: 2 });
  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'guard',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toMatchObject({ status: 'ready' });

  await expect(
    db.transactionWrite({
      tableName,
      conditionChecks: [
        {
          keyName: 'pk',
          keyValue: 'guard',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          conditions: [fieldCondition('EXISTS', 'pk')],
        },
      ],
      deleteRequests: [
        {
          keyName: 'pk',
          keyValue: 'guard',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
        },
      ],
    }),
  ).rejects.toThrow(/target an item more than once/i);

  await expect(
    db.transactionWrite({
      tableName,
      conditionChecks: Array.from({ length: 101 }, (_, index) => ({
        keyName: 'pk',
        keyValue: `limit-${index}`,
        sortKeyName: 'sk',
        sortKeyValue: 'state',
        conditions: [fieldCondition('NOT_EXISTS', 'pk')],
      })),
    }),
  ).rejects.toThrow(/between 1 and 100 items/i);

  await db.transactionWrite({
    tableName,
    updateRequests: [
      {
        keyName: 'pk',
        keyValue: 'upserted',
        sortKeyName: 'sk',
        sortKeyValue: 'state',
        updates: [{ property: ['status'], propertyValue: 'created' }],
      },
    ],
  });
  await expect(
    db.get({
      tableName,
      keyName: 'pk',
      keyValue: 'upserted',
      sortKeyName: 'sk',
      sortKeyValue: 'state',
    }),
  ).resolves.toEqual({ pk: 'upserted', sk: 'state', status: 'created' });

  const invalidUpdateRequests = [
    {
      updates: [{ property: ['pk'], propertyValue: 'changed' }],
      message: /key field/i,
    },
    {
      updates: [
        { property: ['data'], propertyValue: {} },
        { property: ['data', 'status'], propertyValue: 'changed' },
      ],
      message: /duplicate or overlapping paths/i,
    },
    {
      updates: [
        { property: ['status'], propertyValue: 'one' },
        { property: ['status'], propertyValue: 'two' },
      ],
      message: /duplicate or overlapping paths/i,
    },
    {
      updates: [{ property: [''], propertyValue: 'changed' }],
      message: /nonempty string path/i,
    },
    {
      updates: [{ property: ['status'], propertyValue: undefined }],
      message: /must not be undefined/i,
    },
  ];
  for (const invalid of invalidUpdateRequests) {
    // eslint-disable-next-line no-await-in-loop
    await expect(
      db.transactionWrite({
        tableName,
        updateRequests: [
          {
            keyName: 'pk',
            keyValue: 'account',
            sortKeyName: 'sk',
            sortKeyValue: 'state',
            updates: invalid.updates,
          },
        ],
      }),
      // @ts-ignore - table-driven regex assertion.
    ).rejects.toThrow(invalid.message);
  }

  await expect(
    db.transactionWrite({
      tableName,
      updateRequests: [
        {
          keyName: 'pk',
          keyValue: 'account',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          updates: [{ property: ['missing', 'child'], propertyValue: 'value' }],
        },
      ],
    }),
  ).rejects.toThrow(/invalid update path/i);
  await expect(
    db.transactionWrite({
      tableName,
      updateRequests: [
        {
          keyName: 'pk',
          keyValue: 'account',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          updates: [{ property: ['status', 'child'], propertyValue: 'value' }],
        },
      ],
    }),
  ).rejects.toThrow(/invalid update path/i);

  await expect(
    db.transactionWrite({
      tableName,
      conditionChecks: [
        {
          keyName: 'pk',
          keyValue: 'account',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          conditions: [
            fieldEquals('status', /** @type {any} */ ({ bad: true })),
          ],
        },
      ],
    }),
  ).rejects.toThrow(/portable JSON primitive/i);
  await expect(
    db.transactionWrite({
      tableName,
      conditionChecks: [
        {
          keyName: 'pk',
          keyValue: 'account',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          conditions: [fieldCondition('BEGINS_WITH', 'missing', '')],
        },
      ],
    }),
  ).rejects.toThrow(/ConditionalCheckFailed/i);
  await expect(
    db.transactionWrite({
      tableName,
      conditionChecks: [
        {
          keyName: 'pk',
          keyValue: 'account',
          sortKeyName: 'sk',
          sortKeyValue: 'state',
          conditions: [
            fieldCondition('EQUALS', 'count', /** @type {any} */ ('2')),
          ],
        },
      ],
    }),
  ).rejects.toThrow(/ConditionalCheckFailed/i);
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../src/core/lib/db/base.js').DBClient>} - Result.
 */
async function createVanillaDB(tmpDir) {
  jest.resetModules();
  const mod = await import(VANILLA_DB_IMPORT);
  return mod.default({ path: tmpDir });
}

/**
 * @param {string} tmpDir - tmpDir.
 * @returns {Promise<import('../../../src/core/lib/db/base.js').DBClient>} - Result.
 */
async function createLMDBDB(tmpDir) {
  jest.resetModules();
  const mod = await import(LMDB_DB_IMPORT);
  return mod.default({ path: tmpDir });
}

/**
 * @param {{
 *   name: string,
 *   create: (tmpDir: string) => Promise<import('../../../src/core/lib/db/base.js').DBClient>
 * }} adapter - adapter.
 */
function runLocalDBContract(adapter) {
  describe(`${adapter.name} db adapter contract`, () => {
    /** @type {string} */
    let tmpDir = '';
    /** @type {import('../../../src/core/lib/db/base.js').DBClient | undefined} */
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

    test('supports put/get/update/query/remove and batchWrite semantics', async () => {
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

      expect(
        await db.get({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#2',
          sortKeyName: 'sk',
          sortKeyValue: 'item#1',
        }),
      ).toEqual({ pk: 'acct#2', sk: 'item#1', status: 'queued' });

      expect(
        await db.get({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#1',
          sortKeyName: 'sk',
          sortKeyValue: 'item#2',
        }),
      ).toBeUndefined();

      await db.remove({
        tableName: 'items',
        keyName: 'pk',
        keyValue: 'acct#1',
        sortKeyName: 'sk',
        sortKeyValue: 'item#1',
      });

      expect(
        await db.get({
          tableName: 'items',
          keyName: 'pk',
          keyValue: 'acct#1',
          sortKeyName: 'sk',
          sortKeyValue: 'item#1',
        }),
      ).toBeUndefined();
    });

    test('supports atomic conditional transactionWrite semantics', async () => {
      tmpDir = makeTmpDir();
      db = await adapter.create(tmpDir);
      await expectTransactionWriteContract(db);
    });
  });
}

runLocalDBContract({
  name: 'vanilla',
  create: createVanillaDB,
});

describe('dynamodb transactionWrite contract', () => {
  test('uses an atomic conditional TransactWrite operation', async () => {
    const { db, fakeDocClient } = await createMockedDynamoDB();
    try {
      await expectTransactionWriteContract(db);
      expect(fakeDocClient.__calls).toEqual({
        batchWrite: 1,
        transactWrite: 7,
      });
    } finally {
      await db.close();
    }
  });

  test('does not normalize systemic transaction cancellation as a condition race', async () => {
    const { db, fakeDocClient } = await createMockedDynamoDB();
    try {
      const systemic = /** @type {any} */ (
        new Error('transaction conflict and throttling')
      );
      systemic.name = 'TransactionCanceledException';
      systemic.CancellationReasons = [
        { Code: 'ConditionalCheckFailed' },
        { Code: 'TransactionConflict' },
      ];
      fakeDocClient.__failNextTransaction(systemic);

      await expect(
        db.transactionWrite({
          tableName: 'systemic-cancellation',
          putRequests: [
            {
              keyName: 'pk',
              record: { pk: 'one', status: 'pending' },
            },
          ],
        }),
      ).rejects.toBe(systemic);
    } finally {
      await db.close();
    }
  });

  test('retries a transient DynamoDB transaction conflict', async () => {
    const { db, fakeDocClient } = await createMockedDynamoDB();
    try {
      const conflict = /** @type {any} */ (
        new Error('transient transaction conflict')
      );
      conflict.name = 'TransactionCanceledException';
      conflict.CancellationReasons = [{ Code: 'TransactionConflict' }];
      fakeDocClient.__failNextTransaction(conflict);

      await db.transactionWrite({
        tableName: 'transient-conflict',
        putRequests: [
          {
            keyName: 'pk',
            record: { pk: 'one', status: 'committed' },
          },
        ],
      });
      await expect(
        db.get({
          tableName: 'transient-conflict',
          keyName: 'pk',
          keyValue: 'one',
        }),
      ).resolves.toMatchObject({ status: 'committed' });
      expect(fakeDocClient.__calls.transactWrite).toBe(2);
    } finally {
      await db.close();
    }
  });
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

  test('createActorSystemResources wires the dynamodb adapter without AWS calls', async () => {
    const close = jest.fn(async () => {});
    const factory = jest.fn((options = {}) => ({
      query: jest.fn(async () => []),
      put: jest.fn(async () => {}),
      update: jest.fn(async () => {}),
      get: jest.fn(async () => undefined),
      remove: jest.fn(async () => {}),
      batchWrite: jest.fn(async () => {}),
      transactionWrite: jest.fn(async () => {}),
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
