'use strict';
const S3 = require('../../../s3');
const BaseResource = require('../base-resource');

const { NoSuchBucket } = require('@aws-sdk/client-s3');

/**
 * @typedef BucketProperties
 * @property {import('@aws-sdk/client-s3').BucketLifecycleConfiguration} [lifecycleConfiguration] -
 * @property {import('@aws-sdk/client-s3').NotificationConfiguration | function(): import('@aws-sdk/client-s3').NotificationConfiguration} [notificationConfiguration] -
 * @property {import('@aws-sdk/client-s3').Tag[]} [tags] -
 */

/**
 * @typedef BucketOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {BucketProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Bucket extends BaseResource {
  /**
   * @param {BucketOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, dependsOn, properties });
    this.s3 = new S3();
    this.set('arn', `arn:aws:s3:::${this.name}`);
  }

  async _reconcileTags() {
    const { TagSet } = await this.s3.getBucketTagging({
      Bucket: this.name,
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
        Bucket: this.name,
        Tagging: {
          TagSet: this.get('tags') || [],
        },
      });
    }
  }

  async _reconcile() {
    try {
      await this.s3.getBucketLocation({
        Bucket: this.name,
      });
    } catch (error) {
      if (error instanceof NoSuchBucket) {
        await this.s3.createBucket({
          Bucket: this.name,
        });
      } else {
        throw error;
      }
    }
    if (this.has('lifecycleConfiguration')) {
      try {
        const { Rules } = await this.s3.getBucketLifecycleConfigutation({
          Bucket: this.name,
        });
        if (Rules?.length !== this.get('lifecycleConfiguration').Rules.length) {
          // TODO actually check for equality
          await this.s3.putBucketLifecycleConfigutation({
            Bucket: this.name,
            LifecycleConfiguration: this.get('lifecycleConfiguration'),
          });
        }
      } catch (error) {
        // @ts-ignore
        if (error.name === 'NoSuchLifecycleConfiguration') {
          await this.s3.putBucketLifecycleConfigutation({
            Bucket: this.name,
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
          Bucket: this.name,
        });
      if (
        QueueConfigurations?.length !==
        this.get('notificationConfiguration').QueueConfigurations.length
      ) {
        // TODO actually check for equality
        await this.s3.putBucketNotificationConfiguration({
          Bucket: this.name,
          NotificationConfiguration: this.get('notificationConfiguration'),
        });
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.s3.deletePath({
        Bucket: this.name,
      });
      await this.s3.deleteBucket({
        Bucket: this.name,
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
      Bucket: this.name,
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
      Bucket: this.name,
      Key,
    });
  }
}

module.exports = Bucket;
