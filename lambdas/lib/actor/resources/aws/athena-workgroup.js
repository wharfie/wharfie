import BaseResource from '../base-resource.js';
import BaseAWS from '../../../base.js';

import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import {
  AthenaClient,
  CreateWorkGroupCommand,
  DeleteWorkGroupCommand,
  GetWorkGroupCommand,
  ListTagsForResourceCommand,
  TagResourceCommand,
  UntagResourceCommand,
  UpdateWorkGroupCommand,
  InvalidRequestException,
} from '@aws-sdk/client-athena';

/**
 * @typedef AthenaWorkgroupProperties
 * @property {string} outputLocation -
 * @property {string} description -
 * @property {import('@aws-sdk/client-athena').Tag[]} [tags] -
 */

/**
 * @typedef AthenaWorkgroupOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {AthenaWorkgroupProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 */

class AthenaService {
  /**
   * @param {import('@aws-sdk/client-athena').AthenaClientConfig} [options] -
   */
  constructor(options = {}) {
    const credentials = fromNodeProviderChain();
    this.client = new AthenaClient({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import('@aws-sdk/client-athena').ListTagsForResourceCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').ListTagsForResourceCommandOutput>} -
   */
  async listTagsForResource(params) {
    return this.client.send(new ListTagsForResourceCommand(params));
  }

  /**
   * @param {import('@aws-sdk/client-athena').UntagResourceCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').UntagResourceCommandOutput>} -
   */
  async untagResource(params) {
    return this.client.send(new UntagResourceCommand(params));
  }

  /**
   * @param {import('@aws-sdk/client-athena').TagResourceCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').TagResourceCommandOutput>} -
   */
  async tagResource(params) {
    return this.client.send(new TagResourceCommand(params));
  }

  /**
   * @param {import('@aws-sdk/client-athena').GetWorkGroupCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').GetWorkGroupCommandOutput>} -
   */
  async getWorkGroup(params) {
    return this.client.send(new GetWorkGroupCommand(params));
  }

  /**
   * @param {import('@aws-sdk/client-athena').UpdateWorkGroupCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').UpdateWorkGroupCommandOutput>} -
   */
  async updateWorkGroup(params) {
    return this.client.send(new UpdateWorkGroupCommand(params));
  }

  /**
   * @param {import('@aws-sdk/client-athena').CreateWorkGroupCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').CreateWorkGroupCommandOutput>} -
   */
  async createWorkGroup(params) {
    return this.client.send(new CreateWorkGroupCommand(params));
  }

  /**
   * @param {import('@aws-sdk/client-athena').DeleteWorkGroupCommandInput} params -
   * @returns {Promise<import('@aws-sdk/client-athena').DeleteWorkGroupCommandOutput>} -
   */
  async deleteWorkGroup(params) {
    return this.client.send(new DeleteWorkGroupCommand(params));
  }
}

class AthenaWorkGroup extends BaseResource {
  /**
   * @param {AthenaWorkgroupOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({
      name,
      parent,
      status,
      properties,
      dependsOn,
    });
    this.athena = new AthenaService();
  }

  async _reconcileTags() {
    const { Tags } = await this.athena.listTagsForResource({
      ResourceARN: this.get('arn'),
    });
    /** @type {import('@aws-sdk/client-athena').Tag[]} */
    const current_tags = Tags || [];
    /** @type {import('@aws-sdk/client-athena').Tag[]} */
    const desiredTags = this.get('tags', []);
    const tagsToAdd = desiredTags.filter(
      (tag) =>
        !current_tags.find((t) => t.Key === tag.Key && t.Value === tag.Value),
    );
    const tagsToRemove = current_tags.filter(
      (tag) =>
        !desiredTags.find((t) => t.Key === tag.Key && t.Value === tag.Value),
    );
    if (tagsToRemove.length > 0)
      await this.athena.untagResource({
        ResourceARN: this.get('arn'),
        TagKeys: tagsToRemove.map((tag) => tag.Key || ''),
      });
    if (tagsToAdd.length > 0)
      await this.athena.tagResource({
        ResourceARN: this.get('arn'),
        Tags: tagsToAdd,
      });
  }

  async _reconcile() {
    this.set(
      'arn',
      `arn:aws:athena:${this.get('deployment').region}:${
        this.get('deployment').accountId
      }:workgroup/${this.name}`,
    );
    try {
      const { WorkGroup } = await this.athena.getWorkGroup({
        WorkGroup: this.name,
      });
      const configuration = WorkGroup?.Configuration;
      if (
        configuration?.ResultConfiguration?.OutputLocation !==
        this.get('outputLocation')
      ) {
        await this.athena.updateWorkGroup({
          WorkGroup: this.name,
          ConfigurationUpdates: {
            ResultConfigurationUpdates: {
              OutputLocation: this.get('outputLocation'),
            },
          },
          Description: this.get('description'),
        });
      }
    } catch (error) {
      if (error instanceof InvalidRequestException) {
        await this.athena.createWorkGroup({
          Name: this.name,
          Configuration: {
            ResultConfiguration: {
              OutputLocation: this.get('outputLocation'),
              EncryptionConfiguration: {
                EncryptionOption: 'SSE_S3',
              },
            },
            EnforceWorkGroupConfiguration: true,
            PublishCloudWatchMetricsEnabled: true,
            EngineVersion: {
              SelectedEngineVersion: 'Athena engine version 3',
            },
          },
          ...(this.has('tags') && this.get('tags').length > 0
            ? { Tags: this.get('tags') }
            : {}),
          Description: this.get('description'),
        });
      } else {
        throw error;
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    await this.athena.deleteWorkGroup({
      WorkGroup: this.name,
      RecursiveDeleteOption: true,
    });
  }
}

export default AthenaWorkGroup;
