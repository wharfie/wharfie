'use strict';

const wharfie = require('../../../client');

const Bucket = wharfie.util.shortcuts.s3Bucket.build({
  BucketName: wharfie.util.sub(
    '${AWS::StackName}-${AWS::AccountId}-${AWS::Region}'
  ),
  LifecycleConfiguration: {
    Rules: [
      {
        Id: 'abort_incomplete_multipart_uploads',
        AbortIncompleteMultipartUpload: {
          DaysAfterInitiation: 1,
        },
        Status: 'Enabled',
      },
      {
        Id: 'event_log_files_expiration',
        ExpirationInDays: 1,
        Status: 'Enabled',
        Prefix: wharfie.util.sub('${AWS::StackName}/event_logs/'),
      },
      {
        Id: 'daemon_log_files_expiration',
        ExpirationInDays: 1,
        Status: 'Enabled',
        Prefix: wharfie.util.sub('${AWS::StackName}/daemon_logs/'),
      },
      {
        Id: 'aws_sdk_log_files_expiration',
        ExpirationInDays: 1,
        Status: 'Enabled',
        Prefix: wharfie.util.sub('${AWS::StackName}/aws_sdk_logs/'),
      },
      {
        Id: 'athena_results_expiration',
        ExpirationInDays: 1,
        Status: 'Enabled',
        Prefix: 'athena-results/',
      },
    ],
  },
  NotificationConfiguration: {
    QueueConfigurations: [
      {
        Event: 's3:ObjectCreated:*',
        Queue: wharfie.util.getAtt('S3EventQueue', 'Arn'),
        Filter: {
          S3Key: {
            Rules: [
              {
                Name: 'prefix',
                Value: wharfie.util.sub('${AWS::StackName}/event_logs/'),
              },
            ],
          },
        },
      },
      {
        Event: 's3:ObjectCreated:*',
        Queue: wharfie.util.getAtt('S3EventQueue', 'Arn'),
        Filter: {
          S3Key: {
            Rules: [
              {
                Name: 'prefix',
                Value: wharfie.util.sub('${AWS::StackName}/daemon_logs/'),
              },
            ],
          },
        },
      },
    ],
  },
});

const Outputs = {
  WharfieServiceBucketName: {
    Value: wharfie.util.ref('Bucket'),
    Export: { Name: wharfie.util.sub('${AWS::StackName}-Service-Bucket') },
  },
};

module.exports = wharfie.util.merge({ Outputs }, Bucket);
