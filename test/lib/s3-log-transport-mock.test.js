/* eslint-disable jest/no-hooks */
'use strict';

let S3LogTransport;
describe('tests for S3 Mock', () => {
  beforeEach(() => {
    process.env.AWS_MOCKS = true;
    jest.requireMock('@aws-sdk/client-s3');
    S3LogTransport = require('../../lambdas/lib/s3-log-transport');
  });
  afterAll(() => {
    process.env.AWS_MOCKS = false;
    process.env.TEMP_FILES_BUCKET = undefined;
  });

  it('createAppendableOrAppendToObject mock test', async () => {
    expect.assertions(1);
    const s3foo = new S3LogTransport();
    s3foo.s3.__setMockState({
      's3://test_bucket/fake': '',
    });
    const params = {
      Bucket: 'test_bucket',
      Key: 'key/path.json',
    };
    await s3foo.createAppendableOrAppendToObject(
      params,
      `${JSON.stringify({ foo: 'bar' })}\n`
    );
    await s3foo.createAppendableOrAppendToObject(
      params,
      `${JSON.stringify({ biz: 'baz' })}\n`
    );
    const s3bar = new S3LogTransport();

    const result = await s3bar.s3.getObject(params);
    expect(result.Body.trim()).toMatchInlineSnapshot(`
      "{\\"foo\\":\\"bar\\"}
      {\\"biz\\":\\"baz\\"}"
    `);
  });

  it('createAppendableOrAppendToObject mock test existing object', async () => {
    expect.assertions(1);
    const s3foo = new S3LogTransport();
    s3foo.s3.__setMockState({
      's3://test_bucket/fake': '',
    });
    const params = {
      Bucket: 'test_bucket',
      Key: 'key/path.json',
    };
    await s3foo.putObject({
      Bucket: 'test_bucket',
      Key: 'key/path.json',
      Body: JSON.stringify({ foo: 'bar' }),
    });
    await s3foo.createAppendableOrAppendToObject(
      params,
      JSON.stringify({ biz: 'baz' })
    );
    const s3bar = new S3LogTransport();
    const result = await s3bar.s3.getObject(params);
    expect(result.Body.trim()).toMatchInlineSnapshot(
      `"{\\"foo\\":\\"bar\\"}{\\"biz\\":\\"baz\\"}"`
    );
  });
});
