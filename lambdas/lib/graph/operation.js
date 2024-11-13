'use strict';
const Action = require('./action');
const { createId } = require('../id');
const { version: WHARFIE_VERSION } = require('../../../package.json');

/**
 * @typedef {(
 * 'BACKFILL'|
 * 'LOAD'|
 * 'MIGRATE'
 * )} WharfieOperationTypeEnum
 */

/**
 * @type {Object<WharfieOperationTypeEnum,WharfieOperationTypeEnum>}
 */
const Type = {
  BACKFILL: 'BACKFILL',
  LOAD: 'LOAD',
  MIGRATE: 'MIGRATE',
};

/**
 * @typedef {('COMPLETED'|
 * 'PENDING'|
 * 'RUNNING'
 * )} WharfieOperationStatusEnum
 */

/**
 * @type {Object<WharfieOperationStatusEnum,WharfieOperationStatusEnum>}
 */
const Status = {
  COMPLETED: 'COMPLETED',
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
};

/**
 * @typedef OperationOptions
 * @property {string} resource_id -
 * @property {number} resource_version -
 * @property {string} [id] -
 * @property {WharfieOperationTypeEnum} type -
 * @property {WharfieOperationStatusEnum} [status] -
 * @property {any} [operation_config] -
 * @property {any} [operation_inputs] -
 * @property {number} [started_at] - start timestamp
 * @property {number} [last_updated_at] - update_at_timestamp
 * @property {string} [wharfie_version] -
 */

class Operation {
  /**
   * @param {OperationOptions} options -
   */
  constructor({
    resource_id,
    resource_version,
    id = createId(),
    type,
    status = Status.PENDING,
    operation_config,
    operation_inputs,
    started_at = Date.now(),
    last_updated_at = started_at,
    wharfie_version = WHARFIE_VERSION,
  }) {
    this.resource_id = resource_id;
    this.resource_version = resource_version;
    this.id = id;
    this.type = type;
    this.status = status;
    this.operation_config = operation_config;
    this.operation_inputs = operation_inputs;
    this.started_at = started_at;
    this.last_updated_at = last_updated_at;
    this.wharfie_version = wharfie_version;
    /**
     * @type {Map<string,Action>}
     */
    this.actions = new Map();
    /**
     * @type {Map<string,import('./action').WharfieActionTypeEnum>}
     */
    this.actionIdsToTypes = new Map();
    /**
     * @type {Map<string, string[]>}
     */
    this.outgoingEdges = new Map();
    /**
     * @type {Map<string, string[]>}
     */
    this.incomingEdges = new Map();
  }

  /**
   * @typedef addActionOptions
   * @property {import('./action').WharfieActionTypeEnum} type -
   * @property {Action[]} [dependsOn] -
   * @property {string} [id] -
   */

  /**
   * @param {addActionOptions} options -
   * @returns {Action} -
   */
  createAction({ type, dependsOn = [], id }) {
    const action = new Action({
      type,
      id,
      resource_id: this.resource_id,
      operation_id: this.id,
    });
    this._addAction(action, dependsOn);
    return action;
  }

  /**
   * @param {Action} action -
   * @param {Action[]} [dependencies] -
   */
  _addAction(action, dependencies = []) {
    dependencies.forEach((dependency) => {
      if (!this.actions.has(dependency.id)) {
        throw new Error(`Action ${dependency.id} does not exist`);
      }
      this._addDependency(dependency.id, action.id);
    });
    this.actions.set(action.id, action);
    this.actionIdsToTypes.set(action.id, action.type);
  }

  /**
   * @param {string} originActionId -
   * @param {string} destinationActionId -
   */
  _addDependency(originActionId, destinationActionId) {
    // Ensure outgoing edges for the origin action
    if (!this.outgoingEdges.has(originActionId)) {
      this.outgoingEdges.set(originActionId, []);
    }

    // Ensure incoming edges for the destination action
    if (!this.incomingEdges.has(destinationActionId)) {
      this.incomingEdges.set(destinationActionId, []);
    }

    // Prevent adding duplicate dependencies
    if (
      !this.outgoingEdges.get(originActionId)?.includes(destinationActionId)
    ) {
      this.outgoingEdges.get(originActionId)?.push(destinationActionId);
    }

    if (
      !this.incomingEdges.get(destinationActionId)?.includes(originActionId)
    ) {
      this.incomingEdges.get(destinationActionId)?.push(originActionId);
    }
  }

  /**
   * @returns {Action[]} -
   */
  getActions() {
    return [...this.actions.values()];
  }

  /**
   * @param {string} id -
   * @returns {Action} -
   */
  getAction(id) {
    const matchedAction = this.actions.get(id);
    if (!matchedAction) {
      throw new Error(`Action ${id} does not exist`);
    }
    return matchedAction;
  }

  /**
   * @param {import('./action').WharfieActionTypeEnum} type -
   * @returns {string} -
   */
  getActionIdByType(type) {
    const matchedActionId = Array.from(this.actionIdsToTypes.entries())
      .filter(([id, action_type]) => {
        return action_type === type;
      })
      .map(([id]) => id)[0];
    if (!matchedActionId) {
      throw new Error(`Action ${type} does not exist`);
    }
    return matchedActionId;
  }

  /**
   * @param {string} id -
   * @returns {import('./action').WharfieActionTypeEnum} -
   */
  getActionTypeById(id) {
    const type = this.actionIdsToTypes.get(id);
    if (!type) {
      throw new Error(`Action ${id} does not exist`);
    }
    return type;
  }

  /**
   * @param {Action} action -
   * @returns {Action[]} -
   */
  getDownstreamActions(action) {
    return [
      ...(this.outgoingEdges.get(action.id)?.map((id) => this.getAction(id)) ||
        []),
    ];
  }

