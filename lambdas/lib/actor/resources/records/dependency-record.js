import BaseResource from '../base-resource.js';
import { ResourceNotFoundException } from '@aws-sdk/client-dynamodb';
import {
  putDependency,
  deleteDependency,
} from '../../../../lib/aws/dynamo/dependency.js';

/**
 * @typedef DependencyRecordProperties
 * @property {import('../../../../typedefs.js').DependencyRecord | function(): import('../../../../typedefs.js').DependencyRecord} data - data.
 * @property {string} table_name - table_name.
 */

/**
 * @typedef DependencyRecordOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {DependencyRecordProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class DependencyRecord extends BaseResource {
  /**
   * @param {DependencyRecordOptions} options - options.
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
    await putDependency(this.get('data', {}), this.get('table_name'));
  }

  async _destroy() {
    try {
      await deleteDependency(this.get('data', {}), this.get('table_name'));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

export default DependencyRecord;
