'use strict';

const wharfie = require('../../../client');

const TIMEOUT = 900;

const Daemon = new wharfie.util.shortcuts.QueueLambda({
  LogicalName: 'Daemon',
  FunctionName: wharfie.util.sub('${AWS::StackName}-daemon'),
  Code: {
    S3Bucket: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.ref('ArtifactBucket'),
      wharfie.util.sub('wharfie-artifacts-${AWS::Region}')
    ),
    S3Key: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.sub('wharfie/${GitSha}/daemon.zip'),
      wharfie.util.sub('wharfie/v${Version}/daemon.zip')
    ),
  },
  Handler: 'index.handler',
  EventSourceArn: wharfie.util.getAtt('DaemonQueue', 'Arn'),
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
      LOGGING_LEVEL: wharfie.util.ref('LoggingLevel'),
      TEMPORARY_GLUE_DATABASE: wharfie.util.ref('TemporaryDatabase'),
      RESOURCE_TABLE: wharfie.util.ref('ResourceTable'),
      SEMAPHORE_TABLE: wharfie.util.ref('SemaphoreTable'),
      MONITOR_QUEUE_URL: wharfie.util.ref('MonitorQueue'),
      CLEANUP_QUEUE_URL: wharfie.util.ref('CleanupQueue'),
      DAEMON_QUEUE_URL: wharfie.util.ref('DaemonQueue'),
      EVENTS_QUEUE_URL: wharfie.util.ref('EventsQueue'),
      DLQ_URL: wharfie.util.ref('DaemonResourceDeadLetterQueue'),
      GLOBAL_QUERY_CONCURRENCY: wharfie.util.ref('GlobalQueryConcurrency'),
      RESOURCE_QUERY_CONCURRENCY: wharfie.util.ref('ResourceQueryConcurrency'),
      MAX_QUERIES_PER_ACTION: wharfie.util.ref('MaxQueriesPerAction'),
      WHARFIE_SERVICE_BUCKET: wharfie.util.ref('Bucket'),
      WHARFIE_LOGGING_FIREHOSE: wharfie.util.ref('LoggingFirehose'),
      SIDE_EFFECT_DAGSTER_ORGANIZATION: wharfie.util.ref(
        'SideEffectDagsterOrganization'
      ),
      SIDE_EFFECT_DAGSTER_DEPLOYMENT: wharfie.util.ref(
        'SideEffectDagsterDeployment'
      ),
      SIDE_EFFECT_DAGSTER_TOKEN: wharfie.util.ref('SideEffectDagsterToken'),
    },
  },
  LoggingCondition: 'IsDebug',
});

const Outputs = {
  DaemonQueue: {
    Value: wharfie.util.getAtt('DaemonQueue', 'Arn'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-daemon-queue') },
  },
};

const Resources = {
  DaemonEventRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: ['events.amazonaws.com', 'sqs.amazonaws.com'],
            },
          },
        ],
        Version: '2012-10-17',
      },
    },
  },
  DaemonQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-Daemon-queue'),
      VisibilityTimeout: TIMEOUT,
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
      RedrivePolicy: {
        deadLetterTargetArn: wharfie.util.getAtt(
          'DaemonDeadLetterQueue',
          'Arn'
        ),
        maxReceiveCount: 20,
      },
    },
  },
  DaemonQueuePolicy: {
    Type: 'AWS::SQS::QueuePolicy',
    Properties: {
      Queues: [wharfie.util.ref('DaemonQueue')],
      PolicyDocument: {
        Statement: [
          {
            Sid: 'accept-cloudwatch-events',
            Effect: 'Allow',
            Principal: {
              Service: ['events.amazonaws.com', 'sqs.amazonaws.com'],
            },
            Action: 'sqs:SendMessage',
            Resource: wharfie.util.getAtt('DaemonQueue', 'Arn'),
          },
        ],
      },
    },
  },
  DaemonDeadLetterQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-Daemon-dead-letter'),
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
    },
  },
  DaemonResourceDeadLetterQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub(
        '${AWS::StackName}-Daemon-resource-dead-letter'
      ),
      MessageRetentionPeriod: 60 * 60 * 24 * 7,
    },
  },
  DaemonDeadLetterQueueAlarm: {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      EvaluationPeriods: '1',
      Statistic: 'Maximum',
      Threshold: '0',
      AlarmName: wharfie.util.join('-', [
        wharfie.util.stackName,
        'DaemonDeadLetterQueue',
        wharfie.util.region,
      ]),
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
          Value: wharfie.util.getAtt('DaemonDeadLetterQueue', 'QueueName'),
        },
      ],
      MetricName: 'ApproximateNumberOfMessagesVisible',
    },
  },
  DaemonResourceAnomalyDetector: {
    Type: 'AWS::CloudWatch::AnomalyDetector',
    Properties: {
      Configuration: {
        ExcludedTimeRanges: [],
        MetricTimeZone: 'UTC',
      },
      Namespace: 'AWS/SQS',
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Stat: 'Maximum',
      Dimensions: [
        {
          Name: 'QueueName',
          Value: wharfie.util.getAtt(
            'DaemonResourceDeadLetterQueue',
            'QueueName'
          ),
        },
      ],
    },
  },
  DaemonResourceDeadLetterQueueAnomalyAlarm: {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      EvaluationPeriods: 5,
      DatapointsToAlarm: 5,
      AlarmActions: wharfie.util.if(
        'UseNoOpSNSTopic',
        [wharfie.util.ref('NoOpSNSTopic')],
        [wharfie.util.ref('SNSAlarmTopicARN')]
      ),
      ComparisonOperator: 'GreaterThanUpperThreshold',
      ThresholdMetricId: 'ad1',
      Metrics: [
        {
          Expression: 'ANOMALY_DETECTION_BAND(m1, 2)',
          Id: 'ad1',
        },
        {
          Id: 'm1',
          MetricStat: {
            Metric: {
              Namespace: 'AWS/SQS',
              MetricName: 'ApproximateNumberOfMessagesVisible',
              Dimensions: [
                {
                  Name: 'QueueName',
                  Value: wharfie.util.getAtt(
                    'DaemonResourceDeadLetterQueue',
                    'QueueName'
                  ),
                },
              ],
            },
            Period: 60,
            Stat: 'Maximum',
          },
        },
      ],
    },
  },
};

module.exports = wharfie.util.merge({ Outputs, Resources }, Daemon);
