'use strict';

const { parse } = require('@sandfox/arn');

const S3 = require('../../lib/s3');
const validation = require('./lib/validation');
const { getImmutableID } = require('../../lib/cloudformation/id');

/**
 * @param {import('../../typedefs').CloudformationEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function _delete(event) {
  const {
    StackId,
    ResourceProperties: { S3URI },
  } = validation.create(event);
  const { region } = parse(StackId);
  const s3 = new S3({ region });

  const { bucket } = s3.parseS3Uri(S3URI);

  const notificationConfiguration = await s3.getBucketNotificationConfiguration(
    {
      Bucket: bucket,
    }
  );

  const id = getImmutableID(event);

  const filteredQueueConfigurations = (
    notificationConfiguration.QueueConfigurations || []
  ).filter((queueConfiguration) => queueConfiguration.Id !== id);

  await s3.putBucketNotificationConfiguration({
    NotificationConfiguration: {
      LambdaFunctionConfigurations:
        notificationConfiguration.LambdaFunctionConfigurations,
      QueueConfigurations: filteredQueueConfigurations,
      TopicConfigurations: notificationConfiguration.TopicConfigurations,
    },
    Bucket: bucket,
    SkipDestinationValidation: false,
  });

  return {
    respond: true,
  };
}

module.exports = _delete;
