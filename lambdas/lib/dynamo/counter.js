'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { query, batchWrite } = require('./');
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

const COUNTER_TABLE = process.env.COUNTER_TABLE || '';
const STACK_NAME = process.env.STACK_NAME || '';

/**
 * @param {string} counter - name of dynamo counter record
 * @param {number} value - value to increment counter by
 */
async function increment(counter, value) {
  try {
    await docClient.update({
      TableName: COUNTER_TABLE,
      Key: {
        stack_name: STACK_NAME,
        counter,
      },
      UpdateExpression: 'SET #val = if_not_exists(#val, :default) + :incr',
      ExpressionAttributeNames: { '#val': 'value' },
      ConditionExpression:
        'attribute_not_exists(#val) OR (#val > :zero AND :incr = :negative_one) OR (#val >= :zero AND :incr = :one)',
      ExpressionAttributeValues: {
        ':incr': value,
        ':zero': 0,
        ':one': 1,
        ':negative_one': -1,
        ':default': value === -1 ? 1 : 0,
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
 * @param {string} counter - name of dynamo counter record
 * @param {number} value - value to increment counter by
 * @returns {Promise<number>} - updated counter value
 */
async function incrementReturnUpdated(counter, value) {
  try {
    const result = await docClient.update({
      TableName: COUNTER_TABLE,
      Key: {
        stack_name: STACK_NAME,
        counter,
      },
      UpdateExpression: 'SET #val = if_not_exists(#val, :default) + :incr',
      ExpressionAttributeNames: { '#val': 'value' },
      ConditionExpression:
        'attribute_not_exists(#val) OR (#val > :zero AND :incr = :negative_one) OR (#val >= :zero AND :incr = :one)',
      ExpressionAttributeValues: {
        ':incr': value,
        ':zero': 0,
        ':one': 1,
        ':negative_one': -1,
        ':default': value === -1 ? 1 : 0,
      },
      ReturnValues: 'UPDATED_NEW',
    });
    if (!result.Attributes) throw new Error('Counter increment failed');
    return result.Attributes.value;
  } catch (error) {
    // @ts-ignore
    if (error && error.name === 'ConditionalCheckFailedException') {
      return 0;
    }
    throw error;
  }
}

/**
 * @param {string} prefix - prefix of dynamo counter record
 */
async function deleteCountersByPrefix(prefix) {
  const { Items } = await query({
    TableName: COUNTER_TABLE,
    ProjectionExpression: '#counter',
    ConsistentRead: true,
    ExpressionAttributeNames: { '#counter': 'counter' },
    KeyConditionExpression:
      'stack_name = :stack_name AND begins_with(#counter, :prefix)',
    ExpressionAttributeValues: {
      // @ts-ignore
      ':stack_name': STACK_NAME,
      // @ts-ignore
      ':prefix': prefix,
    },
  });
  if (!Items || Items.length === 0) return;
  while (Items.length > 0)
    await batchWrite({
      // @ts-ignore
      RequestItems: {
        [COUNTER_TABLE]: Items.splice(0, 25).map((Item) => ({
          DeleteRequest: {
            Key: { stack_name: STACK_NAME, counter: Item.counter },
          },
        })),
      },
    });
}

module.exports = {
  increment,
  incrementReturnUpdated,
  deleteCountersByPrefix,
};
