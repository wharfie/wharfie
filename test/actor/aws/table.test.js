/* eslint-disable jest/no-large-snapshots */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = true;
const { Table } = require('../../../lambdas/lib/actor/resources/aws/');
const { DynamoDB } = jest.requireMock('@aws-sdk/client-dynamodb');
const { getMockDeploymentProperties } = require('../util');

describe('table IaC', () => {
  it('basic', async () => {
    expect.assertions(4);

    const dynamoDB = new DynamoDB({});
    const table = new Table({
      name: 'test-table',
      properties: {
        deployment: getMockDeploymentProperties(),
        tags: [
          {
            Key: 'test-key',
            Value: 'test-value',
          },
        ],
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
        "parent": "",
        "properties": {
          "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-table",
          "attributeDefinitions": [
            {
              "AttributeName": "semaphore",
              "AttributeType": "S",
            },
          ],
          "billingMode": "PROVISIONED",
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
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
          "tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
        "resourceType": "Table",
        "status": "STABLE",
      }
    `);

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
          "Tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
      }
    `);

    await table.destroy();

    expect(table.status).toBe('DESTROYED');
    await expect(
      dynamoDB.describeTable({ TableName: table.name })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Requested resource not found"`
    );
  });
});
