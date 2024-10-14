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
const { getMockDeploymentProperties } = require('../util');

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
    expect.assertions(4);
    const s3 = new S3({});
    const bucket = new Bucket({
      name: 'test-bucket',
      properties: {
        deployment: getMockDeploymentProperties(),
      },
    });
    await bucket.reconcile();
    const lambdaBuild = new LambdaBuild({
      name: 'test-function',
      properties: {
        deployment: getMockDeploymentProperties(),
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
        "parent": "",
        "properties": {
          "artifactBucket": "test-bucket",
          "artifactKey": "actor-artifacts/test-function/mockedHash.zip",
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
          "functionCodeHash": "mockedHash",
          "handler": "./test/fixtures/lambda-build-test-handler.handler",
        },
        "resourceType": "LambdaBuild",
        "status": "STABLE",
      }
    `);

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
    await lambdaBuild.destroy();
    expect(lambdaBuild.status).toBe('DESTROYED');
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
