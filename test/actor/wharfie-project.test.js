/* eslint-disable jest/no-large-snapshots */
/* eslint-disable jest/no-hooks */
'use strict';

const path = require('path');

process.env.AWS_MOCKS = '1';

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');
const WharfieProject = require('../../lambdas/lib/actor/resources/wharfie-project');
const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');
const { getResourceOptions } = require('../../cli/project/template-actor');
const { loadProject } = require('../../cli/project/load');
const { resetAWSMocks } = require('../util');

const { S3 } = require('@aws-sdk/client-s3');
const { SQS } = require('@aws-sdk/client-sqs');
const s3 = new S3();
const sqs = new SQS();

describe('wharfie project IaC', () => {
  afterEach(() => {
    resetAWSMocks();
  });
  it('empty project', async () => {
    expect.assertions(3);
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {
        createdAt: 123456789,
      },
    });
    await deployment.reconcile();
    const wharfieProject = new WharfieProject({
      name: 'test-wharife-project',
      deployment,
      properties: {
        createdAt: 123456789,
      },
    });
    await wharfieProject.reconcile();

    const serialized = wharfieProject.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-wharife-project",
        "parent": "",
        "properties": {
          "actorRoleArns": [
            "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
            "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
            "arn:aws:iam::123456789012:role/test-deployment-events-role",
            "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
          ],
          "createdAt": 123456789,
          "daemonQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
          "dependencyTable": "test-deployment-dependencies",
          "deployment": {
            "accountId": "",
            "envPaths": {
              "cache": "mock",
              "config": "mock",
              "data": "mock",
              "log": "mock",
              "temp": "mock",
            },
            "name": "test-deployment",
            "region": "us-west-2",
            "stateTable": "test-deployment-state",
            "version": "0.0.1",
          },
          "deploymentSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-shared-policy",
          "eventsQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
          "locationTable": "test-deployment-locations",
          "operationTable": "test-deployment-operations",
          "project": {
            "name": "test-wharife-project",
          },
          "scheduleQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
          "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
        },
        "resourceType": "WharfieProject",
        "resources": [
          "test-wharife-project",
          "test-wharife-project-bucket-lz-fc6bi",
          "test-wharife-project-project-role",
        ],
        "status": "STABLE",
      }
    `);

    expect(wharfieProject.status).toBe('STABLE');
    await wharfieProject.destroy();
    expect(wharfieProject.status).toBe('DESTROYED');
  }, 10000);

  it('normal project', async () => {
    expect.assertions(4);
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

    const wharfieProject = new WharfieProject({
      name: 'test-wharife-project',
      deployment,
      properties: {
        createdAt: 123456789,
      },
    });

    const project = await loadProject({
      path: path.join(__dirname, '../fixtures/project_fixture'),
    });
    const environment = {
      name: 'test-environment',
      variables: {},
    };

    const resourceOptions = getResourceOptions(environment, project);

    wharfieProject.registerWharfieResources(resourceOptions);

    await wharfieProject.reconcile();

    const serialized = wharfieProject.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-wharife-project",
        "parent": "",
        "properties": {
          "actorRoleArns": [
            "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
            "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
            "arn:aws:iam::123456789012:role/test-deployment-events-role",
            "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
          ],
          "createdAt": 123456789,
          "daemonQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
          "dependencyTable": "test-deployment-dependencies",
          "deployment": {
            "accountId": "",
            "envPaths": {
              "cache": "mock",
              "config": "mock",
              "data": "mock",
              "log": "mock",
              "temp": "mock",
            },
            "name": "test-deployment",
            "region": "us-west-2",
            "stateTable": "test-deployment-state",
            "version": "0.0.1",
          },
          "deploymentSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-shared-policy",
          "eventsQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
          "locationTable": "test-deployment-locations",
          "operationTable": "test-deployment-operations",
          "project": {
            "name": "test-wharife-project",
          },
          "scheduleQueueArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
          "scheduleRoleArn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
        },
        "resourceType": "WharfieProject",
        "resources": [
          "test-wharife-project",
          "test-wharife-project-bucket-lz-fc6bi",
          "test-wharife-project-project-role",
          "amazon_berkely_objects_aggregated-resource",
          "amazon_berkely_objects_join-resource",
          "inline-resource",
          "amazon_berkely_objects_images-resource",
          "amazon_berkely_objects-resource",
          "test-resource",
        ],
        "status": "STABLE",
      }
    `);
    expect(wharfieProject.status).toBe('STABLE');
    await wharfieProject.destroy();
    expect(wharfieProject.status).toBe('DESTROYED');

    expect(
      sqs.__getMockState().queues[
        'arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue'
      ].queue
    ).toHaveLength(6);
  }, 10000);
});
