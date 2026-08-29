// @ts-nocheck -- intentionally loose injected AWS SDK test doubles.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import createDynamoDB, {
  assertDynamoDBTablePinnedForClient,
  describeDynamoDBTableForClient,
  pinDescribedDynamoDBTableForClient,
} from '../../src/core/lib/db/adapters/dynamodb.js';
import { validateAwsDynamoDBCoordinatorAuthorityTableTopology } from '../../src/core/runtime/dynamodb-coordinator-authority-topology-provider.js';
import { createAwsProviderModule } from '../helpers/aws-provider.js';

const TABLE_NAME = 'execution-ledger';
const REGION = 'us-east-2';
const TABLE_ARN =
  'arn:aws:dynamodb:us-east-2:123456789012:table/execution-ledger';
const OTHER_TABLE_ARN =
  'arn:aws:dynamodb:us-east-2:210987654321:table/execution-ledger';
const TABLE_ID = '00000000-1111-2222-3333-444444444444';
const OTHER_TABLE_ID = '55555555-6666-7777-8888-999999999999';

function tableDescription(tableArn = TABLE_ARN, tableId = TABLE_ID) {
  return Object.freeze({
    Table: Object.freeze({
      TableName: TABLE_NAME,
      TableArn: tableArn,
      TableId: tableId,
    }),
  });
}

function harness() {
  const response = tableDescription();
  const describeTable = jest.fn(async () => response);
  const rawDestroy = jest.fn();
  const DynamoDB = jest.fn(function DynamoDB(options) {
    this.options = options;
    this.describeTable = describeTable;
    this.destroy = rawDestroy;
  });
  const docClient = {
    query: jest.fn(async () => ({ Items: [] })),
    put: jest.fn(async () => ({})),
    update: jest.fn(async () => ({})),
    get: jest.fn(async () => ({})),
    delete: jest.fn(async () => ({})),
    batchWrite: jest.fn(async () => ({ UnprocessedItems: {} })),
    transactWrite: jest.fn(async () => ({})),
  };
  const from = jest.fn(() => docClient);
  const DynamoDBDocument = Object.assign(jest.fn(), { from });
  const credentials = jest.fn();
  const fromNodeProviderChain = jest.fn(() => credentials);
  const bindings = createAwsProviderModule({
    clientDynamoDB: { DynamoDB },
    credentialProviders: { fromNodeProviderChain },
    libDynamoDB: { DynamoDBDocument },
  }).getAwsSdkBindings();
  const db = createDynamoDB({ region: REGION }, bindings);
  return {
    db,
    response,
    describeTable,
    rawDestroy,
    DynamoDB,
    docClient,
    from,
    credentials,
    fromNodeProviderChain,
  };
}

async function describeAndPin(fixture, response = fixture.response) {
  fixture.describeTable.mockResolvedValueOnce(response);
  const input = Object.freeze({ TableName: TABLE_NAME });
  const exact = await describeDynamoDBTableForClient(fixture.db, input);
  pinDescribedDynamoDBTableForClient(fixture.db, input, exact);
  return exact;
}

