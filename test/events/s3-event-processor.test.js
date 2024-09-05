/* eslint-disable jest/no-hooks */
'use strict';

const AWSSQS = require('@aws-sdk/client-sqs');

let router, event_db, resource_db, logging, date, resource_mock;

describe('tests for s3 events processing', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    resource_mock = {
      source_properties: {
        tableType: 'EXTERNAL_TABLE',
      },
      destination_properties: {
        partitionKeys: [
          {
            name: 'a',
            type: 'string',
          },
          {
            name: 'b',
            type: 'string',
          },
        ],
      },
    };
    logging = require('../../lambdas/lib/logging');
    event_db = require('../../lambdas/lib/dynamo/event');
    resource_db = require('../../lambdas/lib/dynamo/operations');
    jest.mock('../../lambdas/lib/logging');
    jest.mock('../../lambdas/lib/dynamo/event');
    jest.mock('../../lambdas/lib/dynamo/operations');
    jest.spyOn(logging, 'getDaemonLogger').mockImplementation(() => ({
      debug: () => {},
      info: () => {},
    }));
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({});
    jest
      .spyOn(resource_db, 'getResource')
      .mockImplementation(() => resource_mock);
    jest.spyOn(event_db, 'update').mockImplementation();
    date = jest.spyOn(Date, 'now').mockReturnValue(1466424490000);
    router = require('../../lambdas/events/router');
  });

  afterEach(() => {
    event_db.update.mockClear();
    resource_db.getResource.mockClear();
    logging.getDaemonLogger.mockClear();
    AWSSQS.SQSMock.reset();
    date.mockClear();
  });

  afterAll(() => {
    jest.resetAllMocks();
  });

  it('run', async () => {
    expect.assertions(3);
    await router(
      {
        sort_key: 'a=1/b=abc:1',
        resource_id: '1',
        started_at: 1466424490000,
        updated_at: 1466424490000,
        status: 'queued',
        partition: {
          location: 's3://bucket/prefix/a=1/b=abc/',
          partitionValues: ['a=1', 'b=abc'],
        },
      },
      {}
    );

    expect(event_db.update).toHaveBeenCalledTimes(1);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      source: 'wharfie:s3-event-processor',
      operation_started_at: '2016-06-20T12:08:10.000Z',
      operation_type: 'S3_EVENT',
      action_type: 'START',
      resource_id: '1',
      operation_inputs: {
        partition: {
          location: 's3://bucket/prefix/a=1/b=abc/',
          partitionValues: { a: '1', b: 'abc' },
        },
      },
    });
  });

  it('run for unexpected path', async () => {
    expect.assertions(3);
    resource_mock = {
      source_properties: {
        tableType: 'EXTERNAL_TABLE',
      },
      destination_properties: {
        partitionKeys: [
          {
            name: 'a',
            type: 'bigint',
          },
          {
            name: 'b',
            type: 'string',
          },
        ],
      },
    };

    await router(
      {
        sort_key: 'a=1/b=abc:1',
        resource_id: '1',
        started_at: 1466424490000,
        updated_at: 1466424490000,
        status: 'queued',
        partition: {
          location:
            's3://bucket/prefix/123123123/a=1/1231231/b=abc/1231123123/',
          partitionValues: ['a=1', 'b=abc'],
        },
      },
      {}
    );

    expect(event_db.update).toHaveBeenCalledTimes(1);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      source: 'wharfie:s3-event-processor',
      operation_started_at: '2016-06-20T12:08:10.000Z',
      operation_type: 'S3_EVENT',
      action_type: 'START',
      resource_id: '1',
      operation_inputs: {
        partition: {
          location:
            's3://bucket/prefix/123123123/a=1/1231231/b=abc/1231123123/',
          partitionValues: { a: 1, b: 'abc' },
        },
      },
    });
  });

  it('run for no = signs', async () => {
    expect.assertions(3);
    resource_mock = {
      source_properties: {
        tableType: 'EXTERNAL_TABLE',
      },
      destination_properties: {
        partitionKeys: [
          {
            name: 'year',
            type: 'bigint',
          },
          {
            name: 'month',
            type: 'string',
          },
          {
            name: 'day',
            type: 'string',
          },
        ],
      },
    };

    await router(
      {
        sort_key: 'a=1/b=abc:1',
        resource_id: '1',
        started_at: 1466424490000,
        updated_at: 1466424490000,
        status: 'queued',
        partition: {
          location: 's3://bucket/prefix/2021/10/25/',
          partitionValues: ['2021', '10', '25'],
        },
      },
      {}
    );

    expect(event_db.update).toHaveBeenCalledTimes(1);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      source: 'wharfie:s3-event-processor',
      operation_started_at: '2016-06-20T12:08:10.000Z',
      operation_type: 'S3_EVENT',
      action_type: 'START',
      resource_id: '1',
      operation_inputs: {
        partition: {
          location: 's3://bucket/prefix/2021/10/25/',
          partitionValues: { year: 2021, month: '10', day: '25' },
        },
      },
    });
  });

  it('run for view', async () => {
    expect.assertions(3);
    resource_mock = {
      source_properties: {
        tableType: 'VIRTUAL_VIEW',
      },
      destination_properties: {
        partitionKeys: [
          {
            name: 'a',
            type: 'string',
          },
          {
            name: 'b',
            type: 'string',
          },
        ],
      },
    };

    await router(
      {
        sort_key: 'a=1/b=abc:1',
        resource_id: '1',
        started_at: 1466424490000,
        updated_at: 1466424490000,
        status: 'queued',
        partition: {
          location: 's3://bucket/prefix/a=1/b=abc/',
          partitionValues: ['a=1', 'b=abc'],
        },
      },
      {}
    );

    expect(event_db.update).toHaveBeenCalledTimes(1);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      source: 'wharfie:s3-event-processor',
      operation_started_at: '2016-06-20T12:08:10.000Z',
      operation_type: 'MAINTAIN',
      action_type: 'START',
    });
  });
});
