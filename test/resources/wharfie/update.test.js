/* eslint-disable jest/no-hooks */
'use strict';

let lambda, location_db, resource_db;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSSQS = require('@aws-sdk/client-sqs');
const AWSS3 = require('@aws-sdk/client-s3');
const update_event = require('../../fixtures/wharfie-update.json');

const nock = require('nock');

jest.useFakeTimers();
jest.createMockFromModule('graphlib');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for wharfie resource update handler', () => {
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
    jest.spyOn(location_db, 'deleteLocation').mockImplementation();
    jest.spyOn(resource_db, 'putResource').mockImplementation();
    AWSS3.S3Mock.on(AWSS3.PutObjectCommand).resolves({});
    AWSSQS.SQSMock.on(AWSSQS.SendMessageCommand).resolves({
      StackId: 'fake-id',
    });
    lambda = require('../../../lambdas/bootstrap');
  });

  afterEach(() => {
    location_db.putLocation.mockClear();
    location_db.deleteLocation.mockClear();
    resource_db.putResource.mockClear();
    AWSS3.S3Mock.reset();
    AWSSQS.SQSMock.reset();
    AWSCloudFormation.CloudFormationMock.reset();
    nock.cleanAll();
  });

  it('update location', async () => {
    expect.assertions(6);
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({});
    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.CreateStackCommand
    ).resolves({
      StackId: 'migrate-fake-id',
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    )
      .resolvesOnce({
        Stacks: [
          {
            StackStatus: 'CREATE_COMPLETE',
          },
        ],
      })
      .resolvesOnce({
        Stacks: [
          {
            StackStatus: 'UPDATE_COMPLETE',
          },
        ],
      });

    update_event.ResourceProperties.TableInput.StorageDescriptor.Location = '';
    await lambda.handler(update_event);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(location_db.putLocation).toHaveBeenCalledTimes(0);
    expect(location_db.deleteLocation).toHaveBeenCalledTimes(1);
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      2
    );
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.UpdateStackCommand,
      1
    );
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.CreateStackCommand,
      1
    );
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      2
    );
  });

  it('handle no update error', async () => {
    expect.assertions(2);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).rejects(new Error('No updates are to be performed.'));

    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"SUCCESS\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false}"`
        );
        return '';
      });
    await lambda.handler({
      ...update_event,
      OldResourceProperties: update_event.ResourceProperties,
    });

    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      1
    );
  });

  it('handle failure', async () => {
    expect.assertions(4);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    ).resolves({
      Stacks: [
        {
          StackStatus: 'ROLLBACK_COMPLETE',
        },
      ],
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStackEventsCommand
    ).resolves({
      StackEvents: [
        {
          ResourceStatus: 'UPDATE_FAILED',
          ResourceStatusReason: 'some error occured',
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
          `"{\\"Status\\":\\"FAILED\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false,\\"Reason\\":\\"Error: some error occured\\"}"`
        );
        return '';
      });
    await lambda.handler({
      ...update_event,
      OldResourceProperties: update_event.ResourceProperties,
    });

    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStackEventsCommand,
      1
    );
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      0
    );
    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      1
    );
  });

  it('basic', async () => {
    expect.assertions(6);

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.UpdateStackCommand
    ).resolves({
      StackId: 'stack_id',
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.CreateStackCommand
    ).resolves({
      StackId: 'migate_stack_id',
    });

    AWSCloudFormation.CloudFormationMock.on(
      AWSCloudFormation.DescribeStacksCommand
    )
      .resolvesOnce({
        Stacks: [
          {
            StackStatus: 'CREATE_COMPLETE',
          },
        ],
      })
      .resolvesOnce({
        Stacks: [
          {
            StackStatus: 'UPDATE_COMPLETE',
          },
        ],
      });

    update_event.OldResourceProperties.TableInput.StorageDescriptor.Location =
      '';
    nock(
      'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com'
    )
      .filteringPath(() => {
        return '/';
      })
      .put('/')
      .reply(200, (uri, body) => {
        expect(body).toMatchInlineSnapshot(
          `"{\\"Status\\":\\"FAILED\\",\\"StackId\\":\\"arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf\\",\\"RequestId\\":\\"6bb77cd5-bbcc-40d0-9902-66ac98eb4817\\",\\"LogicalResourceId\\":\\"StackMappings\\",\\"PhysicalResourceId\\":\\"260ca406900a3f747e42cd69c3591fd9\\",\\"Data\\":{},\\"NoEcho\\":false,\\"Reason\\":\\"TypeError: Cannot read properties of undefined (reading 'StackId')\\"}"`
        );
        return '';
      });
    await lambda.handler(update_event);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(resource_db.putResource.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "athena_workgroup": "migrate-Wharfie-260ca406900a3f747e42cd69c3591fd9",
          "daemon_config": Object {
            "Mode": "REPLACE",
            "Role": "arn:aws:iam::123456789012:role/wharfie-staging",
          },
          "destination_properties": Object {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": Object {
              "Description": "Stack Mappings Table",
              "Name": "stack_mappings",
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
                "Location": "s3://wharfie/staging/compacted/migrate-references/",
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
          "resource_arn": "arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf",
          "resource_id": "migrate-Wharfie-260ca406900a3f747e42cd69c3591fd9",
          "source_properties": Object {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": Object {
              "Description": "Stack Mappings Table",
              "Name": "stack_mappings_raw",
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
                "Location": "",
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
              "TableName": "migrate_undefined",
              "TableType": "EXTERNAL_TABLE",
            },
          },
          "wharfie_version": "0.0.1",
        },
      ]
    `);

    // eslint-disable-next-line jest/no-large-snapshots
    expect(resource_db.putResource.mock.calls[1]).toMatchInlineSnapshot(`
      Array [
        Object {
          "athena_workgroup": "Wharfie-260ca406900a3f747e42cd69c3591fd9",
          "daemon_config": Object {
            "Mode": "REPLACE",
            "Role": "arn:aws:iam::123456789012:role/wharfie-staging",
          },
          "destination_properties": Object {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": Object {
              "Description": "Stack Mappings Table",
              "Name": "stack_mappings",
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
                "Location": "s3://wharfie/staging/compacted/references/",
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
          "resource_arn": "arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-staging/3a62f040-5743-11eb-b528-0ebb325b25bf",
          "resource_id": "Wharfie-260ca406900a3f747e42cd69c3591fd9",
          "source_properties": Object {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": Object {
              "Description": "Stack Mappings Table",
              "Name": "stack_mappings_raw",
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
                "Location": "",
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
        "Body": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"DaemonConfig\\":{\\"Role\\":\\"arn:aws:iam::123456789012:role/wharfie-staging\\",\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{\\"CreateDashboard\\":{\\"Type\\":\\"String\\",\\"Default\\":\\"true\\",\\"AllowedValues\\":[\\"true\\",\\"false\\"]}},\\"Mappings\\":{},\\"Conditions\\":{\\"createDashboard\\":{\\"Fn::Equals\\":[{\\"Ref\\":\\"CreateDashboard\\"},\\"true\\"]}},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"DataTools\\",\\"Key\\":\\"Team\\"},{\\"Value\\":\\"rd\\",\\"Key\\":\\"CostCategory\\"},{\\"Value\\":\\"Platform\\",\\"Key\\":\\"ServiceOrganization\\"},{\\"Value\\":\\"wharfie-staging\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the StackMappings Wharfie Resource in the wharfie-staging stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie/staging/compacted/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie/staging/compacted/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie\\",\\"CatalogId\\":\\"123456789012\\",\\"TableInput\\":{\\"Description\\":\\"Stack Mappings Table\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"StoredAsSubDirectories\\":true,\\"InputFormat\\":\\"org.apache.hadoop.mapred.TextInputFormat\\",\\"NumberOfBuckets\\":0,\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"stack_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"logical_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"wharfie_id\\"}],\\"SerdeInfo\\":{\\"Parameters\\":{\\"ignore.malformed.json\\":\\"true\\"},\\"SerializationLibrary\\":\\"org.openx.data.jsonserde.JsonSerDe\\"},\\"Location\\":\\"\\"},\\"PartitionKeys\\":[],\\"Name\\":\\"stack_mappings_raw\\",\\"TableName\\":\\"migrate_undefined\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie\\",\\"CatalogId\\":\\"123456789012\\",\\"TableInput\\":{\\"Name\\":\\"stack_mappings\\",\\"Description\\":\\"Stack Mappings Table\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie/staging/compacted/migrate-references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"stack_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"logical_name\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"wharfie_id\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"stack_mappings\\"}]},\\"State\\":\\"DISABLED\\",\\"ScheduleExpression\\":\\"cron(* * ? * * *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        "Bucket": "service-bucket",
        "Key": "wharfie-templates/migrate-Wharfie-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.UpdateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      Object {
        "StackName": "Wharfie-260ca406900a3f747e42cd69c3591fd9",
        "Tags": Array [
          Object {
            "Key": "Team",
            "Value": "DataTools",
          },
          Object {
            "Key": "CostCategory",
            "Value": "rd",
          },
          Object {
            "Key": "ServiceOrganization",
            "Value": "Platform",
          },
          Object {
            "Key": "CloudFormationStackName",
            "Value": "wharfie-staging",
          },
        ],
        "TemplateURL": "https://service-bucket.s3.amazonaws.com/wharfie-templates/Wharfie-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);

    expect(AWSCloudFormation.CloudFormationMock).toHaveReceivedCommandTimes(
      AWSCloudFormation.DescribeStacksCommand,
      2
    );
    expect(AWSSQS.SQSMock).toHaveReceivedCommandTimes(
      AWSSQS.SendMessageCommand,
      2
    );
  });
});
