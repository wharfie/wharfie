/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { IAM } = jest.requireMock('@aws-sdk/client-iam');

const { Policy } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('iam policy IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const iam = new IAM({});
    const policy = new Policy({
      name: 'test-policy',
      properties: {
        deployment: {
          accountId: '123456789012',
        },
        description: `test policy`,
        document: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['athena:GetQueryExecution', 'athena:*'],
              Resource: '*',
            },
            {
              Effect: 'Allow',
              Action: ['glue:GetPartitions', 'glue:GetPartition'],
              Resource: '*',
            },
          ],
        }),
      },
    });
    await policy.reconcile();

    const serialized = policy.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-policy",
        "properties": {
          "arn": "arn:aws:iam::123456789012:policy/test-policy",
          "deployment": {
            "accountId": "123456789012",
          },
          "description": "test policy",
          "document": {
            "Statement": [
              {
                "Action": [
                  "athena:GetQueryExecution",
                  "athena:*",
                ],
                "Effect": "Allow",
                "Resource": "*",
              },
              {
                "Action": [
                  "glue:GetPartitions",
                  "glue:GetPartition",
                ],
                "Effect": "Allow",
                "Resource": "*",
              },
            ],
            "Version": "2012-10-17",
          },
        },
        "resourceType": "Policy",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      Policy {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "emit": false,
        "iam": IAM {
          "iam": IAMMock {},
        },
        "name": "test-policy",
        "properties": {
          "arn": [Function],
          "deployment": {
            "accountId": "123456789012",
          },
          "description": "test policy",
          "document": {
            "Statement": [
              {
                "Action": [
                  "athena:GetQueryExecution",
                  "athena:*",
                ],
                "Effect": "Allow",
                "Resource": "*",
              },
              {
                "Action": [
                  "glue:GetPartitions",
                  "glue:GetPartition",
                ],
                "Effect": "Allow",
                "Resource": "*",
              },
            ],
            "Version": "2012-10-17",
          },
        },
        "resourceType": "Policy",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await iam.getPolicy({
      PolicyArn: policy.get('arn'),
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Policy": {
          "Arn": "test-policy",
          "Description": "test policy",
          "PolicyDocument": "{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["athena:GetQueryExecution","athena:*"],"Resource":"*"},{"Effect":"Allow","Action":["glue:GetPartitions","glue:GetPartition"],"Resource":"*"}]}",
          "PolicyName": "test-policy",
        },
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      iam.getPolicy({ PolicyArn: policy.get('arn') })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"policy test-policy does not exist"`
    );
  });
});
