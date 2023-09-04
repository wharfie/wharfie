'use strict';

const wharfie = require('../../../client');

const Bucket = wharfie.util.shortcuts.s3Bucket.build({
  BucketName: wharfie.util.sub(
    '${Deployment}-${AWS::AccountId}-${AWS::Region}'
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
        Prefix: wharfie.util.sub('${Deployment}-logs/'),
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
        Queue: wharfie.util.importValue(
          wharfie.util.sub('${Deployment}-s3-event-queue')
        ),
        Filter: {
          Key: {
            FilterRules: [
              {
                Name: 'prefix',
                Value: wharfie.util.sub('${Deployment}-logs/'),
              },
            ],
          },
        },
      },
    ],
  },
});

const Parameters = {
  Deployment: {
    Type: 'String',
    Description: 'What wharfie deployment is this for',
  },
};

const Outputs = {
  WharfieServiceBucketName: {
    Value: wharfie.util.ref('Bucket'),
    Export: { Name: wharfie.util.sub('${Deployment}-Service-Bucket') },
  },
};

module.exports = wharfie.util.merge({ Parameters, Outputs }, Bucket);
