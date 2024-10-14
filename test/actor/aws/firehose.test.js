/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
const { Firehose } = require('../../../lambdas/lib/actor/resources/aws/');
const { Firehose: FirehoseSDK } = jest.requireMock('@aws-sdk/client-firehose');

const { getMockDeploymentProperties } = require('../util');

describe('firehose IaC', () => {
  it('basic', async () => {
    expect.assertions(4);
    const firehoseSDK = new FirehoseSDK({});
    const firehose = new Firehose({
      name: 'test-table',
      properties: {
        deployment: getMockDeploymentProperties(),
        s3DestinationConfiguration: {
          BucketARN: 'arn:aws:s3:::test-bucket',
          RoleARN: 'arn:aws:iam::123456789012:role/test-role',
          Prefix: 'logs/raw/',
          CompressionFormat: 'GZIP',
          BufferingHints: {
            IntervalInSeconds: 60,
            SizeInMBs: 32,
          },
        },
      },
    });
    await firehose.reconcile();

    const serialized = firehose.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-table",
        "parent": "",
        "properties": {
          "arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
          "s3DestinationConfiguration": {
            "BucketARN": "arn:aws:s3:::test-bucket",
            "BufferingHints": {
              "IntervalInSeconds": 60,
              "SizeInMBs": 32,
            },
            "CompressionFormat": "GZIP",
            "Prefix": "logs/raw/",
            "RoleARN": "arn:aws:iam::123456789012:role/test-role",
          },
        },
        "resourceType": "Firehose",
        "status": "STABLE",
      }
    `);

    const res = await firehoseSDK.describeDeliveryStream({
      DeliveryStreamName: firehose.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "DeliveryStreamDescription": {
          "DeliveryStreamARN": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
          "DeliveryStreamName": "test-table",
          "DeliveryStreamStatus": "ACTIVE",
          "DeliveryStreamType": "DirectPut",
          "S3DestinationConfiguration": {
            "BucketARN": "arn:aws:s3:::test-bucket",
            "BufferingHints": {
              "IntervalInSeconds": 60,
              "SizeInMBs": 32,
            },
            "CompressionFormat": "GZIP",
            "Prefix": "logs/raw/",
            "RoleARN": "arn:aws:iam::123456789012:role/test-role",
          },
          "records": [],
        },
      }
    `);
    await firehose.destroy();
    expect(firehose.status).toBe('DESTROYED');
    await expect(
      firehoseSDK.describeDeliveryStream({
        DeliveryStreamName: firehose.name,
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"DeliveryStream test-table does not exist"`
    );
  });
});
