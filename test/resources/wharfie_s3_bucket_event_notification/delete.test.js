/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSS3 = require('@aws-sdk/client-s3');
const delete_event = require('../../fixtures/wharfie-s3-bucket-event-notification-delete.json');
const { getImmutableID } = require('../../../lambdas/lib/cloudformation/id');

const nock = require('nock');

jest.useFakeTimers();

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfie s3-bucket-event-notification resource delete handler', () => {
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
    const id = getImmutableID(delete_event);

    AWSS3.S3Mock.on(AWSS3.GetBucketNotificationConfigurationCommand).resolves({
      QueueConfigurations: [
        {
          Id: id,
          QueueArn: 'fake-queue-arn',
          Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
        },
        {
          Id: 'an-innocent-notification-config',
          QueueArn: 'fake-queue-arn',
          Events: ['s3:ObjectCreated:*', 's3:ObjectRemoved:*'],
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
        expect(JSON.parse(body)).toMatchInlineSnapshot(`
          Object {
            "Data": Object {},
            "LogicalResourceId": "StackMappings",
            "NoEcho": false,
            "PhysicalResourceId": "8a20992363488c7290d6cbc4e39f7712",
            "RequestId": "d6713fab-cc44-490b-a44f-a0560ee41d99",
            "StackId": "arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/123121-5743-11eb-b528-0ebb325b25bf",
            "Status": "SUCCESS",
          }
        `);
        return '';
      });
    await lambda.handler(delete_event);

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
              "Id": "an-innocent-notification-config",
              "QueueArn": "fake-queue-arn",
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
