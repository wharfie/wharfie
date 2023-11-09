/* eslint-disable jest/no-hooks */
'use strict';

let lambda, location_db, resource_db;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSSQS = require('@aws-sdk/client-sqs');
const AWSS3 = require('@aws-sdk/client-s3');
const create_event = require('../../fixtures/wharfie-create.json');

const nock = require('nock');

jest.useFakeTimers();
jest.createMockFromModule('graphlib');
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
    jest.mock('graphlib');
    location_db = require('../../../lambdas/lib/dynamo/location');
    resource_db = require('../../../lambdas/lib/dynamo/resource');
    jest.mock('../../../lambdas/lib/dynamo/location');
    jest.mock('../../../lambdas/lib/dynamo/resource');
    jest.spyOn(location_db, 'putLocation').mockImplementation();
    jest.spyOn(resource_db, 'putResource').mockImplementation();
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({
      StackId: 'fake-id',
    });
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    location_db.putLocation.mockClear();
    resource_db.putResource.mockClear();
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
        "Body": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"DaemonConfig\\":{\\"AlarmActions\\":[\\"arn:aws:sns:us-east-1:123456789012:pagerduty-sns-topic\\"],\\"Role\\":\\"arn:aws:iam::123456789012:role/wharfie-staging-stack-mappi-StackMappingsRole-1T9LQWOQNZ2E2\\",\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{\\"CreateDashboard\\":{\\"Type\\":\\"String\\",\\"Default\\":\\"true\\",\\"AllowedValues\\":[\\"true\\",\\"false\\"]}},\\"Mappings\\":{},\\"Conditions\\":{\\"createDashboard\\":{\\"Fn::Equals\\":[{\\"Ref\\":\\"CreateDashboard\\"},\\"true\\"]}},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"wharfie-staging-stack-mappings\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the StackMappings Wharfie Resource in the wharfie-staging-stack-mappings stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie/stack-mappings/staging/compacted/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie/stack-mappings/staging/compacted/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie\\",\\"CatalogId\\":\\"123456789012\\",\\"TableInput\\":{\\"Description\\":\\"Stack Mappings Table\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"StoredAsSubDirectories\\":true,\\"InputFormat\\":\\"org.apache.hadoop.mapred.TextInputFormat\\",\\"NumberOfBuckets\\":0,\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"stack_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"logical_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"wharfie_id\\"}],\\"SerdeInfo\\":{\\"Parameters\\":{\\"ignore.malformed.json\\":\\"true\\"},\\"SerializationLibrary\\":\\"org.openx.data.jsonserde.JsonSerDe\\"},\\"Location\\":\\"s3://wharfie/stack-mappings/staging/\\"},\\"PartitionKeys\\":[],\\"Name\\":\\"staging_stack_mappings_raw\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie\\",\\"CatalogId\\":\\"123456789012\\",\\"TableInput\\":{\\"Name\\":\\"staging_stack_mappings\\",\\"Description\\":\\"Stack Mappings Table\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie/stack-mappings/staging/compacted/references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"stack_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"logical_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"wharfie_id\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"staging_stack_mappings\\"}]},\\"State\\":\\"DISABLED\\",\\"ScheduleExpression\\":\\"cron(* * ? * * *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        "Bucket": "service-bucket",
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
