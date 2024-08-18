// @ts-nocheck
'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { OperationActionGraph } = require('../graph/');
const { createId } = require('../id');
const { query, batchWrite } = require('./');
const STS = require('../sts');
const SQS = require('../sqs');
const Athena = require('../athena');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('../base');

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
const RESOURCE_TABLE = process.env.RESOURCE_TABLE || '';

/**
 * @param {import('../../typedefs').ResourceRecord} resource -
 */
async function putResource(resource) {
  await docClient.put({
    TableName: RESOURCE_TABLE,
    Item: {
      resource_id: resource.resource_id,
      sort_key: resource.resource_id,
      data: {
        resource_arn: resource.resource_arn,
        athena_workgroup: resource.athena_workgroup,
        daemon_config: resource.daemon_config,
        source_properties: resource.source_properties,
        destination_properties: resource.destination_properties,
        wharfie_version: resource.wharfie_version,
        region: resource.region,
        source_region: resource.source_region,
      },
    },
    ReturnValues: 'NONE',
  });
}

/**
 * @param {string} resource_id -
 * @returns {Promise<import('../../typedefs').ResourceRecord?>} - event
 */
async function getResource(resource_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :resource_id',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
    },
  });
  if (!Items || Items.length === 0) return null;
  return {
    resource_id,
    ...Items[0].data,
  };
}

/**
 * @param {string} resource_id -
 */
async function deleteResource(resource_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ProjectionExpression: 'resource_id, sort_key',
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :resource_id)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
    },
  });
  if (!Items || Items.length === 0) return;
  while (Items.length > 0)
    await batchWrite({
      RequestItems: {
        [RESOURCE_TABLE]: Items.splice(0, 25).map((Item) => ({
          DeleteRequest: {
            Key: { resource_id: Item.resource_id, sort_key: Item.sort_key },
          },
        })),
      },
    });
}

/**
 * @param {import('../../typedefs').OperationRecord} operation -
 */
async function createOperation(operation) {
  const putItems = [
    {
      resource_id: operation.resource_id,
      sort_key: `${operation.resource_id}#${operation.operation_id}`,
      data: {
        resource_id: operation.resource_id,
        operation_id: operation.operation_id,
        operation_type: operation.operation_type,
        operation_status: operation.operation_status,
        operation_config: operation.operation_config,
        operation_inputs: operation.operation_inputs,
        action_graph: operation.action_graph.serialize(),
        started_at: operation.started_at,
        last_updated_at: operation.last_updated_at,
      },
    },
    ...(operation.actions || []).map((action) => ({
      resource_id: operation.resource_id,
      sort_key: `${operation.resource_id}#${operation.operation_id}#${action.action_id}`,
      data: {
        action_id: action.action_id,
        action_type: action.action_type,
        action_status: action.action_status,
      },
    })),
  ];

  while (putItems.length > 0)
    await batchWrite({
      RequestItems: {
        [RESOURCE_TABLE]: putItems.splice(0, 25).map((Item) => ({
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
 * @returns {Promise<import('../../typedefs').OperationRecord?>} -
 */
async function getOperation(resource_id, operation_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}`,
    },
  });
  if (!Items || Items.length === 0) return null;

  return {
    ...Items[0].data,
    action_graph: OperationActionGraph.deserialize(Items[0].data.action_graph),
    started_at: Number(Items[0].data.started_at || 0),
    last_updated_at: Number(Items[0].data.last_updated_at || 0),
  };
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {string} query_id -
 * @returns {Promise<import('../../typedefs').QueryRecord?>} -
 */
async function getQuery(resource_id, operation_id, action_id, query_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}#${query_id}`,
    },
  });
  if (!Items || Items.length === 0) return null;
  return {
    ...Items[0].data,
    last_updated_at: Number(Items[0].data.last_updated_at || 0),
  };
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<import('../../typedefs').QueryRecord[]>} -
 */
async function getQueries(resource_id, operation_id, action_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}#`,
    },
  });
  if (!Items || Items.length === 0) return [];
  return Items.map((item) => ({
    ...item.data,
    last_updated_at: Number(item.data.last_updated_at || 0),
  }));
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<import('../../typedefs').ActionRecord?>} -
 */
async function getAction(resource_id, operation_id, action_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND sort_key = :sort_key',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}`,
    },
  });
  if (!Items || Items.length === 0) return null;
  return Items[0].data;
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @returns {Promise<import('../../typedefs').QueryRecord[] | null>} -
 */
