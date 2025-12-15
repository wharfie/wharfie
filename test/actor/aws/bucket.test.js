/* eslint-disable jest/no-large-snapshots */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = '1';
jest.mock('../../../lambdas/lib/id');
const { S3 } = jest.requireMock('@aws-sdk/client-s3');

const { Bucket } = require('../../../lambdas/lib/actor/resources/aws/');
const { getMockDeploymentProperties } = require('../util');

describe('bucket IaC', () => {
  it('basic', async () => {
    expect.assertions(4);

    const s3 = new S3({});
    const bucket = new Bucket({
      name: 'test-bucket',
      properties: {
        deployment: getMockDeploymentProperties(),
        tags: [
          {
            Key: 'test-key',
            Value: 'test-value',
          },
        ],
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

    const serialized = bucket.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-bucket",
        "parent": "",
        "properties": {
          "arn": "arn:aws:s3:::test-bucket-111111",
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
          "lifecycleConfiguration": {
            "Rules": [
              {
                "Expiration": {
                  "Days": 1,
                },
                "ID": "log_files_expiration",
                "Prefix": "/logs/raw/",
                "Status": "Enabled",
              },
              {
                "AbortIncompleteMultipartUpload": {
                  "DaysAfterInitiation": 1,
                },
                "ID": "abort_incomplete_multipart_uploads",
                "Prefix": "",
                "Status": "Enabled",
              },
            ],
          },
          "tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
        },
        "resourceType": "Bucket",
        "status": "STABLE",
      }
    `);

    const res = await s3.getBucketLocation({
      Bucket: bucket.get('bucketName'),
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "LocationConstraint": "us-east-1",
      }
    `);

    await bucket.destroy();

    expect(bucket.status).toBe('DESTROYED');
    await expect(
      s3.getBucketLocation({
        Bucket: bucket.get('bucketName'),
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The specified bucket does not exist: test-bucket-111111"`
    );
  });
});
