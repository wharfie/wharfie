/* eslint-disable jest/no-hooks */
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SchedulerEntry = require('../lambdas/scheduler/scheduler-entry');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../package.json', () => ({ version: '0.0.1' }));

let lambda, SQS, sendMessage, processor, scheduler;

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

const eventbridge_event = JSON.stringify({
  version: '0',
  id: '9bac4556-4c69-175a-d786-656f90d252ef',
  'detail-type': 'Object Created',
  source: 'aws.s3',
  account: '079185815456',
  time: '2024-03-19T16:17:37Z',
  region: 'us-west-2',
  resources: ['arn:aws:s3:::utility-079185815456-us-west-2'],
  detail: {
    version: '0',
    bucket: { name: 'utility-079185815456-us-west-2' },
    object: {
      key: 'test/hello.json',
      size: 125,
      etag: 'd7f267f12b3291f8556ac4fa6b71bfc5',
      sequencer: '0065F9BAA13E1D7E33',
    },
    'request-id': 'Y0Y7B8W4RE3ZP99E',
    requester: '079185815456',
    'source-ip-address': '87.249.134.33',
    reason: 'PutObject',
  },
  retries: 7,
});

describe('tests for events lambda', () => {
  beforeAll(() => {
    SQS = require('../lambdas/lib/sqs');
    scheduler = require('../lambdas/scheduler/scheduler');
    processor = require('../lambdas/scheduler/events/s3/processor');
    jest.mock('../lambdas/lib/sqs');
    jest.mock('../lambdas/scheduler/scheduler');
    jest.mock('../lambdas/scheduler/events/s3/processor');
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

    expect(processor.run).toHaveBeenCalledTimes(1);
    expect(processor.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      {
        "bucket": "bucket-name",
        "key": "object-key",
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

    expect(processor.run).toHaveBeenCalledTimes(1);
    expect(processor.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      {
        "bucket": "bucket-name",
        "key": "object-key",
      }
    `);
  });

  it('test S3 event from eventbridge', async () => {
    expect.assertions(2);

    await lambda.handler(
      {
        Records: [
          {
            body: eventbridge_event,
          },
        ],
      },
      {}
    );

    expect(processor.run).toHaveBeenCalledTimes(1);
    expect(processor.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      {
        "bucket": "utility-079185815456-us-west-2",
        "key": "test/hello.json",
      }
    `);
  });

  it('test processor event', async () => {
    expect.assertions(2);

    await lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify(
              new SchedulerEntry({
                resource_id: 'resource_id',
                sort_key: 'sort_key',
              }).toEvent()
            ),
          },
        ],
      },
      {}
    );

    expect(scheduler.run).toHaveBeenCalledTimes(1);
    expect(scheduler.run.mock.calls[0][0]).toMatchInlineSnapshot(`
      SchedulerEntry {
        "partition": undefined,
        "resource_id": "resource_id",
        "retries": 0,
        "sort_key": "sort_key",
        "status": "SCHEDULED",
        "ttl": undefined,
        "version": "0.0.1",
      }
    `);
  });
});
