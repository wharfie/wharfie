'use strict';

const wharfie = require('../../../client');

const Bootstrap = new wharfie.util.shortcuts.Lambda({
  LogicalName: 'Bootstrap',
  FunctionName: wharfie.util.sub('${AWS::StackName}-bootstrap'),
  Code: {
    S3Bucket: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.ref('ArtifactBucket'),
      wharfie.util.sub('wharfie-artifacts-${AWS::Region}')
    ),
    S3Key: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.sub('wharfie/${GitSha}/bootstrap.zip'),
      wharfie.util.sub('wharfie/v${Version}/bootstrap.zip')
    ),
  },
  Handler: 'index.handler',
  MemorySize: 1048,
  Timeout: 900,
  RoleArn: wharfie.util.getAtt('WharfieRole', 'Arn'),
  Environment: {
    Variables: {
      NODE_OPTIONS: '--enable-source-maps',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: 1,
      STACK_NAME: wharfie.util.stackName,
      LOGGING_LEVEL: wharfie.util.ref('LoggingLevel'),
      RESOURCE_TABLE: wharfie.util.ref('ResourceTable'),
      SEMAPHORE_TABLE: wharfie.util.ref('SemaphoreTable'),
      LOCATION_TABLE: wharfie.util.ref('LocationTable'),
      DEPENDENCY_TABLE: wharfie.util.ref('DependencyTable'),
      EVENT_TABLE: wharfie.util.ref('EventTable'),
      DAEMON_QUEUE_ARN: wharfie.util.getAtt('DaemonQueue', 'Arn'),
      DAEMON_EVENT_ROLE: wharfie.util.getAtt('DaemonEventRole', 'Arn'),
      WHARFIE_SERVICE_BUCKET: wharfie.util.ref('Bucket'),
      WHARFIE_LOGGING_FIREHOSE: wharfie.util.ref('LoggingFirehose'),
      DAEMON_QUEUE_URL: wharfie.util.ref('DaemonQueue'),
    },
  },
  AlarmActions: wharfie.util.if(
    'UseNoOpSNSTopic',
    [wharfie.util.ref('NoOpSNSTopic')],
    [wharfie.util.ref('SNSAlarmTopicARN')]
  ),
  AlarmName: wharfie.util.sub('${AWS::StackName}-source-bootstrap-errors'),
  LoggingCondition: 'IsDebug',
});

const Outputs = {
  WharfieServiceToken: {
    Value: wharfie.util.getAtt('Bootstrap', 'Arn'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}') },
  },
};

module.exports = wharfie.util.merge({ Outputs }, Bootstrap);
