'use strict';

const wharfie = require('../../client');
const QueueLambda = require('./lib/queue-lambda');

const TIMEOUT = 300;

const Events = new QueueLambda({
  LogicalName: 'Events',
  FunctionName: wharfie.util.sub('${AWS::StackName}-events'),
  Code: {
    S3Bucket: wharfie.util.sub('utility-${AWS::AccountId}-${AWS::Region}'),
    S3Key: wharfie.util.sub('wharfie/${GitSha}/events.zip'),
  },
  Handler: 'index.handler',
  EventSourceArn: wharfie.util.getAtt('EventsQueue', 'Arn'),
  ReservedConcurrentExecutions: 5,
  BatchSize: 10,
  Timeout: TIMEOUT,
  MemorySize: 768,
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
      LOCATION_TABLE: wharfie.util.ref('LocationTable'),
      EVENT_TABLE: wharfie.util.ref('EventTable'),
      EVENTS_QUEUE_URL: wharfie.util.ref('EventsQueue'),
      DLQ_URL: wharfie.util.ref('EventsDeadLetterQueue'),
      DAEMON_QUEUE_URL: wharfie.util.ref('DaemonQueue'),
      GLOBAL_QUERY_CONCURRENCY: wharfie.util.ref('GlobalQueryConcurrency'),
      RESOURCE_QUERY_CONCURRENCY: wharfie.util.ref('ResourceQueryConcurrency'),
      MAX_QUERIES_PER_ACTION: wharfie.util.ref('MaxQueriesPerAction'),
      TEMPLATE_BUCKET: wharfie.util.sub(
        'utility-${AWS::AccountId}-${AWS::Region}'
      ),
    },
  },
});
delete Events.Resources.EventsLogPolicy;
Events.Resources.EventsEventSource.Properties.MaximumBatchingWindowInSeconds = 5;

const Outputs = {
  S3EventQueue: {
    Value: wharfie.util.getAtt('S3EventQueue', 'Arn'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-s3-event-queue') },
  },
};

const Resources = {
  S3EventQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-s3-event-queue'),
      VisibilityTimeout: TIMEOUT,
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
      RedrivePolicy: {
        deadLetterTargetArn: wharfie.util.getAtt(
          'EventsDeadLetterQueue',
          'Arn'
        ),
        maxReceiveCount: 20,
      },
    },
  },
  S3EventQueuePolicy: {
    Type: 'AWS::SQS::QueuePolicy',
    Properties: {
      Queues: [wharfie.util.ref('S3EventQueue')],
      PolicyDocument: {
        Statement: [
          {
            Sid: 'accept-events',
            Effect: 'Allow',
            Principal: {
              Service: 's3.amazonaws.com',
            },
            Action: ['sqs:SendMessage', 'SQS:SendMessage'],
            Resource: wharfie.util.getAtt('S3EventQueue', 'Arn'),
            Condition: {
              StringEquals: { 'aws:SourceAccount': wharfie.util.accountId },
            },
          },
          {
            Sid: 'accept-s3-events',
            Effect: 'Allow',
            Principal: {
              AWS: '*',
            },
            Action: ['sqs:SendMessage', 'SQS:SendMessage'],
            Resource: wharfie.util.getAtt('S3EventQueue', 'Arn'),
          },
        ],
      },
    },
  },
  S3EventQueueEventSource: {
    DependsOn: ['WharfieRole'],
    Type: 'AWS::Lambda::EventSourceMapping',
    Properties: {
      Enabled: true,
      BatchSize: 10,
      EventSourceArn: wharfie.util.getAtt('S3EventQueue', 'Arn'),
      FunctionName: wharfie.util.ref('Events'),
    },
  },
  EventsQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-events-queue'),
      VisibilityTimeout: TIMEOUT,
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
      RedrivePolicy: {
        deadLetterTargetArn: wharfie.util.getAtt(
          'EventsDeadLetterQueue',
          'Arn'
        ),
        maxReceiveCount: 20,
      },
    },
  },
  EventsDeadLetterQueue: {
    Type: 'AWS::SQS::Queue',
    Properties: {
      QueueName: wharfie.util.sub('${AWS::StackName}-events-dead-letter'),
      MessageRetentionPeriod: 60 * 60 * 24 * 14,
    },
  },
  EventsDeadLetterQueueAlarm: {
    Type: 'AWS::CloudWatch::Alarm',
    Properties: {
      EvaluationPeriods: '1',
      Statistic: 'Maximum',
      Threshold: '0',
      AlarmName: wharfie.util.join('-', [
        wharfie.util.stackName,
        'EventsDeadLetterQueueAlarm',
        wharfie.util.region,
      ]),
      AlarmDescription: '',
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
          Value: wharfie.util.getAtt('EventsDeadLetterQueue', 'QueueName'),
        },
      ],
      MetricName: 'ApproximateNumberOfMessagesVisible',
    },
  },
};

module.exports = wharfie.util.merge({ Resources, Outputs }, Events);
