/* eslint-disable jest/no-large-snapshots */
'use strict';
const templateGenerator = require('../../../lambdas/resources/wharfie/lib/template-generator');

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

describe('tests for template-generator', () => {
  it('generate Wharfie template', async () => {
    expect.assertions(4);
    const template = templateGenerator.Wharfie({
      LogicalResourceId: 'Wharfie-test',
      StackId:
        'arn:partition:service:region:account-id:resource-type/resource-id',
      ResourceProperties: {
        Tags: [
          {
            Name: 'Team',
            Value: 'DataTools',
          },
        ],
        TableInput: {
          Name: 'test',
          Description: 'CloudTrail logs',
          TableType: 'EXTERNAL_TABLE',
          Parameters: { EXTERNAL: 'true' },
          PartitionKeys: [
            {
              Name: 'month',
              Type: 'string',
            },
            {
              Name: 'day',
              Type: 'string',
            },
          ],
          StorageDescriptor: {
            Location:
              's3://wharfie-logs/cloudtrail/AWSLogs/123456789123/CloudTrail/us-east-1/2020/',
            Columns: [
              {
                Name: 'eventid',
                Type: 'string',
              },
              {
                Name: 'column',
                Type: 'int',
              },
            ],
            InputFormat: 'com.amazon.emr.cloudtrail.CloudTrailInputFormat',
            OutputFormat:
              'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
            SerdeInfo: {
              SerializationLibrary: 'com.amazon.emr.hive.serde.CloudTrailSerde',
            },
          },
        },
        CatalogId: 'primary',
        DatabaseName: 'testDb',
        CompactedConfig: {
          Location: 's3://wharfie-logs/cloudtrail/compacted/',
        },
        DaemonConfig: { PrimaryKey: 'eventid', Schedule: 60, Role: 'somerole' },
      },
    });

    expect(template.Resources.Workgroup).toMatchInlineSnapshot(`
      Object {
        "Properties": Object {
          "Description": "Workgroup for the Wharfie-test Wharfie Resource in the resource-id stack",
          "Name": Object {
            "Fn::Sub": Array [
              "\${AWS::StackName}",
              Object {},
            ],
          },
          "RecursiveDeleteOption": true,
          "State": "ENABLED",
          "Tags": Array [
            Object {
              "Name": "Team",
              "Value": "DataTools",
            },
          ],
          "WorkGroupConfiguration": Object {
            "EnforceWorkGroupConfiguration": true,
            "EngineVersion": Object {
              "SelectedEngineVersion": "Athena engine version 3",
            },
            "PublishCloudWatchMetricsEnabled": true,
            "ResultConfiguration": Object {
              "EncryptionConfiguration": Object {
                "EncryptionOption": "SSE_S3",
              },
              "OutputLocation": "s3://wharfie-logs/cloudtrail/compacted/query_metadata/",
            },
          },
          "WorkGroupConfigurationUpdates": Object {
            "EnforceWorkGroupConfiguration": true,
            "EngineVersion": Object {
              "SelectedEngineVersion": "Athena engine version 3",
            },
            "PublishCloudWatchMetricsEnabled": true,
            "ResultConfigurationUpdates": Object {
              "EncryptionConfiguration": Object {
                "EncryptionOption": "SSE_S3",
              },
              "OutputLocation": "s3://wharfie-logs/cloudtrail/compacted/query_metadata/",
            },
          },
        },
        "Type": "AWS::Athena::WorkGroup",
      }
    `);
    expect(template.Resources.Source).toMatchInlineSnapshot(`
      Object {
        "Properties": Object {
          "CatalogId": "primary",
          "DatabaseName": "testDb",
          "TableInput": Object {
            "Description": "CloudTrail logs",
            "Name": "test_raw",
            "Parameters": Object {
              "EXTERNAL": "true",
            },
            "PartitionKeys": Array [
              Object {
                "Name": "month",
                "Type": "string",
              },
              Object {
                "Name": "day",
                "Type": "string",
              },
            ],
            "StorageDescriptor": Object {
              "Columns": Array [
                Object {
                  "Name": "eventid",
                  "Type": "string",
                },
                Object {
                  "Name": "column",
                  "Type": "int",
                },
              ],
              "InputFormat": "com.amazon.emr.cloudtrail.CloudTrailInputFormat",
              "Location": "s3://wharfie-logs/cloudtrail/AWSLogs/123456789123/CloudTrail/us-east-1/2020/",
              "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
              "SerdeInfo": Object {
                "SerializationLibrary": "com.amazon.emr.hive.serde.CloudTrailSerde",
              },
            },
            "TableType": "EXTERNAL_TABLE",
          },
        },
        "Type": "AWS::Glue::Table",
      }
    `);
    expect(template.Resources.Compacted).toMatchInlineSnapshot(`
      Object {
        "Properties": Object {
          "CatalogId": "primary",
          "DatabaseName": "testDb",
          "TableInput": Object {
            "Description": "CloudTrail logs",
            "Name": "test",
            "Parameters": Object {
              "EXTERNAL": "TRUE",
              "parquet.compress": "GZIP",
            },
            "PartitionKeys": Array [
              Object {
                "Name": "month",
                "Type": "string",
              },
              Object {
                "Name": "day",
                "Type": "string",
              },
            ],
            "StorageDescriptor": Object {
              "Columns": Array [
                Object {
                  "Name": "eventid",
                  "Type": "string",
                },
                Object {
                  "Name": "column",
                  "Type": "int",
                },
              ],
              "Compressed": true,
              "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
              "Location": "s3://wharfie-logs/cloudtrail/compacted/references/",
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
        "Type": "AWS::Glue::Table",
      }
    `);
    expect(template.Resources.Schedule).toMatchInlineSnapshot(`
      Object {
        "Properties": Object {
          "Description": Object {
            "Fn::Sub": Array [
              "Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}",
              Object {
                "stack": undefined,
                "table": "test",
              },
            ],
          },
          "Name": Object {
            "Fn::Sub": Array [
              "\${AWS::StackName}",
              Object {},
            ],
          },
          "RoleArn": undefined,
          "ScheduleExpression": "cron(30 1/1 ? * * *)",
          "State": "ENABLED",
          "Targets": Array [
            Object {
              "Arn": undefined,
              "Id": Object {
                "Fn::Sub": Array [
                  "\${AWS::StackName}",
                  Object {},
                ],
              },
              "InputTransformer": Object {
                "InputPathsMap": Object {
                  "time": "$.time",
                },
                "InputTemplate": Object {
                  "Fn::Sub": Array [
                    "{\\"operation_started_at\\":<time>, \\"operation_type\\":\\"MAINTAIN\\", \\"action_type\\":\\"START\\", \\"resource_id\\":\\"\${AWS::StackName}\\"}",
                    Object {},
                  ],
                },
              },
            },
          ],
        },
        "Type": "AWS::Events::Rule",
      }
    `);
  });
});
