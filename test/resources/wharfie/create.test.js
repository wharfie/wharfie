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

process.env.TEMPLATE_BUCKET = 'template-bucket';
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
    const waitUntilStackCreateComplete = jest
      .spyOn(AWSCloudFormation, 'waitUntilStackCreateComplete')
      .mockResolvedValue({});

    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging-stack-mappings/f59e6e30-1fe7-11ec-a665-1240661c4205\\",\\"RequestId\\":\\"1065fa64-f86e-4894-a6a9-7faa2a2515c6\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"6afd22c8fb977fe4b9df55ed495499f3\\",\\"Data\\":{}}"`
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
          "wharfie_version": "0.0.0",
        },
      ]
    `);
    expect(AWSS3.S3Mock.commandCalls(AWSS3.PutObjectCommand)[0].args[0].input)
      .toMatchInlineSnapshot(`
      Object {
        "Body": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.0\\",\\"DaemonConfig\\":{\\"AlarmActions\\":[\\"arn:aws:sns:us-east-1:123456789012:pagerduty-sns-topic\\"],\\"Role\\":\\"arn:aws:iam::123456789012:role/wharfie-staging-stack-mappi-StackMappingsRole-1T9LQWOQNZ2E2\\",\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{},\\"Mappings\\":{},\\"Conditions\\":{},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"wharfie-staging-stack-mappings\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the StackMappings Wharfie Resource in the wharfie-staging-stack-mappings stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie/stack-mappings/staging/compacted/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie/stack-mappings/staging/compacted/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie\\",\\"CatalogId\\":\\"123456789012\\",\\"TableInput\\":{\\"Description\\":\\"Stack Mappings Table\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"StoredAsSubDirectories\\":true,\\"InputFormat\\":\\"org.apache.hadoop.mapred.TextInputFormat\\",\\"NumberOfBuckets\\":0,\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"stack_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"logical_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"wharfie_id\\"}],\\"SerdeInfo\\":{\\"Parameters\\":{\\"ignore.malformed.json\\":\\"true\\"},\\"SerializationLibrary\\":\\"org.openx.data.jsonserde.JsonSerDe\\"},\\"Location\\":\\"s3://wharfie/stack-mappings/staging/\\"},\\"PartitionKeys\\":[],\\"Name\\":\\"staging_stack_mappings_raw\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie\\",\\"CatalogId\\":\\"123456789012\\",\\"TableInput\\":{\\"Name\\":\\"staging_stack_mappings\\",\\"Description\\":\\"Stack Mappings Table\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie/stack-mappings/staging/compacted/references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"stack_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"logical_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"wharfie_id\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Dashboard\\":{\\"Type\\":\\"AWS::CloudWatch::Dashboard\\",\\"Properties\\":{\\"DashboardName\\":{\\"Fn::Sub\\":[\\"\${originalStack}_\${LogicalResourceId}\\",{\\"originalStack\\":\\"wharfie-staging-stack-mappings\\",\\"LogicalResourceId\\":\\"StackMappings\\"}]},\\"DashboardBody\\":{\\"Fn::Sub\\":[\\"{\\\\\\"widgets\\\\\\":[{\\\\\\"type\\\\\\":\\\\\\"log\\\\\\",\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":2,\\\\\\"width\\\\\\":24,\\\\\\"height\\\\\\":9,\\\\\\"properties\\\\\\":{\\\\\\"query\\\\\\":\\\\\\"SOURCE '/aws/lambda/\${WharfieStack}-daemon' | SOURCE '/aws/lambda/\${WharfieStack}-monitor' | fields @timestamp, message, operation_type, operation_id, resource_id\\\\\\\\n| filter resource_id = '\${AWS::StackName}'\\\\\\\\n| sort @timestamp desc\\\\\\\\n| limit 2000\\\\\\",\\\\\\"region\\\\\\":\\\\\\"\${Region}\\\\\\",\\\\\\"stacked\\\\\\":false,\\\\\\"title\\\\\\":\\\\\\"Operation Logs\\\\\\",\\\\\\"view\\\\\\":\\\\\\"table\\\\\\"}},{\\\\\\"type\\\\\\":\\\\\\"metric\\\\\\",\\\\\\"x\\\\\\":12,\\\\\\"y\\\\\\":11,\\\\\\"width\\\\\\":12,\\\\\\"height\\\\\\":9,\\\\\\"properties\\\\\\":{\\\\\\"metrics\\\\\\":[[\\\\\\"AWS/Athena\\\\\\",\\\\\\"ProcessedBytes\\\\\\",\\\\\\"WorkGroup\\\\\\",\\\\\\"\${AWS::StackName}\\\\\\",{\\\\\\"id\\\\\\":\\\\\\"m1\\\\\\"}]],\\\\\\"view\\\\\\":\\\\\\"timeSeries\\\\\\",\\\\\\"stacked\\\\\\":false,\\\\\\"region\\\\\\":\\\\\\"\${Region}\\\\\\",\\\\\\"stat\\\\\\":\\\\\\"Sum\\\\\\",\\\\\\"period\\\\\\":60,\\\\\\"title\\\\\\":\\\\\\"Data Scan\\\\\\"}},{\\\\\\"type\\\\\\":\\\\\\"metric\\\\\\",\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":20,\\\\\\"width\\\\\\":12,\\\\\\"height\\\\\\":9,\\\\\\"properties\\\\\\":{\\\\\\"metrics\\\\\\":[[{\\\\\\"expression\\\\\\":\\\\\\"SUM(SEARCH('{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform MetricName=\\\\\\\\\\\\\\"FAILED-queries\\\\\\\\\\\\\\" Stack=\\\\\\\\\\\\\\"\${WharfieStack}\\\\\\\\\\\\\\" WorkGroup=\\\\\\\\\\\\\\"\${AWS::StackName}\\\\\\\\\\\\\\"', 'SampleCount', 60))\\\\\\",\\\\\\"id\\\\\\":\\\\\\"e1\\\\\\",\\\\\\"label\\\\\\":\\\\\\"Failed Queries\\\\\\"}],[{\\\\\\"expression\\\\\\":\\\\\\"SUM(SEARCH('{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform MetricName=\\\\\\\\\\\\\\"CANCELLED-queries\\\\\\\\\\\\\\" Stack=\\\\\\\\\\\\\\"\${WharfieStack}\\\\\\\\\\\\\\" WorkGroup=\\\\\\\\\\\\\\"\${AWS::StackName}\\\\\\\\\\\\\\"', 'SampleCount', 60))\\\\\\",\\\\\\"id\\\\\\":\\\\\\"e2\\\\\\",\\\\\\"label\\\\\\":\\\\\\"Cancelled Queries\\\\\\"}]],\\\\\\"view\\\\\\":\\\\\\"timeSeries\\\\\\",\\\\\\"stacked\\\\\\":false,\\\\\\"region\\\\\\":\\\\\\"\${Region}\\\\\\",\\\\\\"stat\\\\\\":\\\\\\"Average\\\\\\",\\\\\\"period\\\\\\":300,\\\\\\"title\\\\\\":\\\\\\"Failed and Cancelled Queries\\\\\\"}},{\\\\\\"type\\\\\\":\\\\\\"metric\\\\\\",\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":11,\\\\\\"width\\\\\\":12,\\\\\\"height\\\\\\":9,\\\\\\"properties\\\\\\":{\\\\\\"metrics\\\\\\":[[{\\\\\\"expression\\\\\\":\\\\\\"SEARCH('{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform/ WorkGroup=\\\\\\\\\\\\\\"\${AWS::StackName}\\\\\\\\\\\\\\" Stack=\\\\\\\\\\\\\\"\${WharfieStack}\\\\\\\\\\\\\\" MetricName=\\\\\\\\\\\\\\"QUEUED-queries\\\\\\\\\\\\\\"', 'SampleCount', 60)\\\\\\",\\\\\\"id\\\\\\":\\\\\\"e2\\\\\\"}],[{\\\\\\"expression\\\\\\":\\\\\\"SEARCH('{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform/ WorkGroup=\\\\\\\\\\\\\\"\${AWS::StackName}\\\\\\\\\\\\\\" Stack=\\\\\\\\\\\\\\"\${WharfieStack}\\\\\\\\\\\\\\" MetricName=\\\\\\\\\\\\\\"RUNNING-queries\\\\\\\\\\\\\\"', 'SampleCount', 60)\\\\\\",\\\\\\"id\\\\\\":\\\\\\"e1\\\\\\"}]],\\\\\\"view\\\\\\":\\\\\\"timeSeries\\\\\\",\\\\\\"stacked\\\\\\":false,\\\\\\"region\\\\\\":\\\\\\"\${Region}\\\\\\",\\\\\\"stat\\\\\\":\\\\\\"Average\\\\\\",\\\\\\"period\\\\\\":300,\\\\\\"title\\\\\\":\\\\\\"Running and Queued Queries\\\\\\"}},{\\\\\\"type\\\\\\":\\\\\\"metric\\\\\\",\\\\\\"x\\\\\\":12,\\\\\\"y\\\\\\":20,\\\\\\"width\\\\\\":12,\\\\\\"height\\\\\\":9,\\\\\\"properties\\\\\\":{\\\\\\"metrics\\\\\\":[[{\\\\\\"expression\\\\\\":\\\\\\"SEARCH('{Wharfie,operation_type,resource,stack} Wharfie resource=\\\\\\\\\\\\\\"\${AWS::StackName}\\\\\\\\\\\\\\" stack=\\\\\\\\\\\\\\"\${WharfieStack}\\\\\\\\\\\\\\" MetricName=\\\\\\\\\\\\\\"operations\\\\\\\\\\\\\\"', 'Maximum', 60)\\\\\\",\\\\\\"id\\\\\\":\\\\\\"e2\\\\\\",\\\\\\"period\\\\\\":60}]],\\\\\\"view\\\\\\":\\\\\\"timeSeries\\\\\\",\\\\\\"stacked\\\\\\":false,\\\\\\"region\\\\\\":\\\\\\"\${Region}\\\\\\",\\\\\\"stat\\\\\\":\\\\\\"Maximum\\\\\\",\\\\\\"period\\\\\\":60,\\\\\\"title\\\\\\":\\\\\\"Operation Runtimes\\\\\\"}},{\\\\\\"type\\\\\\":\\\\\\"text\\\\\\",\\\\\\"x\\\\\\":0,\\\\\\"y\\\\\\":0,\\\\\\"width\\\\\\":24,\\\\\\"height\\\\\\":2,\\\\\\"properties\\\\\\":{\\\\\\"markdown\\\\\\":\\\\\\"\\\\\\\\n# Wharfie ID: \${AWS::StackName} for resource **StackMappings** in the **wharfie-staging-stack-mappings** stack\\\\\\\\n[//]: <> ({\\\\\\\\\\\\\\"WharfieVersion\\\\\\\\\\\\\\":\\\\\\\\\\\\\\"0.0.0\\\\\\\\\\\\\\",\\\\\\\\\\\\\\"DaemonConfig\\\\\\\\\\\\\\":{\\\\\\\\\\\\\\"AlarmActions\\\\\\\\\\\\\\":[\\\\\\\\\\\\\\"arn:aws:sns:us-east-1:123456789012:pagerduty-sns-topic\\\\\\\\\\\\\\"],\\\\\\\\\\\\\\"Role\\\\\\\\\\\\\\":\\\\\\\\\\\\\\"arn:aws:iam::123456789012:role/wharfie-staging-stack-mappi-StackMappingsRole-1T9LQWOQNZ2E2\\\\\\\\\\\\\\",\\\\\\\\\\\\\\"Mode\\\\\\\\\\\\\\":\\\\\\\\\\\\\\"REPLACE\\\\\\\\\\\\\\"}})\\\\\\"}}]}\\",{\\"WharfieStack\\":\\"\\",\\"Region\\":{\\"Ref\\":\\"AWS::Region\\"}}]}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"staging_stack_mappings\\"}]},\\"State\\":\\"DISABLED\\",\\"ScheduleExpression\\":\\"cron(* * ? * * *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        "Bucket": "template-bucket",
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
        "TemplateURL": "https://template-bucket.s3.amazonaws.com/wharfie-templates/Wharfie-6afd22c8fb977fe4b9df55ed495499f3-i.json",
      }
    `);
    expect(waitUntilStackCreateComplete).toHaveBeenCalledTimes(1);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
  });
});
