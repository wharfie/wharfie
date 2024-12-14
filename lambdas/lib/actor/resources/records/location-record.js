'use strict';
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');
const location_db = require('../../../../lib/dynamo/location');

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
    await location_db.putLocation(this.get('data', {}), this.get('table_name'));
  }

  async _destroy() {
    try {
      await location_db.deleteLocation(
        this.get('data', {}),
        this.get('table_name')
      );
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

module.exports = LocationRecord;
