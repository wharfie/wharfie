'use strict';
const { createId } = require('../id');

/**
 * @typedef {('START'|
 * 'REGISTER_MISSING_PARTITIONS'|
 * 'FIND_COMPACTION_PARTITIONS'|
 * 'RUN_COMPACTION'|
 * 'UPDATE_SYMLINKS'|
 * 'SWAP_RESOURCE'|
 * 'RESPOND_TO_CLOUDFORMATION'|
 * 'REGISTER_PARTITION'|
 * 'RUN_SINGLE_COMPACTION'|
 * 'FINISH'|
 * 'SIDE_EFFECT__CLOUDWATCH'|
 * 'SIDE_EFFECT__DAGSTER'|
 * 'SIDE_EFFECT__WHARFIE'|
 * 'SIDE_EFFECTS__FINISH'
 * )} WharfieActionTypeEnum
 */

/**
 * @type {Object<WharfieActionTypeEnum,WharfieActionTypeEnum>}
 */
const Type = {
  START: 'START',
  REGISTER_MISSING_PARTITIONS: 'REGISTER_MISSING_PARTITIONS',
  FIND_COMPACTION_PARTITIONS: 'FIND_COMPACTION_PARTITIONS',
  RUN_COMPACTION: 'RUN_COMPACTION',
  UPDATE_SYMLINKS: 'UPDATE_SYMLINKS',
  SWAP_RESOURCE: 'SWAP_RESOURCE',
  RESPOND_TO_CLOUDFORMATION: 'RESPOND_TO_CLOUDFORMATION',
  REGISTER_PARTITION: 'REGISTER_PARTITION',
  RUN_SINGLE_COMPACTION: 'RUN_SINGLE_COMPACTION',
  FINISH: 'FINISH',
  SIDE_EFFECT__CLOUDWATCH: 'SIDE_EFFECT__CLOUDWATCH',
  SIDE_EFFECT__DAGSTER: 'SIDE_EFFECT__DAGSTER',
  SIDE_EFFECT__WHARFIE: 'SIDE_EFFECT__WHARFIE',
  SIDE_EFFECTS__FINISH: 'SIDE_EFFECTS__FINISH',
};

/**
 * @typedef ActionOptions
 * @property {string} [id] -
 * @property {WharfieActionTypeEnum} type -
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
    this.executions = options.executions || [];
  }

  /**
   * @returns {string} -
   */
  toString() {
    return this.id;
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
Action.Type = Type;

module.exports = Action;
