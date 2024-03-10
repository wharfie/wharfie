'use strict';

const { parse } = require('@sandfox/arn');

const S3 = require('../../lib/s3');
const validation = require('./lib/validation');
const { getImmutableID } = require('../../lib/cloudformation/id');
const S3_EVENTS_QUEUE_ARN = process.env.S3_EVENTS_QUEUE_ARN || '';

const S3Client = require('@aws-sdk/client-s3');

/**
 * @param {import('../../typedefs').CloudformationEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function create(event) {
  const {
    StackId,
    ResourceProperties: { S3URI },
  } = validation.create(event);
  const { region } = parse(StackId);
  const s3 = new S3({ region });

  const { bucket, prefix } = s3.parseS3Uri(S3URI);

  const notificationConfiguration = await s3.getBucketNotificationConfiguration(
    {
      Bucket: bucket,
    }
  );

  let queueConfiguration;
  const id = getImmutableID(event);

  if (prefix) {
    queueConfiguration = {
      Id: id,
      QueueArn: S3_EVENTS_QUEUE_ARN,
      Events: [
        S3Client.Event.s3_ObjectCreated_,
        S3Client.Event.s3_ObjectRemoved_,
      ],
      Filter: {
        Key: {
          FilterRules: [
            {
              Name: S3Client.FilterRuleName.prefix,
              Value: prefix,
            },
          ],
        },
      },
    };
  } else {
    queueConfiguration = {
      Id: id,
      QueueArn: S3_EVENTS_QUEUE_ARN,
      Events: [
        S3Client.Event.s3_ObjectCreated_,
        S3Client.Event.s3_ObjectRemoved_,
      ],
    };
  }

  await s3.putBucketNotificationConfiguration({
    NotificationConfiguration: {
      LambdaFunctionConfigurations:
        notificationConfiguration.LambdaFunctionConfigurations,
      QueueConfigurations: notificationConfiguration.QueueConfigurations
        ? [...notificationConfiguration.QueueConfigurations, queueConfiguration]
        : [queueConfiguration],
      TopicConfigurations: notificationConfiguration.TopicConfigurations,
    },
    Bucket: bucket,
    SkipDestinationValidation: false,
  });

  return {
    respond: true,
  };
}

module.exports = create;
