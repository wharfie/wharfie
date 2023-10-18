'use strict';

const { handler } = require('../lambdas/bootstrap');
const CloudFormation = require('../lambdas/lib/cloudformation/');
const response = require('../lambdas/lib/cloudformation/cfn-response');
const resource_db = require('../lambdas/lib/dynamo/resource');
const sempahore_db = require('../lambdas/lib/dynamo/semaphore');
const location_db = require('../lambdas/lib/dynamo/location');
const event_db = require('../lambdas/lib/dynamo/event');
jest.mock('../lambdas/lib/cloudformation/');
jest.mock('../lambdas/lib/cloudformation/cfn-response');
jest.mock('../lambdas/lib/dynamo/resource');
jest.mock('../lambdas/lib/dynamo/semaphore');
jest.mock('../lambdas/lib/dynamo/location');
jest.mock('../lambdas/lib/dynamo/event');
jest.mock('../lambdas/lib/sqs');
jest.mock('../lambdas/lib/s3');
jest.mock('../lambdas/lib/sts');
jest.mock('../lambdas/lib/glue');
// eslint-disable-next-line jest/no-untyped-mock-factory
jest.mock('../package.json', () => ({ version: '0.0.1' }));

const mockMath = Object.create(global.Math);
mockMath.random = () => 0.5;
global.Math = mockMath;

const event = {
  ServiceToken:
    'arn:aws:lambda:us-east-1:123456789:function:wharfie-staging-bootstrap',
  ResponseURL:
    'https://cloudformation-custom-resource-response-useast1.s3.amazonaws.com/arn%3Aaws%3Acloudformation%3Aus-east-1%3A123456789123%3Astack/wharfie-staging-examples/b4563780-2468-11eb-b12f-12275bc6e1ef%7CCloudTrailExample%7C430b30dd-4b53-4543-a4b9-8d78c489c72d?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Date=20201111T215705Z&X-Amz-SignedHeaders=host&X-Amz-Expires=7200&X-Amz-Credential=AKIA6L7Q4OWT3SLPNLFO%2F20201111%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Signature=32e82e3c4665da7384e511d7ec1ed9f752a88bf1c64be905b4d635ec98b22d28',
  StackId:
    'arn:aws:cloudformation:us-east-1:123456789123:stack/wharfie-staging-examples/b4563780-2468-11eb-b12f-12275bc6e1ef',
  RequestId: '430b30dd-4b53-4543-a4b9-8d78c489c72d',
  LogicalResourceId: 'CloudTrailExample',
  PhysicalResourceId: '8d590e793ec04cc3fb22c24c5260eb17',
  ResourceType: 'Custom::Wharfie',
  ResourceProperties: {
    CompactedConfig: {
      Location: 's3://wharfie-staging-examples-bucket/CompactedCloudtrail/',
    },
    ServiceToken:
      'arn:aws:lambda:us-east-1:123456789123:function:wharfie-staging-bootstrap',
    TableInput: {
      Description: 'CloudTrail logs',
      Parameters: { EXTERNAL: 'true' },
      TableType: 'EXTERNAL_TABLE',
      StorageDescriptor: {
        InputFormat: 'com.amazon.emr.cloudtrail.CloudTrailInputFormat',
        OutputFormat:
          'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
        Columns: [
          { Type: 'string', Name: 'eventversion' },
          {
            Type: 'struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>',
            Name: 'useridentity',
          },
          { Type: 'string', Name: 'eventtime' },
          { Type: 'string', Name: 'eventsource' },
          { Type: 'string', Name: 'eventname' },
          { Type: 'string', Name: 'awsregion' },
          { Type: 'string', Name: 'sourceipaddress' },
          { Type: 'string', Name: 'useragent' },
          { Type: 'string', Name: 'errorcode' },
          { Type: 'string', Name: 'errormessage' },
          { Type: 'string', Name: 'requestparameters' },
          { Type: 'string', Name: 'responseelements' },
          { Type: 'string', Name: 'additionaleventdata' },
          { Type: 'string', Name: 'requestid' },
          { Type: 'string', Name: 'eventid' },
          {
            Type: 'array<struct<arn:string,accountid:string,type:string>>',
            Name: 'resources',
          },
          { Type: 'string', Name: 'eventtype' },
          { Type: 'string', Name: 'apiversion' },
          { Type: 'string', Name: 'readonly' },
          { Type: 'string', Name: 'recipientaccountid' },
          { Type: 'string', Name: 'serviceeventdetails' },
          { Type: 'string', Name: 'sharedeventid' },
          { Type: 'string', Name: 'vpcendpointid' },
        ],
        SerdeInfo: {
          SerializationLibrary: 'com.amazon.emr.hive.serde.CloudTrailSerde',
        },
        Location:
          's3://wharfie-restricted/cloudtrail/AWSLogs/123456789123/CloudTrail/',
      },
      PartitionKeys: [
        { Type: 'string', Name: 'region' },
        { Type: 'string', Name: 'year' },
        { Type: 'string', Name: 'month' },
        { Type: 'string', Name: 'day' },
      ],
      Name: 'cloudtrail',
    },
    DatabaseName: 'wharfie_staging_examples',
    CatalogId: '123456789123',
    DaemonConfig: {
      AlarmActions: [
        'arn:aws:sns:us-east-1:123456789123:on-call-production-us-east-1-data-tools',
      ],
      Role: 'arn:aws:iam::123456789123:role/wharfie-staging-examples-cloudtrail-role',
      Schedule: '1440',
      PrimaryKey: 'eventid',
      SLA: {
        MaxDelay: '4320',
        ColumnExpression: "date(concat(year, '-', month, '-', day))",
      },
    },
    Tags: [
      { Value: 'DataTools', Key: 'Team' },
      { Value: 'rd', Key: 'CostCategory' },
      { Value: 'Platform', Key: 'ServiceOrganization' },
      {
        Value: 'wharfie-staging-examples',
        Key: 'CloudFormationStackName',
      },
    ],
  },
};

