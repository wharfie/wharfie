/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/client-firehose');

let FirehoseLogTransport;
describe('tests for firehose log transport', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    FirehoseLogTransport = require('../../../lambdas/lib/logging/firehose-log-transport');
  });
  afterEach(() => {
    AWS.FirehoseMock.reset();
  });

  it('log test', async () => {
    expect.assertions(3);
    AWS.FirehoseMock.on(AWS.PutRecordBatchCommand).resolves({});
    const firehoseLogTransport = new FirehoseLogTransport({
      flushInterval: -1,
      logDeliveryStreamName: 'test-stream',
    });
    await firehoseLogTransport.log('test1 ', () => {});
    await firehoseLogTransport.log('test2 ', () => {});
    await firehoseLogTransport.log('test3 ', () => {});
    await firehoseLogTransport.log('test4 ', () => {});
    await firehoseLogTransport.flush();
    await firehoseLogTransport.log('test5 ', () => {});
    await firehoseLogTransport.log('test6 ', () => {});
    await firehoseLogTransport.close();

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      2
    );
    expect(
      AWS.FirehoseMock.commandCalls(
        AWS.PutRecordBatchCommand
      )[0].args[0].input.Records[0].Data.toString()
    ).toMatchInlineSnapshot(`"test1 test2 test3 test4 "`);
    expect(
      AWS.FirehoseMock.commandCalls(
        AWS.PutRecordBatchCommand
      )[1].args[0].input.Records[0].Data.toString()
    ).toMatchInlineSnapshot(`"test5 test6 "`);
  });
});
