import Resource from '../../graph/resource.js';
import Operation from '../../graph/operation.js';
import Action, { Status as ActionStatus } from '../../graph/action.js';
import Query, { Status as QueryStatus } from '../../graph/query.js';

import { CONDITION_TYPE, KEY_TYPE } from '../../db/base.js';

/**
 * @typedef {import('../../db/base.js').DBClient} DBClient
 */

const OPERATIONS_TABLE = process.env.OPERATIONS_TABLE || '';

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';

/**
 * Partition key used to maintain a provider-neutral index of all resources.
 *
 * The operations table is partitioned by `resource_id`, so listing *all* resources
 * requires an additional index partition.
 */
const RESOURCES_INDEX_PARTITION_KEY = '__resources__';

/**
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../db/base.js').KeyCondition} - Result.
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
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../db/base.js').KeyCondition} - Result.
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
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../db/base.js').KeyCondition} - Result.
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
const isConditionalCheckFailed = (error) => {
  if (error instanceof Error) {
    return error?.name === 'ConditionalCheckFailedException';
  }
  return false;
};

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
const isResourceNotFound = (error) => {
  if (error instanceof Error) {
    return error?.name === 'ResourceNotFoundException';
  }
  return false;
};

/**
 * @param {any[]} arr - arr.
 * @param {number} size - size.
 * @returns {any[][]} - Result.
 */
const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * The adapter stores action.status redundantly at the top-level for some backends.
 * @param {Record<string, any>} record - record.
 * @returns {Record<string, any>} - Result.
 */
const normalizeRecord = (record) => {
  if (record?.data?.record_type === Action.RecordType) {
    return { ...record, status: record.data.status };
  }
  return record;
};

/**
 * Operations table client.
 * @typedef {Object} OperationsTableClient
 * @property {(resource: Resource) => Promise<void>} putResource - putResource.
 * @property {(resource_id: string) => Promise<Resource | null>} getResource - getResource.
 * @property {() => Promise<Resource[]>} getAllResources - getAllResources.
 * @property {(resource: Resource) => Promise<void>} deleteResource - deleteResource.
 * @property {(operation: Operation) => Promise<void>} putOperation - putOperation.
 * @property {(resource_id: string, operation_id: string) => Promise<Operation | null>} getOperation - getOperation.
 * @property {(operation: Operation) => Promise<void>} deleteOperation - deleteOperation.
 * @property {(resource_id: string) => Promise<Operation[]>} getOperations - getOperations.
 * @property {(operation: Operation) => Promise<Action[]>} getActions - getActions.
 * @property {(resource_id: string, operation_id: string, action_id: string) => Promise<Action | null>} getAction - getAction.
 * @property {(action: { toRecords: () => Record<string, any>[] }) => Promise<void>} putAction -
 * @property {(action: Action, new_status: string, overrideTableName?: string) => Promise<boolean>} updateActionStatus - updateActionStatus.
 * @property {(query: { toRecord: () => any }) => Promise<void>} putQuery -
 * @property {(queries: Array<{ toRecord: () => any }>) => Promise<void>} putQueries -
 * @property {(resource_id: string, operation_id: string, action_id: string, query_id: string) => Promise<Query | null>} getQuery - getQuery.
 * @property {(resource_id: string, operation_id: string, action_id: string) => Promise<Query[]>} getQueries - getQueries.
 * @property {(operation: Operation, action_type: import('../../graph/action.js').WharfieActionTypeEnum) => Promise<boolean>} checkActionPrerequisites - checkActionPrerequisites.
 * @property {(resource_id: string, operation_id?: string) => Promise<{ operations: Operation[]; actions: Action[]; queries: Query[] }>} getRecords -
 */

/**
 * Factory: Operations table client.
 * @param {{ db?: DBClient, tableName?: string }} [params] -
 * @returns {OperationsTableClient} - Result.
 */
