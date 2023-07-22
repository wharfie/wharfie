'use strict';

const wharfie = require('../client');
const s3BucketTemplate = require('./resources/lib/s3-bucket');

const TempFilesBucket = s3BucketTemplate.build({
  BucketName: wharfie.util.sub(
    '${AWS::StackName}-${AWS::AccountId}-${AWS::Region}-temp-files'
  ),
  LifecycleConfiguration: {
    Rules: [
      {
        Id: 'temp_files_expiration',
        ExpirationInDays: 1,
        Status: 'Enabled',
      },
      {
        Id: 'abort_incomplete_multipart_uploads',
        AbortIncompleteMultipartUpload: {
          DaysAfterInitiation: 1,
        },
        Status: 'Enabled',
      },
    ],
  },
});
const Dashboard = require('./resources/sla-dashboard');
const Dynamo = require('./resources/dynamo');
const Monitor = require('./resources/monitor');
const Bootstrap = require('./resources/bootstrap');
const Daemon = require('./resources/daemon');
const Cleanup = require('./resources/cleanup');
const Events = require('./resources/events');
const Role = require('./resources/iam/wharfie-role');
// const StackMappings = require('./resources/stack-mappings');

const Parameters = {
  GitSha: { Type: 'String' },
  SNSAlarmTopicARN: {
    Type: 'String',
    Description: 'SNS topic to send alarms to',
  },
  DaemonLoggingLevel: {
    Type: 'String',
    Description: 'Which logging level to use for daemon',
    AllowedValues: ['debug', 'info', 'warn', 'error'],
    Default: 'info',
  },
  ResourceLoggingLevel: {
    Type: 'String',
    Description: 'Which logging level to use for wharfie resources',
    AllowedValues: ['debug', 'info', 'warn', 'error'],
    Default: 'info',
  },
  GlobalQueryConcurrency: {
    Type: 'Number',
    Description: 'Global concurrency limit for athena queries',
    Default: 10,
  },
  ResourceQueryConcurrency: {
    Type: 'Number',
    Description: 'Athena query concurrency limit per wharfie resource',
    Default: 10,
  },
  MaxQueriesPerAction: {
    Type: 'Number',
    Description: 'Maximum number of queries that a single action can submit',
    Default: 10000,
  },
  IsDevelopment: {
    Type: 'Boolean',
    Description: 'Is this a development deployment?',
    Default: false,
  },
};

const Conditions = {
  UseNoOpSNSTopic: wharfie.util.equals(
    wharfie.util.ref('SNSAlarmTopicARN'),
    ''
  ),
  IsDevelopment: wharfie.util.equals(wharfie.util.ref('IsDevelopment'), true),
};

const Resources = {
  TemporaryDatabase: {
    Type: 'AWS::Glue::Database',
    Properties: {
      CatalogId: wharfie.util.accountId,
      DatabaseInput: {
        Name: wharfie.util.join(
          '_',
          wharfie.util.split(
            '-',
            wharfie.util.sub('${AWS::StackName}-temporary-store')
          )
        ),
      },
    },
  },
  NoOpSNSTopic: {
    Type: 'AWS::SNS::Topic',
    Properties: {
      TopicName: wharfie.util.sub('${AWS::StackName}-NoOpSNSTopic'),
    },
  },
};

module.exports = wharfie.util.merge(
  { Parameters, Conditions, Resources },
  Monitor,
  Daemon,
  Bootstrap,
  Cleanup,
  Role,
  Dynamo,
  TempFilesBucket,
  Events,
  Dashboard
  // StackMappings
);
