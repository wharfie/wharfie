/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Table } = require('../../../lambdas/lib/actor/resources/aws/');
const { DynamoDB } = jest.requireMock('@aws-sdk/client-dynamodb');

const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('table IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const dynamoDB = new DynamoDB({});
    const table = new Table({
      name: 'test-table',
      properties: {
        attributeDefinitions: [
          {
            AttributeName: 'semaphore',
            AttributeType: 'S',
          },
        ],
        keySchema: [
          {
            AttributeName: 'semaphore',
            KeyType: 'HASH',
          },
        ],
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    });
    await table.reconcile();

    const serialized = table.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-table",
        "properties": {
          "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-table",
          "attributeDefinitions": [
            {
              "AttributeName": "semaphore",
              "AttributeType": "S",
            },
          ],
          "billingMode": "PROVISIONED",
          "keySchema": [
            {
              "AttributeName": "semaphore",
              "KeyType": "HASH",
            },
          ],
          "provisionedThroughput": {
            "ReadCapacityUnits": 5,
            "WriteCapacityUnits": 5,
          },
        },
        "resourceType": "Table",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      Table {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "dynamo": DynamoDB {
          "dynamodb": DynamoDBMock {},
        },
        "dynamoDocument": {
          "batchWrite": [MockFunction],
          "delete": [MockFunction],
          "get": [MockFunction],
          "put": [MockFunction],
          "query": [MockFunction],
          "update": [MockFunction],
        },
        "name": "test-table",
        "properties": {
          "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-table",
          "attributeDefinitions": [
            {
              "AttributeName": "semaphore",
              "AttributeType": "S",
            },
          ],
          "billingMode": "PROVISIONED",
          "keySchema": [
            {
              "AttributeName": "semaphore",
              "KeyType": "HASH",
            },
          ],
          "provisionedThroughput": {
            "ReadCapacityUnits": 5,
            "WriteCapacityUnits": 5,
          },
        },
        "resourceType": "Table",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await dynamoDB.describeTable({
      TableName: table.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Table": {
          "AttributeDefinitions": [
            {
              "AttributeName": "semaphore",
              "AttributeType": "S",
            },
          ],
          "BillingMode": "PROVISIONED",
          "KeySchema": [
            {
              "AttributeName": "semaphore",
              "KeyType": "HASH",
            },
          ],
          "ProvisionedThroughput": {
            "ReadCapacityUnits": 5,
            "WriteCapacityUnits": 5,
          },
          "TableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-table",
          "TableName": "test-table",
          "TableStatus": "ACTIVE",
        },
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      dynamoDB.describeTable({ TableName: table.name })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Requested resource not found"`
    );
  });
});
