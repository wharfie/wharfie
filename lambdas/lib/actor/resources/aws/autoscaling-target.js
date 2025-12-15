import BaseResource from '../base-resource.js';
import ApplicationAutoScaling from '../../../application-auto-scaling.js';

/**
 * @typedef AutoscalingTargetProperties
 * @property {string} resourceId -
 * @property {string | function(): string} roleArn -
 * @property {import('@aws-sdk/client-application-auto-scaling').ScalableDimension} scalableDimension -
 * @property {number} minCapacity -
 * @property {number} maxCapacity -
 * @property {import('@aws-sdk/client-application-auto-scaling').ServiceNamespace} serviceNamespace -
 * @property {Record<string, string>} [tags] -
 */

/**
 * @typedef AutoscalingTargetOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {AutoscalingTargetProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 */

class AutoscalingTarget extends BaseResource {
  /**
   * @param {AutoscalingTargetOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    const propertiesWithDefaults = Object.assign(
      {
        tags: {},
      },
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    this.autoscaling = new ApplicationAutoScaling();
  }

  async _reconcileTags() {
    const { Tags } = await this.autoscaling.listTagsForResource({
      ResourceARN: this.get('arn'),
    });
    const current_tags = Tags || {};
    /**
     * @type {Record<string, string>}
     */
    const configured_tags = this.get('tags');
    const tagsToAdd = Object.entries(configured_tags)
      .filter(([key, value]) => current_tags[key] !== value)
      .map(([key, value]) => ({ Key: key, Value: value }));
    const tagsToRemove = Object.entries(current_tags)
      .filter(([key, value]) => configured_tags[key] === undefined)
      .map(([key, value]) => ({ Key: key, Value: value }));
    if (tagsToAdd.length > 0) {
      await this.autoscaling.tagResource({
        ResourceARN: this.get('arn'),
        Tags: tagsToAdd.reduce((acc, tag) => {
          // @ts-ignore
          acc[tag.Key] = tag.Value;
          return acc;
        }, {}),
      });
    }
    if (tagsToRemove.length > 0) {
      await this.autoscaling.untagResource({
        ResourceARN: this.get('arn'),
        TagKeys: tagsToRemove.map((tag) => tag.Key),
      });
    }
  }

  async _reconcile() {
    const { ScalableTargets } = await this.autoscaling.describeScalableTargets({
      ResourceIds: [this.get('resourceId')],
      ServiceNamespace: this.get('serviceNamespace'),
      ScalableDimension: this.get('scalableDimension'),
    });
    if (!ScalableTargets || ScalableTargets.length === 0) {
      const { ScalableTargetARN } =
        await this.autoscaling.registerScalableTarget({
          ResourceId: this.get('resourceId'),
          ServiceNamespace: this.get('serviceNamespace'),
          ScalableDimension: this.get('scalableDimension'),
          MinCapacity: this.get('minCapacity'),
          MaxCapacity: this.get('maxCapacity'),
          RoleARN: this.get('roleArn'),
        });
      this.set('arn', ScalableTargetARN);
    } else {
      this.set('arn', ScalableTargets[0].ScalableTargetARN);
    }
    await this._reconcileTags();
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

export default AutoscalingTarget;
