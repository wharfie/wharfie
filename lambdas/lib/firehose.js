'use strict';
const AWS = require('@aws-sdk/client-firehose');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class Firehose {
  /**
   * @param {import("@aws-sdk/client-firehose").FirehoseClientConfig} options - Firehose sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.firehose = new AWS.Firehose({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-firehose").CreateDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").CreateDeliveryStreamCommandOutput>} -
   */
  async createDeliveryStream(params) {
    const command = new AWS.CreateDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").DeleteDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").DeleteDeliveryStreamCommandOutput>} -
   */
  async deleteDeliveryStream(params) {
    const command = new AWS.DeleteDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").DescribeDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").DescribeDeliveryStreamCommandOutput>} -
   */
  async describeDeliveryStream(params) {
    const command = new AWS.DescribeDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }
}

module.exports = Firehose;
