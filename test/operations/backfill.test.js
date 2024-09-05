/* eslint-disable jest/no-hooks */
'use strict';
const bluebird = require('bluebird');

process.env.AWS_MOCKS = true;
jest.requireMock('@aws-sdk/client-s3');
jest.requireMock('@aws-sdk/client-sns');
jest.requireMock('@aws-sdk/client-glue');
jest.requireMock('@aws-sdk/client-athena');
jest.requireMock('@aws-sdk/client-sqs');
jest.requireMock('@aws-sdk/client-sts');
jest.requireMock('@aws-sdk/client-cloudwatch');
const {
  createLambdaQueues,
  setLambdaTriggers,
  clearLambdaTriggers,
} = require('./util');

const { version } = require('../../package.json');
const daemon_lambda = require('../../lambdas/daemon');

jest.mock('../../lambdas/lib/dynamo/operations');
jest.mock('../../lambdas/lib/dynamo/event');
jest.mock('../../lambdas/lib/dynamo/location');
jest.mock('../../lambdas/lib/dynamo/semaphore');
jest.mock('../../lambdas/lib/dynamo/dependency');
jest.mock('../../lambdas/lib/logging');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

const { Athena } = require('@aws-sdk/client-athena');
const { Glue } = require('@aws-sdk/client-glue');
const { SQS } = require('@aws-sdk/client-sqs');
const { S3 } = require('@aws-sdk/client-s3');

const resource = require('../../lambdas/lib/dynamo/operations');
const logging = require('../../lambdas/lib/logging');

const dynamo_resource = require('../../lambdas/lib/dynamo/operations');
const semaphore = require('../../lambdas/lib/dynamo/semaphore');

const glue = new Glue();
const athena = new Athena();
const s3 = new S3();

const CONTEXT = {
  awsRequestId: 'test-request-id',
};

