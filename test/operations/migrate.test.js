/* eslint-disable jest/no-hooks */
'use strict';
// process.env.LOGGING_LEVEL = 'debug';
const bluebird = require('bluebird');
const nock = require('nock');

process.env.AWS_MOCKS = true;
jest.requireMock('@aws-sdk/client-s3');
jest.requireMock('@aws-sdk/client-sns');
jest.requireMock('@aws-sdk/client-glue');
jest.requireMock('@aws-sdk/client-athena');
jest.requireMock('@aws-sdk/client-sqs');
jest.requireMock('@aws-sdk/client-sts');
jest.requireMock('@aws-sdk/client-cloudwatch');
jest.requireMock('@aws-sdk/client-cloudformation');
const {
  createLambdaQueues,
  setLambdaTriggers,
  clearLambdaTriggers,
} = require('./util');

const { version } = require('../../package.json');
const daemon_lambda = require('../../lambdas/daemon');

jest.mock('../../lambdas/lib/dynamo/resource');
jest.mock('../../lambdas/lib/dynamo/event');
jest.mock('../../lambdas/lib/dynamo/location');
jest.mock('../../lambdas/lib/dynamo/semaphore');
jest.mock('../../lambdas/lib/dynamo/dependency');
jest.mock('../../lambdas/lib/logging');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../package.json', () => ({ version: '0.0.1' }));

const { Athena } = require('@aws-sdk/client-athena');
const { Glue } = require('@aws-sdk/client-glue');
const { SQS } = require('@aws-sdk/client-sqs');
const { S3 } = require('@aws-sdk/client-s3');
const { CloudFormation } = require('@aws-sdk/client-cloudformation');

const resource = require('../../lambdas/lib/dynamo/resource');
const logging = require('../../lambdas/lib/logging');

const dynamo_resource = require('../../lambdas/lib/dynamo/resource');
const semaphore = require('../../lambdas/lib/dynamo/semaphore');

const glue = new Glue();
const athena = new Athena();
const s3 = new S3();
const cloudformation = new CloudFormation();

const CONTEXT = {
  awsRequestId: 'test-request-id',
};

