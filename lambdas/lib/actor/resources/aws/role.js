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
 */

/**
 * @typedef RoleOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {RoleProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Role extends BaseResource {
  /**
   * @param {RoleOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.iam = new IAM({});
    // this.sts = new STS({});
  }

  async _reconcile() {
    let modified = false;
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
        });
        this.set('arn', Role?.Arn);
        modified = true;
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
    if (modified) {
      // await new Promise((resolve) => setTimeout(resolve, 5000));
    }
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

  /**
   *
   */
  // async validateRole() {
  //   const MAX_RETRY_TIMEOUT_SECONDS = 10;
  //   let validationAttempts = 0;
  //   let validated = false;
  //   do {
  //     try {
  //       const roleArn = this.get('arn');
  //       const sessionName = `iac-role-validtaion-session-${createId()}`;
  //       const assumedRole = await this.sts.assumeRole({
  //         RoleArn: roleArn,
  //         RoleSessionName: sessionName,
  //       });
  //       if (
  //         !assumedRole.Credentials ||
  //         !assumedRole.Credentials.AccessKeyId ||
  //         !assumedRole.Credentials.SecretAccessKey
  //       )
  //         throw new Error('No credentials returned');
  //       // const stsTestClient = new STS({
  //       //   credentials: {
  //       //     accessKeyId: assumedRole.Credentials.AccessKeyId,
  //       //     secretAccessKey: assumedRole.Credentials.SecretAccessKey,
  //       //     sessionToken: assumedRole.Credentials.SessionToken,
  //       //   },
  //       // });
  //       // await stsTestClient.getCallerIdentity();
  //       validated = true;
  //     } catch (error) {
  //       console.error('Error assuming role:', error);
  //       await new Promise((resolve) =>
  //         setTimeout(
  //           resolve,
  //           Math.floor(
  //             Math.random() *
  //               Math.min(
  //                 MAX_RETRY_TIMEOUT_SECONDS,
  //                 1 * Math.pow(2, validationAttempts)
  //               )
  //           ) * 1000
  //         )
  //       );
  //       validationAttempts++;
  //     }
  //   } while (!validated);
  // }
}

module.exports = Role;
