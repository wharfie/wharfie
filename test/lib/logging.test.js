/* eslint-disable jest/no-hooks */
'use strict';

const AWS = require('@aws-sdk/client-firehose');
const mockedDate = new Date(1466424490000);
jest.useFakeTimers('modern');
jest.setSystemTime(mockedDate);
let logging;
describe('tests for logging', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    require('aws-sdk-client-mock-jest');
    logging = require('../../lambdas/lib/logging');
  });
  afterEach(() => {
    AWS.FirehoseMock.reset();
  });

  it('getEventLogger', async () => {
    expect.assertions(2);
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
    const duplicate_logger = logging.getEventLogger(event, context);
    expect(logger).toStrictEqual(duplicate_logger);
    expect(logger).toBeDefined();
    await logging.flush(context);
  });
  it('getDaemonLogger', async () => {
    expect.assertions(2);
    const context = {
      awsRequestId: '123',
    };
    const logger = logging.getDaemonLogger();
    const duplicate_logger = logging.getDaemonLogger();
    expect(logger).toStrictEqual(duplicate_logger);
    expect(logger).toBeDefined();
    await logging.flush(context);
  });
  it('getAWSSDKLogger', async () => {
    expect.assertions(2);
    const context = {
      awsRequestId: '123',
    };
    const logger = logging.getAWSSDKLogger();
    const duplicate_logger = logging.getAWSSDKLogger();
    expect(logger).toStrictEqual(duplicate_logger);
    expect(logger).toBeDefined();
    await logging.flush(context);
  });

  it('test flush', async () => {
    expect.assertions(4);
    const event = {
      resource_id: 'resource_id',
      operation_id: 'operation_id',
      operation_type: 'operation_type',
      action_id: 'action_id',
      action_type: 'action_type',
      query_id: 'query_id',
    };
    const context = {
      awsRequestId: '1234',
    };
    let Eventlogger = logging.getEventLogger(event, context);
    let Daemonlogger = logging.getDaemonLogger();
    let AWSSDKLogger = logging.getAWSSDKLogger();
    Eventlogger.info('event');
    Daemonlogger.info('daemon');
    AWSSDKLogger.info('aws');
    await logging.flush(context);
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      1
    );
    expect(
      AWS.FirehoseMock.commandCalls(
        AWS.PutRecordBatchCommand
      )[0].args[0].input.Records[0].Data.toString()
    ).toMatchInlineSnapshot(`
      "{\\"message\\":\\"event\\",\\"level\\":\\"info\\",\\"service\\":\\"@wharfie/wharfie\\",\\"version\\":\\"0.0.5-52\\",\\"resource_id\\":\\"resource_id\\",\\"operation_id\\":\\"operation_id\\",\\"operation_type\\":\\"operation_type\\",\\"action_id\\":\\"action_id\\",\\"action_type\\":\\"action_type\\",\\"query_id\\":\\"query_id\\",\\"request_id\\":\\"1234\\",\\"log_type\\":\\"event\\",\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\"}
      {\\"message\\":\\"daemon\\",\\"level\\":\\"info\\",\\"service\\":\\"@wharfie/wharfie\\",\\"version\\":\\"0.0.5-52\\",\\"log_type\\":\\"daemon\\",\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\"}
      {\\"message\\":\\"aws\\",\\"level\\":\\"info\\",\\"service\\":\\"@wharfie/wharfie\\",\\"version\\":\\"0.0.5-52\\",\\"log_type\\":\\"aws_sdk\\",\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\"}
      "
    `);
    Eventlogger = logging.getEventLogger(event, context);
    Daemonlogger = logging.getDaemonLogger();
    AWSSDKLogger = logging.getAWSSDKLogger();
    Eventlogger.info('event 2');
    Daemonlogger.info('daemon 2');
    AWSSDKLogger.info('aws 2');
    await logging.flush(context);
    expect(AWS.FirehoseMock).toHaveReceivedCommandTimes(
      AWS.PutRecordBatchCommand,
      2
    );
    expect(
      AWS.FirehoseMock.commandCalls(
        AWS.PutRecordBatchCommand
      )[1].args[0].input.Records[0].Data.toString()
    ).toMatchInlineSnapshot(`
      "{\\"message\\":\\"event 2\\",\\"level\\":\\"info\\",\\"service\\":\\"@wharfie/wharfie\\",\\"version\\":\\"0.0.5-52\\",\\"resource_id\\":\\"resource_id\\",\\"operation_id\\":\\"operation_id\\",\\"operation_type\\":\\"operation_type\\",\\"action_id\\":\\"action_id\\",\\"action_type\\":\\"action_type\\",\\"query_id\\":\\"query_id\\",\\"request_id\\":\\"1234\\",\\"log_type\\":\\"event\\",\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\"}
      {\\"message\\":\\"daemon 2\\",\\"level\\":\\"info\\",\\"service\\":\\"@wharfie/wharfie\\",\\"version\\":\\"0.0.5-52\\",\\"log_type\\":\\"daemon\\",\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\"}
      {\\"message\\":\\"aws 2\\",\\"level\\":\\"info\\",\\"service\\":\\"@wharfie/wharfie\\",\\"version\\":\\"0.0.5-52\\",\\"log_type\\":\\"aws_sdk\\",\\"timestamp\\":\\"2016-06-20T12:08:10.000Z\\"}
      "
    `);
  });
});
