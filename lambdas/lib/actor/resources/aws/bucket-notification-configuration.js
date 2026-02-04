import S3 from '../../../s3.js';
import BaseResource from '../base-resource.js';
import { NoSuchBucket } from '@aws-sdk/client-s3';

/**
 * @typedef BucketNotificationConfigurationProperties
 * @property {string | function(): string} bucketName - bucketName.
 * @property {import('@aws-sdk/client-s3').NotificationConfiguration | function(): import('@aws-sdk/client-s3').NotificationConfiguration} notificationConfiguration - notificationConfiguration.
 */

/**
 * @typedef BucketNotificationConfigurationOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {BucketNotificationConfigurationProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class BucketNotificationConfiguration extends BaseResource {
  /**
   * @param {BucketNotificationConfigurationOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, dependsOn, properties });
    this.s3 = new S3();
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

export default BucketNotificationConfiguration;
