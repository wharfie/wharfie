/* eslint-disable jest/no-hooks */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { applyAutoMocks } from '../../mocks/automocks.js';

await applyAutoMocks({
  projectRoot: process.cwd(),
  debug: true,
  stub: true,
});

// const AWS = await import('@aws-sdk/lib-dynamodb')
console.log('HELLLLLO');

process.env.QUERY_TABLE = 'query_table';

// const semaphore = await import('../../../lambdas/lib/dynamo/semaphore.js')
let update, get, _delete;

describe('dynamo semaphore db', () => {
  // beforeAll(() => {
  //   update = AWS.spyOn('DynamoDBDocument', 'update');
  //   get = AWS.spyOn('DynamoDBDocument', 'get');
  //   _delete = AWS.spyOn('DynamoDBDocument', 'delete');
  // });

  // afterAll(() => {
  //   AWS.clearAllMocks();
  // });

  it('increase', async () => {
    expect.assertions(2);

    update.mockResolvedValue({
      $response: {},
    });
    await semaphore.increase('semaphore_name');

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConditionExpression": "( attribute_not_exists(#limit) AND ( attribute_not_exists(#val) OR (#val <= :threshold AND #val >= :zero) ) ) OR ( attribute_exists(#limit)     AND ( attribute_not_exists(#val) OR (#val <= #limit     AND #val >= :zero) ) )",
          "ExpressionAttributeNames": {
            "#limit": "limit",
            "#val": "value",
          },
          "ExpressionAttributeValues": {
            ":incr": 1,
            ":threshold": 0,
            ":zero": 0,
          },
          "Key": {
            "semaphore": "semaphore_name",
          },
          "ReturnValues": "NONE",
          "TableName": "",
          "UpdateExpression": "SET #val = if_not_exists(#val, :zero) + :incr",
        },
      ]
    `);
  });

  it('release', async () => {
    expect.assertions(2);

    update.mockResolvedValue({
      $response: {},
    });
    await semaphore.release('semaphore_name');

    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[1]).toMatchInlineSnapshot(`
      [
        {
          "ConditionExpression": "attribute_not_exists(#val) OR #val > :zero",
          "ExpressionAttributeNames": {
            "#val": "value",
          },
          "ExpressionAttributeValues": {
            ":default": 1,
            ":incr": -1,
            ":zero": 0,
          },
          "Key": {
            "semaphore": "semaphore_name",
          },
          "ReturnValues": "NONE",
          "TableName": "",
          "UpdateExpression": "SET #val = if_not_exists(#val, :default) + :incr",
        },
      ]
    `);
  });

  it('deleteSemaphore', async () => {
    expect.assertions(6);

    _delete.mockResolvedValue(undefined);
    get.mockResolvedValue({
      Item: {
        value: 2,
      },
    });
    await semaphore.deleteSemaphore('semaphore_name');

    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "ConsistentRead": true,
          "Key": {
            "semaphore": "semaphore_name",
          },
          "TableName": "",
        },
      ]
    `);
    expect(update).toHaveBeenCalledTimes(4);
    expect(update.mock.calls[2]).toMatchInlineSnapshot(`
      [
        {
          "ConditionExpression": "attribute_not_exists(#val) OR #val > :zero",
          "ExpressionAttributeNames": {
            "#val": "value",
          },
          "ExpressionAttributeValues": {
            ":default": 1,
            ":incr": -1,
            ":zero": 0,
          },
          "Key": {
            "semaphore": "wharfie",
          },
          "ReturnValues": "NONE",
          "TableName": "",
          "UpdateExpression": "SET #val = if_not_exists(#val, :default) + :incr",
        },
      ]
    `);
    expect(_delete).toHaveBeenCalledTimes(1);
    expect(_delete.mock.calls[0]).toMatchInlineSnapshot(`
      [
        {
          "Key": {
            "semaphore": "semaphore_name",
          },
          "TableName": "",
        },
      ]
    `);
  });
});