export function createOperationsTable({
  db,
  tableName = OPERATIONS_TABLE,
} = {}) {
  if (!db) throw new Error('createOperationsTable requires a db client');
  /** @type {DBClient} */
  const dbClient = db;

  /**
   * @param {Resource} resource - resource.
   * @returns {Promise<void>} - Result.
   */
  async function putResource(resource) {
    const record = resource.toRecord();
    await dbClient.batchWrite({
      tableName,
      putRequests: [
        {
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
        },
        {
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record: {
            ...record,
            resource_id: RESOURCES_INDEX_PARTITION_KEY,
          },
        },
      ],
    });
  }

  /**
   * @param {string} resource_id - resource_id.
   * @returns {Promise<Resource | null>} - Result.
   */
  async function getResource(resource_id) {
    try {
      const item = await dbClient.get({
        tableName,
        keyName: KEY_NAME,
        keyValue: resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: resource_id,
        consistentRead: true,
      });

      return item
        ? Resource.fromRecord(
            /** @type {import('../../graph/typedefs.js').ResourceRecord} */ (
              item
            ),
          )
        : null;
    } catch (error) {
      if (isResourceNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Provider-neutral resource listing backed by a dedicated index partition.
   * @returns {Promise<Resource[]>} - Result.
   */
  async function getAllResources() {
    try {
      const items =
        (await dbClient.query({
          tableName,
          consistentRead: true,
          keyConditions: [pkEq(KEY_NAME, RESOURCES_INDEX_PARTITION_KEY)],
        })) || [];

      return items
        .filter((item) => item?.data?.record_type === Resource.RecordType)
        .map((item) =>
          Resource.fromRecord(
            /** @type {import('../../graph/typedefs.js').ResourceRecord} */ (
              item
            ),
          ),
        )
        .sort((a, b) => a.id.localeCompare(b.id));
    } catch (error) {
      if (isResourceNotFound(error)) return [];
      throw error;
    }
  }

  /**
   * @param {Resource} resource - resource.
   * @returns {Promise<void>} - Result.
   */
  async function deleteResource(resource) {
    try {
      const items =
        (await dbClient.query({
          tableName,
          consistentRead: true,
          keyConditions: [
            pkEq(KEY_NAME, resource.id),
            skBegins(SORT_KEY_NAME, resource.id),
          ],
        })) || [];

      if (items.length) {
        for (const batch of chunk(items, 25)) {
          await dbClient.batchWrite({
            tableName,
            deleteRequests: batch.map((item) => ({
              keyName: KEY_NAME,
              keyValue: item.resource_id,
              sortKeyName: SORT_KEY_NAME,
              sortKeyValue: item.sort_key,
            })),
          });
        }
      }

      await dbClient.remove({
        tableName,
        keyName: KEY_NAME,
        keyValue: RESOURCES_INDEX_PARTITION_KEY,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: resource.id,
      });
    } catch (error) {
      if (isResourceNotFound(error)) return;
      throw error;
    }
  }

  /**
   * @param {Operation} operation - operation.
   * @returns {Promise<void>} - Result.
   */
  async function putOperation(operation) {
    const records = operation.toRecords().map(normalizeRecord);

    for (const batch of chunk(records, 25)) {
      await dbClient.batchWrite({
        tableName,
        putRequests: batch.map((record) => ({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
        })),
      });
    }
  }

  /**
   * @param {string} resource_id - resource_id.
   * @param {string} operation_id - operation_id.
   * @returns {Promise<Operation | null>} - Result.
   */
  async function getOperation(resource_id, operation_id) {
    const item = await dbClient.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: `${resource_id}#${operation_id}`,
      consistentRead: true,
    });

    return item ? Operation.fromRecord(item) : null;
  }

  /**
   * @param {Operation} operation - operation.
   * @returns {Promise<void>} - Result.
   */
  async function deleteOperation(operation) {
    const items =
      (await dbClient.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, operation.resource_id),
          skBegins(SORT_KEY_NAME, `${operation.resource_id}#${operation.id}`),
        ],
      })) || [];

    if (!items.length) return;

    for (const batch of chunk(items, 25)) {
      await dbClient.batchWrite({
        tableName,
        deleteRequests: batch.map((item) => ({
          keyName: KEY_NAME,
          keyValue: item.resource_id,
          sortKeyName: SORT_KEY_NAME,
          sortKeyValue: item.sort_key,
        })),
      });
    }
  }

  /**
   * @param {string} resource_id - resource_id.
   * @returns {Promise<Operation[]>} - Result.
   */
  async function getOperations(resource_id) {
    const items =
      (await dbClient.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, resource_id),
          skBegins(SORT_KEY_NAME, `${resource_id}#`),
        ],
      })) || [];

    return items
      .filter((item) => item?.data?.record_type === Operation.RecordType)
      .map((item) => Operation.fromRecord(item));
  }

  /**
   * @param {Operation} operation - operation.
   * @returns {Promise<Action[]>} - Result.
   */
  async function getActions(operation) {
    const prefix = `${operation.resource_id}#${operation.id}#`;
    const items =
      (await dbClient.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, operation.resource_id),
          skBegins(SORT_KEY_NAME, prefix),
        ],
      })) || [];

    return items
      .filter((item) => item?.data?.record_type === Action.RecordType)
      .map((item) => Action.fromRecord(item));
  }

  /**
   * @param {string} resource_id - resource_id.
   * @param {string} operation_id - operation_id.
   * @param {string} action_id - action_id.
   * @returns {Promise<Action | null>} - Result.
   */
  async function getAction(resource_id, operation_id, action_id) {
    const item = await dbClient.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: `${resource_id}#${operation_id}#${action_id}`,
      consistentRead: true,
    });

    return item ? Action.fromRecord(item) : null;
  }

  /**
   * @param {{ toRecords: () => Record<string, any>[] }} action -
   * @returns {Promise<void>} - Result.
   */
  async function putAction(action) {
    const records = action.toRecords().map(normalizeRecord);

    for (const batch of chunk(records, 25)) {
      await dbClient.batchWrite({
        tableName,
        putRequests: batch.map((record) => ({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
        })),
      });
    }
  }

  /**
   * Optimistic status transition.
   * @param {Action} action - action.
   * @param {string} new_status - new_status.
   * @param {string} [overrideTableName] - overrideTableName.
   * @returns {Promise<boolean>} - Result.
   */
  async function updateActionStatus(
    action,
    new_status,
    overrideTableName = tableName,
  ) {
    const key = `${action.resource_id}#${action.operation_id}#${action.id}`;

    const current = await dbClient.get({
      tableName: overrideTableName,
      keyName: KEY_NAME,
      keyValue: action.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: key,
      consistentRead: true,
    });

    if (!current) return false;

    const storedStatus = current.status ?? current?.data?.status;
    if (storedStatus !== action.status) return false;

    try {
      await dbClient.update({
        tableName: overrideTableName,
        keyName: KEY_NAME,
        keyValue: action.resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: key,
        updates: [
          { property: ['data', 'status'], propertyValue: new_status },
          { property: ['status'], propertyValue: new_status },
        ],
        conditions:
          current.status !== undefined ? [eq('status', storedStatus)] : [],
      });
    } catch (error) {
      if (isConditionalCheckFailed(error)) return false;
      throw error;
    }

    const after = await dbClient.get({
      tableName: overrideTableName,
      keyName: KEY_NAME,
      keyValue: action.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: key,
      consistentRead: true,
    });

    const afterStatus = after?.status ?? after?.data?.status;
    return afterStatus === new_status;
  }

  /**
   * @param {{ toRecord: () => any }} query -
   * @returns {Promise<void>} - Result.
   */
  async function putQuery(query) {
    await dbClient.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: query.toRecord(),
    });
  }

  /**
   * @param {Array<{ toRecord: () => any }>} queries -
   * @returns {Promise<void>} - Result.
   */
  async function putQueries(queries) {
    const records = queries.map((q) => q.toRecord());

    for (const batch of chunk(records, 25)) {
      await dbClient.batchWrite({
        tableName,
        putRequests: batch.map((record) => ({
          keyName: KEY_NAME,
          sortKeyName: SORT_KEY_NAME,
          record,
        })),
      });
    }
  }

  /**
   * @param {string} resource_id - resource_id.
   * @param {string} operation_id - operation_id.
   * @param {string} action_id - action_id.
   * @param {string} query_id - query_id.
   * @returns {Promise<Query | null>} - Result.
   */
  async function getQuery(resource_id, operation_id, action_id, query_id) {
    const item = await dbClient.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: `${resource_id}#${operation_id}#${action_id}#${query_id}`,
      consistentRead: true,
    });

    return item ? Query.fromRecord(item) : null;
  }

  /**
   * @param {string} resource_id - resource_id.
   * @param {string} operation_id - operation_id.
   * @param {string} action_id - action_id.
   * @returns {Promise<Query[]>} - Result.
   */
  async function getQueries(resource_id, operation_id, action_id) {
    const prefix = `${resource_id}#${operation_id}#${action_id}#`;

    const items =
      (await dbClient.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, resource_id),
          skBegins(SORT_KEY_NAME, prefix),
        ],
      })) || [];

    return items.map((item) => Query.fromRecord(item));
  }

  /**
   * Check whether prerequisite actions for a given action type have completed.
   *
   * The operation graph stores edges keyed by action *ids*; most call-sites refer
   * to actions by their *type*.
   * @param {Operation} operation - operation.
   * @param {import('../../graph/action.js').WharfieActionTypeEnum} action_type - action_type.
   * @returns {Promise<boolean>} - Result.
   */
  async function checkActionPrerequisites(operation, action_type) {
    let actionId;
    try {
      actionId = operation.getActionIdByType(action_type);
    } catch {
      return false;
    }

    const prerequisites = operation.getUpstreamActionIds(actionId) || [];
    if (!prerequisites.length) return true;

    for (const prerequisiteActionId of prerequisites) {
      const prefix = `${operation.resource_id}#${operation.id}#${prerequisiteActionId}`;

      const items =
        (await dbClient.query({
          tableName,
          consistentRead: true,
          keyConditions: [
            pkEq(KEY_NAME, operation.resource_id),
            skBegins(SORT_KEY_NAME, prefix),
          ],
        })) || [];

      if (!items.length) return false;

      const actionRecord = items.find(
        (i) => i?.data?.record_type === Action.RecordType,
      );
      if (!actionRecord) return false;

      const prerequisiteAction = Action.fromRecord(actionRecord);
      if (prerequisiteAction.status !== ActionStatus.COMPLETED) return false;

      const queryRecords = items.filter(
        (i) => i?.data?.record_type === Query.RecordType,
      );
      for (const queryRecord of queryRecords) {
        const q = Query.fromRecord(queryRecord);
        if (q.status === QueryStatus.RUNNING) {
          // Placeholder: stale query re-enqueueing logic lives in the daemon.
        }
      }
    }

    return true;
  }

  /**
   * Load all operation/action/query records for a resource (optionally scoped to an operation id).
   * @param {string} resource_id - resource_id.
   * @param {string} [operation_id] - operation_id.
   * @returns {Promise<{ operations: Operation[]; actions: Action[]; queries: Query[] }>} -
   */
  async function getRecords(resource_id, operation_id = '') {
    const prefix = `${resource_id}#${operation_id}`;

    const items =
      (await dbClient.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, resource_id),
          skBegins(SORT_KEY_NAME, prefix),
        ],
      })) || [];

    const filtered = items
      .filter((i) => i?.data?.record_type !== Resource.RecordType)
      .sort((a, b) => a.sort_key.localeCompare(b.sort_key));

    /** @type {{ operations: Operation[]; actions: Action[]; queries: Query[] }} */
    const records = {
      operations: [],
      actions: [],
      queries: [],
    };

    const operationBatch = [];
    let actionBatch = [];
    let queryBatch = [];

    const pop = () => filtered.pop();

    while (filtered.length) {
      const item = pop();
      if (!item) break;

      if (item?.data?.record_type === Query.RecordType) {
        queryBatch.push(item);
        continue;
      }

      if (item?.data?.record_type === Action.RecordType) {
        actionBatch.push({ action_record: item, query_records: queryBatch });
        queryBatch = [];
        continue;
      }

      if (item?.data?.record_type === Operation.RecordType) {
        operationBatch.push({
          operation_record: item,
          action_records: actionBatch,
        });
        actionBatch = [];
        continue;
      }
    }

    for (const operationRecords of operationBatch) {
      const operation = Operation.fromRecords(
        operationRecords.operation_record,
        operationRecords.action_records,
      );

      records.operations.push(operation);
      for (const actionRecords of operationRecords.action_records) {
        const action = Action.fromRecords(
          actionRecords.action_record,
          actionRecords.query_records,
        );
        records.actions.push(action);
        records.queries.push(...action.queries);
      }
    }

    return records;
  }

  return {
    putResource,
    getResource,
    getAllResources,
    deleteResource,
    putOperation,
    getOperation,
    deleteOperation,
    getOperations,
    getActions,
    getAction,
    putAction,
    updateActionStatus,
    putQuery,
    putQueries,
    getQuery,
    getQueries,
    checkActionPrerequisites,
    getRecords,
  };
}
