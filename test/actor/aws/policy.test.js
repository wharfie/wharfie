/* eslint-disable jest/no-large-snapshots */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = true;
const { IAM } = jest.requireMock('@aws-sdk/client-iam');

const { Policy } = require('../../../lambdas/lib/actor/resources/aws/');

describe('iam policy IaC', () => {
  it('basic', async () => {
    expect.assertions(4);

    const iam = new IAM({});
    const policy = new Policy({
      name: 'test-policy',
      properties: {
        deployment: {
          accountId: '123456789012',
        },
        tags: [
          {
            Key: 'test-tag',
            Value: 'test-value',
          },
        ],
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
        "parent": "",
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
          "tags": [
            {
              "Key": "test-tag",
              "Value": "test-value",
            },
          ],
        },
        "resourceType": "Policy",
        "status": "STABLE",
      }
    `);

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
          "Tags": [
            {
              "Key": "test-tag",
              "Value": "test-value",
            },
          ],
        },
      }
    `);

    await policy.destroy();

    expect(policy.status).toBe('DESTROYED');
    await expect(
      iam.getPolicy({ PolicyArn: policy.get('arn') })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"policy test-policy does not exist"`
    );
  });
});
