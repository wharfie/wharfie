/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSS3 = require('@aws-sdk/client-s3');
const create_event = require('../../fixtures/wharfie-s3-bucket-event-notification-create.json');

const nock = require('nock');

describe('tests for wharfie s3-bucket-event-notification resource create handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    AWSS3.S3Mock.reset();
    nock.cleanAll();
  });

  it('basic', async () => {
    expect.assertions(3);
    AWSS3.S3Mock.on(AWSS3.GetBucketNotificationConfigurationCommand).resolves({
      QueueConfigurations: [
        {
          Id: 'existing-queue',
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
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging-stack-mappings/f59e6e30-1fe7-11ec-a665-1240661c4205\\",\\"RequestId\\":\\"1065fa64-f86e-4894-a6a9-7faa2a2515c6\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"6afd22c8fb977fe4b9df55ed495499f3\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler(create_event);

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
              "Id": "existing-queue",
              "QueueArn": "fake-queue-arn",
            },
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
                      "Value": "stack-mappings/staging/",
                    },
                  ],
                },
              },
              "Id": "6afd22c8fb977fe4b9df55ed495499f3",
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
