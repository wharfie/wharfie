'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { query: queryDb, batchWrite } = require('.');
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

const EVENT_TABLE = process.env.EVENT_TABLE || '';

/**
 * @param {string} resource_id -
 * @param {string} partition -
 * @param {Array<number>} window -
 * @returns {Promise<Object<string, import("@aws-sdk/client-dynamodb").AttributeValue>[]>} -
 */
async function query(resource_id, partition, window) {
  const [start_by, end_by] = window;
  const { Items } = await queryDb({
    TableName: EVENT_TABLE,
    ConsistentRead: true,
    KeyConditionExpression:
      '#resource_id = :id AND #sort_key BETWEEN :start_by AND :end_by',
    ExpressionAttributeValues: {
      // @ts-ignore
      ':id': resource_id,
      // @ts-ignore
      ':start_by': `${partition}:${start_by}`,
      // @ts-ignore
      ':end_by': `${partition}:${end_by}`,
    },
    ExpressionAttributeNames: {
      '#resource_id': 'resource_id',
      '#sort_key': 'sort_key',
    },
  });

  return Items || [];
}

/**
 * @param {import('../../typedefs').ScheduledEventRecord} item -
 */
async function schedule(item) {
  item.ttl = Math.round(Date.now() / 1000) + 60 * 60 * 24 * 3; // 3 day ttl
  await docClient.put({
    TableName: EVENT_TABLE,
    Item: item,
    ConditionExpression: 'attribute_not_exists(sort_key)',
    ReturnValues: 'NONE',
  });
}

/**
 * @param {import('../../typedefs').ScheduledEventRecord} item -
 * @param {string} status -
 */
async function update(item, status) {
  item.status = status;
  item.updated_at = new Date().getTime();
  item.ttl = Math.round(Date.now() / 1000) + 60 * 60 * 24 * 3; // 3 day ttl
  await docClient.put({
    TableName: EVENT_TABLE,
    Item: item,
    ReturnValues: 'NONE',
  });
}

/**
 * @param {string} resource_id -
 */
async function delete_records(resource_id) {
  const { Items } = await queryDb({
    TableName: EVENT_TABLE,
    ProjectionExpression: 'resource_id, sort_key',
    ConsistentRead: true,
    KeyConditionExpression: '#resource_id = :resource_id',
    ExpressionAttributeValues: {
      // @ts-ignore
      ':resource_id': resource_id,
    },
    ExpressionAttributeNames: {
      '#resource_id': 'resource_id',
    },
  });
  if (!Items || Items.length === 0) return;
  while (Items.length > 0)
    await batchWrite({
      RequestItems: {
        [EVENT_TABLE]: Items.splice(0, 25).map((Item) => ({
          DeleteRequest: {
            Key: { resource_id: Item.resource_id, sort_key: Item.sort_key },
          },
        })),
      },
    });
}

module.exports = {
  schedule,
  update,
  query,
  delete_records,
};
