import IAM from '../../../aws/iam.js';
import BaseResource from '../base-resource.js';
import { NoSuchEntityException } from '@aws-sdk/client-iam';

/**
 * @typedef PolicyProperties
 * @property {string} description - description.
 * @property {any |function(): any} document - document.
 * @property {import('@aws-sdk/client-iam').Tag[]} [tags] - tags.
 */

/**
 * @typedef PolicyOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {PolicyProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class Policy extends BaseResource {
  /**
   * @param {PolicyOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.iam = new IAM({});
    this.set(
      'arn',
      () =>
        `arn:aws:iam::${this.get('deployment').accountId}:policy/${this.name}`,
    );
  }

  async _reconcileTags() {
    const { Tags } = await this.iam.listPolicyTags({
      PolicyArn: this.get('arn'),
    });
    const exitingTags = Tags || [];
    const desiredTags = this.get('tags') || [];
    const tagsToAdd = desiredTags.filter(
      (/** @type {import('@aws-sdk/client-iam').Tag} */ desiredTag) =>
        !exitingTags.some(
          (existingTag) =>
            existingTag.Key === desiredTag.Key &&
            existingTag.Value === desiredTag.Value,
        ),
    );
    const tagsToRemove = exitingTags.filter(
      (existingTag) =>
        !desiredTags.some(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ desiredTag) =>
            desiredTag.Key === existingTag.Key &&
            desiredTag.Value === existingTag.Value,
        ),
    );
    if (tagsToAdd.length > 0) {
      await this.iam.tagPolicy({
        PolicyArn: this.get('arn'),
        Tags: tagsToAdd,
      });
    }
    if (tagsToRemove.length > 0) {
      await this.iam.untagPolicy({
        PolicyArn: this.get('arn'),
        TagKeys: tagsToRemove.map((tag) => tag.Key || ''),
      });
    }
  }

  async _reconcile() {
    try {
      await this.iam.getPolicy({
        PolicyArn: this.get('arn'),
      });
    } catch (error) {
      if (error instanceof NoSuchEntityException) {
        await this.iam.createPolicy({
          PolicyName: this.name,
          Description: this.get('description'),
          PolicyDocument: JSON.stringify(this.get('document')),
          Tags: this.get('tags') || [],
        });
      } else {
        throw error;
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      const { PolicyRoles } = await this.iam.listEntitiesForPolicy({
        PolicyArn: this.get('arn'),
      });
      if (PolicyRoles) {
        while (PolicyRoles.length > 0) {
          const policyRole = PolicyRoles.shift();
          await this.iam.detachRolePolicy({
            PolicyArn: this.get('arn'),
            RoleName: policyRole?.RoleName,
          });
        }
      }
      await this.iam.deletePolicy({
        PolicyArn: this.get('arn'),
      });
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }
  }
}

export default Policy;
