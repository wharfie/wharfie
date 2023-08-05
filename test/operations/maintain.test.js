/* eslint-disable jest/no-hooks */
'use strict';
const bluebird = require('bluebird');

process.env.AWS_MOCKS = true;
process.env.TEMP_FILES_BUCKET = 'wharfie-tests-temp-files';
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

jest.mock('../../lambdas/lib/dynamo/resource');
jest.mock('../../lambdas/lib/dynamo/event');
jest.mock('../../lambdas/lib/dynamo/location');
jest.mock('../../lambdas/lib/dynamo/semaphore');
jest.mock('../../lambdas/lib/logging');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

const daemon_lambda = require('../../lambdas/daemon');

const { Athena } = require('@aws-sdk/client-athena');
const { Glue } = require('@aws-sdk/client-glue');
const { SQS } = require('@aws-sdk/client-sqs');
const { S3 } = require('@aws-sdk/client-s3');

const resource = require('../../lambdas/lib/dynamo/resource');
const logging = require('../../lambdas/lib/logging');

const dynamo_resource = require('../../lambdas/lib/dynamo/resource');
const semaphore = require('../../lambdas/lib/dynamo/semaphore');

const glue = new Glue();
const athena = new Athena();
const s3 = new S3();

const CONTEXT = {
  awsRequestId: 'test-request-id',
};

describe('maintain tests', () => {
  beforeAll(async () => {
    bluebird.Promise.config({ cancellation: true });
    s3.__setMockState({
      's3://test-bucket/raw/dt=2021-01-20/data.json': '',
    });
    await athena.createWorkGroup({
      Name: 'Wharfie:StackName',
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
  beforeEach(async () => {
    setLambdaTriggers(CONTEXT);
  });

  afterEach(() => {
    clearLambdaTriggers();
    logging.flush(CONTEXT);
  });

  it('end to end', async () => {
    expect.assertions(4);
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'arn:aws:custom:us-east-1:123456789012:wharfie',
      athena_workgroup: 'Wharfie:StackName',
      daemon_config: {
        Role: 'test-role',
      },
      source_properties: {
        DatabaseName: 'test_db',
        TableInput: {
          Name: 'table_name_raw',
          PartitionKeys: [{ Type: 'string', Name: 'dt' }],
          StorageDescriptor: {
            Location: 's3://test-bucket/raw/',
          },
        },
      },
      destination_properties: {
        DatabaseName: 'test_db',
        TableInput: {
          Name: 'table_name',
          PartitionKeys: [{ Type: 'string', Name: 'dt' }],
          StorageDescriptor: {
            Location: 's3://test-bucket/compacted/',
          },
        },
      },
      wharfie_version: version,
    });

    await daemon_lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify({
              operation_type: 'MAINTAIN',
              operation_started_at: '2016-06-20T12:08:10.000Z',
              action_type: 'START',
              resource_id: 'resource_id',
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
          (SQS.__state.queues[process.env.DAEMON_QUEUE_URL] || []).length ===
            0 &&
          (SQS.__state.queues[process.env.MONITOR_QUEUE_URL] || []).length ===
            0 &&
          (SQS.__state.queues[process.env.EVENTS_QUEUE_URL] || []).length ===
            0 &&
          (SQS.__state.queues[process.env.CLEANUP_QUEUE_URL] || []).length === 0
        ) {
          completed_checks += 1;
          if (completed_checks >= 5) {
            clearInterval(pollInterval);
            resolve();
          }
        } else {
          completed_checks = 0;
        }
      }, 500);
    });
    const timeout = bluebird.Promise.delay(5000).then(() => {
      console.error('Timeout waiting for operation to complete');
    });
    await Promise.race([emptyQueues, timeout]);
    timeout.cancel();
    // eslint-disable-next-line jest/no-large-snapshots
    expect(dynamo_resource.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "resource_id": Object {
          "resource_id": Object {
            "athena_workgroup": "Wharfie:StackName",
            "daemon_config": Object {
              "Role": "test-role",
            },
            "destination_properties": Object {
              "DatabaseName": "test_db",
              "TableInput": Object {
                "Name": "table_name",
                "PartitionKeys": Array [
                  Object {
                    "Name": "dt",
                    "Type": "string",
                  },
                ],
                "StorageDescriptor": Object {
                  "Location": "s3://test-bucket/compacted/",
                },
              },
            },
            "resource_arn": "arn:aws:custom:us-east-1:123456789012:wharfie",
            "resource_id": "resource_id",
            "source_properties": Object {
              "DatabaseName": "test_db",
              "TableInput": Object {
                "Name": "table_name_raw",
                "PartitionKeys": Array [
                  Object {
                    "Name": "dt",
                    "Type": "string",
                  },
                ],
                "StorageDescriptor": Object {
                  "Location": "s3://test-bucket/raw/",
                },
              },
            },
            "wharfie_version": "0.0.1",
          },
        },
      }
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "wharfie": Object {
          "limit": Infinity,
          "value": 0,
        },
        "wharfie:MAINTAIN:resource_id": Object {
          "limit": Infinity,
          "value": 0,
        },
      }
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(Glue.__state.test_db).toMatchInlineSnapshot(`
      Object {
        "_tables": Object {
          "table_name": Object {
            "DatabaseName": "test_db",
            "Name": "table_name",
            "PartitionKeys": Array [
              Object {
                "Name": "dt",
                "Type": "string",
              },
            ],
            "_partitions": Object {},
          },
          "table_name_raw": Object {
            "DatabaseName": "test_db",
            "Name": "table_name_raw",
            "PartitionKeys": Array [
              Object {
                "Name": "dt",
                "Type": "string",
              },
            ],
            "_partitions": Object {
              "2021-01-20": Object {
                "Parameters": undefined,
                "StorageDescriptor": Object {
                  "Location": "s3://test-bucket/raw/dt=2021-01-20",
                },
                "Values": Array [
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
      Object {
        "queues": Object {
          "cleanup-queue": Array [],
          "daemon-queue": Array [],
          "events-queue": Array [],
          "monitor-queue": Array [],
        },
      }
    `);
  }, 10000);
});
