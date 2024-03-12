/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSS3 = require('@aws-sdk/client-s3');
const update_event = require('../../fixtures/wharfie-s3-bucket-event-notification-update.json');
const { getImmutableID } = require('../../../lambdas/lib/cloudformation/id');

const nock = require('nock');

jest.useFakeTimers();
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfie s3-bucket-event-notification resource update handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    AWSS3.S3Mock.reset();
    nock.cleanAll();
  });

  it('basic', async () => {
    expect.assertions(3);

    const id = getImmutableID(update_event);
    AWSS3.S3Mock.on(AWSS3.GetBucketNotificationConfigurationCommand).resolves({
      QueueConfigurations: [
        {
          Id: id,
          QueueArn: 'fake-queue-arn',
          Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
          Filter: {
            Key: {
              FilterRules: [
                {
                  Name: 'prefix',
                  Value: 'stack-mappings/staging/',
                },
              ],
            },
          },
        },
      ],
    });

    AWSS3.S3Mock.on(AWSS3.PutBucketNotificationConfigurationCommand).resolves(
      {}
    );
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler(update_event);
    expect(
      AWSS3.S3Mock.commandCalls(
        AWSS3.PutBucketNotificationConfigurationCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Bucket": "wharfie",
        "NotificationConfiguration": Object {
          "LambdaFunctionConfigurations": undefined,
          "QueueConfigurations": Array [
            Object {
              "Events": Array [
                "s3:ObjectCreated:*",
                "s3:ObjectRemoved:*",
              ],
              "Filter": Object {
                "Key": Object {
                  "FilterRules": Array [
                    Object {
                      "Name": "prefix",
                      "Value": "stack-mappings/production/",
                    },
                  ],
                },
              },
              "Id": "260ca406900a3f747e42cd69c3591fd9",
              "QueueArn": "",
            },
          ],
          "TopicConfigurations": undefined,
        },
        "SkipDestinationValidation": false,
      }
    `);

    expect(AWSS3.S3Mock).toHaveReceivedCommandTimes(
      AWSS3.GetBucketNotificationConfigurationCommand,
      1
    );
  });
});
