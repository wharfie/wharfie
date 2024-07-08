/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const path = require('path');
const { S3 } = jest.requireMock('@aws-sdk/client-s3');

const {
  LambdaBuild,
  Bucket,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('lambda function IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const s3 = new S3({});
    const bucket = new Bucket({
      name: 'test-bucket',
    });
    await bucket.reconcile();
    const lambdaBuild = new LambdaBuild({
      name: 'test-function',
      properties: {
        handler: path.join(
          __dirname,
          '../../fixtures/lambda-build-test-handler.handler'
        ),
        artifactBucket: bucket.name,
      },
    });
    await lambdaBuild.reconcile();

    const serialized = lambdaBuild.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-function",
        "properties": {
          "artifactBucket": "test-bucket",
          "artifactKey": "actor-artifacts/test-function/8c11f001fe12d44fdb30e6a405c7516320cf7551d3791d42fcab503a0c06e34a.zip",
          "functionCodeHash": "8c11f001fe12d44fdb30e6a405c7516320cf7551d3791d42fcab503a0c06e34a",
          "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/test/fixtures/lambda-build-test-handler.handler",
        },
        "resourceType": "LambdaBuild",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "artifactBucket": "test-bucket",
        "artifactKey": "actor-artifacts/test-function/8c11f001fe12d44fdb30e6a405c7516320cf7551d3791d42fcab503a0c06e34a.zip",
        "functionCodeHash": "8c11f001fe12d44fdb30e6a405c7516320cf7551d3791d42fcab503a0c06e34a",
        "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/test/fixtures/lambda-build-test-handler.handler",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await s3.listObjectsV2({
      Bucket: bucket.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Bucket": "test-bucket",
        "Contents": [
          {
            "Key": "actor-artifacts/test-function/8c11f001fe12d44fdb30e6a405c7516320cf7551d3791d42fcab503a0c06e34a.zip",
            "LastModified": 1970-01-01T00:00:00.000Z,
          },
        ],
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    const del_res = await s3.listObjectsV2({
      Bucket: bucket.name,
    });
    expect(del_res).toMatchInlineSnapshot(`
      {
        "Bucket": "test-bucket",
        "Contents": [
          {
            "Key": "actor-artifacts/test-function/8c11f001fe12d44fdb30e6a405c7516320cf7551d3791d42fcab503a0c06e34a.zip",
            "LastModified": 1970-01-01T00:00:00.000Z,
          },
        ],
      }
    `);
  });
});
