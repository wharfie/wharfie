/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const {
  AutoscalingPolicy,
} = require('../../../lambdas/lib/actor/resources/aws/');
const ApplicationAutoScaling = jest.requireMock(
  '@aws-sdk/client-application-auto-scaling'
);

const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('autoscaling policy IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const applicationAutoScaling =
      new ApplicationAutoScaling.ApplicationAutoScaling({});
    const autoscalingPolicy = new AutoscalingPolicy({
      name: 'test-rule',
      properties: {
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

    const serialized = autoscalingPolicy.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-rule",
        "properties": {
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

    const deserialized = deserialize(serialized);
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
        "emit": false,
        "name": "test-rule",
        "properties": {
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
  });
});
