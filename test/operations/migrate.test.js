/* eslint-disable jest/no-hooks */
'use strict';
process.env.LOGGING_LEVEL = 'debug';
const bluebird = require('bluebird');

process.env.AWS_MOCKS = true;
const {
  createLambdaQueues,
  setLambdaTriggers,
  clearLambdaTriggers,
  clearEventsTrigger,
} = require('./util');
const { resetAWSMocks } = require('../util');

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
  });
  beforeEach(async () => {
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
    setLambdaTriggers(CONTEXT);
    // disables backfill events from scheduling which can cause flakes
    clearEventsTrigger();
  });

  afterEach(() => {
    clearLambdaTriggers();
    resetAWSMocks();
  });

  it.only('no-partitions', async () => {
    expect.assertions(7);
    const events = [];
    Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
      events.push(`${event.status} - ${event.constructor}:${event.name}`);
    });
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
    events.push('RECONCILING');
    await wharfieResource.reconcile();

    events.push('MODIFYING');
    wharfieResource.set('columns', [
      {
        name: 'new_column',
        type: 'string',
      },
    ]);
    events.push('RECONCILING');
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
    // eslint-disable-next-line jest/no-large-snapshots
    expect(events).toMatchInlineSnapshot(`
      [
        "UNPROVISIONED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "RECONCILING",
        "RECONCILING - WharfieResource:amazon_berkely_objects",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects",
        "RECONCILING - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "RECONCILING - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_raw",
        "STABLE - GlueTable:amazon_berkely_objects",
        "STABLE - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "STABLE - WharfieResource:amazon_berkely_objects",
        "MODIFYING",
        "DRIFTED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "RECONCILING",
        "RECONCILING - WharfieResource:amazon_berkely_objects",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_raw",
        "STABLE - GlueTable:amazon_berkely_objects",
        "DRIFTED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResource:amazon_berkely_objects_migrate",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_migrate_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_migrate_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_migrate",
        "DRIFTED - GlueTable:amazon_berkely_objects_migrate",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "RECONCILING - WharfieResource:amazon_berkely_objects_migrate",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_migrate_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects_migrate",
        "RECONCILING - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "RECONCILING - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "STABLE - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_migrate_raw",
        "STABLE - GlueTable:amazon_berkely_objects_migrate",
      ]
    `);

    expect(Object.keys(resource_db.__getMockState())).toMatchInlineSnapshot(`
      [
        "test-wharfie-resource.amazon_berkely_objects",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#b5m2m9nngg55yowy53pfp0op",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#fjt1de1zuhp0eu8dvjm2u6ix",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#yyr1ltpbtvidto7b01k9sno6",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#zlltu9xrfvy766l3q3arb4t8",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#sevf94o15hvza061vwu8uxe6",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#r65c4f08gxah344pylthojux",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#rbs5ole52ewyd3233n1v4lqj",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#b5ye0ssx9273o2j1o4s3mpp0",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#iqyeeynzvpf9q3heveps0aue",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#ifx0uijxrju5em3etnsmm5qj",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#ma30pbaqna1o3fhafm45qgpv",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#bcc9fbhbfcfmtivk0x1nvng3",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#rkfueb3q7sghqxc37yns84d3",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#a0wkm4p6ugbb6dg9wgyutgjy",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9",
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
        "amazon_berkely_objects_migrate",
        "amazon_berkely_objects_migrate#wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "amazon_berkely_objects_migrate#amazon_berkely_objects_migrate_raw",
        "amazon_berkely_objects_migrate#amazon_berkely_objects_migrate",
        "amazon_berkely_objects_migrate#test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "amazon_berkely_objects_migrate#test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
      ]
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`{}`);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(Glue.__state).toMatchInlineSnapshot(`
      {
        "temp-glue-database": {
          "_tables": {
            "amazon_berkely_objects_migrate": {
              "DatabaseName": "temp-glue-database",
              "Description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "Name": "amazon_berkely_objects_migrate",
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
                "Location": "s3://test-bucket/processed/migrate-references/",
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
            "amazon_berkely_objects_migrate_raw": {
              "DatabaseName": "temp-glue-database",
              "Description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "Name": "amazon_berkely_objects_migrate_raw",
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
              "_partitions": {},
              "tags": {},
            },
          },
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
                "Location": "s3://test-bucket/processed/references/",
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
              "_partitions": {},
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

  it('partitions', async () => {
    expect.assertions(7);
    const events = [];
    Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
      events.push(`${event.status} - ${event.constructor}:${event.name}`);
    });
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
    events.push('RECONCILING');
    await wharfieResource.reconcile();

    events.push('MODIFYING');
    s3.__setMockState({
      's3://test-bucket/raw/foo=2021-01-18/data.json': '',
      's3://test-bucket/raw/foo=2021-01-19/data.json': '',
      's3://test-bucket/raw/foo=2021-01-20/data.json': '',
    });
    wharfieResource.set('partitionKeys', [
      {
        name: 'foo',
        type: 'string',
      },
    ]);
    events.push('RECONCILING');
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
    // eslint-disable-next-line jest/no-large-snapshots
    expect(events).toMatchInlineSnapshot(`
      [
        "UNPROVISIONED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "RECONCILING",
        "RECONCILING - WharfieResource:amazon_berkely_objects",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects",
        "RECONCILING - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "RECONCILING - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_raw",
        "STABLE - GlueTable:amazon_berkely_objects",
        "STABLE - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "STABLE - WharfieResource:amazon_berkely_objects_migrate",
        "STABLE - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "DRIFTED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - WharfieResource:amazon_berkely_objects",
        "MODIFYING",
        "DRIFTED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "RECONCILING",
        "RECONCILING - WharfieResource:amazon_berkely_objects",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_raw",
        "STABLE - GlueTable:amazon_berkely_objects",
        "DRIFTED - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects",
        "DRIFTED - GlueTable:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects-workgroup",
        "STABLE - WharfieResource:amazon_berkely_objects",
        "UNPROVISIONED - WharfieResource:amazon_berkely_objects_migrate",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_migrate_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_migrate_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_migrate",
        "DRIFTED - GlueTable:amazon_berkely_objects_migrate",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "RECONCILING - WharfieResource:amazon_berkely_objects_migrate",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_migrate_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects_migrate",
        "RECONCILING - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "RECONCILING - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "STABLE - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_migrate_raw",
        "STABLE - GlueTable:amazon_berkely_objects_migrate",
        "UNPROVISIONED - WharfieResource:amazon_berkely_objects_migrate",
        "UNPROVISIONED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_migrate_raw",
        "DRIFTED - GlueTable:amazon_berkely_objects_migrate_raw",
        "UNPROVISIONED - GlueTable:amazon_berkely_objects_migrate",
        "DRIFTED - GlueTable:amazon_berkely_objects_migrate",
        "UNPROVISIONED - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "UNPROVISIONED - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "RECONCILING - WharfieResource:amazon_berkely_objects_migrate",
        "RECONCILING - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "RECONCILING - GlueTable:amazon_berkely_objects_migrate_raw",
        "RECONCILING - GlueTable:amazon_berkely_objects_migrate",
        "RECONCILING - WharfieResourceRecord:test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "RECONCILING - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "DRIFTED - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "STABLE - LocationRecord:test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
        "STABLE - AthenaWorkGroup:wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "STABLE - GlueTable:amazon_berkely_objects_migrate_raw",
        "STABLE - GlueTable:amazon_berkely_objects_migrate",
      ]
    `);

    expect(Object.keys(resource_db.__getMockState())).toMatchInlineSnapshot(`
      [
        "test-wharfie-resource.amazon_berkely_objects",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#b5m2m9nngg55yowy53pfp0op",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#fjt1de1zuhp0eu8dvjm2u6ix",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#yyr1ltpbtvidto7b01k9sno6",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#zlltu9xrfvy766l3q3arb4t8",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#sevf94o15hvza061vwu8uxe6",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#r65c4f08gxah344pylthojux",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#rbs5ole52ewyd3233n1v4lqj",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#b5ye0ssx9273o2j1o4s3mpp0",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#iqyeeynzvpf9q3heveps0aue",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#ifx0uijxrju5em3etnsmm5qj",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#ma30pbaqna1o3fhafm45qgpv",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#bcc9fbhbfcfmtivk0x1nvng3",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#rkfueb3q7sghqxc37yns84d3",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9#a0wkm4p6ugbb6dg9wgyutgjy",
        "test-wharfie-resource.amazon_berkely_objects#bego8ibe4e0ojzyoe2lqusb9",
        "temp-glue-database.amazon_berkely_objects_migrate",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#t383soh1sq1jiune8nszqh3r",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#q1gdwldjdnokwys4qrgdwh2j",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#olduy8yfypg58wzyh3004r3z",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#svfz9psswbztu1t658soan6w",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#lxh5dxt2cet8rx2wm858r3zv",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#e11tz6nxtotrvffhorf0bu8b",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#oyzxqkol2p5c8l2g5836z0a4",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#wytqbs30f93oclplmryy3zme",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#du6vi4xnx53s6qpxqubt2r6g",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#yv1f7epindo80uhyge71k1mu",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#rt6zj5f5q2g3xgrrmltdd9hu",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#iriw9i2rs9ssng5n5atvwi7f",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#ovw9ftmbx9fsawlsscilhm6u",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i#snolz42qvwdhfdrrvlgsu31o",
        "test-wharfie-resource.amazon_berkely_objects#wlqj3w53z4na0i8ql45ghl0i",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#lz6vxa9jgn2ylgw6s216fhdq",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#vtgh70tev2pfm6auwfzgjilk",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#z986jxz6uqz62ycu3p7uwimc",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#mnim9agi7n4gad1zin4wpyyt",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#c4oz3h7duytup8nhnz0ly2lg",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#qv8l13ikm39whi05it2mpcbs",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#mok2v5ptsim2v4w9sbrdti6s",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#x8zn90munqhluvt591ax8dua",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#ybrlt1aynv8lf98arn1jbtfj",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#wtmzi7s20aliv14y0t7yid8d",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#fs30xat9pkobnrameox88gsr",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#azoznnov0gjrrolwvl4nb45k",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#q2h5mhqbdyvkaix9f76q34xh",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx#l401ox0xlp54vpocy6qft5zq",
        "test-wharfie-resource.amazon_berkely_objects#wdf75op6hlr408pzp9tm0ypx",
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
        "amazon_berkely_objects_migrate",
        "amazon_berkely_objects_migrate#wharfie-test-deployment-amazon_berkely_objects_migrate-workgroup",
        "amazon_berkely_objects_migrate#amazon_berkely_objects_migrate_raw",
        "amazon_berkely_objects_migrate#amazon_berkely_objects_migrate",
        "amazon_berkely_objects_migrate#test-wharfie-resource-amazon_berkely_objects_migrate-resource-record",
        "amazon_berkely_objects_migrate#test-wharfie-resource-amazon_berkely_objects_migrate-location-record",
      ]
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`{}`);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(Glue.__state).toMatchInlineSnapshot(`
      {
        "temp-glue-database": {
          "_tables": {
            "amazon_berkely_objects_migrate": {
              "DatabaseName": "temp-glue-database",
              "Description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "Name": "amazon_berkely_objects_migrate",
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
                "Columns": [],
                "Compressed": true,
                "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                "Location": "s3://test-bucket/processed/migrate-references/",
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
            "amazon_berkely_objects_migrate_raw": {
              "DatabaseName": "temp-glue-database",
              "Description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "Name": "amazon_berkely_objects_migrate_raw",
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
                "Columns": [],
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
              "_partitions": {},
              "tags": {},
            },
          },
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
                  "Name": "foo",
                  "Type": "string",
                },
              ],
              "StorageDescriptor": {
                "Columns": [],
                "Compressed": true,
                "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                "Location": "s3://test-bucket/processed/references/",
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
                  "Name": "foo",
                  "Type": "string",
                },
              ],
              "StorageDescriptor": {
                "Columns": [],
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
              "_partitions": {},
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
