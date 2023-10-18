'use strict';

const wharfie = require('../../../client');

const WharfieLogRole = new wharfie.Role({
  LogicalName: 'WharfieLogRole',
  DependsOn: ['WharfieManagedPolicy', 'WharfieRole'],
  _WharfieRole: wharfie.util.getAtt('WharfieRole', 'Arn'),
  _WharfieBasePolicy: wharfie.util.ref('WharfieManagedPolicy'),
  WharfieDeployment: wharfie.util.sub('${AWS::StackName}'),
  InputLocations: [
    wharfie.util.join('', [
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/event_logs/',
    ]),
    wharfie.util.join('', [
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/daemon_logs/',
    ]),
    wharfie.util.join('', [
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/aws_sdk_logs/',
    ]),
  ],
  OutputLocations: [
    wharfie.util.join('', [
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/event_logs_compacted/',
    ]),
    wharfie.util.join('', [
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/daemon_logs_compacted/',
    ]),
    wharfie.util.join('', [
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/aws_sdk_logs_compacted/',
    ]),
  ],
});

const WharfieEventLogTable = new wharfie.Resource({
  LogicalName: 'WharfieEventLogTable',
  DatabaseName: wharfie.util.ref('LogDatabase'),
  WharfieDeployment: wharfie.util.sub('${AWS::StackName}'),
  _ServiceToken: wharfie.util.getAtt('Bootstrap', 'Arn'),
  _TableInputOverride: {
    Name: 'event_logs',
    Description:
      'event logs from wharfie.  This table is managed by wharfie and should not be modified directly.',
    TableType: 'EXTERNAL_TABLE',
    Parameters: { EXTERNAL: 'TRUE', has_encrypted_data: 'false' },
    PartitionKeys: [
      { Name: 'dt', Type: 'string' },
      { Name: 'hr', Type: 'string' },
    ],
    StorageDescriptor: {
      Location: wharfie.util.join('', [
        's3://',
        wharfie.util.sub('${Bucket}'),
        '/',
        wharfie.util.sub('${AWS::StackName}'),
        '/event_logs/',
      ]),
      Columns: [
        { Name: 'action_id', Type: 'string' },
        { Name: 'action_type', Type: 'string' },
        { Name: 'level', Type: 'string' },
        { Name: 'message', Type: 'string' },
        { Name: 'operation_id', Type: 'string' },
        { Name: 'operation_type', Type: 'string' },
        { Name: 'request_id', Type: 'string' },
        { Name: 'resource_id', Type: 'string' },
        { Name: 'service', Type: 'string' },
        { Name: 'version', Type: 'string' },
        { Name: 'timestamp', Type: 'string' },
      ],
      InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
      OutputFormat: 'org.apache.hadoop.hive.ql.io.IgnoreKeyTextOutputFormat',
      SerdeInfo: {
        SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
        Parameters: { 'ignore.malformed.json': 'true' },
      },
    },
  },
  CompactedConfig: {
    Location: wharfie.util.join('', [
      's3://',
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/event_logs_compacted/',
    ]),
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieLogRole', 'Arn'),
    Interval: 60,
    SLA: {
      MaxDelay: 60,
      ColumnExpression: `date_parse(concat(dt, hr), '%Y-%m-%d%H')`,
    },
  },
});

