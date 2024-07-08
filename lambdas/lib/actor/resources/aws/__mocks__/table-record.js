'use strict';
const BaseResource = require('../../base-resource');

/**
 * @typedef TableRecordProperties
 * @property {string} tableName -
 * @property {string} keyValue -
 * @property {string} [keyName] -
 * @property {string} [sortKeyValue] -
 * @property {string} [sortKeyName] -
 * @property {any} data -
 */

/**
 * @typedef TableRecordOptions
 * @property {string} name -
 * @property {import('../../reconcilable').Status} [status] -
 * @property {TableRecordProperties & import('../../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../../reconcilable')[]} [dependsOn] -
 */

class TableRecord extends BaseResource {
  /**
   * @param {TableRecordOptions} options -
   */
  constructor({ name, status, dependsOn = [], properties }) {
    const propertiesWithDefaults = Object.assign(
      {
        keyName: 'key',
        sortKeyName: 'sort_key',
      },
      properties
    );
    super({ name, status, dependsOn, properties: propertiesWithDefaults });
  }

  async _reconcile() {}

  async _destroy() {}
}

module.exports = TableRecord;
