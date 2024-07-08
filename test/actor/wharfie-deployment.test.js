/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;

// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

process.env.AWS_MOCKS = true;
const WharfieDeployment = require('../../lambdas/lib/actor/wharfie-deployment');

const { deserialize } = require('../../lambdas/lib/actor/deserialize');

describe('deployment IaC', () => {
  it('basic', async () => {
    expect.assertions(4);
    const deployment = new WharfieDeployment({
      name: 'test-deployment',
      properties: {},
    });
    await deployment.reconcile();

    const serialized = deployment.serialize();

    // remove uuid and code hash so snapshots pass
    const serialized_copy = Object.assign({}, serialized);
    delete serialized_copy.resources.cleanup.resources[
      'cleanup-actor-resources'
    ].resources['cleanup-mapping'].properties.uuid;
    delete serialized_copy.resources.cleanup.resources[
      'cleanup-actor-resources'
    ].resources['test-deployment-cleanup-build'].properties.artifactKey;
    delete serialized_copy.resources.cleanup.resources[
      'cleanup-actor-resources'
    ].resources['test-deployment-cleanup-build'].properties.functionCodeHash;

    delete serialized_copy.resources.daemon.resources['daemon-actor-resources']
      .resources['daemon-mapping'].properties.uuid;
    delete serialized_copy.resources.daemon.resources['daemon-actor-resources']
      .resources['test-deployment-daemon-build'].properties.artifactKey;
    delete serialized_copy.resources.daemon.resources['daemon-actor-resources']
      .resources['test-deployment-daemon-build'].properties.functionCodeHash;

    delete serialized_copy.resources.events.resources['events-actor-resources']
      .resources['events-mapping'].properties.uuid;
    delete serialized_copy.resources.events.resources['events-actor-resources']
      .resources['test-deployment-events-build'].properties.artifactKey;
    delete serialized_copy.resources.events.resources['events-actor-resources']
      .resources['test-deployment-events-build'].properties.functionCodeHash;

    delete serialized_copy.resources.monitor.resources[
      'monitor-actor-resources'
    ].resources['monitor-mapping'].properties.uuid;
    delete serialized_copy.resources.monitor.resources[
      'monitor-actor-resources'
    ].resources['test-deployment-monitor-build'].properties.artifactKey;
    delete serialized_copy.resources.monitor.resources[
      'monitor-actor-resources'
    ].resources['test-deployment-monitor-build'].properties.functionCodeHash;

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
              "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
              "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
              "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
              "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
              "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
              "deployment": {
                "accountId": "",
                "envPaths": {
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/cleanup.handler",
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
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
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
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "RESOURCE_TABLE": "test-deployment-resource",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                  "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/cleanup.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/cleanup.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                        "S3Key": "actor-artifacts/test-deployment-cleanup-build/4693fcd956932844b8cefa4d8a6194ea525ef9e08c68068dabb50a50aedc6f32.zip",
                      },
                      "codeHash": "4693fcd956932844b8cefa4d8a6194ea525ef9e08c68068dabb50a50aedc6f32",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-dlq",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "RESOURCE_TABLE": "test-deployment-resource",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "messageRetentionPeriod": "1209600",
                      "policy": {
                        "Statement": [
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Condition": {
                              "StringEquals": {
                                "aws:SourceAccount": undefined,
                              },
                            },
                            "Effect": "Allow",
                            "Principal": {
                              "Service": "s3.amazonaws.com",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                            "Sid": "accept-events",
                          },
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Effect": "Allow",
                            "Principal": {
                              "AWS": "*",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-cleanup-queue",
                            "Sid": "accept-s3-events",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
              "deployment": {
                "accountId": "",
                "envPaths": {
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/daemon.handler",
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
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
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
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "RESOURCE_TABLE": "test-deployment-resource",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                  "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/daemon.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/daemon.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                        "S3Key": "actor-artifacts/test-deployment-daemon-build/e8a1d96e772b18811a3a569a57403bacbbc20716600fe2b53ef88c2ca5f39650.zip",
                      },
                      "codeHash": "e8a1d96e772b18811a3a569a57403bacbbc20716600fe2b53ef88c2ca5f39650",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-dlq",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "RESOURCE_TABLE": "test-deployment-resource",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "messageRetentionPeriod": "1209600",
                      "policy": {
                        "Statement": [
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Condition": {
                              "StringEquals": {
                                "aws:SourceAccount": undefined,
                              },
                            },
                            "Effect": "Allow",
                            "Principal": {
                              "Service": "s3.amazonaws.com",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                            "Sid": "accept-events",
                          },
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Effect": "Allow",
                            "Principal": {
                              "AWS": "*",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-daemon-queue",
                            "Sid": "accept-s3-events",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
              "deployment": {
                "accountId": "",
                "envPaths": {
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/events.handler",
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
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
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
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "RESOURCE_TABLE": "test-deployment-resource",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                  "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/events.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/events.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                        "S3Key": "actor-artifacts/test-deployment-events-build/3039eb3d6865523324c5da031d35f69677ed6de23d0b62cabf0eafb9cc5e9ddb.zip",
                      },
                      "codeHash": "3039eb3d6865523324c5da031d35f69677ed6de23d0b62cabf0eafb9cc5e9ddb",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-dlq",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "RESOURCE_TABLE": "test-deployment-resource",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "messageRetentionPeriod": "1209600",
                      "policy": {
                        "Statement": [
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Condition": {
                              "StringEquals": {
                                "aws:SourceAccount": undefined,
                              },
                            },
                            "Effect": "Allow",
                            "Principal": {
                              "Service": "s3.amazonaws.com",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                            "Sid": "accept-events",
                          },
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Effect": "Allow",
                            "Principal": {
                              "AWS": "*",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-events-queue",
                            "Sid": "accept-s3-events",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
              "deployment": {
                "accountId": "",
                "envPaths": {
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
              "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/monitor.handler",
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
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
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
                    "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                    "RESOURCE_QUERY_CONCURRENCY": "10",
                    "RESOURCE_TABLE": "test-deployment-resource",
                    "SEMAPHORE_TABLE": "test-deployment-semaphore",
                    "TEMPORARY_GLUE_DATABASE": "test-deployment-temporary-database",
                    "WHARFIE_LOGGING_FIREHOSE": "test-deployment-firehose",
                    "WHARFIE_SERVICE_BUCKET": "test-deployment-bucket",
                  },
                  "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/monitor.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "handler": "/Users/Dev/Documents/workspace/wharfie/wharfie/lambdas/monitor.handler",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                        "S3Key": "actor-artifacts/test-deployment-monitor-build/76f7f8502f60995d15b24e52326c2f6c786faafe60fca4b48e8c5d9f65435393.zip",
                      },
                      "codeHash": "76f7f8502f60995d15b24e52326c2f6c786faafe60fca4b48e8c5d9f65435393",
                      "deadLetterConfig": {
                        "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-dlq",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                          "MONITOR_QUEUE_URL": "test-deployment-monitor-queue",
                          "NODE_OPTIONS": "--enable-source-maps",
                          "RESOURCE_QUERY_CONCURRENCY": "10",
                          "RESOURCE_TABLE": "test-deployment-resource",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "messageRetentionPeriod": "1209600",
                      "policy": {
                        "Statement": [
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Condition": {
                              "StringEquals": {
                                "aws:SourceAccount": undefined,
                              },
                            },
                            "Effect": "Allow",
                            "Principal": {
                              "Service": "s3.amazonaws.com",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                            "Sid": "accept-events",
                          },
                          {
                            "Action": [
                              "sqs:SendMessage",
                              "SQS:SendMessage",
                            ],
                            "Effect": "Allow",
                            "Principal": {
                              "AWS": "*",
                            },
                            "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
                            "Sid": "accept-s3-events",
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
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
              "monitor-athena-events-role": {
                "dependsOn": [],
                "name": "monitor-athena-events-role",
                "properties": {
                  "arn": "arn:aws:iam::123456789012:role/monitor-athena-events-role",
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
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "description": "monitor athena events role",
                },
                "resourceType": "Role",
                "status": "STABLE",
              },
              "monitor-athena-events-rule": {
                "dependsOn": [
                  "monitor-athena-events-role",
                  "test-deployment-monitor-queue",
                ],
                "name": "monitor-athena-events-rule",
                "properties": {
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "description": "monitor athena events rule",
                  "eventPattern": "{"source":["aws.athena"],"detail-type":["Athena Query State Change"]}",
                  "roleArn": "arn:aws:iam::123456789012:role/monitor-athena-events-role",
                  "state": "ENABLED",
                  "targets": [
                    {
                      "Arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-monitor-queue",
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
              "test-deployment-state-autoscaling-table",
            ],
            "name": "test-deployment-deployment-resources",
            "properties": {
              "deployment": {
                "accountId": "",
                "envPaths": {
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                },
                "name": "test-deployment",
                "region": "us-west-2",
                "stateTable": "test-deployment-state",
                "version": "0.0.1",
              },
            },
            "resourceType": "WharfieDeploymentResources",
            "resources": {
              "test-deployment": {
                "dependsOn": [],
                "name": "test-deployment",
                "properties": {
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
              "test-deployment-actor-policy": {
                "dependsOn": [
                  "test-deployment-resource-autoscaling-table",
                  "test-deployment-locations-autoscaling-table",
                  "test-deployment-semaphore-autoscaling-table",
                  "test-deployment-events-autoscaling-table",
                  "test-deployment-dependencies-autoscaling-table",
                ],
                "name": "test-deployment-actor-policy",
                "properties": {
                  "arn": "arn:aws:iam:::policy/test-deployment-actor-policy",
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                        "Action": "cloudwatch:*",
                        "Effect": "Allow",
                        "Resource": [
                          "*",
                        ],
                      },
                      {
                        "Action": "logs:*",
                        "Effect": "Allow",
                        "Resource": [
                          "*",
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
                          "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-resource",
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
              "test-deployment-dependencies-autoscaling-table": {
                "dependsOn": [],
                "name": "test-deployment-dependencies-autoscaling-table",
                "properties": {
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
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                  "maxReadCapacity": 50,
                  "maxWriteCapacity": 50,
                  "minReadCapacity": 1,
                  "minWriteCapacity": 1,
                  "provisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                  },
                  "tableName": "test-deployment-dependencies",
                },
                "resourceType": "AutoscalingTable",
                "resources": {
                  "test-deployment-dependencies": {
                    "dependsOn": [],
                    "name": "test-deployment-dependencies",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "provisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5,
                      },
                    },
                    "resourceType": "Table",
                    "status": "STABLE",
                  },
                  "test-deployment-dependencies-autoscaling-role": {
                    "dependsOn": [
                      "test-deployment-dependencies",
                    ],
                    "name": "test-deployment-dependencies-autoscaling-role",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:iam::123456789012:role/test-deployment-dependencies-autoscaling-role",
                      "assumeRolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": "sts:AssumeRole",
                            "Effect": "Allow",
                            "Principal": {
                              "Service": [
                                "application-autoscaling.amazonaws.com",
                              ],
                            },
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "Role for test-deployment-dependencies table autoscaling",
                      "rolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": [
                              "dynamodb:DescribeTable",
                              "dynamodb:UpdateTable",
                            ],
                            "Effect": "Allow",
                            "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-dependencies",
                          },
                          {
                            "Action": [
                              "cloudwatch:PutMetricAlarm",
                              "cloudwatch:DescribeAlarms",
                              "cloudwatch:GetMetricStatistics",
                              "cloudwatch:SetAlarmState",
                              "cloudwatch:DeleteAlarms",
                            ],
                            "Effect": "Allow",
                            "Resource": "*",
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                    },
                    "resourceType": "Role",
                    "status": "STABLE",
                  },
                  "test-deployment-dependencies-readAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-dependencies-readAutoscalingTarget",
                    ],
                    "name": "test-deployment-dependencies-readAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-dependencies",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-dependencies-readAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-dependencies-autoscaling-role",
                    ],
                    "name": "test-deployment-dependencies-readAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-dependencies",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-dependencies-autoscaling-role",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                  "test-deployment-dependencies-writeAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-dependencies-writeAutoscalingTarget",
                    ],
                    "name": "test-deployment-dependencies-writeAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-dependencies",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-dependencies-writeAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-dependencies-autoscaling-role",
                    ],
                    "name": "test-deployment-dependencies-writeAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-dependencies",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-dependencies-autoscaling-role",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                },
                "status": "STABLE",
              },
              "test-deployment-deployment-resources-log-resource": {
                "dependsOn": [
                  "test-deployment",
                  "test-deployment-deployment-resources-logging-resource-role",
                  "test-deployment-resource-autoscaling-table",
                  "test-deployment-locations-autoscaling-table",
                  "test-deployment-dependencies-autoscaling-table",
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": "us-west-2",
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "deploymentBucket": "test-deployment-bucket",
                  "description": "test-deployment-deployment-resources wharfie logs",
                  "inputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                  "inputLocation": "s3://test-deployment-bucket/logs/raw/",
                  "interval": 300,
                  "locationTable": "test-deployment-locations",
                  "numberOfBuckets": 0,
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
                  "projectName": "test-deployment",
                  "region": "us-west-2",
                  "resourceName": "logs",
                  "resourceTable": "test-deployment-resource",
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
                    "dependsOn": [
                      "test-deployment",
                      "test-deployment-deployment-resources-logging-resource-role",
                      "test-deployment-resource-autoscaling-table",
                      "test-deployment-locations-autoscaling-table",
                      "test-deployment-dependencies-autoscaling-table",
                      "test-deployment-bucket",
                    ],
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
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": "us-west-2",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "test-deployment-deployment-resources wharfie logs",
                      "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                      "location": "s3://test-deployment-bucket/logs/processed/",
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
                    "dependsOn": [
                      "test-deployment",
                      "test-deployment-deployment-resources-logging-resource-role",
                      "test-deployment-resource-autoscaling-table",
                      "test-deployment-locations-autoscaling-table",
                      "test-deployment-dependencies-autoscaling-table",
                      "test-deployment-bucket",
                    ],
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
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                    "dependsOn": [
                      "test-deployment",
                      "test-deployment-deployment-resources-logging-resource-role",
                      "test-deployment-resource-autoscaling-table",
                      "test-deployment-locations-autoscaling-table",
                      "test-deployment-dependencies-autoscaling-table",
                      "test-deployment-bucket",
                    ],
                    "name": "test-deployment-logs-location-record",
                    "properties": {
                      "data": {
                        "interval": 300,
                      },
                      "deployment": {
                        "accountId": "",
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": "us-west-2",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "keyName": "location",
                      "keyValue": "s3://test-deployment-bucket/logs/raw/",
                      "sortKeyName": "resource_id",
                      "sortKeyValue": "logs",
                      "tableName": "test-deployment-locations",
                    },
                    "resourceType": "TableRecord",
                    "status": "STABLE",
                  },
                  "test-deployment-logs-resource-record": {
                    "dependsOn": [
                      "test-deployment",
                      "test-deployment-deployment-resources-logging-resource-role",
                      "test-deployment-resource-autoscaling-table",
                      "test-deployment-locations-autoscaling-table",
                      "test-deployment-dependencies-autoscaling-table",
                      "test-deployment-bucket",
                    ],
                    "name": "test-deployment-logs-resource-record",
                    "properties": {
                      "data": {
                        "data": {
                          "athena_workgroup": "test-deployment-logs-workgroup",
                          "daemon_config": {
                            "Role": "arn:aws:iam::123456789012:role/test-deployment-deployment-resources-logging-resource-role",
                          },
                          "destination_properties": {
                            "arn": "arn:aws:glue:undefined:undefined:table/test-deployment/logs",
                            "catalogId": undefined,
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
                              "accountId": undefined,
                              "envPaths": {
                                "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                                "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                                "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                                "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                                "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                              },
                              "name": "test-deployment",
                              "region": undefined,
                              "stateTable": "test-deployment-state",
                              "version": "0.0.1",
                            },
                            "description": "test-deployment-deployment-resources wharfie logs",
                            "inputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                            "location": "s3://test-deployment-bucket/logs/processed/",
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
                            "region": undefined,
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
                          "region": undefined,
                          "source_properties": {
                            "arn": "arn:aws:glue:undefined:undefined:table/test-deployment/logs_raw",
                            "catalogId": undefined,
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
                              "accountId": undefined,
                              "envPaths": {
                                "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                                "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                                "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                                "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                                "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                              },
                              "name": "test-deployment",
                              "region": undefined,
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
                            "region": undefined,
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
                          "status": "CREATING",
                          "wharfie_version": "0.0.1",
                        },
                      },
                      "deployment": {
                        "accountId": "",
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": "us-west-2",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "keyName": "resource_id",
                      "keyValue": "logs",
                      "sortKeyName": "sort_key",
                      "sortKeyValue": "logs",
                      "tableName": "test-deployment-resource",
                    },
                    "resourceType": "TableRecord",
                    "status": "STABLE",
                  },
                  "test-deployment-logs-workgroup": {
                    "dependsOn": [
                      "test-deployment",
                      "test-deployment-deployment-resources-logging-resource-role",
                      "test-deployment-resource-autoscaling-table",
                      "test-deployment-locations-autoscaling-table",
                      "test-deployment-dependencies-autoscaling-table",
                      "test-deployment-bucket",
                    ],
                    "name": "test-deployment-logs-workgroup",
                    "properties": {
                      "deployment": {
                        "accountId": "",
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": "us-west-2",
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "test-deployment resource logs workgroup",
                      "outputLocation": "s3://test-deployment-bucket/logs/query_metadata/",
                    },
                    "resourceType": "AthenaWorkGroup",
                    "status": "STABLE",
                  },
                },
                "status": "STABLE",
              },
              "test-deployment-deployment-resources-logging-resource-role": {
                "dependsOn": [],
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
              "test-deployment-events-autoscaling-table": {
                "dependsOn": [],
                "name": "test-deployment-events-autoscaling-table",
                "properties": {
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
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                  "maxReadCapacity": 50,
                  "maxWriteCapacity": 50,
                  "minReadCapacity": 1,
                  "minWriteCapacity": 1,
                  "provisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                  },
                  "tableName": "test-deployment-events",
                  "timeToLiveSpecification": {
                    "AttributeName": "ttl",
                    "Enabled": true,
                  },
                },
                "resourceType": "AutoscalingTable",
                "resources": {
                  "test-deployment-events": {
                    "dependsOn": [],
                    "name": "test-deployment-events",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "provisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5,
                      },
                      "timeToLiveSpecification": {
                        "AttributeName": "ttl",
                        "Enabled": true,
                      },
                    },
                    "resourceType": "Table",
                    "status": "STABLE",
                  },
                  "test-deployment-events-autoscaling-role": {
                    "dependsOn": [
                      "test-deployment-events",
                    ],
                    "name": "test-deployment-events-autoscaling-role",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:iam::123456789012:role/test-deployment-events-autoscaling-role",
                      "assumeRolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": "sts:AssumeRole",
                            "Effect": "Allow",
                            "Principal": {
                              "Service": [
                                "application-autoscaling.amazonaws.com",
                              ],
                            },
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "Role for test-deployment-events table autoscaling",
                      "rolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": [
                              "dynamodb:DescribeTable",
                              "dynamodb:UpdateTable",
                            ],
                            "Effect": "Allow",
                            "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-events",
                          },
                          {
                            "Action": [
                              "cloudwatch:PutMetricAlarm",
                              "cloudwatch:DescribeAlarms",
                              "cloudwatch:GetMetricStatistics",
                              "cloudwatch:SetAlarmState",
                              "cloudwatch:DeleteAlarms",
                            ],
                            "Effect": "Allow",
                            "Resource": "*",
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                    },
                    "resourceType": "Role",
                    "status": "STABLE",
                  },
                  "test-deployment-events-readAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-events-readAutoscalingTarget",
                    ],
                    "name": "test-deployment-events-readAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-events",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-events-readAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-events-autoscaling-role",
                    ],
                    "name": "test-deployment-events-readAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-events",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-events-autoscaling-role",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                  "test-deployment-events-writeAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-events-writeAutoscalingTarget",
                    ],
                    "name": "test-deployment-events-writeAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-events",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-events-writeAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-events-autoscaling-role",
                    ],
                    "name": "test-deployment-events-writeAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-events",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-events-autoscaling-role",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                },
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
              "test-deployment-locations-autoscaling-table": {
                "dependsOn": [],
                "name": "test-deployment-locations-autoscaling-table",
                "properties": {
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
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                  "maxReadCapacity": 100,
                  "maxWriteCapacity": 50,
                  "minReadCapacity": 5,
                  "minWriteCapacity": 1,
                  "provisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                  },
                  "tableName": "test-deployment-locations",
                },
                "resourceType": "AutoscalingTable",
                "resources": {
                  "test-deployment-locations": {
                    "dependsOn": [],
                    "name": "test-deployment-locations",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "provisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5,
                      },
                    },
                    "resourceType": "Table",
                    "status": "STABLE",
                  },
                  "test-deployment-locations-autoscaling-role": {
                    "dependsOn": [
                      "test-deployment-locations",
                    ],
                    "name": "test-deployment-locations-autoscaling-role",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:iam::123456789012:role/test-deployment-locations-autoscaling-role",
                      "assumeRolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": "sts:AssumeRole",
                            "Effect": "Allow",
                            "Principal": {
                              "Service": [
                                "application-autoscaling.amazonaws.com",
                              ],
                            },
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "Role for test-deployment-locations table autoscaling",
                      "rolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": [
                              "dynamodb:DescribeTable",
                              "dynamodb:UpdateTable",
                            ],
                            "Effect": "Allow",
                            "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-locations",
                          },
                          {
                            "Action": [
                              "cloudwatch:PutMetricAlarm",
                              "cloudwatch:DescribeAlarms",
                              "cloudwatch:GetMetricStatistics",
                              "cloudwatch:SetAlarmState",
                              "cloudwatch:DeleteAlarms",
                            ],
                            "Effect": "Allow",
                            "Resource": "*",
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                    },
                    "resourceType": "Role",
                    "status": "STABLE",
                  },
                  "test-deployment-locations-readAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-locations-readAutoscalingTarget",
                    ],
                    "name": "test-deployment-locations-readAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-locations",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-locations-readAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-locations-autoscaling-role",
                    ],
                    "name": "test-deployment-locations-readAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 100,
                      "minCapacity": 5,
                      "resourceId": "table/test-deployment-locations",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-locations-autoscaling-role",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                  "test-deployment-locations-writeAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-locations-writeAutoscalingTarget",
                    ],
                    "name": "test-deployment-locations-writeAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-locations",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-locations-writeAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-locations-autoscaling-role",
                    ],
                    "name": "test-deployment-locations-writeAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-locations",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-locations-autoscaling-role",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                },
                "status": "STABLE",
              },
              "test-deployment-resource-autoscaling-table": {
                "dependsOn": [],
                "name": "test-deployment-resource-autoscaling-table",
                "properties": {
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
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                  "maxReadCapacity": 50,
                  "maxWriteCapacity": 50,
                  "minReadCapacity": 5,
                  "minWriteCapacity": 1,
                  "provisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                  },
                  "tableName": "test-deployment-resource",
                },
                "resourceType": "AutoscalingTable",
                "resources": {
                  "test-deployment-resource": {
                    "dependsOn": [],
                    "name": "test-deployment-resource",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-resource",
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
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
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
                      "provisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5,
                      },
                    },
                    "resourceType": "Table",
                    "status": "STABLE",
                  },
                  "test-deployment-resource-autoscaling-role": {
                    "dependsOn": [
                      "test-deployment-resource",
                    ],
                    "name": "test-deployment-resource-autoscaling-role",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:iam::123456789012:role/test-deployment-resource-autoscaling-role",
                      "assumeRolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": "sts:AssumeRole",
                            "Effect": "Allow",
                            "Principal": {
                              "Service": [
                                "application-autoscaling.amazonaws.com",
                              ],
                            },
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "Role for test-deployment-resource table autoscaling",
                      "rolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": [
                              "dynamodb:DescribeTable",
                              "dynamodb:UpdateTable",
                            ],
                            "Effect": "Allow",
                            "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-resource",
                          },
                          {
                            "Action": [
                              "cloudwatch:PutMetricAlarm",
                              "cloudwatch:DescribeAlarms",
                              "cloudwatch:GetMetricStatistics",
                              "cloudwatch:SetAlarmState",
                              "cloudwatch:DeleteAlarms",
                            ],
                            "Effect": "Allow",
                            "Resource": "*",
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                    },
                    "resourceType": "Role",
                    "status": "STABLE",
                  },
                  "test-deployment-resource-readAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-resource-readAutoscalingTarget",
                    ],
                    "name": "test-deployment-resource-readAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-resource",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-resource-readAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-resource-autoscaling-role",
                    ],
                    "name": "test-deployment-resource-readAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 5,
                      "resourceId": "table/test-deployment-resource",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-resource-autoscaling-role",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                  "test-deployment-resource-writeAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-resource-writeAutoscalingTarget",
                    ],
                    "name": "test-deployment-resource-writeAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-resource",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-resource-writeAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-resource-autoscaling-role",
                    ],
                    "name": "test-deployment-resource-writeAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-resource",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-resource-autoscaling-role",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                },
                "status": "STABLE",
              },
              "test-deployment-semaphore-autoscaling-table": {
                "dependsOn": [],
                "name": "test-deployment-semaphore-autoscaling-table",
                "properties": {
                  "attributeDefinitions": [
                    {
                      "AttributeName": "semaphore",
                      "AttributeType": "S",
                    },
                  ],
                  "deployment": {
                    "accountId": "",
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                  "maxReadCapacity": 50,
                  "maxWriteCapacity": 50,
                  "minReadCapacity": 1,
                  "minWriteCapacity": 1,
                  "provisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                  },
                  "tableName": "test-deployment-semaphore",
                },
                "resourceType": "AutoscalingTable",
                "resources": {
                  "test-deployment-semaphore": {
                    "dependsOn": [],
                    "name": "test-deployment-semaphore",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-semaphore",
                      "attributeDefinitions": [
                        {
                          "AttributeName": "semaphore",
                          "AttributeType": "S",
                        },
                      ],
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "keySchema": [
                        {
                          "AttributeName": "semaphore",
                          "KeyType": "HASH",
                        },
                      ],
                      "provisionedThroughput": {
                        "ReadCapacityUnits": 5,
                        "WriteCapacityUnits": 5,
                      },
                    },
                    "resourceType": "Table",
                    "status": "STABLE",
                  },
                  "test-deployment-semaphore-autoscaling-role": {
                    "dependsOn": [
                      "test-deployment-semaphore",
                    ],
                    "name": "test-deployment-semaphore-autoscaling-role",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "arn": "arn:aws:iam::123456789012:role/test-deployment-semaphore-autoscaling-role",
                      "assumeRolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": "sts:AssumeRole",
                            "Effect": "Allow",
                            "Principal": {
                              "Service": [
                                "application-autoscaling.amazonaws.com",
                              ],
                            },
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "description": "Role for test-deployment-semaphore table autoscaling",
                      "rolePolicyDocument": {
                        "Statement": [
                          {
                            "Action": [
                              "dynamodb:DescribeTable",
                              "dynamodb:UpdateTable",
                            ],
                            "Effect": "Allow",
                            "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-semaphore",
                          },
                          {
                            "Action": [
                              "cloudwatch:PutMetricAlarm",
                              "cloudwatch:DescribeAlarms",
                              "cloudwatch:GetMetricStatistics",
                              "cloudwatch:SetAlarmState",
                              "cloudwatch:DeleteAlarms",
                            ],
                            "Effect": "Allow",
                            "Resource": "*",
                          },
                        ],
                        "Version": "2012-10-17",
                      },
                    },
                    "resourceType": "Role",
                    "status": "STABLE",
                  },
                  "test-deployment-semaphore-readAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-semaphore-readAutoscalingTarget",
                    ],
                    "name": "test-deployment-semaphore-readAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-semaphore",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-semaphore-readAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-semaphore-autoscaling-role",
                    ],
                    "name": "test-deployment-semaphore-readAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-semaphore",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-semaphore-autoscaling-role",
                      "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                  "test-deployment-semaphore-writeAutoscalingPolicy": {
                    "dependsOn": [
                      "test-deployment-semaphore-writeAutoscalingTarget",
                    ],
                    "name": "test-deployment-semaphore-writeAutoscalingPolicy",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "policyType": "TargetTrackingScaling",
                      "resourceId": "table/test-deployment-semaphore",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                      "targetTrackingScalingPolicyConfiguration": {
                        "PredefinedMetricSpecification": {
                          "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                        },
                        "ScaleInCooldown": 0,
                        "ScaleOutCooldown": 0,
                        "TargetValue": 70,
                      },
                    },
                    "resourceType": "AutoscalingPolicy",
                    "status": "STABLE",
                  },
                  "test-deployment-semaphore-writeAutoscalingTarget": {
                    "dependsOn": [
                      "test-deployment-semaphore-autoscaling-role",
                    ],
                    "name": "test-deployment-semaphore-writeAutoscalingTarget",
                    "properties": {
                      "_INTERNAL_STATE_RESOURCE": undefined,
                      "deployment": {
                        "accountId": undefined,
                        "envPaths": {
                          "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                          "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                          "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                          "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                          "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                        },
                        "name": "test-deployment",
                        "region": undefined,
                        "stateTable": "test-deployment-state",
                        "version": "0.0.1",
                      },
                      "maxCapacity": 50,
                      "minCapacity": 1,
                      "resourceId": "table/test-deployment-semaphore",
                      "roleArn": "arn:aws:iam::123456789012:role/test-deployment-semaphore-autoscaling-role",
                      "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                      "serviceNamespace": "dynamodb",
                    },
                    "resourceType": "AutoscalingTarget",
                    "status": "STABLE",
                  },
                },
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
          "test-deployment-state-autoscaling-table": {
            "dependsOn": [],
            "name": "test-deployment-state-autoscaling-table",
            "properties": {
              "_INTERNAL_STATE_RESOURCE": true,
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
              "deployment": {
                "accountId": "",
                "envPaths": {
                  "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                  "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                  "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                  "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                  "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
              "maxReadCapacity": 50,
              "maxWriteCapacity": 50,
              "minReadCapacity": 1,
              "minWriteCapacity": 1,
              "provisionedThroughput": {
                "ReadCapacityUnits": 5,
                "WriteCapacityUnits": 5,
              },
              "tableName": "test-deployment-state",
            },
            "resourceType": "AutoscalingTable",
            "resources": {
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
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
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
                  "provisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                  },
                },
                "resourceType": "Table",
                "status": "STABLE",
              },
              "test-deployment-state-autoscaling-role": {
                "dependsOn": [
                  "test-deployment-state",
                ],
                "name": "test-deployment-state-autoscaling-role",
                "properties": {
                  "_INTERNAL_STATE_RESOURCE": true,
                  "arn": "arn:aws:iam::123456789012:role/test-deployment-state-autoscaling-role",
                  "assumeRolePolicyDocument": {
                    "Statement": [
                      {
                        "Action": "sts:AssumeRole",
                        "Effect": "Allow",
                        "Principal": {
                          "Service": [
                            "application-autoscaling.amazonaws.com",
                          ],
                        },
                      },
                    ],
                    "Version": "2012-10-17",
                  },
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "description": "Role for test-deployment-state table autoscaling",
                  "rolePolicyDocument": {
                    "Statement": [
                      {
                        "Action": [
                          "dynamodb:DescribeTable",
                          "dynamodb:UpdateTable",
                        ],
                        "Effect": "Allow",
                        "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/test-deployment-state",
                      },
                      {
                        "Action": [
                          "cloudwatch:PutMetricAlarm",
                          "cloudwatch:DescribeAlarms",
                          "cloudwatch:GetMetricStatistics",
                          "cloudwatch:SetAlarmState",
                          "cloudwatch:DeleteAlarms",
                        ],
                        "Effect": "Allow",
                        "Resource": "*",
                      },
                    ],
                    "Version": "2012-10-17",
                  },
                },
                "resourceType": "Role",
                "status": "STABLE",
              },
              "test-deployment-state-readAutoscalingPolicy": {
                "dependsOn": [
                  "test-deployment-state-readAutoscalingTarget",
                ],
                "name": "test-deployment-state-readAutoscalingPolicy",
                "properties": {
                  "_INTERNAL_STATE_RESOURCE": true,
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "policyType": "TargetTrackingScaling",
                  "resourceId": "table/test-deployment-state",
                  "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                  "serviceNamespace": "dynamodb",
                  "targetTrackingScalingPolicyConfiguration": {
                    "PredefinedMetricSpecification": {
                      "PredefinedMetricType": "DynamoDBReadCapacityUtilization",
                    },
                    "ScaleInCooldown": 0,
                    "ScaleOutCooldown": 0,
                    "TargetValue": 70,
                  },
                },
                "resourceType": "AutoscalingPolicy",
                "status": "STABLE",
              },
              "test-deployment-state-readAutoscalingTarget": {
                "dependsOn": [
                  "test-deployment-state-autoscaling-role",
                ],
                "name": "test-deployment-state-readAutoscalingTarget",
                "properties": {
                  "_INTERNAL_STATE_RESOURCE": true,
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "maxCapacity": 50,
                  "minCapacity": 1,
                  "resourceId": "table/test-deployment-state",
                  "roleArn": "arn:aws:iam::123456789012:role/test-deployment-state-autoscaling-role",
                  "scalableDimension": "dynamodb:table:ReadCapacityUnits",
                  "serviceNamespace": "dynamodb",
                },
                "resourceType": "AutoscalingTarget",
                "status": "STABLE",
              },
              "test-deployment-state-writeAutoscalingPolicy": {
                "dependsOn": [
                  "test-deployment-state-writeAutoscalingTarget",
                ],
                "name": "test-deployment-state-writeAutoscalingPolicy",
                "properties": {
                  "_INTERNAL_STATE_RESOURCE": true,
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "policyType": "TargetTrackingScaling",
                  "resourceId": "table/test-deployment-state",
                  "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                  "serviceNamespace": "dynamodb",
                  "targetTrackingScalingPolicyConfiguration": {
                    "PredefinedMetricSpecification": {
                      "PredefinedMetricType": "DynamoDBWriteCapacityUtilization",
                    },
                    "ScaleInCooldown": 0,
                    "ScaleOutCooldown": 0,
                    "TargetValue": 70,
                  },
                },
                "resourceType": "AutoscalingPolicy",
                "status": "STABLE",
              },
              "test-deployment-state-writeAutoscalingTarget": {
                "dependsOn": [
                  "test-deployment-state-autoscaling-role",
                ],
                "name": "test-deployment-state-writeAutoscalingTarget",
                "properties": {
                  "_INTERNAL_STATE_RESOURCE": true,
                  "deployment": {
                    "accountId": undefined,
                    "envPaths": {
                      "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
                      "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
                      "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
                      "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
                      "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
                    },
                    "name": "test-deployment",
                    "region": undefined,
                    "stateTable": "test-deployment-state",
                    "version": "0.0.1",
                  },
                  "maxCapacity": 50,
                  "minCapacity": 1,
                  "resourceId": "table/test-deployment-state",
                  "roleArn": "arn:aws:iam::123456789012:role/test-deployment-state-autoscaling-role",
                  "scalableDimension": "dynamodb:table:WriteCapacityUnits",
                  "serviceNamespace": "dynamodb",
                },
                "resourceType": "AutoscalingTarget",
                "status": "STABLE",
              },
            },
            "status": "STABLE",
          },
        },
        "status": "STABLE",
      }
    `);
    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "_INTERNAL_STATE_RESOURCE": true,
        "accountId": "",
        "deployment": {
          "accountId": "",
          "envPaths": {
            "cache": "/Users/Dev/Library/Caches/test-deployment-nodejs",
            "config": "/Users/Dev/Library/Preferences/test-deployment-nodejs",
            "data": "/Users/Dev/Library/Application Support/test-deployment-nodejs",
            "log": "/Users/Dev/Library/Logs/test-deployment-nodejs",
            "temp": "/var/folders/0y/_kvxgb354g14trwskq3xwpj00000gp/T/test-deployment-nodejs",
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
  }, 10000);
});
