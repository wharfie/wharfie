/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
const { S3 } = jest.requireMock('@aws-sdk/client-s3');

const { Bucket } = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');
const { getMockDeploymentProperties } = require('../util');

describe('bucket IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
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

    const serialized = bucket.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-bucket",
        "properties": {
          "arn": "arn:aws:s3:::test-bucket",
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
        },
        "resourceType": "Bucket",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    // @ts-ignore
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "arn": "arn:aws:s3:::test-bucket",
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
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await s3.getBucketLocation({
      Bucket: bucket.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "LocationConstraint": "us-east-1",
      }
    `);

    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      s3.getBucketLocation({
        Bucket: bucket.name,
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `"The specified bucket does not exist: test-bucket"`
    );
  });
});