describe('backfill tests', () => {
  beforeAll(async () => {
    bluebird.Promise.config({ cancellation: true });
    s3.__setMockState({
      's3://test-bucket/raw/dt=2021-01-18/data.json': '',
      's3://test-bucket/raw/dt=2021-01-19/data.json': '',
      's3://test-bucket/raw/dt=2021-01-20/data.json': '',
    });
    await athena.createWorkGroup({
      Name: 'wharfie:StackName',
    });
    await glue.createDatabase({
      DatabaseInput: {
        Name: 'test_db',
      },
    });
    await glue.createDatabase({
      DatabaseInput: {
        Name: process.env.TEMPORARY_GLUE_DATABASE,
      },
    });
    await glue.createTable({
      DatabaseName: 'test_db',
      TableInput: {
        Name: 'table_name',
        PartitionKeys: [{ Name: 'dt', Type: 'string' }],
      },
    });
    await glue.createTable({
      DatabaseName: 'test_db',
      TableInput: {
        Name: 'table_name_raw',
        PartitionKeys: [{ Name: 'dt', Type: 'string' }],
      },
    });
    createLambdaQueues();
  });
  beforeEach(() => {
    setLambdaTriggers(CONTEXT);
  });

  afterEach(() => {
    clearLambdaTriggers();
    logging.flush();
  });

  it('end to end', async () => {
    expect.assertions(4);
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'arn:aws:custom:us-east-1:123456789012:wharfie',
      athena_workgroup: 'wharfie:StackName',
      daemon_config: {
        Role: 'test-role',
      },
      source_properties: {
        databaseName: 'test_db',
        name: 'table_name_raw',
        partitionKeys: [{ type: 'string', name: 'dt' }],
        location: 's3://test-bucket/raw/',
      },
      destination_properties: {
        databaseName: 'test_db',
        name: 'table_name',
        partitionKeys: [{ type: 'string', name: 'dt' }],
        location: 's3://test-bucket/compacted/',
      },
      wharfie_version: version,
    });

    await daemon_lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify({
              operation_type: 'BACKFILL',
              operation_started_at: '2016-06-20T12:08:10.000Z',
              action_type: 'START',
              resource_id: 'resource_id',
              action_inputs: {
                Version: `cli`,
                Duration: Infinity,
              },
            }),
          },
        ],
      },
      CONTEXT
    );
    let pollInterval;
    let completed_checks = 0;
    const emptyQueues = new Promise((resolve) => {
      pollInterval = setInterval(() => {
        if (
          (SQS.__state.queues[process.env.DAEMON_QUEUE_URL].queue || [])
            .length === 0 &&
          (SQS.__state.queues[process.env.MONITOR_QUEUE_URL].queue || [])
            .length === 0 &&
          (SQS.__state.queues[process.env.EVENTS_QUEUE_URL].queue || [])
            .length === 0 &&
          (SQS.__state.queues[process.env.CLEANUP_QUEUE_URL].queue || [])
            .length === 0
        ) {
          completed_checks += 1;
          if (completed_checks >= 5) {
            clearInterval(pollInterval);
            resolve();
          }
        } else {
          completed_checks = 0;
        }
      }, 100);
    });
    const timeout = bluebird.Promise.delay(5000).then(() => {
      console.error('Timeout waiting for operation to complete');
    });
    await Promise.race([emptyQueues, timeout]);
    timeout.cancel();
    // eslint-disable-next-line jest/no-large-snapshots
    expect(dynamo_resource.__getMockState()).toMatchInlineSnapshot(`
      {
        "resource_id": {
          "resource_id": {
            "athena_workgroup": "wharfie:StackName",
            "daemon_config": {
              "Role": "test-role",
            },
            "destination_properties": {
              "databaseName": "test_db",
              "location": "s3://test-bucket/compacted/",
              "name": "table_name",
              "partitionKeys": [
                {
                  "name": "dt",
                  "type": "string",
                },
              ],
            },
            "resource_arn": "arn:aws:custom:us-east-1:123456789012:wharfie",
            "resource_id": "resource_id",
            "source_properties": {
              "databaseName": "test_db",
              "location": "s3://test-bucket/raw/",
              "name": "table_name_raw",
              "partitionKeys": [
                {
                  "name": "dt",
                  "type": "string",
                },
              ],
            },
            "wharfie_version": "0.0.1",
          },
        },
      }
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      {
        "wharfie": {
          "limit": Infinity,
          "value": 0,
        },
        "wharfie:BACKFILL:resource_id": {
          "limit": Infinity,
          "value": 0,
        },
      }
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(Glue.__state.test_db).toMatchInlineSnapshot(`
      {
        "_tables": {
          "table_name": {
            "DatabaseName": "test_db",
            "Name": "table_name",
            "PartitionKeys": [
              {
                "Name": "dt",
                "Type": "string",
              },
            ],
            "_partitions": {},
          },
          "table_name_raw": {
            "DatabaseName": "test_db",
            "Name": "table_name_raw",
            "PartitionKeys": [
              {
                "Name": "dt",
                "Type": "string",
              },
            ],
            "_partitions": {
              "2021-01-18": {
                "Parameters": undefined,
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2021-01-18",
                },
                "Values": [
                  "2021-01-18",
                ],
              },
              "2021-01-19": {
                "Parameters": undefined,
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2021-01-19",
                },
                "Values": [
                  "2021-01-19",
                ],
              },
              "2021-01-20": {
                "Parameters": undefined,
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2021-01-20",
                },
                "Values": [
                  "2021-01-20",
                ],
              },
            },
          },
        },
      }
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(SQS.__state).toMatchInlineSnapshot(`
      {
        "queues": {
          "cleanup-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:cleanup-queue",
            },
            "queue": [],
          },
          "daemon-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:daemon-queue",
            },
            "queue": [],
          },
          "events-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:events-queue",
            },
            "queue": [],
          },
          "monitor-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:monitor-queue",
            },
            "queue": [],
          },
        },
      }
    `);
  }, 10000);
});
