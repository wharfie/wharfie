/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';
const { createId } = require('../../../lambdas/lib/id');
jest.mock('../../../lambdas/lib/id');

process.env.AWS_MOCKS = true;
const { Lambda } = jest.requireMock('@aws-sdk/client-lambda');

const {
  LambdaFunction,
  EventSourceMapping,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('event source mapping IaC', () => {
  beforeAll(async () => {
    createId.mockReturnValue('test-id');
  });
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
    const eventSourceMapping = new EventSourceMapping({
      name: 'test-event-source-mapping',
      properties: {
        functionName: lambdaFunction.name,
        eventSourceArn: 'test-event-source-arn',
        batchSize: 1,
        maximumBatchingWindowInSeconds: 0,
      },
    });
    await eventSourceMapping.reconcile();

    const serialized = eventSourceMapping.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-event-source-mapping",
        "properties": {
          "batchSize": 1,
          "eventSourceArn": "test-event-source-arn",
          "functionName": "test-function",
          "maximumBatchingWindowInSeconds": 0,
          "uuid": "test-id",
        },
        "resourceType": "EventSourceMapping",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      EventSourceMapping {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "emit": false,
        "lambda": Lambda {
          "lambda": LambdaMock {},
        },
        "name": "test-event-source-mapping",
        "properties": {
          "batchSize": 1,
          "eventSourceArn": "test-event-source-arn",
          "functionName": "test-function",
          "maximumBatchingWindowInSeconds": 0,
          "uuid": "test-id",
        },
        "resourceType": "EventSourceMapping",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await lambda.listEventSourceMappings({
      FunctionName: lambdaFunction.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "EventSourceMappings": [
          {
            "BatchSize": 1,
            "EventSourceArn": "test-event-source-arn",
            "FunctionName": "test-function",
            "MaximumBatchingWindowInSeconds": 0,
            "UUID": "test-id",
          },
        ],
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
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
