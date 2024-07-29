'use strict';
const S3 = require('../../../s3');
const BaseResource = require('../base-resource');
const { NoSuchBucket } = require('@aws-sdk/client-s3');

/**
 * @typedef BucketNotificationConfigurationProperties
 * @property {string | function(): string} bucketName -
 * @property {import('@aws-sdk/client-s3').NotificationConfiguration | function(): import('@aws-sdk/client-s3').NotificationConfiguration} notificationConfiguration -
 */

/**
 * @typedef BucketNotificationConfigurationOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {BucketNotificationConfigurationProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class BucketNotificationConfiguration extends BaseResource {
  /**
   * @param {BucketNotificationConfigurationOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, dependsOn, properties });
    this.s3 = new S3();
    this.set('arn', `arn:aws:s3:::${this.name}`);
  }

  async _reconcile() {
    if (this.has('notificationConfiguration')) {
      const { QueueConfigurations } =
        await this.s3.getBucketNotificationConfiguration({
          Bucket: this.get('bucketName'),
        });
      if (
        QueueConfigurations?.length !==
        this.get('notificationConfiguration').QueueConfigurations.length
      ) {
        // TODO actually check for equality
        await this.s3.putBucketNotificationConfiguration({
          Bucket: this.get('bucketName'),
          NotificationConfiguration: this.get('notificationConfiguration'),
        });
      }
    }
  }

  async _destroy() {
    try {
      await this.s3.putBucketNotificationConfiguration({
        Bucket: this.get('bucketName'),
        NotificationConfiguration: {},
      });
    } catch (error) {
      if (!(error instanceof NoSuchBucket)) {
        throw error;
      }
    }
  }
}

module.exports = BucketNotificationConfiguration;
