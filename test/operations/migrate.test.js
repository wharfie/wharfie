/* eslint-disable jest/no-hooks */
'use strict';
// process.env.LOGGING_LEVEL = 'debug';
const bluebird = require('bluebird');

process.env.AWS_MOCKS = true;
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
jest.mock('../../lambdas/lib/dynamo/state');
jest.mock('../../lambdas/lib/env-paths');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

const { Glue } = require('@aws-sdk/client-glue');
const { SQS } = require('@aws-sdk/client-sqs');
const { S3 } = require('@aws-sdk/client-s3');

const resource_db = require('../../lambdas/lib/dynamo/operations');
const semaphore = require('../../lambdas/lib/dynamo/semaphore');
const state_db = require('../../lambdas/lib/dynamo/state');
const scheduler_db = require('../../lambdas/lib/dynamo/scheduler');

const WharfieResource = require('../../lambdas/lib/actor/resources/wharfie-resource');
const Reconcilable = require('../../lambdas/lib/actor/resources/reconcilable');

const glue = new Glue();
const s3 = new S3();

const CONTEXT = {
  awsRequestId: 'test-request-id',
};

describe('migrate tests', () => {
  beforeAll(async () => {
    bluebird.Promise.config({ cancellation: true });

    createLambdaQueues();
    s3.__setMockState({
      's3://test-bucket/raw/dt=2021-01-18/data.json': '',
      's3://test-bucket/raw/dt=2021-01-19/data.json': '',
      's3://test-bucket/raw/dt=2021-01-20/data.json': '',
    });

    await glue.createDatabase({
      DatabaseInput: {
        Name: 'test-wharfie-resource',
      },
    });
    await glue.createDatabase({
      DatabaseInput: {
        Name: process.env.TEMPORARY_GLUE_DATABASE,
      },
    });
  });
  beforeEach(() => {
    setLambdaTriggers(CONTEXT);
  });

  afterEach(() => {
    clearLambdaTriggers();
  });

  it('end to end', async () => {
    expect.assertions(6);

    const wharfieResource = new WharfieResource({
      name: 'amazon_berkely_objects',
      properties: {
        catalogId: '1234',
        columns: [],
        compressed: undefined,
        createdAt: 123456789,
        scheduleQueueUrl: process.env.EVENTS_QUEUE_URL,
        daemonQueueUrl: process.env.DAEMON_QUEUE_URL,
        databaseName: 'test-wharfie-resource',
        dependencyTable: process.env.DEPENDENCY_TABLE,
        deployment: {
          accountId: '1234',
          envPaths: {
            cache: 'mock',
            config: 'mock',
            data: 'mock',
            log: 'mock',
            temp: 'mock',
          },
          name: 'test-deployment',
          region: 'us-west-2',
          stateTable: 'test-deployment-state',
          version: '0.0.1',
        },
        description:
          'Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        inputLocation: 's3://test-bucket/raw/',
        interval: 300,
        locationTable: process.env.LOCATION_TABLE,
        migrationResource: false,
        numberOfBuckets: 0,
        operationTable: process.env.OPERATIONS_TABLE,
        outputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        outputLocation: 's3://test-bucket/processed/',
        parameters: {
          EXTERNAL: 'true',
        },
        partitionKeys: [
          {
            name: 'dt',
            type: 'string',
          },
        ],
        project: {
          name: 'test-wharfie-resource',
        },
        projectBucket: 'test-bucket',
        projectName: 'test-wharfie-resource',
        region: 'us-west-2',
        resourceId: 'test-wharfie-resource.amazon_berkely_objects',
        resourceName: 'amazon_berkely_objects',
        roleArn:
          'arn:aws:iam::123456789012:role/test-wharfie-resource-project-role',
        scheduleQueueArn:
          'arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue',
        scheduleRoleArn:
          'arn:aws:iam::123456789012:role/test-deployment-event-role',
        serdeInfo: {
          Parameters: {
            'ignore.malformed.json': 'true',
          },
          SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
        },
        storedAsSubDirectories: true,
        tableType: 'EXTERNAL_TABLE',
      },
    });
    await wharfieResource.reconcile();
    wharfieResource.set('columns', [
      {
        name: 'new_column',
        type: 'string',
      },
    ]);
    wharfieResource.setStatus(Reconcilable.Status.DRIFTED);
    const reconcilePromise = wharfieResource.reconcile();

    let pollInterval;
    let completed_checks = 0;
    const emptyQueues = new Promise((resolve) => {
      pollInterval = setInterval(() => {
        if (
          (SQS.__state.queues[process.env.DAEMON_QUEUE_URL].queue || [])
            .length === 0 &&
          (SQS.__state.queues[process.env.MONITOR_QUEUE_URL].queue || [])
            .length === 0 &&
          // (SQS.__state.queues[process.env.EVENTS_QUEUE_URL].queue || [])
          //   .length === 0 &&
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
    await reconcilePromise;

    expect(Object.keys(resource_db.__getMockState())).toMatchInlineSnapshot(`
      [
        "test-wharfie-resource.amazon_berkely_objects",
      ]
    `);
    expect(Object.keys(state_db.__getMockState()['test-deployment']))
      .toMatchInlineSnapshot(`
      [
        "amazon_berkely_objects",
        "amazon_berkely_objects#wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "amazon_berkely_objects#amazon_berkely_objects_raw",
        "amazon_berkely_objects#amazon_berkely_objects",
        "amazon_berkely_objects#test-wharfie-resource-amazon_berkely_objects-resource-record",
        "amazon_berkely_objects#test-wharfie-resource-amazon_berkely_objects-location-record",
      ]
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      {
        "wharfie": {
          "limit": Infinity,
          "value": 0,
        },
        "wharfie:BACKFILL:test-wharfie-resource.amazon_berkely_objects": {
          "limit": Infinity,
          "value": 0,
        },
        "wharfie:MIGRATE:test-wharfie-resource.amazon_berkely_objects": {
          "limit": Infinity,
          "value": 0,
        },
      }
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(Glue.__state).toMatchInlineSnapshot(`
      {
        "temp-glue-database": {
          "_tables": {},
          "tags": {},
        },
        "test-wharfie-resource": {
          "_tables": {
            "amazon_berkely_objects": {
              "DatabaseName": "test-wharfie-resource",
              "Description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "Name": "amazon_berkely_objects",
              "Parameters": {
                "EXTERNAL": "TRUE",
                "parquet.compress": "GZIP",
              },
              "PartitionKeys": [
                {
                  "Comment": undefined,
                  "Name": "dt",
                  "Type": "string",
                },
              ],
              "StorageDescriptor": {
                "Columns": [
                  {
                    "Comment": undefined,
                    "Name": "new_column",
                    "Type": "string",
                  },
                ],
                "Compressed": true,
                "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                "Location": "s3://test-bucket/migrate_amazon_berkely_objects/migrate-references/",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                "SerdeInfo": {
                  "Parameters": {
                    "parquet.compress": "GZIP",
                  },
                  "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                },
                "StoredAsSubDirectories": false,
              },
              "TableType": "EXTERNAL_TABLE",
              "ViewExpandedText": undefined,
              "ViewOriginalText": undefined,
              "_partitions": {},
              "tags": {},
            },
            "amazon_berkely_objects_raw": {
              "DatabaseName": "test-wharfie-resource",
              "Description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "Name": "amazon_berkely_objects_raw",
              "Parameters": {
                "EXTERNAL": "true",
              },
              "PartitionKeys": [
                {
                  "Comment": undefined,
                  "Name": "dt",
                  "Type": "string",
                },
              ],
              "StorageDescriptor": {
                "Columns": [
                  {
                    "Comment": undefined,
                    "Name": "new_column",
                    "Type": "string",
                  },
                ],
                "Compressed": undefined,
                "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                "Location": "s3://test-bucket/raw/",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                "SerdeInfo": {
                  "Parameters": {
                    "ignore.malformed.json": "true",
                  },
                  "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                },
                "StoredAsSubDirectories": true,
              },
              "TableType": "EXTERNAL_TABLE",
              "ViewExpandedText": undefined,
              "ViewOriginalText": undefined,
              "_partitions": {
                "2021-01-18": {
                  "Parameters": {
                    "EXTERNAL": "true",
                  },
                  "StorageDescriptor": {
                    "Columns": [
                      {
                        "Comment": undefined,
                        "Name": "new_column",
                        "Type": "string",
                      },
                    ],
                    "Compressed": undefined,
                    "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "Location": "s3://test-bucket/raw/dt=2021-01-18",
                    "NumberOfBuckets": 0,
                    "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "SerdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "StoredAsSubDirectories": true,
                  },
                  "Values": [
                    "2021-01-18",
                  ],
                },
                "2021-01-19": {
                  "Parameters": {
                    "EXTERNAL": "true",
                  },
                  "StorageDescriptor": {
                    "Columns": [
                      {
                        "Comment": undefined,
                        "Name": "new_column",
                        "Type": "string",
                      },
                    ],
                    "Compressed": undefined,
                    "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "Location": "s3://test-bucket/raw/dt=2021-01-19",
                    "NumberOfBuckets": 0,
                    "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "SerdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "StoredAsSubDirectories": true,
                  },
                  "Values": [
                    "2021-01-19",
                  ],
                },
                "2021-01-20": {
                  "Parameters": {
                    "EXTERNAL": "true",
                  },
                  "StorageDescriptor": {
                    "Columns": [
                      {
                        "Comment": undefined,
                        "Name": "new_column",
                        "Type": "string",
                      },
                    ],
                    "Compressed": undefined,
                    "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "Location": "s3://test-bucket/raw/dt=2021-01-20",
                    "NumberOfBuckets": 0,
                    "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "SerdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "StoredAsSubDirectories": true,
                  },
                  "Values": [
                    "2021-01-20",
                  ],
                },
              },
              "tags": {},
            },
          },
          "tags": {},
        },
      }
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(SQS.__state.queues['monitor-queue']).toMatchInlineSnapshot(`
      {
        "Attributes": {
          "QueueArn": "arn:aws:sqs:us-east-1:123456789012:monitor-queue",
        },
        "Tags": {},
        "queue": [],
      }
    `);
    expect(SQS.__state.queues['daemon-queue']).toMatchInlineSnapshot(`
      {
        "Attributes": {
          "QueueArn": "arn:aws:sqs:us-east-1:123456789012:daemon-queue",
        },
        "Tags": {},
        "queue": [],
      }
    `);
  }, 20000);
});
