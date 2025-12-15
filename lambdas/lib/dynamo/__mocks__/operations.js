import { Resource, Operation, Action, Query } from '../../graph/index.js';

/** @type {Object.<string, import('../../graph/typedefs.js').ResourceRecordData | import('../../graph/typedefs.js').OperationRecordData | import('../../graph/typedefs.js').ActionRecordData | import('../../graph/typedefs.js').QueryRecordData >} */
let __state = {};

/**
 * @param {Object.<string, import('../../graph/typedefs.js').ResourceRecordData | import('../../graph/typedefs.js').OperationRecordData | import('../../graph/typedefs.js').ActionRecordData | import('../../graph/typedefs.js').QueryRecordData >} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, import('../../graph/typedefs.js').ResourceRecordData | import('../../graph/typedefs.js').OperationRecordData | import('../../graph/typedefs.js').ActionRecordData | import('../../graph/typedefs.js').QueryRecordData >} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {Resource} resource -
 */
async function putResource(resource) {
  const { sort_key, data } = resource.toRecord();
  __state[sort_key] = data;
}

/**
 * @param {string} resource_id -
 * @returns {Promise<Resource?>} - event
 */
async function getResource(resource_id) {
  if (!__state[resource_id])
    throw new Error(`no resource exists with id: ${resource_id}`);
  if (__state[resource_id].record_type !== Resource.RecordType)
    throw Error(`record with id ${resource_id} is not of type resource`);
  return Resource.fromRecord({
    resource_id,
    sort_key: resource_id,
    data: __state[resource_id],
  });
}

/**
 * @param {string} resource_id -
 */
async function deleteResource(resource_id) {
  delete __state[resource_id];
}

/**
 * @param {Operation} operation -
 */
