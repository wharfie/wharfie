'use strict';
const IAM = require('../../../iam');
// const STS = require('../../../sts');
// const { createId } = require('../../../id');
const BaseResource = require('../base-resource');
const { NoSuchEntityException } = require('@aws-sdk/client-iam');

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
      RoleName: this.name,
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
        RoleName: this.name,
        Tags: tagsToAdd,
      });
    }
    if (tagsToRemove.length > 0) {
      await this.iam.untagRole({
        RoleName: this.name,
        TagKeys: tagsToRemove.map(
          (/** @type {import('@aws-sdk/client-iam').Tag} */ tag) =>
            tag.Key || ''
        ),
      });
    }
  }

  async _reconcile() {
    try {
      const { Role } = await this.iam.getRole({
        RoleName: this.name,
      });
      this.set('arn', Role?.Arn);
    } catch (error) {
      if (error instanceof NoSuchEntityException) {
        const { Role } = await this.iam.createRole({
          RoleName: this.name,
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
        RoleName: this.name,
        PolicyName: `${this.name}_policy`,
        PolicyDocument: JSON.stringify(this.get('rolePolicyDocument')),
      });
    }
    if (this.has('managedPolicyArns')) {
      await Promise.all(
        this.get('managedPolicyArns').map(
          (/** @type {string} */ managedPolicyArn) =>
            this.iam.attachRolePolicy({
              RoleName: this.name,
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
        RoleName: this.name,
      });
      for (const AttachedPolicy of AttachedPolicies || []) {
        await this.iam.detachRolePolicy({
          RoleName: this.name,
          PolicyArn: AttachedPolicy.PolicyArn,
        });
      }
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }

    try {
      const { PolicyNames } = await this.iam.listRolePolicies({
        RoleName: this.name,
      });
      for (const policyName of PolicyNames || []) {
        await this.iam.deleteRolePolicy({
          RoleName: this.name,
          PolicyName: policyName,
        });
      }
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }

    try {
      await this.iam.deleteRole({
        RoleName: this.name,
      });
    } catch (error) {
      if (!(error instanceof NoSuchEntityException)) throw error;
    }
  }
}

module.exports = Role;
