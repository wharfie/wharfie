/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
const {
  AutoscalingTable,
} = require('../../../lambdas/lib/actor/resources/aws/');

const { deserialize } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');

describe('autoscaling table IaC', () => {
  it('basic', async () => {
    expect.assertions(4);
    const autoscalingTable = new AutoscalingTable({
      name: 'test-rule',
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

    const serialized = autoscalingTable.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-rule",
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
        "resources": {
          "table-name": {
            "dependsOn": [],
            "name": "table-name",
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
          "table-name-autoscaling-role": {
            "dependsOn": [
              "table-name",
            ],
            "name": "table-name-autoscaling-role",
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
          "table-name-readAutoscalingPolicy": {
            "dependsOn": [
              "table-name-readAutoscalingTarget",
            ],
            "name": "table-name-readAutoscalingPolicy",
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
          "table-name-readAutoscalingTarget": {
            "dependsOn": [
              "table-name-autoscaling-role",
            ],
            "name": "table-name-readAutoscalingTarget",
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
              "maxCapacity": 100,
              "minCapacity": 5,
              "resourceId": "table/table-name",
              "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "scalableDimension": "dynamodb:table:ReadCapacityUnits",
              "serviceNamespace": "dynamodb",
            },
            "resourceType": "AutoscalingTarget",
            "status": "STABLE",
          },
          "table-name-writeAutoscalingPolicy": {
            "dependsOn": [
              "table-name-writeAutoscalingTarget",
            ],
            "name": "table-name-writeAutoscalingPolicy",
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
          "table-name-writeAutoscalingTarget": {
            "dependsOn": [
              "table-name-autoscaling-role",
            ],
            "name": "table-name-writeAutoscalingTarget",
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
              "maxCapacity": 50,
              "minCapacity": 1,
              "resourceId": "table/table-name",
              "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "scalableDimension": "dynamodb:table:WriteCapacityUnits",
              "serviceNamespace": "dynamodb",
            },
            "resourceType": "AutoscalingTarget",
            "status": "STABLE",
          },
        },
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      AutoscalingTable {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "name": "test-rule",
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
        "resources": {
          "table-name": Table {
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
              "put": [MockFunction] {
                "calls": [
                  [
                    {
                      "Item": {
                        "name": "test-rule",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-autoscaling-role",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-readAutoscalingTarget",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-readAutoscalingPolicy",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-writeAutoscalingTarget",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-writeAutoscalingPolicy",
                        "sort_key": "test-deployment",
                        "status": "RECONCILING",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-autoscaling-role",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-readAutoscalingTarget",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-readAutoscalingPolicy",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-writeAutoscalingTarget",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "table-name-writeAutoscalingPolicy",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                  [
                    {
                      "Item": {
                        "name": "test-rule",
                        "sort_key": "test-deployment",
                        "status": "STABLE",
                        "version": "0.0.1test",
                      },
                      "ReturnValues": "NONE",
                      "TableName": "_testing_state_table",
                    },
                  ],
                ],
                "results": [
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                  {
                    "type": "return",
                    "value": undefined,
                  },
                ],
              },
              "query": [MockFunction],
              "update": [MockFunction],
            },
            "name": "table-name",
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
          "table-name-autoscaling-role": Role {
            "_MAX_RETRIES": 10,
            "_MAX_RETRY_TIMEOUT_SECONDS": 10,
            "_destroyErrors": [],
            "_reconcileErrors": [],
            "dependsOn": [
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
                  "put": [MockFunction] {
                    "calls": [
                      [
                        {
                          "Item": {
                            "name": "test-rule",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-autoscaling-role",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-readAutoscalingTarget",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-readAutoscalingPolicy",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-writeAutoscalingTarget",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-writeAutoscalingPolicy",
                            "sort_key": "test-deployment",
                            "status": "RECONCILING",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-autoscaling-role",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-readAutoscalingTarget",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-readAutoscalingPolicy",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-writeAutoscalingTarget",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "table-name-writeAutoscalingPolicy",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                      [
                        {
                          "Item": {
                            "name": "test-rule",
                            "sort_key": "test-deployment",
                            "status": "STABLE",
                            "version": "0.0.1test",
                          },
                          "ReturnValues": "NONE",
                          "TableName": "_testing_state_table",
                        },
                      ],
                    ],
                    "results": [
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                      {
                        "type": "return",
                        "value": undefined,
                      },
                    ],
                  },
                  "query": [MockFunction],
                  "update": [MockFunction],
                },
                "name": "table-name",
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
            ],
            "iam": IAM {
              "iam": IAMMock {},
            },
            "name": "table-name-autoscaling-role",
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
          "table-name-readAutoscalingPolicy": AutoscalingPolicy {
            "_MAX_RETRIES": 10,
            "_MAX_RETRY_TIMEOUT_SECONDS": 10,
            "_destroyErrors": [],
            "_reconcileErrors": [],
            "autoscaling": ApplicationAutoScaling {
              "autoscaling": ApplicationAutoScalingMock {},
            },
            "dependsOn": [
              AutoscalingTarget {
                "_MAX_RETRIES": 10,
                "_MAX_RETRY_TIMEOUT_SECONDS": 10,
                "_destroyErrors": [],
                "_reconcileErrors": [],
                "autoscaling": ApplicationAutoScaling {
                  "autoscaling": ApplicationAutoScalingMock {},
                },
                "dependsOn": [
                  Role {
                    "_MAX_RETRIES": 10,
                    "_MAX_RETRY_TIMEOUT_SECONDS": 10,
                    "_destroyErrors": [],
                    "_reconcileErrors": [],
                    "dependsOn": [
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
                          "put": [MockFunction] {
                            "calls": [
                              [
                                {
                                  "Item": {
                                    "name": "test-rule",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-autoscaling-role",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-autoscaling-role",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "test-rule",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                            ],
                            "results": [
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                            ],
                          },
                          "query": [MockFunction],
                          "update": [MockFunction],
                        },
                        "name": "table-name",
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
                    ],
                    "iam": IAM {
                      "iam": IAMMock {},
                    },
                    "name": "table-name-autoscaling-role",
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
                ],
                "name": "table-name-readAutoscalingTarget",
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
                  "maxCapacity": 100,
                  "minCapacity": 5,
                  "resourceId": "table/table-name",
                  "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
                  "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                  "serviceNamespace": "dynamodb",
                },
                "resourceType": "AutoscalingTarget",
                "status": "STABLE",
              },
            ],
            "name": "table-name-readAutoscalingPolicy",
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
          "table-name-readAutoscalingTarget": AutoscalingTarget {
            "_MAX_RETRIES": 10,
            "_MAX_RETRY_TIMEOUT_SECONDS": 10,
            "_destroyErrors": [],
            "_reconcileErrors": [],
            "autoscaling": ApplicationAutoScaling {
              "autoscaling": ApplicationAutoScalingMock {},
            },
            "dependsOn": [
              Role {
                "_MAX_RETRIES": 10,
                "_MAX_RETRY_TIMEOUT_SECONDS": 10,
                "_destroyErrors": [],
                "_reconcileErrors": [],
                "dependsOn": [
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
                      "put": [MockFunction] {
                        "calls": [
                          [
                            {
                              "Item": {
                                "name": "test-rule",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-autoscaling-role",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-autoscaling-role",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "test-rule",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                        ],
                        "results": [
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                        ],
                      },
                      "query": [MockFunction],
                      "update": [MockFunction],
                    },
                    "name": "table-name",
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
                ],
                "iam": IAM {
                  "iam": IAMMock {},
                },
                "name": "table-name-autoscaling-role",
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
            ],
            "name": "table-name-readAutoscalingTarget",
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
              "maxCapacity": 100,
              "minCapacity": 5,
              "resourceId": "table/table-name",
              "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "scalableDimension": "dynamodb:table:ReadCapacityUnits",
              "serviceNamespace": "dynamodb",
            },
            "resourceType": "AutoscalingTarget",
            "status": "STABLE",
          },
          "table-name-writeAutoscalingPolicy": AutoscalingPolicy {
            "_MAX_RETRIES": 10,
            "_MAX_RETRY_TIMEOUT_SECONDS": 10,
            "_destroyErrors": [],
            "_reconcileErrors": [],
            "autoscaling": ApplicationAutoScaling {
              "autoscaling": ApplicationAutoScalingMock {},
            },
            "dependsOn": [
              AutoscalingTarget {
                "_MAX_RETRIES": 10,
                "_MAX_RETRY_TIMEOUT_SECONDS": 10,
                "_destroyErrors": [],
                "_reconcileErrors": [],
                "autoscaling": ApplicationAutoScaling {
                  "autoscaling": ApplicationAutoScalingMock {},
                },
                "dependsOn": [
                  Role {
                    "_MAX_RETRIES": 10,
                    "_MAX_RETRY_TIMEOUT_SECONDS": 10,
                    "_destroyErrors": [],
                    "_reconcileErrors": [],
                    "dependsOn": [
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
                          "put": [MockFunction] {
                            "calls": [
                              [
                                {
                                  "Item": {
                                    "name": "test-rule",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-autoscaling-role",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "RECONCILING",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-autoscaling-role",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-readAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingTarget",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "table-name-writeAutoscalingPolicy",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                              [
                                {
                                  "Item": {
                                    "name": "test-rule",
                                    "sort_key": "test-deployment",
                                    "status": "STABLE",
                                    "version": "0.0.1test",
                                  },
                                  "ReturnValues": "NONE",
                                  "TableName": "_testing_state_table",
                                },
                              ],
                            ],
                            "results": [
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                              {
                                "type": "return",
                                "value": undefined,
                              },
                            ],
                          },
                          "query": [MockFunction],
                          "update": [MockFunction],
                        },
                        "name": "table-name",
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
                    ],
                    "iam": IAM {
                      "iam": IAMMock {},
                    },
                    "name": "table-name-autoscaling-role",
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
                ],
                "name": "table-name-writeAutoscalingTarget",
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
                  "maxCapacity": 50,
                  "minCapacity": 1,
                  "resourceId": "table/table-name",
                  "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
                  "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                  "serviceNamespace": "dynamodb",
                },
                "resourceType": "AutoscalingTarget",
                "status": "STABLE",
              },
            ],
            "name": "table-name-writeAutoscalingPolicy",
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
          "table-name-writeAutoscalingTarget": AutoscalingTarget {
            "_MAX_RETRIES": 10,
            "_MAX_RETRY_TIMEOUT_SECONDS": 10,
            "_destroyErrors": [],
            "_reconcileErrors": [],
            "autoscaling": ApplicationAutoScaling {
              "autoscaling": ApplicationAutoScalingMock {},
            },
            "dependsOn": [
              Role {
                "_MAX_RETRIES": 10,
                "_MAX_RETRY_TIMEOUT_SECONDS": 10,
                "_destroyErrors": [],
                "_reconcileErrors": [],
                "dependsOn": [
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
                      "put": [MockFunction] {
                        "calls": [
                          [
                            {
                              "Item": {
                                "name": "test-rule",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-autoscaling-role",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "RECONCILING",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-autoscaling-role",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-readAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingTarget",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "table-name-writeAutoscalingPolicy",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                          [
                            {
                              "Item": {
                                "name": "test-rule",
                                "sort_key": "test-deployment",
                                "status": "STABLE",
                                "version": "0.0.1test",
                              },
                              "ReturnValues": "NONE",
                              "TableName": "_testing_state_table",
                            },
                          ],
                        ],
                        "results": [
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                          {
                            "type": "return",
                            "value": undefined,
                          },
                        ],
                      },
                      "query": [MockFunction],
                      "update": [MockFunction],
                    },
                    "name": "table-name",
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
                ],
                "iam": IAM {
                  "iam": IAMMock {},
                },
                "name": "table-name-autoscaling-role",
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
            ],
            "name": "table-name-writeAutoscalingTarget",
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
              "maxCapacity": 50,
              "minCapacity": 1,
              "resourceId": "table/table-name",
              "roleArn": "arn:aws:iam::123456789012:role/table-name-autoscaling-role",
              "scalableDimension": "dynamodb:table:WriteCapacityUnits",
              "serviceNamespace": "dynamodb",
            },
            "resourceType": "AutoscalingTarget",
            "status": "STABLE",
          },
        },
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
  });
});
