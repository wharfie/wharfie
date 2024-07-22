/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { Firehose } = require('../../../lambdas/lib/actor/resources/aws/');
const { Firehose: FirehoseSDK } = jest.requireMock('@aws-sdk/client-firehose');

const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('firehose IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const firehoseSDK = new FirehoseSDK({});
    const firehose = new Firehose({
      name: 'test-table',
      properties: {
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
        "properties": {
          "arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
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

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      Firehose {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "dependsOn": [],
        "emit": false,
        "firehose": Firehose {
          "firehose": FirehoseMock {},
        },
        "name": "test-table",
        "properties": {
          "arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
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
    expect(deserialized.status).toBe('STABLE');

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
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      firehoseSDK.describeDeliveryStream({
        DeliveryStreamName: firehose.name,
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"DeliveryStream test-table does not exist"`
    );
  });
});
