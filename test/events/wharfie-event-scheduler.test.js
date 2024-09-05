/* eslint-disable jest/no-hooks */
'use strict';

const AWSSQS = require('@aws-sdk/client-sqs');

let logging,
  date,
  event_db,
  dependency_db,
  resource_db,
  router,
  resource_mock,
  dependency_return;

describe('tests for s3 event scheduling', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
    dependency_return = [];
    resource_mock = {
      source_properties: {
        tableType: 'EXTERNAL_TABLE',
      },
      destination_properties: {
        databaseName: 'test_db',
        name: 'test_table',
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
    date = jest.spyOn(Date, 'now').mockReturnValue(1466424490000);
    event_db = require('../../lambdas/lib/dynamo/event');
    dependency_db = require('../../lambdas/lib/dynamo/dependency');
    resource_db = require('../../lambdas/lib/dynamo/operations');
    logging = require('../../lambdas/lib/logging');
    jest.mock('../../lambdas/lib/dynamo/event');
    jest.mock('../../lambdas/lib/dynamo/dependency');
    jest.mock('../../lambdas/lib/dynamo/operations');
    jest.mock('../../lambdas/lib/logging');
    jest.spyOn(logging, 'getDaemonLogger').mockImplementation(() => ({
      debug: () => {},
      info: () => {},
    }));
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({});
    jest.spyOn(event_db, 'query').mockImplementation(() => []);
    jest.spyOn(event_db, 'schedule').mockImplementation();
    jest
      .spyOn(dependency_db, 'findDependencies')
      .mockImplementation(() => dependency_return);
    jest
      .spyOn(resource_db, 'getResource')
      .mockImplementation(() => resource_mock);
    router = require('../../lambdas/events/router');
  });

  afterEach(() => {
    date.mockClear();
    event_db.query.mockClear();
    event_db.schedule.mockClear();
    dependency_db.findDependencies.mockClear();
    resource_db.getResource.mockClear();
    AWSSQS.SQSMock.reset();
  });

  afterAll(() => {
    jest.resetAllMocks();
  });

  it('run complete', async () => {
    expect.assertions(1);

    dependency_return = [
      {
        resource_id: '1',
        interval: 300,
        dependency: 'test_db.test_table',
      },
    ];

    const wharfieEvent = {
      type: 'WHARFIE:OPERATION:COMPLETED',
      resource_id: '1',
      database_name: 'test_db',
      table_name: 'test_table',
      version: '0.0.1',
    };
    await router(wharfieEvent, {});

    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key: 'unpartitioned:1466424600000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {},
    });
  });
});
