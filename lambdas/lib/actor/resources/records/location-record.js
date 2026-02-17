import BaseResource from '../base-resource.js';
import { ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import {
  putLocation,
  deleteLocation,
} from '../../../../lib/aws/dynamo/location.js';

/**
 * @typedef LocationRecordProperties
 * @property {import('../../../../typedefs.js').LocationRecord | function(): import('../../../../typedefs.js').LocationRecord} data - data.
 * @property {string} table_name - table_name.
 */

/**
 * @typedef LocationRecordOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {LocationRecordProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class LocationRecord extends BaseResource {
  /**
   * @param {LocationRecordOptions} options - options.
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
    await putLocation(this.get('data', {}), this.get('table_name'));
  }

  async _destroy() {
    try {
      await deleteLocation(this.get('data', {}), this.get('table_name'));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

export default LocationRecord;
