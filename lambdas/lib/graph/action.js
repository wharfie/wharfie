'use strict';
const { createId } = require('../id');
/**
 * @typedef ActionOptions
 * @property {string} [id] -
 * @property {string} type -
 * @property {string} [status] -
 * @property {import('./execution').Execution[]} [executions] -
 */

class Action {
  /**
   * @param {ActionOptions} options -
   */
  constructor(options) {
    this.id = options.id || createId();
    this.type = options.type;
    this.status = options.status || 'WAITING';
    this.executions = options.executions || [];
  }

  /**
   * @returns {string} -
   */
  toString() {
    return this.id;
  }

  /**
   * @returns {import('../../typedefs').ActionRecord} -
   */
  toRecord() {
    return {
      action_id: this.id,
      action_type: this.type,
      action_status: this.status,
      // TODO: Add executions to queries
      queries: [],
    };
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify(this);
  }

  /**
   * @param {import('../../typedefs').ActionRecord} action_record -
   * @returns {Action} -
   */
  static fromRecord(action_record) {
    return new Action({
      id: action_record.action_id,
      type: action_record.action_type,
      status: action_record.action_status,
    });
  }

  /**
   * @param {string} serializedOp -
   * @returns {Action} -
   */
  static deserialize(serializedOp) {
    const parsed = JSON.parse(serializedOp);
    return new Action(parsed);
  }
}

module.exports = Action;
