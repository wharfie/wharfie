'use strict';

/** @type {Object.<string, any>} */
let __state = {};

/**
 * @param {Object.<string, Object<string, import('../../../typedefs').ResourceRecord>>} state -
 */
function __setMockState(state = {}) {
  __state = state;
}

/**
 * @returns {Object.<string, Object<string, import('../../../typedefs').ResourceRecord>>} -
 */
function __getMockState() {
  return __state;
}

/**
 * @param {import('../../../typedefs').ResourceRecord} resource -
 */
async function putResource(resource) {
  if (!__state[resource.resource_id]) __state[resource.resource_id] = {};
  __state[resource.resource_id][resource.resource_id] = resource;
}

/**
 * @param {string} resource_id -
 * @returns {Promise<import('../../../typedefs').ResourceRecord?>} - event
 */
async function getResource(resource_id) {
  if (!__state[resource_id] || !__state[resource_id][resource_id])
    throw new Error(`no resource exists with id: ${resource_id}`);
  return __state[resource_id][resource_id];
}

/**
 * @param {string} resource_id -
 */
async function deleteResource(resource_id) {
  delete __state[resource_id];
}

/**
 * @param {import('../../../typedefs').OperationRecord} operation -
 */
async function createOperation(operation) {
  if (!__state[operation.resource_id])
    throw new Error('resource does not exist');
  __state[operation.resource_id][
    `${operation.resource_id}#${operation.operation_id}`
  ] = {
    resource_id: operation.resource_id,
    operation_id: operation.operation_id,
    operation_type: operation.operation_type,
    operation_status: operation.operation_status,
    operation_config: operation.operation_config,
    operation_inputs: operation.operation_inputs,
    action_graph: operation.action_graph,
    started_at: operation.started_at,
    last_updated_at: operation.last_updated_at,
  };
  (operation.actions || []).forEach((action) => {
    __state[operation.resource_id][
      `${operation.resource_id}#${operation.operation_id}#${action.action_id}`
    ] = {
      action_id: action.action_id,
      action_type: action.action_type,
      action_status: action.action_status,
    };
    (action.queries || []).forEach((query) => {
      __state[operation.resource_id][
        `${operation.resource_id}#${operation.operation_id}#${action.action_id}#${query.query_id}`
      ] = query;
    });
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @returns {Promise<import('../../../typedefs').OperationRecord?>} - event
 */
async function getOperation(resource_id, operation_id) {
  const id = `${resource_id}#${operation_id}`;
  return __state[resource_id][id];
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<import('../../../typedefs').ActionRecord?>} -
 */
async function getAction(resource_id, operation_id, action_id) {
  const id = `${resource_id}#${operation_id}#${action_id}`;
  if (!__state[resource_id] || !__state[resource_id][id]) {
    throw new Error(`no action exists with ID ${id}`);
  }
  return __state[resource_id][id];
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {string} query_id -
 * @returns {Promise<import('../../../typedefs').QueryRecord?>} -
 */
async function getQuery(resource_id, operation_id, action_id, query_id) {
  const id = `${resource_id}#${operation_id}#${action_id}#${query_id}`;
  if (!__state[resource_id] || !__state[resource_id][id])
    throw new Error(`no query exists with id: ${id}`);
  return __state[resource_id][id];
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<import('../../../typedefs').QueryRecord[] | null>} -
 */
async function getActionQueries(resource_id, operation_id, action_id) {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  const id = `${resource_id}#${operation_id}#${action_id}#`;
  return Object.keys(__state[resource_id])
    .filter((key) => key.startsWith(id))
    .map((key) => __state[resource_id][key]);
}

/**
 * @param {string} resource_id -
 * @param {import('../../../typedefs').OperationRecord} operation -
 */
async function putOperation(resource_id, operation) {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  __state[resource_id][`${resource_id}#${operation.operation_id}`] = {
    resource_id,
    operation_id: operation.operation_id,
    operation_type: operation.operation_type,
    operation_status: operation.operation_status,
    operation_config: operation.operation_config,
    operation_inputs: operation.operation_inputs,
    action_graph: operation.action_graph,
    started_at: operation.started_at,
    last_updated_at: operation.last_updated_at,
  };
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {import('../../../typedefs').ActionRecord} action -
 */
async function putAction(resource_id, operation_id, action) {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  __state[resource_id][`${resource_id}#${operation_id}#${action.action_id}`] = {
    action_id: action.action_id,
    action_type: action.action_type,
    action_status: action.action_status,
  };
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {import('../../../typedefs').QueryRecord} query -
 */
async function putQuery(resource_id, operation_id, action_id, query) {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  __state[resource_id][
    `${resource_id}#${operation_id}#${action_id}#${query.query_id}`
  ] = query;
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {import('../../../typedefs').QueryRecord[]} queries -
 */
async function putQueries(resource_id, operation_id, action_id, queries) {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  queries.forEach((query) => {
    __state[resource_id][
      `${resource_id}#${operation_id}#${action_id}#${query.query_id}`
    ] = query;
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<import('../../../typedefs').QueryRecord[]>} -
 */
async function getQueries(resource_id, operation_id, action_id) {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  const id = `${resource_id}#${operation_id}#${action_id}#`;
  return Object.keys(__state[resource_id])
    .filter((key) => key.startsWith(id))
    .map((key) => __state[resource_id][key]);
}

/**
 * @param {import('../../../typedefs').OperationRecord} operation -
 * @param {string} action_type -
 * @param {import('../../logging/logger')?} logger -
 * @param {boolean} includeQueries -
 * @returns {Promise<boolean>} -
 */
async function checkActionPrerequisites(
  operation,
  action_type,
  logger,
  includeQueries = true
) {
  if (!__state[operation.resource_id])
    throw new Error('resource does not exist');
  const current_action = operation.action_graph.getActionByType(action_type);
  const prerequisite_actions =
    operation.action_graph.getUpstreamActions(current_action) || [];
  logger &&
    logger.debug(
      `checking that prerequisite actions are completed ${JSON.stringify(
        prerequisite_actions
      )}`
    );
  let prerequisites_met = true;
  while (prerequisite_actions.length > 0) {
    const action = prerequisite_actions.pop();
    if (!action) continue;
    const id = `${operation.resource_id}#${operation.operation_id}#${action.id}`;
    const Items = Object.keys(__state[operation.resource_id])
      .filter((key) => key.startsWith(id))
      .map((key) => __state[operation.resource_id][key]);
    const incompleteQueries = [];
    while ((Items || []).length > 0) {
      const data = (Items || []).pop() || {};
      if (data.action_status && data.action_status !== 'COMPLETED') {
        logger &&
          logger.info(
            `prerequisite action ${operation.operation_type}:${action_type} hasn't finished running yet`
          );
        prerequisites_met = false;
      }
      if (data.action_status && data.action_status === 'FAILED') {
        throw new Error(
          `prerequisite action ${operation.operation_type}:${action_type} failed`
        );
      }
      if (
        includeQueries &&
        data.query_status &&
        data.query_status !== 'COMPLETED'
      ) {
        incompleteQueries.push(data.query_id);
        logger &&
          logger.debug(`incomplete prerequisite query ${JSON.stringify(data)}`);
        prerequisites_met = false;
      }
      if (
        includeQueries &&
        data.query_status &&
        data.query_status === 'FAILED'
      ) {
        throw new Error(`prerequisite query failed ${JSON.stringify(data)}`);
      }
    }
    incompleteQueries.length > 0 &&
      logger &&
      logger.info(
        `prerequisite action ${operation.operation_type}:${action_type} has ${incompleteQueries.length} incomplete queries`
      );
  }
  return prerequisites_met;
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 */
async function deleteOperation(resource_id, operation_id) {
  const id = `${resource_id}#${operation_id}`;
  Object.keys(__state[resource_id])
    .filter((key) => key.startsWith(id))
    .map((key) => delete __state[resource_id][key]);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @returns {Promise<any>} -
 */
async function getRecords(resource_id, operation_id = '') {
  if (!__state[resource_id]) throw new Error('resource does not exist');
  const id = `${resource_id}#${operation_id}`;
  const Items = Object.keys(__state[resource_id])
    .filter((key) => key.startsWith(id))
    .map((key) => __state[resource_id][key]);
  /** @type {any} */
  const records = {
    operations: [],
    actions: [],
    queries: [],
  };
  if (!Items) return records;
  Items.forEach((item) => {
    if (item.operation_type) records.operations.push(item);
    if (item.action_id) records.actions.push(item);
    if (item.query_id) records.queries.push(item);
  });
  return records;
}

module.exports = {
  createOperation,
  getRecords,
  // getAllOperations,
  // getAllResources,
  getResource,
  getOperation,
  getAction,
  getActionQueries,
  getQuery,
  getQueries,
  checkActionPrerequisites,
  putResource,
  putOperation,
  putAction,
  putQuery,
  putQueries,
  deleteResource,
  deleteOperation,
  __setMockState,
  __getMockState,
};
