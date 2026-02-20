/* eslint-disable jest/no-hooks */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createId } = require('../../lambdas/lib/id');
const AWS = require('@aws-sdk/client-sqs');
jest.mock('../../lambdas/lib/id');

const random = Math.random;
let SQS;

describe('tests for SQS', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    process.env.DAEMON_QUEUE_URL = 'queue';
    process.env.DLQ_URL = 'dlq_queue';

    const mockMath = Object.create(global.Math);
    mockMath.random = () => 0.5;
    global.Math = mockMath;
    SQS = require('../../lambdas/lib/sqs');
  });

  afterEach(() => {
    AWS.SQSMock.reset();
  });

  afterAll(() => {
    process.env.DAEMON_QUEUE_URL = undefined;
    process.env.DLQ_URL = undefined;
    global.Math.random = random;
  });

  it('sendMessage', async () => {
    expect.assertions(3);

    AWS.SQSMock.on(AWS.SendMessageCommand).resolves({});
    const sqs = new SQS({ region: 'us-east-1' });
    const params = {
      MessageBody: JSON.stringify('test'),
      QueueUrl: 'test_queue',
    };
    await sqs.sendMessage(params);

    expect(AWS.SQSMock).toHaveReceivedCommandTimes(AWS.SendMessageCommand, 1);
    expect(AWS.SQSMock).toHaveReceivedCommandWith(
      AWS.SendMessageCommand,
      params,
    );
  });

  it('enqueue', async () => {
    expect.assertions(5);

    AWS.SQSMock.on(AWS.SendMessageCommand).resolves({});
    const sqs = new SQS({ region: 'us-east-1' });
    const event = {
      foo: 'bar',
    };
    await sqs.enqueue(event, process.env.DAEMON_QUEUE_URL, 100);
    await sqs.enqueue(event, process.env.DAEMON_QUEUE_URL, -100);

    expect(AWS.SQSMock).toHaveReceivedCommandTimes(AWS.SendMessageCommand, 2);
    expect(AWS.SQSMock).toHaveReceivedNthCommandWith(
      1,
      AWS.SendMessageCommand,
      {
        MessageBody: JSON.stringify(event),
        QueueUrl: process.env.DAEMON_QUEUE_URL,
        DelaySeconds: 60,
      },
    );
    expect(AWS.SQSMock).toHaveReceivedNthCommandWith(
      2,
      AWS.SendMessageCommand,
      {
        MessageBody: JSON.stringify(event),
        QueueUrl: process.env.DAEMON_QUEUE_URL,
        DelaySeconds: 0,
      },
    );
  });

  it('enqueueBatch', async () => {
    expect.assertions(4);

    let idCount = 0;
    createId.mockImplementation(() => {
      idCount = idCount + 1;
      return `id-${idCount}`;
    });
    AWS.SQSMock.on(AWS.SendMessageBatchCommand)
      .resolvesOnce({
        Failed: [
          {
            Id: 'id-1',
          },
          {
            Id: 'id-3',
          },
        ],
      })
      .resolvesOnce({})
      .resolvesOnce({});
    const sqs = new SQS({ region: 'us-east-1' });
    const events = Array(11).fill({
      foo: 'bar',
    });
    await sqs.enqueueBatch(events, process.env.DAEMON_QUEUE_URL);

    expect(AWS.SQSMock).toHaveReceivedCommandTimes(
      AWS.SendMessageBatchCommand,
      3,
    );
    expect(
      AWS.SQSMock.commandCalls(AWS.SendMessageBatchCommand)[0].args[0].input,
    ).toMatchInlineSnapshot(`
      {
        "Entries": [
          {
            "Id": "id-1",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-2",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-3",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-4",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-5",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-6",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-7",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-8",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-9",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-10",
            "MessageBody": "{"foo":"bar"}",
          },
        ],
        "QueueUrl": "queue",
      }
    `);
    expect(
      AWS.SQSMock.commandCalls(AWS.SendMessageBatchCommand)[1].args[0].input,
    ).toMatchInlineSnapshot(`
      {
        "Entries": [
          {
            "Id": "id-11",
            "MessageBody": "{"foo":"bar"}",
          },
        ],
        "QueueUrl": "queue",
      }
    `);
    expect(
      AWS.SQSMock.commandCalls(AWS.SendMessageBatchCommand)[2].args[0].input,
    ).toMatchInlineSnapshot(`
      {
        "Entries": [
          {
            "Id": "id-3",
            "MessageBody": "{"foo":"bar"}",
          },
          {
            "Id": "id-1",
            "MessageBody": "{"foo":"bar"}",
          },
        ],
        "QueueUrl": "queue",
      }
    `);

    createId.mockClear();
  });

  it('reenqueue', async () => {
    expect.assertions(3);

    AWS.SQSMock.on(AWS.SendMessageCommand).resolves(undefined);
    const sqs = new SQS({ region: 'us-east-1' });
    const event = {
      foo: 'bar',
    };
    await sqs.reenqueue(event, process.env.DAEMON_QUEUE_URL);

    expect(AWS.SQSMock).toHaveReceivedCommandTimes(AWS.SendMessageCommand, 1);
    expect(AWS.SQSMock).toHaveReceivedNthCommandWith(
      1,
      AWS.SendMessageCommand,
      {
        MessageBody: JSON.stringify(event),
        QueueUrl: process.env.DAEMON_QUEUE_URL,
        DelaySeconds: 60,
      },
    );
  });
});
