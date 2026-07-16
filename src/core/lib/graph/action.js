import { createId } from '../id.js';
import { WHARFIE_VERSION } from '../version.js';

/**
 * @typedef {('START'|'INVOKE_FUNCTION'|'FINISH')} WharfieActionTypeEnum
 */

/**
 * @type {Object<WharfieActionTypeEnum,WharfieActionTypeEnum>}
 */
const Type = {
  START: 'START',
  INVOKE_FUNCTION: 'INVOKE_FUNCTION',
  FINISH: 'FINISH',
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
   * @returns {import('./typedefs.js').ActionRecord} - Result.
   */
  toRecord() {
    return {
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
    };
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
