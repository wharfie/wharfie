import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { query } from './index.js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from '../base.js';

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

const DEPENDENCY_TABLE = process.env.DEPENDENCY_TABLE || '';

/**
 * @param {import('../../typedefs.js').DependencyRecord} dependency -
 * @param {string} [tableName] -
 */
async function putDependency(
  dependency,
  tableName = process.env.DEPENDENCY_TABLE
) {
  await docClient.put({
    TableName: tableName,
    Item: {
      resource_id: dependency.resource_id,
      dependency: dependency.dependency,
      interval: dependency.interval || '300',
    },
    ReturnValues: 'NONE',
  });
}

/**
 * @param {string} dependency -
 * @returns {Promise<Array<import('../../typedefs.js').DependencyRecord>?>} - event
 */
async function findDependencies(dependency) {
  if (!dependency) return [];
  const { Items } = await query({
    TableName: DEPENDENCY_TABLE,
    ConsistentRead: true,
    KeyConditionExpression: '#dependency = :dependency',
    ExpressionAttributeValues: {
      ':dependency': dependency,
    },
    ExpressionAttributeNames: {
      '#dependency': 'dependency',
    },
  });
  if (!Items) return [];
  return Items.map((item) => ({
    dependency,
    resource_id: item.resource_id,
    interval: item.interval || '300',
  })).filter((item) => item.resource_id);
}

/**
 * @param {import('../../typedefs.js').DependencyRecord} dependency -
 * @param {string} [tableName] -
 */
async function deleteDependency(
  dependency,
  tableName = process.env.DEPENDENCY_TABLE
) {
  await docClient.delete({
    TableName: tableName,
    Key: {
      resource_id: dependency.resource_id,
      dependency: dependency.dependency,
    },
  });
}

export { putDependency, findDependencies, deleteDependency };
