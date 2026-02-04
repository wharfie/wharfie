import { createOperationsTable } from '../db/tables/operations.js';
import { getDB, resetDB } from './_shared.js';

/** @type {Map<string, ReturnType<typeof createOperationsTable>>} */
const _tables = new Map();

/**
 * @param {string} [tableName] -
 * @returns {Promise<ReturnType<typeof createOperationsTable>>} -
 */
async function getTable(tableName) {
  const key = tableName || '__default__';
  const existing = _tables.get(key);
  if (existing) return existing;

  const db = await getDB();
  const table = createOperationsTable({
    db,
    ...(tableName ? { tableName } : {}),
  });

  _tables.set(key, table);
  return table;
}

/**
 * @param {import('../graph/resource.js').default} resource -
 * @param {string} [tableName] -
 */
export async function putResource(resource, tableName) {
  return (await getTable(tableName)).putResource(resource);
}

/**
 * @param {string} resource_id -
 * @param {string} [tableName] -
 */
export async function getResource(resource_id, tableName) {
  return (await getTable(tableName)).getResource(resource_id);
}

/**
 * @param {import('../graph/resource.js').default} resource -
 * @param {string} [tableName] -
 */
export async function deleteResource(resource, tableName) {
  return (await getTable(tableName)).deleteResource(resource);
}

/**
 * @param {import('../graph/operation.js').default} operation -
 */
export async function putOperation(operation) {
  return (await getTable()).putOperation(operation);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 */
export async function getOperation(resource_id, operation_id) {
  return (await getTable()).getOperation(resource_id, operation_id);
}

/**
 * @param {import('../graph/operation.js').default} operation -
 */
export async function deleteOperation(operation) {
  return (await getTable()).deleteOperation(operation);
}

/**
 * @param {string} resource_id -
 */
export async function getOperations(resource_id) {
  return (await getTable()).getOperations(resource_id);
}

/**
 * @param {import('../graph/operation.js').default} operation -
 */
export async function getActions(operation) {
  return (await getTable()).getActions(operation);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 */
export async function getAction(resource_id, operation_id, action_id) {
  return (await getTable()).getAction(resource_id, operation_id, action_id);
}

/**
 * @param {{ toRecords: () => Record<string, any>[] }} action -
 */
export async function putAction(action) {
  return (await getTable()).putAction(action);
}

/**
 * @param {import('../graph/action.js').default} action -
 * @param {string} new_status -
 * @param {string} [overrideTableName] -
 */
export async function updateActionStatus(
  action,
  new_status,
  overrideTableName,
) {
  return (await getTable()).updateActionStatus(
    action,
    new_status,
    overrideTableName,
  );
}

/**
 * @param {{ toRecord: () => any }} query -
 */
export async function putQuery(query) {
  return (await getTable()).putQuery(query);
}

/**
 * @param {Array<{ toRecord: () => any }>} queries -
 */
export async function putQueries(queries) {
  return (await getTable()).putQueries(queries);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {string} query_id -
 */
export async function getQuery(resource_id, operation_id, action_id, query_id) {
  return (await getTable()).getQuery(
    resource_id,
    operation_id,
    action_id,
    query_id,
  );
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 */
export async function getQueries(resource_id, operation_id, action_id) {
  return (await getTable()).getQueries(resource_id, operation_id, action_id);
}

/**
 * @param {import('../graph/operation.js').default} operation -
 * @param {import('../graph/action.js').WharfieActionTypeEnum} action_type -
 */
export async function checkActionPrerequisites(operation, action_type) {
  return (await getTable()).checkActionPrerequisites(operation, action_type);
}

/**
 * @param {string} resource_id -
 * @param {string} [operation_id] -
 */
export async function getRecords(resource_id, operation_id) {
  return (await getTable()).getRecords(resource_id, operation_id);
}

/**
 *
 */
export function __setMockState() {
  _tables.clear();
  resetDB();
}
