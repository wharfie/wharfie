'use strict';
const AWS = require('@aws-sdk/client-cloudwatch-events');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class CloudWatchEvents {
  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").CloudWatchEventsClientConfig} options - cloudwatch events sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.cloudwatchEvents = new AWS.CloudWatchEvents({
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
    return await this.cloudwatchEvents.send(
      new AWS.DescribeRuleCommand(params)
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").PutRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").PutRuleCommandOutput>} -
   */
  async putRule(params) {
    return await this.cloudwatchEvents.send(new AWS.PutRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").EnableRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").EnableRuleCommandOutput>} -
   */
  async enableRule(params) {
    return await this.cloudwatchEvents.send(new AWS.EnableRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DisableRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DisableRuleCommandOutput>} -
   */
  async disableRule(params) {
    return await this.cloudwatchEvents.send(new AWS.DisableRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").DeleteRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").DeleteRuleCommandOutput>} -
   */
  async deleteRuleCommand(params) {
    return await this.cloudwatchEvents.send(new AWS.DeleteRuleCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").PutTargetsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").PutTargetsCommandOutput>} -
   */
  async putTargets(params) {
    return await this.cloudwatchEvents.send(new AWS.PutTargetsCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").RemoveTargetsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").RemoveTargetsCommandOutput>} -
   */
  async removeTargets(params) {
    return await this.cloudwatchEvents.send(
      new AWS.RemoveTargetsCommand(params)
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudwatch-events").ListTargetsByRuleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudwatch-events").ListTargetsByRuleCommandOutput>} -
   */
  async listTargetsByRule(params) {
    return await this.cloudwatchEvents.send(
      new AWS.ListTargetsByRuleCommand(params)
    );
  }

  // TODO: add tag commands here and to resource defs
}

module.exports = CloudWatchEvents;
