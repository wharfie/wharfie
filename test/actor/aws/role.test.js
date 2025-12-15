/* eslint-disable jest/no-large-snapshots */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = true;
jest.mock('../../../lambdas/lib/id');
const { IAM } = jest.requireMock('@aws-sdk/client-iam');

const { getMockDeploymentProperties } = require('../util');
const { Role } = require('../../../lambdas/lib/actor/resources/aws/');

describe('iam role IaC', () => {
  it('basic', async () => {
    expect.assertions(4);

    const iam = new IAM({});
    const role = new Role({
      name: 'test-role',
      properties: {
        deployment: getMockDeploymentProperties(),
        tags: [
          {
            Key: 'test-key',
            Value: 'test-value',
          },
        ],
      },
    });
    await role.reconcile();

    const serialized = role.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-role",
        "parent": "",
        "properties": {
          "arn": "arn:aws:iam::123456789012:role/test-role",
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
          "roleName": "test-role",
          "tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
        "resourceType": "Role",
        "status": "STABLE",
      }
    `);

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
          "Tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
      }
    `);

    await role.destroy();

    expect(role.status).toBe('DESTROYED');
    await expect(
      iam.getRole({ RoleName: 'test-role' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"role test-role does not exist"`
    );
  });

  it('complex', async () => {
    expect.assertions(4);

    const iam = new IAM({});
    const role = new Role({
      name: 'test-role',
      properties: {
        deployment: getMockDeploymentProperties(),
        description: `some role description`,
        tags: [
          {
            Key: 'test-key',
            Value: 'test-value',
          },
        ],
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
        "parent": "",
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
          "description": "some role description",
          "roleName": "test-role",
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
          "tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
        "resourceType": "Role",
        "status": "STABLE",
      }
    `);

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
          "Tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
      }
    `);

    await role.destroy();

    expect(role.status).toBe('DESTROYED');
    await expect(
      iam.getRole({ RoleName: 'test-role' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"role test-role does not exist"`
    );
  });
});
