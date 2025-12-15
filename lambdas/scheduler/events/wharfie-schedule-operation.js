import * as resource_db from '../../lib/dynamo/operations.js';
import { Type } from '../../lib/graph/operation.js';
import { schedule } from '../schedule.js';
import * as logging from '../../lib/logging/index.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version: WHARFIE_VERSION } = require('../../../package.json');

const daemon_log = logging.getDaemonLogger();
/**
 * @type {'WHARFIE:OPERATION:SCHEDULE'}
 */
const TYPE = 'WHARFIE:OPERATION:SCHEDULE';

/**
 * @typedef WharfieEventProperties
 * @property {string} resource_id -
 * @property {Type} operation_type -
 * @property {any} [operation_input] -
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
    operation_input,
    version = WHARFIE_VERSION,
    retries = 0,
  }) {
    this.resource_id = resource_id;
    this.operation_type = operation_type;
    this.operation_input = operation_input;
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
      operation_input: this.operation_input,
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
      operation_input: record.operation_input,
      version: record.version,
      retries: record.retries,
    });
  }

  /**
   * @param {any} record -
   * @returns {boolean} -
   */
  static is(record) {
    if (record.type && record.operation_type) {
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

    if (this.operation_type === Type.BACKFILL) {
      await schedule({
        resource_id: this.resource_id,
        interval,
        window: [before, nowInterval],
      });
    } else if (this.operation_type === Type.LOAD) {
      await schedule({
        resource_id: this.resource_id,
        interval,
        window: [before, nowInterval],
        partition: this.operation_input.partition,
      });
    } else if (this.operation_type === Type.MIGRATE) {
      daemon_log.warn('migrations can not be scheduled');
    } else {
      throw new Error(`operation type unrecognized ${this.operation_type}`);
    }
  }
}
WharfieScheduleOperation.Type = TYPE;

export default WharfieScheduleOperation;
