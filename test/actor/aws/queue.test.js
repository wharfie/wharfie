/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { SQS } = jest.requireMock('@aws-sdk/client-sqs');

const { Queue } = require('../../../lambdas/lib/actor/resources/aws/');
const { getMockDeploymentProperties } = require('../util');

describe('sqs queue IaC', () => {
  it('basic', async () => {
    expect.assertions(4);
    const sqs = new SQS({});
    const queue = new Queue({
      name: 'test-queue',
      properties: {
        deployment: getMockDeploymentProperties(),
      },
    });
    await queue.reconcile();

    const serialized = queue.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-queue",
        "parent": "",
        "properties": {
          "arn": "arn:aws:sqs:us-east-1:123456789012:test-queue",
          "delaySeconds": "0",
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
          "messageRetentionPeriod": "1209600",
          "receiveMessageWaitTimeSeconds": "0",
          "url": "test-queue",
          "visibilityTimeout": "300",
        },
        "resourceType": "Queue",
        "status": "STABLE",
      }
    `);

    const res = await sqs.getQueueAttributes({
      QueueUrl: 'test-queue',
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Attributes": {
          "DelaySeconds": "0",
          "MessageRetentionPeriod": "1209600",
          "QueueArn": "arn:aws:sqs:us-east-1:123456789012:test-queue",
          "ReceiveMessageWaitTimeSeconds": "0",
          "VisibilityTimeout": "300",
        },
        "queue": [],
      }
    `);
    await queue.destroy();
    expect(queue.status).toBe('DESTROYED');
    await expect(
      sqs.getQueueAttributes({ QueueUrl: 'test-queue' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"queue test-queue does not exist"`
    );
  });
});
