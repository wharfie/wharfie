import { createId } from '../id.js';

import Athena from '../athena/index.js';
import STS from '../sts.js';
import SQS from '../sqs.js';

import Resource from '../graph/resource.js';
import Operation from '../graph/operation.js';
import Action from '../graph/action.js';
import Query from '../graph/query.js';

import { CONDITION_TYPE, KEY_TYPE } from '../db/base.js';

/**
 * @typedef {import('../db/base.js').DBClient} DBClient
 */

const OPERATIONS_TABLE = process.env.OPERATIONS_TABLE || '';

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';

/**
 * @param {string} propertyName -
 * @param {string} propertyValue -
 * @returns {import('../db/base.js').KeyCondition} -
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
 * @param {string} propertyName -
 * @param {string} propertyValue -
 * @returns {import('../db/base.js').KeyCondition} -
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
 * @param {string} propertyName -
 * @param {string} propertyValue -
 * @returns {import('../db/base.js').KeyCondition} -
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

const isConditionalCheckFailed = (/** @type {unknown} */ error) => {
  if (error instanceof Error) {
    return error?.name === 'ConditionalCheckFailedException';
  }
  return false;
};

const isResourceNotFound = (/** @type {unknown} */ error) => {
  if (error instanceof Error) {
    return error?.name === 'ResourceNotFoundException';
  }
  return false;
};

