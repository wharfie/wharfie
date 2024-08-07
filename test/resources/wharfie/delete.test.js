/* eslint-disable jest/no-hooks */
'use strict';

let lambda, location_db, resource_db, semaphore_db, event_db, dependency_db;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const delete_event = require('../../fixtures/wharfie-delete.json');

const nock = require('nock');

jest.useFakeTimers();

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.WHARFIE_ARTIFACT_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';
process.env.STACK_NAME = 'wharfie-testing';

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('tests for wharfie resource delete handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    location_db = require('../../../lambdas/lib/dynamo/location');
    resource_db = require('../../../lambdas/lib/dynamo/resource');
    semaphore_db = require('../../../lambdas/lib/dynamo/semaphore');
    event_db = require('../../../lambdas/lib/dynamo/event');
    dependency_db = require('../../../lambdas/lib/dynamo/dependency');
    jest.mock('../../../lambdas/lib/dynamo/location');
    jest.mock('../../../lambdas/lib/dynamo/resource');
    jest.mock('../../../lambdas/lib/dynamo/semaphore');
    jest.mock('../../../lambdas/lib/dynamo/event');
    jest.mock('../../../lambdas/lib/dynamo/dependency');
    jest.spyOn(location_db, 'deleteLocation').mockImplementation();
    jest.spyOn(resource_db, 'deleteResource').mockImplementation();
    jest.spyOn(semaphore_db, 'deleteSemaphore').mockImplementation();
    jest.spyOn(event_db, 'delete_records').mockImplementation();
    jest.spyOn(dependency_db, 'deleteDependency').mockImplementation();
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    location_db.deleteLocation.mockClear();
    resource_db.deleteResource.mockClear();
    semaphore_db.deleteSemaphore.mockClear();
    event_db.delete_records.mockClear();
    dependency_db.deleteDependency.mockClear();
    AWSCloudFormation.CloudFormationMock.reset();
    nock.cleanAll();
  });

  it('basic', async () => {
    expect.assertions(8);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DeleteStackCommand
    ).resolves({});
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).rejects({
      message: 'Stack does not exist',
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

    expect(resource_db.deleteResource.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        "Wharfie-8a20992363488c7290d6cbc4e39f7712",
      ]
    `);
    expect(semaphore_db.deleteSemaphore.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        "wharfie:MAINTAIN:Wharfie-8a20992363488c7290d6cbc4e39f7712",
      ]
    `);
    expect(semaphore_db.deleteSemaphore.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        "wharfie:BACKFILL:Wharfie-8a20992363488c7290d6cbc4e39f7712",
      ]
    `);
    expect(location_db.deleteLocation.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "interval": "300",
          "location": "s3://wharfie/stack-mappings/staging/",
          "resource_id": "Wharfie-8a20992363488c7290d6cbc4e39f7712",
        },
      ]
    `);
    expect(event_db.delete_records.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        "Wharfie-8a20992363488c7290d6cbc4e39f7712",
      ]
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.DeleteStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "StackName": "Wharfie-8a20992363488c7290d6cbc4e39f7712",
      }
    `);
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
  });
});
