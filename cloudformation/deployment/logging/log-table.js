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
      wharfie.util.sub('${ArtifactBucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}'),
      '/',
    ]),
  ],
  OutputLocations: [
    wharfie.util.join('', [
      wharfie.util.sub('${ArtifactBucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}-logs'),
      '/',
    ]),
  ],
});

const WharfieLogTable = new wharfie.Resource({
  LogicalName: 'WharfieLogTable',
  DatabaseName: wharfie.util.ref('LogDatabase'),
  WharfieDeployment: wharfie.util.sub('${AWS::StackName}'),
  _ServiceToken: wharfie.util.getAtt('Bootstrap', 'Arn'),
  _TableInputOverride: {
    Name: 'event_log',
    Description:
      'event logs from wharfie.  This table is managed by wharfie and should not be modified directly.',
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
        wharfie.util.sub('${ArtifactBucket}'),
        '/',
        wharfie.util.sub('${AWS::StackName}'),
        '/',
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
      wharfie.util.sub('${ArtifactBucket}'),
      '/',
      wharfie.util.sub('${AWS::StackName}-logs'),
      '/',
    ]),
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieLogRole', 'Arn'),
    Schedule: 60 * 24 * 3,
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
  WharfieLogTable,
  WharfieLogRole
);
