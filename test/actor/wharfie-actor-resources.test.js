/* eslint-disable jest/no-hooks */
/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
jest.mock('crypto');

const crypto = require('crypto');
const WharfieActorResources = require('../../lambdas/lib/actor/resources/wharfie-actor-resources');
const { Policy, Bucket } = require('../../lambdas/lib/actor/resources/aws');

const { deserialize } = require('../../lambdas/lib/actor/deserialize');
describe('wharfie actor resources IaC', () => {
  beforeAll(() => {
    const mockUpdate = jest.fn().mockReturnThis();
    const mockDigest = jest.fn().mockReturnValue('mockedHash');
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
    const bucket = new Bucket({
      name: 'test-bucket',
    });
    await bucket.reconcile();
    const sharedPolicy = new Policy({
      name: `shared-policy`,
      properties: {
        deployment: {
          name: 'test-deployment',
          accountId: '123456789012',
          region: 'us-east-1',
        },
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
        deployment: {
          name: 'test-deployment',
          accountId: '123456789012',
          region: 'us-east-1',
        },
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

    // remove uuid so snapshots pass
    const serialized_copy = Object.assign({}, serialized);
    delete serialized_copy.resources['test-actor-mapping'].properties.uuid;

    expect(serialized_copy).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-actor-resources",
        "properties": {
          "actorName": "test-actor",
          "actorSharedPolicyArn": "arn:aws:iam::123456789012:policy/shared-policy",
          "artifactBucket": "test-bucket",
          "deployment": {
            "accountId": "123456789012",
            "name": "test-deployment",
            "region": "us-east-1",
          },
          "environmentVariables": {
            "123": "456",
            "foo": "bar",
          },
          "handler": "./lambdas/monitor.handler",
        },
        "resourceType": "WharfieActorResources",
        "resources": {
          "test-actor-mapping": {
            "dependsOn": [
              "test-deployment-test-actor-function",
              "test-deployment-test-actor-queue",
            ],
            "name": "test-actor-mapping",
            "properties": {
              "batchSize": 1,
              "deployment": {
                "accountId": "123456789012",
                "name": "test-deployment",
                "region": "us-east-1",
              },
              "eventSourceArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-queue",
              "functionName": "test-deployment-test-actor-function",
              "maximumBatchingWindowInSeconds": 0,
            },
            "resourceType": "EventSourceMapping",
            "status": "STABLE",
          },
          "test-deployment-test-actor-build": {
            "dependsOn": [],
            "name": "test-deployment-test-actor-build",
            "properties": {
              "artifactBucket": "test-bucket",
              "artifactKey": "actor-artifacts/test-deployment-test-actor-build/mockedHash.zip",
              "deployment": {
                "accountId": "123456789012",
                "name": "test-deployment",
                "region": "us-east-1",
              },
              "functionCodeHash": "mockedHash",
              "handler": "./lambdas/monitor.handler",
            },
            "resourceType": "LambdaBuild",
            "status": "STABLE",
          },
          "test-deployment-test-actor-dlq": {
            "dependsOn": [],
            "name": "test-deployment-test-actor-dlq",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-dlq",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
                "name": "test-deployment",
                "region": "us-east-1",
              },
              "messageRetentionPeriod": "1209600",
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-test-actor-dlq",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment-test-actor-function": {
            "dependsOn": [
              "test-deployment-test-actor-role",
              "test-deployment-test-actor-dlq",
              "test-deployment-test-actor-queue",
              "test-deployment-test-actor-build",
            ],
            "name": "test-deployment-test-actor-function",
            "properties": {
              "architectures": [
                "arm64",
              ],
              "arn": "arn:aws:lambda:us-west-2:123456789012:function:test-deployment-test-actor-function",
              "code": {
                "S3Bucket": "test-bucket",
                "S3Key": "actor-artifacts/test-deployment-test-actor-build/mockedHash.zip",
              },
              "codeHash": "mockedHash",
              "deadLetterConfig": {
                "TargetArn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-dlq",
              },
              "deployment": {
                "accountId": "123456789012",
                "name": "test-deployment",
                "region": "us-east-1",
              },
              "description": "test-actor lambda",
              "environment": {
                "Variables": {
                  "123": "456",
                  "AWS_NODEJS_CONNECTION_REUSE_ENABLED": "1",
                  "DLQ_URL": "test-deployment-test-actor-dlq",
                  "NODE_OPTIONS": "--enable-source-maps",
                  "STACK_NAME": "test-deployment",
                  "foo": "bar",
                },
              },
              "ephemeralStorage": {
                "Size": 512,
              },
              "handler": "index.handler",
              "memorySize": 1024,
              "packageType": "Zip",
              "publish": true,
              "role": "arn:aws:iam::123456789012:role/test-deployment-test-actor-role",
              "runtime": "nodejs20.x",
              "timeout": 300,
            },
            "resourceType": "LambdaFunction",
            "status": "STABLE",
          },
          "test-deployment-test-actor-queue": {
            "dependsOn": [],
            "name": "test-deployment-test-actor-queue",
            "properties": {
              "arn": "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-queue",
              "delaySeconds": "0",
              "deployment": {
                "accountId": "123456789012",
                "name": "test-deployment",
                "region": "us-east-1",
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
                        "aws:SourceAccount": "123456789012",
                      },
                    },
                    "Effect": "Allow",
                    "Principal": {
                      "Service": "s3.amazonaws.com",
                    },
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-queue",
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
                    "Resource": "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-queue",
                    "Sid": "accept-s3-events",
                  },
                ],
                "Version": "2012-10-17",
              },
              "receiveMessageWaitTimeSeconds": "0",
              "url": "test-deployment-test-actor-queue",
              "visibilityTimeout": "300",
            },
            "resourceType": "Queue",
            "status": "STABLE",
          },
          "test-deployment-test-actor-role": {
            "dependsOn": [
              "test-deployment-test-actor-queue",
              "test-deployment-test-actor-dlq",
            ],
            "name": "test-deployment-test-actor-role",
            "properties": {
              "arn": "arn:aws:iam::123456789012:role/test-deployment-test-actor-role",
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
                "name": "test-deployment",
                "region": "us-east-1",
              },
              "description": "test-deployment actor test-actor role",
              "managedPolicyArns": [
                "arn:aws:iam::123456789012:policy/shared-policy",
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
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-queue",
                      "arn:aws:sqs:us-east-1:123456789012:test-deployment-test-actor-dlq",
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
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized.properties).toMatchInlineSnapshot(`
      {
        "actorName": "test-actor",
        "actorSharedPolicyArn": "arn:aws:iam::123456789012:policy/shared-policy",
        "artifactBucket": "test-bucket",
        "deployment": {
          "accountId": "123456789012",
          "name": "test-deployment",
          "region": "us-east-1",
        },
        "environmentVariables": {
          "123": "456",
          "foo": "bar",
        },
        "handler": "./lambdas/monitor.handler",
      }
    `);
    expect(deserialized.status).toBe('STABLE');
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
  });
});
