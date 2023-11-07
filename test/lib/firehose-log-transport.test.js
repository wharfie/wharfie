/* eslint-disable jest/no-hooks */
'use strict';
const AWS = require('@aws-sdk/client-firehose');

let FirehoseLogTransport;
describe('mock tests for firehose log transport', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    FirehoseLogTransport = require('../../lambdas/lib/firehose-log-transport');
  });
  afterEach(() => {
    AWS.FirehoseMock.reset();
  });

  it('log mock test', async () => {
    expect.assertions(2);
    AWS.FirehoseMock.on(AWS.PutRecordBatchCommand).resolves({});
    const firehoseLogTransport = new FirehoseLogTransport(
      {},
      { flushInterval: -1, logDeliveryStreamName: 'test-stream' }
    );
    await firehoseLogTransport.log('test1', () => {});
    await firehoseLogTransport.log('test2', () => {});
    await firehoseLogTransport.log('test3', () => {});
    await firehoseLogTransport.log('test4', () => {});
    await firehoseLogTransport.close();

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    expect(
      AWS.FirehoseMock.commandCalls(AWS.PutRecordBatchCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "DeliveryStreamName": "test-stream",
        "Records": Array [
          Object {
            "Data": Object {
              "data": Array [
                116,
                101,
                115,
                116,
                49,
                10,
                116,
                101,
                115,
                116,
                50,
                10,
                116,
                101,
                115,
                116,
                51,
                10,
                116,
                101,
                115,
                116,
                52,
                10,
              ],
              "type": "Buffer",
            },
          },
        ],
      }
    `);
  });
});
