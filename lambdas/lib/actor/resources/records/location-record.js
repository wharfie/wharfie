'use strict';
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');

/**
 * @typedef LocationRecordProperties
 * @property {import('../../../../typedefs').LocationRecord | function(): import('../../../../typedefs').LocationRecord} data -
 * @property {string} table_name -
 */

/**
 * @typedef LocationRecordOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {LocationRecordProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class LocationRecord extends BaseResource {
  /**
   * @param {LocationRecordOptions} options -
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
    process.env.LOCATION_TABLE = this.get('table_name');
    const location_db = require('../../../../lib/dynamo/location');
    await location_db.putLocation(this.get('data', {}));
  }

  async _destroy() {
    process.env.LOCATION_TABLE = this.get('table_name');
    const location_db = require('../../../../lib/dynamo/location');
    try {
      await location_db.deleteLocation(this.get('data', {}));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

module.exports = LocationRecord;
