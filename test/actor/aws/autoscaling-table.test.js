/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';
jest.mock('../../../lambdas/lib/db/state/aws');
jest.mock('../../../lambdas/lib/id');
const {
  AutoscalingTable,
} = require('../../../lambdas/lib/actor/resources/aws/');
const Reconcilable = require('../../../lambdas/lib/actor/resources/reconcilable');

const { load } = require('../../../lambdas/lib/actor/deserialize/full');
const { getMockDeploymentProperties } = require('../util');

describe('autoscaling table IaC', () => {
  it('basic', async () => {
    expect.assertions(8);
    const state_db = require('../../../lambdas/lib/db/state/aws');
    const events = [];
    Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
      events.push(`${event.status} - ${event.constructor}:${event.name}`);
    });
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
    events.push('RECONCILING');
    await autoscalingTable.reconcile();
    const reconciled_state = state_db.__getMockState();
    expect(reconciled_state).toMatchInlineSnapshot(`
      {
        "test-deployment": {
          "test-table": {
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
          "test-table#table-name": {
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
          "test-table#table-name-autoscaling-role": {
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
              "roleName": "table-name-autoscaling-role",
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
          "test-table#table-name-readAutoscalingPolicy": {
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
          "test-table#table-name-readAutoscalingTarget": {
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
          "test-table#table-name-writeAutoscalingPolicy": {
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
          "test-table#table-name-writeAutoscalingTarget": {
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
        },
      }
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
    events.push('LOADING');
    const deserialized = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-table',
    });
    await deserialized.reconcile();
    expect(state_db.__getMockState()).toStrictEqual(reconciled_state);
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

    events.push('DESTROYING');
    await deserialized.destroy();
    expect(state_db.__getMockState()).toMatchInlineSnapshot(`
      {
        "test-deployment": {},
      }
    `);
    expect(deserialized.status).toBe('DESTROYED');
    expect(events).toMatchInlineSnapshot(`
      [
        "UNPROVISIONED - AutoscalingTable:test-table",
        "UNPROVISIONED - Table:table-name",
        "UNPROVISIONED - Role:table-name-autoscaling-role",
        "UNPROVISIONED - AutoscalingTarget:table-name-readAutoscalingTarget",
        "UNPROVISIONED - AutoscalingPolicy:table-name-readAutoscalingPolicy",
        "UNPROVISIONED - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "UNPROVISIONED - AutoscalingPolicy:table-name-writeAutoscalingPolicy",
        "RECONCILING",
        "RECONCILING - AutoscalingTable:test-table",
        "RECONCILING - Table:table-name",
        "RECONCILING - Role:table-name-autoscaling-role",
        "RECONCILING - AutoscalingTarget:table-name-readAutoscalingTarget",
        "RECONCILING - AutoscalingPolicy:table-name-readAutoscalingPolicy",
        "RECONCILING - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "RECONCILING - AutoscalingPolicy:table-name-writeAutoscalingPolicy",
        "DRIFTED - Table:table-name",
        "STABLE - Table:table-name",
        "DRIFTED - Role:table-name-autoscaling-role",
        "STABLE - Role:table-name-autoscaling-role",
        "DRIFTED - AutoscalingTarget:table-name-readAutoscalingTarget",
        "STABLE - AutoscalingTarget:table-name-readAutoscalingTarget",
        "STABLE - AutoscalingPolicy:table-name-readAutoscalingPolicy",
        "DRIFTED - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "STABLE - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "STABLE - AutoscalingPolicy:table-name-writeAutoscalingPolicy",
        "STABLE - AutoscalingTable:test-table",
        "LOADING",
        "STABLE - Table:table-name",
        "STABLE - Role:table-name-autoscaling-role",
        "STABLE - AutoscalingTarget:table-name-readAutoscalingTarget",
        "STABLE - AutoscalingPolicy:table-name-readAutoscalingPolicy",
        "STABLE - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "STABLE - AutoscalingPolicy:table-name-writeAutoscalingPolicy",
        "STABLE - AutoscalingTable:test-table",
        "DESTROYING",
        "DESTROYING - AutoscalingTable:test-table",
        "DESTROYING - Table:table-name",
        "DESTROYING - Role:table-name-autoscaling-role",
        "DESTROYING - AutoscalingTarget:table-name-readAutoscalingTarget",
        "DESTROYING - AutoscalingPolicy:table-name-readAutoscalingPolicy",
        "DESTROYING - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "DESTROYING - AutoscalingPolicy:table-name-writeAutoscalingPolicy",
        "DESTROYED - AutoscalingTarget:table-name-readAutoscalingTarget",
        "DESTROYED - AutoscalingPolicy:table-name-readAutoscalingPolicy",
        "DESTROYED - AutoscalingTarget:table-name-writeAutoscalingTarget",
        "DESTROYED - AutoscalingPolicy:table-name-writeAutoscalingPolicy",
        "DESTROYED - Table:table-name",
        "DESTROYED - Role:table-name-autoscaling-role",
        "DESTROYED - AutoscalingTable:test-table",
      ]
    `);
  });
});
