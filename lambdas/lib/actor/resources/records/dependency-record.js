'use strict';
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');

/**
 * @typedef DependencyRecordProperties
 * @property {import('../../../../typedefs').DependencyRecord | function(): import('../../../../typedefs').DependencyRecord} data -
 * @property {string} table_name -
 */

/**
 * @typedef DependencyRecordOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {DependencyRecordProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class DependencyRecord extends BaseResource {
  /**
   * @param {DependencyRecordOptions} options -
   */
  constructor({ name, parent, status, dependsOn = [], properties }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
    });
  }

  async _reconcile() {
    process.env.DEPENDENCY_TABLE = this.get('table_name');
    const dependency_db = require('../../../../lib/dynamo/dependency');
    await dependency_db.putDependency(this.get('data', {}));
  }

  async _destroy() {
    process.env.DEPENDENCY_TABLE = this.get('table_name');
    const dependency_db = require('../../../../lib/dynamo/dependency');
    try {
      await dependency_db.deleteDependency(this.get('data', {}));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

module.exports = DependencyRecord;
