/* eslint-disable jest/no-hooks */
'use strict';

let lambda, SQS, logging, sendMessage, processor, scheduler;

const s3_event = JSON.stringify({
  Records: [
    {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket-name',
        },
        object: {
          key: 'object-key',
        },
      },
    },
  ],
});

describe('tests for cleanup lambda', () => {
  beforeAll(() => {
    SQS = require('../lambdas/lib/sqs');
    logging = require('../lambdas/lib/logging');
    scheduler = require('../lambdas/events/s3/scheduler');
    processor = require('../lambdas/events/s3/processor');
    jest.mock('../lambdas/lib/sqs');
    jest.mock('../lambdas/lib/logging');
    jest.mock('../lambdas/events/s3/scheduler');
    jest.mock('../lambdas/events/s3/processor');
    jest.spyOn(logging, 'getDaemonLogger').mockImplementation(() => ({
      debug: () => {},
      info: () => {},
    }));
    sendMessage = jest.fn().mockImplementation(() => {});
    SQS.mockImplementation(() => {
      return {
        sendMessage,
      };
    });
    scheduler.run.mockImplementation(() => {});
    processor.run.mockImplementation(() => {});
    lambda = require('../lambdas/events');
  });

  afterEach(() => {
    SQS.mockClear();
    scheduler.run.mockClear();
    processor.run.mockClear();
  });

  it('test S3 event from SNS', async () => {
    expect.assertions(2);
    await lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify({
              Type: 'Notification',
              Message: s3_event,
            }),
          },
        ],
      },
      {}
    );

    expect(scheduler.run).toHaveBeenCalledTimes(1);
    expect(scheduler.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      Object {
        "eventSource": "aws:s3",
        "s3": Object {
          "bucket": Object {
            "name": "bucket-name",
          },
          "object": Object {
            "key": "object-key",
          },
        },
      }
    `);
  });

  it('test S3 event from SQS', async () => {
    expect.assertions(2);
    await lambda.handler(
      {
        Records: [
          {
            body: s3_event,
          },
        ],
      },
      {}
    );

    expect(scheduler.run).toHaveBeenCalledTimes(1);
    expect(scheduler.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      Object {
        "eventSource": "aws:s3",
        "s3": Object {
          "bucket": Object {
            "name": "bucket-name",
          },
          "object": Object {
            "key": "object-key",
          },
        },
      }
    `);
  });

  it('test processor event', async () => {
    expect.assertions(2);
    await lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify({
              resource_id: 'resource_id',
            }),
          },
        ],
      },
      {}
    );

    expect(processor.run).toHaveBeenCalledTimes(1);
    expect(processor.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      Object {
        "resource_id": "resource_id",
      }
    `);
  });
});