async function putOperation(operation) {
  const putItems = operation.toRecords();
  putItems.forEach(({ sort_key, data }) => {
    __state[sort_key] = data;
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @returns {Promise<Operation?>} - event
 */
async function getOperation(resource_id, operation_id) {
  const sort_key = `${resource_id}#${operation_id}`;
  if (!__state[sort_key]) return null;
  if (__state[sort_key].record_type !== Operation.RecordType)
    throw Error(`record with id ${sort_key} is not of type operation`);
  return Operation.fromRecord({
    resource_id,
    sort_key,
    data: __state[sort_key],
  });
}
/**
 * @param {string} resource_id -
 * @returns {Promise<Operation[]>} -
 */
async function getOperations(resource_id) {
  const sort_key = `${resource_id}#`;
  return Object.keys(__state)
    .filter((key) => key.startsWith(sort_key))
    .filter((key) => __state[key].record_type === Operation.RecordType)
    .map((key) => {
      return Operation.fromRecord({
        resource_id,
        sort_key: key,
        data: __state[key],
      });
    });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<Action?>} -
 */
async function getAction(resource_id, operation_id, action_id) {
  const sort_key = `${resource_id}#${operation_id}#${action_id}`;
  if (!__state[sort_key]) return null;
  if (__state[sort_key].record_type !== Action.RecordType)
    throw Error(`record with id ${sort_key} is not of type action`);
  return Action.fromRecord({
    resource_id,
    sort_key,
    data: __state[sort_key],
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {string} query_id -
 * @returns {Promise<Query?>} -
 */
async function getQuery(resource_id, operation_id, action_id, query_id) {
  const sort_key = `${resource_id}#${operation_id}#${action_id}#${query_id}`;
  if (!__state[sort_key]) return null;
  if (__state[sort_key].record_type !== Query.RecordType)
    throw Error(`record with id ${sort_key} is not of type query`);
  return Query.fromRecord({
    resource_id,
    sort_key,
    data: __state[sort_key],
  });
}

/**
 * @param {Action} action -
 */
async function putAction(action) {
  const putItems = action.toRecords();
  putItems.forEach(({ sort_key, data }) => {
    __state[sort_key] = data;
  });
}

/**
 * @param {Action} action -
 * @param {import('../../graph/action.js').WharfieActionStatusEnum} new_status -
 * @returns {Promise<boolean>} -
 */
async function updateActionStatus(action, new_status) {
  const sort_key = `${action.resource_id}#${action.operation_id}#${action.id}`;
  if (!__state[sort_key])
    throw new Error(`no action exists with id: ${sort_key}`);
  if (__state[sort_key].record_type !== Action.RecordType)
    throw Error(`record with id ${sort_key} is not of type action`);
  if (__state[sort_key].status === action.status) {
    __state[sort_key].status = new_status;
    return true;
  }
  return false;
}

/**
 * @param {Query} query -
 */
async function putQuery(query) {
  const putItem = query.toRecord();
  __state[putItem.sort_key] = putItem.data;
}

/**
 * @param {Query[]} queries -
 */
async function putQueries(queries) {
  queries.forEach(putQuery);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<Query[]>} -
 */
async function getQueries(resource_id, operation_id, action_id) {
  const id = `${resource_id}#${operation_id}#${action_id}#`;
  return Object.keys(__state)
    .filter((key) => key.startsWith(id))
    .map((key) => {
      if (__state[key].record_type !== Query.RecordType)
        throw Error(`record with id ${key} is not of type query`);
      return Query.fromRecord({
        resource_id,
        sort_key: key,
        data: __state[key],
      });
    });
}

/**
 * @param {Operation} operation -
 * @param {import('../../graph/action.js').WharfieActionTypeEnum} action_type -
 * @param {import('../../logging/logger.js').default?} logger -
 * @param {boolean} includeQueries -
 * @returns {Promise<boolean>} -
 */
async function checkActionPrerequisites(
  operation,
  action_type,
  logger,
  includeQueries = true
) {
  const current_action_id = operation.getActionIdByType(action_type);
  const prerequisite_action_ids =
    operation.getUpstreamActionIds(current_action_id) || [];
  logger &&
    logger.debug(
      `checking that prerequisite actions are completed ${JSON.stringify(
        prerequisite_action_ids
      )}`
    );
  let prerequisites_met = true;
  while (prerequisite_action_ids.length > 0) {
    const action_id = prerequisite_action_ids.pop();
    if (!action_id) continue;
    const id = `${operation.resource_id}#${operation.id}#${action_id}`;
    const Items = Object.keys(__state)
      .filter((key) => key.startsWith(id))
      .map((key) => __state[key]);
    const incompleteQueries = [];
    while (Items.length > 0) {
      const data = Items.pop();
      if (!data) continue;
      switch (data.record_type) {
        case Action.RecordType:
          if (data.status !== Action.Status.COMPLETED) {
            logger &&
              logger.info(
                `prerequisite action ${operation.type}:${data.type} hasn't finished running yet`
              );
            prerequisites_met = false;
          }
          if (data.status === Action.Status.FAILED) {
            throw new Error(
              `prerequisite action ${operation.type}:${data.type} failed`
            );
          }
          break;
        case Query.RecordType:
          if (includeQueries && data.status && data.status !== 'COMPLETED') {
            incompleteQueries.push(data.id);
            logger &&
              logger.debug(
                `incomplete prerequisite query ${JSON.stringify(data)}`
              );
            prerequisites_met = false;
          }
          if (includeQueries && data.status && data.status === 'FAILED') {
            throw new Error(
              `prerequisite query failed ${JSON.stringify(data)}`
            );
          }
          break;
      }
    }
    incompleteQueries.length > 0 &&
      logger &&
      logger.info(
        `prerequisite action ${operation.type}:${action_type} has ${incompleteQueries.length} incomplete queries`
      );
  }
  return prerequisites_met;
}

/**
 * @param {Operation} operation -
 */
async function deleteOperation(operation) {
  const sort_key = `${operation.resource_id}#${operation.id}`;
  Object.keys(__state)
    .filter((key) => key.startsWith(sort_key))
    .forEach((key) => delete __state[key]);
}

/**
 * @typedef getRecordsReturn
 * @property {Operation[]} operations -
 * @property {Action[]} actions -
 * @property {Query[]} queries -
 */

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @returns {Promise<getRecordsReturn>} -
 */
async function getRecords(resource_id, operation_id = '') {
  const id = `${resource_id}#${operation_id}`;
  const Items = Object.keys(__state)
    .filter((key) => key.startsWith(id))
    .sort((a, b) => a.localeCompare(b))
    .map((key) => __state[key])
    .filter((data) => data.record_type !== Resource.RecordType);

  /** @type {getRecordsReturn} */
  const records = {
    operations: [],
    actions: [],
    queries: [],
  };
  if (!Items) return records;

  /**
   * @typedef ActionRecordGroup
   * @property {import('../../graph/typedefs.js').ActionRecord} action_record -
   * @property {import('../../graph/typedefs.js').QueryRecord[]} query_records -
   */
  /** @type {ActionRecordGroup[]} */
  let operationBatch = [];
  /** @type {import('../../graph/typedefs.js').QueryRecord[]} */
  let actionBatch = [];
  while (Items.length > 0) {
    const item = Items.pop();
    if (!item) continue;
    switch (item.record_type) {
      case Operation.RecordType:
        records.operations.push(
          Operation.fromRecords(
            {
              resource_id: item.resource_id,
              sort_key: '',
              data: item,
            },
            operationBatch
          )
        );
        operationBatch = [];
        break;
      case Action.RecordType:
        records.actions.push(
          Action.fromRecords(
            {
              resource_id: item.resource_id,
              sort_key: '',
              data: item,
            },
            actionBatch
          )
        );
        operationBatch.push({
          action_record: {
            resource_id: item.resource_id,
            sort_key: '',
            data: item,
          },
          query_records: actionBatch,
        });
        actionBatch = [];
        break;
      case Query.RecordType:
        records.queries.push(
          Query.fromRecord({
            resource_id: item.resource_id,
            sort_key: '',
            data: item,
          })
        );
        actionBatch.push({
          resource_id: item.resource_id,
          sort_key: '',
          data: item,
        });
        break;
      default:
        throw new Error(`unrecognized record_type, in record ${item}`);
    }
  }
  return records;
}

/**
 * @returns {Promise<Operation[]>} -
 */
async function getAllOperations() {
  const Items = Object.values(__state)
    .filter((data) => data.record_type !== Resource.RecordType)
    .sort((a, b) => a.id.localeCompare(b.id));

  /** @type {Operation[]} */
  const operations = [];
  if (!Items) return operations;
  /**
   * @typedef ActionRecordGroup
   * @property {import('../../graph/typedefs.js').ActionRecord} action_record -
   * @property {import('../../graph/typedefs.js').QueryRecord[]} query_records -
   */
  /** @type {ActionRecordGroup[]} */
  let operationBatch = [];
  /** @type {import('../../graph/typedefs.js').QueryRecord[]} */
  let actionBatch = [];
  while (Items.length > 0) {
    const item = Items.pop();
    if (!item) continue;
    switch (item.record_type) {
      case Operation.RecordType:
        operations.push(
          Operation.fromRecords(
            {
              resource_id: item.resource_id,
              sort_key: '',
              data: item,
            },
            operationBatch
          )
        );
        operationBatch = [];
        break;
      case Action.RecordType:
        operationBatch.push({
          action_record: {
            resource_id: item.resource_id,
            sort_key: '',
            data: item,
          },
          query_records: actionBatch,
        });
        actionBatch = [];
        break;
      case Query.RecordType:
        actionBatch.push({
          resource_id: item.resource_id,
          sort_key: '',
          data: item,
        });
        break;
      default:
        throw new Error(`unrecognized record_type, in record ${item}`);
    }
  }
  return operations;
}

/**
 * @returns {Promise<Resource[]>} -
 */
async function getAllResources() {
  const operations = Object.values(__state)
    .filter((data) => data.record_type === Resource.RecordType)
    .map((data) =>
      Resource.fromRecord({
        resource_id: data.id,
        sort_key: '',
        data,
      })
    );
  return operations;
}

export {
  getRecords,
  getAllOperations,
  getAllResources,
  getResource,
  getOperation,
  getOperations,
  getAction,
  getQuery,
  getQueries,
  checkActionPrerequisites,
  putResource,
  putOperation,
  putAction,
  updateActionStatus,
  putQuery,
  putQueries,
  deleteResource,
  deleteOperation,
  __setMockState,
  __getMockState,
};
