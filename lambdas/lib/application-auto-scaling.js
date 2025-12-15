import {
  ApplicationAutoScaling as _ApplicationAutoScaling,
  UntagResourceCommand,
  TagResourceCommand,
  ListTagsForResourceCommand,
  PutScalingPolicyCommand,
  DeleteScalingPolicyCommand,
  DescribeScalingPoliciesCommand,
  RegisterScalableTargetCommand,
  DeregisterScalableTargetCommand,
  DescribeScalableTargetsCommand,
  ServiceNamespace,
  ScalableDimension,
  PolicyType,
} from '@aws-sdk/client-application-auto-scaling';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class ApplicationAutoScaling {
  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").ApplicationAutoScalingClientConfig} [options] -
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.autoscaling = new _ApplicationAutoScaling({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").UntagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").UntagResourceCommandOutput>} -
   */
  async untagResource(params) {
    const command = new UntagResourceCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").TagResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").TagResourceCommandOutput>} -
   */
  async tagResource(params) {
    const command = new TagResourceCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").ListTagsForResourceCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").ListTagsForResourceCommandOutput>} -
   */
  async listTagsForResource(params) {
    const command = new ListTagsForResourceCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").PutScalingPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").PutScalingPolicyCommandOutput>} -
   */
  async putScalingPolicy(params) {
    const command = new PutScalingPolicyCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DeleteScalingPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DeleteScalingPolicyCommandOutput>} -
   */
  async deleteScalingPolicy(params) {
    const command = new DeleteScalingPolicyCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DescribeScalingPoliciesCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DescribeScalingPoliciesCommandOutput>} -
   */
  async describeScalingPolicies(params) {
    const command = new DescribeScalingPoliciesCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").RegisterScalableTargetCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").RegisterScalableTargetCommandOutput>} -
   */
  async registerScalableTarget(params) {
    const command = new RegisterScalableTargetCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DeregisterScalableTargetCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DeregisterScalableTargetCommandOutput>} -
   */
  async deregisterScalableTarget(params) {
    const command = new DeregisterScalableTargetCommand(params);
    return this.autoscaling.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-application-auto-scaling").DescribeScalableTargetsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-application-auto-scaling").DescribeScalableTargetsCommandOutput>} -
   */
  async describeScalableTargets(params) {
    const command = new DescribeScalableTargetsCommand(params);
    return this.autoscaling.send(command);
  }
}
ApplicationAutoScaling.ServiceNamespace = ServiceNamespace;
ApplicationAutoScaling.ScalableDimension = ScalableDimension;
ApplicationAutoScaling.PolicyType = PolicyType;

export default ApplicationAutoScaling;
