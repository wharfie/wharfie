import { createId } from '../id.js';
import { WHARFIE_VERSION } from '../version.js';

/**
 * @typedef {('COMPLETED'|
 * 'PENDING'|
 * 'RUNNING'|
 * 'RETRYING'|
 * 'FAILED'|
 * 'CANCELLED'
 * )} QueryStatusEnum
 */

/**
 * @type {Object<QueryStatusEnum,QueryStatusEnum>}
 */
const Status = {
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  RETRYING: 'RETRYING',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

/**
 * @typedef QueryOptions
 * @property {string} resource_id - Id of the resource
 * @property {string} operation_id - Id of the operation
 * @property {string} action_id - Id of the action
 * @property {string} [id] - Id of the query
 * @property {QueryStatusEnum} [status] - status of the query
 * @property {string} [execution_id] - execution Id of the query
 * @property {any} [query_data] - query_data.
 * @property {string} [query_string] - query_string.
 * @property {number} [started_at] - start timestamp
 * @property {number} [last_updated_at] - update_at_timestamp
 * @property {string} [wharfie_version] - wharfie_version.
 */

class Query {
  /**
   * @param {QueryOptions} options - options.
   */
  constructor({
    resource_id,
    operation_id,
    action_id,
    id = createId(),
    status = Status.PENDING,
    execution_id,
    query_data,
    query_string,
    started_at = Date.now(),
    last_updated_at = started_at,
    wharfie_version = WHARFIE_VERSION,
  }) {
    this.resource_id = resource_id;
    this.operation_id = operation_id;
    this.action_id = action_id;
    this.id = id;
    this.status = status;
    this.execution_id = execution_id;
    this.query_data = query_data;
    this.query_string = query_string;
    this.started_at = started_at;
    this.last_updated_at = last_updated_at;
    this.wharfie_version = wharfie_version;
  }

  toString() {
    return this.execution_id;
  }

  /**
   * @returns {import('./typedefs.js').QueryRecord} - Result.
   */
  toRecord() {
    return {
      resource_id: this.resource_id,
      sort_key: `${this.resource_id}#${this.operation_id}#${this.action_id}#${this.id}`,
      data: {
        resource_id: this.resource_id,
        operation_id: this.operation_id,
        action_id: this.action_id,
        id: this.id,
        status: this.status,
        execution_id: this.execution_id,
        query_data: this.query_data,
        query_string: this.query_string,
        started_at: this.started_at,
        last_updated_at: this.last_updated_at,
        wharfie_version: this.wharfie_version,
        record_type: Query.RecordType,
      },
    };
  }

  /**
   * @param {Record<string,any>} query_record - query_record.
   * @returns {Query} - Result.
   */
  static fromRecord(query_record) {
    return new Query({
      id: query_record.data.id,
      resource_id: query_record.data.resource_id,
      operation_id: query_record.data.operation_id,
      action_id: query_record.data.action_id,
      status: query_record.data.status,
      execution_id: query_record.data.execution_id,
      query_data: query_record.data.query_data,
      query_string: query_record.data.query_string,
      started_at: query_record.data.started_at,
      last_updated_at: query_record.data.last_updated_at,
      wharfie_version: query_record.data.wharfie_version,
    });
  }
}
/**
 * @type {Object<QueryStatusEnum,QueryStatusEnum>}
 */
Query.Status = Status;
/**
 * @type {'QUERY'}
 */
Query.RecordType = 'QUERY';

export { Status };
export default Query;
