'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('../base');

const credentials = fromNodeProviderChain();
const docClient = DynamoDBDocument.from(
  new DynamoDB({
    ...BaseAWS.config(),
    region: process.env.AWS_REGION,
    maxAttempts: Number(process.env.DYNAMO_MAX_RETRIES || 300),
    credentials,
  }),
  { marshallOptions: { removeUndefinedValues: true } }
);

const SEMAPHORE_TABLE = process.env.SEMAPHORE_TABLE || '';

/**
 * @param {string} semaphore - name of dynamo sempahore record
 * @param {number} threshold - threshold that the counter needs to be <= in order to increment
 * @returns {Promise<boolean>} - if the semaphore was successfully entered
 */
async function increase(semaphore, threshold) {
  // `limit` is a number that can be manually managed in dynamodb in order to
  // override the resource's athena query concurrency.  Global concurrency is
  // still enforced if this limit value is set.
  try {
    await docClient.update({
      TableName: SEMAPHORE_TABLE,
      Key: {
        semaphore,
      },
      UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :incr',
      ExpressionAttributeNames: { '#val': 'value', '#limit': 'limit' },
      ConditionExpression:
        '( attribute_not_exists(#limit) AND ( attribute_not_exists(#val) OR (#val <= :threshold AND #val >= :zero) ) ) OR ( attribute_exists(#limit)     AND ( attribute_not_exists(#val) OR (#val <= #limit     AND #val >= :zero) ) )',
      ExpressionAttributeValues: {
        ':incr': 1,
        ':zero': 0,
        ':threshold': threshold - 1,
      },
      ReturnValues: 'NONE',
    });
    return true;
  } catch (error) {
    // @ts-ignore
    if (error && error.name === 'ConditionalCheckFailedException') {
      return false;
    }
    throw error;
  }
}

/**
 * @param {string} semaphore - name of dynamo sempahore record
 */
async function release(semaphore) {
  try {
    await docClient.update({
      TableName: SEMAPHORE_TABLE,
      Key: {
        semaphore,
      },
      UpdateExpression: 'SET #val = if_not_exists(#val, :default) + :incr',
      ExpressionAttributeNames: { '#val': 'value' },
      ConditionExpression: 'attribute_not_exists(#val) OR #val > :zero',
      ExpressionAttributeValues: {
        ':incr': -1,
        ':zero': 0,
        ':default': 1,
      },
      ReturnValues: 'NONE',
    });
  } catch (error) {
    // @ts-ignore
    if (error && error.name === 'ConditionalCheckFailedException') {
      return;
    }
    throw error;
  }
}

/**
 * @param {string} semaphore - name of dynamo sempahore record
 * @returns {Promise<number>} - semaphore lock value
 */
async function get(semaphore) {
  const { Item } = await docClient.get({
    TableName: SEMAPHORE_TABLE,
    ConsistentRead: true,
    Key: {
      semaphore,
    },
  });
  if (Item === undefined) {
    return 0;
  }
  return Item.value;
}

/**
 * @param {string} semaphore - name of dynamo semaphore record
 */
async function deleteSemaphore(semaphore) {
  // remove value from top-level `wharfie` semaphore
  let result = await get(semaphore);
  while (result > 0) {
    await release(`wharfie`);
    result = result - 1;
  }
  await docClient.delete({
    TableName: SEMAPHORE_TABLE,
    Key: {
      semaphore,
    },
  });
}

module.exports = {
  increase,
  release,
  deleteSemaphore,
};