  /**
   * @param {string} actionId -
   * @returns {string[]} -
   */
  getDownstreamActionIds(actionId) {
    return [...(this.outgoingEdges.get(actionId) || [])];
  }

  /**
   * @param {Action} action -
   * @returns {Action[]} -
   */
  getUpstreamActions(action) {
    return [
      ...(this.incomingEdges.get(action.id)?.map((id) => this.getAction(id)) ||
        []),
    ];
  }

  /**
   * @param {string} actionId -
   * @returns {string[]} -
   */
  getUpstreamActionIds(actionId) {
    return [...(this.incomingEdges.get(actionId) || [])];
  }

  /**
   * @returns {string} -
   */
  toString() {
    let result = '';
    for (const [actionName, Dependencies] of this.outgoingEdges) {
      const DependencyList = Dependencies.map((dep) =>
        this.getActionTypeById(dep)
      ).join(', ');
      if (DependencyList.length > 0) {
        result += `${this.getActionTypeById(
          actionName
        )} -> ${DependencyList}\n`;
      } else {
        result += `${this.getActionTypeById(actionName)}\n`;
      }
    }
    return result;
  }

  /**
   * @returns {Action[]} -
   */
  getSequentialActionOrder() {
    const actions = this.getActions();
    /**
     * @type {Action[]}
     */
    const actionOrder = [];
    const visited = new Set();
    /**
     * @type {Action[]}
     */
    const queue = [];

    /**
     * @param {Action} action -
     * @this {Operation}
     */
    function bfs(action) {
      queue.push(action);

      while (queue.length > 0) {
        const currentAction = queue.shift();
        if (!currentAction) {
          throw new Error('Queue should not be empty');
        }
        if (visited.has(currentAction.id)) {
          continue;
        }
        visited.add(currentAction.id);
        actionOrder.push(currentAction);

        const downstreamActions = this.getDownstreamActions(currentAction);
        for (const dependency of downstreamActions) {
          if (!visited.has(dependency.id)) {
            queue.push(dependency);
          }
        }
      }
    }

    for (const action of actions) {
      if (!visited.has(action.id)) {
        bfs.call(this, action);
      }
    }

    return actionOrder;
  }

  /**
   * @returns {string} -
   */
  serializeGraph() {
    return JSON.stringify({
      outgoingEdges: Array.from(this.outgoingEdges.entries()),
      incomingEdges: Array.from(this.incomingEdges.entries()),
      actionIdsToTypes: Array.from(this.actionIdsToTypes.entries()),
    });
  }

  /**
   * @returns {Record<string, any>[]} -
   */
  toRecords() {
    const records = [];
    for (const action of this.getActions()) {
      records.push(...action.toRecords());
    }
    records.push({
      resource_id: this.resource_id,
      sort_key: `${this.resource_id}#${this.id}`,
      data: {
        resource_id: this.resource_id,
        resource_version: this.resource_version,
        id: this.id,
        type: this.type,
        status: this.status,
        operation_config: this.operation_config,
        operation_inputs: this.operation_inputs,
        serialized_action_graph: this.serializeGraph(),
        started_at: this.started_at,
        last_updated_at: this.last_updated_at,
        wharfie_version: this.wharfie_version,
        record_type: Operation.RecordType,
      },
    });
    return records;
  }

  /**
   * @param {Record<string, any>} operation_record -
   * @returns {Operation} -
   */
  static fromRecord(operation_record) {
    const operation = new Operation({
      resource_id: operation_record.data.resource_id,
      resource_version: operation_record.data.resource_version,
      id: operation_record.data.id,
      type: operation_record.data.type,
      status: operation_record.data.status,
      operation_config: operation_record.data.operation_config,
      operation_inputs: operation_record.data.operation_inputs,
      started_at: operation_record.data.started_at,
      last_updated_at: operation_record.data.last_updated_at,
      wharfie_version: operation_record.data.wharfie_version,
    });
    operation.deserializeGraph(operation_record.data.serialized_action_graph);
    return operation;
  }

  /**
   * @typedef ActionRecordGroup
   * @property {Record<string, any>} action_record -
   * @property {Record<string, any>[]} query_records -
   */

  /**
   * @param {Record<string, any>} operation_record -
   * @param {ActionRecordGroup[]} action_records -
   * @returns {Operation} -
   */
  static fromRecords(operation_record, action_records) {
    const operation = new Operation({
      resource_id: operation_record.resource_id,
      resource_version: operation_record.data.resource_version,
      id: operation_record.data.id,
      type: operation_record.data.type,
      status: operation_record.data.status,
      operation_config: operation_record.data.operation_config,
      operation_inputs: operation_record.data.operation_inputs,
      started_at: operation_record.data.started_at,
      last_updated_at: operation_record.data.last_updated_at,
      wharfie_version: operation_record.data.wharfie_version,
    });

    action_records.forEach(({ action_record, query_records }) => {
      const action = Action.fromRecords(action_record, query_records);
      operation._addAction(action);
    });

    operation.deserializeGraph(operation_record.data.serialized_action_graph);
    return operation;
  }

  /**
   * @param {string} serializedGraph -
   */
  deserializeGraph(serializedGraph) {
    const parsedData = JSON.parse(serializedGraph);
    for (const [actionId, dependencies] of parsedData.outgoingEdges) {
      dependencies.forEach((/** @type {string} */ dependency) => {
        this._addDependency(actionId, dependency);
      });
    }
    this.actionIdsToTypes = new Map(parsedData.actionIdsToTypes);
  }
}
Operation.Type = Type;
Operation.Status = Status;
/**
 * @type {'OPERATION'}
 */
Operation.RecordType = 'OPERATION';

module.exports = Operation;
