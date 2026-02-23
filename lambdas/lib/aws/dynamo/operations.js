import {
  getOperationsStore,
  __setMockState as __resetOperationsStoreState,
} from '../../db/operations/store.js';

/**
 * @param {import('../../graph/resource.js').default} resource - resource.
 * @param {string} [tableName] - tableName.
 * @returns {Promise<any>} - Result.
 */
export async function putResource(resource, tableName) {
  return (await getOperationsStore({ tableName })).putResource(resource);
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} [tableName] - tableName.
 * @returns {Promise<any>} - Result.
 */
export async function getResource(resource_id, tableName) {
  return (await getOperationsStore({ tableName })).getResource(resource_id);
}

/**
 * @param {import('../../graph/resource.js').default} resource - resource.
 * @param {string} [tableName] - tableName.
 * @returns {Promise<any>} - Result.
 */
export async function deleteResource(resource, tableName) {
  return (await getOperationsStore({ tableName })).deleteResource(resource);
}

/**
 * @param {import('../../graph/operation.js').default} operation - operation.
 * @returns {Promise<any>} - Result.
 */
export async function putOperation(operation) {
  return (await getOperationsStore()).putOperation(operation);
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} operation_id - operation_id.
 * @returns {Promise<any>} - Result.
 */
export async function getOperation(resource_id, operation_id) {
  return (await getOperationsStore()).getOperation(resource_id, operation_id);
}

/**
 * @param {import('../../graph/operation.js').default} operation - operation.
 * @returns {Promise<any>} - Result.
 */
export async function deleteOperation(operation) {
  return (await getOperationsStore()).deleteOperation(operation);
}

/**
 * @param {string} resource_id - resource_id.
 * @returns {Promise<any>} - Result.
 */
export async function getOperations(resource_id) {
  return (await getOperationsStore()).getOperations(resource_id);
}

/**
 * @param {import('../../graph/operation.js').default} operation - operation.
 * @returns {Promise<any>} - Result.
 */
export async function getActions(operation) {
  return (await getOperationsStore()).getActions(operation);
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} operation_id - operation_id.
 * @param {string} action_id - action_id.
 * @returns {Promise<any>} - Result.
 */
export async function getAction(resource_id, operation_id, action_id) {
  return (await getOperationsStore()).getAction(
    resource_id,
    operation_id,
    action_id,
  );
}

/**
 * @param {{ toRecords: () => Record<string, any>[] }} action -
 * @returns {Promise<any>} - Result.
 */
export async function putAction(action) {
  return (await getOperationsStore()).putAction(action);
}

/**
 * @param {import('../../graph/action.js').default} action - action.
 * @param {string} new_status - new_status.
 * @param {string} [overrideTableName] - overrideTableName.
 * @returns {Promise<any>} - Result.
 */
export async function updateActionStatus(
  action,
  new_status,
  overrideTableName,
) {
  return (await getOperationsStore()).updateActionStatus(
    action,
    new_status,
    overrideTableName,
  );
}

/**
 * @param {{ toRecord: () => any }} query -
 * @returns {Promise<any>} - Result.
 */
export async function putQuery(query) {
  return (await getOperationsStore()).putQuery(query);
}

/**
 * @param {Array<{ toRecord: () => any }>} queries -
 * @returns {Promise<any>} - Result.
 */
export async function putQueries(queries) {
  return (await getOperationsStore()).putQueries(queries);
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} operation_id - operation_id.
 * @param {string} action_id - action_id.
 * @param {string} query_id - query_id.
 * @returns {Promise<any>} - Result.
 */
export async function getQuery(resource_id, operation_id, action_id, query_id) {
  return (await getOperationsStore()).getQuery(
    resource_id,
    operation_id,
    action_id,
    query_id,
  );
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} operation_id - operation_id.
 * @param {string} action_id - action_id.
 * @returns {Promise<any>} - Result.
 */
export async function getQueries(resource_id, operation_id, action_id) {
  return (await getOperationsStore()).getQueries(
    resource_id,
    operation_id,
    action_id,
  );
}

/**
 * @param {import('../../graph/operation.js').default} operation - operation.
 * @param {import('../../graph/action.js').WharfieActionTypeEnum} action_type - action_type.
 * @returns {Promise<any>} - Result.
 */
export async function checkActionPrerequisites(operation, action_type) {
  return (await getOperationsStore()).checkActionPrerequisites(
    operation,
    action_type,
  );
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} [operation_id] - operation_id.
 * @returns {Promise<any>} - Result.
 */
export async function getRecords(resource_id, operation_id) {
  return (await getOperationsStore()).getRecords(resource_id, operation_id);
}

/**
 * Test helper: clear cached stores and reset shared DB.
 * @returns {void} - Result.
 */
export function __setMockState() {
  __resetOperationsStoreState();
}
