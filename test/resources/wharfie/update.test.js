/* eslint-disable jest/no-hooks */
'use strict';

let lambda, location_db, resource_db, dependency_db;

const AWSCloudFormation = require('@aws-sdk/client-cloudformation');
const AWSSQS = require('@aws-sdk/client-sqs');
const AWSS3 = require('@aws-sdk/client-s3');
const update_event = require('../../fixtures/wharfie-update.json');

const nock = require('nock');

jest.useFakeTimers();
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../../../package.json', () => ({ version: '0.0.1' }));

process.env.WHARFIE_SERVICE_BUCKET = 'service-bucket';
process.env.WHARFIE_ARTIFACT_BUCKET = 'service-bucket';
process.env.AWS_REGION = 'us-east-1';
process.env.TEMPORARY_GLUE_DATABASE = 'temp_glue_database';

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

// eslint-disable-next-line jest/no-disabled-tests
describe.skip('tests for wharfie resource update handler', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });
  beforeEach(() => {
    location_db = require('../../../lambdas/lib/dynamo/location');
    resource_db = require('../../../lambdas/lib/dynamo/resource');
    dependency_db = require('../../../lambdas/lib/dynamo/dependency');
    jest.mock('../../../lambdas/lib/dynamo/location');
    jest.mock('../../../lambdas/lib/dynamo/resource');
    jest.spyOn(location_db, 'putLocation').mockImplementation();
    jest.spyOn(location_db, 'deleteLocation').mockImplementation();
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
    location_db.deleteLocation.mockClear();
    resource_db.putResource.mockClear();
    dependency_db.putDependency.mockClear();
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
      [
        {
          "athena_workgroup": "migrate-Wharfie-260ca406900a3f747e42cd69c3591fd9",
          "daemon_config": {
            "Mode": "REPLACE",
            "Role": "arn:aws:iam::123456789012:role/wharfie-staging",
          },
          "destination_properties": {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": {
              "Description": "Stack Mappings Table",
              "Name": "migrate_stack_mappings",
              "Parameters": {
                "EXTERNAL": "TRUE",
                "parquet.compress": "GZIP",
              },
              "PartitionKeys": [],
              "StorageDescriptor": {
                "Columns": [
                  {
                    "Name": "stack_name",
                    "Type": "string",
                  },
                  {
                    "Name": "logical_name",
                    "Type": "string",
                  },
                  {
                    "Name": "wharfie_id",
                    "Type": "string",
                  },
                ],
                "Compressed": true,
                "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                "Location": "s3://wharfie/staging/compacted/migrate-references/",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                "SerdeInfo": {
                  "Parameters": {
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
          "resource_status": "CREATING",
          "source_properties": {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": {
              "DatabaseName": "temp_glue_database",
              "Description": "Stack Mappings Table",
              "Name": "migrate_stack_mappings_raw",
              "Parameters": {
                "EXTERNAL": "true",
              },
              "PartitionKeys": [],
              "StorageDescriptor": {
                "Columns": [
                  {
                    "Name": "stack_name",
                    "Type": "string",
                  },
                  {
                    "Name": "logical_name",
                    "Type": "string",
                  },
                  {
                    "Name": "wharfie_id",
                    "Type": "string",
                  },
                ],
                "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                "Location": "",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                "SerdeInfo": {
                  "Parameters": {
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

    // eslint-disable-next-line jest/no-large-snapshots
    expect(resource_db.putResource.mock.calls[1]).toMatchInlineSnapshot(`
      [
        {
          "athena_workgroup": "Wharfie-260ca406900a3f747e42cd69c3591fd9",
          "daemon_config": {
            "Mode": "REPLACE",
            "Role": "arn:aws:iam::123456789012:role/wharfie-staging",
          },
          "destination_properties": {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": {
              "Description": "Stack Mappings Table",
              "Name": "stack_mappings",
              "Parameters": {
                "EXTERNAL": "TRUE",
                "parquet.compress": "GZIP",
              },
              "PartitionKeys": [],
              "StorageDescriptor": {
                "Columns": [
                  {
                    "Name": "stack_name",
                    "Type": "string",
                  },
                  {
                    "Name": "logical_name",
                    "Type": "string",
                  },
                  {
                    "Name": "wharfie_id",
                    "Type": "string",
                  },
                ],
                "Compressed": true,
                "InputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
                "Location": "s3://wharfie/staging/compacted/references/",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
                "SerdeInfo": {
                  "Parameters": {
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
          "resource_status": "UPDATING",
          "source_properties": {
            "CatalogId": "123456789012",
            "DatabaseName": "wharfie",
            "TableInput": {
              "Description": "Stack Mappings Table",
              "Name": "stack_mappings_raw",
              "Parameters": {
                "EXTERNAL": "true",
              },
              "PartitionKeys": [],
              "StorageDescriptor": {
                "Columns": [
                  {
                    "Name": "stack_name",
                    "Type": "string",
                  },
                  {
                    "Name": "logical_name",
                    "Type": "string",
                  },
                  {
                    "Name": "wharfie_id",
                    "Type": "string",
                  },
                ],
                "InputFormat": "org.apache.hadoop.mapred.TextInputFormat",
                "Location": "",
                "NumberOfBuckets": 0,
                "OutputFormat": "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
                "SerdeInfo": {
                  "Parameters": {
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
      {
        "Body": Readable {
          "_events": {
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
            "buffer": [],
            "bufferIndex": 0,
            "highWaterMark": 16,
            "length": 0,
            "pipes": [],
            Symbol(kState): 1052941,
          },
          Symbol(shapeMode): true,
          Symbol(kCapture): false,
        },
        "Bucket": "service-bucket",
        "ContentLength": 3555,
        "Key": "wharfie-templates/migrate-Wharfie-260ca406900a3f747e42cd69c3591fd9-i.json",
      }
    `);
    expect(
      AWSCloudFormation.CloudFormationMock.commandCalls(
        AWSCloudFormation.UpdateStackCommand
      )[0].args[0].input
    ).toMatchInlineSnapshot(`
      {
        "StackName": "Wharfie-260ca406900a3f747e42cd69c3591fd9",
        "Tags": [
          {
            "Key": "Team",
            "Value": "DataTools",
          },
          {
            "Key": "CostCategory",
            "Value": "rd",
          },
          {
            "Key": "ServiceOrganization",
            "Value": "Platform",
          },
          {
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