async function getActionQueries(resource_id, operation_id, action_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ExpressionAttributeNames: { '#data': 'data' },
    ProjectionExpression:
      'resource_id, sort_key, #data.query_id, #data.query_execution_id, #data.query_status',
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}#${action_id}#`,
    },
  });
  if (!Items || Items.length === 0) return null;
  return Items.map(({ data }) => data);
}

/**
 * @param {string} resource_id -
 * @param {import('../../typedefs').OperationRecord} operation -
 */
async function putOperation(resource_id, operation) {
  await docClient.put({
    TableName: RESOURCE_TABLE,
    Item: {
      resource_id,
      sort_key: `${resource_id}#${operation.operation_id}`,
      data: {
        resource_id,
        operation_id: operation.operation_id,
        operation_type: operation.operation_type,
        operation_status: operation.operation_status,
        operation_config: operation.operation_config,
        operation_inputs: operation.operation_inputs,
        action_graph: operation.action_graph.serialize(),
        started_at: operation.started_at,
        last_updated_at: operation.last_updated_at,
      },
    },
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {import('../../typedefs').ActionRecord} action -
 */
async function putAction(resource_id, operation_id, action) {
  await docClient.put({
    TableName: RESOURCE_TABLE,
    Item: {
      resource_id,
      sort_key: `${resource_id}#${operation_id}#${action.action_id}`,
      data: {
        action_id: action.action_id,
        action_type: action.action_type,
        action_status: action.action_status,
      },
    },
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {string} new_status -
 * @param {string} old_status -
 * @returns {Promise<boolean>} -
 */
async function updateActionStatus(
  resource_id,
  operation_id,
  action_id,
  new_status,
  old_status
) {
  try {
    await docClient.update({
      TableName: RESOURCE_TABLE,
      Key: {
        resource_id,
        sort_key: `${resource_id}#${operation_id}#${action_id}`,
      },
      UpdateExpression: 'SET #data.#action_status = :new_status',
      ExpressionAttributeNames: {
        '#data': 'data',
        '#action_status': 'action_status',
      },
      ConditionExpression: '#data.#action_status = :old_status',
      ExpressionAttributeValues: {
        ':new_status': new_status,
        ':old_status': old_status,
      },
      ReturnValues: 'NONE',
    });
  } catch (error) {
    // @ts-ignore
    if (error && error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
  return true;
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {import('../../typedefs').QueryRecord} query -
 */
async function putQuery(resource_id, operation_id, action_id, query) {
  await docClient.put({
    TableName: RESOURCE_TABLE,
    Item: {
      resource_id,
      sort_key: `${resource_id}#${operation_id}#${action_id}#${query.query_id}`,
      data: {
        last_updated_at: Date.now(),
        query_id: query.query_id,
        query_status: query.query_status,
        query_execution_id: query.query_execution_id,
        query_data: query.query_data,
      },
    },
  });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 * @param {string} action_id -
 * @param {import('../../typedefs').QueryRecord[]} queries -
 */
async function putQueries(resource_id, operation_id, action_id, queries) {
  const _queries = [...queries];
  while (_queries.length > 0)
    await batchWrite({
      RequestItems: {
        [RESOURCE_TABLE]: _queries.splice(0, 25).map((query) => ({
          PutRequest: {
            Item: {
              resource_id,
              sort_key: `${resource_id}#${operation_id}#${action_id}#${query.query_id}`,
              data: {
                last_updated_at: Date.now(),
                query_id: query.query_id,
                query_status: query.query_status,
                query_execution_id: query.query_execution_id,
                query_data: query.query_data,
              },
            },
          },
        })),
      },
    });
}

/**
 * @param {string} resource_id -
 * @param {string} operation_id -
 */
async function deleteOperation(resource_id, operation_id) {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ProjectionExpression: 'resource_id, sort_key',
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}`,
    },
  });
  if (!Items || Items.length === 0) return;
  while (Items.length > 0)
    await batchWrite({
      RequestItems: {
        [RESOURCE_TABLE]: Items.splice(0, 25).map((Item) => ({
          DeleteRequest: {
            Key: { resource_id: Item.resource_id, sort_key: Item.sort_key },
          },
        })),
      },
    });
}

/**
 * @param {string} query_execution_id -
 * @param {import('winston').Logger?} logger -
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
          process.env.MONITOR_QUEUE_URL,
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
 * @param {import('../../typedefs').OperationRecord} operation -
 * @param {string} action_type -
 * @param {import('../logging/logger').Logger?} logger -
 * @param {boolean} includeQueries -
 * @returns {Promise<boolean>} -
 */
async function checkActionPrerequisites(
  operation,
  action_type,
  logger,
  includeQueries = true
) {
  const action_to_check = operation.action_graph.getActionByType(action_type);
  const prerequisite_actions =
    operation.action_graph.getUpstreamActions(action_to_check) || [];
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
    const { Items } = await query({
      TableName: RESOURCE_TABLE,
      ConsistentRead: true,
      KeyConditionExpression:
        'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
      ExpressionAttributeValues: {
        ':resource_id': operation.resource_id,
        ':sort_key': `${operation.resource_id}#${operation.operation_id}#${action.id}`,
      },
    });
    const incompleteQueries = [];
    while ((Items || []).length > 0) {
      const { data } = (Items || []).pop() || {};
      if (data.action_status && data.action_status !== 'COMPLETED') {
        logger &&
          logger.info(
            `prerequisite action ${operation.operation_type}:${data.action_type} hasn't finished running yet`
          );
        prerequisites_met = false;
      }
      if (data.action_status && data.action_status === 'FAILED') {
        throw new Error(
          `prerequisite action ${operation.operation_type}:${data.action_type} failed`
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
      if (
        includeQueries &&
        data.query_execution_id &&
        data.query_status &&
        data.query_status === 'RUNNING' &&
        Date.now() - Number(data.last_updated_at || 0) > 55 * 60 * 1000
      ) {
        await checkForStaleQuery(data.query_execution_id, logger);
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
 * @returns {Promise<any>} -
 */
async function getRecords(resource_id, operation_id = '') {
  const { Items } = await query({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      'resource_id = :resource_id AND begins_with(sort_key, :sort_key)',
    ExpressionAttributeValues: {
      ':resource_id': resource_id,
      ':sort_key': `${resource_id}#${operation_id}`,
    },
  });
  /** @type {any} */
  const records = {
    operations: [],
    actions: [],
    queries: [],
  };
  if (!Items) return records;
  Items.forEach((item) => {
    if (item.data.operation_type) records.operations.push(item.data);
    if (item.data.action_id) records.actions.push(item.data);
    if (item.data.query_id) records.queries.push(item.data);
  });
  return records;
}

/**
 * @returns {Promise<import('../../typedefs').OperationRecord[]>} -
 */
async function getAllOperations() {
  let response = await docClient.scan({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
  });
  /** @type {import('../../typedefs').OperationRecord[]} */
  const operations = [];
  (response.Items || []).forEach((item) => {
    if (item.data.operation_type) operations.push(item.data);
  });

  while (response.LastEvaluatedKey) {
    response = await docClient.scan({
      TableName: RESOURCE_TABLE,
      ConsistentRead: true,
      ExclusiveStartKey: response.LastEvaluatedKey,
    });
    (response.Items || []).forEach((item) => {
      if (item.data.operation_type) operations.push(item.data);
    });
  }

  return operations;
}

/**
 * @returns {Promise<import('../../typedefs').ResourceRecord[]>} -
 */
async function getAllResources() {
  let response = await docClient.scan({
    TableName: RESOURCE_TABLE,
    ConsistentRead: true,
  });
  /** @type {import('../../typedefs').ResourceRecord[]} */
  const resources = [];
  (response.Items || []).forEach((item) => {
    if (item.data.resource_status) {
      resources.push({
        ...item.data,
        resource_id: item.resource_id,
      });
    }
  });

  while (response.LastEvaluatedKey) {
    response = await docClient.scan({
      TableName: RESOURCE_TABLE,
      ConsistentRead: true,
      ExclusiveStartKey: response.LastEvaluatedKey,
    });
    (response.Items || []).forEach((item) => {
      if (item.data.resource_status) {
        resources.push({
          ...item.data,
          resource_id: item.resource_id,
        });
      }
    });
  }

  return resources;
}

module.exports = {
  createOperation,
  getRecords,
  getAllOperations,
  getAllResources,
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
  updateActionStatus,
  putQuery,
  putQueries,
  deleteResource,
  deleteOperation,
};
