'use strict';
const { createId } = require('../id');
const Query = require('./query');
const { version: WHARFIE_VERSION } = require('../../../package.json');

/**
 * @typedef {('START'|
 * 'REGISTER_MISSING_PARTITIONS'|
 * 'CREATE_MIGRATION_RESOUCE' |
 * 'DESTROY_MIGRATION_RESOURCE' |
 * 'RECONCILE_RESOURCE' |
 * 'FIND_COMPACTION_PARTITIONS'|
 * 'RUN_COMPACTION'|
 * 'UPDATE_SYMLINKS'|
 * 'SWAP_RESOURCE'|
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
  CREATE_MIGRATION_RESOUCE: 'CREATE_MIGRATION_RESOUCE',
  DESTROY_MIGRATION_RESOURCE: 'DESTROY_MIGRATION_RESOURCE',
  RECONCILE_RESOURCE: 'RECONCILE_RESOURCE',
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
 * @typedef {('COMPLETED'|
 * 'PENDING'|
 * 'RUNNING'|
 * 'FAILED'
 * )} WharfieActionStatusEnum
 */

/**
 * @type {Object<WharfieActionStatusEnum,WharfieActionStatusEnum>}
 */
const Status = {
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
};

/**
 * @typedef ActionOptions
 * @property {string} [id] -
 * @property {string} resource_id -
 * @property {string} operation_id -
 * @property {WharfieActionTypeEnum} type -
 * @property {WharfieActionStatusEnum} [status] -
 * @property {import('./query')[]} [queries] -
 * @property {number} [started_at] - start timestamp
 * @property {number} [last_updated_at] - update_at_timestamp
 * @property {string} [wharfie_version] -
 */

class Action {
  /**
   * @param {ActionOptions} options -
   */
  constructor({
    id = createId(),
    resource_id,
    operation_id,
    type,
    queries = [],
    status = Status.PENDING,
    started_at = Date.now(),
    last_updated_at = started_at,
    wharfie_version = WHARFIE_VERSION,
  }) {
    this.id = id;
    this.resource_id = resource_id;
    this.operation_id = operation_id;
    this.type = type;
    this.status = status;
    this.queries = queries;
    this.started_at = started_at;
    this.last_updated_at = last_updated_at;
    this.wharfie_version = wharfie_version;
  }

  /**
   * @returns {string} -
   */
  toString() {
    return this.id;
  }

  /**
   * @returns {(import('./typedefs').ActionRecord | import('./typedefs').QueryRecord)[]} -
   */
  toRecords() {
    const records = [];
    records.push({
      resource_id: this.resource_id,
      sort_key: `${this.resource_id}#${this.operation_id}#${this.id}`,
      data: {
        id: this.id,
        resource_id: this.resource_id,
        operation_id: this.operation_id,
        type: this.type,
        status: this.status,
        started_at: this.started_at,
        last_updated_at: this.last_updated_at,
        wharfie_version: this.wharfie_version,
        record_type: Action.RecordType,
      },
    });
    for (const query of this.queries) {
      records.push(query.toRecord());
    }
    return records;
  }

  /**
   * @param {Record<string,any>} action_record -
   * @param {Record<string,any>[]} query_records -
   * @returns {Action} -
   */
  static fromRecords(action_record, query_records) {
    const new_action = new Action({
      id: action_record.data.id,
      resource_id: action_record.data.resource_id,
      operation_id: action_record.data.operation_id,
      type: action_record.data.type,
      status: action_record.data.status,
      started_at: action_record.data.started_at,
      last_updated_at: action_record.data.last_updated_at,
      wharfie_version: action_record.data.wharfie_version,
    });
    for (const query_record of query_records) {
      new_action.queries.push(Query.fromRecord(query_record));
    }
    return new_action;
  }

  /**
   * @param {Record<string,any>} action_record -
   * @returns {Action} -
   */
  static fromRecord(action_record) {
    return new Action({
      id: action_record.data.id,
      resource_id: action_record.data.resource_id,
      operation_id: action_record.data.operation_id,
      type: action_record.data.type,
      status: action_record.data.status,
      started_at: action_record.data.started_at,
      last_updated_at: action_record.data.last_updated_at,
      wharfie_version: action_record.data.wharfie_version,
    });
  }
}
Action.Type = Type;
Action.Status = Status;
/**
 * @type {'ACTION'}
 */
Action.RecordType = 'ACTION';

module.exports = Action;
