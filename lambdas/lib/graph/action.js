import { createId } from '../id.js';
import Query from './query.js';
import { WHARFIE_VERSION } from '../version.js';

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
 * 'INVOKE_FUNCTION'|
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
  INVOKE_FUNCTION: 'INVOKE_FUNCTION',
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
 * @property {string} [id] - id.
 * @property {string} resource_id - resource_id.
 * @property {string} operation_id - operation_id.
 * @property {WharfieActionTypeEnum} type - type.
 * @property {WharfieActionStatusEnum} [status] - status.
 * @property {import('./query.js').default[]} [queries] - queries.
 * @property {number} [started_at] - start timestamp.
 * @property {number} [last_updated_at] - update_at_timestamp.
 * @property {string} [wharfie_version] - wharfie_version.
 * @property {string} [function_name] - Function name used by INVOKE_FUNCTION actions.
 * @property {any} [inputs] - Invocation inputs for generic workflow actions.
 * @property {Record<string, any>} [placement] - Placement hints for the action executor.
 * @property {Record<string, any>} [retry] - Retry metadata for the action executor.
 * @property {any} [error] - Last persisted execution error.
 * @property {number} [attempt_count] - Number of execution attempts recorded for this action.
 * @property {any} [outputs] - outputs.
 */

class Action {
  /**
   * @param {ActionOptions} options - options.
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
    function_name,
    inputs,
    placement,
    retry,
    error,
    attempt_count = 0,
    outputs,
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
    this.function_name = function_name;
    this.inputs = inputs;
    this.placement = placement;
    this.retry = retry;
    this.error = error;
    this.attempt_count = attempt_count;
    this.outputs = outputs;
  }

  /**
   * @returns {string} - Result.
   */
  toString() {
    return this.id;
  }

  /**
   * @returns {(import('./typedefs.js').ActionRecord | import('./typedefs.js').QueryRecord)[]} - Result.
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
        function_name: this.function_name,
        inputs: this.inputs,
        placement: this.placement,
        retry: this.retry,
        error: this.error,
        attempt_count: this.attempt_count,
        record_type: Action.RecordType,
        outputs: this.outputs,
      },
    });
    for (const query of this.queries) {
      records.push(query.toRecord());
    }
    return records;
  }

  /**
   * @param {Record<string,any>} action_record - action_record.
   * @param {Record<string,any>[]} query_records - query_records.
   * @returns {Action} - Result.
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
      function_name: action_record.data.function_name,
      inputs: action_record.data.inputs,
      placement: action_record.data.placement,
      retry: action_record.data.retry,
      error: action_record.data.error,
      attempt_count: action_record.data.attempt_count,
      outputs: action_record.data.outputs,
    });
    for (const query_record of query_records) {
      new_action.queries.push(Query.fromRecord(query_record));
    }
    return new_action;
  }

  /**
   * @param {Record<string,any>} action_record - action_record.
   * @returns {Action} - Result.
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
      function_name: action_record.data.function_name,
      inputs: action_record.data.inputs,
      placement: action_record.data.placement,
      retry: action_record.data.retry,
      error: action_record.data.error,
      attempt_count: action_record.data.attempt_count,
      outputs: action_record.data.outputs,
    });
  }
}
Action.Type = Type;
Action.Status = Status;
/**
 * @type {'ACTION'}
 */
Action.RecordType = 'ACTION';

export { Status };
export default Action;
