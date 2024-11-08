'use strict';
const IAM = require('../../../iam');
const BaseResource = require('../base-resource');
const { NoSuchEntityException } = require('@aws-sdk/client-iam');
const { createShortId } = require('../../../id');
/**
 * @typedef RoleProperties
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
 * @property {import('../reconcilable').Status} [status] -
 * @property {RoleProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Role extends BaseResource {
  /**
   * @param {RoleOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.iam = new IAM({});
  }

  async _reconcileTags() {
    const { Tags } = await this.iam.listRoleTags({
      RoleName: this.getRoleName(),
    });
    const currentTags = Tags || [];
    const desiredTags = this.get('tags') || [];
    const tagsToAdd = desiredTags.filter(
      (/** @type {import('@aws-sdk/client-iam').Tag} */ desiredTag) =>
        !currentTags.some(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ currentTag) =>
            currentTag.Key === desiredTag.Key &&
            currentTag.Value === desiredTag.Value
        )
    );
    const tagsToRemove = currentTags.filter(
      (/** @type {import('@aws-sdk/client-iam').Tag} */ currentTag) =>
        !desiredTags.some(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ desiredTag) =>
            desiredTag.Key === currentTag.Key &&
            desiredTag.Value === currentTag.Value
        )
    );
    if (tagsToAdd.length > 0) {
      await this.iam.tagRole({
        RoleName: this.getRoleName(),
        Tags: tagsToAdd,
      });
    }
    if (tagsToRemove.length > 0) {
      await this.iam.untagRole({
        RoleName: this.getRoleName(),
        TagKeys: tagsToRemove.map(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ tag) =>
            tag.Key || ''
        ),
      });
    }
  }

  getRoleName() {
    return `${this.name.substring(0, 57)}_${this.get('id')}`;
  }

  async _reconcile() {
    const existingId = this.has('id');
    if (!existingId) {
      this.set('id', createShortId());
    }
    try {
      const { Role } = await this.iam.getRole({
        RoleName: this.getRoleName(),
      });
      this.set('arn', Role?.Arn);
    } catch (error) {
      if (error instanceof NoSuchEntityException) {
        const { Role } = await this.iam.createRole({
          RoleName: this.getRoleName(),
          Description: this.get('description'),
          AssumeRolePolicyDocument: JSON.stringify(
            this.get('assumeRolePolicyDocument')
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
        RoleName: this.getRoleName(),
        PolicyName: `${this.getRoleName()}_policy`,
        PolicyDocument: JSON.stringify(this.get('rolePolicyDocument')),
      });
    }
    if (this.has('managedPolicyArns')) {
      await Promise.all(
        this.get('managedPolicyArns').map(
          (/** @type {string} */ managedPolicyArn) =>
            this.iam.attachRolePolicy({
              RoleName: this.getRoleName(),
              PolicyArn: managedPolicyArn,
            })
        )
      );
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      const { AttachedPolicies } = await this.iam.listAttachedRolePolicies({
        RoleName: this.getRoleName(),
      });
      for (const AttachedPolicy of AttachedPolicies || []) {
        await this.iam.detachRolePolicy({
          RoleName: this.getRoleName(),
          PolicyArn: AttachedPolicy.PolicyArn,
        });
      }
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }

    try {
      const { PolicyNames } = await this.iam.listRolePolicies({
        RoleName: this.getRoleName(),
      });
      for (const policyName of PolicyNames || []) {
        await this.iam.deleteRolePolicy({
          RoleName: this.getRoleName(),
          PolicyName: policyName,
        });
      }
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }

    try {
      await this.iam.deleteRole({
        RoleName: this.getRoleName(),
      });
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }
  }
}

module.exports = Role;
