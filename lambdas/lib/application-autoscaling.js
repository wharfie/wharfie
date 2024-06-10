'use strict';
const AWS = require('@aws-sdk/client-application-auto-scaling');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class ApplicationAutoScaling {
  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").ApplicationAutoScalingClientConfig} [options] -
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.autoscaling = new AWS.ApplicationAutoScaling({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").PutScalingPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").PutScalingPolicyCommandOutput>} -
   */
  async putScalingPolicy(params) {
    const command = new AWS.PutScalingPolicyCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DeleteScalingPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DeleteScalingPolicyCommandOutput>} -
   */
  async deleteScalingPolicy(params) {
    const command = new AWS.DeleteScalingPolicyCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DescribeScalingPoliciesCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DescribeScalingPoliciesCommandOutput>} -
   */
  async describeScalingPolicies(params) {
    const command = new AWS.DescribeScalingPoliciesCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").RegisterScalableTargetCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").RegisterScalableTargetCommandOutput>} -
   */
  async registerScalableTarget(params) {
    const command = new AWS.RegisterScalableTargetCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DeregisterScalableTargetCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DeregisterScalableTargetCommandOutput>} -
   */
  async deregisterScalableTarget(params) {
    const command = new AWS.DeregisterScalableTargetCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DescribeScalableTargetsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DescribeScalableTargetsCommandOutput>} -
   */
  async describeScalableTargets(params) {
    const command = new AWS.DescribeScalableTargetsCommand(params);
    return this.autoscaling.send(command);
  }
}
ApplicationAutoScaling.ServiceNamespace = AWS.ServiceNamespace;
ApplicationAutoScaling.ScalableDimension = AWS.ScalableDimension;
ApplicationAutoScaling.PolicyType = AWS.PolicyType;

module.exports = ApplicationAutoScaling;
