/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { S3 } = jest.requireMock('@aws-sdk/client-s3');

const {
  Bucket,
  BucketNotificationConfiguration,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('bucket notification configuration IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const s3 = new S3({});
    const bucket = new Bucket({
      name: 'test-bucket',
      properties: {
        lifecycleConfiguration: {
          Rules: [
            {
              ID: 'log_files_expiration',
              Expiration: {
                Days: 1,
              },
              Status: 'Enabled',
              Prefix: '/logs/raw/',
            },
            {
              ID: 'abort_incomplete_multipart_uploads',
              Prefix: '',
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 1,
              },
              Status: 'Enabled',
            },
          ],
        },
      },
    });
    await bucket.reconcile();
    const bucketNotificationConfig = new BucketNotificationConfiguration({
      name: 'test-bucket-notification-config',
      properties: {
        bucketName: bucket.name,
        notificationConfiguration: () => ({
          QueueConfigurations: [
            {
              Events: ['s3:ObjectCreated:*'],
              QueueArn: 'arn:aws:sqs:us-west-2:123456789012:MyQueue',
            },
            {
              Events: ['s3:ObjectRemoved:*'],
              QueueArn: 'arn:aws:sqs:us-west-2:123456789012:MyOtherQueue',
            },
          ],
        }),
      },
    });
    await bucketNotificationConfig.reconcile();

    const serialized = bucketNotificationConfig.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-bucket-notification-config",
        "properties": {
          "arn": "arn:aws:s3:::test-bucket-notification-config",
          "bucketName": "test-bucket",
          "notificationConfiguration": {
            "QueueConfigurations": [
              {
                "Events": [
                  "s3:ObjectCreated:*",
                ],
                "QueueArn": "arn:aws:sqs:us-west-2:123456789012:MyQueue",
              },
              {
                "Events": [
                  "s3:ObjectRemoved:*",
                ],
                "QueueArn": "arn:aws:sqs:us-west-2:123456789012:MyOtherQueue",
              },
            ],
          },
        },
        "resourceType": "BucketNotificationConfiguration",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "arn": "arn:aws:s3:::test-bucket-notification-config",
        "bucketName": "test-bucket",
        "notificationConfiguration": {
          "QueueConfigurations": [
            {
              "Events": [
                "s3:ObjectCreated:*",
              ],
              "QueueArn": "arn:aws:sqs:us-west-2:123456789012:MyQueue",
            },
            {
              "Events": [
                "s3:ObjectRemoved:*",
              ],
              "QueueArn": "arn:aws:sqs:us-west-2:123456789012:MyOtherQueue",
            },
          ],
        },
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await s3.getBucketNotificationConfiguration({
      Bucket: bucket.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "QueueConfigurations": [
          {
            "Events": [
              "s3:ObjectCreated:*",
            ],
            "QueueArn": "arn:aws:sqs:us-west-2:123456789012:MyQueue",
          },
          {
            "Events": [
              "s3:ObjectRemoved:*",
            ],
            "QueueArn": "arn:aws:sqs:us-west-2:123456789012:MyOtherQueue",
          },
        ],
      }
    `);

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    const del_res = await s3.getBucketNotificationConfiguration({
      Bucket: bucket.name,
    });
    expect(del_res.QueueConfigurations).toStrictEqual([]);
  });
});
