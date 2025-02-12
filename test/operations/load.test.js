/* eslint-disable jest/no-hooks */
'use strict';

// process.env.LOGGING_LEVEL = 'debug';
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

jest.mock('../../lambdas/lib/dynamo/operations');
jest.mock('../../lambdas/lib/dynamo/scheduler');
jest.mock('../../lambdas/lib/dynamo/location');
jest.mock('../../lambdas/lib/dynamo/semaphore');
jest.mock('../../lambdas/lib/dynamo/dependency');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

const daemon_lambda = require('../../lambdas/daemon');

const { Athena } = require('@aws-sdk/client-athena');
const { Glue } = require('@aws-sdk/client-glue');
const { SQS } = require('@aws-sdk/client-sqs');
const { Resource } = require('../../lambdas/lib/graph');
const { S3 } = require('@aws-sdk/client-s3');

const operations = require('../../lambdas/lib/dynamo/operations');
const semaphore = require('../../lambdas/lib/dynamo/semaphore');

const glue = new Glue();
const athena = new Athena();
const s3 = new S3();

const CONTEXT = {
  awsRequestId: 'test-request-id',
};

describe('s3 event tests', () => {
  beforeAll(async () => {
    s3.__setMockState({
      's3://test-bucket/raw/dt=2016-06-20/data.json': '',
    });
    bluebird.Promise.config({ cancellation: true });
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
        StorageDescriptor: {
          Location: 's3://test-bucket/compacted/',
        },
      },
    });
    await glue.createTable({
      DatabaseName: 'test_db',
      TableInput: {
        Name: 'table_name_raw',
        PartitionKeys: [{ Name: 'dt', Type: 'string' }],
        StorageDescriptor: {
          Location: 's3://test-bucket/raw/',
        },
      },
    });
    createLambdaQueues();
  });
  beforeEach(() => {
    setLambdaTriggers(CONTEXT);
  });

  afterEach(async () => {
    clearLambdaTriggers();
  });

  it('end to end', async () => {
    expect.assertions(6);

    await operations.putResource(
      new Resource({
        id: 'resource_id',
        status: Resource.Status.ACTIVE,
        region: 'us-east-1',
        athena_workgroup: 'wharfie:StackName',
        daemon_config: {
          Role: 'test-role',
        },
        source_properties: {
          location: 's3://test-bucket/raw/',
          arn: 'SourceArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          databaseName: 'test_db',
          name: 'table_name_raw',
          description: 'SourceDescription',
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          partitionKeys: [{ type: 'string', name: 'dt' }],
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
        destination_properties: {
          databaseName: 'test_db',
          name: 'table_name',
          partitionKeys: [{ type: 'string', name: 'dt' }],
          location: 's3://test-bucket/compacted/',
          arn: 'DestinationArn',
          catalogId: 'SourceCatalogId',
          columns: [],
          compressed: false,
          parameters: {},
          numberOfBuckets: 0,
          storedAsSubDirectories: false,
          region: 'us-east-1',
          tableType: 'PHYSICAL',
          tags: {},
        },
      })
    );

    await daemon_lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify({
              operation_type: 'LOAD',
              operation_started_at: '2016-06-20T12:08:10.000Z',
              action_type: 'START',
              resource_id: 'resource_id',
              operation_inputs: {
                partition: {
                  location: 's3://test-bucket/raw/dt=2016-06-20/',
                  partitionValues: {
                    dt: '2016-06-20',
                  },
                },
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
    expect(Object.keys(operations.__getMockState())).toMatchInlineSnapshot(`
      [
        "resource_id",
      ]
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      {
        "wharfie": {
          "limit": Infinity,
          "value": 0,
        },
        "wharfie:LOAD:resource_id": {
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
            "StorageDescriptor": {
              "Location": "s3://test-bucket/compacted/",
            },
            "_partitions": {
              "2016-06-20": {
                "Parameters": undefined,
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/compacted/dt=2016-06-20/",
                },
                "Values": [
                  "2016-06-20",
                ],
              },
            },
            "tags": {},
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
            "StorageDescriptor": {
              "Location": "s3://test-bucket/raw/",
            },
            "_partitions": {
              "2016-06-20": {
                "Parameters": undefined,
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2016-06-20/",
                },
                "Values": [
                  "2016-06-20",
                ],
              },
            },
            "tags": {},
          },
        },
        "tags": {},
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
            "Tags": {},
            "queue": [],
          },
          "daemon-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:daemon-queue",
            },
            "Tags": {},
            "queue": [],
          },
          "events-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:events-queue",
            },
            "Tags": {},
            "queue": [],
          },
          "monitor-queue": {
            "Attributes": {
              "QueueArn": "arn:aws:sqs:us-east-1:123456789012:monitor-queue",
            },
            "Tags": {},
            "queue": [],
          },
        },
      }
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(glue.__getMockState().test_db._tables.table_name)
      .toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "Name": "table_name",
        "PartitionKeys": [
          {
            "Name": "dt",
            "Type": "string",
          },
        ],
        "StorageDescriptor": {
          "Location": "s3://test-bucket/compacted/",
        },
        "_partitions": {
          "2016-06-20": {
            "Parameters": undefined,
            "StorageDescriptor": {
              "Location": "s3://test-bucket/compacted/dt=2016-06-20/",
            },
            "Values": [
              "2016-06-20",
            ],
          },
        },
        "tags": {},
      }
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(glue.__getMockState().test_db._tables.table_name_raw)
      .toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "Name": "table_name_raw",
        "PartitionKeys": [
          {
            "Name": "dt",
            "Type": "string",
          },
        ],
        "StorageDescriptor": {
          "Location": "s3://test-bucket/raw/",
        },
        "_partitions": {
          "2016-06-20": {
            "Parameters": undefined,
            "StorageDescriptor": {
              "Location": "s3://test-bucket/raw/dt=2016-06-20/",
            },
            "Values": [
              "2016-06-20",
            ],
          },
        },
        "tags": {},
      }
    `);
  }, 10000);
});
