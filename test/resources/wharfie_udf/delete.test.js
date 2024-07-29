/* eslint-disable jest/no-hooks */
'use strict';

let lambda;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const delete_event = require('../../fixtures/wharfie-udf-delete.json');

const nock = require('nock');

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.WHARFIE_ARTIFACT_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';
process.env.STACK_NAME = 'wharfie-testing';

jest.useFakeTimers();

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('tests for wharfieUDF resource delete handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    AWSCloudFormation.CloudFormationMock.reset();
    nock.cleanAll();
  });

  it('basic', async () => {
    expect.assertions(3);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DeleteStackCommand
    ).resolves({});
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'DELETE_COMPLETE',
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
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.DeleteStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "StackName": "WharfieUDF-8a20992363488c7290d6cbc4e39f7712",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.DescribeStacksCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "StackName": "WharfieUDF-8a20992363488c7290d6cbc4e39f7712",
      }
    `);
  });
});
