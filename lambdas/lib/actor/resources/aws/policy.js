'use strict';
const IAM = require('../../../iam');
const BaseResource = require('../base-resource');
const { NoSuchEntityException } = require('@aws-sdk/client-iam');

/**
 * @typedef PolicyProperties
 * @property {string} description -
 * @property {any |function(): any} document -
 */

/**
 * @typedef PolicyOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {PolicyProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Policy extends BaseResource {
  /**
   * @param {PolicyOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.iam = new IAM({});
    this.set(
      'arn',
      () =>
        `arn:aws:iam::${this.get('deployment').accountId}:policy/${this.name}`
    );
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
        });
      } else {
        throw error;
      }
    }
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

module.exports = Policy;
