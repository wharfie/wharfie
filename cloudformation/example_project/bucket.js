'use strict';

const wharfie = require('../../client');

const Bucket = wharfie.util.shortcuts.s3Bucket.build({
  BucketName: wharfie.util.sub(
    '${AWS::StackName}-${AWS::AccountId}-${AWS::Region}'
  ),
  LifecycleConfiguration: {
    Rules: [
      {
        AbortIncompleteMultipartUpload: {
          DaysAfterInitiation: 1,
        },
        Status: 'Enabled',
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
      },
      {
        Event: 's3:ObjectRemoved:*',
        Queue: wharfie.util.importValue(
          wharfie.util.sub('${Deployment}-s3-event-queue')
        ),
      },
    ],
  },
});

module.exports = Bucket;
