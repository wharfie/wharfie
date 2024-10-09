/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');
const WharfieResource = require('../../lambdas/lib/actor/resources/wharfie-resource');
const { resetAWSMocks } = require('../util');

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
    expect.assertions(4);
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

    const serialized = wharfieResource.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
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
        },
        "resourceType": "WharfieResource",
        "resources": [
          "test-deployment-amazon_berkely_objects-workgroup",
          "amazon_berkely_objects_raw",
          "amazon_berkely_objects",
          "test-wharfie-resource-amazon_berkely_objects-resource-record",
          "test-wharfie-resource-amazon_berkely_objects-location-record",
        ],
        "status": "STABLE",
      }
    `);
    expect(
      sqs.__getMockState().queues[SCHEDULE_QUEUE_URL].queue[0].Body
    ).toMatchInlineSnapshot(
      `"{"resource_id":"test-wharfie-resource.amazon_berkely_objects","operation_type":"BACKFILL","type":"WHARFIE:OPERATION:SCHEDULE","version":"0.0.1","retries":0}"`
    );
    expect(sqs.__getMockState().queues[DAEMON_QUEUE_URL]).toBeUndefined();

    await wharfieResource.destroy();
    expect(wharfieResource.status).toBe('DESTROYED');
  }, 10000);
});
