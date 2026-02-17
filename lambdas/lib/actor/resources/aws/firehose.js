import FirehoseSDK from '../../../aws/firehose.js';
import BaseResource from '../base-resource.js';
import { ResourceNotFoundException } from '@aws-sdk/client-firehose';
/**
 * @typedef FirehoseProperties
 * @property {import('@aws-sdk/client-firehose').S3DestinationConfiguration | function(): import('@aws-sdk/client-firehose').S3DestinationConfiguration} s3DestinationConfiguration - s3DestinationConfiguration.
 * @property {import('@aws-sdk/client-firehose').Tag[]} [tags] - tags.
 */

/**
 * @typedef FirehoseOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {FirehoseProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class Firehose extends BaseResource {
  /**
   * @param {FirehoseOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.firehose = new FirehoseSDK({});
  }

  async _reconcileTags() {
    const { Tags } = await this.firehose.listTagsForDeliveryStream({
      DeliveryStreamName: this.name,
    });
    const currentTags = Tags || [];
    const expectedTags = this.get('tags') || [];
    const tagsToAdd = expectedTags.filter(
      (/** @type {import('@aws-sdk/client-firehose').Tag} */ expectedTag) =>
        !currentTags.some(
          (currentTag) =>
            currentTag.Key === expectedTag.Key &&
            currentTag.Value === expectedTag.Value,
        ),
    );
    const tagsToRemove = currentTags.filter(
      (currentTag) =>
        !expectedTags.some(
          (/** @type {import('@aws-sdk/client-firehose').Tag} */ expectedTag) =>
            expectedTag.Key === currentTag.Key &&
            expectedTag.Value === currentTag.Value,
        ),
    );
    if (tagsToAdd.length > 0) {
      await this.firehose.tagDeliveryStream({
        DeliveryStreamName: this.name,
        Tags: tagsToAdd,
      });
    }
    if (tagsToRemove.length > 0) {
      await this.firehose.untagDeliveryStream({
        DeliveryStreamName: this.name,
        TagKeys: tagsToRemove.map((tag) => tag.Key || ''),
      });
    }
  }

  async _reconcile() {
    try {
      const { DeliveryStreamDescription } =
        await this.firehose.describeDeliveryStream({
          DeliveryStreamName: this.name,
        });
      if (DeliveryStreamDescription?.DeliveryStreamStatus === 'DELETING')
        throw new Error(`Firehose ${this.name} is currently deleting`);
      this.set('arn', DeliveryStreamDescription?.DeliveryStreamARN);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        const { DeliveryStreamARN } = await this.firehose.createDeliveryStream({
          DeliveryStreamName: this.name,
          DeliveryStreamType: 'DirectPut',
          S3DestinationConfiguration: this.get('s3DestinationConfiguration'),
        });
        this.set('arn', DeliveryStreamARN);
        await this.waitForDeliveryStreamStatus('ACTIVE');
      } else {
        throw error;
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.firehose.deleteDeliveryStream({
        DeliveryStreamName: this.name,
      });
      await this.waitForDeliveryStreamStatus('DELETING');
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }

  /**
   * @param {string} status - status.
   */
  async waitForDeliveryStreamStatus(status) {
    let currentStatus = '';
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const { DeliveryStreamDescription } =
        await this.firehose.describeDeliveryStream({
          DeliveryStreamName: this.name,
        });
      currentStatus = DeliveryStreamDescription?.DeliveryStreamStatus || '';
    } while (currentStatus !== status);
  }
}

export default Firehose;
