/* eslint-disable jest/no-hooks */
'use strict';

const AWSSQS = require('@aws-sdk/client-sqs');

let router, event_db, resource_db, logging, date, resource_mock;

describe('tests for s3 events processing', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    resource_mock = {
      source_properties: {
        TableInput: {
          TableType: 'EXTERNAL_TABLE',
        },
      },
      destination_properties: {
        TableInput: {
          PartitionKeys: [
            {
              Name: 'a',
              Type: 'string',
            },
            {
              Name: 'b',
              Type: 'string',
            },
          ],
        },
      },
    };
    logging = require('../../lambdas/lib/logging');
    event_db = require('../../lambdas/lib/dynamo/event');
    resource_db = require('../../lambdas/lib/dynamo/resource');
    jest.mock('../../lambdas/lib/logging');
    jest.mock('../../lambdas/lib/dynamo/event');
    jest.mock('../../lambdas/lib/dynamo/resource');
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
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"source\\":\\"wharfie:s3-event-processor\\",\\"operation_started_at\\":\\"2016-06-20T12:08:10.000Z\\",\\"operation_type\\":\\"S3_EVENT\\",\\"action_type\\":\\"START\\",\\"resource_id\\":\\"1\\",\\"operation_inputs\\":{\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/a=1/b=abc/\\",\\"partitionValues\\":{\\"b\\":\\"abc\\",\\"a\\":\\"1\\"}}}}",
        "QueueUrl": "",
      }
    `);
  });

  it('run for unexpected path', async () => {
    expect.assertions(3);
    resource_mock = {
      source_properties: {
        TableInput: {
          TableType: 'EXTERNAL_TABLE',
        },
      },
      destination_properties: {
        TableInput: {
          PartitionKeys: [
            {
              Name: 'a',
              Type: 'bigint',
            },
            {
              Name: 'b',
              Type: 'string',
            },
          ],
        },
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
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"source\\":\\"wharfie:s3-event-processor\\",\\"operation_started_at\\":\\"2016-06-20T12:08:10.000Z\\",\\"operation_type\\":\\"S3_EVENT\\",\\"action_type\\":\\"START\\",\\"resource_id\\":\\"1\\",\\"operation_inputs\\":{\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/123123123/a=1/1231231/b=abc/1231123123/\\",\\"partitionValues\\":{\\"b\\":\\"abc\\",\\"a\\":1}}}}",
        "QueueUrl": "",
      }
    `);
  });

  it('run for no = signs', async () => {
    expect.assertions(3);
    resource_mock = {
      source_properties: {
        TableInput: {
          TableType: 'EXTERNAL_TABLE',
        },
      },
      destination_properties: {
        TableInput: {
          PartitionKeys: [
            {
              Name: 'year',
              Type: 'bigint',
            },
            {
              Name: 'month',
              Type: 'string',
            },
            {
              Name: 'day',
              Type: 'string',
            },
          ],
        },
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
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"source\\":\\"wharfie:s3-event-processor\\",\\"operation_started_at\\":\\"2016-06-20T12:08:10.000Z\\",\\"operation_type\\":\\"S3_EVENT\\",\\"action_type\\":\\"START\\",\\"resource_id\\":\\"1\\",\\"operation_inputs\\":{\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/2021/10/25/\\",\\"partitionValues\\":{\\"day\\":\\"25\\",\\"month\\":\\"10\\",\\"year\\":2021}}}}",
        "QueueUrl": "",
      }
    `);
  });

  it('run for view', async () => {
    expect.assertions(3);
    resource_mock = {
      source_properties: {
        TableInput: {
          TableType: 'VIRTUAL_VIEW',
        },
      },
      destination_properties: {
        TableInput: {
          PartitionKeys: [
            {
              Name: 'a',
              Type: 'string',
            },
            {
              Name: 'b',
              Type: 'string',
            },
          ],
        },
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
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"source\\":\\"wharfie:s3-event-processor\\",\\"operation_started_at\\":\\"2016-06-20T12:08:10.000Z\\",\\"operation_type\\":\\"MAINTAIN\\",\\"action_type\\":\\"START\\"}",
        "QueueUrl": "",
      }
    `);
  });
});
