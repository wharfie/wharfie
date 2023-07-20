'use strict';
const AWS = require('@aws-sdk/client-sns');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class SNS {
  /**
   * @param {import("@aws-sdk/client-sns").SNSClientConfig} options - SNS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.sns = new AWS.SNS({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-sns").PublishInput} params - SNS Publish params
   * @returns {Promise<import("@aws-sdk/client-sns").PublishResponse>} - SNS Publish result
   */
  async publish(params) {
    const command = new AWS.PublishCommand(params);
    return await this.sns.send(command);
  }
}

module.exports = SNS;
