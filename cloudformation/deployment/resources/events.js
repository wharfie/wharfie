'use strict';

const wharfie = require('../../../client');

const TIMEOUT = 300;

const Events = new wharfie.util.shortcuts.QueueLambda({
  LogicalName: 'Events',
  FunctionName: wharfie.util.sub('${AWS::StackName}-events'),
  Code: {
    S3Bucket: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.ref('ArtifactBucket'),
      wharfie.util.sub('wharfie-artifacts-${AWS::Region}')
    ),
    S3Key: wharfie.util.if(
      'IsDevelopment',
      wharfie.util.sub('wharfie/${GitSha}/events.zip'),
      wharfie.util.sub('wharfie/v${Version}/events.zip')
    ),
  },
  Handler: 'index.handler',
  EventSourceArn: wharfie.util.getAtt('EventsQueue', 'Arn'),
  ReservedConcurrentExecutions: 5,
  MaximumBatchingWindowInSeconds: 1,
  BatchSize: 10,
  Timeout: TIMEOUT,
  MemorySize: 768,
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
      LOCATION_TABLE: wharfie.util.ref('LocationTable'),
      DEPENDENCY_TABLE: wharfie.util.ref('DependencyTable'),
      EVENT_TABLE: wharfie.util.ref('EventTable'),
      EVENTS_QUEUE_URL: wharfie.util.ref('EventsQueue'),
      DLQ_URL: wharfie.util.ref('EventsDeadLetterQueue'),
      DAEMON_QUEUE_URL: wharfie.util.ref('DaemonQueue'),
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
