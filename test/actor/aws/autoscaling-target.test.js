/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const {
  AutoscalingTarget,
} = require('../../../lambdas/lib/actor/resources/aws/');
const ApplicationAutoScaling = jest.requireMock(
  '@aws-sdk/client-application-auto-scaling'
);

const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('autoscaling target IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const applicationAutoScaling =
      new ApplicationAutoScaling.ApplicationAutoScaling({});
    const autoscalingTarget = new AutoscalingTarget({
      name: 'test-rule',
      properties: {
        minCapacity: 1,
        maxCapacity: 10,
        resourceId: `table/table`,
        scalableDimension: 'dynamodb:table:ReadCapacityUnits',
        serviceNamespace: ApplicationAutoScaling.ServiceNamespace.DYNAMODB,
      },
    });
    await autoscalingTarget.reconcile();

    const serialized = autoscalingTarget.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-rule",
        "properties": {
          "maxCapacity": 10,
          "minCapacity": 1,
          "resourceId": "table/table",
          "scalableDimension": "dynamodb:table:ReadCapacityUnits",
          "serviceNamespace": "dynamodb",
        },
        "resourceType": "AutoscalingTarget",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      AutoscalingTarget {
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
          "maxCapacity": 10,
          "minCapacity": 1,
          "resourceId": "table/table",
          "scalableDimension": "dynamodb:table:ReadCapacityUnits",
          "serviceNamespace": "dynamodb",
        },
        "resourceType": "AutoscalingTarget",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await applicationAutoScaling.describeScalableTargets({
      ResourceIds: [autoscalingTarget.get('resourceId')],
      ServiceNamespace: autoscalingTarget.get('serviceNamespace'),
      ScalableDimension: autoscalingTarget.get('scalableDimension'),
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "ScalableTargets": [
          {
            "MaxCapacity": 10,
            "MinCapacity": 1,
            "ResourceId": "table/table",
            "RoleARN": undefined,
            "ScalableDimension": "dynamodb:table:ReadCapacityUnits",
            "ServiceNamespace": "dynamodb",
          },
        ],
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    const des_res = await applicationAutoScaling.describeScalableTargets({
      ResourceIds: [autoscalingTarget.get('resourceId')],
      ServiceNamespace: autoscalingTarget.get('serviceNamespace'),
      ScalableDimension: autoscalingTarget.get('scalableDimension'),
    });
    expect(des_res.ScalableTargets).toStrictEqual([]);
  });
});
