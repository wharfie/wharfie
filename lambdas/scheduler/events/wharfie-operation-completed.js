const { version: WHARFIE_VERSION } = require('../../../package.json');

const dependency_db = require('../../lib/dynamo/dependency');
const resource_db = require('../../lib/dynamo/operations');
const { schedule } = require('../schedule');

const logging = require('../../lib/logging');
const daemon_log = logging.getDaemonLogger();

/**
 * @type {'WHARFIE:OPERATION:COMPLETED'}
 */
const TYPE = 'WHARFIE:OPERATION:COMPLETED';

/**
 * @typedef WharfieOperationCompletedProperties
 * @property {string} resource_id -
 * @property {string} operation_id -
 * @property {string} [version] -
 * @property {number} [retries] -
 */

class WharfieOperationCompleted {
  /**
   * @param {WharfieOperationCompletedProperties} properties -
   */
  constructor({
    resource_id,
    operation_id,
    version = WHARFIE_VERSION,
    retries = 0,
  }) {
    this.resource_id = resource_id;
    this.operation_id = operation_id;
    this.version = version;
    this.retries = retries;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({
      resource_id: this.resource_id,
      operation_id: this.operation_id,
      type: TYPE,
      version: this.version,
      retries: this.retries,
    });
  }

  /**
   * @typedef WharfieOperationCompletedEvent
   * @property {string} resource_id -
   * @property {string} operation_id -
   * @property {string} type -
   * @property {string} version -
   * @property {number} retries -
   */
  /**
   * @param {WharfieOperationCompletedEvent} record -
   * @returns {WharfieOperationCompleted} -
   */
  static fromEvent(record) {
    return new WharfieOperationCompleted({
      resource_id: record.resource_id,
      operation_id: record.operation_id,
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
    // Find downstream resources
    const dependencies = await dependency_db.findDependencies(
      `${resource.destination_properties.databaseName}.${resource.destination_properties.name}`
    );
    if (!dependencies) {
      daemon_log.debug(
        `no dependencies found for ${resource.destination_properties.databaseName}.${resource.destination_properties.name}`
      );
      return;
    }
    while (dependencies.length > 0) {
      const dependency = dependencies.pop();
      if (!dependency) continue;
      const now = Date.now();
      const interval = parseInt(dependency.interval);
      const ms = 1000 * interval; // convert s to ms
      const nowInterval = Math.round(now / ms) * ms;
      const before = nowInterval - 1000 * interval;

      const dependencyResource = await resource_db.getResource(
        dependency.resource_id
      );
      // For each resource schedule an update
      if (!dependencyResource) {
        daemon_log.debug(
          `no resource found for ${resource.destination_properties.databaseName}.${resource.destination_properties.name}`
        );
        continue;
      }
      await schedule({
        resource_id: dependency.resource_id,
        interval,
        window: [before, nowInterval],
      });
    }
  }
}
WharfieOperationCompleted.Type = TYPE;

module.exports = WharfieOperationCompleted;
