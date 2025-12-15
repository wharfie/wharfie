/* eslint-disable jest/no-hooks */
import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

let SQS;
const random = Math.random;

describe('mock tests for SQS', () => {
  beforeAll(() => {
    process.env.AWS_MOCKS = true;
    process.env.DAEMON_QUEUE_URL = 'queue';
    process.env.DLQ_URL = 'dlq_queue';

    const mockMath = Object.create(global.Math);
    mockMath.random = () => 0.5;
    global.Math = mockMath;
    jest.mock('../../lambdas/lib/id');
    jest.requireMock('@aws-sdk/client-sqs');
    SQS = require('../../lambdas/lib/sqs');
  });

  afterAll(() => {
    process.env.AWS_MOCKS = false;
    process.env.DAEMON_QUEUE_URL = undefined;
    process.env.DLQ_URL = undefined;
    global.Math.random = random;
  });

  it('sendMessage mock', async () => {
    expect.assertions(1);

    const sqs = new SQS({ region: 'us-east-1' });
    sqs.sqs.__setMockState();
    const params = {
      MessageBody: JSON.stringify('test'),
      QueueUrl: 'test_queue',
    };
    await sqs.sendMessage(params);
    await sqs.sendMessage(params);

    const { Messages } = await sqs.sqs.receiveMessage({
      QueueUrl: 'test_queue',
      MaxNumberOfMessages: 2,
    });

    await sqs.deleteMessageBatch({
      QueueUrl: 'test_queue',
      Entries: Messages,
    });

    expect(sqs.sqs.__getMockState()).toMatchInlineSnapshot(`
      {
        "queues": {
          "test_queue": {
            "Attributes": {},
            "queue": [],
          },
        },
      }
    `);
  });

  it('sendMessageBatch mock', async () => {
    expect.assertions(1);

    const sqs = new SQS({ region: 'us-east-1' });
    sqs.sqs.__setMockState();
    const params = {
      Entries: [
        {
          MessageBody: JSON.stringify('foo'),
        },
        {
          MessageBody: JSON.stringify('bar'),
        },
      ],
      QueueUrl: 'test_queue',
    };
    await sqs.sendMessageBatch(params);

    expect(sqs.sqs.__getMockState()).toMatchInlineSnapshot(`
      {
        "queues": {
          "test_queue": {
            "Attributes": {},
            "queue": [
              {
                "Body": ""foo"",
                "MessageId": "ckywjpmr70002zjvd0wyq5x48",
              },
              {
                "Body": ""bar"",
                "MessageId": "ckywjpmr70002zjvd0wyq5x48",
              },
            ],
          },
        },
      }
    `);
  });
});
