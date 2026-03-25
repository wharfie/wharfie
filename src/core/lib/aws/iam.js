import {
  IAM as _IAM,
  GetRoleCommand,
  CreateRoleCommand,
  UpdateRoleCommand,
  DeleteRoleCommand,
  PutRolePolicyCommand,
  ListRolePoliciesCommand,
  DeleteRolePolicyCommand,
  CreatePolicyCommand,
  GetPolicyCommand,
  DeletePolicyCommand,
  AttachRolePolicyCommand,
  DetachRolePolicyCommand,
  ListAttachedRolePoliciesCommand,
  ListEntitiesForPolicyCommand,
  ListPolicyTagsCommand,
  TagPolicyCommand,
  UntagPolicyCommand,
  ListRoleTagsCommand,
  TagRoleCommand,
  UntagRoleCommand,
} from '@aws-sdk/client-iam';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

class IAM {
  /**
   * @param {import("@aws-sdk/client-iam").IAMClientConfig} options - STS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.iam = new _IAM({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-iam").GetRoleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").GetRoleCommandOutput>} - Result.
   */
  async getRole(params) {
    const command = new GetRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").CreateRoleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").CreateRoleCommandOutput>} - Result.
   */
  async createRole(params) {
    const command = new CreateRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").UpdateRoleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").UpdateRoleCommandOutput>} - Result.
   */
  async updateRole(params) {
    const command = new UpdateRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DeleteRoleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").DeleteRoleCommandOutput>} - Result.
   */
  async deleteRole(params) {
    const command = new DeleteRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").PutRolePolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").PutRolePolicyCommandOutput>} - Result.
   */
  async putRolePolicy(params) {
    const command = new PutRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListRolePoliciesCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").ListRolePoliciesCommandOutput>} - Result.
   */
  async listRolePolicies(params) {
    const command = new ListRolePoliciesCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DeleteRolePolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").DeleteRolePolicyCommandOutput>} - Result.
   */
  async deleteRolePolicy(params) {
    const command = new DeleteRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").CreatePolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").CreatePolicyCommandOutput>} - Result.
   */
  async createPolicy(params) {
    const command = new CreatePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").GetPolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").GetPolicyCommandOutput>} - Result.
   */
  async getPolicy(params) {
    const command = new GetPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DeletePolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").DeletePolicyCommandOutput>} - Result.
   */
  async deletePolicy(params) {
    const command = new DeletePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").AttachRolePolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").AttachRolePolicyCommandOutput>} - Result.
   */
  async attachRolePolicy(params) {
    const command = new AttachRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").DetachRolePolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").DetachRolePolicyCommandOutput>} - Result.
   */
  async detachRolePolicy(params) {
    const command = new DetachRolePolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListAttachedRolePoliciesCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").ListAttachedRolePoliciesCommandOutput>} - Result.
   */
  async listAttachedRolePolicies(params) {
    const command = new ListAttachedRolePoliciesCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListEntitiesForPolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").ListEntitiesForPolicyCommandOutput>} - Result.
   */
  async listEntitiesForPolicy(params) {
    const command = new ListEntitiesForPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListPolicyTagsCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").ListPolicyTagsCommandOutput>} - Result.
   */
  async listPolicyTags(params) {
    const command = new ListPolicyTagsCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").TagPolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").TagPolicyCommandOutput>} - Result.
   */
  async tagPolicy(params) {
    const command = new TagPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").UntagPolicyCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").UntagPolicyCommandOutput>} - Result.
   */
  async untagPolicy(params) {
    const command = new UntagPolicyCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").ListRoleTagsCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").ListRoleTagsCommandOutput>} - Result.
   */
  async listRoleTags(params) {
    const command = new ListRoleTagsCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").TagRoleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").TagRoleCommandOutput>} - Result.
   */
  async tagRole(params) {
    const command = new TagRoleCommand(params);
    return await this.iam.send(command);
  }

  /**
   * @param {import("@aws-sdk/client-iam").UntagRoleCommandInput} params - params.
   * @returns {Promise<import("@aws-sdk/client-iam").UntagRoleCommandOutput>} - Result.
   */
  async untagRole(params) {
    const command = new UntagRoleCommand(params);
    return await this.iam.send(command);
  }
}

export default IAM;
