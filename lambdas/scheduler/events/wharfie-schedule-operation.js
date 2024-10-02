const { version: WHARFIE_VERSION } = require('../../../package.json');

const resource_db = require('../../lib/dynamo/operations');
const { schedule } = require('../schedule');

const logging = require('../../lib/logging');
const daemon_log = logging.getDaemonLogger();
/**
 * @type {'WHARFIE:OPERATION:SCHEDULE'}
 */
const TYPE = 'WHARFIE:OPERATION:SCHEDULE';

/**
 * @typedef WharfieEventProperties
 * @property {string} resource_id -
 * @property {string} operation_type -
 * @property {string} [status] -
 * @property {string} [version] -
 * @property {number} [retries] -
 */

class WharfieScheduleOperation {
  /**
   * @param {WharfieEventProperties} properties -
   */
  constructor({
    resource_id,
    operation_type,
    version = WHARFIE_VERSION,
    retries = 0,
  }) {
    this.resource_id = resource_id;
    this.operation_type = operation_type;
    this.version = version;
    this.retries = retries;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({
      resource_id: this.resource_id,
      operation_type: this.operation_type,
      type: TYPE,
      version: this.version,
      retries: this.retries,
    });
  }

  /**
   * @param {WharfieEventProperties} record -
   * @returns {WharfieScheduleOperation} -
   */
  static fromEvent(record) {
    return new WharfieScheduleOperation({
      resource_id: record.resource_id,
      operation_type: record.operation_type,
      version: record.version,
      retries: record.retries,
    });
  }

  /**
   * @param {any} record -
   * @returns {boolean} -
   */
  static is(record) {
    if (record.type && record.resource_id && record.operation_id) {
      return record.type === TYPE;
    }
    return false;
  }

  async process() {
    const resource = await resource_db.getResource(this.resource_id);
    if (!resource) {
      daemon_log.debug(`no resource found for ${this.resource_id}`);
      return;
    }
    const now = Date.now();
    const interval = resource.daemon_config?.SLA?.MaxDelay || 300;
    const ms = 1000 * interval; // convert s to ms
    const nowInterval = Math.round(now / ms) * ms;
    const before = nowInterval - 1000 * interval;

    await schedule({
      resource_id: this.resource_id,
      interval,
      window: [before, nowInterval],
    });
  }
}
WharfieScheduleOperation.Type = TYPE;

module.exports = WharfieScheduleOperation;
