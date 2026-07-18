/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockedDynamoDB } from '../../helpers/db-adapters.js';

const VANILLA_DB_IMPORT = '../../../src/core/lib/db/adapters/vanilla.js';
const LMDB_DB_IMPORT = '../../../src/core/lib/db/adapters/lmdb.js';

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
 * @param {import('../../../src/core/lib/db/base.js').DBClient} db - Adapter under test.
 * @param {{tableName?: string, primaryKeyName?: string, sortKeyName?: string}} [options] - Optional physical key schema.
 * @returns {Promise<void>} - Resolves after validating the bounded page contract.
 */
async function expectQueryPageContract(
  db,
  { tableName = 'paged-items', primaryKeyName = 'pk', sortKeyName = 'sk' } = {},
) {
  for (const sk of ['directory/a', 'directory/b', 'directory/c']) {
    await db.put({
      tableName,
      keyName: primaryKeyName,
      sortKeyName,
      record: {
        [primaryKeyName]: 'service',
        [sortKeyName]: sk,
        value: sk.slice(-1),
      },
    });
  }

  const first = await db.queryPage({
    tableName,
    consistentRead: true,
    keyConditions: [
      keyEquals('PRIMARY', primaryKeyName, 'service'),
      beginsWith('SORT', sortKeyName, 'directory/'),
    ],
    limit: 2,
  });
  expect(first).toEqual({
    items: [
      {
        [primaryKeyName]: 'service',
        [sortKeyName]: 'directory/a',
        value: 'a',
      },
      {
        [primaryKeyName]: 'service',
        [sortKeyName]: 'directory/b',
        value: 'b',
      },
    ],
    nextStartAfter: 'directory/b',
  });

  const second = await db.queryPage({
    tableName,
    consistentRead: true,
    keyConditions: [
      keyEquals('PRIMARY', primaryKeyName, 'service'),
      beginsWith('SORT', sortKeyName, 'directory/'),
    ],
    limit: 2,
    startAfter: first.nextStartAfter,
  });
  expect(second).toEqual({
    items: [
      {
        [primaryKeyName]: 'service',
        [sortKeyName]: 'directory/c',
        value: 'c',
      },
    ],
  });

  await expect(
    db.queryPage({
      tableName,
      consistentRead: true,
      keyConditions: [
        keyEquals('PRIMARY', primaryKeyName, 'service'),
        beginsWith('SORT', sortKeyName, 'directory/'),
        fieldEquals('value', 'a'),
      ],
      limit: 2,
    }),
  ).rejects.toThrow(/does not support non-key filters/i);

  await db.put({
    tableName,
    keyName: primaryKeyName,
    sortKeyName,
    record: {
      [primaryKeyName]: 'non-ascii',
      [sortKeyName]: 'directory/é',
      value: 'bad',
    },
  });
  await expect(
    db.queryPage({
      tableName,
      consistentRead: true,
      keyConditions: [
        keyEquals('PRIMARY', primaryKeyName, 'non-ascii'),
        beginsWith('SORT', sortKeyName, 'directory/'),
      ],
      limit: 1,
    }),
  ).rejects.toThrow(/ASCII/i);
  await expect(
    db.queryPage({
      tableName,
      consistentRead: true,
      keyConditions: [
        keyEquals('PRIMARY', primaryKeyName, 'service'),
        beginsWith('SORT', sortKeyName, 'directory/é'),
      ],
      limit: 1,
    }),
  ).rejects.toThrow(/ASCII/i);
  await expect(
    db.queryPage({
      tableName,
      consistentRead: true,
      keyConditions: [
        keyEquals('PRIMARY', primaryKeyName, 'service'),
        beginsWith('SORT', sortKeyName, 'directory/'),
      ],
      limit: 1,
      startAfter: 'other-directory/a',
    }),
  ).rejects.toThrow(/SORT prefix/i);
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

    test('supports bounded lexical query pages', async () => {
      tmpDir = makeTmpDir();
      db = await adapter.create(tmpDir);
      await expectQueryPageContract(db);
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

  test('supports bounded lexical query pages', async () => {
    const { db } = await createMockedDynamoDB();
    try {
      await expectQueryPageContract(db);
    } finally {
      await db.close();
    }
  });

  test('supports bounded pages for an explicitly configured non-default schema', async () => {
    const { db } = await createMockedDynamoDB({
      tableSchemas: {
        'custom-paged-items': ['customer', 'timestamp'],
      },
    });
    try {
      await expectQueryPageContract(db, {
        tableName: 'custom-paged-items',
        primaryKeyName: 'customer',
        sortKeyName: 'timestamp',
      });
    } finally {
      await db.close();
    }
  });

  test('probes an ambiguous provider continuation before exposing a public cursor', async () => {
    const { db, fakeDocClient } = await createMockedDynamoDB();
    try {
      for (const sk of ['directory/a', 'directory/b', 'directory/c']) {
        await db.put({
          tableName: 'ambiguous-provider-page',
          keyName: 'pk',
          sortKeyName: 'sk',
          record: { pk: 'service', sk },
        });
      }
      fakeDocClient.__queueQueryResponses([
        {
          Items: [
            { pk: 'service', sk: 'directory/a' },
            { pk: 'service', sk: 'directory/b' },
          ],
          // Simulates DynamoDB hitting its byte cap at exactly the requested
          // count: a nonempty LEK alone is not proof of another item.
          LastEvaluatedKey: { pk: 'service', sk: 'directory/b' },
        },
        {
          Items: [{ pk: 'service', sk: 'directory/c' }],
        },
      ]);

      await expect(
        db.queryPage({
          tableName: 'ambiguous-provider-page',
          consistentRead: true,
          keyConditions: [
            keyEquals('PRIMARY', 'pk', 'service'),
            beginsWith('SORT', 'sk', 'directory/'),
          ],
          limit: 2,
        }),
      ).resolves.toEqual({
        items: [
          { pk: 'service', sk: 'directory/a' },
          { pk: 'service', sk: 'directory/b' },
        ],
        nextStartAfter: 'directory/b',
      });
      expect(
        fakeDocClient.__queryCalls.map((request) => ({
          Limit: request.Limit,
          ScanIndexForward: request.ScanIndexForward,
          ExclusiveStartKey: request.ExclusiveStartKey,
        })),
      ).toEqual([
        { Limit: 3, ScanIndexForward: true, ExclusiveStartKey: undefined },
        {
          Limit: 1,
          ScanIndexForward: true,
          ExclusiveStartKey: { pk: 'service', sk: 'directory/b' },
        },
      ]);
    } finally {
      await db.close();
    }
  });

  test('treats an empty provider continuation key as terminal', async () => {
    const { db, fakeDocClient } = await createMockedDynamoDB();
    try {
      fakeDocClient.__queueQueryResponses([
        {
          Items: [
            { pk: 'service', sk: 'directory/a' },
            { pk: 'service', sk: 'directory/b' },
          ],
          LastEvaluatedKey: {},
        },
      ]);
      await expect(
        db.queryPage({
          tableName: 'terminal-empty-key',
          consistentRead: true,
          keyConditions: [
            keyEquals('PRIMARY', 'pk', 'service'),
            beginsWith('SORT', 'sk', 'directory/'),
          ],
          limit: 2,
        }),
      ).resolves.toEqual({
        items: [
          { pk: 'service', sk: 'directory/a' },
          { pk: 'service', sk: 'directory/b' },
        ],
      });
      expect(fakeDocClient.__queryCalls).toHaveLength(1);
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
