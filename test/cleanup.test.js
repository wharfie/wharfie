/* eslint-disable jest/no-hooks */
'use strict';
const _S3 = require('../lambdas/lib/s3');
const s3 = new _S3();
jest.mock('../lambdas/lib/sts');
jest.mock('../lambdas/lib/glue');
jest.createMockFromModule('graphlib');
let lambda, S3, resource_db, logging, getObject, deleteObjects;

describe('tests for cleanup lambda', () => {
  beforeAll(() => {
    jest.mock('graphlib');
    S3 = require('../lambdas/lib/s3');
    logging = require('../lambdas/lib/logging');
    resource_db = require('../lambdas/lib/dynamo/resource');
    jest.mock('../lambdas/lib/dynamo/resource');
    jest.mock('../lambdas/lib/s3');
    jest.mock('../lambdas/lib/logging');
    jest.spyOn(logging, 'getDaemonLogger').mockImplementation(() => ({
      debug: () => {},
      info: () => {},
    }));
    getObject = jest.fn().mockResolvedValue({
      Body: 's3://a-bucket/prefix/data/somefile.json',
    });
    deleteObjects = jest.fn().mockImplementation(() => {});
    S3.mockImplementation(() => {
      return {
        getObject,
        deleteObjects,
        parseS3Uri: s3.parseS3Uri,
      };
    });
    jest.spyOn(resource_db, 'getResource').mockImplementation(() => ({
      resource_arn: 'arn:aws:sqs:us-east-1:123456789123:test-resource',
      daemon_config: {
        Role: 'a_role',
      },
    }));
    lambda = require('../lambdas/cleanup');
  });

  afterAll(() => {
    S3.mockClear();
    logging.mockClear();
    resource_db.getResource.mockClear();
  });

  it('run', async () => {
    expect.assertions(5);
    await lambda.run(
      {
        resource_id: '123',
        operation_id: '123',
        action_id: '123',
        delays: 100,
        manifest_uri: 's3://a-bucket/prefix/refs/manifest',
      },
      {}
    );

    expect(resource_db.getResource).toHaveBeenCalledTimes(1);
    expect(getObject).toHaveBeenCalledTimes(1);
    expect(getObject.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Bucket": "a-bucket",
          "Key": "prefix/refs/manifest",
        },
      ]
    `);
    expect(deleteObjects).toHaveBeenCalledTimes(1);
    expect(deleteObjects.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "Bucket": "a-bucket",
          "Delete": Object {
            "Objects": Array [
              Object {
                "Key": "prefix/data/somefile.json",
              },
              Object {
                "Key": "prefix/refs/manifest",
              },
            ],
          },
        },
      ]
    `);
  });
});
