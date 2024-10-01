const { version: WHARFIE_VERSION } = require('../../package.json');

/**
 * @typedef {(
 * 'WHARFIE:OPERATION:COMPLETED'|'WHARFIE:OPERATION:FAILED'
 * )} WharfieEventStatusEnum
/**
 * @typedef {(
 * 'WHARFIE:OPERATION:COMPLETED'|'WHARFIE:OPERATION:FAILED'
 * )} WharfieEventTypeEnum
 */
/**
 * @type {Object<WharfieEventTypeEnum,WharfieEventTypeEnum>}
 */
const Type = {
  'WHARFIE:OPERATION:COMPLETED': 'WHARFIE:OPERATION:COMPLETED',
  'WHARFIE:OPERATION:SCHEDULE': 'WHARFIE:OPERATION:SCHEDULE',
};

/**
 * @typedef WharfieOperationCompletedEventData
 * @property {import('../lib/graph/operation').WharfieOperationTypeEnum} operation_type -
 * @property {string} database_name -
 * @property {string} table_name -
 */

/**
 * @typedef WharfieOperationScheduleEventData
 * @property {import('../lib/graph/operation').WharfieOperationTypeEnum} operation_type -
 */
/**
 * @typedef {WharfieOperationCompletedEventData | WharfieOperationScheduleEventData} WharfieEventData
 */

/**
 * @typedef WharfieEventProperties
 * @property {string} resource_id -
 * @property {WharfieEventTypeEnum} type -
 * @property {WharfieEventData} data -
 * @property {string} [status] -
 * @property {string} [version] -
 * @property {number} [retries] -
 */

class WharfieEvent {
  /**
   * @param {WharfieEventProperties} properties -
   */
  constructor({
    resource_id,
    type,
    data,
    version = WHARFIE_VERSION,
    retries = 0,
  }) {
    this.resource_id = resource_id;
    this.version = version;
    this.data = data;
    this.type = type;
    this.retries = retries;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({
      resource_id: this.resource_id,
      type: this.type,
      data: this.data,
      version: this.version,
      retries: this.retries,
    });
  }

  /**
   * @param {WharfieEventProperties} record -
   * @returns {WharfieEvent} -
   */
  static fromEvent(record) {
    return new WharfieEvent({
      resource_id: record.resource_id,
      type: record.type,
      data: record.data,
      version: record.version,
      retries: record.retries,
    });
  }

  /**
   * @param {any} record -
   * @returns {boolean} -
   */
  static is(record) {
    if (record.type && record.resource_id) {
      return Object.values(Type).includes(record.type);
    }
    return false;
  }
}
/**
 * @type {Object<WharfieEventTypeEnum,WharfieEventTypeEnum>}
 */
WharfieEvent.Type = Type;

module.exports = WharfieEvent;
