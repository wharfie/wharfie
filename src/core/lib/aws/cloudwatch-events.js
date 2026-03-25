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
   * @param {import("@aws-sdk/client-cloudwatch-events").DescribeRuleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DescribeRuleCommandOutput>} - Result.
   */
  async describeRule(params) {
    return await this.cloudwatchEvents.send(new DescribeRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").PutRuleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").PutRuleCommandOutput>} - Result.
   */
  async putRule(params) {
    return await this.cloudwatchEvents.send(new PutRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").EnableRuleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").EnableRuleCommandOutput>} - Result.
   */
  async enableRule(params) {
    return await this.cloudwatchEvents.send(new EnableRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DisableRuleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DisableRuleCommandOutput>} - Result.
   */
  async disableRule(params) {
    return await this.cloudwatchEvents.send(new DisableRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DeleteRuleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DeleteRuleCommandOutput>} - Result.
   */
  async deleteRule(params) {
    return await this.cloudwatchEvents.send(new DeleteRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").PutTargetsCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").PutTargetsCommandOutput>} - Result.
   */
  async putTargets(params) {
    return await this.cloudwatchEvents.send(new PutTargetsCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").RemoveTargetsCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").RemoveTargetsCommandOutput>} - Result.
   */
  async removeTargets(params) {
    return await this.cloudwatchEvents.send(new RemoveTargetsCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").ListTargetsByRuleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").ListTargetsByRuleCommandOutput>} - Result.
   */
  async listTargetsByRule(params) {
    return await this.cloudwatchEvents.send(
      new ListTargetsByRuleCommand(params),
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").ListTagsForResourceCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").ListTagsForResourceCommandOutput>} - Result.
   */
  async listTagsForResource(params) {
    return await this.cloudwatchEvents.send(
      new ListTagsForResourceCommand(params),
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").TagResourceCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").TagResourceCommandOutput>} - Result.
   */
  async tagResource(params) {
    return await this.cloudwatchEvents.send(new TagResourceCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").UntagResourceCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").UntagResourceCommandOutput>} - Result.
   */
  async untagResource(params) {
    return await this.cloudwatchEvents.send(new UntagResourceCommand(params));
  }
}

export default CloudWatchEvents;
