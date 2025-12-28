import S3 from '../../../s3.js';
import BaseResource from '../base-resource.js';
import { createShortId } from '../../../id.js';

import { NoSuchBucket } from '@aws-sdk/client-s3';

/**
 * @typedef BucketProperties
 * @property {string} [bucketName] -
 * @property {import('@aws-sdk/client-s3').BucketLifecycleConfiguration} [lifecycleConfiguration] -
 * @property {import('@aws-sdk/client-s3').NotificationConfiguration | function(): import('@aws-sdk/client-s3').NotificationConfiguration} [notificationConfiguration] -
 * @property {import('@aws-sdk/client-s3').Tag[]} [tags] -
 */

/**
 * @typedef BucketOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {BucketProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 */

class Bucket extends BaseResource {
  /**
   * @param {BucketOptions} options -
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
    const tags = this.get('tags') || [];
    const existingTags =
      TagSet?.reduce((acc, { Key, Value }) => {
        // @ts-ignore
        acc[Key] = Value;
        return acc;
      }, {}) || {};
    const newTags =
      // @ts-ignore
      tags.reduce((acc, { Key, Value }) => {
        acc[Key] = Value;
        return acc;
      }, {}) || {};
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
        const { Rules } = await this.s3.getBucketLifecycleConfigutation({
          Bucket: this.get('bucketName'),
        });
        if (Rules?.length !== this.get('lifecycleConfiguration').Rules.length) {
          // TODO actually check for equality
          await this.s3.putBucketLifecycleConfigutation({
            Bucket: this.get('bucketName'),
            LifecycleConfiguration: this.get('lifecycleConfiguration'),
          });
        }
      } catch (error) {
        // @ts-ignore
        if (error.name === 'NoSuchLifecycleConfiguration') {
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
