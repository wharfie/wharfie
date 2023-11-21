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
        Id: 'log_files_expiration',
        ExpirationInDays: 1,
        Status: 'Enabled',
        Prefix: wharfie.util.sub('/logs/raw/'),
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
                Value: wharfie.util.sub('/logs/raw/'),
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
