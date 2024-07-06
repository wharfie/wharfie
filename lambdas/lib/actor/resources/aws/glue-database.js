'use strict';
const Glue = require('../../../glue');
const BaseResource = require('../base-resource');
const { EntityNotFoundException } = require('@aws-sdk/client-glue');

/**
 * @typedef GlueDatabaseOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class GlueDatabase extends BaseResource {
  /**
   * @param {GlueDatabaseOptions} options -
   */
  constructor({ name, status, dependsOn = [], properties }) {
    super({ name, status, dependsOn, properties });
    this.glue = new Glue({});
  }

  async _reconcile() {
    try {
      await this.glue.getDatabase({ Name: this.name });
    } catch (error) {
      if (error instanceof EntityNotFoundException) {
        await this.glue.createDatabase({
          DatabaseInput: {
            Name: this.name,
          },
        });
      } else {
        throw error;
      }
    }
  }

  async _destroy() {
    try {
      await this.glue.deleteDatabase({
        Name: this.name,
      });
    } catch (error) {
      if (!(error instanceof EntityNotFoundException)) {
        throw error;
      }
    }
  }
}

module.exports = GlueDatabase;
