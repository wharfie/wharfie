'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const {
  DynamoDB,
  ResourceNotFoundException,
  ConditionalCheckFailedException,
} = require('@aws-sdk/client-dynamodb');
const { createId } = require('../id');
const { query, batchWrite } = require('.');
const STS = require('../sts');
const SQS = require('../sqs');
const Athena = require('../athena');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('../base');
const { Operation, Action, Query, Resource } = require('../graph');

const credentials = fromNodeProviderChain();
const docClient = DynamoDBDocument.from(
  new DynamoDB({
    ...BaseAWS.config({
      maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 30),
    }),
    region: process.env.AWS_REGION,
    credentials,
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);
const OPERATIONS_TABLE = process.env.OPERATIONS_TABLE || '';

/**
 * @param {Resource} resource -
 * @param {string} [tableName] -
 */
async function putResource(resource, tableName = process.env.OPERATIONS_TABLE) {
  await docClient.put({
    TableName: tableName,
    Item: resource.toRecord(),
    ReturnValues: 'NONE',
  });
}

/**
 * @param {string} resource_id -
 * @param {string} [tableName] -
 * @returns {Promise<Resource?>} -
 */
async function getResource(
  resource_id,
  tableName = process.env.OPERATIONS_TABLE
) {
  try {
    const { Items } = await query({
      TableName: tableName,
      ConsistentRead: true,
      KeyConditionExpression:
        'resource_id = :resource_id AND sort_key = :resource_id',
      ExpressionAttributeValues: {
        ':resource_id': resource_id,
      },
    });
    if (!Items || Items.length === 0) return null;
    // @ts-ignore
    return Resource.fromRecord(Items[0]);
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) {
      throw e;
    }
    return null;
  }
}

/**
 * @param {Resource} resource -
 * @param {string} [tableName] -
 */
async function deleteResource(
  resource,
  tableName = process.env.OPERATIONS_TABLE
) {
  let Items;
  try {
    const queryResult = await query({
      TableName: tableName,
      ProjectionExpression: 'resource_id, sort_key',
      ConsistentRead: true,
      KeyConditionExpression:
        'resource_id = :resource_id AND begins_with(sort_key, :resource_id)',
      ExpressionAttributeValues: {
        ':resource_id': resource.id,
      },
    });
    Items = queryResult.Items;
  } catch (e) {
    if (!(e instanceof ResourceNotFoundException)) {
      throw e;
    }
    return;
  }
  if (!Items || Items.length === 0) return;
  while (Items.length > 0)
    await batchWrite({
      RequestItems: {
        [OPERATIONS_TABLE]: Items.splice(0, 25).map((Item) => ({
          DeleteRequest: {
            Key: { resource_id: Item.resource_id, sort_key: Item.sort_key },
          },
        })),
      },
    });
}

/**
 * @param {Operation} operation -
 */
async function putOperation(operation) {
  const putItems = operation.toRecords();
  while (putItems.length > 0)
    await batchWrite({
      RequestItems: {
        [OPERATIONS_TABLE]: putItems.splice(0, 25).map((Item) => ({
          PutRequest: {
            Item,
          },
        })),
      },
    });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @returns {Promise<Operation?>} -
 */
async function getOperation(resource_id, operation_id) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}`,
    },
  });
  if (!Items || Items.length === 0) return null;
  return Operation.fromRecord(Items[0]);
}

/**
 * @param {string} resource_id -
 * @returns {Promise<Operation[]>} -
 */
async function getOperations(resource_id) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#`,
    },
  });
  if (!Items || Items.length === 0) return [];
  // todo: use a less than key condition to filter out all queries that will have ids
  // longer than what an action's sortkey could possibly be
  return Items.filter(
    (item) => item?.data?.record_type === Operation.RecordType
  ).map(Operation.fromRecord);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {string} query_id -
 * @returns {Promise<Query?>} -
 */
async function getQuery(resource_id, operation_id, action_id, query_id) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}#${query_id}`,
    },
  });
  if (!Items || Items.length === 0) return null;
  return Query.fromRecord(Items[0]);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<Query[]>} -
 */
async function getQueries(resource_id, operation_id, action_id) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}#`,
    },
  });
  if (!Items || Items.length === 0) return [];
  return Items.map(Query.fromRecord);
}

/**
 * @param {Operation} operation -
 * @returns {Promise<Action[]>} -
 */
async function getActions(operation) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': operation.resource_id,
      ':sort_key': `${operation.resource_id}#${operation.id}#`,
    },
  });
  if (!Items || Items.length === 0) return [];
  // todo: use a less than key condition to filter out all queries that will have ids
  // longer than what an action's sortkey could possibly be
  return Items.filter(
    (item) => item?.data?.record_type === Action.RecordType
  ).map(Action.fromRecord);
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<Action?>} -
 */
