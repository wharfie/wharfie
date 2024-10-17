'use strict';
const AWS = require('@aws-sdk/client-iam');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class IAM {
  /**
   * @param {import("@aws-sdk/client-iam").IAMClientConfig} options - STS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.iam = new AWS.IAM({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-iam").GetRoleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").GetRoleCommandOutput>} -
   */
  async getRole(params) {
    const command = new AWS.GetRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").CreateRoleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").CreateRoleCommandOutput>} -
   */
  async createRole(params) {
    const command = new AWS.CreateRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").UpdateRoleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").UpdateRoleCommandOutput>} -
   */
  async updateRole(params) {
    const command = new AWS.UpdateRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DeleteRoleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").DeleteRoleCommandOutput>} -
   */
  async deleteRole(params) {
    const command = new AWS.DeleteRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").PutRolePolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").PutRolePolicyCommandOutput>} -
   */
  async putRolePolicy(params) {
    const command = new AWS.PutRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListRolePoliciesCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").ListRolePoliciesCommandOutput>} -
   */
  async listRolePolicies(params) {
    const command = new AWS.ListRolePoliciesCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DeleteRolePolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").DeleteRolePolicyCommandOutput>} -
   */
  async deleteRolePolicy(params) {
    const command = new AWS.DeleteRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").CreatePolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").CreatePolicyCommandOutput>} -
   */
  async createPolicy(params) {
    const command = new AWS.CreatePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").GetPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").GetPolicyCommandOutput>} -
   */
  async getPolicy(params) {
    const command = new AWS.GetPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DeletePolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").DeletePolicyCommandOutput>} -
   */
  async deletePolicy(params) {
    const command = new AWS.DeletePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").AttachRolePolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").AttachRolePolicyCommandOutput>} -
   */
  async attachRolePolicy(params) {
    const command = new AWS.AttachRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DetachRolePolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").DetachRolePolicyCommandOutput>} -
   */
  async detachRolePolicy(params) {
    const command = new AWS.DetachRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListAttachedRolePoliciesCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").ListAttachedRolePoliciesCommandOutput>} -
   */
  async listAttachedRolePolicies(params) {
    const command = new AWS.ListAttachedRolePoliciesCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListEntitiesForPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").ListEntitiesForPolicyCommandOutput>} -
   */
  async listEntitiesForPolicy(params) {
    const command = new AWS.ListEntitiesForPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListPolicyTagsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").ListPolicyTagsCommandOutput>} -
   */
  async listPolicyTags(params) {
    const command = new AWS.ListPolicyTagsCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").TagPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").TagPolicyCommandOutput>} -
   */
  async tagPolicy(params) {
    const command = new AWS.TagPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").UntagPolicyCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").UntagPolicyCommandOutput>} -
   */
  async untagPolicy(params) {
    const command = new AWS.UntagPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListRoleTagsCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").ListRoleTagsCommandOutput>} -
   */
  async listRoleTags(params) {
    const command = new AWS.ListRoleTagsCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").TagRoleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").TagRoleCommandOutput>} -
   */
  async tagRole(params) {
    const command = new AWS.TagRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").UntagRoleCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-iam").UntagRoleCommandOutput>} -
   */
  async untagRole(params) {
    const command = new AWS.UntagRoleCommand(params);
    return await this.iam.send(command);
  }
}

module.exports = IAM;
