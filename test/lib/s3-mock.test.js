/* eslint-disable jest/no-hooks */
'use strict';

let S3;
describe('tests for S3 Mock', () => {
  beforeEach(() => {
    process.env.AWS_MOCKS = true;
    process.env.TEMP_FILES_BUCKET = 'wharfie-tests-temp-files';
    jest.requireMock('@aws-sdk/client-s3');
    S3 = require('../../lambdas/lib/s3');
  });
  afterAll(() => {
    process.env.AWS_MOCKS = false;
    process.env.TEMP_FILES_BUCKET = undefined;
  });
  it('putObject mock test', async () => {
    expect.assertions(1);
    const s3foo = new S3({ region: 'us-east-1' });
    const params = {
      Bucket: 'test_bucket',
      Key: 'key/path.json',
      Body: JSON.stringify({ foo: 'bar' }),
    };
    await s3foo.putObject(params);
    const s3bar = new S3({ region: 'us-east-1' });
    const result = await s3bar.getObject(params);
    expect(result).toMatchInlineSnapshot(`
      Object {
        "Body": "{\\"foo\\":\\"bar\\"}",
      }
    `);
  });

  it('findPartitions mock test', async () => {
    expect.assertions(1);
    const s3 = new S3({ region: 'us-east-1' });
    s3.s3.__setMockState({
      's3://bucket/prefix/dt=2021-01-20/hr=10/asdfasd.json': '',
      's3://bucket/prefix/dt=2021-01-20/hr=10/123.json': '',
      's3://bucket/prefix/dt=2021-01-21/hr=22/34.json': '',
      's3://bucket/prefix/dt=2021-01-22/hr=16/56.json': '',
      's3://bucket/prefix/dt=2021-01-23/hr=20/77.json': '',
    });
    const result = await s3.findPartitions('bucket', 'prefix', [
      {
        Name: 'dt',
      },
      {
        Name: 'hr',
      },
    ]);

    expect(result).toMatchInlineSnapshot(`
      Array [
        Object {
          "location": "s3://bucket/prefix/dt=2021-01-20/hr=10",
          "partitionValues": Object {
            "dt": "2021-01-20",
            "hr": "10",
          },
        },
        Object {
          "location": "s3://bucket/prefix/dt=2021-01-21/hr=22",
          "partitionValues": Object {
            "dt": "2021-01-21",
            "hr": "22",
          },
        },
        Object {
          "location": "s3://bucket/prefix/dt=2021-01-22/hr=16",
          "partitionValues": Object {
            "dt": "2021-01-22",
            "hr": "16",
          },
        },
        Object {
          "location": "s3://bucket/prefix/dt=2021-01-23/hr=20",
          "partitionValues": Object {
            "dt": "2021-01-23",
            "hr": "20",
          },
        },
      ]
    `);
  });

  it('expireObjects mock test', async () => {
    expect.assertions(1);
    const s3 = new S3({ region: 'us-east-1' });
    s3.s3.__setMockState({
      's3://bucket/prefix/dt=2021-01-20/hr=10/asdfasd.json': '',
      's3://bucket/prefix/dt=2021-01-20/hr=10/123.json': '',
      's3://bucket/prefix/dt=2021-01-21/hr=22/34.json': '',
      's3://bucket/prefix/dt=2021-01-22/hr=16/56.json': '',
      's3://bucket/prefix/dt=2021-01-23/hr=20/77.json': '',
    });
    await s3.expireObjects({
      Bucket: 'bucket',
      Prefix: 'prefix/dt=2021-01-20',
    });

    const result = await s3.s3.listObjectsV2({
      Bucket: 'bucket',
      Prefix: 'prefix/dt=2021-01',
    });

    expect(result).toMatchInlineSnapshot(`
      Object {
        "Bucket": "bucket",
        "Contents": Array [
          Object {
            "Key": "prefix/dt=2021-01-21/hr=22/34.json",
            "LastModified": 1970-01-01T00:00:00.000Z,
          },
          Object {
            "Key": "prefix/dt=2021-01-22/hr=16/56.json",
            "LastModified": 1970-01-01T00:00:00.000Z,
          },
          Object {
            "Key": "prefix/dt=2021-01-23/hr=20/77.json",
            "LastModified": 1970-01-01T00:00:00.000Z,
          },
        ],
      }
    `);
  });
});
