/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSS3 = require('@aws-sdk/client-s3');
const update_event = require('../../fixtures/wharfie-udf-update.json');

const nock = require('nock');

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.WHARFIE_ARTIFACT_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';

jest.useFakeTimers();
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfieUDF resource update handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    AWSS3.S3Mock.reset();
    AWSCloudFormation.CloudFormationMock.reset();
    nock.cleanAll();
  });

  it('handle no update error', async () => {
    expect.assertions(4);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'UPDATE_COMPLETE',
        },
      ],
    });
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
    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": Readable {
          "_destroy": [Function],
          "_events": Object {
            "close": undefined,
            "data": undefined,
            "end": undefined,
            "error": undefined,
            "readable": undefined,
          },
          "_maxListeners": undefined,
          "_read": [Function],
          "_readableState": ReadableState {
            "awaitDrainWriters": null,
            "buffer": Array [],
            "bufferIndex": 0,
            "highWaterMark": 1,
            "length": 0,
            "pipes": Array [],
            Symbol(kState): 1052941,
          },
          Symbol(shapeMode): true,
          Symbol(kCapture): false,
        },
        "Bucket": "service-bucket",
        "Key": "wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.UpdateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Capabilities": Array [
          "CAPABILITY_IAM",
        ],
        "StackName": "WharfieUDF-260ca406900a3f747e42cd69c3591fd9",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging",
          },
        ],
        "TemplateURL": "https://service-bucket.s3.amazonaws.com/wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.DescribeStacksCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "StackName": "stack_id",
      }
    `);
  });

  it('handle failure', async () => {
    expect.assertions(3);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'ROLLBACK_COMPLETE',
        },
      ],
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStackEventsCommand
    ).resolves({
      StackEvents: [
        {
          ResourceStatus: 'UPDATE_FAILED',
          ResourceStatusReason: 'some error occured',
          Timestamp: new Date('2021-01-19T20:00:00.000Z'),
        },
      ],
    });
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"FAILED\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false,\\"Reason\\":\\"Error: some error occured\\"}"`
        );
        return '';
      });
    await lambda.handler(update_event);

    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStackEventsCommand,
      1
    );
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
  });

  it('basic', async () => {
    expect.assertions(4);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'UPDATE_COMPLETE',
        },
      ],
    });
    update_event.OldResourceProperties.Tags[0].Value = 'wharfie-testing';
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

    // eslint-disable-next-line jest/no-large-snapshots
    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": Readable {
          "_destroy": [Function],
          "_events": Object {
            "close": undefined,
            "data": undefined,
            "end": undefined,
            "error": undefined,
            "readable": undefined,
          },
          "_maxListeners": undefined,
          "_read": [Function],
          "_readableState": ReadableState {
            "awaitDrainWriters": null,
            "buffer": Array [],
            "bufferIndex": 0,
            "highWaterMark": 1,
            "length": 0,
            "pipes": Array [],
            Symbol(kState): 1052941,
          },
          Symbol(shapeMode): true,
          Symbol(kCapture): false,
        },
        "Bucket": "service-bucket",
        "Key": "wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.UpdateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Capabilities": Array [
          "CAPABILITY_IAM",
        ],
        "StackName": "WharfieUDF-260ca406900a3f747e42cd69c3591fd9",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging",
          },
        ],
        "TemplateURL": "https://service-bucket.s3.amazonaws.com/wharfie-templates/WharfieUDF-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);

    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
  });
});
