/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
jest.mock('crypto');

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');
jest.mock('../../lambdas/lib/id');
jest.mock('../../lambdas/lib/dynamo/state');
jest.mock('../../lambdas/lib/dynamo/operations');
jest.mock('../../lambdas/lib/dynamo/dependency');
jest.mock('../../lambdas/lib/dynamo/location');

const crypto = require('crypto');

const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');
const Reconcilable = require('../../lambdas/lib/actor/resources/reconcilable');
const { load } = require('../../lambdas/lib/actor/deserialize/full');

describe('deployment IaC', () => {
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
    expect.assertions(9);
    const state_db = require('../../lambdas/lib/dynamo/state');

    const events = [];
    Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
      events.push(`${event.status} - ${event.constructor}:${event.name}`);
    });
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {
        createdAt: 123456789,
      },
    });
    expect(state_db.__getMockState()).toMatchInlineSnapshot(`{}`);
    events.push('RECONCILING');
    await deployment.reconcile();
    const reconcile_state = state_db.__getMockState();
    expect(reconcile_state).toMatchInlineSnapshot(`
      {
        "test-deployment": {
          "test-deployment": {
            "dependsOn": [],
            "name": "test-deployment",
            "parent": "",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": true,
              "accountId": "123456789012",
              "createdAt": 123456789,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "globalQueryConcurrency": 10,
              "loggingLevel": "info",
              "maxQueriesPerAction": 10000,
              "region": "us-west-2",
              "resourceQueryConcurrency": 10,
              "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
            },
            "resourceType": "WharfieDeployment",
            "resources": [
              "daemon",
              "cleanup",
              "events",
              "monitor",
              "test-deployment-deployment-resources",
              "test-deployment-state",
              "test-deployment-log-notification-bucket-notification-configuration",
            ],
            "status": "STABLE",
          },
          "test-deployment#cleanup": {
            "dependsOn": [],
            "name": "cleanup",
            "parent": "test-deployment",
            "properties": {
              "actorPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "artifactBucket": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SCHEDULER_TABLE": "test-deployment-scheduler",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
              },
              "handler": "<WHARFIE_BUILT_IN>/cleanup.handler",
            },
            "resourceType": "Cleanup",
            "resources": [
              "test-deployment-cleanup-build",
              "test-deployment-cleanup-function",
              "test-deployment-cleanup-queue",
              "test-deployment-cleanup-dlq",
              "test-deployment-cleanup-role",
              "cleanup-mapping",
            ],
            "status": "STABLE",
          },
          "test-deployment#cleanup#cleanup-mapping": {
            "dependsOn": [
              "test-deployment-cleanup-function",
              "test-deployment-cleanup-queue",
            ],
            "name": "cleanup-mapping",
            "parent": "test-deployment#cleanup",
            "properties": {
              "arn": "arn:aws:lambda:us-west-2:123456789012:event-source-mapping:ckywjpmr70002zjvd0wyq5x48",
              "batchSize": 1,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
              "functionName": "test-deployment-cleanup-function",
              "maximumBatchingWindowInSeconds": 0,
              "uuid": "ckywjpmr70002zjvd0wyq5x48",
            },
            "resourceType": "EventSourceMapping",
            "status": "STABLE",
          },
          "test-deployment#cleanup#test-deployment-cleanup-build": {
            "dependsOn": [],
            "name": "test-deployment-cleanup-build",
            "parent": "test-deployment#cleanup",
            "properties": {
              "artifactBucket": "test-deployment-bucket-111111",
              "artifactKey": "actor-artifacts/test-deployment-cleanup-build/mockedHash.zip",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "functionCodeHash": "mockedHash",
              "handler": "<WHARFIE_BUILT_IN>/cleanup.handler",
            },
            "resourceType": "LambdaBuild",
            "status": "STABLE",
          },
          "test-deployment#cleanup#test-deployment-cleanup-dlq": {
            "dependsOn": [],
            "name": "test-deployment-cleanup-dlq",
            "parent": "test-deployment#cleanup",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-dlq",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-cleanup-dlq",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#cleanup#test-deployment-cleanup-function": {
            "dependsOn": [
              "test-deployment-cleanup-role",
              "test-deployment-cleanup-dlq",
              "test-deployment-cleanup-queue",
              "test-deployment-cleanup-build",
            ],
            "name": "test-deployment-cleanup-function",
            "parent": "test-deployment#cleanup",
            "properties": {
              "architectures": [
                "arm64",
              ],
              "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-cleanup-function",
              "code": {
                "S3Bucket": "test-deployment-bucket-111111",
                "S3Key": "actor-artifacts/test-deployment-cleanup-build/mockedHash.zip",
              },
              "codeHash": "mockedHash",
              "deadLetterConfig": {
                "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-dlq",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "cleanup lambda",
              "environment": {
                "Variables": {
                  "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
                  "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                  "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                  "DEPENDENCY_TABLE": "test-deployment-dependencies",
                  "DLQ_URL": "test-deployment-cleanup-dlq",
                  "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                  "GLOBAL_QUERY_CONCURRENCY": "10",
                  "LOCATION_TABLE": "test-deployment-locations",
                  "LOGGING_LEVEL": "info",
                  "MAX_QUERIES_PER_ACTION": "10000",
                  "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                  "NODE_OPTIONS": "--enable-source-maps",
                  "OPERATIONS_TABLE": "test-deployment-operations",
                  "RESOURCE_QUERY_CONCURRENCY": "10",
                  "SCHEDULER_TABLE": "test-deployment-scheduler",
                  "SEMAPHORE_TABLE": "test-deployment-semaphore",
                  "STACK_NAME": "test-deployment",
                  "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                  "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                  "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
                },
              },
              "ephemeralStorage": {
                "Size": 512,
              },
              "handler": "index.handler",
              "memorySize": 1024,
              "packageType": "Zip",
              "publish": true,
              "role": "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
              "runtime": "nodejs22.x",
              "timeout": 300,
            },
            "resourceType": "LambdaFunction",
            "status": "STABLE",
          },
          "test-deployment#cleanup#test-deployment-cleanup-queue": {
            "dependsOn": [],
            "name": "test-deployment-cleanup-queue",
            "parent": "test-deployment#cleanup",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "policy": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "s3.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                    "Sid": "accept-s3-events",
                  },
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "events.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                    "Sid": "accept-cloudwatch-events",
                  },
                ],
                "Version": "2012-10-17",
              },
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-cleanup-queue",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#cleanup#test-deployment-cleanup-role": {
            "dependsOn": [
              "test-deployment-cleanup-queue",
              "test-deployment-cleanup-dlq",
            ],
            "name": "test-deployment-cleanup-role",
            "parent": "test-deployment#cleanup",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-cleanup-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "lambda.amazonaws.com",
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment actor cleanup role",
              "managedPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "roleName": "test-deployment-cleanup-role",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:DeleteMessage",
                      "sqs:ReceiveMessage",
                      "sqs:GetQueueAttributes",
                      "sqs:SendMessage",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-dlq",
                    ],
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#daemon": {
            "dependsOn": [],
            "name": "daemon",
            "parent": "test-deployment",
            "properties": {
              "actorPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "artifactBucket": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SCHEDULER_TABLE": "test-deployment-scheduler",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
              },
              "handler": "<WHARFIE_BUILT_IN>/daemon.handler",
            },
            "resourceType": "Daemon",
            "resources": [
              "test-deployment-daemon-build",
              "test-deployment-daemon-function",
              "test-deployment-daemon-queue",
              "test-deployment-daemon-dlq",
              "test-deployment-daemon-role",
              "daemon-mapping",
            ],
            "status": "STABLE",
          },
          "test-deployment#daemon#daemon-mapping": {
            "dependsOn": [
              "test-deployment-daemon-function",
              "test-deployment-daemon-queue",
            ],
            "name": "daemon-mapping",
            "parent": "test-deployment#daemon",
            "properties": {
              "arn": "arn:aws:lambda:us-west-2:123456789012:event-source-mapping:ckywjpmr70002zjvd0wyq5x48",
              "batchSize": 1,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
              "functionName": "test-deployment-daemon-function",
              "maximumBatchingWindowInSeconds": 0,
              "uuid": "ckywjpmr70002zjvd0wyq5x48",
            },
            "resourceType": "EventSourceMapping",
            "status": "STABLE",
          },
          "test-deployment#daemon#test-deployment-daemon-build": {
            "dependsOn": [],
            "name": "test-deployment-daemon-build",
            "parent": "test-deployment#daemon",
            "properties": {
              "artifactBucket": "test-deployment-bucket-111111",
              "artifactKey": "actor-artifacts/test-deployment-daemon-build/mockedHash.zip",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "functionCodeHash": "mockedHash",
              "handler": "<WHARFIE_BUILT_IN>/daemon.handler",
            },
            "resourceType": "LambdaBuild",
            "status": "STABLE",
          },
          "test-deployment#daemon#test-deployment-daemon-dlq": {
            "dependsOn": [],
            "name": "test-deployment-daemon-dlq",
            "parent": "test-deployment#daemon",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-dlq",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-daemon-dlq",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#daemon#test-deployment-daemon-function": {
            "dependsOn": [
              "test-deployment-daemon-role",
              "test-deployment-daemon-dlq",
              "test-deployment-daemon-queue",
              "test-deployment-daemon-build",
            ],
            "name": "test-deployment-daemon-function",
            "parent": "test-deployment#daemon",
            "properties": {
              "architectures": [
                "arm64",
              ],
              "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-daemon-function",
              "code": {
                "S3Bucket": "test-deployment-bucket-111111",
                "S3Key": "actor-artifacts/test-deployment-daemon-build/mockedHash.zip",
              },
              "codeHash": "mockedHash",
              "deadLetterConfig": {
                "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-dlq",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "daemon lambda",
              "environment": {
                "Variables": {
                  "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
                  "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                  "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                  "DEPENDENCY_TABLE": "test-deployment-dependencies",
                  "DLQ_URL": "test-deployment-daemon-dlq",
                  "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                  "GLOBAL_QUERY_CONCURRENCY": "10",
                  "LOCATION_TABLE": "test-deployment-locations",
                  "LOGGING_LEVEL": "info",
                  "MAX_QUERIES_PER_ACTION": "10000",
                  "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                  "NODE_OPTIONS": "--enable-source-maps",
                  "OPERATIONS_TABLE": "test-deployment-operations",
                  "RESOURCE_QUERY_CONCURRENCY": "10",
                  "SCHEDULER_TABLE": "test-deployment-scheduler",
                  "SEMAPHORE_TABLE": "test-deployment-semaphore",
                  "STACK_NAME": "test-deployment",
                  "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                  "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                  "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
                },
              },
              "ephemeralStorage": {
                "Size": 512,
              },
              "handler": "index.handler",
              "memorySize": 1024,
              "packageType": "Zip",
              "publish": true,
              "role": "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
              "runtime": "nodejs22.x",
              "timeout": 300,
            },
            "resourceType": "LambdaFunction",
            "status": "STABLE",
          },
          "test-deployment#daemon#test-deployment-daemon-queue": {
            "dependsOn": [],
            "name": "test-deployment-daemon-queue",
            "parent": "test-deployment#daemon",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "policy": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "s3.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                    "Sid": "accept-s3-events",
                  },
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "events.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                    "Sid": "accept-cloudwatch-events",
                  },
                ],
                "Version": "2012-10-17",
              },
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-daemon-queue",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#daemon#test-deployment-daemon-role": {
            "dependsOn": [
              "test-deployment-daemon-queue",
              "test-deployment-daemon-dlq",
            ],
            "name": "test-deployment-daemon-role",
            "parent": "test-deployment#daemon",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-daemon-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "lambda.amazonaws.com",
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment actor daemon role",
              "managedPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "roleName": "test-deployment-daemon-role",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:DeleteMessage",
                      "sqs:ReceiveMessage",
                      "sqs:GetQueueAttributes",
                      "sqs:SendMessage",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-dlq",
                    ],
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#events": {
            "dependsOn": [],
            "name": "events",
            "parent": "test-deployment",
            "properties": {
              "actorPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "artifactBucket": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SCHEDULER_TABLE": "test-deployment-scheduler",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
              },
              "handler": "<WHARFIE_BUILT_IN>/events.handler",
            },
            "resourceType": "Events",
            "resources": [
              "test-deployment-events-build",
              "test-deployment-events-function",
              "test-deployment-events-queue",
              "test-deployment-events-dlq",
              "test-deployment-events-role",
              "events-mapping",
            ],
            "status": "STABLE",
          },
          "test-deployment#events#events-mapping": {
            "dependsOn": [
              "test-deployment-events-function",
              "test-deployment-events-queue",
            ],
            "name": "events-mapping",
            "parent": "test-deployment#events",
            "properties": {
              "arn": "arn:aws:lambda:us-west-2:123456789012:event-source-mapping:ckywjpmr70002zjvd0wyq5x48",
              "batchSize": 1,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
              "functionName": "test-deployment-events-function",
              "maximumBatchingWindowInSeconds": 0,
              "uuid": "ckywjpmr70002zjvd0wyq5x48",
            },
            "resourceType": "EventSourceMapping",
            "status": "STABLE",
          },
          "test-deployment#events#test-deployment-events-build": {
            "dependsOn": [],
            "name": "test-deployment-events-build",
            "parent": "test-deployment#events",
            "properties": {
              "artifactBucket": "test-deployment-bucket-111111",
              "artifactKey": "actor-artifacts/test-deployment-events-build/mockedHash.zip",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "functionCodeHash": "mockedHash",
              "handler": "<WHARFIE_BUILT_IN>/events.handler",
            },
            "resourceType": "LambdaBuild",
            "status": "STABLE",
          },
          "test-deployment#events#test-deployment-events-dlq": {
            "dependsOn": [],
            "name": "test-deployment-events-dlq",
            "parent": "test-deployment#events",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-dlq",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-events-dlq",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#events#test-deployment-events-function": {
            "dependsOn": [
              "test-deployment-events-role",
              "test-deployment-events-dlq",
              "test-deployment-events-queue",
              "test-deployment-events-build",
            ],
            "name": "test-deployment-events-function",
            "parent": "test-deployment#events",
            "properties": {
              "architectures": [
                "arm64",
              ],
              "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-events-function",
              "code": {
                "S3Bucket": "test-deployment-bucket-111111",
                "S3Key": "actor-artifacts/test-deployment-events-build/mockedHash.zip",
              },
              "codeHash": "mockedHash",
              "deadLetterConfig": {
                "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-dlq",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "events lambda",
              "environment": {
                "Variables": {
                  "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
                  "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                  "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                  "DEPENDENCY_TABLE": "test-deployment-dependencies",
                  "DLQ_URL": "test-deployment-events-dlq",
                  "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                  "GLOBAL_QUERY_CONCURRENCY": "10",
                  "LOCATION_TABLE": "test-deployment-locations",
                  "LOGGING_LEVEL": "info",
                  "MAX_QUERIES_PER_ACTION": "10000",
                  "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                  "NODE_OPTIONS": "--enable-source-maps",
                  "OPERATIONS_TABLE": "test-deployment-operations",
                  "RESOURCE_QUERY_CONCURRENCY": "10",
                  "SCHEDULER_TABLE": "test-deployment-scheduler",
                  "SEMAPHORE_TABLE": "test-deployment-semaphore",
                  "STACK_NAME": "test-deployment",
                  "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                  "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                  "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
                },
              },
              "ephemeralStorage": {
                "Size": 512,
              },
              "handler": "index.handler",
              "memorySize": 1024,
              "packageType": "Zip",
              "publish": true,
              "role": "arn:aws:iam::123456789012:role/test-deployment-events-role",
              "runtime": "nodejs22.x",
              "timeout": 300,
            },
            "resourceType": "LambdaFunction",
            "status": "STABLE",
          },
          "test-deployment#events#test-deployment-events-queue": {
            "dependsOn": [],
            "name": "test-deployment-events-queue",
            "parent": "test-deployment#events",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "policy": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "s3.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                    "Sid": "accept-s3-events",
                  },
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "events.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                    "Sid": "accept-cloudwatch-events",
                  },
                ],
                "Version": "2012-10-17",
              },
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-events-queue",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#events#test-deployment-events-role": {
            "dependsOn": [
              "test-deployment-events-queue",
              "test-deployment-events-dlq",
            ],
            "name": "test-deployment-events-role",
            "parent": "test-deployment#events",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-events-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "lambda.amazonaws.com",
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment actor events role",
              "managedPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "roleName": "test-deployment-events-role",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:DeleteMessage",
                      "sqs:ReceiveMessage",
                      "sqs:GetQueueAttributes",
                      "sqs:SendMessage",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-dlq",
                    ],
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#monitor": {
            "dependsOn": [],
            "name": "monitor",
            "parent": "test-deployment",
            "properties": {
              "actorPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "artifactBucket": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SCHEDULER_TABLE": "test-deployment-scheduler",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
              },
              "handler": "<WHARFIE_BUILT_IN>/monitor.handler",
            },
            "resourceType": "Monitor",
            "resources": [
              "test-deployment-monitor-build",
              "test-deployment-monitor-function",
              "test-deployment-monitor-queue",
              "test-deployment-monitor-dlq",
              "test-deployment-monitor-role",
              "monitor-mapping",
              "monitor-athena-events-rule",
            ],
            "status": "STABLE",
          },
          "test-deployment#monitor#monitor-athena-events-rule": {
            "dependsOn": [
              "test-deployment-monitor-queue",
            ],
            "name": "monitor-athena-events-rule",
            "parent": "test-deployment#monitor",
            "properties": {
              "arn": "arn:aws:events:us-east-1:123456789012:rule/monitor-athena-events-rule",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "monitor athena events rule",
              "eventPattern": "{"source":["aws.athena"],"detail-type":["Athena Query State Change"]}",
              "state": "ENABLED",
              "targets": [
                {
                  "Arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                  "DeadLetterConfig": {
                    "Arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
                  },
                  "Id": "monitor-athena-events-rule-target",
                },
              ],
            },
            "resourceType": "EventsRule",
            "status": "STABLE",
          },
          "test-deployment#monitor#monitor-mapping": {
            "dependsOn": [
              "test-deployment-monitor-function",
              "test-deployment-monitor-queue",
            ],
            "name": "monitor-mapping",
            "parent": "test-deployment#monitor",
            "properties": {
              "arn": "arn:aws:lambda:us-west-2:123456789012:event-source-mapping:ckywjpmr70002zjvd0wyq5x48",
              "batchSize": 1,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
              "functionName": "test-deployment-monitor-function",
              "maximumBatchingWindowInSeconds": 0,
              "uuid": "ckywjpmr70002zjvd0wyq5x48",
            },
            "resourceType": "EventSourceMapping",
            "status": "STABLE",
          },
          "test-deployment#monitor#test-deployment-monitor-build": {
            "dependsOn": [],
            "name": "test-deployment-monitor-build",
            "parent": "test-deployment#monitor",
            "properties": {
              "artifactBucket": "test-deployment-bucket-111111",
              "artifactKey": "actor-artifacts/test-deployment-monitor-build/mockedHash.zip",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "functionCodeHash": "mockedHash",
              "handler": "<WHARFIE_BUILT_IN>/monitor.handler",
            },
            "resourceType": "LambdaBuild",
            "status": "STABLE",
          },
          "test-deployment#monitor#test-deployment-monitor-dlq": {
            "dependsOn": [],
            "name": "test-deployment-monitor-dlq",
            "parent": "test-deployment#monitor",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-monitor-dlq",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#monitor#test-deployment-monitor-function": {
            "dependsOn": [
              "test-deployment-monitor-role",
              "test-deployment-monitor-dlq",
              "test-deployment-monitor-queue",
              "test-deployment-monitor-build",
            ],
            "name": "test-deployment-monitor-function",
            "parent": "test-deployment#monitor",
            "properties": {
              "architectures": [
                "arm64",
              ],
              "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-monitor-function",
              "code": {
                "S3Bucket": "test-deployment-bucket-111111",
                "S3Key": "actor-artifacts/test-deployment-monitor-build/mockedHash.zip",
              },
              "codeHash": "mockedHash",
              "deadLetterConfig": {
                "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "monitor lambda",
              "environment": {
                "Variables": {
                  "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
                  "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                  "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                  "DEPENDENCY_TABLE": "test-deployment-dependencies",
                  "DLQ_URL": "test-deployment-monitor-dlq",
                  "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                  "GLOBAL_QUERY_CONCURRENCY": "10",
                  "LOCATION_TABLE": "test-deployment-locations",
                  "LOGGING_LEVEL": "info",
                  "MAX_QUERIES_PER_ACTION": "10000",
                  "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                  "NODE_OPTIONS": "--enable-source-maps",
                  "OPERATIONS_TABLE": "test-deployment-operations",
                  "RESOURCE_QUERY_CONCURRENCY": "10",
                  "SCHEDULER_TABLE": "test-deployment-scheduler",
                  "SEMAPHORE_TABLE": "test-deployment-semaphore",
                  "STACK_NAME": "test-deployment",
                  "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                  "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                  "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket-111111",
                },
              },
              "ephemeralStorage": {
                "Size": 512,
              },
              "handler": "index.handler",
              "memorySize": 1024,
              "packageType": "Zip",
              "publish": true,
              "role": "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
              "runtime": "nodejs22.x",
              "timeout": 300,
            },
            "resourceType": "LambdaFunction",
            "status": "STABLE",
          },
          "test-deployment#monitor#test-deployment-monitor-queue": {
            "dependsOn": [],
            "name": "test-deployment-monitor-queue",
            "parent": "test-deployment#monitor",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "messageRetentionPeriod": "1209600",
              "policy": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "s3.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                    "Sid": "accept-s3-events",
                  },
                  {
                    "Action": [
                      "sqs:SendMessage",
                    ],
                    "Condition": {
                      "StringEquals": {
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "events.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                    "Sid": "accept-cloudwatch-events",
                  },
                ],
                "Version": "2012-10-17",
              },
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-monitor-queue",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment#monitor#test-deployment-monitor-role": {
            "dependsOn": [
              "test-deployment-monitor-queue",
              "test-deployment-monitor-dlq",
            ],
            "name": "test-deployment-monitor-role",
            "parent": "test-deployment#monitor",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-monitor-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "lambda.amazonaws.com",
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment actor monitor role",
              "managedPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
                "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              ],
              "roleName": "test-deployment-monitor-role",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "sqs:DeleteMessage",
                      "sqs:ReceiveMessage",
                      "sqs:GetQueueAttributes",
                      "sqs:SendMessage",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
                    ],
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources": {
            "dependsOn": [
              "test-deployment-state",
            ],
            "name": "test-deployment-deployment-resources",
            "parent": "test-deployment",
            "properties": {
              "createdAt": 123456789,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "loggingLevel": "info",
            },
            "resourceType": "WharfieDeploymentResources",
            "resources": [
              "test-deployment-bucket",
              "test-deployment-operations",
              "test-deployment-locations",
              "test-deployment-semaphore",
              "test-deployment-scheduler",
              "test-deployment-dependencies",
              "test-deployment-firehose-role",
              "test-deployment-firehose",
              "test-deployment-shared-policy",
              "test-deployment-event-role",
              "test-deployment-temporary-database",
              "test-deployment-actor-policy",
              "test-deployment-infra-policy",
              "test-deployment-glue-database",
              "test-deployment-deployment-resources-log-resource",
              "test-deployment-deployment-resources-logging-resource-role",
            ],
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-actor-policy": {
            "dependsOn": [
              "test-deployment-operations",
              "test-deployment-locations",
              "test-deployment-semaphore",
              "test-deployment-scheduler",
              "test-deployment-dependencies",
            ],
            "name": "test-deployment-actor-policy",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:iam::123456789012:policy/test-deployment-actor-policy",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment actor test-deployment policy",
              "document": {
                "Statement": [
                  {
                    "Action": [
                      "athena:GetQueryExecution",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                  },
                  {
                    "Action": [
                      "cloudwatch:PutMetricData",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                  },
                  {
                    "Action": [
                      "sqs:DeleteMessage",
                      "sqs:ReceiveMessage",
                      "sqs:GetQueueAttributes",
                      "sqs:SendMessage",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                  },
                  {
                    "Action": [
                      "firehose:PutRecordBatch",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-deployment-firehose",
                    ],
                  },
                  {
                    "Action": [
                      "dynamodb:PutItem",
                      "dynamodb:Query",
                      "dynamodb:BatchWriteItem",
                      "dynamodb:UpdateItem",
                      "dynamodb:GetItem",
                      "dynamodb:DeleteItem",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-operations",
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-locations",
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-scheduler",
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-semaphore",
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-dependencies",
                    ],
                  },
                  {
                    "Action": [
                      "s3:PutObject",
                      "s3:PutObjectAcl",
                      "s3:GetObject",
                      "s3:ListMultipartUploadParts",
                      "s3:AbortMultipartUpload",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::test-deployment-bucket-111111/*",
                    ],
                  },
                  {
                    "Action": [
                      "s3:GetBucketLocation",
                      "s3:ListBucket",
                      "s3:ListBucketMultipartUploads",
                      "s3:AbortMultipartUpload",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::test-deployment-bucket-111111",
                    ],
                  },
                  {
                    "Action": [
                      "sqs:DeleteMessage",
                      "sqs:ReceiveMessage",
                      "sqs:GetQueueAttributes",
                      "sqs:SendMessage",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "*",
                    ],
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Policy",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-bucket": {
            "dependsOn": [],
            "name": "test-deployment-bucket",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:s3:::test-deployment-bucket-111111",
              "bucketName": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "lifecycleConfiguration": {
                "Rules": [
                  {
                    "Expiration": {
                      "Days": 1,
                    },
                    "ID": "log_files_expiration",
                    "Prefix": "/logs/raw/",
                    "Status": "Enabled",
                  },
                  {
                    "AbortIncompleteMultipartUpload": {
                      "DaysAfterInitiation": 1,
                    },
                    "ID": "abort_incomplete_multipart_uploads",
                    "Prefix": "",
                    "Status": "Enabled",
                  },
                ],
              },
            },
            "resourceType": "Bucket",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-dependencies": {
            "dependsOn": [],
            "name": "test-deployment-dependencies",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-dependencies",
              "attributeDefinitions": [
                {
                  "AttributeName": "dependency",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "resource_id",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "dependency",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "resource_id",
                  "KeyType": "RANGE",
                },
              ],
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource": {
            "dependsOn": [
              "test-deployment-glue-database",
              "test-deployment-deployment-resources-logging-resource-role",
              "test-deployment-operations",
              "test-deployment-locations",
              "test-deployment-dependencies",
              "test-deployment-bucket",
            ],
            "name": "test-deployment-deployment-resources-log-resource",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "catalogId": "123456789012",
              "columns": [
                {
                  "name": "action_id",
                  "type": "string",
                },
                {
                  "name": "action_type",
                  "type": "string",
                },
                {
                  "name": "level",
                  "type": "string",
                },
                {
                  "name": "message",
                  "type": "string",
                },
                {
                  "name": "operation_id",
                  "type": "string",
                },
                {
                  "name": "operation_type",
                  "type": "string",
                },
                {
                  "name": "request_id",
                  "type": "string",
                },
                {
                  "name": "resource_id",
                  "type": "string",
                },
                {
                  "name": "service",
                  "type": "string",
                },
                {
                  "name": "wharfie_version",
                  "type": "string",
                },
                {
                  "name": "pid",
                  "type": "string",
                },
                {
                  "name": "hostname",
                  "type": "string",
                },
                {
                  "name": "timestamp",
                  "type": "string",
                },
                {
                  "name": "log_type",
                  "type": "string",
                },
              ],
              "compressed": false,
              "createdAt": 123456789,
              "daemonQueueUrl": "https://sqs.us-west-2.amazonaws.com/123456789012/test-deployment-daemon-queue",
              "databaseName": "test-deployment",
              "dependencyTable": "test-deployment-dependencies",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment-deployment-resources wharfie logs",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "inputLocation": "s3://test-deployment-bucket-111111/logs/raw/",
              "interval": 300,
              "locationTable": "test-deployment-locations",
              "migrationResource": false,
              "numberOfBuckets": 0,
              "operationTable": "test-deployment-operations",
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "outputLocation": "s3://test-deployment-bucket-111111/logs/processed/",
              "parameters": {
                "EXTERNAL": "true",
              },
              "partitionKeys": [
                {
                  "name": "year",
                  "type": "string",
                },
                {
                  "name": "month",
                  "type": "string",
                },
                {
                  "name": "day",
                  "type": "string",
                },
                {
                  "name": "hr",
                  "type": "string",
                },
              ],
              "projectBucket": "test-deployment-bucket-111111",
              "projectName": "test-deployment",
              "region": "us-west-2",
              "resourceId": "test-deployment.logs",
              "resourceKey": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
              "resourceName": "logs",
              "roleArn": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
              "scheduleQueueArn": "arn:aws:sqs:us-west-2:123456789012:test-deployment-events-queue",
              "scheduleQueueUrl": "https://sqs.us-west-2.amazonaws.com/123456789012/test-deployment-events-queue",
              "serdeInfo": {
                "Parameters": {
                  "ignore.malformed.json": "true",
                },
                "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
              },
              "storedAsSubDirectories": false,
              "tableType": "EXTERNAL_TABLE",
              "tags": [],
              "version": 0,
            },
            "resourceType": "WharfieResource",
            "resources": [
              "wharfie-test-deployment-logs-workgroup",
              "logs_raw",
              "logs",
              "test-deployment-logs-resource-record",
              "test-deployment-logs-location-record",
            ],
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource#logs": {
            "dependsOn": [],
            "name": "logs",
            "parent": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
            "properties": {
              "arn": "arn:aws:glue:us-west-2:123456789012:table/test-deployment/logs",
              "catalogId": "123456789012",
              "columns": [
                {
                  "name": "action_id",
                  "type": "string",
                },
                {
                  "name": "action_type",
                  "type": "string",
                },
                {
                  "name": "level",
                  "type": "string",
                },
                {
                  "name": "message",
                  "type": "string",
                },
                {
                  "name": "operation_id",
                  "type": "string",
                },
                {
                  "name": "operation_type",
                  "type": "string",
                },
                {
                  "name": "request_id",
                  "type": "string",
                },
                {
                  "name": "resource_id",
                  "type": "string",
                },
                {
                  "name": "service",
                  "type": "string",
                },
                {
                  "name": "wharfie_version",
                  "type": "string",
                },
                {
                  "name": "pid",
                  "type": "string",
                },
                {
                  "name": "hostname",
                  "type": "string",
                },
                {
                  "name": "timestamp",
                  "type": "string",
                },
                {
                  "name": "log_type",
                  "type": "string",
                },
              ],
              "compressed": true,
              "databaseName": "test-deployment",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment-deployment-resources wharfie logs",
              "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
              "location": "s3://test-deployment-bucket-111111/logs/processed/references/",
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
              "parameters": {
                "EXTERNAL": "TRUE",
                "parquet.compress": "GZIP",
              },
              "partitionKeys": [
                {
                  "name": "year",
                  "type": "string",
                },
                {
                  "name": "month",
                  "type": "string",
                },
                {
                  "name": "day",
                  "type": "string",
                },
                {
                  "name": "hr",
                  "type": "string",
                },
              ],
              "region": "us-west-2",
              "serdeInfo": {
                "Parameters": {
                  "parquet.compress": "GZIP",
                },
                "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
              },
              "storedAsSubDirectories": false,
              "tableType": "EXTERNAL_TABLE",
              "tags": [],
            },
            "resourceType": "GlueTable",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource#logs_raw": {
            "dependsOn": [],
            "name": "logs_raw",
            "parent": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
            "properties": {
              "arn": "arn:aws:glue:us-west-2:123456789012:table/test-deployment/logs_raw",
              "catalogId": "123456789012",
              "columns": [
                {
                  "name": "action_id",
                  "type": "string",
                },
                {
                  "name": "action_type",
                  "type": "string",
                },
                {
                  "name": "level",
                  "type": "string",
                },
                {
                  "name": "message",
                  "type": "string",
                },
                {
                  "name": "operation_id",
                  "type": "string",
                },
                {
                  "name": "operation_type",
                  "type": "string",
                },
                {
                  "name": "request_id",
                  "type": "string",
                },
                {
                  "name": "resource_id",
                  "type": "string",
                },
                {
                  "name": "service",
                  "type": "string",
                },
                {
                  "name": "wharfie_version",
                  "type": "string",
                },
                {
                  "name": "pid",
                  "type": "string",
                },
                {
                  "name": "hostname",
                  "type": "string",
                },
                {
                  "name": "timestamp",
                  "type": "string",
                },
                {
                  "name": "log_type",
                  "type": "string",
                },
              ],
              "compressed": false,
              "databaseName": "test-deployment",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment-deployment-resources wharfie logs",
              "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
              "location": "s3://test-deployment-bucket-111111/logs/raw/",
              "numberOfBuckets": 0,
              "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "parameters": {
                "EXTERNAL": "true",
              },
              "partitionKeys": [
                {
                  "name": "year",
                  "type": "string",
                },
                {
                  "name": "month",
                  "type": "string",
                },
                {
                  "name": "day",
                  "type": "string",
                },
                {
                  "name": "hr",
                  "type": "string",
                },
              ],
              "region": "us-west-2",
              "serdeInfo": {
                "Parameters": {
                  "ignore.malformed.json": "true",
                },
                "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
              },
              "storedAsSubDirectories": false,
              "tableType": "EXTERNAL_TABLE",
              "tags": [],
            },
            "resourceType": "GlueTable",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource#test-deployment-logs-location-record": {
            "dependsOn": [],
            "name": "test-deployment-logs-location-record",
            "parent": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
            "properties": {
              "data": {
                "interval": 300,
                "location": "s3://test-deployment-bucket-111111/logs/raw/",
                "resource_id": "test-deployment.logs",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "table_name": "test-deployment-locations",
            },
            "resourceType": "LocationRecord",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource#test-deployment-logs-resource-record": {
            "dependsOn": [
              "logs_raw",
              "logs",
              "wharfie-test-deployment-logs-workgroup",
            ],
            "name": "test-deployment-logs-resource-record",
            "parent": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
            "properties": {
              "data": {
                "data": {
                  "athena_workgroup": "wharfie-test-deployment-logs-workgroup",
                  "created_at": 123456789,
                  "daemon_config": {
                    "Role": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
                  },
                  "destination_properties": {
                    "arn": "arn:aws:glue:us-west-2:123456789012:table/test-deployment/logs",
                    "catalogId": "123456789012",
                    "columns": [
                      {
                        "name": "action_id",
                        "type": "string",
                      },
                      {
                        "name": "action_type",
                        "type": "string",
                      },
                      {
                        "name": "level",
                        "type": "string",
                      },
                      {
                        "name": "message",
                        "type": "string",
                      },
                      {
                        "name": "operation_id",
                        "type": "string",
                      },
                      {
                        "name": "operation_type",
                        "type": "string",
                      },
                      {
                        "name": "request_id",
                        "type": "string",
                      },
                      {
                        "name": "resource_id",
                        "type": "string",
                      },
                      {
                        "name": "service",
                        "type": "string",
                      },
                      {
                        "name": "wharfie_version",
                        "type": "string",
                      },
                      {
                        "name": "pid",
                        "type": "string",
                      },
                      {
                        "name": "hostname",
                        "type": "string",
                      },
                      {
                        "name": "timestamp",
                        "type": "string",
                      },
                      {
                        "name": "log_type",
                        "type": "string",
                      },
                    ],
                    "compressed": true,
                    "databaseName": "test-deployment",
                    "deployment": {
                      "accountId": "123456789012",
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
                      "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                      "version": "0.0.1",
                    },
                    "description": "test-deployment-deployment-resources wharfie logs",
                    "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                    "location": "s3://test-deployment-bucket-111111/logs/processed/references/",
                    "name": "logs",
                    "numberOfBuckets": 0,
                    "outputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                    "parameters": {
                      "EXTERNAL": "TRUE",
                      "parquet.compress": "GZIP",
                    },
                    "partitionKeys": [
                      {
                        "name": "year",
                        "type": "string",
                      },
                      {
                        "name": "month",
                        "type": "string",
                      },
                      {
                        "name": "day",
                        "type": "string",
                      },
                      {
                        "name": "hr",
                        "type": "string",
                      },
                    ],
                    "region": "us-west-2",
                    "serdeInfo": {
                      "Parameters": {
                        "parquet.compress": "GZIP",
                      },
                      "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                    },
                    "storedAsSubDirectories": false,
                    "tableType": "EXTERNAL_TABLE",
                    "tags": [],
                  },
                  "id": "test-deployment.logs",
                  "last_updated_at": 123456789,
                  "record_type": "RESOURCE",
                  "region": "us-west-2",
                  "resource_properties": {
                    "catalogId": "123456789012",
                    "columns": [
                      {
                        "name": "action_id",
                        "type": "string",
                      },
                      {
                        "name": "action_type",
                        "type": "string",
                      },
                      {
                        "name": "level",
                        "type": "string",
                      },
                      {
                        "name": "message",
                        "type": "string",
                      },
                      {
                        "name": "operation_id",
                        "type": "string",
                      },
                      {
                        "name": "operation_type",
                        "type": "string",
                      },
                      {
                        "name": "request_id",
                        "type": "string",
                      },
                      {
                        "name": "resource_id",
                        "type": "string",
                      },
                      {
                        "name": "service",
                        "type": "string",
                      },
                      {
                        "name": "wharfie_version",
                        "type": "string",
                      },
                      {
                        "name": "pid",
                        "type": "string",
                      },
                      {
                        "name": "hostname",
                        "type": "string",
                      },
                      {
                        "name": "timestamp",
                        "type": "string",
                      },
                      {
                        "name": "log_type",
                        "type": "string",
                      },
                    ],
                    "compressed": false,
                    "createdAt": 123456789,
                    "daemonQueueUrl": "https://sqs.us-west-2.amazonaws.com/123456789012/test-deployment-daemon-queue",
                    "databaseName": "test-deployment",
                    "dependencyTable": "test-deployment-dependencies",
                    "deployment": {
                      "accountId": "123456789012",
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
                      "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                      "version": "0.0.1",
                    },
                    "description": "test-deployment-deployment-resources wharfie logs",
                    "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "inputLocation": "s3://test-deployment-bucket-111111/logs/raw/",
                    "interval": 300,
                    "locationTable": "test-deployment-locations",
                    "migrationResource": false,
                    "numberOfBuckets": 0,
                    "operationTable": "test-deployment-operations",
                    "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "outputLocation": "s3://test-deployment-bucket-111111/logs/processed/",
                    "parameters": {
                      "EXTERNAL": "true",
                    },
                    "partitionKeys": [
                      {
                        "name": "year",
                        "type": "string",
                      },
                      {
                        "name": "month",
                        "type": "string",
                      },
                      {
                        "name": "day",
                        "type": "string",
                      },
                      {
                        "name": "hr",
                        "type": "string",
                      },
                    ],
                    "projectBucket": "test-deployment-bucket-111111",
                    "projectName": "test-deployment",
                    "region": "us-west-2",
                    "resourceId": "test-deployment.logs",
                    "resourceKey": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
                    "resourceName": "logs",
                    "roleArn": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
                    "scheduleQueueArn": "arn:aws:sqs:us-west-2:123456789012:test-deployment-events-queue",
                    "scheduleQueueUrl": "https://sqs.us-west-2.amazonaws.com/123456789012/test-deployment-events-queue",
                    "serdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "storedAsSubDirectories": false,
                    "tableType": "EXTERNAL_TABLE",
                    "tags": [],
                    "version": 0,
                  },
                  "source_properties": {
                    "arn": "arn:aws:glue:us-west-2:123456789012:table/test-deployment/logs_raw",
                    "catalogId": "123456789012",
                    "columns": [
                      {
                        "name": "action_id",
                        "type": "string",
                      },
                      {
                        "name": "action_type",
                        "type": "string",
                      },
                      {
                        "name": "level",
                        "type": "string",
                      },
                      {
                        "name": "message",
                        "type": "string",
                      },
                      {
                        "name": "operation_id",
                        "type": "string",
                      },
                      {
                        "name": "operation_type",
                        "type": "string",
                      },
                      {
                        "name": "request_id",
                        "type": "string",
                      },
                      {
                        "name": "resource_id",
                        "type": "string",
                      },
                      {
                        "name": "service",
                        "type": "string",
                      },
                      {
                        "name": "wharfie_version",
                        "type": "string",
                      },
                      {
                        "name": "pid",
                        "type": "string",
                      },
                      {
                        "name": "hostname",
                        "type": "string",
                      },
                      {
                        "name": "timestamp",
                        "type": "string",
                      },
                      {
                        "name": "log_type",
                        "type": "string",
                      },
                    ],
                    "compressed": false,
                    "databaseName": "test-deployment",
                    "deployment": {
                      "accountId": "123456789012",
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
                      "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                      "version": "0.0.1",
                    },
                    "description": "test-deployment-deployment-resources wharfie logs",
                    "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                    "location": "s3://test-deployment-bucket-111111/logs/raw/",
                    "name": "logs_raw",
                    "numberOfBuckets": 0,
                    "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                    "parameters": {
                      "EXTERNAL": "true",
                    },
                    "partitionKeys": [
                      {
                        "name": "year",
                        "type": "string",
                      },
                      {
                        "name": "month",
                        "type": "string",
                      },
                      {
                        "name": "day",
                        "type": "string",
                      },
                      {
                        "name": "hr",
                        "type": "string",
                      },
                    ],
                    "region": "us-west-2",
                    "serdeInfo": {
                      "Parameters": {
                        "ignore.malformed.json": "true",
                      },
                      "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                    },
                    "storedAsSubDirectories": false,
                    "tableType": "EXTERNAL_TABLE",
                    "tags": [],
                  },
                  "source_region": undefined,
                  "status": "ACTIVE",
                  "version": 0,
                  "wharfie_version": "0.0.1",
                },
                "resource_id": "test-deployment.logs",
                "sort_key": "test-deployment.logs",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "table_name": "test-deployment-operations",
            },
            "resourceType": "WharfieResourceRecord",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource#wharfie-test-deployment-logs-workgroup": {
            "dependsOn": [],
            "name": "wharfie-test-deployment-logs-workgroup",
            "parent": "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-log-resource",
            "properties": {
              "arn": "arn:aws:athena:us-west-2:123456789012:workgroup/wharfie-test-deployment-logs-workgroup",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment resource logs workgroup",
              "outputLocation": "s3://test-deployment-bucket-111111/logs/processed/query_metadata/",
            },
            "resourceType": "AthenaWorkGroup",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-deployment-resources-logging-resource-role": {
            "dependsOn": [
              "test-deployment-shared-policy",
            ],
            "name": "test-deployment-deployment-resources-logging-resource-role",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "AWS": "*",
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment-deployment-resources logging resource role",
              "managedPolicyArns": [
                "arn:aws:iam::123456789012:policy/test-deployment-shared-policy",
              ],
              "roleName": "test-deployment-deployment-resources-logging-resource-role",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "s3:GetBucketLocation",
                      "s3:GetBucketAcl",
                      "s3:ListBucket",
                      "s3:ListBucketMultipartUploads",
                      "s3:AbortMultipartUpload",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::test-deployment-bucket-111111",
                    ],
                    "Sid": "Bucket",
                  },
                  {
                    "Action": [
                      "s3:*",
                    ],
                    "Effect": "Allow",
                    "Resource": "arn:aws:s3:::test-deployment-bucket-111111/logs/processed/*",
                    "Sid": "OutputWrite",
                  },
                  {
                    "Action": [
                      "s3:GetObject",
                    ],
                    "Effect": "Allow",
                    "Resource": "arn:aws:s3:::test-deployment-bucket-111111/logs/raw/*",
                    "Sid": "InputRead",
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-event-role": {
            "dependsOn": [],
            "name": "test-deployment-event-role",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-event-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": [
                        "events.amazonaws.com",
                        "sqs.amazonaws.com",
                      ],
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment event role",
              "roleName": "test-deployment-event-role",
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-firehose": {
            "dependsOn": [
              "test-deployment-firehose-role",
              "test-deployment-bucket",
            ],
            "name": "test-deployment-firehose",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-deployment-firehose",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "s3DestinationConfiguration": {
                "BucketARN": "arn:aws:s3:::test-deployment-bucket-111111",
                "BufferingHints": {
                  "IntervalInSeconds": 60,
                  "SizeInMBs": 32,
                },
                "CompressionFormat": "GZIP",
                "Prefix": "logs/raw/",
                "RoleARN": "arn:aws:iam::123456789012:role/test-deployment-firehose-role",
              },
            },
            "resourceType": "Firehose",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-firehose-role": {
            "dependsOn": [
              "test-deployment-bucket",
            ],
            "name": "test-deployment-firehose-role",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-firehose-role",
              "assumeRolePolicyDocument": {
                "Statement": [
                  {
                    "Action": "sts:AssumeRole",
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "firehose.amazonaws.com",
                    },
                  },
                ],
                "Version": "2012-10-17",
              },
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment firehose role",
              "roleName": "test-deployment-firehose-role",
              "rolePolicyDocument": {
                "Statement": [
                  {
                    "Action": [
                      "s3:PutObject",
                      "s3:GetObject",
                    ],
                    "Effect": "Allow",
                    "Resource": "arn:aws:s3:::test-deployment-bucket-111111/logs/raw/*",
                  },
                  {
                    "Action": [
                      "s3:AbortMultipartUpload",
                      "s3:GetBucketLocation",
                      "s3:ListBucket",
                      "s3:ListBucketMultipartUploads",
                    ],
                    "Effect": "Allow",
                    "Resource": "arn:aws:s3:::test-deployment-bucket-111111",
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Role",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-glue-database": {
            "dependsOn": [],
            "name": "test-deployment-glue-database",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:glue:us-west-2:123456789012:database/test-deployment",
              "databaseName": "test-deployment",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
            },
            "resourceType": "GlueDatabase",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-infra-policy": {
            "dependsOn": [
              "test-deployment-operations",
              "test-deployment-locations",
              "test-deployment-dependencies",
            ],
            "name": "test-deployment-infra-policy",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:iam::123456789012:policy/test-deployment-infra-policy",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment infra test-deployment policy",
              "document": {
                "Statement": [
                  {
                    "Action": [
                      "athena:ListTagsForResource",
                      "athena:UntagResource",
                      "athena:TagResource",
                      "athena:GetWorkGroup",
                      "athena:UpdateWorkGroup",
                      "athena:CreateWorkGroup",
                      "athena:DeleteWorkGroup",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                    "Sid": "AthenaWorkgroupIAC",
                  },
                  {
                    "Action": [
                      "glue:CreateTable",
                      "glue:DeleteTable",
                      "glue:GetTable",
                      "glue:UpdateTable",
                      "glue:GetTags",
                      "glue:TagResource",
                      "glue:UntagResource",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                    "Sid": "GlueTableIAC",
                  },
                  {
                    "Action": [
                      "events:ListTargetsByRule",
                      "events:PutTargets",
                      "events:RemoveTargets",
                      "events:ListTagsForResource",
                      "events:UntagResource",
                      "events:TagResource",
                      "events:DescribeRule",
                      "events:EnableRule",
                      "events:DisableRule",
                      "events:PutRule",
                      "events:DeleteRule",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                    "Sid": "EventsRuleIAC",
                  },
                  {
                    "Action": [
                      "dynamodb:PutItem",
                      "dynamodb:DeleteItem",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-operations",
                    ],
                    "Sid": "WharfieResourceRecordIAC",
                  },
                  {
                    "Action": [
                      "s3:GetBucketLocation",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                    "Sid": "WharfieResourceRecordS3GetBucketLocation",
                  },
                  {
                    "Action": [
                      "dynamodb:PutItem",
                      "dynamodb:DeleteItem",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-locations",
                    ],
                    "Sid": "LocationRecordIAC",
                  },
                  {
                    "Action": [
                      "dynamodb:PutItem",
                      "dynamodb:DeleteItem",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-dependencies",
                    ],
                    "Sid": "DependencyRecordIAC",
                  },
                  {
                    "Action": [
                      "dynamodb:PutItem",
                      "dynamodb:Query",
                      "dynamodb:BatchWriteItem",
                      "dynamodb:UpdateItem",
                      "dynamodb:GetItem",
                      "dynamodb:DeleteItem",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                    ],
                    "Sid": "IACState",
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Policy",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-locations": {
            "dependsOn": [],
            "name": "test-deployment-locations",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-locations",
              "attributeDefinitions": [
                {
                  "AttributeName": "location",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "resource_id",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "location",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "resource_id",
                  "KeyType": "RANGE",
                },
              ],
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-operations": {
            "dependsOn": [],
            "name": "test-deployment-operations",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-operations",
              "attributeDefinitions": [
                {
                  "AttributeName": "resource_id",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "sort_key",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "resource_id",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "sort_key",
                  "KeyType": "RANGE",
                },
              ],
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-scheduler": {
            "dependsOn": [],
            "name": "test-deployment-scheduler",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-scheduler",
              "attributeDefinitions": [
                {
                  "AttributeName": "resource_id",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "sort_key",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "resource_id",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "sort_key",
                  "KeyType": "RANGE",
                },
              ],
              "timeToLiveSpecification": {
                "AttributeName": "ttl",
                "Enabled": true,
              },
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-semaphore": {
            "dependsOn": [],
            "name": "test-deployment-semaphore",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-semaphore",
              "attributeDefinitions": [
                {
                  "AttributeName": "semaphore",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "semaphore",
                  "KeyType": "HASH",
                },
              ],
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-shared-policy": {
            "dependsOn": [
              "test-deployment-event-role",
              "test-deployment-bucket",
            ],
            "name": "test-deployment-shared-policy",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:iam::123456789012:policy/test-deployment-shared-policy",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "description": "test-deployment shared policy",
              "document": {
                "Statement": [
                  {
                    "Action": [
                      "athena:GetQueryExecution",
                      "athena:*",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                  },
                  {
                    "Action": [
                      "s3:GetBucketLocation",
                      "s3:GetObject",
                      "s3:ListBucket",
                      "s3:ListBucketMultipartUploads",
                      "s3:ListMultipartUploadParts",
                      "s3:AbortMultipartUpload",
                      "s3:PutObject",
                      "s3:DeleteObject",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:s3:::test-deployment-bucket-111111",
                      "arn:aws:s3:::test-deployment-bucket-111111/*",
                    ],
                  },
                  {
                    "Action": [
                      "glue:GetPartitions",
                      "glue:GetPartition",
                      "glue:UpdatePartition",
                      "glue:CreatePartition",
                      "glue:BatchCreatePartition",
                      "glue:BatchDeletePartition",
                      "glue:CreateTable",
                      "glue:UpdateTable",
                      "glue:DeleteTable",
                      "glue:GetTable",
                      "glue:GetTables",
                    ],
                    "Effect": "Allow",
                    "Resource": "*",
                  },
                  {
                    "Action": [
                      "iam:PassRole",
                    ],
                    "Effect": "Allow",
                    "Resource": [
                      "arn:aws:iam::123456789012:role/test-deployment-event-role",
                    ],
                  },
                ],
                "Version": "2012-10-17",
              },
            },
            "resourceType": "Policy",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-deployment-resources#test-deployment-temporary-database": {
            "dependsOn": [],
            "name": "test-deployment-temporary-database",
            "parent": "test-deployment#test-deployment-deployment-resources",
            "properties": {
              "arn": "arn:aws:glue:us-west-2:123456789012:database/test-deployment-temporary-database",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
            },
            "resourceType": "GlueDatabase",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-log-notification-bucket-notification-configuration": {
            "dependsOn": [
              "test-deployment-deployment-resources",
              "daemon",
              "cleanup",
              "events",
              "monitor",
            ],
            "name": "test-deployment-log-notification-bucket-notification-configuration",
            "parent": "test-deployment",
            "properties": {
              "bucketName": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "notificationConfiguration": {
                "QueueConfigurations": [
                  {
                    "Events": [
                      "s3:ObjectCreated:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-west-2:123456789012:test-deployment-events-queue",
                  },
                  {
                    "Events": [
                      "s3:ObjectRemoved:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-west-2:123456789012:test-deployment-events-queue",
                  },
                ],
              },
            },
            "resourceType": "BucketNotificationConfiguration",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-state": {
            "dependsOn": [],
            "name": "test-deployment-state",
            "parent": "test-deployment",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": true,
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
              "attributeDefinitions": [
                {
                  "AttributeName": "deployment",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "resource_key",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": undefined,
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "deployment",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "resource_key",
                  "KeyType": "RANGE",
                },
              ],
            },
            "resourceType": "Table",
            "status": "STABLE",
          },
        },
      }
    `);

    const serialized = deployment.serialize();
    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-deployment",
        "parent": "",
        "properties": {
          "_INTERNAL_STATE_RESOURCE": true,
          "accountId": "123456789012",
          "createdAt": 123456789,
          "deployment": {
            "accountId": "123456789012",
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
            "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
            "version": "0.0.1",
          },
          "globalQueryConcurrency": 10,
          "loggingLevel": "info",
          "maxQueriesPerAction": 10000,
          "region": "us-west-2",
          "resourceQueryConcurrency": 10,
          "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
        },
        "resourceType": "WharfieDeployment",
        "resources": [
          "daemon",
          "cleanup",
          "events",
          "monitor",
          "test-deployment-deployment-resources",
          "test-deployment-state",
          "test-deployment-log-notification-bucket-notification-configuration",
        ],
        "status": "STABLE",
      }
    `);

    events.push('LOADING');
    const deserialized = await load({
      deploymentName: 'test-deployment',
      resourceKey: 'test-deployment',
    });
    await deserialized.reconcile();
    expect(state_db.__getMockState()).toStrictEqual(reconcile_state);
    expect(deserialized.resolveProperties()).toMatchInlineSnapshot(`
      {
        "_INTERNAL_STATE_RESOURCE": true,
        "accountId": "123456789012",
        "createdAt": 123456789,
        "deployment": {
          "accountId": "123456789012",
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
          "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
          "version": "0.0.1",
        },
        "globalQueryConcurrency": 10,
        "loggingLevel": "info",
        "maxQueriesPerAction": 10000,
        "region": "us-west-2",
        "resourceQueryConcurrency": 10,
        "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
      }
    `);
    expect(deserialized.status).toBe('STABLE');
    events.push('DESTROYING');
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    expect(events).toHaveLength(374);
    expect(state_db.__getMockState()).toMatchInlineSnapshot(`
      {
        "test-deployment": {
          "test-deployment": {
            "dependsOn": [],
            "name": "test-deployment",
            "parent": "",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": true,
              "accountId": "123456789012",
              "createdAt": 123456789,
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "globalQueryConcurrency": 10,
              "loggingLevel": "info",
              "maxQueriesPerAction": 10000,
              "region": "us-west-2",
              "resourceQueryConcurrency": 10,
              "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
            },
            "resourceType": "WharfieDeployment",
            "resources": [
              "daemon",
              "cleanup",
              "events",
              "monitor",
              "test-deployment-deployment-resources",
              "test-deployment-state",
              "test-deployment-log-notification-bucket-notification-configuration",
            ],
            "status": "DESTROYING",
          },
          "test-deployment#test-deployment-log-notification-bucket-notification-configuration": {
            "dependsOn": [
              "test-deployment-deployment-resources",
              "daemon",
              "cleanup",
              "events",
              "monitor",
            ],
            "name": "test-deployment-log-notification-bucket-notification-configuration",
            "parent": "test-deployment",
            "properties": {
              "bucketName": "test-deployment-bucket-111111",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                "version": "0.0.1",
              },
              "notificationConfiguration": {
                "QueueConfigurations": [
                  {
                    "Events": [
                      "s3:ObjectCreated:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-west-2:123456789012:test-deployment-events-queue",
                  },
                  {
                    "Events": [
                      "s3:ObjectRemoved:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-west-2:123456789012:test-deployment-events-queue",
                  },
                ],
              },
            },
            "resourceType": "BucketNotificationConfiguration",
            "status": "STABLE",
          },
          "test-deployment#test-deployment-state": {
            "dependsOn": [],
            "name": "test-deployment-state",
            "parent": "test-deployment",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": true,
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
              "attributeDefinitions": [
                {
                  "AttributeName": "deployment",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "resource_key",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
              "deployment": {
                "accountId": "123456789012",
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
                "stateTableArn": undefined,
                "version": "0.0.1",
              },
              "keySchema": [
                {
                  "AttributeName": "deployment",
                  "KeyType": "HASH",
                },
                {
                  "AttributeName": "resource_key",
                  "KeyType": "RANGE",
                },
              ],
            },
            "resourceType": "Table",
            "status": "DESTROYING",
          },
        },
      }
    `);
  }, 25000);
});
