'use strict';
const { DynamoDBDocument } = require('@aws-sdk/lib-dynamodb');
const { DynamoDB } = require('@aws-sdk/client-dynamodb');
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

// const ACTION_TYPE_DEFINITION_TABLE = process.env.ACTION_TYPE_DEFINITION_TABLE || '';

/**
 * @param {import('../../typedefs').ActionDefinitionRecord} action_definition -
 * @param {string} [tableName] -
 */
async function putActionDefinition(
  action_definition,
  tableName = process.env.ACTION_TYPE_DEFINITION_TABLE
) {
  await docClient.put({
    TableName: tableName,
    Item: {
      action_type: action_definition.action_type,
      queue_arn: action_definition.queue_arn,
      queue_url: action_definition.queue_url,
      dlq_arn: action_definition.dlq_arn,
      dlq_url: action_definition.dlq_url,
      lambda_arn: action_definition.lambda_arn,
    },
    ReturnValues: 'NONE',
  });
}

/**
 * @param {import('../../typedefs').ActionDefinitionRecord} action_definition -
 * @param {string} [tableName] -
 */
async function deleteActionDefinition(
  action_definition,
  tableName = process.env.ACTION_TYPE_DEFINITION_TABLE
) {
  await docClient.delete({
    TableName: tableName,
    Key: {
      action_type: action_definition.action_type,
    },
  });
}

module.exports = {
  putActionDefinition,
  deleteActionDefinition,
};
