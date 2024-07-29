/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { IAM } = jest.requireMock('@aws-sdk/client-iam');

const { Role } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('iam role IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const iam = new IAM({});
    const role = new Role({
      name: 'test-role',
    });
    await role.reconcile();

    const serialized = role.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-role",
        "properties": {
          "arn": "arn:aws:iam::123456789012:role/test-role",
        },
        "resourceType": "Role",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      Role {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "iam": IAM {
          "iam": IAMMock {},
        },
        "name": "test-role",
        "properties": {
          "arn": "arn:aws:iam::123456789012:role/test-role",
        },
        "resourceType": "Role",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await iam.getRole({
      RoleName: 'test-role',
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Role": {
          "Arn": "arn:aws:iam::123456789012:role/test-role",
          "AssumeRolePolicyDocument": undefined,
          "AttachedPolicies": [],
          "Description": undefined,
          "Policies": [],
          "RoleName": "test-role",
        },
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      iam.getRole({ RoleName: 'test-role' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"role test-role does not exist"`
    );
  });

  it('complex', async () => {
    expect.assertions(6);
    const iam = new IAM({});
    const role = new Role({
      name: 'test-role',
      properties: {
        description: `some role description`,
        assumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        rolePolicyDocument: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'sqs:DeleteMessage',
                'sqs:ReceiveMessage',
                'sqs:GetQueueAttributes',
                'sqs:SendMessage',
              ],
              Resource: ['*'],
            },
          ],
        }),
      },
    });
    await role.reconcile();

    const serialized = role.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-role",
        "properties": {
          "arn": "arn:aws:iam::123456789012:role/test-role",
          "assumeRolePolicyDocument": {
            "Statement": [
              {
                "Action": "sts:AssumeRole",
                "Effect": "Allow",
                "Principal": {
                  "Service": "lambda.amazonaws.com",
                },
              },
            ],
            "Version": "2012-10-17",
          },
          "description": "some role description",
          "rolePolicyDocument": {
            "Statement": [
              {
                "Action": [
                  "sqs:DeleteMessage",
                  "sqs:ReceiveMessage",
                  "sqs:GetQueueAttributes",
                  "sqs:SendMessage",
                ],
                "Effect": "Allow",
                "Resource": [
                  "*",
                ],
              },
            ],
            "Version": "2012-10-17",
          },
        },
        "resourceType": "Role",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      Role {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "iam": IAM {
          "iam": IAMMock {},
        },
        "name": "test-role",
        "properties": {
          "arn": "arn:aws:iam::123456789012:role/test-role",
          "assumeRolePolicyDocument": {
            "Statement": [
              {
                "Action": "sts:AssumeRole",
                "Effect": "Allow",
                "Principal": {
                  "Service": "lambda.amazonaws.com",
                },
              },
            ],
            "Version": "2012-10-17",
          },
          "description": "some role description",
          "rolePolicyDocument": {
            "Statement": [
              {
                "Action": [
                  "sqs:DeleteMessage",
                  "sqs:ReceiveMessage",
                  "sqs:GetQueueAttributes",
                  "sqs:SendMessage",
                ],
                "Effect": "Allow",
                "Resource": [
                  "*",
                ],
              },
            ],
            "Version": "2012-10-17",
          },
        },
        "resourceType": "Role",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await iam.getRole({
      RoleName: 'test-role',
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Role": {
          "Arn": "arn:aws:iam::123456789012:role/test-role",
          "AssumeRolePolicyDocument": "{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}",
          "AttachedPolicies": [],
          "Description": "some role description",
          "Policies": [
            {
              "PolicyDocument": "{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["sqs:DeleteMessage","sqs:ReceiveMessage","sqs:GetQueueAttributes","sqs:SendMessage"],"Resource":["*"]}]}",
              "PolicyName": "test-role_policy",
            },
          ],
          "RoleName": "test-role",
        },
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      iam.getRole({ RoleName: 'test-role' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"role test-role does not exist"`
    );
  });
});
