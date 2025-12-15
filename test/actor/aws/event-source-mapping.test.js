/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createId } = require('../../../lambdas/lib/id');
jest.mock('../../../lambdas/lib/id');

process.env.AWS_MOCKS = '1';
const { Lambda } = jest.requireMock('@aws-sdk/client-lambda');

const {
  LambdaFunction,
  EventSourceMapping,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { getMockDeploymentProperties } = require('../util');

describe('event source mapping IaC', () => {
  beforeAll(async () => {
    // @ts-ignore
    createId.mockReturnValue('test-id');
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
    const eventSourceMapping = new EventSourceMapping({
      name: 'test-event-source-mapping',
      properties: {
        deployment: getMockDeploymentProperties(),
        functionName: lambdaFunction.name,
        eventSourceArn: 'test-event-source-arn',
        batchSize: 1,
        maximumBatchingWindowInSeconds: 0,
        tags: {
          test: 'tag',
        },
      },
    });
    await eventSourceMapping.reconcile();

    const serialized = eventSourceMapping.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-event-source-mapping",
        "parent": "",
        "properties": {
          "arn": "arn:aws:lambda:us-east-1:123456789012:event-source-mapping:test-id",
          "batchSize": 1,
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
          "eventSourceArn": "test-event-source-arn",
          "functionName": "test-function",
          "maximumBatchingWindowInSeconds": 0,
          "tags": {
            "test": "tag",
          },
          "uuid": "test-id",
        },
        "resourceType": "EventSourceMapping",
        "status": "STABLE",
      }
    `);

    const res = await lambda.listEventSourceMappings({
      FunctionName: lambdaFunction.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "EventSourceMappings": [
          {
            "BatchSize": 1,
            "Enabled": true,
            "EventSourceArn": "test-event-source-arn",
            "FunctionName": "test-function",
            "MaximumBatchingWindowInSeconds": 0,
            "State": "Enabled",
            "Tags": {
              "test": "tag",
            },
            "UUID": "test-id",
          },
        ],
      }
    `);

    await eventSourceMapping.destroy();

    expect(eventSourceMapping.status).toBe('DESTROYED');

    const del_res = await lambda.listEventSourceMappings({
      FunctionName: lambdaFunction.name,
    });

    expect(del_res).toMatchInlineSnapshot(`
      {
        "EventSourceMappings": [],
      }
    `);
  });
});
