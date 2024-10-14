'use strict';

const BaseResource = require('../base-resource');
const ApplicationAutoScaling = require('../../../application-auto-scaling');

/**
 * @typedef AutoscalingTargetProperties
 * @property {string} resourceId -
 * @property {string | function(): string} roleArn -
 * @property {import('@aws-sdk/client-application-auto-scaling').ScalableDimension} scalableDimension -
 * @property {number} minCapacity -
 * @property {number} maxCapacity -
 * @property {import('@aws-sdk/client-application-auto-scaling').ServiceNamespace} serviceNamespace -
 */

/**
 * @typedef AutoscalingTargetOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {AutoscalingTargetProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class AutoscalingTarget extends BaseResource {
  /**
   * @param {AutoscalingTargetOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.autoscaling = new ApplicationAutoScaling();
  }

  async _reconcile() {
    const { ScalableTargets } = await this.autoscaling.describeScalableTargets({
      ResourceIds: [this.get('resourceId')],
      ServiceNamespace: this.get('serviceNamespace'),
      ScalableDimension: this.get('scalableDimension'),
    });
    if (!ScalableTargets || ScalableTargets.length === 0) {
      await this.autoscaling.registerScalableTarget({
        ResourceId: this.get('resourceId'),
        ServiceNamespace: this.get('serviceNamespace'),
        ScalableDimension: this.get('scalableDimension'),
        MinCapacity: this.get('minCapacity'),
        MaxCapacity: this.get('maxCapacity'),
        RoleARN: this.get('roleArn'),
      });
    }
  }

  async _destroy() {
    const { ScalableTargets } = await this.autoscaling.describeScalableTargets({
      ResourceIds: [this.get('resourceId')],
      ServiceNamespace: this.get('serviceNamespace'),
      ScalableDimension: this.get('scalableDimension'),
    });
    if (ScalableTargets && ScalableTargets.length > 0) {
      const currentTarget = ScalableTargets[0];
      await this.autoscaling.deregisterScalableTarget({
        ResourceId: currentTarget.ResourceId,
        ServiceNamespace: currentTarget.ServiceNamespace,
        ScalableDimension: currentTarget.ScalableDimension,
      });
    }
  }
}

module.exports = AutoscalingTarget;