const chunk = (/** @type {any[]} */ arr, /** @type {number} */ size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const normalizeRecord = (/** @type {Record<string, any>} */ record) => {
  if (record?.data?.record_type === Action.RecordType) {
    return { ...record, status: record.data.status };
  }
  return record;
};

// /**
//  * @param {Operation} operation -
//  * @param {Query} query -
//  * @param {{ Role: string; }} daemon_config -
//  * @param {any} athena_workgroup -
//  */
// async function checkForStaleQuery(
//   operation,
//   query,
//   daemon_config,
//   athena_workgroup,
// ) {
//   const assumeRoleArn = daemon_config?.Role || ''
//   if (!assumeRoleArn) return

//   const sts = new STS({ region: operation.region })
//   const { Credentials } = await sts.assumeRole({
//     RoleArn: assumeRoleArn,
//     RoleSessionName: `query-${createId()}`
//   })
//   if (!Credentials || !Credentials.AccessKeyId || !Credentials.SecretAccessKey || !Credentials.SessionToken) throw new Error('Failed to assume role')

//   const athena = new Athena({
//     region: operation.region,
//     credentials: {
//       accessKeyId: Credentials.AccessKeyId,
//       secretAccessKey: Credentials.SecretAccessKey,
//       sessionToken: Credentials.SessionToken,
//     },
//   })

//   const {QueryExecution} = await athena.getQueryExecution({
//     QueryExecutionId: query.execution_id
//   })
//   if (!QueryExecution) throw new Error('Failed to get query execution')
//   const { Status } = QueryExecution
//   if (!Status) throw new Error('no query status')

//   if (
//     Status.State === 'RUNNING' &&
//     query.last_updated_at < Date.now() - 55 * 60 * 1000
//   ) {
//     const sqs = new SQS({ region: operation.region })

//     await sqs.sendMessage({
//       QueueUrl: operation.daemon_queue_url,
//       MessageBody: JSON.stringify({ operation_id: operation.id, query_id: query.id })
//     })
//   }
// }

/**
 * @typedef {Object} operationClient
 * @property {(semaphore: string, threshold: number | undefined) => void} increase -
 * @property {(semaphore: string) => void} release -
 * @property {(semaphore: string) => void} deleteSemaphore -
 */

/**
 * Factory: Operations table client.
 * @param {object} params -
 * @param {DBClient} params.db -
 * @param {string} [params.tableName] -
 * @returns {operationClient} -
 */
export function createOperationsTable({
  db,
  tableName = OPERATIONS_TABLE,
} = {}) {
  if (!db) throw new Error('createOperationsTable requires a db client');

  /**
   * @param {Resource} resource -
   */
  async function putResource(resource) {
    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: resource.toRecord(),
    });
  }

  /**
   * @param {string} resource_id -
   * @returns {Promise<Resource | null>} -
   */
  async function getResource(resource_id) {
    try {
      const item = await db.get({
        tableName,
        keyName: KEY_NAME,
        keyValue: resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: resource_id,
        consistentRead: true,
      });

      return item ? Resource.fromRecord(item) : null;
    } catch (error) {
      if (isResourceNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * @param {Resource} resource -
   */
  async function deleteResource(resource) {
    try {
      const items =
        (await db.query({
          tableName,
          consistentRead: true,
          keyConditions: [
            pkEq(KEY_NAME, resource.id),
            skBegins(SORT_KEY_NAME, resource.id),
          ],
        })) || [];

      if (!items.length) return;

      for (const batch of chunk(items, 25)) {
        await db.batchWrite({
          tableName,
          deleteRequests: batch.map((item) => ({
            keyName: KEY_NAME,
            keyValue: item.resource_id,
            sortKeyName: SORT_KEY_NAME,
            sortKeyValue: item.sort_key,
          })),
        });
      }
    } catch (error) {
      if (isResourceNotFound(error)) return;
      throw error;
    }
  }

  /**
   * @param {Operation} operation -
   */
  async function putOperation(operation) {
    const records = operation.toRecords().map(normalizeRecord);

    for (const batch of chunk(records, 25)) {
      await db.batchWrite({
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
   * @param {string} resource_id -
   * @param {string} operation_id -
   * @returns {Promise<Operation | null>} -
   */
  async function getOperation(resource_id, operation_id) {
    const item = await db.get({
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
   * @param {Operation} operation -
   */
  async function deleteOperation(operation) {
    const items =
      (await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, operation.resource_id),
          skBegins(SORT_KEY_NAME, `${operation.resource_id}#${operation.id}`),
        ],
      })) || [];

    if (!items.length) return;

    for (const batch of chunk(items, 25)) {
      await db.batchWrite({
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
   * @param {string} resource_id -
   * @returns {Promise<Operation[]>} -
   */
  async function getOperations(resource_id) {
    const items =
      (await db.query({
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
   * @param {Operation} operation -
   * @returns {Promise<Action[]>} -
   */
  async function getActions(operation) {
    const prefix = `${operation.resource_id}#${operation.id}#`;
    const items =
      (await db.query({
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
   * @param {string} resource_id -
   * @param {string} operation_id -
   * @param {string} action_id -
   * @returns {Promise<Action | null>} -
   */
  async function getAction(resource_id, operation_id, action_id) {
    const item = await db.get({
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
   * @param {{ toRecords: () => Record<string, any>[]; }} action
   */
  async function putAction(action) {
    const records = action.toRecords().map(normalizeRecord);

    for (const batch of chunk(records, 25)) {
      await db.batchWrite({
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
   *
   * @param {Action} action
   * @param {string} new_status
   * @param {string} [overrideTableName]
   * @returns {Promise<boolean>}
   */
  async function updateActionStatus(
    action,
    new_status,
    overrideTableName = tableName,
  ) {
    const key = `${action.resource_id}#${action.operation_id}#${action.id}`;

    const current = await db.get({
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
      await db.update({
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

    const after = await db.get({
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
   * @param {{ toRecord: () => any; }} query
   */
  async function putQuery(query) {
    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: query.toRecord(),
    });
  }

  /**
   * @param {any[]} queries
   */
  async function putQueries(queries) {
    const records = queries.map((/** @type {{ toRecord: () => any; }} */ q) =>
      q.toRecord(),
    );

    for (const batch of chunk(records, 25)) {
      await db.batchWrite({
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
   * @param {any} resource_id
   * @param {any} operation_id
   * @param {any} action_id
   * @param {any} query_id
   */
  async function getQuery(resource_id, operation_id, action_id, query_id) {
    const item = await db.get({
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
   * @param {string} resource_id
   * @param {any} operation_id
   * @param {any} action_id
   */
  async function getQueries(resource_id, operation_id, action_id) {
    const prefix = `${resource_id}#${operation_id}#${action_id}#`;

    const items =
      (await db.query({
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
   * @param {{ graph: { incomingEdges: { [x: string]: never[]; }; }; resource_id: string; id: any; }} operation
   * @param {string | number} action_id
   */
  async function checkActionPrerequisites(operation, action_id) {
    const prerequisites = operation?.graph?.incomingEdges?.[action_id] || [];
    if (!prerequisites.length) return true;

    for (const prerequisiteActionId of prerequisites) {
      const prefix = `${operation.resource_id}#${operation.id}#${prerequisiteActionId}`;

      const items =
        (await db.query({
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
      if (prerequisiteAction.status !== Action.Status.COMPLETED) return false;

      const queryRecords = items.filter(
        (i) => i?.data?.record_type === Query.RecordType,
      );
      for (const queryRecord of queryRecords) {
        const q = Query.fromRecord(queryRecord);
        if (q.status === Query.Status.RUNNING) {
          // await checkForStaleQuery(operation, q, operation.daemon_config, operation.athena_workgroup)
        }
      }
    }

    return true;
  }

  /**
   * @param {string} resource_id
   */
  async function getRecords(resource_id, operation_id = '') {
    const prefix = `${resource_id}#${operation_id}`;

    const items =
      (await db.query({
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

    const records = {
      operations: [],
      actions: [],
      queries: [],
    };

    let operationBatch = [];
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
        actionBatch.push({ action: item, queries: queryBatch });
        queryBatch = [];
        continue;
      }

      if (item?.data?.record_type === Operation.RecordType) {
        operationBatch.push({ operation: item, actions: actionBatch });
        actionBatch = [];
        continue;
      }
    }

    for (const operationRecords of operationBatch) {
      const operation = Operation.fromRecords(
        operationRecords.operation,
        operationRecords.actions,
      );

      records.operations.push(operation);
      for (const actionRecords of operationRecords.actions) {
        const action = Action.fromRecords(
          actionRecords.action,
          actionRecords.queries,
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
