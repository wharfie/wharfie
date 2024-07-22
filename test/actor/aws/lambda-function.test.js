/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Lambda } = jest.requireMock('@aws-sdk/client-lambda');

const { LambdaFunction } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('lambda function IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const lambda = new Lambda({});
    const lambdaFunction = new LambdaFunction({
      name: 'test-function',
      properties: {
        runtime: 'nodejs20.x',
        role: 'test-role',
        handler: `index.handler`,
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
          "timeout": 300,
        },
        "resourceType": "LambdaFunction",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      LambdaFunction {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "emit": false,
        "lambda": Lambda {
          "lambda": LambdaMock {},
        },
        "name": "test-function",
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
          "timeout": 300,
        },
        "resourceType": "LambdaFunction",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

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
          },
          "Timeout": 300,
        },
        "Tags": {
          "CodeHash": "test-code-hash",
        },
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      lambda.getFunction({ FunctionName: lambdaFunction.name })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"Function not found: test-function"`
    );
  });
});