async function getAction(resource_id, operation_id, action_id) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}`,
    },
  });
  if (!Items || Items.length === 0) return null;
  return Action.fromRecord(Items[0]);
}

/**
 * @param {Action} action -
 */
async function putAction(action) {
  const putItems = action.toRecords();
  while (putItems.length > 0)
    await batchWrite({
      RequestItems: {
        [OPERATIONS_TABLE]: putItems.splice(0, 25).map((Item) => ({
          PutRequest: {
            Item,
          },
        })),
      },
    });
}

/**
 * @param {Action} action -
 * @param {import('../graph/action').WharfieActionStatusEnum} new_status -
 * @returns {Promise<boolean>} -
 */
async function updateActionStatus(action, new_status) {
  try {
    await docClient.update({
      TableName: OPERATIONS_TABLE,
      Key: {
        resource_id: action.resource_id,
        sort_key: `${action.resource_id}#${action.operation_id}#${action.id}`,
      },
      UpdateExpression: 'SET #data.#status = :new_status',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#status': 'status',
      },
      ConditionExpression: '#data.#status = :old_status',
      ExpressionAttributeValues: {
        ':new_status': new_status,
        ':old_status': action.status,
      },
      ReturnValues: 'NONE',
    });
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * @param {Query} query -
 */
async function putQuery(query) {
  const putItem = query.toRecord();
  await docClient.put({
    TableName: OPERATIONS_TABLE,
    Item: putItem,
  });
}

/**
 * @param {Query[]} queries -
 */
async function putQueries(queries) {
  const putItems = queries.map((query) => query.toRecord());
  while (putItems.length > 0)
    await batchWrite({
      RequestItems: {
        [OPERATIONS_TABLE]: putItems.splice(0, 25).map((Item) => ({
          PutRequest: {
            Item,
          },
        })),
      },
    });
}

/**
 * @param {Operation} operation -
 */
async function deleteOperation(operation) {
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ProjectionExpression: 'resource_id, sort_key',
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': operation.resource_id,
      ':sort_key': `${operation.resource_id}#${operation.id}`,
    },
  });
  if (!Items || Items.length === 0) return;
  while (Items.length > 0)
    await batchWrite({
      RequestItems: {
        [OPERATIONS_TABLE]: Items.splice(0, 25).map((Item) => ({
          DeleteRequest: {
            Key: { resource_id: Item.resource_id, sort_key: Item.sort_key },
          },
        })),
      },
    });
}

/**
 * @param {string} query_execution_id -
 * @param {import('../logging/logger')?} logger -
 */
async function checkForStaleQuery(query_execution_id, logger) {
  const sts = new STS({ region: process.env.AWS_REGION });
  const sqs = new SQS({ region: process.env.AWS_REGION });
  const athena = new Athena({ region: process.env.AWS_REGION });

  const { QueryExecution } = await athena.getQueryExecution({
    QueryExecutionId: query_execution_id,
  });
  const queryState =
    QueryExecution && QueryExecution.Status && QueryExecution.Status.State;
  if (queryState === 'FAILED' && QueryExecution && QueryExecution.Query) {
    logger &&
      logger.warn(
        `STALE QUERY DETECTED, query execution id: ${query_execution_id}`
      );
    try {
      const queryEvent = JSON.parse(
        QueryExecution.Query.split('\n').slice(-1)[0].substring(3)
      );
      if (
        queryEvent.resource_id &&
        queryEvent.operation_id &&
        queryEvent.action_id &&
        queryEvent.query_id
      ) {
        const { Account } = await sts.getCallerIdentity();
        /** @type {import('../../typedefs').AthenaEvent} */
        const synthetic_athena_event = {
          version: '0',
          id: createId(),
          'detail-type': 'Athena Query State Change',
          source: 'aws.athena',
          account: Account || '',
          time: '',
          region: process.env.AWS_REGION || '',
          retries: 0,
          resources: [],
          detail: {
            versionId: '0',
            currentState: 'FAILED',
            previousState: 'RUNNING',
            statementType: QueryExecution.StatementType || '',
            queryExecutionId: query_execution_id,
            workgroupName: QueryExecution.WorkGroup || '',
            sequenceNumber: '',
          },
        };
        await sqs.enqueue(
          synthetic_athena_event,
          process.env.MONITOR_QUEUE_URL || '',
          0
        );
      }
    } catch (e) {
      logger &&
        logger.warn(
          `failed to handle stale query ${e}, ${JSON.stringify(QueryExecution)}`
        );
    }
  }
}

/**
 * @param {Operation} operation -
 * @param {import('../graph/action').WharfieActionTypeEnum} action_type -
 * @param {import('../logging/logger')?} logger -
 * @param {boolean} includeQueries -
 * @returns {Promise<boolean>} -
 */
