/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/lib-dynamodb');

process.env.COUNTER_TABLE = 'counter_table';
process.env.QUERY_TABLE = 'query_table';

const counter = require('../../../lambdas/lib/dynamo/counter');

let update, query, batchWrite;

describe('dynamo counter db', () => {
  beforeAll(() => {
    update = AWS.spyOn('DynamoDBDocument', 'update');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    batchWrite = AWS.spyOn('DynamoDBDocument', 'batchWrite');
  });

  afterAll(() => {
    AWS.clearAllMocks();
  });
  it('increment', async () => {
    expect.assertions(2);
    update.mockResolvedValue({
      $response: {},
    });
    await counter.increment('counter_name', 1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConditionExpression": "attribute_not_exists(#val) OR (#val > :zero AND :incr = :negative_one) OR (#val >= :zero AND :incr = :one)",
          "ExpressionAttributeNames": Object {
            "#val": "value",
          },
          "ExpressionAttributeValues": Object {
            ":default": 0,
            ":incr": 1,
            ":negative_one": -1,
            ":one": 1,
            ":zero": 0,
          },
          "Key": Object {
            "counter": "counter_name",
            "stack_name": "",
          },
          "ReturnValues": "NONE",
          "TableName": "counter_table",
          "UpdateExpression": "SET #val = if_not_exists(#val, :default) + :incr",
        },
      ]
    `);
  });

  it('incrementReturnUpdated', async () => {
    expect.assertions(3);
    update.mockResolvedValue({
      $response: {},
      Attributes: {
        value: 12,
      },
    });
    const result = await counter.incrementReturnUpdated('counter_name', 1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(result).toMatchInlineSnapshot(`12`);
    expect(update.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConditionExpression": "attribute_not_exists(#val) OR (#val > :zero AND :incr = :negative_one) OR (#val >= :zero AND :incr = :one)",
          "ExpressionAttributeNames": Object {
            "#val": "value",
          },
          "ExpressionAttributeValues": Object {
            ":default": 0,
            ":incr": 1,
            ":negative_one": -1,
            ":one": 1,
            ":zero": 0,
          },
          "Key": Object {
            "counter": "counter_name",
            "stack_name": "",
          },
          "ReturnValues": "UPDATED_NEW",
          "TableName": "counter_table",
          "UpdateExpression": "SET #val = if_not_exists(#val, :default) + :incr",
        },
      ]
    `);
  });

  it('deleteCountersByPrefix', async () => {
    expect.assertions(4);
    query.mockResolvedValue({
      Items: [
        {
          counter: 'counter_name_1',
        },
        {
          counter: 'counter_name_2',
        },
      ],
    });
    batchWrite.mockResolvedValue({ Item: { value: 10 } });
    await counter.deleteCountersByPrefix('semaphore_');
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeNames": Object {
            "#counter": "counter",
          },
          "ExpressionAttributeValues": Object {
            ":prefix": "semaphore_",
            ":stack_name": "",
          },
          "KeyConditionExpression": "stack_name = :stack_name AND begins_with(#counter, :prefix)",
          "ProjectionExpression": "#counter",
          "TableName": "counter_table",
        },
      ]
    `);
    expect(batchWrite).toHaveBeenCalledTimes(1);
    expect(batchWrite.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "RequestItems": Object {
            "counter_table": Array [
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "counter": "counter_name_1",
                    "stack_name": "",
                  },
                },
              },
              Object {
                "DeleteRequest": Object {
                  "Key": Object {
                    "counter": "counter_name_2",
                    "stack_name": "",
                  },
                },
              },
            ],
          },
        },
      ]
    `);
  });
});
