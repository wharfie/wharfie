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

const Columns = [
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
  { Name: 'log_type', Type: 'string' },
];

const LoggingFireHose = new wharfie.Firehose({
  LogicalName: 'Logging',
  DatabaseName: wharfie.util.ref('LogDatabase'),
  TableName: 'logs',
  Description: 'raw logs from wharfie',
  Columns,
  DestinationBucket: wharfie.util.ref('Bucket'),
  DestinationPrefix: 'logs/',
  FirehoseLoggingEnabled: true,
  WharfieDeployment: wharfie.util.sub('${AWS::StackName}'),
  BufferInterval: 60,
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
  LoggingFireHose,
  WharfieLogRole
);