describe('DynamoDB topology capability', () => {
  test('uses the immutable raw-client wrapper with refreshable credentials', async () => {
    const fixture = harness();
    const input = Object.freeze({ TableName: TABLE_NAME });
    try {
      expect(Object.isFrozen(fixture.db)).toBe(true);
      expect(() => {
        fixture.db.get = async () => undefined;
      }).toThrow(TypeError);
      expect(() => {
        fixture.db.transactionWrite = async () => undefined;
      }).toThrow(TypeError);

      await expect(
        describeDynamoDBTableForClient(fixture.db, input),
      ).resolves.toBe(fixture.response);
      pinDescribedDynamoDBTableForClient(fixture.db, input, fixture.response);

      expect(fixture.DynamoDB).toHaveBeenCalledTimes(1);
      expect(fixture.DynamoDB).toHaveBeenCalledWith(
        expect.objectContaining({
          region: REGION,
          credentials: fixture.credentials,
        }),
      );
      expect(fixture.from).toHaveBeenCalledWith(
        fixture.DynamoDB.mock.instances[0],
        { marshallOptions: { removeUndefinedValues: true } },
      );
      expect(fixture.describeTable).toHaveBeenCalledWith({
        TableName: TABLE_NAME,
      });
      assertDynamoDBTablePinnedForClient(fixture.db, {
        TableName: TABLE_NAME,
        TableArn: TABLE_ARN,
        TableId: TABLE_ID,
      });
    } finally {
      await fixture.db.close();
    }
    expect(fixture.rawDestroy).toHaveBeenCalledTimes(1);
  });

  test('routes every operation family through the pinned table ARN', async () => {
    const fixture = harness();
    try {
      await describeAndPin(fixture);
      const key = {
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: 'run-1',
        sortKeyName: 'sort_key',
        sortKeyValue: 'item-1',
      };
      const primary = {
        conditionType: 'EQUALS',
        keyType: 'PRIMARY',
        propertyName: 'run_id',
        propertyValue: 'run-1',
      };
      const sort = {
        conditionType: 'BEGINS_WITH',
        keyType: 'SORT',
        propertyName: 'sort_key',
        propertyValue: 'item-',
      };

      await fixture.db.query({
        tableName: TABLE_NAME,
        keyConditions: [primary],
      });
      await fixture.db.queryPage({
        tableName: TABLE_NAME,
        keyConditions: [primary, sort],
        limit: 1,
        consistentRead: true,
      });
      await fixture.db.put({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        sortKeyName: 'sort_key',
        record: { run_id: 'run-1', sort_key: 'item-1' },
      });
      await fixture.db.update({
        ...key,
        updates: [{ property: ['value'], propertyValue: 'updated' }],
      });
      await fixture.db.get(key);
      await fixture.db.remove(key);
      await fixture.db.batchWrite({
        tableName: TABLE_NAME,
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: { run_id: 'run-1', sort_key: 'item-2' },
          },
        ],
      });
      await fixture.db.transactionWrite({
        tableName: TABLE_NAME,
        conditionChecks: [
          {
            keyName: 'run_id',
            keyValue: 'run-1',
            sortKeyName: 'sort_key',
            sortKeyValue: 'item-3',
            conditions: [
              {
                conditionType: 'NOT_EXISTS',
                propertyName: 'missing',
              },
            ],
          },
        ],
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: { run_id: 'run-1', sort_key: 'item-4' },
          },
        ],
        updateRequests: [
          {
            keyName: 'run_id',
            keyValue: 'run-1',
            sortKeyName: 'sort_key',
            sortKeyValue: 'item-5',
            updates: [{ property: ['value'], propertyValue: 'updated' }],
          },
        ],
        deleteRequests: [
          {
            keyName: 'run_id',
            keyValue: 'run-1',
            sortKeyName: 'sort_key',
            sortKeyValue: 'item-6',
          },
        ],
      });

      expect(fixture.docClient.query).toHaveBeenCalledTimes(2);
      for (const [request] of fixture.docClient.query.mock.calls) {
        expect(request.TableName).toBe(TABLE_ARN);
      }
      expect(fixture.docClient.put.mock.calls[0][0].TableName).toBe(TABLE_ARN);
      expect(fixture.docClient.update.mock.calls[0][0].TableName).toBe(
        TABLE_ARN,
      );
      expect(fixture.docClient.get.mock.calls[0][0].TableName).toBe(TABLE_ARN);
      expect(fixture.docClient.delete.mock.calls[0][0].TableName).toBe(
        TABLE_ARN,
      );
      expect(
        Object.keys(fixture.docClient.batchWrite.mock.calls[0][0].RequestItems),
      ).toEqual([TABLE_ARN]);
      const transactionItems =
        fixture.docClient.transactWrite.mock.calls[0][0].TransactItems;
      expect(transactionItems).toHaveLength(4);
      for (const item of transactionItems) {
        const operation = Object.values(item)[0];
        expect(operation.TableName).toBe(TABLE_ARN);
      }
    } finally {
      await fixture.db.close();
    }
  });

  test('retains the pinned ARN across batch unprocessed-item retries', async () => {
    const fixture = harness();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await describeAndPin(fixture);
      const unprocessed = [
        { PutRequest: { Item: { run_id: 'run-1', sort_key: 'item-1' } } },
      ];
      fixture.docClient.batchWrite
        .mockResolvedValueOnce({
          UnprocessedItems: { [TABLE_ARN]: unprocessed },
        })
        .mockResolvedValueOnce({ UnprocessedItems: {} });

      await fixture.db.batchWrite({
        tableName: TABLE_NAME,
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: { run_id: 'run-1', sort_key: 'item-1' },
          },
        ],
      });

      expect(fixture.docClient.batchWrite).toHaveBeenCalledTimes(2);
      for (const [request] of fixture.docClient.batchWrite.mock.calls) {
        expect(Object.keys(request.RequestItems)).toEqual([TABLE_ARN]);
      }
      expect(
        fixture.docClient.batchWrite.mock.calls[1][0].RequestItems[TABLE_ARN],
      ).toBe(unprocessed);
    } finally {
      random.mockRestore();
      await fixture.db.close();
    }
  });

  test('fails closed on unexpected batch response table routing', async () => {
    const fixture = harness();
    try {
      await describeAndPin(fixture);
      fixture.docClient.batchWrite.mockResolvedValueOnce({
        UnprocessedItems: {
          [TABLE_NAME]: [
            {
              PutRequest: {
                Item: { run_id: 'run-1', sort_key: 'item-1' },
              },
            },
          ],
        },
      });

      await expect(
        fixture.db.batchWrite({
          tableName: TABLE_NAME,
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: { run_id: 'run-1', sort_key: 'item-1' },
            },
          ],
        }),
      ).rejects.toThrow(/unexpected table routing/u);
    } finally {
      await fixture.db.close();
    }
  });

  test('retains one pinned transaction request across conflict retries', async () => {
    const fixture = harness();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      await describeAndPin(fixture);
      const conflict = Object.assign(new Error('transaction conflict'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'TransactionConflict' }],
      });
      fixture.docClient.transactWrite
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({});

      await fixture.db.transactionWrite({
        tableName: TABLE_NAME,
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: { run_id: 'run-1', sort_key: 'item-1' },
          },
        ],
      });

      expect(fixture.docClient.transactWrite).toHaveBeenCalledTimes(2);
      expect(
        fixture.docClient.transactWrite.mock.calls[1][0].TransactItems,
      ).toBe(fixture.docClient.transactWrite.mock.calls[0][0].TransactItems);
      expect(
        fixture.docClient.transactWrite.mock.calls[0][0].TransactItems[0].Put
          .TableName,
      ).toBe(TABLE_ARN);
    } finally {
      random.mockRestore();
      await fixture.db.close();
    }
  });

  test('rejects certification after any unpinned logical-name operation', async () => {
    const fixture = harness();
    try {
      await fixture.db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: 'run-before-proof',
      });
      expect(fixture.docClient.get.mock.calls[0][0].TableName).toBe(TABLE_NAME);
      await expect(
        describeDynamoDBTableForClient(fixture.db, {
          TableName: TABLE_NAME,
        }),
      ).rejects.toThrow(/after unpinned use/u);
      expect(fixture.describeTable).not.toHaveBeenCalled();
    } finally {
      await fixture.db.close();
    }
  });

  test('blocks logical-name traffic while first topology validation is pending', async () => {
    const fixture = harness();
    let resolveDescription;
    fixture.describeTable.mockImplementationOnce(
      async () =>
        await new Promise((resolve) => {
          resolveDescription = resolve;
        }),
    );
    const input = Object.freeze({ TableName: TABLE_NAME });
    const pending = describeDynamoDBTableForClient(fixture.db, input);
    try {
      await expect(
        fixture.db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'run-1',
        }),
      ).rejects.toThrow(/topology validation has not completed/u);
      expect(fixture.docClient.get).not.toHaveBeenCalled();
      resolveDescription(fixture.response);
      const exact = await pending;
      pinDescribedDynamoDBTableForClient(fixture.db, input, exact);
      await fixture.db.get({
        tableName: TABLE_NAME,
        keyName: 'run_id',
        keyValue: 'run-1',
      });
      expect(fixture.docClient.get.mock.calls[0][0].TableName).toBe(TABLE_ARN);
    } finally {
      await fixture.db.close();
    }
  });

  test('poisons a first pin after a same-named foreign-account table is observed', async () => {
    const fixture = harness();
    const input = Object.freeze({ TableName: TABLE_NAME });
    try {
      await describeAndPin(fixture);
      const foreign = tableDescription(OTHER_TABLE_ARN);
      fixture.describeTable.mockResolvedValueOnce(foreign);
      const exact = await describeDynamoDBTableForClient(fixture.db, input);
      await expect(async () =>
        pinDescribedDynamoDBTableForClient(fixture.db, input, exact),
      ).rejects.toThrow(/different table resource/u);
      expect(fixture.describeTable.mock.calls.at(-1)[0].TableName).toBe(
        TABLE_ARN,
      );
      await expect(
        fixture.db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'run-1',
        }),
      ).rejects.toThrow(/topology validation failed/u);
      expect(fixture.docClient.get).not.toHaveBeenCalled();
      expect(() =>
        assertDynamoDBTablePinnedForClient(fixture.db, {
          TableName: TABLE_NAME,
          TableArn: TABLE_ARN,
          TableId: TABLE_ID,
        }),
      ).toThrow(/expected table resource/u);
    } finally {
      await fixture.db.close();
    }
  });

  test('poisons a first pin after the same ARN reports another table incarnation', async () => {
    const fixture = harness();
    const input = Object.freeze({ TableName: TABLE_NAME });
    try {
      await describeAndPin(fixture);
      const replacement = tableDescription(TABLE_ARN, OTHER_TABLE_ID);
      fixture.describeTable.mockResolvedValueOnce(replacement);
      const exact = await describeDynamoDBTableForClient(fixture.db, input);
      expect(() =>
        pinDescribedDynamoDBTableForClient(fixture.db, input, exact),
      ).toThrow(/different table resource/u);
      await expect(
        fixture.db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'run-1',
        }),
      ).rejects.toThrow(/topology validation failed/u);
      expect(fixture.docClient.get).not.toHaveBeenCalled();
      expect(() =>
        assertDynamoDBTablePinnedForClient(fixture.db, {
          TableName: TABLE_NAME,
          TableArn: TABLE_ARN,
          TableId: OTHER_TABLE_ID,
        }),
      ).toThrow(/expected table resource/u);
    } finally {
      await fixture.db.close();
    }
  });

  test('blocks traffic when revalidation observes an invalid table topology', async () => {
    const fixture = harness();
    try {
      await describeAndPin(fixture);
      fixture.describeTable.mockResolvedValueOnce(
        Object.freeze({
          Table: Object.freeze({
            ...fixture.response.Table,
            TableStatus: 'ACTIVE',
            AttributeDefinitions: Object.freeze([
              Object.freeze({ AttributeName: 'run_id', AttributeType: 'S' }),
              Object.freeze({
                AttributeName: 'sort_key',
                AttributeType: 'S',
              }),
            ]),
            KeySchema: Object.freeze([
              Object.freeze({ AttributeName: 'run_id', KeyType: 'HASH' }),
              Object.freeze({ AttributeName: 'sort_key', KeyType: 'RANGE' }),
            ]),
            Replicas: Object.freeze([
              Object.freeze({ RegionName: 'us-west-2' }),
            ]),
          }),
        }),
      );

      await expect(
        validateAwsDynamoDBCoordinatorAuthorityTableTopology({
          db: fixture.db,
          tableName: TABLE_NAME,
          region: REGION,
        }),
      ).rejects.toThrow(/topology is invalid/u);
      await expect(
        fixture.db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'run-1',
        }),
      ).rejects.toThrow(/topology validation has not completed/u);
      expect(fixture.docClient.get).not.toHaveBeenCalled();
    } finally {
      await fixture.db.close();
    }
  });

  test('rejects malformed descriptions and leaves unpinned traffic blocked', async () => {
    const fixture = harness();
    const malformed = tableDescription('not-an-arn');
    const input = Object.freeze({ TableName: TABLE_NAME });
    try {
      fixture.describeTable.mockResolvedValueOnce(malformed);
      const exact = await describeDynamoDBTableForClient(fixture.db, input);
      expect(() =>
        pinDescribedDynamoDBTableForClient(fixture.db, input, exact),
      ).toThrow(/exact retained DynamoDB table description/u);
      await expect(
        fixture.db.get({
          tableName: TABLE_NAME,
          keyName: 'run_id',
          keyValue: 'run-1',
        }),
      ).rejects.toThrow(/topology validation failed/u);
      expect(fixture.docClient.get).not.toHaveBeenCalled();
    } finally {
      await fixture.db.close();
    }
  });

  test('rejects branded copies, unrelated clients, and closed wrappers', async () => {
    const fixture = harness();
    const copied = { ...fixture.db };
    const input = Object.freeze({ TableName: TABLE_NAME });

    await expect(
      describeDynamoDBTableForClient(/** @type {any} */ (copied), input),
    ).rejects.toThrow(/exact open DynamoDB DB client/u);
    await expect(
      describeDynamoDBTableForClient(/** @type {any} */ ({}), input),
    ).rejects.toThrow(/exact open DynamoDB DB client/u);
    expect(() =>
      pinDescribedDynamoDBTableForClient(
        /** @type {any} */ (copied),
        input,
        fixture.response,
      ),
    ).toThrow(/exact open DynamoDB DB client/u);

    await describeAndPin(fixture);
    await fixture.db.close();
    expect(fixture.rawDestroy).toHaveBeenCalledTimes(1);
    await expect(
      describeDynamoDBTableForClient(fixture.db, input),
    ).rejects.toThrow(/exact open DynamoDB DB client/u);
    expect(() =>
      assertDynamoDBTablePinnedForClient(fixture.db, {
        TableName: TABLE_NAME,
        TableArn: TABLE_ARN,
        TableId: TABLE_ID,
      }),
    ).toThrow(/expected table resource/u);
  });

  test('narrows DescribeTable to one exact table name', async () => {
    const fixture = harness();
    let accessorInvoked = false;
    const accessorInput = {};
    Object.defineProperty(accessorInput, 'TableName', {
      enumerable: true,
      get() {
        accessorInvoked = true;
        return TABLE_NAME;
      },
    });
    try {
      await expect(
        describeDynamoDBTableForClient(
          fixture.db,
          /** @type {any} */ ({
            TableName: TABLE_NAME,
            ConsistentRead: true,
          }),
        ),
      ).rejects.toThrow(/one exact TableName/u);
      await expect(
        describeDynamoDBTableForClient(
          fixture.db,
          /** @type {any} */ ({ TableName: '' }),
        ),
      ).rejects.toThrow(/one exact TableName/u);
      await expect(
        describeDynamoDBTableForClient(fixture.db, accessorInput),
      ).rejects.toThrow(/one exact TableName/u);
      expect(accessorInvoked).toBe(false);
      expect(fixture.describeTable).not.toHaveBeenCalled();
    } finally {
      await fixture.db.close();
    }
  });
});
