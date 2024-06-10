/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSS3 = require('@aws-sdk/client-s3');
const create_event = require('../../fixtures/wharfie-udf-create.json');

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

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('tests for wharfieUDF resource create handler', () => {
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

  it('basic', async () => {
    expect.assertions(4);
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.CreateStackCommand
    ).resolves({});

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'CREATE_COMPLETE',
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
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging-stack-mappings/f59e6e30-1fe7-11ec-a665-1240661c4205\\",\\"RequestId\\":\\"1065fa64-f86e-4894-a6a9-7faa2a2515c6\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"6afd22c8fb977fe4b9df55ed495499f3\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler(create_event);

    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": Readable {
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
            "highWaterMark": 16,
            "length": 0,
            "pipes": Array [],
            Symbol(kState): 1052941,
          },
          Symbol(shapeMode): true,
          Symbol(kCapture): false,
        },
        "Bucket": "service-bucket",
        "ContentLength": 1641,
        "Key": "wharfie-templates/WharfieUDF-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);

    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.CreateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "Capabilities": Array [
          "CAPABILITY_IAM",
        ],
        "StackName": "WharfieUDF-6afd22c8fb977fe4b9df55ed495499f3",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging-stack-mappings",
          },
        ],
        "TemplateURL": "https://service-bucket.s3.amazonaws.com/wharfie-templates/WharfieUDF-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
  });
});