describe('tests for bootstrap lambda', () => {
  it('delete', async () => {
    expect.assertions(7);
    response.mockImplementation(() => {});
    jest.spyOn(resource_db, 'deleteResource').mockImplementation();
    jest.spyOn(sempahore_db, 'deleteSemaphore').mockImplementation(() => {});
    jest.spyOn(location_db, 'deleteLocation').mockImplementation();
    jest.spyOn(event_db, 'delete_records').mockImplementation();
    const deleteStack = jest.fn().mockImplementation(() => {});
    CloudFormation.mockImplementation(() => {
      return {
        deleteStack,
      };
    });
    await handler({ ...event, RequestType: 'Delete' });

    expect(resource_db.deleteResource).toHaveBeenCalledTimes(1);
    expect(sempahore_db.deleteSemaphore).toHaveBeenCalledTimes(2);
    expect(location_db.deleteLocation).toHaveBeenCalledTimes(1);
    expect(event_db.delete_records).toHaveBeenCalledTimes(1);
    expect(deleteStack).toHaveBeenCalledTimes(1);
    expect(deleteStack.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "StackName": "Wharfie-b0390022d7e1bb56b328d44efb209e13",
        },
      ]
    `);
    expect(response).toHaveBeenCalledTimes(1);

    CloudFormation.mockClear();
    resource_db.deleteResource.mockClear();
    sempahore_db.deleteSemaphore.mockClear();
    location_db.deleteLocation.mockClear();
    event_db.delete_records.mockClear();
    response.mockClear();
  });
  it('create', async () => {
    expect.assertions(5);
    response.mockImplementation(() => {});
    jest.spyOn(resource_db, 'putResource').mockImplementation();
    jest.spyOn(location_db, 'putLocation').mockImplementation();
    const createStack = jest.fn().mockImplementation(() => {});
    CloudFormation.mockImplementation(() => {
      return {
        createStack,
      };
    });
    await handler({ ...event, RequestType: 'Create' });

    expect(resource_db.putResource).toHaveBeenCalledTimes(1);
    expect(location_db.putLocation).toHaveBeenCalledTimes(1);
    expect(createStack).toHaveBeenCalledTimes(1);
    expect(createStack.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "StackName": "Wharfie-b0390022d7e1bb56b328d44efb209e13",
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
              "Value": "wharfie-staging-examples",
            },
          ],
          "TemplateBody": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"DaemonConfig\\":{\\"AlarmActions\\":[\\"arn:aws:sns:us-east-1:123456789123:on-call-production-us-east-1-data-tools\\"],\\"Role\\":\\"arn:aws:iam::123456789123:role/wharfie-staging-examples-cloudtrail-role\\",\\"Schedule\\":1440,\\"PrimaryKey\\":\\"eventid\\",\\"SLA\\":{\\"MaxDelay\\":4320,\\"ColumnExpression\\":\\"date(concat(year, '-', month, '-', day))\\"},\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{\\"CreateDashboard\\":{\\"Type\\":\\"String\\",\\"Default\\":\\"true\\",\\"AllowedValues\\":[\\"true\\",\\"false\\"]}},\\"Mappings\\":{},\\"Conditions\\":{\\"createDashboard\\":{\\"Fn::Equals\\":[{\\"Ref\\":\\"CreateDashboard\\"},\\"true\\"]}},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"DataTools\\",\\"Key\\":\\"Team\\"},{\\"Value\\":\\"rd\\",\\"Key\\":\\"CostCategory\\"},{\\"Value\\":\\"Platform\\",\\"Key\\":\\"ServiceOrganization\\"},{\\"Value\\":\\"wharfie-staging-examples\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the CloudTrailExample Wharfie Resource in the wharfie-staging-examples stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Description\\":\\"CloudTrail logs\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"InputFormat\\":\\"com.amazon.emr.cloudtrail.CloudTrailInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"com.amazon.emr.hive.serde.CloudTrailSerde\\"},\\"Location\\":\\"s3://wharfie-restricted/cloudtrail/AWSLogs/123456789123/CloudTrail/\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"Name\\":\\"cloudtrail_raw\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Name\\":\\"cloudtrail\\",\\"Description\\":\\"CloudTrail logs\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"cloudtrail\\"}]},\\"State\\":\\"ENABLED\\",\\"ScheduleExpression\\":\\"cron(30 12 ? * 1/1 *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        },
      ]
    `);
    expect(response).toHaveBeenCalledTimes(1);

    CloudFormation.mockClear();
    resource_db.putResource.mockClear();
    location_db.putLocation.mockClear();
    response.mockClear();
  });
  it('update', async () => {
    expect.assertions(6);
    response.mockImplementation(() => {});
    jest.spyOn(resource_db, 'putResource').mockImplementation();
    jest.spyOn(location_db, 'putLocation').mockImplementation();
    const updateStack = jest.fn().mockImplementation(() => {});
    const createStack = jest.fn().mockImplementation(() => {});
    CloudFormation.mockImplementation(() => {
      return {
        updateStack,
        createStack,
      };
    });
    await handler({
      ...event,
      RequestType: 'Update',
      OldResourceProperties: event.ResourceProperties,
    });

    expect(resource_db.putResource).toHaveBeenCalledTimes(1);
    expect(location_db.putLocation).toHaveBeenCalledTimes(0);
    expect(createStack).toHaveBeenCalledTimes(0);
    expect(updateStack).toHaveBeenCalledTimes(1);
    expect(updateStack.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "StackName": "Wharfie-b0390022d7e1bb56b328d44efb209e13",
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
              "Value": "wharfie-staging-examples",
            },
          ],
          "TemplateBody": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"DaemonConfig\\":{\\"AlarmActions\\":[\\"arn:aws:sns:us-east-1:123456789123:on-call-production-us-east-1-data-tools\\"],\\"Role\\":\\"arn:aws:iam::123456789123:role/wharfie-staging-examples-cloudtrail-role\\",\\"Schedule\\":1440,\\"PrimaryKey\\":\\"eventid\\",\\"SLA\\":{\\"MaxDelay\\":4320,\\"ColumnExpression\\":\\"date(concat(year, '-', month, '-', day))\\"},\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{\\"CreateDashboard\\":{\\"Type\\":\\"String\\",\\"Default\\":\\"true\\",\\"AllowedValues\\":[\\"true\\",\\"false\\"]}},\\"Mappings\\":{},\\"Conditions\\":{\\"createDashboard\\":{\\"Fn::Equals\\":[{\\"Ref\\":\\"CreateDashboard\\"},\\"true\\"]}},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"DataTools\\",\\"Key\\":\\"Team\\"},{\\"Value\\":\\"rd\\",\\"Key\\":\\"CostCategory\\"},{\\"Value\\":\\"Platform\\",\\"Key\\":\\"ServiceOrganization\\"},{\\"Value\\":\\"wharfie-staging-examples\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the CloudTrailExample Wharfie Resource in the wharfie-staging-examples stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Description\\":\\"CloudTrail logs\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"InputFormat\\":\\"com.amazon.emr.cloudtrail.CloudTrailInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"com.amazon.emr.hive.serde.CloudTrailSerde\\"},\\"Location\\":\\"s3://wharfie-restricted/cloudtrail/AWSLogs/123456789123/CloudTrail/\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"Name\\":\\"cloudtrail_raw\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Name\\":\\"cloudtrail\\",\\"Description\\":\\"CloudTrail logs\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"cloudtrail\\"}]},\\"State\\":\\"ENABLED\\",\\"ScheduleExpression\\":\\"cron(30 12 ? * 1/1 *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        },
      ]
    `);
    expect(response).toHaveBeenCalledTimes(1);

    CloudFormation.mockClear();
    resource_db.putResource.mockClear();
    location_db.putLocation.mockClear();
    response.mockClear();
  });
  it('update migration', async () => {
    expect.assertions(7);
    response.mockImplementation(() => {});
    jest.spyOn(resource_db, 'putResource').mockImplementation();
    jest.spyOn(location_db, 'putLocation').mockImplementation();
    const updateStack = jest.fn().mockImplementation(() => {});
    const createStack = jest.fn().mockImplementation(() => {});
    CloudFormation.mockImplementation(() => {
      return {
        updateStack,
        createStack,
      };
    });
    await handler({
      ...event,
      RequestType: 'Update',
      OldResourceProperties: {},
    });

    expect(resource_db.putResource).toHaveBeenCalledTimes(2);
    expect(location_db.putLocation).toHaveBeenCalledTimes(1);
    expect(createStack).toHaveBeenCalledTimes(1);
    expect(updateStack).toHaveBeenCalledTimes(1);
    expect(createStack.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "StackName": "migrate-Wharfie-b0390022d7e1bb56b328d44efb209e13",
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
              "Value": "wharfie-staging-examples",
            },
          ],
          "TemplateBody": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"DaemonConfig\\":{\\"AlarmActions\\":[\\"arn:aws:sns:us-east-1:123456789123:on-call-production-us-east-1-data-tools\\"],\\"Role\\":\\"arn:aws:iam::123456789123:role/wharfie-staging-examples-cloudtrail-role\\",\\"Schedule\\":1440,\\"PrimaryKey\\":\\"eventid\\",\\"SLA\\":{\\"MaxDelay\\":4320,\\"ColumnExpression\\":\\"date(concat(year, '-', month, '-', day))\\"},\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{\\"CreateDashboard\\":{\\"Type\\":\\"String\\",\\"Default\\":\\"true\\",\\"AllowedValues\\":[\\"true\\",\\"false\\"]}},\\"Mappings\\":{},\\"Conditions\\":{\\"createDashboard\\":{\\"Fn::Equals\\":[{\\"Ref\\":\\"CreateDashboard\\"},\\"true\\"]}},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"DataTools\\",\\"Key\\":\\"Team\\"},{\\"Value\\":\\"rd\\",\\"Key\\":\\"CostCategory\\"},{\\"Value\\":\\"Platform\\",\\"Key\\":\\"ServiceOrganization\\"},{\\"Value\\":\\"wharfie-staging-examples\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the CloudTrailExample Wharfie Resource in the wharfie-staging-examples stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"migrate_wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Description\\":\\"CloudTrail logs\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"InputFormat\\":\\"com.amazon.emr.cloudtrail.CloudTrailInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"com.amazon.emr.hive.serde.CloudTrailSerde\\"},\\"Location\\":\\"s3://wharfie-restricted/cloudtrail/AWSLogs/123456789123/CloudTrail/\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"Name\\":\\"cloudtrail_raw\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"migrate_wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Name\\":\\"cloudtrail\\",\\"Description\\":\\"CloudTrail logs\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/migrate-references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"cloudtrail\\"}]},\\"State\\":\\"ENABLED\\",\\"ScheduleExpression\\":\\"cron(30 12 ? * 1/1 *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        },
      ]
    `);
    expect(updateStack.mock.calls[0]).toMatchInlineSnapshot(`
      Array [
        Object {
          "StackName": "Wharfie-b0390022d7e1bb56b328d44efb209e13",
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
              "Value": "wharfie-staging-examples",
            },
          ],
          "TemplateBody": "{\\"AWSTemplateFormatVersion\\":\\"2010-09-09\\",\\"Metadata\\":{\\"WharfieVersion\\":\\"0.0.1\\",\\"DaemonConfig\\":{\\"AlarmActions\\":[\\"arn:aws:sns:us-east-1:123456789123:on-call-production-us-east-1-data-tools\\"],\\"Role\\":\\"arn:aws:iam::123456789123:role/wharfie-staging-examples-cloudtrail-role\\",\\"Schedule\\":1440,\\"PrimaryKey\\":\\"eventid\\",\\"SLA\\":{\\"MaxDelay\\":4320,\\"ColumnExpression\\":\\"date(concat(year, '-', month, '-', day))\\"},\\"Mode\\":\\"REPLACE\\"}},\\"Parameters\\":{\\"CreateDashboard\\":{\\"Type\\":\\"String\\",\\"Default\\":\\"true\\",\\"AllowedValues\\":[\\"true\\",\\"false\\"]}},\\"Mappings\\":{},\\"Conditions\\":{\\"createDashboard\\":{\\"Fn::Equals\\":[{\\"Ref\\":\\"CreateDashboard\\"},\\"true\\"]}},\\"Resources\\":{\\"Workgroup\\":{\\"Type\\":\\"AWS::Athena::WorkGroup\\",\\"Properties\\":{\\"Tags\\":[{\\"Value\\":\\"DataTools\\",\\"Key\\":\\"Team\\"},{\\"Value\\":\\"rd\\",\\"Key\\":\\"CostCategory\\"},{\\"Value\\":\\"Platform\\",\\"Key\\":\\"ServiceOrganization\\"},{\\"Value\\":\\"wharfie-staging-examples\\",\\"Key\\":\\"CloudFormationStackName\\"}],\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":\\"Workgroup for the CloudTrailExample Wharfie Resource in the wharfie-staging-examples stack\\",\\"State\\":\\"ENABLED\\",\\"RecursiveDeleteOption\\":true,\\"WorkGroupConfiguration\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfiguration\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}},\\"WorkGroupConfigurationUpdates\\":{\\"EngineVersion\\":{\\"SelectedEngineVersion\\":\\"Athena engine version 3\\"},\\"PublishCloudWatchMetricsEnabled\\":true,\\"EnforceWorkGroupConfiguration\\":true,\\"ResultConfigurationUpdates\\":{\\"EncryptionConfiguration\\":{\\"EncryptionOption\\":\\"SSE_S3\\"},\\"OutputLocation\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/query_metadata/\\"}}}},\\"Source\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Description\\":\\"CloudTrail logs\\",\\"Parameters\\":{\\"EXTERNAL\\":\\"true\\"},\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"StorageDescriptor\\":{\\"InputFormat\\":\\"com.amazon.emr.cloudtrail.CloudTrailInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"com.amazon.emr.hive.serde.CloudTrailSerde\\"},\\"Location\\":\\"s3://wharfie-restricted/cloudtrail/AWSLogs/123456789123/CloudTrail/\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"Name\\":\\"cloudtrail_raw\\"}}},\\"Compacted\\":{\\"Type\\":\\"AWS::Glue::Table\\",\\"Properties\\":{\\"DatabaseName\\":\\"wharfie_staging_examples\\",\\"CatalogId\\":\\"123456789123\\",\\"TableInput\\":{\\"Name\\":\\"cloudtrail\\",\\"Description\\":\\"CloudTrail logs\\",\\"TableType\\":\\"EXTERNAL_TABLE\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\",\\"EXTERNAL\\":\\"TRUE\\"},\\"PartitionKeys\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"region\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"year\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"month\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"day\\"}],\\"StorageDescriptor\\":{\\"Location\\":\\"s3://wharfie-staging-examples-bucket/CompactedCloudtrail/references/\\",\\"Columns\\":[{\\"Type\\":\\"string\\",\\"Name\\":\\"eventversion\\"},{\\"Type\\":\\"struct<type:string,principalid:string,arn:string,accountid:string,invokedby:string,accesskeyid:string,username:string,sessioncontext:struct<attributes:struct<mfaauthenticated:string,creationdate:string>,sessionissuer:struct<type:string,principalid:string,arn:string,accountid:string,username:string>>>\\",\\"Name\\":\\"useridentity\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtime\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventsource\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventname\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"awsregion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sourceipaddress\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"useragent\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errorcode\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"errormessage\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestparameters\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"responseelements\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"additionaleventdata\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"requestid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventid\\"},{\\"Type\\":\\"array<struct<arn:string,accountid:string,type:string>>\\",\\"Name\\":\\"resources\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"eventtype\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"apiversion\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"readonly\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"recipientaccountid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"serviceeventdetails\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"sharedeventid\\"},{\\"Type\\":\\"string\\",\\"Name\\":\\"vpcendpointid\\"}],\\"InputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat\\",\\"OutputFormat\\":\\"org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat\\",\\"Compressed\\":true,\\"SerdeInfo\\":{\\"SerializationLibrary\\":\\"org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe\\",\\"Parameters\\":{\\"parquet.compress\\":\\"GZIP\\"}},\\"StoredAsSubDirectories\\":false,\\"NumberOfBuckets\\":0}}}},\\"Schedule\\":{\\"Type\\":\\"AWS::Events::Rule\\",\\"Properties\\":{\\"Name\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"Description\\":{\\"Fn::Sub\\":[\\"Schedule for \${table} in \${AWS::StackName} stack maintained by \${stack}\\",{\\"table\\":\\"cloudtrail\\"}]},\\"State\\":\\"ENABLED\\",\\"ScheduleExpression\\":\\"cron(30 12 ? * 1/1 *)\\",\\"Targets\\":[{\\"Id\\":{\\"Fn::Sub\\":[\\"\${AWS::StackName}\\",{}]},\\"InputTransformer\\":{\\"InputPathsMap\\":{\\"time\\":\\"$.time\\"},\\"InputTemplate\\":{\\"Fn::Sub\\":[\\"{\\\\\\"operation_started_at\\\\\\":<time>, \\\\\\"operation_type\\\\\\":\\\\\\"MAINTAIN\\\\\\", \\\\\\"action_type\\\\\\":\\\\\\"START\\\\\\", \\\\\\"resource_id\\\\\\":\\\\\\"\${AWS::StackName}\\\\\\"}\\",{}]}}}]}}},\\"Outputs\\":{}}",
        },
      ]
    `);
    expect(response).toHaveBeenCalledTimes(0);

    CloudFormation.mockClear();
    resource_db.putResource.mockClear();
    location_db.putLocation.mockClear();
    response.mockClear();
  });
});
