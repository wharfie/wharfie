'use strict';
const FirehoseSDK = require('../../../firehose');
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-firehose');
/**
 * @typedef FirehoseProperties
 * @property {import('@aws-sdk/client-firehose').S3DestinationConfiguration | function(): import('@aws-sdk/client-firehose').S3DestinationConfiguration} s3DestinationConfiguration -
 */

/**
 * @typedef FirehoseOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {FirehoseProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Firehose extends BaseResource {
  /**
   * @param {FirehoseOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.firehose = new FirehoseSDK({});
  }

  async _reconcile() {
    try {
      const { DeliveryStreamDescription } =
        await this.firehose.describeDeliveryStream({
          DeliveryStreamName: this.name,
        });
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
   * @param {string} status -
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

module.exports = Firehose;
