'use strict';

const wharfie = require('../../../client');

const TIMEOUT = 300;

const Monitor = new wharfie.util.shortcuts.QueueLambda({
  LogicalName: 'Monitor',
  FunctionName: wharfie.util.sub('${AWS::StackName}-monitor'),
  Code: {
    S3Bucket: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.ref('ArtifactBucket'),
      wharfie.util.sub('wharfie-artifacts-${AWS::Region}')
    ),
    S3Key: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.sub('wharfie/${GitSha}/monitor.zip'),
      wharfie.util.sub('wharfie/v${Version}/monitor.zip')
    ),
  },
  Handler: 'index.handler',
  EventSourceArn: wharfie.util.getAtt('MonitorQueue', 'Arn'),
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
      DAEMON_QUEUE_URL: wharfie.util.ref('DaemonQueue'),
      MONITOR_QUEUE_URL: wharfie.util.ref('MonitorQueue'),
      DLQ_URL: wharfie.util.ref('MonitorResourceDeadLetterQueue'),
      GLOBAL_QUERY_CONCURRENCY: wharfie.util.ref('GlobalQueryConcurrency'),
      RESOURCE_QUERY_CONCURRENCY: wharfie.util.ref('ResourceQueryConcurrency'),
      MAX_QUERIES_PER_ACTION: wharfie.util.ref('MaxQueriesPerAction'),
      WHARFIE_SERVICE_BUCKET: wharfie.util.ref('Bucket'),
      WHARFIE_LOGGING_FIREHOSE: wharfie.util.ref('LoggingFirehose'),
    },
  },
});

const Resources = {
  MonitorEventRole: {
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
  MonitorEventRule: {
    Type: 'AWS::Events::Rule',
    Properties: {
      Description: 'Athena Query Events',
      EventPattern: {
        source: ['aws.athena'],
        'detail-type': ['Athena Query State Change'],
      },
      Name: wharfie.util.sub('${AWS::StackName}-Event-Rule'),
      RoleArn: wharfie.util.getAtt('MonitorEventRole', 'Arn'),
      State: 'ENABLED',
      Targets: [
        {
          Arn: wharfie.util.getAtt('MonitorQueue', 'Arn'),
          Id: wharfie.util.sub('${AWS::StackName}-target'),
        },
      ],
    },
  },
  MonitorQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-monitor-queue'),
      VisibilityTimeout: TIMEOUT,
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
      RedrivePolicy: {
        deadLetterTargetArn: wharfie.util.getAtt(
          'MonitorDeadLetterQueue',
          'Arn'
        ),
        maxReceiveCount: 20,
      },
    },
  },
  MonitorQueuePolicy: {
    Type: 'AWS::SQS::QueuePolicy',
    Properties: {
      Queues: [wharfie.util.ref('MonitorQueue')],
      PolicyDocument: {
        Statement: [
          {
            Sid: 'accept-cloudwatch-events',
            Effect: 'Allow',
            Principal: {
              Service: ['events.amazonaws.com', 'sqs.amazonaws.com'],
            },
            Action: 'sqs:SendMessage',
            Resource: wharfie.util.getAtt('MonitorQueue', 'Arn'),
          },
        ],
      },
    },
  },
  MonitorDeadLetterQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-monitor-dead-letter'),
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
    },
  },
  MonitorResourceDeadLetterQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub(
        '${AWS::StackName}-monitor-resource-dead-letter'
      ),
      MessageRetentionPeriod: 60 * 60 * 24 * 7,
    },
  },
  MonitorDeadLetterQueueAlarm: {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      EvaluationPeriods: '1',
      Statistic: 'Maximum',
      Threshold: '0',
      AlarmName: wharfie.util.join('-', [
        wharfie.util.stackName,
        'MonitorDeadLetterQueueAlarm',
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
          Value: wharfie.util.getAtt('MonitorDeadLetterQueue', 'QueueName'),
        },
      ],
      MetricName: 'ApproximateNumberOfMessagesVisible',
    },
  },
  MonitorResourceAnomalyDetector: {
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
            'MonitorResourceDeadLetterQueue',
            'QueueName'
          ),
        },
      ],
    },
  },
  MonitorResourceDeadLetterQueueAnomalyAlarm: {
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
                    'MonitorResourceDeadLetterQueue',
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

const Outputs = {
  QueueUrl: { Value: wharfie.util.ref('MonitorQueue') },
  QueueArn: { Value: wharfie.util.getAtt('MonitorQueue', 'Arn') },
  DeadLetterQueueUrl: { Value: wharfie.util.ref('MonitorDeadLetterQueue') },
};

module.exports = wharfie.util.merge({ Resources, Outputs }, Monitor);
