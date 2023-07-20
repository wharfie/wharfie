/* eslint-disable jest/no-hooks */
'use strict';

const AWSSQS = require('@aws-sdk/client-sqs');

let logging,
  date,
  event_db,
  location_db,
  resource_db,
  router,
  resource_mock,
  location_return;

describe('tests for s3 event scheduling', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    location_return = [];
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
    date = jest.spyOn(Date, 'now').mockReturnValue(1466424490000);
    event_db = require('../../lambdas/lib/dynamo/event');
    location_db = require('../../lambdas/lib/dynamo/location');
    resource_db = require('../../lambdas/lib/dynamo/resource');
    logging = require('../../lambdas/lib/logging');
    jest.mock('../../lambdas/lib/dynamo/event');
    jest.mock('../../lambdas/lib/dynamo/location');
    jest.mock('../../lambdas/lib/dynamo/resource');
    jest.mock('../../lambdas/lib/logging');
    jest.spyOn(logging, 'getDaemonLogger').mockImplementation(() => ({
      debug: () => {},
      info: () => {},
    }));
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({});
    jest.spyOn(event_db, 'query').mockImplementation(() => []);
    jest.spyOn(event_db, 'schedule').mockImplementation();
    jest
      .spyOn(location_db, 'findLocations')
      .mockImplementation(() => location_return);
    jest
      .spyOn(resource_db, 'getResource')
      .mockImplementation(() => resource_mock);
    router = require('../../lambdas/events/router');
  });

  afterEach(() => {
    date.mockClear();
    event_db.query.mockClear();
    event_db.schedule.mockClear();
    location_db.findLocations.mockClear();
    resource_db.getResource.mockClear();
    AWSSQS.SQSMock.reset();
  });

  afterAll(() => {
    jest.resetAllMocks();
  });

  it('ignore processing_failed/ events', async () => {
    expect.assertions(4);
    location_return = [
      {
        resource_id: '1',
        interval: 300,
        location: 's3://bucket/prefix/',
      },
    ];

    const s3Event = {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket',
        },
        object: {
          key: 'prefix/processing_failed/file.txt',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(location_db.findLocations).toHaveBeenCalledTimes(0);
    expect(event_db.schedule).toHaveBeenCalledTimes(0);
    expect(event_db.query).toHaveBeenCalledTimes(0);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      0
    );
  });

  it('ignore patition count mis-matches', async () => {
    expect.assertions(4);
    location_return = [
      {
        resource_id: '1',
        interval: 300,
        location: 's3://bucket/prefix/',
      },
    ];

    const s3Event = {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket',
        },
        object: {
          key: 'prefix/not_matching/file.txt',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(location_db.findLocations).toHaveBeenCalledTimes(1);
    expect(event_db.schedule).toHaveBeenCalledTimes(0);
    expect(event_db.query).toHaveBeenCalledTimes(0);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      0
    );
  });

  it('run complete', async () => {
    expect.assertions(1);

    location_return = [
      {
        resource_id: '1',
        interval: 300,
        location: 's3://bucket/prefix/',
      },
    ];

    const s3Event = {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket',
        },
        object: {
          key: 'prefix/a=10/b=20/randomstring/file.txt',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"resource_id\\":\\"1\\",\\"sort_key\\":\\"a=10/b=20:1466424600000\\",\\"started_at\\":1466424490000,\\"updated_at\\":1466424490000,\\"status\\":\\"scheduled\\",\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/a=10/b=20/\\",\\"partitionValues\\":[\\"a=10\\",\\"b=20\\"]}}",
        "QueueUrl": "",
      }
    `);
  });

  it('run complete with partitioning', async () => {
    expect.assertions(1);

    location_return = [
      {
        resource_id: '1',
        interval: 300,
        location: 's3://bucket/prefix/',
      },
    ];

    const s3Event = {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket',
        },
        object: {
          key: 'prefix/a=1/b=abc/file.txt',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"resource_id\\":\\"1\\",\\"sort_key\\":\\"a=1/b=abc:1466424600000\\",\\"started_at\\":1466424490000,\\"updated_at\\":1466424490000,\\"status\\":\\"scheduled\\",\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/a=1/b=abc/\\",\\"partitionValues\\":[\\"a=1\\",\\"b=abc\\"]}}",
        "QueueUrl": "",
      }
    `);
  });

  it('run complete with odd s3 path structure and partitioning', async () => {
    expect.assertions(1);

    location_return = [
      {
        resource_id: '1',
        interval: 300,
        location: 's3://bucket/prefix/',
      },
    ];

    const s3Event = {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket',
        },
        object: {
          key: 'prefix/refs/a=1/123123123/b=abc/123123123/file.txt',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"resource_id\\":\\"1\\",\\"sort_key\\":\\"a=1/b=abc:1466424600000\\",\\"started_at\\":1466424490000,\\"updated_at\\":1466424490000,\\"status\\":\\"scheduled\\",\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/a=1/b=abc/\\",\\"partitionValues\\":[\\"a=1\\",\\"b=abc\\"]}}",
        "QueueUrl": "",
      }
    `);
  });

  it('run complete with no = signs in path', async () => {
    expect.assertions(1);

    location_return = [
      {
        resource_id: '1',
        interval: 30,
        location: 's3://bucket/prefix/',
      },
    ];

    const s3Event = {
      eventSource: 'aws:s3',
      s3: {
        bucket: {
          name: 'bucket',
        },
        object: {
          key: 'prefix/2021/10/file.txt',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(
      AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "MessageBody": "{\\"resource_id\\":\\"1\\",\\"sort_key\\":\\"2021/10:1466424480000\\",\\"started_at\\":1466424490000,\\"updated_at\\":1466424490000,\\"status\\":\\"scheduled\\",\\"partition\\":{\\"location\\":\\"s3://bucket/prefix/2021/10/\\",\\"partitionValues\\":[\\"2021\\",\\"10\\"]}}",
        "QueueUrl": "",
      }
    `);
  });
});
