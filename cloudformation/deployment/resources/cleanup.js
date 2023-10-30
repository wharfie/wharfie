'use strict';

const wharfie = require('../../../client');

const TIMEOUT = 600;

const Cleanup = new wharfie.util.shortcuts.QueueLambda({
  LogicalName: 'Cleanup',
  FunctionName: wharfie.util.sub('${AWS::StackName}-cleanup'),
  Code: {
    S3Bucket: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.ref('ArtifactBucket'),
      wharfie.util.sub('wharfie-artifacts-${AWS::Region}')
    ),
    S3Key: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.sub('wharfie/${GitSha}/cleanup.zip'),
      wharfie.util.sub('wharfie/v${Version}/cleanup.zip')
    ),
  },
  Handler: 'index.handler',
  EventSourceArn: wharfie.util.getAtt('CleanupQueue', 'Arn'),
  ReservedConcurrentExecutions: 5,
  BatchSize: 10,
  MaximumBatchingWindowInSeconds: 5,
  Timeout: TIMEOUT,
  MemorySize: 1024,
  RoleArn: wharfie.util.getAtt('WharfieRole', 'Arn'),
  Environment: {
    Variables: {
      NODE_OPTIONS: '--enable-source-maps',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: 1,
      STACK_NAME: wharfie.util.stackName,
      DAEMON_LOGGING_LEVEL: wharfie.util.ref('DaemonLoggingLevel'),
      AWS_SDK_LOGGING_LEVEL: wharfie.util.ref('DaemonLoggingLevel'),
      RESOURCE_LOGGING_LEVEL: wharfie.util.ref('ResourceLoggingLevel'),
      TEMPORARY_GLUE_DATABASE: wharfie.util.ref('TemporaryDatabase'),
      RESOURCE_TABLE: wharfie.util.ref('ResourceTable'),
      SEMAPHORE_TABLE: wharfie.util.ref('SemaphoreTable'),
      MONITOR_QUEUE_URL: wharfie.util.ref('MonitorQueue'),
      CLEANUP_QUEUE_URL: wharfie.util.ref('CleanupQueue'),
      DLQ_URL: wharfie.util.ref('CleanupDeadLetterQueue'),
      GLOBAL_QUERY_CONCURRENCY: wharfie.util.ref('GlobalQueryConcurrency'),
      RESOURCE_QUERY_CONCURRENCY: wharfie.util.ref('ResourceQueryConcurrency'),
      MAX_QUERIES_PER_ACTION: wharfie.util.ref('MaxQueriesPerAction'),
      WHARFIE_SERVICE_BUCKET: wharfie.util.ref('Bucket'),
    },
  },
});

const Outputs = {
  CleanupQueue: {
    Value: wharfie.util.getAtt('CleanupQueue', 'Arn'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-cleanup-queue') },
  },
};

const Resources = {
  CleanupQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-cleanup-queue'),
      VisibilityTimeout: TIMEOUT,
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
      RedrivePolicy: {
        deadLetterTargetArn: wharfie.util.getAtt(
          'CleanupDeadLetterQueue',
          'Arn'
        ),
        maxReceiveCount: 20,
      },
    },
  },
  CleanupDeadLetterQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-cleanup-dead-letter'),
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
    },
  },
  CleanupDeadLetterQueueAlarm: {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      EvaluationPeriods: '1',
      Statistic: 'Maximum',
      Threshold: '0',
      AlarmName: wharfie.util.join('-', [
        wharfie.util.stackName,
        'CleanupDeadLetterQueue',
        wharfie.util.region,
      ]),
      AlarmDescription:
        'https://github.com/wharfie/wharfie/blob/master/docs/alarms.md#CleanupDeadLetterQueueAlarm',
      Period: '60',
      AlarmActions: wharfie.util.if(
        'UseNoOpSNSTopic',
        [wharfie.util.ref('NoOpSNSTopic')],
        [wharfie.util.ref('SNSAlarmTopicARN')]
      ),
      Namespace: 'AWS/SQS',
      ComparisonOperator: 'GreaterThanThreshold',
      Dimensions: [
        {
          Name: 'QueueName',
          Value: wharfie.util.getAtt('CleanupDeadLetterQueue', 'QueueName'),
        },
      ],
      MetricName: 'ApproximateNumberOfMessagesVisible',
    },
  },
};

module.exports = wharfie.util.merge({ Outputs, Resources }, Cleanup);