describe('migrate tests', () => {
  beforeAll(async () => {
    bluebird.Promise.config({ cancellation: true });
    s3.__setMockState({
      's3://test-bucket/raw/dt=2021-01-18/data.json': '',
      's3://test-bucket/raw/dt=2021-01-19/data.json': '',
      's3://test-bucket/raw/dt=2021-01-20/data.json': '',
      's3://test-bucket/raw/foo=2022-01-18/data.json': '',
      's3://test-bucket/raw/foo=2022-01-19/data.json': '',
      's3://test-bucket/raw/foo=2022-01-20/data.json': '',
    });
    await cloudformation.createStack({
      StackName: 'migrate-resource_id',
    });
    await athena.createWorkGroup({
      Name: 'Wharfie:StackName',
    });
    await athena.createWorkGroup({
      Name: 'migrate-Wharfie:StackName',
    });
    await glue.createDatabase({
      DatabaseInput: {
        Name: 'test_db',
      },
    });
    await glue.createDatabase({
      DatabaseInput: {
        Name: process.env.TEMPORARY_GLUE_DATABASE,
      },
    });
    await glue.createTable({
      DatabaseName: 'test_db',
      TableInput: {
        Name: 'table_name',
        PartitionKeys: [{ Name: 'dt', Type: 'string' }],
        StorageDescriptor: {
          Location: 's3://test-bucket/compacted/',
        },
      },
    });
    await glue.createTable({
      DatabaseName: 'test_db',
      TableInput: {
        Name: 'table_name_raw',
        PartitionKeys: [{ Name: 'dt', Type: 'string' }],
        StorageDescriptor: {
          Location: 's3://test-bucket/raw/',
        },
      },
    });
    await glue.batchCreatePartition({
      DatabaseName: 'test_db',
      TableName: 'table_name_raw',
      PartitionInputList: [
        {
          Values: ['2021-01-18'],
          StorageDescriptor: {
            Location: 's3://test-bucket/raw/dt=2021-01-18/',
          },
        },
        {
          Values: ['2021-01-19'],
          StorageDescriptor: {
            Location: 's3://test-bucket/raw/dt=2021-01-19/',
          },
        },
        {
          Values: ['2021-01-20'],
          StorageDescriptor: {
            Location: 's3://test-bucket/raw/dt=2021-01-20/',
          },
        },
      ],
    });

    await glue.createDatabase({
      DatabaseInput: {
        Name: 'migrate_test_db',
      },
    });
    await glue.createTable({
      DatabaseName: 'migrate_test_db',
      TableInput: {
        Name: 'table_name',
        PartitionKeys: [{ Name: 'foo', Type: 'string' }],
        StorageDescriptor: {
          Location: 's3://test-bucket/migrate-compacted/',
        },
      },
    });
    await glue.createTable({
      DatabaseName: 'migrate_test_db',
      TableInput: {
        Name: 'table_name_raw',
        PartitionKeys: [{ Name: 'foo', Type: 'string' }],
        StorageDescriptor: {
          Location: 's3://test-bucket/raw/',
        },
      },
    });
    createLambdaQueues();
  });
  beforeEach(() => {
    setLambdaTriggers(CONTEXT);
  });

  afterEach(() => {
    clearLambdaTriggers();
    logging.flush();
  });

  it('end to end', async () => {
    expect.assertions(5);
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{"Status":"SUCCESS","StackId":"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf","RequestId":"6bb77cd5-bbcc-40d0-9902-66ac98eb4817","LogicalResourceId":"Something","PhysicalResourceId":"f468f16c65d74a87ef52c42b2907832c","Data":{},"NoEcho":false}"`
        );
        return '';
      });
    await resource.putResource({
      resource_id: 'resource_id',
      resource_arn: 'arn:aws:custom:us-east-1:123456789012:wharfie',
      athena_workgroup: 'Wharfie:StackName',
      daemon_config: {
        Role: 'test-role',
      },
      source_properties: {
        databaseName: 'test_db',
        name: 'table_name_raw',
        partitionKeys: [{ type: 'string', name: 'dt' }],
        location: 's3://test-bucket/raw/',
      },
      destination_properties: {
        databaseName: 'test_db',
        name: 'table_name',
        partitionKeys: [{ type: 'string', name: 'dt' }],
        location: 's3://test-bucket/compacted/',
      },
      wharfie_version: version,
    });

    await resource.putResource({
      resource_id: 'migrate-resource_id',
      resource_arn: 'arn:aws:custom:us-east-1:123456789012:wharfie',
      athena_workgroup: 'migrate-Wharfie:StackName',
      daemon_config: {
        Role: 'test-role',
      },
      source_properties: {
        databaseName: 'migrate_test_db',
        name: 'table_name_raw',
        partitionKeys: [{ type: 'string', name: 'dt' }],
        location: 's3://test-bucket/raw/',
      },
      destination_properties: {
        databaseName: 'migrate_test_db',
        name: 'table_name',
        partitionKeys: [{ type: 'string', name: 'dt' }],
        location: 's3://test-bucket/compacted/',
      },
      wharfie_version: version,
    });

    await daemon_lambda.handler(
      {
        Records: [
          {
            body: JSON.stringify({
              operation_type: 'MIGRATE',
              operation_started_at: '2016-06-20T12:08:10.000Z',
              action_type: 'START',
              resource_id: 'resource_id',
              action_inputs: {
                Version: `cli`,
                Duration: Infinity,
              },
              operation_inputs: {
                migration_resource: {
                  resource_id: 'migrate-resource_id',
                  resource_arn: 'arn:aws:custom:us-east-1:123456789012:wharfie',
                  athena_workgroup: 'migrate-Wharfie:StackName',
                  daemon_config: {
                    Role: 'test-role',
                  },
                  source_properties: {
                    databaseName: 'migrate_test_db',
                    name: 'table_name_raw',
                    partitionKeys: [{ type: 'string', name: 'foo' }],
                    location: 's3://test-bucket/raw/',
                  },
                  destination_properties: {
                    databaseName: 'migrate_test_db',
                    name: 'table_name',
                    partitionKeys: [{ type: 'string', name: 'foo' }],
                    location: 's3://test-bucket/compacted/',
                  },
                  wharfie_version: version,
                },
                cloudformation_event: {
                  RequestType: 'Update',
                  ServiceToken:
                    'arn:aws:lambda:us-east-1:123456789012:function:wharfie-staging-bootstrap',
                  ResponseURL:
                    'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/arn%3Aaws%3Acloudformation%3Aus-east-1%3A123456789012%3Astack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf%7CStackMappings%7C6bb77cd5-bbcc-40d0-9902-66ac98eb4817?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20210927T221309Z&X-Amz-SignedHeaders=host&X-Amz-Expires=7199&X-Amz-Credential=AKIA6L7Q4OWT7F4FZRHE%2F20210927%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=6b459ba50fa40b6447a8d99f019218dec5e5255ce2a961f6ede9128cbc5eebce',
                  StackId:
                    'arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf',
                  RequestId: '6bb77cd5-bbcc-40d0-9902-66ac98eb4817',
                  LogicalResourceId: 'Something',
                  PhysicalResourceId: '24ee32ff5aa9a2f6126123a536951620',
                  ResourceType: 'Custom::Wharfie',
                  ResourceProperties: {},
                  OldResourceProperties: {},
                },
              },
            }),
          },
        ],
      },
      CONTEXT
    );
    let pollInterval;
    let completed_checks = 0;
    const emptyQueues = new Promise((resolve) => {
      pollInterval = setInterval(() => {
        if (
          (SQS.__state.queues[process.env.DAEMON_QUEUE_URL] || []).length ===
            0 &&
          (SQS.__state.queues[process.env.MONITOR_QUEUE_URL] || []).length ===
            0 &&
          (SQS.__state.queues[process.env.EVENTS_QUEUE_URL] || []).length ===
            0 &&
          (SQS.__state.queues[process.env.CLEANUP_QUEUE_URL] || []).length === 0
        ) {
          completed_checks += 1;
          if (completed_checks >= 5) {
            clearInterval(pollInterval);
            resolve();
          }
        } else {
          completed_checks = 0;
        }
      }, 100);
    });
    const timeout = bluebird.Promise.delay(5000).then(() => {
      console.error('Timeout waiting for operation to complete');
    });
    await Promise.race([emptyQueues, timeout]);
    timeout.cancel();
    // eslint-disable-next-line jest/no-large-snapshots
    expect(dynamo_resource.__getMockState()).toMatchInlineSnapshot(`
      {
        "resource_id": {
          "resource_id": {
            "athena_workgroup": "Wharfie:StackName",
            "daemon_config": {
              "Role": "test-role",
            },
            "destination_properties": {
              "databaseName": "test_db",
              "location": "s3://test-bucket/compacted/",
              "name": "table_name",
              "partitionKeys": [
                {
                  "name": "dt",
                  "type": "string",
                },
              ],
            },
            "resource_arn": "arn:aws:custom:us-east-1:123456789012:wharfie",
            "resource_id": "resource_id",
            "source_properties": {
              "databaseName": "test_db",
              "location": "s3://test-bucket/raw/",
              "name": "table_name_raw",
              "partitionKeys": [
                {
                  "name": "dt",
                  "type": "string",
                },
              ],
            },
            "wharfie_version": "0.0.1",
          },
        },
      }
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      {
        "wharfie": {
          "limit": Infinity,
          "value": 0,
        },
        "wharfie:MIGRATE:resource_id": {
          "limit": Infinity,
          "value": 0,
        },
      }
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(Glue.__state.test_db).toMatchInlineSnapshot(`
      {
        "_tables": {
          "table_name": {
            "DatabaseName": "test_db",
            "Name": "table_name",
            "PartitionKeys": [
              {
                "Name": "dt",
                "Type": "string",
              },
            ],
            "StorageDescriptor": {
              "Location": "s3://test-bucket/compacted/",
            },
            "_partitions": {},
          },
          "table_name_raw": {
            "DatabaseName": "test_db",
            "Name": "table_name_raw",
            "PartitionKeys": [
              {
                "Name": "dt",
                "Type": "string",
              },
            ],
            "StorageDescriptor": {
              "Location": "s3://test-bucket/raw/",
            },
            "_partitions": {
              "2021-01-18": {
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2021-01-18/",
                },
                "Values": [
                  "2021-01-18",
                ],
              },
              "2021-01-19": {
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2021-01-19/",
                },
                "Values": [
                  "2021-01-19",
                ],
              },
              "2021-01-20": {
                "StorageDescriptor": {
                  "Location": "s3://test-bucket/raw/dt=2021-01-20/",
                },
                "Values": [
                  "2021-01-20",
                ],
              },
            },
          },
        },
      }
    `);
    // eslint-disable-next-line jest/no-large-snapshots
    expect(SQS.__state).toMatchInlineSnapshot(`
      {
        "queues": {
          "cleanup-queue": [],
          "daemon-queue": [],
          "events-queue": [],
          "monitor-queue": [],
        },
      }
    `);
  }, 10000);
});
