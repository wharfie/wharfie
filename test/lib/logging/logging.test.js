/* eslint-disable jest/no-hooks */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWS = require('@aws-sdk/client-firehose');
let consoleLog;
let logging;

describe('tests for logging', () => {
  beforeEach(() => {
    require('aws-sdk-client-mock-jest');
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    AWS.FirehoseMock.on(AWS.PutRecordBatchCommand).resolves({});
    process.env.WHARFIE_LOGGING_FIREHOSE = 'test_firehose';
    process.env.WHARFIE_LOGGING_FLUSH_INTERVAL = -1;
    process.env.LOGGING_LEVEL = 'debug';
    logging = require('../../../lambdas/lib/logging/');
  });

  afterEach(() => {
    AWS.FirehoseMock.reset();
    consoleLog.mockReset();
  });

  it('daemon logger', async () => {
    expect.assertions(3);

    const logger = logging.getDaemonLogger();
    logger.info('hello');

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      0,
    );
    expect(consoleLog).toHaveBeenCalledTimes(1);

    await logging.flush();

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1,
    );
  });

  it('event logger', async () => {
    expect.assertions(3);

    const event = {
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      action_id: 'action_id',
      action_type: 'action_type',
      query_id: 'query_id',
    };
    const context = {
      awsRequestId: '123',
    };
    const logger = logging.getEventLogger(event, context);
    logger.info('hello');

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      0,
    );
    expect(consoleLog).toHaveBeenCalledTimes(1);

    await logging.flush();

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1,
    );
  });

  it('aws_sdk logger', async () => {
    expect.assertions(3);

    const logger = logging.getAWSSDKLogger();
    logger.info('hello');

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      0,
    );
    expect(consoleLog).toHaveBeenCalledTimes(1);

    await logging.flush();

    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1,
    );
  });
});
