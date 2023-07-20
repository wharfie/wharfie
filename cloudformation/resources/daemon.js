'use strict';

const wharfie = require('../../client');
const QueueLambda = require('./lib/queue-lambda');

const TIMEOUT = 900;

const Daemon = new QueueLambda({
  LogicalName: 'Daemon',
  FunctionName: wharfie.util.sub('${AWS::StackName}-daemon'),
  Code: {
    S3Bucket: wharfie.util.sub('utility-${AWS::AccountId}-${AWS::Region}'),
    S3Key: wharfie.util.sub('wharfie/${GitSha}/daemon.zip'),
  },
  Handler: 'index.handler',
  EventSourceArn: wharfie.util.getAtt('DaemonQueue', 'Arn'),
  ReservedConcurrentExecutions: 5,
  BatchSize: 10,
  Timeout: TIMEOUT,
  MemorySize: 1024,
  RoleArn: wharfie.util.getAtt('WharfieRole', 'Arn'),
  Environment: {
    Variables: {
      NODE_OPTIONS: '--enable-source-maps',
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: 1,
      STACK_NAME: wharfie.util.stackName,
      DAEMON_LOGGING_LEVEL: wharfie.util.ref('DaemonLoggingLevel'),
      RESOURCE_LOGGING_LEVEL: wharfie.util.ref('ResourceLoggingLevel'),
      TEMPORARY_GLUE_DATABASE: wharfie.util.ref('TemporaryDatabase'),
      COUNTER_TABLE: wharfie.util.ref('CounterTable'),
      RESOURCE_TABLE: wharfie.util.ref('ResourceTable'),
      SEMAPHORE_TABLE: wharfie.util.ref('SemaphoreTable'),
      MONITOR_QUEUE_URL: wharfie.util.ref('MonitorQueue'),
      CLEANUP_QUEUE_URL: wharfie.util.ref('CleanupQueue'),
      DAEMON_QUEUE_URL: wharfie.util.ref('DaemonQueue'),
      DLQ_URL: wharfie.util.ref('DaemonResourceDeadLetterQueue'),
      GLOBAL_QUERY_CONCURRENCY: wharfie.util.ref('GlobalQueryConcurrency'),
      RESOURCE_QUERY_CONCURRENCY: wharfie.util.ref('ResourceQueryConcurrency'),
      MAX_QUERIES_PER_ACTION: wharfie.util.ref('MaxQueriesPerAction'),
      TEMPLATE_BUCKET: wharfie.util.sub(
        'utility-${AWS::AccountId}-${AWS::Region}'
      ),
    },
  },
});
delete Daemon.Resources.DaemonLogPolicy;
Daemon.Resources.DaemonEventSource.Properties.MaximumBatchingWindowInSeconds = 5;

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
