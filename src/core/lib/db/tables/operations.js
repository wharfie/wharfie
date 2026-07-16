import Operation from '../../graph/operation.js';
import Action, { Status as ActionStatus } from '../../graph/action.js';

import { CONDITION_TYPE, KEY_TYPE } from '../base.js';

/**
 * @typedef {import('../base.js').DBClient} DBClient
 */

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';

/**
 * @param {string} propertyName - Property name.
 * @param {string} propertyValue - Property value.
 * @returns {import('../base.js').KeyCondition} - Primary-key equality condition.
 */
function pkEq(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.PRIMARY,
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Property name.
 * @param {string} propertyValue - Property value.
 * @returns {import('../base.js').KeyCondition} - Sort-key prefix condition.
 */
function skBegins(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.SORT,
    conditionType: CONDITION_TYPE.BEGINS_WITH,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {string} propertyName - Property name.
 * @param {string} propertyValue - Property value.
 * @returns {import('../base.js').KeyCondition} - Equality condition.
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {unknown} error - Error to inspect.
 * @returns {boolean} - Whether the write lost an optimistic concurrency race.
 */
function isConditionalCheckFailed(error) {
  return (
    error instanceof Error && error.name === 'ConditionalCheckFailedException'
  );
}

/**
 * @template T
 * @param {T[]} values - Values to split.
 * @param {number} size - Maximum chunk size.
 * @returns {T[][]} - Chunks.
 */
function chunk(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

/**
 * Some adapters use a top-level status field for conditional updates.
 * @param {Record<string, any>} record - Record to normalize.
 * @returns {Record<string, any>} - Normalized record.
 */
function normalizeRecord(record) {
  return { ...record, status: record.data.status };
}

/**
 * @param {Record<string, any>} record - Persisted record.
 * @param {string} resourceId - App resource id.
 * @param {string} operationId - Operation id.
 * @returns {boolean} - Whether this is the exact operation record.
 */
function isOperationRecord(record, resourceId, operationId) {
  return (
    record?.data?.record_type === Operation.RecordType &&
    record.data.resource_id === resourceId &&
    record.data.id === operationId
  );
}

/**
 * @param {Record<string, any>} record - Persisted record.
 * @param {string} resourceId - App resource id.
 * @param {string} operationId - Operation id.
 * @returns {boolean} - Whether this action belongs to the exact operation.
 */
function isActionRecord(record, resourceId, operationId) {
  return (
    record?.data?.record_type === Action.RecordType &&
    record.data.resource_id === resourceId &&
    record.data.operation_id === operationId
  );
}

/**
 * Persisted operation and action API.
 * @typedef {Object} OperationsTableClient
 * @property {(operation: Operation) => Promise<void>} putOperation - Persist an operation and its actions.
 * @property {(resource_id: string, operation_id: string) => Promise<Operation | null>} getOperation - Load one operation.
 * @property {(operation: Operation) => Promise<void>} deleteOperation - Delete an operation and its actions.
 * @property {(resource_id: string) => Promise<Operation[]>} getOperations - Load an app's operations.
 * @property {(operation: Operation) => Promise<Action[]>} getActions - Load an operation's actions.
 * @property {(resource_id: string, operation_id: string, action_id: string) => Promise<Action | null>} getAction - Load one action.
 * @property {(action: Action) => Promise<void>} putAction - Persist one action.
 * @property {(action: Action, new_status: string, overrideTableName?: string) => Promise<boolean>} updateActionStatus - Optimistically update an action status.
 * @property {(operation: Operation, new_status: import('../../graph/operation.js').WharfieOperationStatusEnum, overrideTableName?: string) => Promise<boolean>} updateOperationStatus - Optimistically update an operation status.
 * @property {(operation: Operation, action_id: string) => Promise<boolean>} checkActionPrerequisites - Check exact action prerequisites.
 * @property {(resource_id: string, operation_id?: string) => Promise<{ operations: Operation[]; actions: Action[] }>} getRecords - Load persisted runs.
 */

/**
 * Create an operations table client.
 * @param {{ db?: DBClient, tableName?: string }} [params] - Table configuration.
 * @throws {Error} If db or tableName are missing.
 * @returns {OperationsTableClient} - Operations table client.
 */
export function createOperationsTable({ db, tableName } = {}) {
  if (!db) throw new Error('createOperationsTable requires a db client');
  if (!tableName || !String(tableName).trim()) {
    throw new Error('createOperationsTable requires a tableName');
  }

  /** @type {DBClient} */
  const dbClient = db;
  const resolvedTableName = String(tableName).trim();

  /**
   * @param {Operation} operation - Operation to persist.
   * @returns {Promise<void>} - Resolves when all records are persisted.
   */
  async function putOperation(operation) {
    const records = operation.toRecords().map(normalizeRecord);

    for (const batch of chunk(records, 25)) {
      await dbClient.batchWrite({
        tableName: resolvedTableName,
        putRequests: batch.map((record) => ({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
        })),
      });
    }
  }

  /**
   * @param {string} resourceId - App resource id.
   * @param {string} operationId - Operation id.
   * @returns {Promise<Operation | null>} - Persisted operation, if found.
   */
  async function getOperation(resourceId, operationId) {
    const item = await dbClient.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: resourceId,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: `${resourceId}#${operationId}`,
      consistentRead: true,
    });

    return item && isOperationRecord(item, resourceId, operationId)
      ? Operation.fromRecord(item)
      : null;
  }

  /**
   * @param {Operation} operation - Operation whose status should change.
   * @param {import('../../graph/operation.js').WharfieOperationStatusEnum} newStatus - New status.
   * @param {string} [overrideTableName] - Optional table override.
   * @returns {Promise<boolean>} - Whether the transition was persisted.
   */
  async function updateOperationStatus(
    operation,
    newStatus,
    overrideTableName = resolvedTableName,
  ) {
    const sortKey = `${operation.resource_id}#${operation.id}`;
    const current = await dbClient.get({
      tableName: overrideTableName,
      keyName: KEY_NAME,
      keyValue: operation.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: sortKey,
      consistentRead: true,
    });

    if (!current) return false;

    const storedStatus = current.status ?? current?.data?.status;
    if (storedStatus !== operation.status) return false;

    const lastUpdatedAt = Date.now();

    try {
      await dbClient.update({
        tableName: overrideTableName,
        keyName: KEY_NAME,
        keyValue: operation.resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: sortKey,
        updates: [
          { property: ['data', 'status'], propertyValue: newStatus },
          {
            property: ['data', 'last_updated_at'],
            propertyValue: lastUpdatedAt,
          },
          { property: ['status'], propertyValue: newStatus },
        ],
        conditions:
          current.status !== undefined ? [eq('status', storedStatus)] : [],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }

    const updated = await dbClient.get({
      tableName: overrideTableName,
      keyName: KEY_NAME,
      keyValue: operation.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: sortKey,
      consistentRead: true,
    });

    return (
      (updated?.status ?? updated?.data?.status) === newStatus &&
      updated?.data?.last_updated_at === lastUpdatedAt
    );
  }

  /**
   * @param {Operation} operation - Operation to delete.
   * @returns {Promise<void>} - Resolves when the operation and actions are deleted.
   */
  async function deleteOperation(operation) {
    const candidates =
      (await dbClient.query({
        tableName: resolvedTableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, operation.resource_id),
          skBegins(SORT_KEY_NAME, `${operation.resource_id}#${operation.id}`),
        ],
      })) || [];

    const records = candidates.filter(
      (record) =>
        isOperationRecord(record, operation.resource_id, operation.id) ||
        isActionRecord(record, operation.resource_id, operation.id),
    );

    for (const batch of chunk(records, 25)) {
      await dbClient.batchWrite({
        tableName: resolvedTableName,
        deleteRequests: batch.map((record) => ({
          keyName: KEY_NAME,
          keyValue: record.resource_id,
          sortKeyName: SORT_KEY_NAME,
          sortKeyValue: record.sort_key,
        })),
      });
    }
  }

  /**
   * @param {string} resourceId - App resource id.
   * @returns {Promise<Operation[]>} - Persisted operations.
   */
  async function getOperations(resourceId) {
    const items =
      (await dbClient.query({
        tableName: resolvedTableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, resourceId),
          skBegins(SORT_KEY_NAME, `${resourceId}#`),
        ],
      })) || [];

    return items
      .filter(
        (item) =>
          item?.data?.record_type === Operation.RecordType &&
          item.data.resource_id === resourceId,
      )
      .sort((left, right) => left.sort_key.localeCompare(right.sort_key))
      .map((item) => Operation.fromRecord(item));
  }

  /**
   * @param {Operation} operation - Operation whose actions should be loaded.
   * @returns {Promise<Action[]>} - Persisted actions.
   */
  async function getActions(operation) {
    const items =
      (await dbClient.query({
        tableName: resolvedTableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, operation.resource_id),
          skBegins(SORT_KEY_NAME, `${operation.resource_id}#${operation.id}#`),
        ],
      })) || [];

    return items
      .filter((item) =>
        isActionRecord(item, operation.resource_id, operation.id),
      )
      .sort((left, right) => left.sort_key.localeCompare(right.sort_key))
      .map((item) => Action.fromRecord(item));
  }

  /**
   * @param {string} resourceId - App resource id.
   * @param {string} operationId - Operation id.
   * @param {string} actionId - Action id.
   * @returns {Promise<Action | null>} - Persisted action, if found.
   */
  async function getAction(resourceId, operationId, actionId) {
    const item = await dbClient.get({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      keyValue: resourceId,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: `${resourceId}#${operationId}#${actionId}`,
      consistentRead: true,
    });

    return item && isActionRecord(item, resourceId, operationId)
      ? Action.fromRecord(item)
      : null;
  }

  /**
   * @param {Action} action - Action to persist.
   * @returns {Promise<void>} - Resolves when the action is persisted.
   */
  async function putAction(action) {
    await dbClient.put({
      tableName: resolvedTableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: normalizeRecord(action.toRecord()),
    });
  }

  /**
   * @param {Action} action - Action whose status should change.
   * @param {string} newStatus - New status.
   * @param {string} [overrideTableName] - Optional table override.
   * @returns {Promise<boolean>} - Whether the transition was persisted.
   */
  async function updateActionStatus(
    action,
    newStatus,
    overrideTableName = resolvedTableName,
  ) {
    const sortKey = `${action.resource_id}#${action.operation_id}#${action.id}`;
    const current = await dbClient.get({
      tableName: overrideTableName,
      keyName: KEY_NAME,
      keyValue: action.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: sortKey,
      consistentRead: true,
    });

    if (!current) return false;

    const storedStatus = current.status ?? current?.data?.status;
    if (storedStatus !== action.status) return false;

    const lastUpdatedAt = Date.now();

    try {
      await dbClient.update({
        tableName: overrideTableName,
        keyName: KEY_NAME,
        keyValue: action.resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: sortKey,
        updates: [
          { property: ['data', 'status'], propertyValue: newStatus },
          {
            property: ['data', 'last_updated_at'],
            propertyValue: lastUpdatedAt,
          },
          { property: ['status'], propertyValue: newStatus },
        ],
        conditions:
          current.status !== undefined ? [eq('status', storedStatus)] : [],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }

    const updated = await dbClient.get({
      tableName: overrideTableName,
      keyName: KEY_NAME,
      keyValue: action.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: sortKey,
      consistentRead: true,
    });

    return (
      (updated?.status ?? updated?.data?.status) === newStatus &&
      updated?.data?.last_updated_at === lastUpdatedAt
    );
  }

  /**
   * @param {Operation} operation - Operation containing the action graph.
   * @param {string} actionId - Exact action id.
   * @returns {Promise<boolean>} - Whether every prerequisite completed.
   */
  async function checkActionPrerequisites(operation, actionId) {
    if (!operation.actions.has(actionId)) return false;

    const prerequisiteIds = operation.getUpstreamActionIds(actionId);
    for (const prerequisiteId of prerequisiteIds) {
      const item = await dbClient.get({
        tableName: resolvedTableName,
        keyName: KEY_NAME,
        keyValue: operation.resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: `${operation.resource_id}#${operation.id}#${prerequisiteId}`,
        consistentRead: true,
      });

      if (!item || !isActionRecord(item, operation.resource_id, operation.id)) {
        return false;
      }

      const prerequisite = Action.fromRecord(item);
      if (
        prerequisite.id !== prerequisiteId ||
        prerequisite.status !== ActionStatus.COMPLETED
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * @param {string} resourceId - App resource id.
   * @param {string} [operationId] - Optional exact operation id.
   * @returns {Promise<{ operations: Operation[]; actions: Action[] }>} - Persisted runs.
   */
  async function getRecords(resourceId, operationId) {
    const prefix = operationId
      ? `${resourceId}#${operationId}`
      : `${resourceId}#`;
    const items =
      (await dbClient.query({
        tableName: resolvedTableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, resourceId),
          skBegins(SORT_KEY_NAME, prefix),
        ],
      })) || [];

    const operationRecords = items
      .filter(
        (item) =>
          item?.data?.record_type === Operation.RecordType &&
          item.data.resource_id === resourceId &&
          (!operationId || item.data.id === operationId),
      )
      .sort((left, right) => left.sort_key.localeCompare(right.sort_key));
    const actionRecords = items
      .filter(
        (item) =>
          item?.data?.record_type === Action.RecordType &&
          item.data.resource_id === resourceId &&
          (!operationId || item.data.operation_id === operationId),
      )
      .sort((left, right) => left.sort_key.localeCompare(right.sort_key));

    return {
      operations: operationRecords.map((operationRecord) =>
        Operation.fromRecords(
          operationRecord,
          actionRecords.filter(
            (actionRecord) =>
              actionRecord.data.operation_id === operationRecord.data.id,
          ),
        ),
      ),
      actions: actionRecords.map((actionRecord) =>
        Action.fromRecord(actionRecord),
      ),
    };
  }

  return {
    putOperation,
    getOperation,
    deleteOperation,
    getOperations,
    getActions,
    getAction,
    putAction,
    updateActionStatus,
    updateOperationStatus,
    checkActionPrerequisites,
    getRecords,
  };
}
