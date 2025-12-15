import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { query, putWithThroughputRetry } from '../../dynamo/index.js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from '../../base.js';

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

/**
 * @param {import('../../actor/resources/base-resource.js').default} resource -
 */
async function putResource(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot save resource without deployment');
  const { stateTable, version, name } = resource.get('deployment');

  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;
  await putWithThroughputRetry({
    TableName: stateTable,
    Item: {
      deployment: name,
      resource_key,
      status: resource.status,
      serialized: resource.serialize(),
      version,
    },
  });
}

/**
 * @param {import('../../actor/resources/base-resource.js').default} resource -
 */
async function putResourceStatus(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot save resource without deployment');
  const { stateTable, name } = resource.get('deployment');

  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  await docClient.update({
    TableName: stateTable,
    Key: {
      deployment: name,
      resource_key,
    },
    UpdateExpression: 'SET #status = :new_status, #serialized.#s = :new_status',
    ExpressionAttributeNames: {
      '#status': 'status',
      '#serialized': 'serialized',
      '#s': 'status',
    },
    ExpressionAttributeValues: {
      ':new_status': resource.status,
    },
    ReturnValues: 'NONE',
  });
}

/**
 * @param {import('../../actor/resources/base-resource.js').default} resource -
 * @returns {Promise<import("../../actor/resources/reconcilable.js").StatusEnum?>} -
 */
async function getResourceStatus(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot save resource without deployment');
  const { stateTable, name } = resource.get('deployment');

  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  const { Items } = await query({
    TableName: stateTable,
    ConsistentRead: true,
    KeyConditionExpression:
      '#deployment = :deployment AND #resource_key = :resource_key',
    ExpressionAttributeValues: {
      ':deployment': name,
      ':resource_key': resource_key,
    },
    ExpressionAttributeNames: {
      '#resource_key': 'resource_key',
      '#deployment': 'deployment',
      '#status': 'status', // Adding 'status' as an expression attribute name
    },
    ProjectionExpression: '#status', // Return only the status field
  });

  if (!Items || Items.length === 0) return null;
  return Items[0].status;
}

/**
 * @param {import('../../actor/resources/base-resource.js').default} resource -
 * @returns {Promise<import("../../actor/typedefs.js").SerializedBaseResource?>} -
 */
async function getResource(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot fetch without deployment');
  const { stateTable, name } = resource.get('deployment');

  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  const { Items } = await query({
    TableName: stateTable,
    ConsistentRead: true,
    KeyConditionExpression:
      '#deployment = :deployment AND #resource_key = :resource_key',
    ExpressionAttributeValues: {
      ':deployment': name,
      ':resource_key': resource_key,
    },
    ExpressionAttributeNames: {
      '#resource_key': 'resource_key',
      '#deployment': 'deployment',
    },
  });
  if (!Items || Items.length === 0) return null;
  return Items[0].serialized;
}
/**
 * @param {string} deploymentName -
 * @param {string} resourceKey -
 * @returns {Promise<import("../../actor/typedefs.js").SerializedBaseResource[]>} -
 */
async function getResources(deploymentName, resourceKey) {
  const { Items } = await query({
    TableName: `${deploymentName}-state`,
    ConsistentRead: true,
    KeyConditionExpression:
      '#deployment = :deployment AND begins_with(#resource_key, :resource_key)',
    ExpressionAttributeValues: {
      ':deployment': deploymentName,
      ':resource_key': resourceKey,
    },
    ExpressionAttributeNames: {
      '#resource_key': 'resource_key',
      '#deployment': 'deployment',
    },
  });
  if (!Items || Items.length === 0) return [];
  const processedItems = Items.sort((a, b) =>
    a.resource_key.localeCompare(b.resource_key)
  );
  // the root is missing so we should return nothing
  if (processedItems[0].resource_key !== resourceKey) return [];
  return processedItems.map((item) => item.serialized);
}

/**
 * @param {import('../../actor/resources/base-resource.js').default} resource -
 */
async function deleteResource(resource) {
  if (!resource.has('deployment') || !resource.get('deployment'))
    throw new Error('cannot delete resource without deployment');
  const { stateTable, name } = resource.get('deployment');

  const resource_key = resource.parent
    ? `${resource.parent}#${resource.name}`
    : resource.name;

  await docClient.delete({
    TableName: stateTable,
    Key: {
      deployment: name,
      resource_key,
    },
  });
}

export {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};
