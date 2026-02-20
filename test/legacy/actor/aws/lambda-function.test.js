/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = true;
jest.mock('crypto');
const { Lambda } = jest.requireMock('@aws-sdk/client-lambda');

const crypto = require('crypto');

const { LambdaFunction } = require('../../../lambdas/lib/actor/resources/aws/');
const { getMockDeploymentProperties } = require('../util');

describe('lambda function IaC', () => {
  beforeAll(() => {
    const mockUpdate = jest.fn().mockReturnThis();
    const mockDigest = jest.fn().mockReturnValue('mockedHash');
    crypto.createHash.mockReturnValue({
      update: mockUpdate,
      digest: mockDigest,
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('basic', async () => {
    expect.assertions(4);

    const lambda = new Lambda({});
    const lambdaFunction = new LambdaFunction({
      name: 'test-function',
      properties: {
        deployment: getMockDeploymentProperties(),
        runtime: 'nodejs20.x',
        role: 'test-role',
        handler: `index.handler`,
        tags: {
          test: '123',
        },
        code: () => ({
          S3Bucket: 123456789012,
          S3Key: 'test-key',
        }),
        description: 'test des',
        memorySize: 1024,
        timeout: 300,
        deadLetterConfig: () => ({
          TargetArn: 'test-dlq-arn',
        }),
        codeHash: 'test-code-hash',
        environment: () => {
          return {
            Variables: {
              NODE_OPTIONS: '--enable-source-maps',
              AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
              DLQ_URL: 'test-dlq-url',
            },
          };
        },
      },
    });
    await lambdaFunction.reconcile();

    const serialized = lambdaFunction.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-function",
        "parent": "",
        "properties": {
          "architectures": [
            "arm64",
          ],
          "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-function",
          "code": {
            "S3Bucket": 123456789012,
            "S3Key": "test-key",
          },
          "codeHash": "test-code-hash",
          "deadLetterConfig": {
            "TargetArn": "test-dlq-arn",
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
          "description": "test des",
          "environment": {
            "Variables": {
              "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
              "DLQ_URL": "test-dlq-url",
              "NODE_OPTIONS": "--enable-source-maps",
            },
          },
          "ephemeralStorage": {
            "Size": 512,
          },
          "handler": "index.handler",
          "memorySize": 1024,
          "packageType": "Zip",
          "publish": true,
          "role": "test-role",
          "runtime": "nodejs20.x",
          "tags": {
            "test": "123",
          },
          "timeout": 300,
        },
        "resourceType": "LambdaFunction",
        "status": "STABLE",
      }
    `);

    const res = await lambda.getFunction({
      FunctionName: lambdaFunction.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Configuration": {
          "Architectures": [
            "arm64",
          ],
          "Code": {
            "S3Bucket": 123456789012,
            "S3Key": "test-key",
          },
          "DeadLetterConfig": {
            "TargetArn": "test-dlq-arn",
          },
          "Description": "test des",
          "Environment": {
            "Variables": {
              "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
              "DLQ_URL": "test-dlq-url",
              "NODE_OPTIONS": "--enable-source-maps",
            },
          },
          "EphemeralStorage": {
            "Size": 512,
          },
          "FunctionArn": "arn:aws:lambda:us-west-2:123456789012:function:test-function",
          "FunctionName": "test-function",
          "Handler": "index.handler",
          "MemorySize": 1024,
          "PackageType": "Zip",
          "Publish": true,
          "Role": "test-role",
          "Runtime": "nodejs20.x",
          "Tags": {
            "CodeHash": "test-code-hash",
            "test": "123",
          },
          "Timeout": 300,
        },
        "Tags": {
          "CodeHash": "test-code-hash",
          "test": "123",
        },
      }
    `);

    await lambdaFunction.destroy();

    expect(lambdaFunction.status).toBe('DESTROYED');
    await expect(
      lambda.getFunction({ FunctionName: lambdaFunction.name }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Function not found: test-function"`,
    );
  });
});
