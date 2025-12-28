import IAM from '../../../iam.js';
import BaseResource from '../base-resource.js';
import { NoSuchEntityException } from '@aws-sdk/client-iam';
/**
 * @typedef RoleProperties
 * @property {string} [roleName] -
 * @property {string} description -
 * @property {any | function } assumeRolePolicyDocument -
 * @property {string[] | (() => string[]) } [managedPolicyArns] -
 * @property {any} [rolePolicyDocument] -
 * @property {import('@aws-sdk/client-iam').Tag[]} [tags] -
 */

/**
 * @typedef RoleOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {RoleProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 */

class Role extends BaseResource {
  /**
   * @param {RoleOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    if (!properties.roleName) {
      const propertiesWithDefaults = Object.assign(
        {
          roleName: `${name.substring(0, 64)}`,
        },
        properties,
      );
      super({
        name,
        parent,
        status,
        dependsOn,
        properties: propertiesWithDefaults,
      });
    } else {
      super({ name, parent, status, dependsOn, properties });
    }
    this.iam = new IAM({});
  }

  async _reconcileTags() {
    const { Tags } = await this.iam.listRoleTags({
      RoleName: this.get('roleName'),
    });
    const currentTags = Tags || [];
    const desiredTags = this.get('tags') || [];
    const tagsToAdd = desiredTags.filter(
      (/** @type {import('@aws-sdk/client-iam').Tag} */ desiredTag) =>
        !currentTags.some(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ currentTag) =>
            currentTag.Key === desiredTag.Key &&
            currentTag.Value === desiredTag.Value,
        ),
    );
    const tagsToRemove = currentTags.filter(
      (/** @type {import('@aws-sdk/client-iam').Tag} */ currentTag) =>
        !desiredTags.some(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ desiredTag) =>
            desiredTag.Key === currentTag.Key &&
            desiredTag.Value === currentTag.Value,
        ),
    );
    if (tagsToAdd.length > 0) {
      await this.iam.tagRole({
        RoleName: this.get('roleName'),
        Tags: tagsToAdd,
      });
    }
    if (tagsToRemove.length > 0) {
      await this.iam.untagRole({
        RoleName: this.get('roleName'),
        TagKeys: tagsToRemove.map(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ tag) =>
            tag.Key || '',
        ),
      });
    }
  }

  async _reconcile() {
    try {
      const { Role } = await this.iam.getRole({
        RoleName: this.get('roleName'),
      });
      this.set('arn', Role?.Arn);
    } catch (error) {
      if (error instanceof NoSuchEntityException) {
        const { Role } = await this.iam.createRole({
          RoleName: this.get('roleName'),
          Description: this.get('description'),
          AssumeRolePolicyDocument: JSON.stringify(
            this.get('assumeRolePolicyDocument'),
          ),
          Tags: this.get('tags') || [],
        });
        this.set('arn', Role?.Arn);
      } else {
        throw error;
      }
    }
    if (this.has('rolePolicyDocument') && this.get('rolePolicyDocument')) {
      await this.iam.putRolePolicy({
        RoleName: this.get('roleName'),
        PolicyName: `${this.get('roleName')}_policy`,
        PolicyDocument: JSON.stringify(this.get('rolePolicyDocument')),
      });
    }
    if (this.has('managedPolicyArns')) {
      await Promise.all(
        this.get('managedPolicyArns').map(
          (/** @type {string} */ managedPolicyArn) =>
            this.iam.attachRolePolicy({
              RoleName: this.get('roleName'),
              PolicyArn: managedPolicyArn,
            }),
        ),
      );
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      const { AttachedPolicies } = await this.iam.listAttachedRolePolicies({
        RoleName: this.get('roleName'),
      });
      for (const AttachedPolicy of AttachedPolicies || []) {
        await this.iam.detachRolePolicy({
          RoleName: this.get('roleName'),
          PolicyArn: AttachedPolicy.PolicyArn,
        });
      }
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }

    try {
      const { PolicyNames } = await this.iam.listRolePolicies({
        RoleName: this.get('roleName'),
      });
      for (const policyName of PolicyNames || []) {
        await this.iam.deleteRolePolicy({
          RoleName: this.get('roleName'),
          PolicyName: policyName,
        });
      }
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }

    try {
      await this.iam.deleteRole({
        RoleName: this.get('roleName'),
      });
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }
  }
}

export default Role;
