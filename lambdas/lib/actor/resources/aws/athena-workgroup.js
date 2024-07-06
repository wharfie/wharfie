'use strict';
const Athena = require('../../../athena');
const BaseResource = require('../base-resource');

const { InvalidRequestException } = require('@aws-sdk/client-athena');

/**
 * @typedef AthenaWorkgroupProperties
 * @property {string} outputLocation -
 * @property {string} description -
 * @property {import('@aws-sdk/client-athena').Tag[]} [tags] -
 */

/**
 * @typedef AthenaWorkgroupOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {AthenaWorkgroupProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class AthenaWorkGroup extends BaseResource {
  /**
   * @param {AthenaWorkgroupOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.athena = new Athena({});
  }

  async _reconcile() {
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
          Tags: this.get('tags'),
          Description: this.get('description'),
        });
      } else {
        throw error;
      }
    }
  }

  async _destroy() {
    await this.athena.deleteWorkGroup({
      WorkGroup: this.name,
      RecursiveDeleteOption: true,
    });
  }
}

module.exports = AthenaWorkGroup;
