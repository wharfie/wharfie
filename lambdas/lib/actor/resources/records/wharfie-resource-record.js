'use strict';
const BaseResource = require('../base-resource');
const resource_db = require('../../../../lib/dynamo/operations');
const Resource = require('../../../../lib/graph/resource');
const S3 = require('../../../s3');

/**
 * @typedef WharfieResourceRecordProperties
 * @property {import('../../../../lib/graph/typedefs').ResourceRecord | function(): import('../../../../lib/graph/typedefs').ResourceRecord} data -
 */

/**
 * @typedef WharfieResourceRecordOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {WharfieResourceRecordProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class WharfieResourceRecord extends BaseResource {
  /**
   * @param {WharfieResourceRecordOptions} options -
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
        resource.source_properties.location
      );
      resource.source_region = await this.s3.findBucketRegion({
        Bucket: bucket,
      });
    }
    await resource_db.putResource(Resource.fromRecord(this.get('data')));
  }

  async _destroy() {
    await resource_db.deleteResource(Resource.fromRecord(this.get('data')));
  }
}

module.exports = WharfieResourceRecord;
