import BaseResource from '../base-resource.js';
import Resource from '../../../../lib/graph/resource.js';
import S3 from '../../../aws/s3.js';
import {
  putResource,
  deleteResource,
} from '../../../../lib/aws/dynamo/operations.js';
import { ResourceNotFoundException } from '@aws-sdk/client-dynamodb';

/**
 * @typedef WharfieResourceRecordProperties
 * @property {import('../../../../lib/graph/typedefs.js').ResourceRecord | function(): import('../../../../lib/graph/typedefs.js').ResourceRecord} data - data.
 * @property {string} table_name - table_name.
 */

/**
 * @typedef WharfieResourceRecordOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {WharfieResourceRecordProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class WharfieResourceRecord extends BaseResource {
  /**
   * @param {WharfieResourceRecordOptions} options - options.
   */
  constructor({ name, parent, status, dependsOn = [], properties }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
    });
    this.s3 = new S3();
  }

  async _reconcile() {
    const resource = Resource.fromRecord(this.get('data'));
    if (!resource.source_region && resource.source_properties.location) {
      const { bucket } = this.s3.parseS3Uri(
        resource.source_properties.location,
      );
      resource.source_region = await this.s3.findBucketRegion({
        Bucket: bucket,
      });
    }
    await putResource(resource, this.get('table_name'));
  }

  async _destroy() {
    try {
      await deleteResource(
        Resource.fromRecord(this.get('data')),
        this.get('table_name'),
      );
    } catch (e) {
      if (!(e instanceof ResourceNotFoundException)) {
        throw e;
      }
    }
  }
}

export default WharfieResourceRecord;
