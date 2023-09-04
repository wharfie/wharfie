'use strict';

const wharfie = require('../../client');

const ServiceBucket = require('./resources/service-bucket');
const Dashboard = require('./resources/sla-dashboard');
const Dynamo = require('./resources/dynamo');
const Monitor = require('./resources/monitor');
const Bootstrap = require('./resources/bootstrap');
const Daemon = require('./resources/daemon');
const Cleanup = require('./resources/cleanup');
const Events = require('./resources/events');
const Role = require('./resources/iam/wharfie-role');

const LogResources = require('./logging/log-table');

const Parameters = {
  Version: { Type: 'String' },
  GitSha: { Type: 'String', Default: '' },
  SNSAlarmTopicARN: {
    Type: 'String',
    Description: 'SNS topic to send alarms to',
  },
  LoggingTransport: {
    Type: 'String',
    Description: 'Which logging transport to use',
    AllowedValues: ['S3', 'CLOUDWATCH'],
    Default: 'S3',
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
    Type: 'String',
    Description: 'Is this a development deployment?',
    Default: false,
  },
  ArtifactBucket: {
    Type: 'String',
    Description:
      'only needed for development, bucket where lambda artifacts are stored',
  },
};

const Conditions = {
  UseNoOpSNSTopic: wharfie.util.equals(
    wharfie.util.ref('SNSAlarmTopicARN'),
    ''
  ),
  IsDevelopment: wharfie.util.equals(wharfie.util.ref('IsDevelopment'), 'True'),
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
  Events,
  ServiceBucket,
  Dashboard,
  LogResources
);
