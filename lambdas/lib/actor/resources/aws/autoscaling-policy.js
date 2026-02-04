import BaseResource from '../base-resource.js';
import ApplicationAutoScaling from '../../../application-auto-scaling.js';

/**
 * @typedef AutoscalingPolicyProperties
 * @property {string} resourceId - resourceId.
 * @property {import('@aws-sdk/client-application-auto-scaling').ScalableDimension} scalableDimension - scalableDimension.
 * @property {import('@aws-sdk/client-application-auto-scaling').ServiceNamespace} serviceNamespace - serviceNamespace.
 * @property {import('@aws-sdk/client-application-auto-scaling').PolicyType} policyType - policyType.
 * @property {import('@aws-sdk/client-application-auto-scaling').TargetTrackingScalingPolicyConfiguration} targetTrackingScalingPolicyConfiguration - targetTrackingScalingPolicyConfiguration.
 * @property {import('@aws-sdk/client-application-auto-scaling').StepScalingPolicyConfiguration} [stepScalingPolicyConfiguration] - stepScalingPolicyConfiguration.
 */

/**
 * @typedef AutoscalingPolicyOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {AutoscalingPolicyProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class AutoscalingPolicy extends BaseResource {
  /**
   * @param {AutoscalingPolicyOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({
      name,
      parent,
      status,
      properties,
      dependsOn,
    });
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
            'targetTrackingScalingPolicyConfiguration',
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
            'stepScalingPolicyConfiguration',
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

export default AutoscalingPolicy;
