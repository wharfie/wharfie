/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
jest.mock('crypto');

const crypto = require('crypto');
const WharfieActorResources = require('../../lambdas/lib/actor/resources/wharfie-actor-resources');
const { Policy, Bucket } = require('../../lambdas/lib/actor/resources/aws');
const { getMockDeploymentProperties } = require('./util');

describe('wharfie actor resources IaC', () => {
  beforeAll(() => {
    const mockUpdate = jest.fn().mockReturnThis();
    const mockDigest = jest.fn().mockReturnValue('mockedHash');
    // @ts-ignore
    crypto.createHash.mockReturnValue({
      update: mockUpdate,
      digest: mockDigest,
    });
  });
  afterAll(() => {
    jest.restoreAllMocks();
  });
  it('basic', async () => {
    expect.assertions(3);
    const bucket = new Bucket({
      name: 'test-bucket',
      properties: {
        deployment: getMockDeploymentProperties(),
      },
    });
    await bucket.reconcile();
    const sharedPolicy = new Policy({
      name: `shared-policy`,
      properties: {
        deployment: getMockDeploymentProperties(),
        description: `shared policy`,
        document: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['athena:GetQueryExecution', 'athena:*'],
              Resource: '*',
            },
          ],
        }),
      },
    });
    await sharedPolicy.reconcile();
    const wharfieActorResources = new WharfieActorResources({
      name: 'test-actor-resources',
      properties: {
        deployment: getMockDeploymentProperties(),
        handler: './lambdas/monitor.handler',
        actorName: 'test-actor',
        actorSharedPolicyArn: sharedPolicy.get('arn'),
        artifactBucket: bucket.name,
        environmentVariables: () => {
          return {
            foo: 'bar',
            123: `456`,
          };
        },
      },
    });
    await wharfieActorResources.reconcile();

    const serialized = wharfieActorResources.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-actor-resources",
        "parent": "",
        "properties": {
          "actorName": "test-actor",
          "actorSharedPolicyArn": "arn:aws:iam::123456789012:policy/shared-policy",
          "artifactBucket": "test-bucket",
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
          "environmentVariables": {
            "123": "456",
            "foo": "bar",
          },
          "handler": "./lambdas/monitor.handler",
        },
        "resourceType": "WharfieActorResources",
        "resources": [
          "test-deployment-test-actor-build",
          "test-deployment-test-actor-function",
          "test-deployment-test-actor-queue",
          "test-deployment-test-actor-dlq",
          "test-deployment-test-actor-role",
          "test-actor-mapping",
        ],
        "status": "STABLE",
      }
    `);

    expect(wharfieActorResources.status).toBe('STABLE');
    await wharfieActorResources.destroy();
    expect(wharfieActorResources.status).toBe('DESTROYED');
  });
});
