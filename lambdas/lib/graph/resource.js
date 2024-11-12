const { createId } = require('../id');
const { version: WHARFIE_VERSION } = require('../../../package.json');

/**
 * @typedef {('ACTIVE'|
 * 'INACTIVE'
 * )} WharfieResourceStatusEnum
 */

/**
 * @type {Object<WharfieResourceStatusEnum,WharfieResourceStatusEnum>}
 */
const Status = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
};

/**
 * @typedef ResourceOptions
 * @property {string} [id] - Id of the resource
 * @property {number} [version] - Id of the resource
 * @property {WharfieResourceStatusEnum} [status] - status of the resource
 * @property {string} region - aws region of the resource
 * @property {string} [source_region] - aws region of the source data, not set for models
 * @property {string} athena_workgroup - name of the stack's athena workgroup
 * @property {import('../../typedefs').DaemonConfig} daemon_config -
 * @property {import('../actor/resources/wharfie-resource').WharfieResourceProperties & import('../actor/typedefs').SharedProperties} resource_properties -
 * @property {import('../../typedefs').TableProperties} source_properties -
 * @property {import('../../typedefs').TableProperties} destination_properties -
 * @property {number} [created_at] - created timestamp
 * @property {number} [last_updated_at] - update_at_timestamp
 * @property {string} [wharfie_version] -
 */

class Resource {
  /**
   * @param {ResourceOptions} options -
   */
  constructor({
    id = createId(),
    version = 0,
    status = Status.ACTIVE,
    region,
    source_region,
    athena_workgroup,
    daemon_config,
    resource_properties,
    source_properties,
    destination_properties,
    created_at = Date.now(),
    last_updated_at = created_at,
    wharfie_version = WHARFIE_VERSION,
  }) {
    this.id = id;
    this.version = version;
    this.status = status;
    this.region = region;
    this.source_region = source_region;
    this.athena_workgroup = athena_workgroup;
    this.daemon_config = daemon_config;
    this.resource_properties = resource_properties;
    this.source_properties = source_properties;
    this.destination_properties = destination_properties;
    this.created_at = created_at;
    this.last_updated_at = last_updated_at;
    this.wharfie_version = wharfie_version;
  }

  toString() {
    return this.id;
  }

  /**
   * @returns {import('./typedefs').ResourceRecord} -
   */
  toRecord() {
    return {
      resource_id: this.id,
      sort_key: `${this.id}`,
      data: {
        id: this.id,
        version: this.version,
        status: this.status,
        region: this.region,
        source_region: this.source_region,
        athena_workgroup: this.athena_workgroup,
        daemon_config: this.daemon_config,
        resource_properties: this.resource_properties,
        source_properties: this.source_properties,
        destination_properties: this.destination_properties,
        created_at: this.created_at,
        last_updated_at: this.last_updated_at,
        wharfie_version: this.wharfie_version,
        record_type: Resource.RecordType,
      },
    };
  }

  /**
   * @param {import('./typedefs').ResourceRecord} resource_record -
   * @returns {Resource} -
   */
  static fromRecord(resource_record) {
    return new Resource({
      id: resource_record.data.id,
      version: resource_record.data.version,
      status: resource_record.data.status,
      region: resource_record.data.region,
      source_region: resource_record.data.source_region,
      athena_workgroup: resource_record.data.athena_workgroup,
      daemon_config: resource_record.data.daemon_config,
      resource_properties: resource_record.data.resource_properties,
      source_properties: resource_record.data.source_properties,
      destination_properties: resource_record.data.destination_properties,
      created_at: resource_record.data.created_at,
      last_updated_at: resource_record.data.last_updated_at,
      wharfie_version: resource_record.data.wharfie_version,
    });
  }
}
Resource.Status = Status;
/**
 * @type {'RESOURCE'}
 */
Resource.RecordType = 'RESOURCE';

module.exports = Resource;
