'use strict';
const BaseResource = require('../base-resource');
const location_db = require('../../../../lib/dynamo/location');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');

/**
 * @typedef LocationRecordProperties
 * @property {import('../../../../typedefs').LocationRecord | function(): import('../../../../typedefs').LocationRecord} data -
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
    await location_db.putLocation(this.get('data', {}));
  }

  async _destroy() {
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
