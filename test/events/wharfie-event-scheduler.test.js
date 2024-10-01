/* eslint-disable jest/no-hooks */
'use strict';

const AWSSQS = require('@aws-sdk/client-sqs');

let logging,
  date,
  scheduler_db,
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
    scheduler_db = require('../../lambdas/lib/dynamo/scheduler');
    dependency_db = require('../../lambdas/lib/dynamo/dependency');
    resource_db = require('../../lambdas/lib/dynamo/operations');
    logging = require('../../lambdas/lib/logging');
    jest.mock('../../lambdas/lib/dynamo/scheduler');
    jest.mock('../../lambdas/lib/dynamo/dependency');
    jest.mock('../../lambdas/lib/dynamo/operations');
    jest.mock('../../lambdas/lib/logging');
    jest.spyOn(logging, 'getDaemonLogger').mockImplementation(() => ({
      debug: () => {},
      info: () => {},
    }));
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({});
    jest.spyOn(scheduler_db, 'query').mockImplementation(() => []);
    jest.spyOn(scheduler_db, 'schedule').mockImplementation();
    jest
      .spyOn(dependency_db, 'findDependencies')
      .mockImplementation(() => dependency_return);
    jest
      .spyOn(resource_db, 'getResource')
      .mockImplementation(() => resource_mock);
    router = require('../../lambdas/scheduler/router');
  });

  afterEach(() => {
    date.mockClear();
    scheduler_db.query.mockClear();
    scheduler_db.schedule.mockClear();
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
      status: 'SCHEDULED',
      type: 'SchedulerEntry',
      version: '0.0.11',
      retries: 0,
    });
  });
});
