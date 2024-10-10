/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

process.env.AWS_MOCKS = '1';

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');
jest.mock('../../lambdas/lib/dynamo/state');
const WharfieProject = require('../../lambdas/lib/actor/resources/wharfie-project');
const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');
const { resetAWSMocks } = require('../util');
const { load } = require('../../lambdas/lib/actor/deserialize');

const { S3 } = require('@aws-sdk/client-s3');
const { SQS } = require('@aws-sdk/client-sqs');
const s3 = new S3();
const sqs = new SQS();

describe('wharfie project IaC', () => {
  afterEach(() => {
    resetAWSMocks();
  });
  it('normal project migration', async () => {
    expect.assertions(11);
    // setting up buckets for mock
    // @ts-ignore
    s3.__setMockState({
      's3://amazon-berkeley-objects/empty.json': '',
      's3://utility-079185815456-us-west-2/empty.json': '',
    });
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {
        createdAt: 123456789,
      },
    });
    await deployment.reconcile();
    const DAEMON_QUEUE_URL = deployment.getDaemonActor().getQueue().get('url');
    const SCHEDULE_QUEUE_URL = deployment
      .getEventsActor()
      .getQueue()
      .get('url');

    const wharfieProject = new WharfieProject({
      name: 'test-wharife-project',
      deployment,
      properties: {
        createdAt: 123456789,
      },
    });
    const RESOURCE_DEF = {
      name: 'amazon_berkely_objects',
      properties: {
        description:
          'Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
        columns: [
          {
            name: 'brand',
            type: 'array<struct<language_tag:string,value:string>>',
          },
          {
            name: 'country',
            type: 'string',
          },
        ],
        inputLocation: 's3://amazon-berkeley-objects/listings/metadata/',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          EXTERNAL: 'true',
        },
        inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
        outputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        numberOfBuckets: 0,
        storedAsSubDirectories: true,
        serdeInfo: {
          SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
          Parameters: {
            'ignore.malformed.json': 'true',
          },
        },
        userInput: {
          name: 'amazon_berkely_objects',
          description:
            'Amazon Berkeley Objects Product Metadata table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
          format: 'json',
          input_location: {
            storage: 's3',
            path: 's3://amazon-berkeley-objects/listings/metadata/',
          },
          service_level_agreement: {
            freshness: 60,
          },
          columns: [
            {
              name: 'brand',
              type: 'array<struct<language_tag:string,value:string>>',
            },
            {
              name: 'country',
              type: 'string',
            },
          ],
        },
      },
    };
    wharfieProject.registerWharfieResources([RESOURCE_DEF]);

    await wharfieProject.reconcile();

    expect(sqs.__getMockState().queues[SCHEDULE_QUEUE_URL].queue).toHaveLength(
      1
    );

    const deserializedProject = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-wharife-project',
    });

    expect(deserializedProject.status).toBe('STABLE');

    deserializedProject.registerWharfieResources([RESOURCE_DEF]);
    expect(deserializedProject.status).toBe('DRIFTED');
    await deserializedProject.reconcile();
    expect(sqs.__getMockState().queues[SCHEDULE_QUEUE_URL].queue).toHaveLength(
      1
    );
    expect(deserializedProject.status).toBe('STABLE');

    expect(sqs.__getMockState().queues[DAEMON_QUEUE_URL].queue).toHaveLength(0);
    RESOURCE_DEF.properties.columns[1].name = 'country_of_origin';
    RESOURCE_DEF.properties.userInput.columns[1].name = 'country_of_origin';
    deserializedProject.registerWharfieResources([RESOURCE_DEF]);
    expect(deserializedProject.status).toBe('DRIFTED');
    console.log('TEST BEGIN');
    await deserializedProject.reconcile();
    expect(sqs.__getMockState().queues[DAEMON_QUEUE_URL].queue).toHaveLength(1);
    expect(deserializedProject.status).toBe('STABLE');

    await deserializedProject.destroy();
    expect(deserializedProject.status).toBe('DESTROYED');
    expect(sqs.__getMockState().queues[SCHEDULE_QUEUE_URL].queue).toHaveLength(
      1
    );
  }, 10000);
});
