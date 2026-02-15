import { SNS as _SNS, PublishCommand } from '@aws-sdk/client-sns';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class SNS {
  /**
   * @param {import("@aws-sdk/client-sns").SNSClientConfig} options - SNS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.sns = new _SNS({
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
    const command = new PublishCommand(params);
    return await this.sns.send(command);
  }
}

export default SNS;