const WharfieDaemonLogTable = new wharfie.Resource({
  LogicalName: 'WharfieDaemonLogTable',
  DatabaseName: wharfie.util.ref('LogDatabase'),
  WharfieDeployment: wharfie.util.sub('${AWS::StackName}'),
  _ServiceToken: wharfie.util.getAtt('Bootstrap', 'Arn'),
  _TableInputOverride: {
    Name: 'daemon_logs',
    Description:
      'daemon logs from wharfie.  This table is managed by wharfie and should not be modified directly.',
    TableType: 'EXTERNAL_TABLE',
    Parameters: { EXTERNAL: 'TRUE', has_encrypted_data: 'false' },
    PartitionKeys: [
      { Name: 'dt', Type: 'string' },
      { Name: 'hr', Type: 'string' },
      { Name: 'lambda', Type: 'string' },
    ],
    StorageDescriptor: {
      Location: wharfie.util.join('', [
        's3://',
        wharfie.util.sub('${Bucket}'),
        '/',
        wharfie.util.sub('${AWS::StackName}'),
        '/daemon_logs/',
      ]),
      Columns: [
        { Name: 'level', Type: 'string' },
        { Name: 'message', Type: 'string' },
        { Name: 'service', Type: 'string' },
        { Name: 'version', Type: 'string' },
        { Name: 'timestamp', Type: 'string' },
      ],
      InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
      OutputFormat: 'org.apache.hadoop.hive.ql.io.IgnoreKeyTextOutputFormat',
      SerdeInfo: {
        SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
        Parameters: { 'ignore.malformed.json': 'true' },
      },
    },
  },
  CompactedConfig: {
    Location: wharfie.util.join('', [
      's3://',
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/daemon_logs_compacted/',
    ]),
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieLogRole', 'Arn'),
    Interval: 60,
    SLA: {
      MaxDelay: 60,
      ColumnExpression: `date_parse(concat(dt, hr), '%Y-%m-%d%H')`,
    },
  },
});

const WharfieAWSSDKLogTable = new wharfie.Resource({
  LogicalName: 'WharfieAWSSDKLogTable',
  DatabaseName: wharfie.util.ref('LogDatabase'),
  WharfieDeployment: wharfie.util.sub('${AWS::StackName}'),
  _ServiceToken: wharfie.util.getAtt('Bootstrap', 'Arn'),
  _TableInputOverride: {
    Name: 'aws_sdk_logs',
    Description:
      'aws_sdk logs from wharfie.  This table is managed by wharfie and should not be modified directly.',
    TableType: 'EXTERNAL_TABLE',
    Parameters: { EXTERNAL: 'TRUE', has_encrypted_data: 'false' },
    PartitionKeys: [
      { Name: 'dt', Type: 'string' },
      { Name: 'hr', Type: 'string' },
      { Name: 'lambda', Type: 'string' },
    ],
    StorageDescriptor: {
      Location: wharfie.util.join('', [
        's3://',
        wharfie.util.sub('${Bucket}'),
        '/',
        wharfie.util.sub('${AWS::StackName}'),
        '/aws_sdk_logs/',
      ]),
      Columns: [
        { Name: 'clientName', Type: 'string' },
        { Name: 'commandName', Type: 'string' },
        { Name: 'input', Type: 'string' },
        {
          Name: 'error',
          Type: 'struct<name:string,$fault:string,$metadata:struct<httpStatusCode:int,requestId:string,extendedRequestId:string,attempts:int,totalRetryDelay:int>,Code:string,Key:string,RequestId:string,HostId:string,message:string>',
        },
        {
          Name: 'timestamp',
          Type: 'struct<httpStatusCode:int,requestId:string,extendedRequestId:string,attempts:int,totalRetryDelay:int>',
        },
      ],
      InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
      OutputFormat: 'org.apache.hadoop.hive.ql.io.IgnoreKeyTextOutputFormat',
      SerdeInfo: {
        SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
        Parameters: { 'ignore.malformed.json': 'true' },
      },
    },
  },
  CompactedConfig: {
    Location: wharfie.util.join('', [
      's3://',
      wharfie.util.sub('${Bucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/aws_sdk_logs_compacted/',
    ]),
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieLogRole', 'Arn'),
    Interval: 60,
    SLA: {
      MaxDelay: 60,
      ColumnExpression: `date_parse(concat(dt, hr), '%Y-%m-%d%H')`,
    },
  },
});

const Resources = {
  LogDatabase: {
    Type: 'AWS::Glue::Database',
    Properties: {
      CatalogId: wharfie.util.accountId,
      DatabaseInput: {
        Name: wharfie.util.join(
          '_',
          wharfie.util.split('-', wharfie.util.sub('${AWS::StackName}-logs'))
        ),
      },
    },
  },
};

module.exports = wharfie.util.merge(
  { Resources },
  WharfieEventLogTable,
  WharfieDaemonLogTable,
  WharfieAWSSDKLogTable,
  WharfieLogRole
);
