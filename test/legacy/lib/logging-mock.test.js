/* eslint-disable jest/no-hooks */
import { describe, expect, it } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const logging = require('../../lambdas/lib/logging');

describe('mock tests for logging', () => {
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

    await logging.flush();
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

    const logger = logging.getAWSSDKLogger();
    const duplicate_logger = logging.getAWSSDKLogger();

    expect(logger).toStrictEqual(duplicate_logger);
    expect(logger).toBeDefined();

    await logging.flush();
  });

  it('test flush', async () => {
    expect.assertions(0);

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
    await logging.flush();
    Eventlogger = logging.getEventLogger(event, context);
    Daemonlogger = logging.getDaemonLogger();
    AWSSDKLogger = logging.getAWSSDKLogger();
    Eventlogger.info('event 2');
    Daemonlogger.info('daemon 2');
    AWSSDKLogger.info('aws 2');
    await logging.flush();
  });
});
