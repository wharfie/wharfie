'use strict';

const BaseResource = require('../base-resource');
const ApplicationAutoScaling = require('../../../application-auto-scaling');

/**
 * @typedef AutoscalingPolicyProperties
 * @property {string} resourceId -
 * @property {import('@aws-sdk/client-application-auto-scaling').ScalableDimension} scalableDimension -
 * @property {import('@aws-sdk/client-application-auto-scaling').ServiceNamespace} serviceNamespace -
 * @property {import('@aws-sdk/client-application-auto-scaling').PolicyType} policyType -
 * @property {import('@aws-sdk/client-application-auto-scaling').TargetTrackingScalingPolicyConfiguration} targetTrackingScalingPolicyConfiguration -
 * @property {import('@aws-sdk/client-application-auto-scaling').StepScalingPolicyConfiguration} [stepScalingPolicyConfiguration] -
 */

/**
 * @typedef AutoscalingPolicyOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {AutoscalingPolicyProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class AutoscalingPolicy extends BaseResource {
  /**
   * @param {AutoscalingPolicyOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.autoscaling = new ApplicationAutoScaling();
  }

  async _reconcile() {
    const { ScalingPolicies } = await this.autoscaling.describeScalingPolicies({
      PolicyNames: [this.name],
      ServiceNamespace: this.get('serviceNamespace'),
      ScalableDimension: this.get('scalableDimension'),
      ResourceId: this.get('resourceId'),
    });
    if (!ScalingPolicies || ScalingPolicies.length === 0) {
      if (
        this.get('policyType') ===
        ApplicationAutoScaling.PolicyType.TargetTrackingScaling
      ) {
        await this.autoscaling.putScalingPolicy({
          PolicyName: this.name,
          ResourceId: this.get('resourceId'),
          ServiceNamespace: this.get('serviceNamespace'),
          ScalableDimension: this.get('scalableDimension'),
          PolicyType: this.get('policyType'),
          TargetTrackingScalingPolicyConfiguration: this.get(
            'targetTrackingScalingPolicyConfiguration'
          ),
        });
      } else {
        await this.autoscaling.putScalingPolicy({
          PolicyName: this.name,
          ResourceId: this.get('resourceId'),
          ServiceNamespace: this.get('serviceNamespace'),
          ScalableDimension: this.get('scalableDimension'),
          PolicyType: this.get('policyType'),
          StepScalingPolicyConfiguration: this.get(
            'stepScalingPolicyConfiguration'
          ),
        });
      }
    } else {
      const activePolicy = ScalingPolicies[0];
      this.set('arn', activePolicy.PolicyARN);
    }
  }

  async _destroy() {
    try {
      const { ScalingPolicies } =
        await this.autoscaling.describeScalingPolicies({
          PolicyNames: [this.name],
          ServiceNamespace: this.get('serviceNamespace'),
          ScalableDimension: this.get('scalableDimension'),
          ResourceId: this.get('resourceId'),
        });
      if (ScalingPolicies && ScalingPolicies.length > 0) {
        const currentPolicy = ScalingPolicies[0];
        await this.autoscaling.deleteScalingPolicy({
          PolicyName: this.name,
          ServiceNamespace: this.get('serviceNamespace'),
          ResourceId: currentPolicy.ResourceId,
          ScalableDimension: currentPolicy.ScalableDimension,
        });
      }
    } catch (err) {
      // @ts-ignore
      if (err.name === 'ObjectNotFoundException') {
        return;
      }
      throw err;
    }
  }
}

module.exports = AutoscalingPolicy;
