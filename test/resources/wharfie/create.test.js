/* eslint-disable jest/no-hooks */
'use strict';

let lambda, location_db, resource_db, dependency_db;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSSQS = require('@aws-sdk/client-sqs');
const AWSS3 = require('@aws-sdk/client-s3');
const create_event = require('../../fixtures/wharfie-create.json');

const nock = require('nock');

jest.useFakeTimers();
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.WHARFIE_ARTIFACT_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfie resource create handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    location_db = require('../../../lambdas/lib/dynamo/location');
    resource_db = require('../../../lambdas/lib/dynamo/resource');
    dependency_db = require('../../../lambdas/lib/dynamo/dependency');
    jest.mock('../../../lambdas/lib/dynamo/location');
    jest.mock('../../../lambdas/lib/dynamo/resource');
    jest.mock('../../../lambdas/lib/dynamo/dependency');
    jest.spyOn(location_db, 'putLocation').mockImplementation();
    jest.spyOn(resource_db, 'putResource').mockImplementation();
    jest.spyOn(dependency_db, 'putDependency').mockImplementation();
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({
      StackId: 'fake-id',
    });
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    location_db.putLocation.mockClear();
    resource_db.putResource.mockClear();
    dependency_db.putDependency.mockClear();
    AWSS3.S3Mock.reset();
    AWSSQS.SQSMock.reset();
    AWSCloudFormation.CloudFormationMock.reset();
    nock.cleanAll();
  });

  it('basic', async () => {
    expect.assertions(6);

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

    // eslint-disable-next-line jest/no-large-snapshots
    expect(resource_db.putResource.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "athena_workgroup": "Wharfie-6afd22c8fb977fe4b9df55ed495499f3",
          "daemon_config": Object {
            "AlarmActions": Array [
              "arn:aws:sns:us-east-1:123456789012:pagerduty-sns-topic",
            ],
            "Mode": "REPLACE",
            "Role": "arn:aws:iam::123456789012:role/wharfie-staging-stack-mappi-StackMappingsRole-1T9LQWOQNZ2E2",
          },
          "destination_properties": Object {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": Object {
              "Description": "Stack Mappings Table",
              "Name": "staging_stack_mappings",
              "Parameters": Object {
                "EXTERNAL": "TRUE",
                "parquet.compress": "GZIP",
              },
              "PartitionKeys": Array [],
              "StorageDescriptor": Object {
                "Columns": Array [
                  Object {
                    "Name": "stack_name",
                    "Type": "string",
                  },
                  Object {
                    "Name": "logical_name",
                    "Type": "string",
                  },
                  Object {
                    "Name": "wharfie_id",
                    "Type": "string",
                  },
                ],
                "Compressed": true,
                "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                "Location": "s3://wharfie/stack-mappings/staging/compacted/references/",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                "SerdeInfo": Object {
                  "Parameters": Object {
                    "parquet.compress": "GZIP",
                  },
                  "SerializationLibrary": "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
                },
                "StoredAsSubDirectories": false,
              },
              "TableType": "EXTERNAL_TABLE",
            },
          },
          "resource_arn": "arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging-stack-mappings/f59e6e30-1fe7-11ec-a665-1240661c4205",
          "resource_id": "Wharfie-6afd22c8fb977fe4b9df55ed495499f3",
          "source_properties": Object {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": Object {
              "Description": "Stack Mappings Table",
              "Name": "staging_stack_mappings_raw",
              "Parameters": Object {
                "EXTERNAL": "true",
              },
              "PartitionKeys": Array [],
              "StorageDescriptor": Object {
                "Columns": Array [
                  Object {
                    "Name": "stack_name",
                    "Type": "string",
                  },
                  Object {
                    "Name": "logical_name",
                    "Type": "string",
                  },
                  Object {
                    "Name": "wharfie_id",
                    "Type": "string",
                  },
                ],
                "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                "Location": "s3://wharfie/stack-mappings/staging/",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                "SerdeInfo": Object {
                  "Parameters": Object {
                    "ignore.malformed.json": "true",
                  },
                  "SerializationLibrary": "org.openx.data.jsonserde.JsonSerDe",
                },
                "StoredAsSubDirectories": true,
              },
              "TableType": "EXTERNAL_TABLE",
            },
          },
          "wharfie_version": "0.0.1",
        },
      ]
    `);
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
        "ContentLength": 3620,
        "Key": "wharfie-templates/Wharfie-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);

    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.CreateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "StackName": "Wharfie-6afd22c8fb977fe4b9df55ed495499f3",
        "Tags": Array [
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging-stack-mappings",
          },
        ],
        "TemplateURL": "https://service-bucket.s3.amazonaws.com/wharfie-templates/Wharfie-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
  });
});
