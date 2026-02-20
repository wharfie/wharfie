/* eslint-disable jest/no-large-snapshots */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = '1';
jest.mock('../../../lambdas/lib/id');
const { S3 } = jest.requireMock('@aws-sdk/client-s3');

const {
  Bucket,
  BucketNotificationConfiguration,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { getMockDeploymentProperties } = require('../util');

describe('bucket notification configuration IaC', () => {
  it('basic', async () => {
    expect.assertions(4);

    const s3 = new S3({});
    const bucket = new Bucket({
      name: 'test-bucket',
      properties: {
        deployment: getMockDeploymentProperties(),
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
        deployment: getMockDeploymentProperties(),
        bucketName: bucket.get('bucketName'),
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
        "parent": "",
        "properties": {
          "bucketName": "test-bucket-111111",
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

    const res = await s3.getBucketNotificationConfiguration({
      Bucket: bucket.get('bucketName'),
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

    await bucketNotificationConfig.destroy();

    expect(bucketNotificationConfig.status).toBe('DESTROYED');

    const del_res = await s3.getBucketNotificationConfiguration({
      Bucket: bucket.get('bucketName'),
    });

    expect(del_res.QueueConfigurations).toStrictEqual([]);
  });
});
