/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');
jest.mock('../../lambdas/lib/dynamo/state');
jest.mock('../../lambdas/lib/dynamo/operations');
jest.mock('../../lambdas/lib/dynamo/dependency');
jest.mock('../../lambdas/lib/dynamo/location');
const WharfieResource = require('../../lambdas/lib/actor/resources/wharfie-resource');
const Reconcilable = require('../../lambdas/lib/actor/resources/reconcilable');
const { load } = require('../../lambdas/lib/actor/deserialize');
const { resetAWSMocks } = require('../util');
const state_db = require('../../lambdas/lib/dynamo/state');

const { S3 } = require('@aws-sdk/client-s3');
const { SQS } = require('@aws-sdk/client-sqs');
const { Glue } = require('@aws-sdk/client-glue');
const s3 = new S3();
const sqs = new SQS();
const glue = new Glue();

const DAEMON_QUEUE_URL = `https://sqs.us-west-2.amazonaws.com/1234/wharfie-testing-daemon-queue`;
const SCHEDULE_QUEUE_URL = `https://sqs.us-west-2.amazonaws.com/1234/wharfie-testing-events-queue`;

describe('wharfie resource IaC', () => {
  afterEach(() => {
    resetAWSMocks();
  });
  it('basic', async () => {
    expect.assertions(7);
    // @ts-ignore
    s3.__setMockState({
      's3://amazon-berkeley-objects/empty.json': '',
      's3://utility-079185815456-us-west-2/empty.json': '',
    });
    await glue.createDatabase({
      DatabaseInput: {
        Name: 'test-wharfie-resource',
      },
    });
    const events = [];
    Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
      events.push(`${event.status} - ${event.constructor}:${event.name}`);
    });
    const wharfieResource = new WharfieResource({
      name: 'test-resource',
      properties: {
        catalogId: '1234',
        columns: [
          {
            name: 'brand',
            type: 'array<struct<language_tag:string,value:string>>',
          },
          {
            name: 'country',
            type: 'string',
          },
          {
            name: 'domain_name',
            type: 'string',
          },
        ],
        compressed: undefined,
        createdAt: 123456789,
        scheduleQueueUrl: SCHEDULE_QUEUE_URL,
        daemonQueueUrl: DAEMON_QUEUE_URL,
        databaseName: 'test-wharfie-resource',
        dependencyTable: 'test-deployment-dependencies',
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
        inputLocation: 's3://amazon-berkeley-objects/listings/metadata/',
        interval: 300,
        locationTable: 'test-deployment-locations',
        migrationResource: false,
        numberOfBuckets: 0,
        operationTable: 'test-deployment-operations',
        outputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        outputLocation:
          's3://test-wharfie-resource-bucket-lz-fc6bi/amazon_berkely_objects/',
        parameters: {
          EXTERNAL: 'true',
        },
        partitionKeys: undefined,
        project: {
          name: 'test-wharfie-resource',
        },
        projectBucket: 'test-wharfie-resource-bucket-lz-fc6bi',
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
    const reconcile_state = state_db.__getMockState();
    expect(reconcile_state).toMatchInlineSnapshot(`
      {
        "test-deployment": {
          "test-resource": {
            "dependsOn": [],
            "name": "test-resource",
            "parent": "",
            "properties": {
              "catalogId": "1234",
              "columns": [
                {
                  "name": "brand",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "country",
                  "type": "string",
                },
                {
                  "name": "domain_name",
                  "type": "string",
                },
              ],
              "compressed": undefined,
              "createdAt": 123456789,
              "daemonQueueUrl": "https://sqs.us-west-2.amazonaws.com/1234/wharfie-testing-daemon-queue",
              "databaseName": "test-wharfie-resource",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "1234",
                "envPaths": {
                  "cache": "mock",
                  "config": "mock",
                  "data": "mock",
                  "log": "mock",
                  "temp": "mock",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "inputLocation": "s3://amazon-berkeley-objects/listings/metadata/",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "operationTable": "test-deployment-operations",
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "outputLocation": "s3://test-wharfie-resource-bucket-lz-fc6bi/amazon_berkely_objects/",
              "parameters": {
                "EXTERNAL": "true",
              },
              "partitionKeys": undefined,
              "project": {
                "name": "test-wharfie-resource",
              },
              "projectBucket": "test-wharfie-resource-bucket-lz-fc6bi",
              "projectName": "test-wharfie-resource",
              "region": "us-west-2",
              "resourceId": "test-wharfie-resource.amazon_berkely_objects",
              "resourceKey": "test-resource",
              "resourceName": "amazon_berkely_objects",
              "roleArn": "arn:aws:iam::123456789012:role/test-wharfie-resource-project-role",
              "scheduleQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
              "scheduleQueueUrl": "https://sqs.us-west-2.amazonaws.com/1234/wharfie-testing-events-queue",
              "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "serdeInfo": {
                "Parameters": {
                  "ignore.malformed.json": "true",
                },
                "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
              },
              "storedAsSubDirectories": true,
              "tableType": "EXTERNAL_TABLE",
              "version": 0,
            },
            "resourceType": "WharfieResource",
            "resources": [
              "wharfie-test-deployment-amazon_berkely_objects-workgroup",
              "amazon_berkely_objects_raw",
              "amazon_berkely_objects",
              "test-wharfie-resource-amazon_berkely_objects-resource-record",
              "test-wharfie-resource-amazon_berkely_objects-location-record",
            ],
            "status": "STABLE",
          },
          "test-resource#amazon_berkely_objects": {
            "dependsOn": [],
            "name": "amazon_berkely_objects",
            "parent": "test-resource",
            "properties": {
              "arn": "arn:aws:glue:us-west-2:1234:table/test-wharfie-resource/amazon_berkely_objects",
              "catalogId": "1234",
              "columns": [
                {
                  "name": "brand",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "country",
                  "type": "string",
                },
                {
                  "name": "domain_name",
                  "type": "string",
                },
              ],
              "compressed": true,
              "databaseName": "test-wharfie-resource",
              "deployment": {
                "accountId": "1234",
                "envPaths": {
                  "cache": "mock",
                  "config": "mock",
                  "data": "mock",
                  "log": "mock",
                  "temp": "mock",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
              "location": "s3://test-wharfie-resource-bucket-lz-fc6bi/amazon_berkely_objects/references/",
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
              "parameters": {
                "EXTERNAL": "TRUE",
                "parquet.compress": "GZIP",
              },
              "partitionKeys": undefined,
              "region": "us-west-2",
              "serdeInfo": {
                "Parameters": {
                  "parquet.compress": "GZIP",
                },
                "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
              },
              "storedAsSubDirectories": false,
              "tableType": "EXTERNAL_TABLE",
              "tags": [],
            },
            "resourceType": "GlueTable",
            "status": "STABLE",
          },
          "test-resource#amazon_berkely_objects_raw": {
            "dependsOn": [],
            "name": "amazon_berkely_objects_raw",
            "parent": "test-resource",
            "properties": {
              "arn": "arn:aws:glue:us-west-2:1234:table/test-wharfie-resource/amazon_berkely_objects_raw",
              "catalogId": "1234",
              "columns": [
                {
                  "name": "brand",
                  "type": "array<struct<language_tag:string,value:string>>",
                },
                {
                  "name": "country",
                  "type": "string",
                },
                {
                  "name": "domain_name",
                  "type": "string",
                },
              ],
              "compressed": undefined,
              "databaseName": "test-wharfie-resource",
              "deployment": {
                "accountId": "1234",
                "envPaths": {
                  "cache": "mock",
                  "config": "mock",
                  "data": "mock",
                  "log": "mock",
                  "temp": "mock",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "location": "s3://amazon-berkeley-objects/listings/metadata/",
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "parameters": {
                "EXTERNAL": "true",
              },
              "partitionKeys": undefined,
              "region": "us-west-2",
              "serdeInfo": {
                "Parameters": {
                  "ignore.malformed.json": "true",
                },
                "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
              },
              "storedAsSubDirectories": true,
              "tableType": "EXTERNAL_TABLE",
              "tags": [],
            },
            "resourceType": "GlueTable",
            "status": "STABLE",
          },
          "test-resource#test-wharfie-resource-amazon_berkely_objects-location-record": {
            "dependsOn": [],
            "name": "test-wharfie-resource-amazon_berkely_objects-location-record",
            "parent": "test-resource",
            "properties": {
              "data": {
                "interval": 300,
                "location": "s3://amazon-berkeley-objects/listings/metadata/",
                "resource_id": "test-wharfie-resource.amazon_berkely_objects",
              },
              "deployment": {
                "accountId": "1234",
                "envPaths": {
                  "cache": "mock",
                  "config": "mock",
                  "data": "mock",
                  "log": "mock",
                  "temp": "mock",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "table_name": "test-deployment-locations",
            },
            "resourceType": "LocationRecord",
            "status": "STABLE",
          },
          "test-resource#test-wharfie-resource-amazon_berkely_objects-resource-record": {
            "dependsOn": [
              "amazon_berkely_objects_raw",
              "amazon_berkely_objects",
              "wharfie-test-deployment-amazon_berkely_objects-workgroup",
            ],
            "name": "test-wharfie-resource-amazon_berkely_objects-resource-record",
            "parent": "test-resource",
            "properties": {
              "data": {
                "data": {
                  "athena_workgroup": "wharfie-test-deployment-amazon_berkely_objects-workgroup",
                  "created_at": 123456789,
                  "daemon_config": {
                    "Role": "arn:aws:iam::123456789012:role/test-wharfie-resource-project-role",
                  },
                  "destination_properties": {
                    "arn": "arn:aws:glue:us-west-2:1234:table/test-wharfie-resource/amazon_berkely_objects",
                    "catalogId": "1234",
                    "columns": [
                      {
                        "name": "brand",
                        "type": "array<struct<language_tag:string,value:string>>",
                      },
                      {
                        "name": "country",
                        "type": "string",
                      },
                      {
                        "name": "domain_name",
                        "type": "string",
                      },
                    ],
                    "compressed": true,
                    "databaseName": "test-wharfie-resource",
                    "deployment": {
                      "accountId": "1234",
                      "envPaths": {
                        "cache": "mock",
                        "config": "mock",
                        "data": "mock",
                        "log": "mock",
                        "temp": "mock",
                      },
                      "name": "test-deployment",
                      "region": "us-west-2",
                      "stateTable": "test-deployment-state",
                      "version": "0.0.1",
                    },
                    "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                    "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                    "location": "s3://test-wharfie-resource-bucket-lz-fc6bi/amazon_berkely_objects/references/",
                    "name": "amazon_berkely_objects",
                    "numberOfBuckets": 0,
                    "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                    "parameters": {
                      "EXTERNAL": "TRUE",
                      "parquet.compress": "GZIP",
                    },
                    "partitionKeys": undefined,
                    "region": "us-west-2",
                    "serdeInfo": {
                      "Parameters": {
                        "parquet.compress": "GZIP",
                      },
                      "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                    },
                    "storedAsSubDirectories": false,
                    "tableType": "EXTERNAL_TABLE",
                    "tags": [],
                  },
                  "id": "test-wharfie-resource.amazon_berkely_objects",
                  "last_updated_at": 123456789,
                  "record_type": "RESOURCE",
                  "region": "us-west-2",
                  "resource_properties": {
                    "catalogId": "1234",
                    "columns": [
                      {
                        "name": "brand",
                        "type": "array<struct<language_tag:string,value:string>>",
                      },
                      {
                        "name": "country",
                        "type": "string",
                      },
                      {
                        "name": "domain_name",
                        "type": "string",
                      },
                    ],
                    "compressed": undefined,
                    "createdAt": 123456789,
                    "daemonQueueUrl": "https://sqs.us-west-2.amazonaws.com/1234/wharfie-testing-daemon-queue",
                    "databaseName": "test-wharfie-resource",
                    "dependencyTable": "test-deployment-dependencies",
                    "deployment": {
                      "accountId": "1234",
                      "envPaths": {
                        "cache": "mock",
                        "config": "mock",
                        "data": "mock",
                        "log": "mock",
                        "temp": "mock",
                      },
                      "name": "test-deployment",
                      "region": "us-west-2",
                      "stateTable": "test-deployment-state",
                      "version": "0.0.1",
                    },
                    "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                    "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "inputLocation": "s3://amazon-berkeley-objects/listings/metadata/",
                    "interval": 300,
                    "locationTable": "test-deployment-locations",
                    "migrationResource": false,
                    "numberOfBuckets": 0,
                    "operationTable": "test-deployment-operations",
                    "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "outputLocation": "s3://test-wharfie-resource-bucket-lz-fc6bi/amazon_berkely_objects/",
                    "parameters": {
                      "EXTERNAL": "true",
                    },
                    "partitionKeys": undefined,
                    "project": {
                      "name": "test-wharfie-resource",
                    },
                    "projectBucket": "test-wharfie-resource-bucket-lz-fc6bi",
                    "projectName": "test-wharfie-resource",
                    "region": "us-west-2",
                    "resourceId": "test-wharfie-resource.amazon_berkely_objects",
                    "resourceKey": "test-resource",
                    "resourceName": "amazon_berkely_objects",
                    "roleArn": "arn:aws:iam::123456789012:role/test-wharfie-resource-project-role",
                    "scheduleQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                    "scheduleQueueUrl": "https://sqs.us-west-2.amazonaws.com/1234/wharfie-testing-events-queue",
                    "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
                    "serdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "storedAsSubDirectories": true,
                    "tableType": "EXTERNAL_TABLE",
                    "version": 0,
                  },
                  "source_properties": {
                    "arn": "arn:aws:glue:us-west-2:1234:table/test-wharfie-resource/amazon_berkely_objects_raw",
                    "catalogId": "1234",
                    "columns": [
                      {
                        "name": "brand",
                        "type": "array<struct<language_tag:string,value:string>>",
                      },
                      {
                        "name": "country",
                        "type": "string",
                      },
                      {
                        "name": "domain_name",
                        "type": "string",
                      },
                    ],
                    "compressed": undefined,
                    "databaseName": "test-wharfie-resource",
                    "deployment": {
                      "accountId": "1234",
                      "envPaths": {
                        "cache": "mock",
                        "config": "mock",
                        "data": "mock",
                        "log": "mock",
                        "temp": "mock",
                      },
                      "name": "test-deployment",
                      "region": "us-west-2",
                      "stateTable": "test-deployment-state",
                      "version": "0.0.1",
                    },
                    "description": "Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html",
                    "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "location": "s3://amazon-berkeley-objects/listings/metadata/",
                    "name": "amazon_berkely_objects_raw",
                    "numberOfBuckets": 0,
                    "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "parameters": {
                      "EXTERNAL": "true",
                    },
                    "partitionKeys": undefined,
                    "region": "us-west-2",
                    "serdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "storedAsSubDirectories": true,
                    "tableType": "EXTERNAL_TABLE",
                    "tags": [],
                  },
                  "source_region": undefined,
                  "status": "ACTIVE",
                  "version": 0,
                  "wharfie_version": "0.0.1",
                },
                "resource_id": "test-wharfie-resource.amazon_berkely_objects",
                "sort_key": "test-wharfie-resource.amazon_berkely_objects",
              },
              "deployment": {
                "accountId": "1234",
                "envPaths": {
                  "cache": "mock",
                  "config": "mock",
                  "data": "mock",
                  "log": "mock",
                  "temp": "mock",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "table_name": "test-deployment-operations",
            },
            "resourceType": "WharfieResourceRecord",
            "status": "STABLE",
          },
          "test-resource#wharfie-test-deployment-amazon_berkely_objects-workgroup": {
            "dependsOn": [],
            "name": "wharfie-test-deployment-amazon_berkely_objects-workgroup",
            "parent": "test-resource",
            "properties": {
              "arn": "arn:aws:athena:us-west-2:1234:workgroup/wharfie-test-deployment-amazon_berkely_objects-workgroup",
              "deployment": {
                "accountId": "1234",
                "envPaths": {
                  "cache": "mock",
                  "config": "mock",
                  "data": "mock",
                  "log": "mock",
                  "temp": "mock",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment resource amazon_berkely_objects workgroup",
              "outputLocation": "s3://test-wharfie-resource-bucket-lz-fc6bi/amazon_berkely_objects/query_metadata/",
            },
            "resourceType": "AthenaWorkGroup",
            "status": "STABLE",
          },
        },
      }
    `);

    expect(state_db.__getMockState()).toStrictEqual(reconcile_state);
    const deserialized = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-resource',
    });

    expect(deserialized.status).toBe('STABLE');
    expect(state_db.__getMockState()).toStrictEqual(reconcile_state);
    expect(
      sqs.__getMockState().queues[SCHEDULE_QUEUE_URL].queue[0].Body
    ).toMatchInlineSnapshot(
      `"{"resource_id":"test-wharfie-resource.amazon_berkely_objects","operation_type":"BACKFILL","type":"WHARFIE:OPERATION:SCHEDULE","version":"0.0.1","retries":0}"`
    );
    expect(sqs.__getMockState().queues[DAEMON_QUEUE_URL]).toBeUndefined();

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
  }, 10000);
});
