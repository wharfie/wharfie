'use strict';

const wharfie = require('../client');
const s3BucketTemplate = require('./resources/lib/s3-bucket');

const Parameters = {};

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
});

module.exports = wharfie.util.merge(Bucket, { Parameters });
