/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/lib-dynamodb');

process.env.LOCATION_TABLE = 'location_table';
const location = require('../../../lambdas/lib/dynamo/location');

let query, _delete, put;

describe('dynamo location db', () => {
  beforeAll(() => {
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    _delete = AWS.spyOn('DynamoDBDocument', 'delete');
  });

  afterAll(() => {
    AWS.clearAllMocks();
  });

  it('putLocation', async () => {
    expect.assertions(2);
    put.mockResolvedValue({
      $response: {},
    });
    await location.putLocation({
      resource_id: 'resource_id',
      location: 's3://somebucket/prefix/',
    });
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Item": Object {
            "interval": "300",
            "location": "s3://somebucket/prefix/",
            "resource_id": "resource_id",
          },
          "ReturnValues": "NONE",
          "TableName": "location_table",
        },
      ]
    `);
  });

  it('findLocations', async () => {
    expect.assertions(5);
    query
      .mockResolvedValueOnce({
        Items: [],
      })
      .mockResolvedValueOnce({
        Items: [],
      })
      .mockResolvedValueOnce({
        Items: [
          {
            resource_id: 'resource-123',
            location: 's3://some_bucket/prefix/',
          },
        ],
      });
    const result = await location.findLocations(
      's3://some_bucket/prefix/partion=a/a_key.json'
    );
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeNames": Object {
            "#location": "location",
          },
          "ExpressionAttributeValues": Object {
            ":location": "s3://some_bucket/prefix/partion=a/a_key.json",
          },
          "KeyConditionExpression": "#location = :location",
          "TableName": "location_table",
        },
      ]
    `);
    expect(query.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeNames": Object {
            "#location": "location",
          },
          "ExpressionAttributeValues": Object {
            ":location": "s3://some_bucket/prefix/partion=a/",
          },
          "KeyConditionExpression": "#location = :location",
          "TableName": "location_table",
        },
      ]
    `);
    expect(query.mock.calls[2]).toMatchInlineSnapshot(`
      Array [
        Object {
          "ConsistentRead": true,
          "ExpressionAttributeNames": Object {
            "#location": "location",
          },
          "ExpressionAttributeValues": Object {
            ":location": "s3://some_bucket/prefix/",
          },
          "KeyConditionExpression": "#location = :location",
          "TableName": "location_table",
        },
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      Array [
        Object {
          "interval": "300",
          "location": "s3://some_bucket/prefix/",
          "resource_id": "resource-123",
        },
      ]
    `);
  });

  it('deleteLocation', async () => {
    expect.assertions(2);
    _delete.mockResolvedValue({
      $response: {},
    });
    await location.deleteLocation({
      resource_id: 'resource_id',
      location: 's3://somebucket/prefix/',
    });
    expect(_delete).toHaveBeenCalledTimes(1);
    expect(_delete.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Key": Object {
            "location": "s3://somebucket/prefix/",
            "resource_id": "resource_id",
          },
          "TableName": "location_table",
        },
      ]
    `);
  });
});
