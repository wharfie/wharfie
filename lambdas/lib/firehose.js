import {
  Firehose as _Firehose,
  ListTagsForDeliveryStreamCommand,
  TagDeliveryStreamCommand,
  UntagDeliveryStreamCommand,
  CreateDeliveryStreamCommand,
  DeleteDeliveryStreamCommand,
  DescribeDeliveryStreamCommand,
} from '@aws-sdk/client-firehose';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class Firehose {
  /**
   * @param {import("@aws-sdk/client-firehose").FirehoseClientConfig} options - Firehose sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.firehose = new _Firehose({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-firehose").ListTagsForDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").ListTagsForDeliveryStreamCommandOutput>} -
   */
  async listTagsForDeliveryStream(params) {
    const command = new ListTagsForDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").TagDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").TagDeliveryStreamCommandOutput>} -
   */
  async tagDeliveryStream(params) {
    const command = new TagDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").UntagDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").UntagDeliveryStreamCommandOutput>} -
   */
  async untagDeliveryStream(params) {
    const command = new UntagDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").CreateDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").CreateDeliveryStreamCommandOutput>} -
   */
  async createDeliveryStream(params) {
    const command = new CreateDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").DeleteDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").DeleteDeliveryStreamCommandOutput>} -
   */
  async deleteDeliveryStream(params) {
    const command = new DeleteDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-firehose").DescribeDeliveryStreamCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-firehose").DescribeDeliveryStreamCommandOutput>} -
   */
  async describeDeliveryStream(params) {
    const command = new DescribeDeliveryStreamCommand(params);
    return await this.firehose.send(command);
  }
}

export default Firehose;
