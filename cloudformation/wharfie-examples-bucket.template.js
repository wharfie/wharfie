'use strict';

const wharfie = require('../client');
const s3BucketTemplate = require('./resources/lib/s3-bucket');

const Parameters = {
  Deployment: {
    Type: 'String',
    Description: 'What wharfie deployment to send s3 notifications to',
  },
};

const Bucket = s3BucketTemplate.build({
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

module.exports = wharfie.util.merge(Bucket, { Parameters });
