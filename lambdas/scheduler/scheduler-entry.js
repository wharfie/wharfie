const { version: WHARFIE_VERSION } = require('../../package.json');
const { AttributeValue } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

/**
 * @typedef {(
 * 'SCHEDULED'|'STARTED'
 * )} SchedulerEntryStatusEnum
 /**
 * @type {Object<SchedulerEntryStatusEnum,SchedulerEntryStatusEnum>}
 */
const Status = {
  SCHEDULED: 'SCHEDULED',
  STARTED: 'STARTED',
};

/**
 * @typedef SchedulerEntrySerialized
 * @property {string} resource_id -
 * @property {string} sort_key -
 * @property {SchedulerEntryPartition} [partition] -
 * @property {string} [status] -
 * @property {string} [version] -
 * @property {number} [retries] -
 */

/**
 * @typedef SchedulerEntryPartition
 * @property {string} location -
 * @property {string[]} partitionValues -
 */

/**
 * @typedef SchedulerEntryProperties
 * @property {string} resource_id -
 * @property {string} sort_key -
 * @property {SchedulerEntryPartition} [partition] -
 * @property {SchedulerEntryStatusEnum} [status] -
 * @property {string} [version] -
 * @property {number} [retries] -
 * @property {number} [ttl] -
 */

class SchedulerEntry {
  /**
   * @param {SchedulerEntryProperties} properties -
   */
  constructor({
    resource_id,
    sort_key,
    partition,
    status = SchedulerEntry.Status.SCHEDULED,
    version = WHARFIE_VERSION,
    retries = 0,
    ttl,
  }) {
    if (!resource_id) {
      throw new Error('resource_id is required');
    }
    if (!sort_key) {
      throw new Error('sort_key is required');
    }
    this.resource_id = resource_id;
    this.sort_key = sort_key;
    this.partition = partition;
    this.status = status;
    this.version = version;
    this.retries = retries;
    this.ttl = ttl;
  }

  /**
   * @returns {any} -
   */
  toEvent() {
    return {
      resource_id: this.resource_id,
      sort_key: this.sort_key,
      partition: this.partition,
      status: this.status,
      type: SchedulerEntry.EventType,
      version: this.version,
      retries: this.retries,
      ttl: this.ttl,
    };
  }

  /**
   * @param {any} event -
   * @returns {SchedulerEntry} -
   */
  static fromEvent(event) {
    return new SchedulerEntry({
      resource_id: event.resource_id,
      sort_key: event.sort_key,
      partition: event.partition,
      status: event.status,
      version: event.version,
      retries: event.retries,
      ttl: event.ttl,
    });
  }

  /**
   * @returns {Record<string, AttributeValue>} -
   */
  toRecord() {
    return marshall({
      resource_id: this.resource_id,
      sort_key: this.sort_key,
      partition: this.partition,
      status: this.status,
      version: this.version,
      retries: this.retries,
      ttl: this.ttl,
    });
  }

  /**
   * @param {Record<string, AttributeValue>} record -
   * @returns {SchedulerEntry} -
   */
  static fromRecord(record) {
    const unmarshalledRecord = unmarshall(record);
    return new SchedulerEntry({
      resource_id: unmarshalledRecord.resource_id,
      sort_key: unmarshalledRecord.sort_key,
      partition: unmarshalledRecord.partition,
      status: unmarshalledRecord.status,
      version: unmarshalledRecord.version,
      retries: unmarshalledRecord.retries,
      ttl: unmarshalledRecord.ttl,
    });
  }

  /**
   * @param {any} event -
   * @returns {boolean} -
   */
  static is(event) {
    if (event.type && event.resource_id && event.sort_key) {
      return event.type === SchedulerEntry.EventType;
    }
    return false;
  }
}
/**
 * @type {Object<SchedulerEntryStatusEnum,SchedulerEntryStatusEnum>}
 */
SchedulerEntry.Status = Status;

SchedulerEntry.EventType = 'SchedulerEntry';

module.exports = SchedulerEntry;