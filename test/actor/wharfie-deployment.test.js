/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = '1';
jest.mock('crypto');

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));
jest.mock('../../lambdas/lib/env-paths');

const crypto = require('crypto');

const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');
const { deserialize } = require('../../lambdas/lib/actor/deserialize');

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
    expect.assertions(4);
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {},
    });
    await deployment.reconcile();

    const serialized = deployment.serialize();

    // remove uuid and code hash so snapshots pass
    const serialized_copy = JSON.parse(JSON.stringify(serialized));
    delete serialized_copy.resources.cleanup.resources[
      'cleanup-actor-resources'
    ].resources['cleanup-mapping'].properties.uuid;
    delete serialized_copy.resources.cleanup.resources[
      'cleanup-actor-resources'
    ].resources['test-deployment-cleanup-build'].properties.handler;
    delete serialized_copy.resources.cleanup.resources[
      'cleanup-actor-resources'
    ].properties.handler;

    delete serialized_copy.resources.daemon.resources['daemon-actor-resources']
      .resources['daemon-mapping'].properties.uuid;
    delete serialized_copy.resources.daemon.resources['daemon-actor-resources']
      .resources['test-deployment-daemon-build'].properties.handler;
    delete serialized_copy.resources.daemon.resources['daemon-actor-resources']
      .properties.handler;

    delete serialized_copy.resources.events.resources['events-actor-resources']
      .resources['events-mapping'].properties.uuid;
    delete serialized_copy.resources.events.resources['events-actor-resources']
      .resources['test-deployment-events-build'].properties.handler;
    delete serialized_copy.resources.events.resources['events-actor-resources']
      .properties.handler;

    delete serialized_copy.resources.monitor.resources[
      'monitor-actor-resources'
    ].resources['monitor-mapping'].properties.uuid;
    delete serialized_copy.resources.monitor.resources[
      'monitor-actor-resources'
    ].resources['test-deployment-monitor-build'].properties.handler;
    delete serialized_copy.resources.monitor.resources[
      'monitor-actor-resources'
    ].properties.handler;

    expect(serialized_copy).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-deployment",
        "properties": {
          "_INTERNAL_STATE_RESOURCE": true,
          "accountId": "",
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
          "globalQueryConcurrency": 10,
          "loggingLevel": "info",
          "maxQueriesPerAction": 10000,
          "region": "us-west-2",
          "resourceQueryConcurrency": 10,
        },
        "resourceType": "WharfieDeployment",
        "resources": {
          "cleanup": {
            "dependsOn": [],
            "name": "cleanup",
            "properties": {
              "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
              "artifactBucket": "test-deployment-bucket",
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
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "EVENT_TABLE": "test-deployment-events",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
              },
              "handler": "./lambdas/cleanup.handler",
            },
            "resourceType": "Cleanup",
            "resources": {
              "cleanup-actor-resources": {
                "dependsOn": [],
                "name": "cleanup-actor-resources",
                "properties": {
                  "actorName": "cleanup",
                  "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
                  "artifactBucket": "test-deployment-bucket",
                  "deployment": {
                    "envPaths": {
                      "cache": "mock",
                      "config": "mock",
                      "data": "mock",
                      "log": "mock",
                      "temp": "mock",
                    },
                    "name": "test-deployment",
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "environmentVariables": {
                    "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                    "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                    "DEPENDENCY_TABLE": "test-deployment-dependencies",
                    "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                    "EVENT_TABLE": "test-deployment-events",
                    "GLOBAL_QUERY_CONCURRENCY": "10",
                    "LOCATION_TABLE": "test-deployment-locations",
                    "LOGGING_LEVEL": "info",
                    "MAX_QUERIES_PER_ACTION": "10000",
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "OPERATIONS_TABLE": "test-deployment-operations",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                },
                "resourceType": "WharfieActorResources",
                "resources": {
                  "cleanup-mapping": {
                    "dependsOn": [
                      "test-deployment-cleanup-function",
                      "test-deployment-cleanup-queue",
                    ],
                    "name": "cleanup-mapping",
                    "properties": {
                      "batchSize": 1,
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                      "functionName": "test-deployment-cleanup-function",
                      "maximumBatchingWindowInSeconds": 0,
                    },
                    "resourceType": "EventSourceMapping",
                    "status": "STABLE",
                  },
                  "test-deployment-cleanup-build": {
                    "dependsOn": [],
                    "name": "test-deployment-cleanup-build",
                    "properties": {
                      "artifactBucket": "test-deployment-bucket",
                      "artifactKey": "actor-artifacts/test-deployment-cleanup-build/mockedHash.zip",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "functionCodeHash": "mockedHash",
                    },
                    "resourceType": "LambdaBuild",
                    "status": "STABLE",
                  },
                  "test-deployment-cleanup-dlq": {
                    "dependsOn": [],
                    "name": "test-deployment-cleanup-dlq",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-dlq",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                  "test-deployment-cleanup-function": {
                    "dependsOn": [
                      "test-deployment-cleanup-role",
                      "test-deployment-cleanup-dlq",
                      "test-deployment-cleanup-queue",
                      "test-deployment-cleanup-build",
                    ],
                    "name": "test-deployment-cleanup-function",
                    "properties": {
                      "architectures": [
                        "arm64",
                      ],
                      "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-cleanup-function",
                      "code": {
                        "S3Bucket": "test-deployment-bucket",
                        "S3Key": "actor-artifacts/test-deployment-cleanup-build/mockedHash.zip",
                      },
                      "codeHash": "mockedHash",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-dlq",
                      },
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                          "EVENT_TABLE": "test-deployment-events",
                          "GLOBAL_QUERY_CONCURRENCY": "10",
                          "LOCATION_TABLE": "test-deployment-locations",
                          "LOGGING_LEVEL": "info",
                          "MAX_QUERIES_PER_ACTION": "10000",
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "OPERATIONS_TABLE": "test-deployment-operations",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "SEMAPHORE_TABLE": "test-deployment-semaphore",
                          "STACK_NAME": "test-deployment",
                          "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                          "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                          "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
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
                      "runtime": "nodejs20.x",
                      "timeout": 300,
                    },
                    "resourceType": "LambdaFunction",
                    "status": "STABLE",
                  },
                  "test-deployment-cleanup-queue": {
                    "dependsOn": [],
                    "name": "test-deployment-cleanup-queue",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                              "StringEquals": {},
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
                              "StringEquals": {},
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
                  "test-deployment-cleanup-role": {
                    "dependsOn": [
                      "test-deployment-cleanup-queue",
                      "test-deployment-cleanup-dlq",
                    ],
                    "name": "test-deployment-cleanup-role",
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
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "test-deployment actor cleanup role",
                      "managedPolicyArns": [
                        "arn:aws:iam:::policy/test-deployment-actor-policy",
                      ],
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
                },
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "daemon": {
            "dependsOn": [],
            "name": "daemon",
            "properties": {
              "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
              "artifactBucket": "test-deployment-bucket",
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
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "EVENT_TABLE": "test-deployment-events",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
              },
              "handler": "./lambdas/daemon.handler",
            },
            "resourceType": "Daemon",
            "resources": {
              "daemon-actor-resources": {
                "dependsOn": [],
                "name": "daemon-actor-resources",
                "properties": {
                  "actorName": "daemon",
                  "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
                  "artifactBucket": "test-deployment-bucket",
                  "deployment": {
                    "envPaths": {
                      "cache": "mock",
                      "config": "mock",
                      "data": "mock",
                      "log": "mock",
                      "temp": "mock",
                    },
                    "name": "test-deployment",
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "environmentVariables": {
                    "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                    "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                    "DEPENDENCY_TABLE": "test-deployment-dependencies",
                    "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                    "EVENT_TABLE": "test-deployment-events",
                    "GLOBAL_QUERY_CONCURRENCY": "10",
                    "LOCATION_TABLE": "test-deployment-locations",
                    "LOGGING_LEVEL": "info",
                    "MAX_QUERIES_PER_ACTION": "10000",
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "OPERATIONS_TABLE": "test-deployment-operations",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                },
                "resourceType": "WharfieActorResources",
                "resources": {
                  "daemon-mapping": {
                    "dependsOn": [
                      "test-deployment-daemon-function",
                      "test-deployment-daemon-queue",
                    ],
                    "name": "daemon-mapping",
                    "properties": {
                      "batchSize": 1,
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                      "functionName": "test-deployment-daemon-function",
                      "maximumBatchingWindowInSeconds": 0,
                    },
                    "resourceType": "EventSourceMapping",
                    "status": "STABLE",
                  },
                  "test-deployment-daemon-build": {
                    "dependsOn": [],
                    "name": "test-deployment-daemon-build",
                    "properties": {
                      "artifactBucket": "test-deployment-bucket",
                      "artifactKey": "actor-artifacts/test-deployment-daemon-build/mockedHash.zip",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "functionCodeHash": "mockedHash",
                    },
                    "resourceType": "LambdaBuild",
                    "status": "STABLE",
                  },
                  "test-deployment-daemon-dlq": {
                    "dependsOn": [],
                    "name": "test-deployment-daemon-dlq",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-dlq",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                  "test-deployment-daemon-function": {
                    "dependsOn": [
                      "test-deployment-daemon-role",
                      "test-deployment-daemon-dlq",
                      "test-deployment-daemon-queue",
                      "test-deployment-daemon-build",
                    ],
                    "name": "test-deployment-daemon-function",
                    "properties": {
                      "architectures": [
                        "arm64",
                      ],
                      "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-daemon-function",
                      "code": {
                        "S3Bucket": "test-deployment-bucket",
                        "S3Key": "actor-artifacts/test-deployment-daemon-build/mockedHash.zip",
                      },
                      "codeHash": "mockedHash",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-dlq",
                      },
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                          "EVENT_TABLE": "test-deployment-events",
                          "GLOBAL_QUERY_CONCURRENCY": "10",
                          "LOCATION_TABLE": "test-deployment-locations",
                          "LOGGING_LEVEL": "info",
                          "MAX_QUERIES_PER_ACTION": "10000",
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "OPERATIONS_TABLE": "test-deployment-operations",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "SEMAPHORE_TABLE": "test-deployment-semaphore",
                          "STACK_NAME": "test-deployment",
                          "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                          "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                          "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
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
                      "runtime": "nodejs20.x",
                      "timeout": 300,
                    },
                    "resourceType": "LambdaFunction",
                    "status": "STABLE",
                  },
                  "test-deployment-daemon-queue": {
                    "dependsOn": [],
                    "name": "test-deployment-daemon-queue",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                              "StringEquals": {},
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
                              "StringEquals": {},
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
                  "test-deployment-daemon-role": {
                    "dependsOn": [
                      "test-deployment-daemon-queue",
                      "test-deployment-daemon-dlq",
                    ],
                    "name": "test-deployment-daemon-role",
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
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "test-deployment actor daemon role",
                      "managedPolicyArns": [
                        "arn:aws:iam:::policy/test-deployment-actor-policy",
                      ],
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
                },
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "events": {
            "dependsOn": [],
            "name": "events",
            "properties": {
              "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
              "artifactBucket": "test-deployment-bucket",
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
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "EVENT_TABLE": "test-deployment-events",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
              },
              "handler": "./lambdas/events.handler",
            },
            "resourceType": "Events",
            "resources": {
              "events-actor-resources": {
                "dependsOn": [],
                "name": "events-actor-resources",
                "properties": {
                  "actorName": "events",
                  "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
                  "artifactBucket": "test-deployment-bucket",
                  "deployment": {
                    "envPaths": {
                      "cache": "mock",
                      "config": "mock",
                      "data": "mock",
                      "log": "mock",
                      "temp": "mock",
                    },
                    "name": "test-deployment",
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "environmentVariables": {
                    "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                    "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                    "DEPENDENCY_TABLE": "test-deployment-dependencies",
                    "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                    "EVENT_TABLE": "test-deployment-events",
                    "GLOBAL_QUERY_CONCURRENCY": "10",
                    "LOCATION_TABLE": "test-deployment-locations",
                    "LOGGING_LEVEL": "info",
                    "MAX_QUERIES_PER_ACTION": "10000",
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "OPERATIONS_TABLE": "test-deployment-operations",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                },
                "resourceType": "WharfieActorResources",
                "resources": {
                  "events-mapping": {
                    "dependsOn": [
                      "test-deployment-events-function",
                      "test-deployment-events-queue",
                    ],
                    "name": "events-mapping",
                    "properties": {
                      "batchSize": 1,
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                      "functionName": "test-deployment-events-function",
                      "maximumBatchingWindowInSeconds": 0,
                    },
                    "resourceType": "EventSourceMapping",
                    "status": "STABLE",
                  },
                  "test-deployment-events-build": {
                    "dependsOn": [],
                    "name": "test-deployment-events-build",
                    "properties": {
                      "artifactBucket": "test-deployment-bucket",
                      "artifactKey": "actor-artifacts/test-deployment-events-build/mockedHash.zip",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "functionCodeHash": "mockedHash",
                    },
                    "resourceType": "LambdaBuild",
                    "status": "STABLE",
                  },
                  "test-deployment-events-dlq": {
                    "dependsOn": [],
                    "name": "test-deployment-events-dlq",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-dlq",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                  "test-deployment-events-function": {
                    "dependsOn": [
                      "test-deployment-events-role",
                      "test-deployment-events-dlq",
                      "test-deployment-events-queue",
                      "test-deployment-events-build",
                    ],
                    "name": "test-deployment-events-function",
                    "properties": {
                      "architectures": [
                        "arm64",
                      ],
                      "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-events-function",
                      "code": {
                        "S3Bucket": "test-deployment-bucket",
                        "S3Key": "actor-artifacts/test-deployment-events-build/mockedHash.zip",
                      },
                      "codeHash": "mockedHash",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-dlq",
                      },
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                          "EVENT_TABLE": "test-deployment-events",
                          "GLOBAL_QUERY_CONCURRENCY": "10",
                          "LOCATION_TABLE": "test-deployment-locations",
                          "LOGGING_LEVEL": "info",
                          "MAX_QUERIES_PER_ACTION": "10000",
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "OPERATIONS_TABLE": "test-deployment-operations",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "SEMAPHORE_TABLE": "test-deployment-semaphore",
                          "STACK_NAME": "test-deployment",
                          "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                          "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                          "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
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
                      "runtime": "nodejs20.x",
                      "timeout": 300,
                    },
                    "resourceType": "LambdaFunction",
                    "status": "STABLE",
                  },
                  "test-deployment-events-queue": {
                    "dependsOn": [],
                    "name": "test-deployment-events-queue",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                              "StringEquals": {},
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
                              "StringEquals": {},
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
                  "test-deployment-events-role": {
                    "dependsOn": [
                      "test-deployment-events-queue",
                      "test-deployment-events-dlq",
                    ],
                    "name": "test-deployment-events-role",
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
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "test-deployment actor events role",
                      "managedPolicyArns": [
                        "arn:aws:iam:::policy/test-deployment-actor-policy",
                      ],
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
                },
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "monitor": {
            "dependsOn": [],
            "name": "monitor",
            "properties": {
              "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
              "artifactBucket": "test-deployment-bucket",
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
              "environmentVariables": {
                "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                "DEPENDENCY_TABLE": "test-deployment-dependencies",
                "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                "EVENT_TABLE": "test-deployment-events",
                "GLOBAL_QUERY_CONCURRENCY": "10",
                "LOCATION_TABLE": "test-deployment-locations",
                "LOGGING_LEVEL": "info",
                "MAX_QUERIES_PER_ACTION": "10000",
                "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                "OPERATIONS_TABLE": "test-deployment-operations",
                "RESOURCE_QUERY_CONCURRENCY": "10",
                "SEMAPHORE_TABLE": "test-deployment-semaphore",
                "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
              },
              "handler": "./lambdas/monitor.handler",
            },
            "resourceType": "Monitor",
            "resources": {
              "monitor-actor-resources": {
                "dependsOn": [],
                "name": "monitor-actor-resources",
                "properties": {
                  "actorName": "monitor",
                  "actorSharedPolicyArn": "arn:aws:iam:::policy/test-deployment-actor-policy",
                  "artifactBucket": "test-deployment-bucket",
                  "deployment": {
                    "envPaths": {
                      "cache": "mock",
                      "config": "mock",
                      "data": "mock",
                      "log": "mock",
                      "temp": "mock",
                    },
                    "name": "test-deployment",
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "environmentVariables": {
                    "CLEANUP_QUEUE_URL": "test-deployment-cleanup-queue",
                    "DAEMON_QUEUE_URL": "test-deployment-daemon-queue",
                    "DEPENDENCY_TABLE": "test-deployment-dependencies",
                    "EVENTS_QUEUE_URL": "test-deployment-events-queue",
                    "EVENT_TABLE": "test-deployment-events",
                    "GLOBAL_QUERY_CONCURRENCY": "10",
                    "LOCATION_TABLE": "test-deployment-locations",
                    "LOGGING_LEVEL": "info",
                    "MAX_QUERIES_PER_ACTION": "10000",
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "OPERATIONS_TABLE": "test-deployment-operations",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                },
                "resourceType": "WharfieActorResources",
                "resources": {
                  "monitor-mapping": {
                    "dependsOn": [
                      "test-deployment-monitor-function",
                      "test-deployment-monitor-queue",
                    ],
                    "name": "monitor-mapping",
                    "properties": {
                      "batchSize": 1,
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                      "functionName": "test-deployment-monitor-function",
                      "maximumBatchingWindowInSeconds": 0,
                    },
                    "resourceType": "EventSourceMapping",
                    "status": "STABLE",
                  },
                  "test-deployment-monitor-build": {
                    "dependsOn": [],
                    "name": "test-deployment-monitor-build",
                    "properties": {
                      "artifactBucket": "test-deployment-bucket",
                      "artifactKey": "actor-artifacts/test-deployment-monitor-build/mockedHash.zip",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "functionCodeHash": "mockedHash",
                    },
                    "resourceType": "LambdaBuild",
                    "status": "STABLE",
                  },
                  "test-deployment-monitor-dlq": {
                    "dependsOn": [],
                    "name": "test-deployment-monitor-dlq",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                  "test-deployment-monitor-function": {
                    "dependsOn": [
                      "test-deployment-monitor-role",
                      "test-deployment-monitor-dlq",
                      "test-deployment-monitor-queue",
                      "test-deployment-monitor-build",
                    ],
                    "name": "test-deployment-monitor-function",
                    "properties": {
                      "architectures": [
                        "arm64",
                      ],
                      "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-monitor-function",
                      "code": {
                        "S3Bucket": "test-deployment-bucket",
                        "S3Key": "actor-artifacts/test-deployment-monitor-build/mockedHash.zip",
                      },
                      "codeHash": "mockedHash",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
                      },
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                          "EVENT_TABLE": "test-deployment-events",
                          "GLOBAL_QUERY_CONCURRENCY": "10",
                          "LOCATION_TABLE": "test-deployment-locations",
                          "LOGGING_LEVEL": "info",
                          "MAX_QUERIES_PER_ACTION": "10000",
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "OPERATIONS_TABLE": "test-deployment-operations",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "SEMAPHORE_TABLE": "test-deployment-semaphore",
                          "STACK_NAME": "test-deployment",
                          "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                          "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                          "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
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
                      "runtime": "nodejs20.x",
                      "timeout": 300,
                    },
                    "resourceType": "LambdaFunction",
                    "status": "STABLE",
                  },
                  "test-deployment-monitor-queue": {
                    "dependsOn": [],
                    "name": "test-deployment-monitor-queue",
                    "properties": {
                      "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                      "delaySeconds": "0",
                      "deployment": {
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
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
                              "StringEquals": {},
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
                              "StringEquals": {},
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
                  "test-deployment-monitor-role": {
                    "dependsOn": [
                      "test-deployment-monitor-queue",
                      "test-deployment-monitor-dlq",
                    ],
                    "name": "test-deployment-monitor-role",
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
                        "envPaths": {
                          "cache": "mock",
                          "config": "mock",
                          "data": "mock",
                          "log": "mock",
                          "temp": "mock",
                        },
                        "name": "test-deployment",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "test-deployment actor monitor role",
                      "managedPolicyArns": [
                        "arn:aws:iam:::policy/test-deployment-actor-policy",
                      ],
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
                },
                "status": "STABLE",
              },
              "monitor-athena-events-rule": {
                "dependsOn": [
                  "test-deployment-monitor-queue",
                ],
                "name": "monitor-athena-events-rule",
                "properties": {
                  "deployment": {
                    "envPaths": {
                      "cache": "mock",
                      "config": "mock",
                      "data": "mock",
                      "log": "mock",
                      "temp": "mock",
                    },
                    "name": "test-deployment",
                    "stateTable": "test-deployment-state",
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
            },
            "status": "STABLE",
          },
          "test-deployment-deployment-resources": {
            "dependsOn": [
              "test-deployment-state",
            ],
            "name": "test-deployment-deployment-resources",
            "properties": {
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
              "loggingLevel": "info",
            },
            "resourceType": "WharfieDeploymentResources",
            "resources": {
              "test-deployment-actor-policy": {
                "dependsOn": [
                  "test-deployment-operations",
                  "test-deployment-locations",
                  "test-deployment-semaphore",
                  "test-deployment-events",
                  "test-deployment-dependencies",
                ],
                "name": "test-deployment-actor-policy",
                "properties": {
                  "arn": "arn:aws:iam:::policy/test-deployment-actor-policy",
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
                          "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-events",
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
                          "arn:aws:s3:::test-deployment-bucket/*",
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
                          "arn:aws:s3:::test-deployment-bucket",
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
              "test-deployment-bucket": {
                "dependsOn": [],
                "name": "test-deployment-bucket",
                "properties": {
                  "arn": "arn:aws:s3:::test-deployment-bucket",
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
              "test-deployment-dependencies": {
                "dependsOn": [],
                "name": "test-deployment-dependencies",
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
              "test-deployment-deployment-resources-log-resource": {
                "dependsOn": [
                  "test-deployment-glue-database",
                  "test-deployment-deployment-resources-logging-resource-role",
                  "test-deployment-operations",
                  "test-deployment-locations",
                  "test-deployment-dependencies",
                  "test-deployment-bucket",
                ],
                "name": "test-deployment-deployment-resources-log-resource",
                "properties": {
                  "catalogId": "",
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
                  "description": "test-deployment-deployment-resources wharfie logs",
                  "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                  "inputLocation": "s3://test-deployment-bucket/logs/raw/",
                  "interval": 300,
                  "locationTable": "test-deployment-locations",
                  "migrationResource": false,
                  "numberOfBuckets": 0,
                  "operationTable": "test-deployment-operations",
                  "outputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                  "outputLocation": "s3://test-deployment-bucket/logs/processed/",
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
                  "projectBucket": "test-deployment-bucket",
                  "projectName": "test-deployment",
                  "region": "us-west-2",
                  "resourceId": "test-deployment.logs",
                  "resourceName": "logs",
                  "roleArn": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
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
                "resourceType": "WharfieResource",
                "resources": {
                  "logs": {
                    "dependsOn": [],
                    "name": "logs",
                    "properties": {
                      "arn": "arn:aws:glue:us-west-2::table/test-deployment/logs",
                      "catalogId": "",
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
                      "description": "test-deployment-deployment-resources wharfie logs",
                      "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                      "location": "s3://test-deployment-bucket/logs/processed/references/",
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
                  "logs_raw": {
                    "dependsOn": [],
                    "name": "logs_raw",
                    "properties": {
                      "arn": "arn:aws:glue:us-west-2::table/test-deployment/logs_raw",
                      "catalogId": "",
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
                      "description": "test-deployment-deployment-resources wharfie logs",
                      "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                      "location": "s3://test-deployment-bucket/logs/raw/",
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
                  "test-deployment-logs-location-record": {
                    "dependsOn": [],
                    "name": "test-deployment-logs-location-record",
                    "properties": {
                      "data": {
                        "interval": 300,
                      },
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
                      "keyName": "location",
                      "keyValue": "s3://test-deployment-bucket/logs/raw/",
                      "sortKeyName": "resource_id",
                      "sortKeyValue": "test-deployment.logs",
                      "tableName": "test-deployment-locations",
                    },
                    "resourceType": "TableRecord",
                    "status": "STABLE",
                  },
                  "test-deployment-logs-resource-record": {
                    "dependsOn": [],
                    "name": "test-deployment-logs-resource-record",
                    "properties": {
                      "data": {
                        "data": {
                          "athena_workgroup": "test-deployment-logs-workgroup",
                          "daemon_config": {
                            "Role": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
                          },
                          "destination_properties": {
                            "arn": "arn:aws:glue:us-west-2::table/test-deployment/logs",
                            "catalogId": "",
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
                            "description": "test-deployment-deployment-resources wharfie logs",
                            "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                            "location": "s3://test-deployment-bucket/logs/processed/references/",
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
                          "region": "us-west-2",
                          "resource_status": "CREATING",
                          "source_properties": {
                            "arn": "arn:aws:glue:us-west-2::table/test-deployment/logs_raw",
                            "catalogId": "",
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
                            "description": "test-deployment-deployment-resources wharfie logs",
                            "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                            "location": "s3://test-deployment-bucket/logs/raw/",
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
                          "source_region": "us-east-1",
                          "wharfie_version": "0.0.1",
                        },
                      },
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
                      "keyName": "resource_id",
                      "keyValue": "test-deployment.logs",
                      "sortKeyName": "sort_key",
                      "sortKeyValue": "test-deployment.logs",
                      "tableName": "test-deployment-operations",
                    },
                    "resourceType": "TableRecord",
                    "status": "STABLE",
                  },
                  "test-deployment-logs-workgroup": {
                    "dependsOn": [],
                    "name": "test-deployment-logs-workgroup",
                    "properties": {
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
                      "description": "test-deployment resource logs workgroup",
                      "outputLocation": "s3://test-deployment-bucket/logs/processed/query_metadata/",
                    },
                    "resourceType": "AthenaWorkGroup",
                    "status": "STABLE",
                  },
                },
                "status": "STABLE",
              },
              "test-deployment-deployment-resources-logging-resource-role": {
                "dependsOn": [
                  "test-deployment-shared-policy",
                ],
                "name": "test-deployment-deployment-resources-logging-resource-role",
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
                  "description": "test-deployment-deployment-resources logging resource role",
                  "managedPolicyArns": [
                    "arn:aws:iam:::policy/test-deployment-shared-policy",
                  ],
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
                          "arn:aws:s3:::test-deployment-bucket",
                        ],
                        "Sid": "Bucket",
                      },
                      {
                        "Action": [
                          "s3:*",
                        ],
                        "Effect": "Allow",
                        "Resource": "arn:aws:s3:::test-deployment-bucket/logs/processed/*",
                        "Sid": "OutputWrite",
                      },
                      {
                        "Action": [
                          "s3:GetObject",
                        ],
                        "Effect": "Allow",
                        "Resource": "arn:aws:s3:::test-deployment-bucket/logs/raw/*",
                        "Sid": "InputRead",
                      },
                    ],
                    "Version": "2012-10-17",
                  },
                },
                "resourceType": "Role",
                "status": "STABLE",
              },
              "test-deployment-event-role": {
                "dependsOn": [],
                "name": "test-deployment-event-role",
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
                  "description": "test-deployment event role",
                },
                "resourceType": "Role",
                "status": "STABLE",
              },
              "test-deployment-events": {
                "dependsOn": [],
                "name": "test-deployment-events",
                "properties": {
                  "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-events",
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
              "test-deployment-firehose": {
                "dependsOn": [
                  "test-deployment-firehose-role",
                  "test-deployment-bucket",
                ],
                "name": "test-deployment-firehose",
                "properties": {
                  "arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-deployment-firehose",
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
                  "s3DestinationConfiguration": {
                    "BucketARN": "arn:aws:s3:::test-deployment-bucket",
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
              "test-deployment-firehose-role": {
                "dependsOn": [
                  "test-deployment-bucket",
                ],
                "name": "test-deployment-firehose-role",
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
                  "description": "test-deployment firehose role",
                  "rolePolicyDocument": {
                    "Statement": [
                      {
                        "Action": [
                          "s3:PutObject",
                          "s3:GetObject",
                        ],
                        "Effect": "Allow",
                        "Resource": "arn:aws:s3:::test-deployment-bucket/logs/raw/*",
                      },
                      {
                        "Action": [
                          "s3:AbortMultipartUpload",
                          "s3:GetBucketLocation",
                          "s3:ListBucket",
                          "s3:ListBucketMultipartUploads",
                        ],
                        "Effect": "Allow",
                        "Resource": "arn:aws:s3:::test-deployment-bucket",
                      },
                    ],
                    "Version": "2012-10-17",
                  },
                },
                "resourceType": "Role",
                "status": "STABLE",
              },
              "test-deployment-glue-database": {
                "dependsOn": [],
                "name": "test-deployment-glue-database",
                "properties": {
                  "databaseName": "test-deployment",
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
                },
                "resourceType": "GlueDatabase",
                "status": "STABLE",
              },
              "test-deployment-locations": {
                "dependsOn": [],
                "name": "test-deployment-locations",
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
              "test-deployment-operations": {
                "dependsOn": [],
                "name": "test-deployment-operations",
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
              "test-deployment-semaphore": {
                "dependsOn": [],
                "name": "test-deployment-semaphore",
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
              "test-deployment-shared-policy": {
                "dependsOn": [
                  "test-deployment-event-role",
                  "test-deployment-bucket",
                ],
                "name": "test-deployment-shared-policy",
                "properties": {
                  "arn": "arn:aws:iam:::policy/test-deployment-shared-policy",
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
                          "arn:aws:s3:::test-deployment-bucket",
                          "arn:aws:s3:::test-deployment-bucket/*",
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
              "test-deployment-temporary-database": {
                "dependsOn": [],
                "name": "test-deployment-temporary-database",
                "properties": {
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
                },
                "resourceType": "GlueDatabase",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
          "test-deployment-log-notification-bucket-notification-configuration": {
            "dependsOn": [
              "test-deployment-deployment-resources",
              "daemon",
              "cleanup",
              "events",
              "monitor",
            ],
            "name": "test-deployment-log-notification-bucket-notification-configuration",
            "properties": {
              "arn": "arn:aws:s3:::test-deployment-log-notification-bucket-notification-configuration",
              "bucketName": "test-deployment-bucket",
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
              "notificationConfiguration": {
                "QueueConfigurations": [
                  {
                    "Events": [
                      "s3:ObjectCreated:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-west-2::test-deployment-events-queue",
                  },
                  {
                    "Events": [
                      "s3:ObjectRemoved:*",
                    ],
                    "QueueArn": "arn:aws:sqs:us-west-2::test-deployment-events-queue",
                  },
                ],
              },
            },
            "resourceType": "BucketNotificationConfiguration",
            "status": "STABLE",
          },
          "test-deployment-state": {
            "dependsOn": [],
            "name": "test-deployment-state",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": true,
              "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
              "attributeDefinitions": [
                {
                  "AttributeName": "name",
                  "AttributeType": "S",
                },
                {
                  "AttributeName": "sort_key",
                  "AttributeType": "S",
                },
              ],
              "billingMode": "PAY_PER_REQUEST",
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
              "keySchema": [
                {
                  "AttributeName": "name",
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
        },
        "status": "STABLE",
      }
    `);
    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    // @ts-ignore
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "_INTERNAL_STATE_RESOURCE": true,
        "accountId": "",
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
        "globalQueryConcurrency": 10,
        "loggingLevel": "info",
        "maxQueriesPerAction": 10000,
        "region": "us-west-2",
        "resourceQueryConcurrency": 10,
      }
    `);
    expect(deserialized.status).toBe('STABLE');
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
  }, 25000);
});
