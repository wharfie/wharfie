/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { SQS } = jest.requireMock('@aws-sdk/client-sqs');

const { Queue } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('sqs queue IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const sqs = new SQS({});
    const queue = new Queue({
      name: 'test-queue',
    });
    await queue.reconcile();

    const serialized = queue.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-queue",
        "properties": {
          "arn": "arn:aws:sqs:us-east-1:123456789012:test-queue",
          "delaySeconds": "0",
          "messageRetentionPeriod": "1209600",
          "receiveMessageWaitTimeSeconds": "0",
          "url": "test-queue",
          "visibilityTimeout": "300",
        },
        "resourceType": "Queue",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      Queue {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "emit": false,
        "name": "test-queue",
        "properties": {
          "arn": "arn:aws:sqs:us-east-1:123456789012:test-queue",
          "delaySeconds": "0",
          "messageRetentionPeriod": "1209600",
          "receiveMessageWaitTimeSeconds": "0",
          "url": "test-queue",
          "visibilityTimeout": "300",
        },
        "resourceType": "Queue",
        "sqs": SQS {
          "sqs": SQSMock {},
        },
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

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
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      sqs.getQueueAttributes({ QueueUrl: 'test-queue' })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"queue test-queue does not exist"`
    );
  });
});
