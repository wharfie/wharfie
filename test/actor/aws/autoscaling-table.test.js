/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';
const {
  AutoscalingTable,
} = require('../../../lambdas/lib/actor/resources/aws/');
const Reconcilable = require('../../../lambdas/lib/actor/resources/reconcilable');

const AWS = require('@aws-sdk/lib-dynamodb');
let query, _delete, put, update;

const { load } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');

describe('autoscaling table IaC', () => {
  beforeAll(() => {
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    _delete = AWS.spyOn('DynamoDBDocument', 'delete');
    update = AWS.spyOn('DynamoDBDocument', 'update');
  });

  afterAll(() => {
    AWS.clearAllMocks();
  });

  it('basic', async () => {
    expect.assertions(12);
    const autoscalingTable = new AutoscalingTable({
      name: 'test-table',
      properties: {
        deployment: getMockDeploymentProperties(),
        tableName: `table-name`,
        minReadCapacity: 5,
        maxReadCapacity: 100,
        minWriteCapacity: 1,
        maxWriteCapacity: 50,
        attributeDefinitions: [
          {
            AttributeName: 'location',
            AttributeType: 'S',
          },
          { AttributeName: 'resource_id', AttributeType: 'S' },
        ],
        keySchema: [
          {
            AttributeName: 'location',
            KeyType: 'HASH',
          },
          { AttributeName: 'resource_id', KeyType: 'RANGE' },
        ],
        provisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5,
        },
      },
    });
    await autoscalingTable.reconcile();

    const reconcilingStatusUpdate = update.mock.calls;

    const stableStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
      .map(([{ Item }]) => Item);

    expect(reconcilingStatusUpdate).toHaveLength(7);
    update.mock.calls = [];
    expect(stableStatusUpdate).toHaveLength(7);
    expect(stableStatusUpdate).toMatchInlineSnapshot(`
      [
        {
          "deployment": "test-deployment",
          "resource_key": "test-table#table-name",
          "serialized": {
            "dependsOn": [],
            "name": "table-name",
            "parent": "test-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": undefined,
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/table-name",
              "attributeDefinitions": [
                {
                  "AttributeName": "location",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "resource_id",
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
                  "AttributeName": "location",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "resource_id",
                  "KeyType": "RANGE",
                },
              ],
              "provisionedThroughput": {
                "ReadCapacityUnits": 5,
                "WriteCapacityUnits": 5,
              },
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
        {
          "deployment": "test-deployment",
          "resource_key": "test-table#table-name-autoscaling-role",
          "serialized": {
            "dependsOn": [
              "table-name",
            ],
            "name": "table-name-autoscaling-role",
            "parent": "test-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": undefined,
              "arn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": [
                        "application-autoscaling.amazonaws.com",
                      ],
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
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
              "description": "Role for table-name table autoscaling",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "dynamodb:DescribeTable",
                      "dynamodb:UpdateTable",
                    ],
                    "Effect": "Allow",
                    "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/table-name",
                  },
                  {
                    "Action": [
                      "cloudwatch:PutMetricAlarm",
                      "cloudwatch:DescribeAlarms",
                      "cloudwatch:GetMetricStatistics",
                      "cloudwatch:SetAlarmState",
                      "cloudwatch:DeleteAlarms",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
        {
          "deployment": "test-deployment",
          "resource_key": "test-table#table-name-readAutoscalingTarget",
          "serialized": {
            "dependsOn": [
              "table-name-autoscaling-role",
            ],
            "name": "table-name-readAutoscalingTarget",
            "parent": "test-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": undefined,
              "arn": "arn:aws:autoscaling:dynamodb:dynamodb:table:ReadCapacityUnits:target/table/table-name",
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
              "maxCapacity": 100,
              "minCapacity": 5,
              "resourceId": "table/table-name",
              "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "scalableDimension": "dynamodb:table:ReadCapacityUnits",
              "serviceNamespace": "dynamodb",
              "tags": {},
            },
            "resourceType": "AutoscalingTarget",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
        {
          "deployment": "test-deployment",
          "resource_key": "test-table#table-name-readAutoscalingPolicy",
          "serialized": {
            "dependsOn": [
              "table-name-readAutoscalingTarget",
            ],
            "name": "table-name-readAutoscalingPolicy",
            "parent": "test-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": undefined,
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
              "policyType": "TargetTrackingScaling",
              "resourceId": "table/table-name",
              "scalableDimension": "dynamodb:table:ReadCapacityUnits",
              "serviceNamespace": "dynamodb",
              "targetTrackingScalingPolicyConfiguration": {
                "PredefinedMetricSpecification": {
                  "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                },
                "ScaleInCooldown": 0,
                "ScaleOutCooldown": 0,
                "TargetValue": 70,
              },
            },
            "resourceType": "AutoscalingPolicy",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
        {
          "deployment": "test-deployment",
          "resource_key": "test-table#table-name-writeAutoscalingTarget",
          "serialized": {
            "dependsOn": [
              "table-name-autoscaling-role",
            ],
            "name": "table-name-writeAutoscalingTarget",
            "parent": "test-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": undefined,
              "arn": "arn:aws:autoscaling:dynamodb:dynamodb:table:WriteCapacityUnits:target/table/table-name",
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
              "maxCapacity": 50,
              "minCapacity": 1,
              "resourceId": "table/table-name",
              "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "scalableDimension": "dynamodb:table:WriteCapacityUnits",
              "serviceNamespace": "dynamodb",
              "tags": {},
            },
            "resourceType": "AutoscalingTarget",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
        {
          "deployment": "test-deployment",
          "resource_key": "test-table#table-name-writeAutoscalingPolicy",
          "serialized": {
            "dependsOn": [
              "table-name-writeAutoscalingTarget",
            ],
            "name": "table-name-writeAutoscalingPolicy",
            "parent": "test-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": undefined,
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
              "policyType": "TargetTrackingScaling",
              "resourceId": "table/table-name",
              "scalableDimension": "dynamodb:table:WriteCapacityUnits",
              "serviceNamespace": "dynamodb",
              "targetTrackingScalingPolicyConfiguration": {
                "PredefinedMetricSpecification": {
                  "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                },
                "ScaleInCooldown": 0,
                "ScaleOutCooldown": 0,
                "TargetValue": 70,
              },
            },
            "resourceType": "AutoscalingPolicy",
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
        {
          "deployment": "test-deployment",
          "resource_key": "test-table",
          "serialized": {
            "dependsOn": [],
            "name": "test-table",
            "parent": "",
            "properties": {
              "attributeDefinitions": [
                {
                  "AttributeName": "location",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "resource_id",
                  "AttributeType": "S",
                },
              ],
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
                  "AttributeName": "location",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "resource_id",
                  "KeyType": "RANGE",
                },
              ],
              "maxReadCapacity": 100,
              "maxWriteCapacity": 50,
              "minReadCapacity": 5,
              "minWriteCapacity": 1,
              "provisionedThroughput": {
                "ReadCapacityUnits": 5,
                "WriteCapacityUnits": 5,
              },
              "tableName": "table-name",
            },
            "resourceType": "AutoscalingTable",
            "resources": [
              "table-name",
              "table-name-autoscaling-role",
              "table-name-readAutoscalingTarget",
              "table-name-readAutoscalingPolicy",
              "table-name-writeAutoscalingTarget",
              "table-name-writeAutoscalingPolicy",
            ],
            "status": "STABLE",
          },
          "status": "STABLE",
          "version": "0.0.1test",
        },
      ]
    `);

    const serialized = autoscalingTable.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-table",
        "parent": "",
        "properties": {
          "attributeDefinitions": [
            {
              "AttributeName": "location",
              "AttributeType": "S",
            },
            {
              "AttributeName": "resource_id",
              "AttributeType": "S",
            },
          ],
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
              "AttributeName": "location",
              "KeyType": "HASH",
            },
            {
              "AttributeName": "resource_id",
              "KeyType": "RANGE",
            },
          ],
          "maxReadCapacity": 100,
          "maxWriteCapacity": 50,
          "minReadCapacity": 5,
          "minWriteCapacity": 1,
          "provisionedThroughput": {
            "ReadCapacityUnits": 5,
            "WriteCapacityUnits": 5,
          },
          "tableName": "table-name",
        },
        "resourceType": "AutoscalingTable",
        "resources": [
          "table-name",
          "table-name-autoscaling-role",
          "table-name-readAutoscalingTarget",
          "table-name-readAutoscalingPolicy",
          "table-name-writeAutoscalingTarget",
          "table-name-writeAutoscalingPolicy",
        ],
        "status": "STABLE",
      }
    `);
    query.mockResolvedValueOnce({
      Items: put.mock.calls
        .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
        .map((call) => call[0].Item),
    });
    const deserialized = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-table',
    });
    await deserialized.reconcile();
    expect(deserialized.resolveProperties()).toMatchInlineSnapshot(`
      {
        "attributeDefinitions": [
          {
            "AttributeName": "location",
            "AttributeType": "S",
          },
          {
            "AttributeName": "resource_id",
            "AttributeType": "S",
          },
        ],
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
            "AttributeName": "location",
            "KeyType": "HASH",
          },
          {
            "AttributeName": "resource_id",
            "KeyType": "RANGE",
          },
        ],
        "maxReadCapacity": 100,
        "maxWriteCapacity": 50,
        "minReadCapacity": 5,
        "minWriteCapacity": 1,
        "provisionedThroughput": {
          "ReadCapacityUnits": 5,
          "WriteCapacityUnits": 5,
        },
        "tableName": "table-name",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');

    const destroyingStatusUpdate = update.mock.calls;

    const destroyedStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYED)
      .map(([{ Item }]) => Item);

    expect(destroyingStatusUpdate).toHaveLength(7);
    expect(destroyedStatusUpdate).toHaveLength(0);

    expect(put).toHaveBeenCalledTimes(7);
    expect(_delete).toHaveBeenCalledTimes(7);
    expect(_delete.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table#table-name-readAutoscalingTarget",
            },
            "TableName": "_testing_state_table",
          },
        ],
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table#table-name-readAutoscalingPolicy",
            },
            "TableName": "_testing_state_table",
          },
        ],
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table#table-name-writeAutoscalingTarget",
            },
            "TableName": "_testing_state_table",
          },
        ],
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table#table-name-writeAutoscalingPolicy",
            },
            "TableName": "_testing_state_table",
          },
        ],
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table#table-name",
            },
            "TableName": "_testing_state_table",
          },
        ],
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table#table-name-autoscaling-role",
            },
            "TableName": "_testing_state_table",
          },
        ],
        [
          {
            "Key": {
              "deployment": "test-deployment",
              "resource_key": "test-table",
            },
            "TableName": "_testing_state_table",
          },
        ],
      ]
    `);
  });
});
