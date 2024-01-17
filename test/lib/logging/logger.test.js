/* eslint-disable jest/no-hooks */
'use strict';

const Logger = require('../../../lambdas/lib/logging/logger');
const ConsoleLogTransport = require('../../../lambdas/lib/logging/console-log-transport');

const AWS = require('@aws-sdk/client-firehose');

let FirehoseLogTransport;
let consoleLog;
let dateSpy;
describe('tests for console log transport', () => {
  beforeAll(() => {
    const mockDate = new Date(1466424490000);
    dateSpy = jest.spyOn(global, 'Date').mockImplementation(() => mockDate);
  });
  beforeEach(() => {
    require('aws-sdk-client-mock-jest');
    FirehoseLogTransport = require('../../../lambdas/lib/logging/firehose-log-transport');
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    AWS.FirehoseMock.on(AWS.PutRecordBatchCommand).resolves({});
  });
  afterEach(() => {
    AWS.FirehoseMock.reset();
    consoleLog.mockReset();
  });
  afterAll(() => {
    dateSpy.mockReset();
  });

  it('log default', async () => {
    expect.assertions(5);
    const logger = new Logger();

    logger.info('test1');
    logger.warn('test2');
    logger.error('test2');
    logger.debug('test2');

    expect(consoleLog).toHaveBeenCalledTimes(3);
    expect(consoleLog.mock.calls[0][0]).toMatchInlineSnapshot(`
      "[2016-06-20T12:08:10.000Z] [INFO] test1
      "
    `);
    expect(consoleLog.mock.calls[1][0]).toMatchInlineSnapshot(`
      "[2016-06-20T12:08:10.000Z] [WARN] test2
      "
    `);
    expect(consoleLog.mock.calls[2][0]).toMatchInlineSnapshot(`
      "[2016-06-20T12:08:10.000Z] [ERROR] test2
      "
    `);
    await logger.flush();
    await logger.close();
    expect(consoleLog).toHaveBeenCalledTimes(3);
  });

  it('log firehose', async () => {
    expect.assertions(4);
    const logger = new Logger({
      transports: [
        new FirehoseLogTransport({
          flushInterval: -1,
          logDeliveryStreamName: 'test-stream',
        }),
      ],
    });

    logger.info('test1');
    logger.warn('test2');
    logger.error('test2');
    logger.debug('test2');

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      0
    );
    await logger.flush();
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    await logger.close();
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    expect(
      AWS.FirehoseMock.commandCalls(
        AWS.PutRecordBatchCommand
      )[0].args[0].input.Records[0].Data.toString()
    ).toMatchInlineSnapshot(`
      "[2016-06-20T12:08:10.000Z] [INFO] test1
      [2016-06-20T12:08:10.000Z] [WARN] test2
      [2016-06-20T12:08:10.000Z] [ERROR] test2
      "
    `);
  });

  it('log multiple', async () => {
    expect.assertions(2);
    const logger = new Logger({
      transports: [
        new FirehoseLogTransport({
          flushInterval: -1,
          logDeliveryStreamName: 'test-stream',
        }),
        new ConsoleLogTransport(),
      ],
    });
    logger.info('test');
    await logger.close();
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    expect(consoleLog).toHaveBeenCalledTimes(1);
  });

  it('log json', async () => {
    expect.assertions(4);
    const logger = new Logger({
      jsonFormat: true,
      base: {
        foo: 'bar',
      },
      transports: [
        new FirehoseLogTransport({
          flushInterval: -1,
          logDeliveryStreamName: 'test-stream',
        }),
        new ConsoleLogTransport(),
      ],
    });
    logger.info('test');
    await logger.close();
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        AWS.FirehoseMock.commandCalls(
          AWS.PutRecordBatchCommand
        )[0].args[0].input.Records[0].Data.toString()
      )
    ).toMatchInlineSnapshot(`
      Object {
        "foo": "bar",
        "level": "INFO",
        "message": "test",
        "timestamp": "2016-06-20T12:08:10.000Z",
      }
    `);
    expect(JSON.parse(consoleLog.mock.calls[0][0])).toMatchInlineSnapshot(`
      Object {
        "foo": "bar",
        "level": "INFO",
        "message": "test",
        "timestamp": "2016-06-20T12:08:10.000Z",
      }
    `);
  });

  it('child loggers', async () => {
    expect.assertions(4);
    const logger = new Logger({
      base: {
        foo: 'bar',
      },
      jsonFormat: true,
      transports: [
        new FirehoseLogTransport({
          flushInterval: -1,
          logDeliveryStreamName: 'test-stream',
        }),
        new ConsoleLogTransport(),
      ],
    });
    const childLoggerFoo = logger.child({ metadata: { foo: 'foo' } });
    const childLoggerBar = logger.child({
      level: 'error',
      metadata: { bar: 'bar' },
    });
    childLoggerFoo.info('foo');
    childLoggerBar.info('bar');
    childLoggerBar.error('bin');
    logger.info('hello');
    await logger.flush();
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    expect(
      AWS.FirehoseMock.commandCalls(
        AWS.PutRecordBatchCommand
      )[0].args[0].input.Records[0].Data.toString()
    ).toMatchInlineSnapshot(`
      "{\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\",\\"level\\":\\"INFO\\",\\"message\\":\\"foo\\",\\"foo\\":\\"foo\\"}
      {\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\",\\"level\\":\\"ERROR\\",\\"message\\":\\"bin\\",\\"foo\\":\\"bar\\",\\"bar\\":\\"bar\\"}
      {\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\",\\"level\\":\\"INFO\\",\\"message\\":\\"hello\\",\\"foo\\":\\"bar\\"}
      "
    `);
    expect(consoleLog).toHaveBeenCalledTimes(3);
    expect(consoleLog.mock.calls).toMatchInlineSnapshot(`
      Array [
        Array [
          "{\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\",\\"level\\":\\"INFO\\",\\"message\\":\\"foo\\",\\"foo\\":\\"foo\\"}
      ",
        ],
        Array [
          "{\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\",\\"level\\":\\"ERROR\\",\\"message\\":\\"bin\\",\\"foo\\":\\"bar\\",\\"bar\\":\\"bar\\"}
      ",
        ],
        Array [
          "{\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\",\\"level\\":\\"INFO\\",\\"message\\":\\"hello\\",\\"foo\\":\\"bar\\"}
      ",
        ],
      ]
    `);
  });
});