async function checkActionPrerequisites(
  operation,
  action_type,
  logger,
  includeQueries = true
) {
  const action_id_to_check = operation.getActionIdByType(action_type);
  const prerequisite_action_ids =
    operation.getUpstreamActionIds(action_id_to_check) || [];
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
    const { Items } = await query({
      TableName: OPERATIONS_TABLE,
      ConsistentRead: true,
      KeyConditionExpression:
        'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
      ExpressionAttributeValues: {
        ':resource_id': operation.resource_id,
        ':sort_key': `${operation.resource_id}#${operation.id}#${action_id}`,
      },
    });
    const incompleteQueries = [];
    if (!Items) return true;

    while (Items.length > 0) {
      const _item = Items.pop();
      if (!_item) continue;
      const { data } = _item;
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
          if (includeQueries && data.status !== Query.Status.COMPLETED) {
            incompleteQueries.push(data.id);
            logger &&
              logger.debug(
                `incomplete prerequisite query ${JSON.stringify(data)}`
              );
            prerequisites_met = false;
          }
          if (includeQueries && data.status === Query.Status.FAILED) {
            throw new Error(
              `prerequisite query failed ${JSON.stringify(data)}`
            );
          }
          if (
            includeQueries &&
            data.execution_id &&
            data.status === Query.Status.RUNNING &&
            Date.now() - Number(data.last_updated_at || 0) > 55 * 60 * 1000
          ) {
            await checkForStaleQuery(data.execution_id, logger);
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
  const { Items } = await query({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}`,
    },
  });
  /** @type {getRecordsReturn} */
  const records = {
    operations: [],
    actions: [],
    queries: [],
  };
  if (!Items) return records;

  const processedItems = Items.sort((a, b) =>
    a.sort_key.localeCompare(b.sort_key)
  ).filter((item) => item.data.record_type !== Resource.RecordType);

  /**
   * @typedef ActionRecordGroup
   * @property {import('../graph/typedefs').ActionRecord} action_record -
   * @property {import('../graph/typedefs').QueryRecord[]} query_records -
   */
  /** @type {ActionRecordGroup[]} */
  let operationBatch = [];
  /** @type {import('../graph/typedefs').QueryRecord[]} */
  let actionBatch = [];
  while (processedItems.length > 0) {
    const item = processedItems.pop();
    if (!item) continue;
    switch (item.data.record_type) {
      case Operation.RecordType:
        records.operations.push(Operation.fromRecords(item, operationBatch));
        operationBatch = [];
        break;
      case Action.RecordType:
        records.actions.push(Action.fromRecords(item, actionBatch));
        operationBatch.push({
          // @ts-ignore
          action_record: item,
          query_records: actionBatch,
        });
        actionBatch = [];
        break;
      case Query.RecordType:
        records.queries.push(Query.fromRecord(item));
        // @ts-ignore
        actionBatch.push(item);
        break;
      default:
        throw new Error(
          `unrecognized record_type, in record ${JSON.stringify(item)}`
        );
    }
  }
  return records;
}

/**
 * @returns {Promise<Operation[]>} -
 */
async function getAllOperations() {
  let response = await docClient.scan({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
  });
  /** @type {Operation[]} */
  const operations = [];
  (response.Items || []).forEach((item) => {
    if (item.data.record_type === 'OPERATION')
      operations.push(Operation.fromRecord(item));
  });

  while (response.LastEvaluatedKey) {
    response = await docClient.scan({
      TableName: OPERATIONS_TABLE,
      ConsistentRead: true,
      ExclusiveStartKey: response.LastEvaluatedKey,
    });
    (response.Items || []).forEach((item) => {
      if (item.data.record_type === 'OPERATION')
        operations.push(Operation.fromRecord(item));
    });
  }

  return operations;
}

/**
 * @returns {Promise<Resource[]>} -
 */
async function getAllResources() {
  let response = await docClient.scan({
    TableName: OPERATIONS_TABLE,
    ConsistentRead: true,
  });
  /** @type {Resource[]} */
  const resources = [];
  (response.Items || []).forEach((item) => {
    if (item.data.record_type === Resource.RecordType) {
      // @ts-ignore
      resources.push(Resource.fromRecord(item));
    }
  });

  while (response.LastEvaluatedKey) {
    response = await docClient.scan({
      TableName: OPERATIONS_TABLE,
      ConsistentRead: true,
      ExclusiveStartKey: response.LastEvaluatedKey,
    });
    (response.Items || []).forEach((item) => {
      if (item.data.record_type === Resource.RecordType) {
        // @ts-ignore
        resources.push(Resource.fromRecord(item));
      }
    });
  }

  return resources;
}

/**
 * @param {Object.<string, import('../graph/typedefs').ResourceRecordData | import('../graph/typedefs').OperationRecordData | import('../graph/typedefs').ActionRecordData | import('../graph/typedefs').QueryRecordData >} state -
 */
// @ts-ignore
function __setMockState(state = {}) {
  throw new Error('stub for mock typechecking');
}

/**
 * @returns {Object.<string, import('../graph/typedefs').ResourceRecordData | import('../graph/typedefs').OperationRecordData | import('../graph/typedefs').ActionRecordData | import('../graph/typedefs').QueryRecordData >} -
 */
function __getMockState() {
  throw new Error('stub for mock typechecking');
  // @ts-ignore
  // eslint-disable-next-line no-unreachable
  return {};
}
module.exports = {
  getRecords,
  getAllOperations,
  getAllResources,
  getResource,
  getOperation,
  getOperations,
  getActions,
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
  __getMockState,
  __setMockState,
};
