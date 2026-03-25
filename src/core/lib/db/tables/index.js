import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import {
  DynamoDB,
  ProvisionedThroughputExceededException,
  ResourceNotFoundException,
} from '@aws-sdk/client-dynamodb';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from '../../aws/base.js';

const credentials = fromNodeProviderChain();
const docClient = DynamoDBDocument.from(
  new DynamoDB({
    ...BaseAWS.config({
      maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 300),
    }),
    region: process.env.AWS_REGION,
    credentials,
  }),
  { marshallOptions: { removeUndefinedValues: true } },
);

/**
 * @param {import("@aws-sdk/lib-dynamodb").QueryCommandInput} params - params.
 * @returns {Promise<import("@aws-sdk/lib-dynamodb").QueryCommandOutput>} - Result.
 */
async function query(params) {
  /** @type {Object<string, import("@aws-sdk/client-dynamodb").AttributeValue>[]} */
  let results = [];
  let response = await docClient.query(params);

  if (!response.Items || response.Items.length === 0)
    return { Items: results, $metadata: response.$metadata };
  results = results.concat(response.Items);

  while (response.LastEvaluatedKey !== undefined) {
    response = await docClient.query({
      ...params,
      ExclusiveStartKey: response.LastEvaluatedKey,
    });
    if (!response.Items || response.Items.length === 0)
      return { Items: results, $metadata: response.$metadata };
    results = results.concat(response.Items);
  }

  return { Items: results, $metadata: response.$metadata };
}

/**
 * @param {import("@aws-sdk/lib-dynamodb").BatchWriteCommandInput} params - params.
 */
async function batchWrite(params) {
  let { UnprocessedItems: items } = await docClient.batchWrite(params);

  while (items !== undefined && Object.keys(items).length > 0) {
    const { UnprocessedItems } = await docClient.batchWrite({
      RequestItems: items,
    });
    items = UnprocessedItems;
  }
}

const MAX_PUT_RETRY_TIMEOUT_SECONDS = 20;
const MAX_PUT_RETRY_ATTEMPTS = 100;
/**
 * @param {import("@aws-sdk/lib-dynamodb").PutCommandInput} params - params.
 * @returns {Promise<import("@aws-sdk/lib-dynamodb").PutCommandOutput>} - Result.
 */
async function putWithThroughputRetry(params) {
  let attempts = 0;
  while (attempts < MAX_PUT_RETRY_ATTEMPTS) {
    try {
      return await docClient.put(params);
    } catch (e) {
      if (
        e instanceof ProvisionedThroughputExceededException ||
        // todo this should be handled in the state table reconcile method
        e instanceof ResourceNotFoundException
      ) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.floor(
              Math.random() *
                Math.min(
                  MAX_PUT_RETRY_TIMEOUT_SECONDS,
                  1 * Math.pow(2, attempts),
                ),
            ) * 1000,
          ),
        );
        attempts++;
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max attempts exceeded');
}

export { query, batchWrite, putWithThroughputRetry, docClient };
