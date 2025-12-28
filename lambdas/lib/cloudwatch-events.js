import {
  CloudWatchEvents as _CloudWatchEvents,
  DescribeRuleCommand,
  PutRuleCommand,
  EnableRuleCommand,
  DisableRuleCommand,
  DeleteRuleCommand,
  PutTargetsCommand,
  RemoveTargetsCommand,
  ListTargetsByRuleCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
} from '@aws-sdk/client-cloudwatch-events';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class CloudWatchEvents {
  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").CloudWatchEventsClientConfig} options - cloudwatch events sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.cloudwatchEvents = new _CloudWatchEvents({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DescribeRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DescribeRuleCommandOutput>} -
   */
  async describeRule(params) {
    return await this.cloudwatchEvents.send(new DescribeRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").PutRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").PutRuleCommandOutput>} -
   */
  async putRule(params) {
    return await this.cloudwatchEvents.send(new PutRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").EnableRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").EnableRuleCommandOutput>} -
   */
  async enableRule(params) {
    return await this.cloudwatchEvents.send(new EnableRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DisableRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DisableRuleCommandOutput>} -
   */
  async disableRule(params) {
    return await this.cloudwatchEvents.send(new DisableRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DeleteRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DeleteRuleCommandOutput>} -
   */
  async deleteRule(params) {
    return await this.cloudwatchEvents.send(new DeleteRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").PutTargetsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").PutTargetsCommandOutput>} -
   */
  async putTargets(params) {
    return await this.cloudwatchEvents.send(new PutTargetsCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").RemoveTargetsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").RemoveTargetsCommandOutput>} -
   */
  async removeTargets(params) {
    return await this.cloudwatchEvents.send(new RemoveTargetsCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").ListTargetsByRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").ListTargetsByRuleCommandOutput>} -
   */
  async listTargetsByRule(params) {
    return await this.cloudwatchEvents.send(
      new ListTargetsByRuleCommand(params),
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").ListTagsForResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").ListTagsForResourceCommandOutput>} -
   */
  async listTagsForResource(params) {
    return await this.cloudwatchEvents.send(
      new ListTagsForResourceCommand(params),
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").TagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").TagResourceCommandOutput>} -
   */
  async tagResource(params) {
    return await this.cloudwatchEvents.send(new TagResourceCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").UntagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").UntagResourceCommandOutput>} -
   */
  async untagResource(params) {
    return await this.cloudwatchEvents.send(new UntagResourceCommand(params));
  }
}

export default CloudWatchEvents;
