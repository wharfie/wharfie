/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
jest.mock('crypto');

const crypto = require('crypto');
const { S3 } = jest.requireMock('@aws-sdk/client-s3');

const {
  LambdaBuild,
  Bucket,
} = require('../../../lambdas/lib/actor/resources/aws/');
const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('lambda function IaC', () => {
  beforeAll(() => {
    const mockUpdate = jest.fn().mockReturnThis();
    const mockDigest = jest.fn().mockReturnValue('mockedHash');
    crypto.createHash.mockReturnValue({
      update: mockUpdate,
      digest: mockDigest,
    });
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });
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
        handler: './test/fixtures/lambda-build-test-handler.handler',
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
          "artifactKey": "actor-artifacts/test-function/mockedHash.zip",
          "functionCodeHash": "mockedHash",
          "handler": "./test/fixtures/lambda-build-test-handler.handler",
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
        "artifactKey": "actor-artifacts/test-function/mockedHash.zip",
        "functionCodeHash": "mockedHash",
        "handler": "./test/fixtures/lambda-build-test-handler.handler",
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
            "Key": "actor-artifacts/test-function/mockedHash.zip",
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
            "Key": "actor-artifacts/test-function/mockedHash.zip",
            "LastModified": 1970-01-01T00:00:00.000Z,
          },
        ],
      }
    `);
  });
});
