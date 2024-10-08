/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';
const {
  AutoscalingPolicy,
} = require('../../../lambdas/lib/actor/resources/aws/');
const ApplicationAutoScaling = jest.requireMock(
  '@aws-sdk/client-application-auto-scaling'
);

const { load } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');
const Reconcilable = require('../../../lambdas/lib/actor/resources/reconcilable');
const AWS = require('@aws-sdk/lib-dynamodb');
let query, _delete, put;

describe('autoscaling policy IaC', () => {
  beforeAll(() => {
    put = AWS.spyOn('DynamoDBDocument', 'put');
    query = AWS.spyOn('DynamoDBDocument', 'query');
    _delete = AWS.spyOn('DynamoDBDocument', 'delete');
  });

  afterEach(() => {
    AWS.clearAllMocks();
  });
  it('basic', async () => {
    expect.assertions(14);
    const applicationAutoScaling =
      new ApplicationAutoScaling.ApplicationAutoScaling({});
    const autoscalingPolicy = new AutoscalingPolicy({
      name: 'test-rule',
      properties: {
        deployment: getMockDeploymentProperties(),
        resourceId: `table/dynamotable`,
        serviceNamespace: ApplicationAutoScaling.ServiceNamespace.DYNAMODB,
        policyType: ApplicationAutoScaling.PolicyType.TargetTrackingScaling,
        scalableDimension: 'dynamodb:table:ReadCapacityUnits',
        targetTrackingScalingPolicyConfiguration: {
          TargetValue: 70.0,
          ScaleInCooldown: 0,
          ScaleOutCooldown: 0,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'DynamoDBReadCapacityUtilization',
          },
        },
      },
    });
    await autoscalingPolicy.reconcile();

    const reconcilingStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.RECONCILING)
      .map(([{ Item }]) => Item);

    const stableStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
      .map(([{ Item }]) => Item);

    expect(reconcilingStatusUpdate).toHaveLength(1);
    expect(stableStatusUpdate).toHaveLength(1);
    expect(stableStatusUpdate).toMatchInlineSnapshot(`
      [
        {
          "name": "test-rule",
          "serialized": {
            "dependsOn": [],
            "name": "test-rule",
            "parent": "",
            "properties": {
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
              "resourceId": "table/dynamotable",
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
          "sort_key": "test-rule",
          "status": "STABLE",
          "version": "0.0.1test",
        },
      ]
    `);

    const serialized = autoscalingPolicy.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-rule",
        "parent": "",
        "properties": {
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
          "resourceId": "table/dynamotable",
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
      }
    `);

    query.mockResolvedValueOnce({
      Items: put.mock.calls
        .filter(([{ Item }]) => Item.status === Reconcilable.Status.STABLE)
        .map((call) => call[0].Item),
    });
    const deserialized = await load({
      deploymentName: 'test-deployment',
      name: 'test-rule',
      sortKey: 'test-rule',
    });
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      AutoscalingPolicy {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "autoscaling": ApplicationAutoScaling {
          "autoscaling": ApplicationAutoScalingMock {},
        },
        "dependsOn": [],
        "name": "test-rule",
        "parent": "",
        "properties": {
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
          "resourceId": "table/dynamotable",
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
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await applicationAutoScaling.describeScalingPolicies({
      PolicyNames: [autoscalingPolicy.name],
      ServiceNamespace: autoscalingPolicy.get('serviceNamespace'),
      ScalableDimension: autoscalingPolicy.get('scalableDimension'),
      ResourceId: autoscalingPolicy.get('resourceId'),
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "ScalingPolicies": [
          {
            "PolicyName": "test-rule",
            "PolicyType": "TargetTrackingScaling",
            "ResourceId": "table/dynamotable",
            "ScalableDimension": "dynamodb:table:ReadCapacityUnits",
            "ServiceNamespace": "dynamodb",
            "TargetTrackingScalingPolicyConfiguration": {
              "PredefinedMetricSpecification": {
                "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
              },
              "ScaleInCooldown": 0,
              "ScaleOutCooldown": 0,
              "TargetValue": 70,
            },
          },
        ],
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    const des_res = await applicationAutoScaling.describeScalingPolicies({
      PolicyNames: [autoscalingPolicy.name],
      ServiceNamespace: autoscalingPolicy.get('serviceNamespace'),
      ScalableDimension: autoscalingPolicy.get('scalableDimension'),
      ResourceId: autoscalingPolicy.get('resourceId'),
    });
    expect(des_res.ScalingPolicies).toStrictEqual([]);

    const destroyingStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYING)
      .map(([{ Item }]) => Item);

    const destroyedStatusUpdate = put.mock.calls
      .filter(([{ Item }]) => Item.status === Reconcilable.Status.DESTROYED)
      .map(([{ Item }]) => Item);

    expect(destroyingStatusUpdate).toHaveLength(1);
    expect(destroyedStatusUpdate).toHaveLength(0);

    expect(put).toHaveBeenCalledTimes(3);
    expect(_delete).toHaveBeenCalledTimes(1);
    expect(_delete.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "Key": {
              "name": "test-rule",
              "sort_key": "test-rule",
            },
            "TableName": "_testing_state_table",
          },
        ],
      ]
    `);
  });
});
