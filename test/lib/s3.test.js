/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/client-s3');
const S3 = require('../../lambdas/lib/s3');

describe('tests for S3', () => {
  beforeAll(() => {
    process.env.TEMP_FILES_BUCKET = 'wharfie-tests-temp-files';
    require('aws-sdk-client-mock-jest');
  });
  afterEach(() => {
    AWS.S3Mock.reset();
  });
  afterAll(() => {
    process.env.TEMP_FILES_BUCKET = undefined;
  });

  it('putObject', async () => {
    expect.assertions(3);
    AWS.S3Mock.on(AWS.PutObjectCommand).resolves({});
    const s3 = new S3({ region: 'us-east-1' });
    const params = {
      Bucket: 'test_bucket',
      Key: 'key/path.json',
      Body: JSON.stringify({}),
    };
    await s3.putObject(params);
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.PutObjectCommand, 1);
    expect(AWS.S3Mock).toHaveReceivedCommandWith(AWS.PutObjectCommand, params);
  });

  it('deleteObjects', async () => {
    expect.assertions(3);
    AWS.S3Mock.on(AWS.DeleteObjectsCommand)
      .resolvesOnce({
        Errors: [{ Key: 'key/path.json' }],
      })
      .resolvesOnce({});
    const s3 = new S3({ region: 'us-east-1' });
    const params = {
      Bucket: 'test_bucket',
      Delete: {
        Objects: [
          {
            Key: 'key/path.json',
          },
          {
            Key: 'key/path1.json',
          },
        ],
        Quiet: false,
      },
    };
    await s3.deleteObjects(params);
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.DeleteObjectsCommand, 2);
    expect(AWS.S3Mock.commandCalls(AWS.DeleteObjectsCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Bucket": "test_bucket",
        "Delete": Object {
          "Objects": Array [
            Object {
              "Key": "key/path.json",
            },
            Object {
              "Key": "key/path1.json",
            },
          ],
          "Quiet": false,
        },
      }
    `);
    expect(AWS.S3Mock.commandCalls(AWS.DeleteObjectsCommand)[1].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Bucket": "test_bucket",
        "Delete": Object {
          "Objects": Array [
            Object {
              "Key": "key/path.json",
            },
          ],
          "Quiet": false,
        },
      }
    `);
  });

  it('copyPath', async () => {
    expect.assertions(8);
    AWS.S3Mock.on(AWS.ListObjectsV2Command)
      .resolvesOnce({
        Contents: [
          {
            Key: 'source_database/source_table/123.json',
          },
          { Key: 'source_database/source_table/456.json' },
          {},
        ],
        NextContinuationToken: 'token',
      })
      .resolvesOnce({
        Contents: [
          {
            Key: 'source_database/source_table/789.json',
          },
        ],
      });
    AWS.S3Mock.on(AWS.CopyObjectCommand).resolves(undefined);
    const s3 = new S3({ region: 'us-east-1' });
    const params = {
      Bucket: 'example-bucket',
      Prefix: 'test/prefix/',
    };
    const destinationBucket = 'destination_bucket';
    const destinationPrefix = 'prefix/';
    await s3.copyPath(params, destinationBucket, destinationPrefix);
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.ListObjectsV2Command, 2);
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      1,
      AWS.ListObjectsV2Command,
      {
        Bucket: 'example-bucket',
        Prefix: 'test/prefix/',
      }
    );
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      4,
      AWS.ListObjectsV2Command,
      {
        Bucket: 'example-bucket',
        ContinuationToken: 'token',
        Prefix: 'test/prefix/',
      }
    );
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.CopyObjectCommand, 3);
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(2, AWS.CopyObjectCommand, {
      Bucket: destinationBucket,
      Key: 'prefix/source_database/source_table/123.json',
      CopySource: `example-bucket/source_database/source_table/123.json`,
    });
  });

  it('parseS3Uri throws on non-string uri', () => {
    expect.assertions(1);
    const s3 = new S3({ region: 'us-east-1' });
    expect(() => s3.parseS3Uri(123)).toThrowErrorMatchingInlineSnapshot(
      `"uri (123) is not a string"`
    );
  });

  it('deletePath', async () => {
    expect.assertions(10);
    AWS.S3Mock.on(AWS.ListObjectsV2Command)
      .resolvesOnce({
        Contents: [
          {
            Key: 'prefix/some_key/wharfie-temp-files/source_table/123.json',
          },
          { Key: 'prefix/wharfie-temp-files/source_table/456.json' },
          {},
        ],
        NextContinuationToken: 'token',
      })
      .resolvesOnce({
        Contents: [
          {
            Key: 'prefix/some_key/wharfie-temp-files/source_table/789.json',
          },
        ],
      });
    AWS.S3Mock.on(AWS.DeleteObjectsCommand).resolves({});
    const s3 = new S3({ region: 'us-east-1' });
    const params = {
      Bucket: 'example-bucket',
      Prefix: 'test/prefix/',
    };
    await s3.deletePath(params);
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.ListObjectsV2Command, 2);
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      1,
      AWS.ListObjectsV2Command,
      {
        Bucket: 'example-bucket',
        Prefix: 'test/prefix/',
      }
    );
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      3,
      AWS.ListObjectsV2Command,
      {
        Bucket: 'example-bucket',
        ContinuationToken: 'token',
        Prefix: 'test/prefix/',
      }
    );
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.DeleteObjectsCommand, 2);
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      2,
      AWS.DeleteObjectsCommand,
      {
        Bucket: 'example-bucket',
        Delete: {
          Objects: [
            {
              Key: 'prefix/some_key/wharfie-temp-files/source_table/123.json',
            },
            { Key: 'prefix/wharfie-temp-files/source_table/456.json' },
          ],
        },
      }
    );
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      4,
      AWS.DeleteObjectsCommand,
      {
        Bucket: 'example-bucket',
        Delete: {
          Objects: [
            { Key: 'prefix/some_key/wharfie-temp-files/source_table/789.json' },
          ],
        },
      }
    );
  });

  it('parseS3Uri throws on invalid uri', () => {
    expect.assertions(1);
    const s3 = new S3({});
    expect(() => s3.parseS3Uri('s3:00000')).toThrowErrorMatchingInlineSnapshot(
      `"s3:00000 is not of form s3://bucket/key"`
    );
  });

  it('parseS3Uri', () => {
    expect.assertions(1);
    const s3 = new S3({});
    const result = s3.parseS3Uri('s3://example-bucket/path/to/object/');
    expect(result).toStrictEqual({
      bucket: 'example-bucket',
      prefix: 'path/to/object/',
    });
  });

  it('getCommonPrefixes', async () => {
    expect.assertions(4);
    AWS.S3Mock.on(AWS.ListObjectsV2Command)
      .resolvesOnce({
        CommonPrefixes: [
          {
            Prefix: 'first_prefix',
          },
        ],
        NextContinuationToken: 'continue_token',
      })
      .resolvesOnce({
        CommonPrefixes: [
          {
            Prefix: 'second_prefix',
          },
        ],
      });
    const s3 = new S3({ region: 'us-east-1' });
    const result = await s3.getCommonPrefixes({
      Bucket: 'example-bucket',
      Prefix: 'test/prefix/',
    });
    expect(result).toStrictEqual(['first_prefix', 'second_prefix']);
    expect(AWS.S3Mock).toHaveReceivedCommandTimes(AWS.ListObjectsV2Command, 2);
    expect(AWS.S3Mock).toHaveReceivedNthCommandWith(
      2,
      AWS.ListObjectsV2Command,
      {
        Bucket: 'example-bucket',
        Prefix: 'test/prefix/',
        Delimiter: '/',
        ContinuationToken: 'continue_token',
      }
    );
  });

  it('findPartitions', async () => {
    expect.assertions(1);
    AWS.S3Mock.on(AWS.ListObjectsV2Command)
      .resolvesOnce({
        CommonPrefixes: [
          {
            Prefix: 'test/prefix/02/',
          },
        ],
      })
      .resolvesOnce({
        CommonPrefixes: [
          {
            Prefix: 'test/prefix/02/day=01/',
          },
          {
            Prefix: 'test/prefix/02/day=02/',
          },
          {
            Prefix: 'test/prefix/02/processing_failed/',
          },
        ],
        NextContinuationToken: 'continue_token',
      })
      .resolvesOnce({
        CommonPrefixes: [
          {
            Prefix: 'test/prefix/02/day=03/',
          },
        ],
      });

    const s3 = new S3({});
    const result = await s3.findPartitions('example-bucket', 'test/prefix/', [
      {
        Name: 'month',
      },
      {
        Name: 'day',
      },
    ]);
    expect(result).toStrictEqual([
      {
        location: 's3://example-bucket/test/prefix/02/day=01/',
        partitionValues: {
          month: '02',
          day: '01',
        },
      },
      {
        location: 's3://example-bucket/test/prefix/02/day=02/',
        partitionValues: {
          month: '02',
          day: '02',
        },
      },
      {
        location: 's3://example-bucket/test/prefix/02/day=03/',
        partitionValues: {
          month: '02',
          day: '03',
        },
      },
    ]);
  });
});
