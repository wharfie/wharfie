import S3 from '../../../aws/s3.js';
import BaseResource from '../base-resource.js';
import { createShortId } from '../../../id.js';
import { configsEqual } from './reconcile-compare.js';

import { NoSuchBucket } from '@aws-sdk/client-s3';

/**
 * @param {import('@aws-sdk/client-s3').Tag[] | undefined} tags - tags.
 * @returns {Record<string, string>} - Result.
 */
function toTagMap(tags) {
  return (tags || []).reduce((acc, { Key, Value }) => {
    if (typeof Key === 'string' && typeof Value === 'string') {
      acc[Key] = Value;
    }
    return acc;
  }, /** @type {Record<string, string>} */ ({}));
}

/**
 * @typedef BucketProperties
 * @property {string} [bucketName] - bucketName.
 * @property {import('@aws-sdk/client-s3').BucketLifecycleConfiguration} [lifecycleConfiguration] - lifecycleConfiguration.
 * @property {import('@aws-sdk/client-s3').NotificationConfiguration | function(): import('@aws-sdk/client-s3').NotificationConfiguration} [notificationConfiguration] - notificationConfiguration.
 * @property {import('@aws-sdk/client-s3').Tag[]} [tags] - tags.
 */

/**
 * @typedef BucketOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {BucketProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class Bucket extends BaseResource {
  /**
   * @param {BucketOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    if (!properties.bucketName) {
      const propertiesWithDefaults = Object.assign(
        {
          bucketName: `${name.substring(0, 57)}-${createShortId()}`,
        },
        properties,
      );
      super({
        name,
        parent,
        status,
        dependsOn,
        properties: propertiesWithDefaults,
      });
    } else {
      super({ name, parent, status, dependsOn, properties });
    }
    this.s3 = new S3();
    this.set('arn', `arn:aws:s3:::${this.get('bucketName')}`);
  }

  async _reconcileTags() {
    const { TagSet } = await this.s3.getBucketTagging({
      Bucket: this.get('bucketName'),
    });
    /** @type {import('@aws-sdk/client-s3').Tag[]} */
    const tags = this.get('tags') || [];
    const existingTags = toTagMap(TagSet);
    const newTags = toTagMap(tags);
    if (JSON.stringify(existingTags) !== JSON.stringify(newTags)) {
      await this.s3.putBucketTagging({
        Bucket: this.get('bucketName'),
        Tagging: {
          TagSet: this.get('tags') || [],
        },
      });
    }
  }

  async _reconcile() {
    try {
      await this.s3.getBucketLocation({
        Bucket: this.get('bucketName'),
      });
    } catch (error) {
      if (error instanceof NoSuchBucket) {
        await this.s3.createBucket({
          Bucket: this.get('bucketName'),
        });
      } else {
        throw error;
      }
    }
    if (this.has('lifecycleConfiguration')) {
      try {
        const existingLifecycleConfiguration =
          await this.s3.getBucketLifecycleConfigutation({
            Bucket: this.get('bucketName'),
          });
        const desiredLifecycleConfiguration = this.get(
          'lifecycleConfiguration',
        );
        if (
          !configsEqual(
            existingLifecycleConfiguration,
            desiredLifecycleConfiguration,
          )
        ) {
          await this.s3.putBucketLifecycleConfigutation({
            Bucket: this.get('bucketName'),
            LifecycleConfiguration: desiredLifecycleConfiguration,
          });
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === 'NoSuchLifecycleConfiguration'
        ) {
          await this.s3.putBucketLifecycleConfigutation({
            Bucket: this.get('bucketName'),
            LifecycleConfiguration: this.get('lifecycleConfiguration'),
          });
        } else {
          throw error;
        }
      }
    }
    if (this.has('notificationConfiguration')) {
      const existingNotificationConfiguration =
        await this.s3.getBucketNotificationConfiguration({
          Bucket: this.get('bucketName'),
        });
      const desiredNotificationConfiguration = this.get(
        'notificationConfiguration',
      );
      if (
        !configsEqual(
          existingNotificationConfiguration,
          desiredNotificationConfiguration,
        )
      ) {
        await this.s3.putBucketNotificationConfiguration({
          Bucket: this.get('bucketName'),
          NotificationConfiguration: desiredNotificationConfiguration,
        });
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.s3.deletePath({
        Bucket: this.get('bucketName'),
      });
      await this.s3.deleteBucket({
        Bucket: this.get('bucketName'),
      });
    } catch (error) {
      if (!(error instanceof NoSuchBucket)) {
        throw error;
      }
    }
  }

  /**
   * @param {Omit<import("@aws-sdk/client-s3").PutObjectCommandInput, 'Bucket'>} params - S3 putObject params
   */
  async upload({ Key, Body }) {
    await this.s3.putObject({
      Bucket: this.get('bucketName'),
      Key,
      Body,
    });
  }

  /**
   * @param {Omit<import("@aws-sdk/client-s3").HeadObjectCommandInput, 'Bucket'>} params - S3 putObject params
   * @returns {Promise<import("@aws-sdk/client-s3").HeadObjectCommandOutput>} - S3 headObject response
   */
  async headObject({ Key }) {
    return await this.s3.headObject({
      Bucket: this.get('bucketName'),
      Key,
    });
  }
}

export default Bucket;
