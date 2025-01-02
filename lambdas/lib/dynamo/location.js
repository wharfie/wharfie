'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
const { query } = require('.');
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

const LOCATION_TABLE = process.env.LOCATION_TABLE || '';

/**
 * @param {import('../../typedefs').LocationRecord} location -
 * @param {string} [tableName] -
 */
async function putLocation(location, tableName = process.env.LOCATION_TABLE) {
  await docClient.put({
    TableName: tableName,
    Item: {
      resource_id: location.resource_id,
      location: location.location,
      interval: location.interval || '300',
    },
    ReturnValues: 'NONE',
  });
}

/**
 * @param {string} location -
 * @returns {Promise<Array<import('../../typedefs').LocationRecord>?>} - event
 */
async function findLocations(location) {
  if (!location || location === 's3://') return [];
  const { Items } = await query({
    TableName: LOCATION_TABLE,
    ConsistentRead: true,
    KeyConditionExpression: '#location = :location',
    ExpressionAttributeValues: {
      ':location': location,
    },
    ExpressionAttributeNames: {
      '#location': 'location',
    },
  });
  if (!Items || Items.length === 0)
    return findLocations(
      location.slice(-1) === '/'
        ? location.substring(
            0,
            location.lastIndexOf('/', location.lastIndexOf('/') - 1) + 1
          )
        : location.substring(0, location.lastIndexOf('/') + 1)
    );
  return Items.map((item) => ({
    location,
    resource_id: item.resource_id,
    interval: item.interval || '300',
  })).filter((item) => item.resource_id);
}

/**
 * @param {import('../../typedefs').LocationRecord} location -
 * @param {string} [tableName] -
 */
async function deleteLocation(
  location,
  tableName = process.env.LOCATION_TABLE
) {
  await docClient.delete({
    TableName: tableName,
    Key: {
      resource_id: location.resource_id,
      location: location.location,
    },
  });
}

module.exports = {
  putLocation,
  findLocations,
  deleteLocation,
};
