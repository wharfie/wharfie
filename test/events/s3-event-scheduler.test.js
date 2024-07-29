/* eslint-disable jest/no-hooks */
'use strict';

const AWSSQS = require('@aws-sdk/client-sqs');
let date,
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
    date = jest.spyOn(Date, 'now').mockReturnValue(1466424490000);
    event_db = require('../../lambdas/lib/dynamo/event');
    location_db = require('../../lambdas/lib/dynamo/location');
    resource_db = require('../../lambdas/lib/dynamo/resource');
    jest.mock('../../lambdas/lib/dynamo/event');
    jest.mock('../../lambdas/lib/dynamo/location');
    jest.mock('../../lambdas/lib/dynamo/resource');
    jest.mock('../../lambdas/lib/logging');
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
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key: 'a=10/b=20:1466424600000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {
        location: 's3://bucket/prefix/a=10/b=20/',
        partitionValues: ['a=10', 'b=20'],
      },
    });
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
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key: 'a=1/b=abc:1466424600000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {
        location: 's3://bucket/prefix/a=1/b=abc/',
        partitionValues: ['a=1', 'b=abc'],
      },
    });
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
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key: 'a=1/b=abc:1466424600000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {
        location: 's3://bucket/prefix/a=1/b=abc/',
        partitionValues: ['a=1', 'b=abc'],
      },
    });
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
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key: '2021/10:1466424480000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {
        location: 's3://bucket/prefix/2021/10/',
        partitionValues: ['2021', '10'],
      },
    });
  });

  it('run fixtured', async () => {
    expect.assertions(1);
    location_return = [
      {
        resource_id: '1',
        interval: 30,
        location:
          's3://wharfie-testing-079185815456-us-west-2/wharfie-testing/',
      },
    ];
    resource_mock = {
      source_properties: {
        tableType: 'EXTERNAL_TABLE',
      },
      destination_properties: {
        partitionKeys: [
          {
            name: 'dt',
            type: 'string',
          },
          {
            name: 'hr',
            type: 'string',
          },
          {
            name: 'lambda',
            type: 'string',
          },
        ],
      },
    };

    const s3Event = {
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      awsRegion: 'us-west-2',
      eventTime: '2023-09-04T19:50:41.917Z',
      eventName: 'ObjectCreated:CompleteMultipartUpload',
      userIdentity: {
        principalId: 'AWS:AROARE36XU6QB3S2TGYSW:wharfie-testing-daemon',
      },
      requestParameters: { sourceIPAddress: '52.42.132.142' },
      responseElements: {
        'x-amz-request-id': '805H3NA6MF1VM2XM',
        'x-amz-id-2':
          'tOKVfekqaF2OXt9OyQaUAJCSDa38zKlDN9AkhU05mEmsl6CnQU+UUWiGizEXWBPrjxukLm/O4TlEA/FiMGqbIN/hAuc1l4ac',
      },
      s3: {
        s3SchemaVersion: '1.0',
        configurationId: '69afebf5-7848-4a5a-867d-2b6c05fcde6a',
        bucket: {
          name: 'wharfie-testing-079185815456-us-west-2',
          ownerIdentity: { principalId: 'A21QW3A9R7W6GN' },
          arn: 'arn:aws:s3:::wharfie-testing-079185815456-us-west-2',
        },
        object: {
          key: 'wharfie-testing/dt%3D2023-09-04/hr%3D19/lambda%3Dwharfie-testing-daemon/2023_09_04_%5B%24LATEST%5De5033312656a4fb6b9d92cd6fcc3dcc6.log',
          size: 5265892,
          eTag: '8d7ee592453501b0d6e2186f97a63856-2',
          sequencer: '0064F635119B3846A9',
        },
      },
    };
    await router({ Records: [s3Event] }, {});

    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key:
        'dt=2023-09-04/hr=19/lambda=wharfie-testing-daemon:1466424480000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {
        location:
          's3://wharfie-testing-079185815456-us-west-2/wharfie-testing/dt=2023-09-04/hr=19/lambda=wharfie-testing-daemon/',
        partitionValues: [
          'dt=2023-09-04',
          'hr=19',
          'lambda=wharfie-testing-daemon',
        ],
      },
    });
  });

  it('run fixtured eventbridge', async () => {
    expect.assertions(1);
    location_return = [
      {
        resource_id: '1',
        interval: 30,
        location:
          's3://wharfie-testing-079185815456-us-west-2/wharfie-testing/',
      },
    ];
    resource_mock = {
      source_properties: {
        tableType: 'EXTERNAL_TABLE',
      },
      destination_properties: {
        partitionKeys: [
          {
            name: 'dt',
            type: 'string',
          },
          {
            name: 'hr',
            type: 'string',
          },
          {
            name: 'lambda',
            type: 'string',
          },
        ],
      },
    };

    const s3Event = {
      version: '0',
      id: '17793124-05d4-b198-2fde-7ededc63b103',
      'detail-type': 'Object Created',
      source: 'aws.s3',
      account: '123456789012',
      time: '2021-11-12T00:00:00Z',
      region: 'ca-central-1',
      resources: ['arn:aws:s3:::example-bucket'],
      detail: {
        version: '0',
        bucket: {
          name: 'wharfie-testing-079185815456-us-west-2',
        },
        object: {
          key: 'wharfie-testing/dt%3D2023-09-04/hr%3D19/lambda%3Dwharfie-testing-daemon/2023_09_04_%5B%24LATEST%5De5033312656a4fb6b9d92cd6fcc3dcc6.log',
          size: 5265892,
          etag: 'b1946ac92492d2347c6235b4d2611184',
          'version-id': 'IYV3p45BT0ac8hjHg1houSdS1a.Mro8e',
          sequencer: '00617F08299329D189',
        },
        'request-id': 'N4N7GDK58NMKJ12R',
        requester: '123456789012',
        'source-ip-address': '1.2.3.4',
        reason: 'PutObject',
      },
    };
    await router(s3Event, {});

    expect(
      JSON.parse(
        AWSSQS.SQSMock.commandCalls(AWSSQS.SendMessageCommand)[0].args[0].input
          .MessageBody
      )
    ).toStrictEqual({
      resource_id: '1',
      sort_key:
        'dt=2023-09-04/hr=19/lambda=wharfie-testing-daemon:1466424480000',
      started_at: 1466424490000,
      updated_at: 1466424490000,
      status: 'scheduled',
      partition: {
        location:
          's3://wharfie-testing-079185815456-us-west-2/wharfie-testing/dt=2023-09-04/hr=19/lambda=wharfie-testing-daemon/',
        partitionValues: [
          'dt=2023-09-04',
          'hr=19',
          'lambda=wharfie-testing-daemon',
        ],
      },
    });
  });
});
