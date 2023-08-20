/* eslint-disable jest/no-large-snapshots */
'use strict';

jest.requireMock('@aws-sdk/client-s3');
const {
  getEventLogger,
  getDaemonLogger,
  flush,
} = require('../../lambdas/lib/logging');

describe('tests for logging', () => {
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
    const logger = getEventLogger(event, context);
    const duplicate_logger = getEventLogger(event, context);
    expect(logger).toStrictEqual(duplicate_logger);
    expect(logger).toBeDefined();
    await flush(context);
  });
  it('getDaemonLogger', async () => {
    expect.assertions(2);
    const context = {
      awsRequestId: '123',
    };
    const logger = getDaemonLogger();
    const duplicate_logger = getDaemonLogger();
    expect(logger).toStrictEqual(duplicate_logger);
    expect(logger).toBeDefined();
    await flush(context);
  });
});
