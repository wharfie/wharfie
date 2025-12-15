import { CloudWatch as _CloudWatch } from '@aws-sdk/client-cloudwatch';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class CloudWatch {
  /**
   * @param {import("@aws-sdk/client-cloudwatch").CloudWatchClientConfig} options - cloudwatch sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.cloudwatch = new _CloudWatch({
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

export default CloudWatch;
