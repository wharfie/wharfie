'use strict';
const AWS = require('@aws-sdk/client-cloudwatch');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class CloudWatch {
  /**
   * @param {import("@aws-sdk/client-cloudwatch").CloudWatchClientConfig} options - cloudwatch sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.cloudwatch = new AWS.CloudWatch({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch").PutMetricDataCommandInput} params - params for putMetricData request
   * @returns {Promise<import("@aws-sdk/client-cloudwatch").PutMetricDataCommandOutput>} -
   */
  async putMetricData(params) {
    return await this.cloudwatch.putMetricData(params);
  }
}

module.exports = CloudWatch;
