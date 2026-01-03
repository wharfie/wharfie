import { DynamoDBDocument } from '@aws-sdk/lib-dynamodb';
import {
  DynamoDB,
  ProvisionedThroughputExceededException,
  ResourceNotFoundException,
  ReturnValue,
} from '@aws-sdk/client-dynamodb';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import BaseAWS from '../../base.js';
import { CONDITION_TYPE } from '../base.js';

/**
 * Factory options for creating a DynamoDB wrapper client.
 * @typedef CreateDynamoDBOptions
 * @property {string} [region] AWS region to use. Defaults to `process.env.AWS_REGION`.
 */

/**
 * Factory function that creates a DynamoDB wrapper client.
 * @param {CreateDynamoDBOptions} options -
 * @returns {import('../base.js').DBClient} -
 */
export default function createDynamoDB(
  { region } = { region: process.env.AWS_REGION },
) {
  const credentials = fromNodeProviderChain();
  const docClient = DynamoDBDocument.from(
    new DynamoDB({
      ...BaseAWS.config({
        maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 30),
      }),
      region,
      credentials,
    }),
    { marshallOptions: { removeUndefinedValues: true } },
  );

  /**
   * @param {import('../base.js').QueryParams} params -
   * @returns {import('../base.js').QueryReturn} -
   */
  async function query(params) {
    const conditionExpression = params.keyConditions
      .map((condition) => {
        if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
          return `begins_with(#${condition.propertyName}, :${condition.propertyName})`;
        } else if (condition.conditionType === CONDITION_TYPE.EQUALS) {
          return `#${condition.propertyName} = :${condition.propertyName}`;
        } else {
          throw new Error(`invalid condition type: ${condition.conditionType}`);
        }
      })
      .join(' AND ');

    const expressionValues = params.keyConditions.reduce((acc, condition) => {
      // @ts-ignore
      acc[`:${condition.propertyName}`] = condition.propertyValue;
      return acc;
    }, {});

    const expressionNames = params.keyConditions.reduce((acc, condition) => {
      // @ts-ignore
      acc[`#${condition.propertyName}`] = condition.propertyName;
      return acc;
    }, {});

    const dynamoParams = {
      TableName: params.tableName,
      ConsistentRead: params.consistentRead || true,
      KeyConditionExpression: conditionExpression,
      ExpressionAttributeValues: expressionValues,
      ExpressionAttributeNames: expressionNames,
    };
    /** @type {Object<string, import("@aws-sdk/client-dynamodb").AttributeValue>[]} */
    let results = [];
    let response = await docClient.query(dynamoParams);
    // TODO: write this to debug logging
    // console.log(response.$metadata)

    if (!response.Items || response.Items.length === 0) {
      return results;
    }
    results = results.concat(response.Items);

    while (response.LastEvaluatedKey !== undefined) {
      response = await docClient.query({
        ...dynamoParams,
        ExclusiveStartKey: response.LastEvaluatedKey,
      });
      if (!response.Items || response.Items.length === 0) {
        return results;
      }
      results = results.concat(response.Items);
      // TODO: write this to debug logging
      // console.log(response.$metadata)
    }

    return results;
  }

  const MAX_PUT_RETRY_TIMEOUT_SECONDS = 20;
  const MAX_PUT_RETRY_ATTEMPTS = 100;
  /**
   * @param {import('../base.js').PutParams} params -
   * @returns {import('../base.js').PutReturn} -
   */
  async function put(params) {
    const dynamoParams = {
      TableName: params.tableName,
      Item: params.record,
    };
    let attempts = 0;
    while (attempts < MAX_PUT_RETRY_ATTEMPTS) {
      try {
        await docClient.put(dynamoParams);
        return;
      } catch (e) {
        if (
          // Most dynamo usage is very bursty, retrying these errors can help reduce provisioning overhead
          e instanceof ProvisionedThroughputExceededException ||
          // Creating new tables is eventually consistent which can cause this race condition
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

  /**
   * @param {import('../base.js').UpdateParams} params -
   * @returns {import('../base.js').UpdateReturn} -
   */
  async function update(params) {
    // --- Key ---
    /** @type {Record<string, any>} */
    const key = {
      [params.keyName]: params.keyValue,
    };
    if (params.sortKeyName && params.sortKeyValue !== undefined) {
      key[params.sortKeyName] = params.sortKeyValue;
    }

    // --- Updates (explicit or derived from record) ---
    /** @type {import('../base.js').UpdateDefinition[]} */
    const updates =
      params.updates && params.updates.length > 0
        ? params.updates
        : Object.entries(params.record || {})
            .filter(([k, v]) => v !== undefined)
            .filter(([k]) => k !== params.keyName && k !== params.sortKeyName)
            .map(([k, v]) => ({ property: [k], propertyValue: v }));

    if (!updates || updates.length === 0) {
      // no-op (explicitly do nothing)
      return;
    }

    // --- Expression builders ---
    /** @type {Record<string, string>} */
    const ExpressionAttributeNames = {};
    /** @type {Record<string, any>} */
    const ExpressionAttributeValues = {};

    // reuse the same #name placeholder for the same attribute segment
    /** @type {Map<string, string>} */
    const nameTokenBySegment = new Map();
    let nameCounter = 0;
    let valueCounter = 0;

    const nameTokenFor = (/** @type {string} */ segment) => {
      const existing = nameTokenBySegment.get(segment);
      if (existing) return existing;
      const token = `#n${nameCounter++}`;
      nameTokenBySegment.set(segment, token);
      ExpressionAttributeNames[token] = segment;
      return token;
    };

    const setClauses = updates.map((u) => {
      if (!Array.isArray(u.property) || u.property.length === 0) {
        throw new Error(
          'UpdateDefinition.property must be a non-empty string[]',
        );
      }

      const path = u.property.map(nameTokenFor).join('.');
      const valueToken = `:v${valueCounter++}`;
      ExpressionAttributeValues[valueToken] = u.propertyValue;

      return `${path} = ${valueToken}`;
    });

    // --- Optional conditions (same pattern as your query()) ---
    let ConditionExpression;
    if (params.conditions && params.conditions.length > 0) {
      ConditionExpression = params.conditions
        .map((condition) => {
          const nameToken = nameTokenFor(condition.propertyName);
          const valueToken = `:c_${condition.propertyName}`;

          // only set if not already set (avoid collisions)
          if (!(valueToken in ExpressionAttributeValues)) {
            ExpressionAttributeValues[valueToken] = condition.propertyValue;
          }

          if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
            return `begins_with(${nameToken}, ${valueToken})`;
          } else if (condition.conditionType === CONDITION_TYPE.EQUALS) {
            return `${nameToken} = ${valueToken}`;
          } else {
            throw new Error(
              `invalid condition type: ${condition.conditionType}`,
            );
          }
        })
        .join(' AND ');
    }

    const dynamoParams = {
      TableName: params.tableName,
      Key: key,
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ...(ConditionExpression ? { ConditionExpression } : {}),
      ReturnValues: ReturnValue.NONE,
    };

    await docClient.update(dynamoParams);
  }

  /**
   * @param {import('../base.js').GetParams} params -
   * @returns {import('../base.js').GetReturn} -
   */
  async function get(params) {
    const dynamoParams = {
      TableName: params.tableName,
      ConsistentRead: params.consistentRead || true,
      Key: {
        [params.keyName]: params.keyValue,
        ...(params.sortKeyName
          ? { [params.sortKeyName]: params.sortKeyValue }
          : {}),
      },
    };
    const { Item } = await docClient.get(dynamoParams);
    return Item;
  }

  /**
   * @param {import('../base.js').RemoveParams} params -
   * @returns {import('../base.js').RemoveReturn} -
   */
  async function remove(params) {
    const dynamoParams = {
      TableName: params.tableName,
      Key: {
        [params.keyName]: params.keyValue,
        ...(params.sortKeyName
          ? { [params.sortKeyName]: params.sortKeyValue }
          : {}),
      },
      ReturnValues: ReturnValue.NONE,
    };
    await docClient.delete(dynamoParams);
  }

  /**
   * @typedef {import('@aws-sdk/client-dynamodb').WriteRequest} WriteRequest
   */

  const MAX_BATCH_WRITE_BYTES = 16 * 1024 * 1024; // DynamoDB API limit
  const SAFE_BATCH_WRITE_BYTES = MAX_BATCH_WRITE_BYTES - 256 * 1024; // headroom
  const MAX_BATCH_WRITE_RETRY_TIMEOUT_SECONDS = 20;
  const MAX_BATCH_WRITE_RETRY_ATTEMPTS = 100;

  /**
   * @param {any} obj -
   * @returns {Number} -
   */
  function approxBytes(obj) {
    // Approximate request size; DynamoDB counts the *marshalled* JSON, but this is a solid guardrail.
    return Buffer.byteLength(JSON.stringify(obj));
  }

  /**
   * @param {any[]} queue -
   * @returns {any[]} -
   */
  function takeBatch(queue) {
    /** @type {WriteRequest[]} */
    const batch = [];
    let bytes = 0;

    while (queue.length > 0 && batch.length < 25) {
      const next = queue[0];
      const nextBytes = approxBytes(next);

      if (nextBytes > MAX_BATCH_WRITE_BYTES) {
        throw new Error(
          `Single write request is too large for BatchWriteItem (>16MB). ` +
            `Split the item or reduce attribute sizes.`,
        );
      }

      // keep at least 1 op per batch even if it "fills" the payload
      if (batch.length > 0 && bytes + nextBytes > SAFE_BATCH_WRITE_BYTES) break;

      batch.push(queue.shift());
      bytes += nextBytes;
    }

    return batch;
  }

  /**
   * @param {number} attempt -
   */
  async function sleepBackoff(attempt) {
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.floor(
          Math.random() *
            Math.min(
              MAX_BATCH_WRITE_RETRY_TIMEOUT_SECONDS,
              1 * Math.pow(2, attempt),
            ),
        ) * 1000,
      ),
    );
  }

  /**
   * @param {import('../base.js').BatchWriteParams} params -
   * @returns {import('../base.js').BatchWriteReturn} -
   */
  async function batchWrite(params) {
    const puts = params.putRequests.filter(
      (v) => v !== undefined && v !== null,
    );
    const deleteRequests = params.deleteRequests.map((del) => {
      /** @type {Record<string, any>} */
      const Key = { [del.keyName]: del.keyValue };
      if (del.sortKeyName) {
        Key[del.sortKeyName] = del.sortKeyValue;
      }
      return { DeleteRequest: { Key } };
    });

    /** @type {WriteRequest[]} */
    const queue = [
      ...deleteRequests,
      ...puts.map((put) => ({
        PutRequest: {
          Item: put, // now guaranteed non-undefined
        },
      })),
    ];

    while (queue.length > 0) {
      const batch = takeBatch(queue);

      let attempt = 0;
      /** @type {WriteRequest[]} */
      let unprocessed = batch;

      while (unprocessed.length > 0) {
        const dynamoParams = {
          RequestItems: {
            [params.tableName]: unprocessed,
          },
        };

        try {
          const { UnprocessedItems } = await docClient.batchWrite(dynamoParams);

          unprocessed = UnprocessedItems?.[params.tableName] ?? [];

          // DynamoDB uses UnprocessedItems for throttling, so back off before retrying them
          if (unprocessed.length > 0) {
            attempt++;
            if (attempt >= MAX_BATCH_WRITE_RETRY_ATTEMPTS) {
              throw new Error(
                'Max batchWrite retry attempts exceeded (UnprocessedItems never drained)',
              );
            }
            await sleepBackoff(attempt);
          }
        } catch (e) {
          if (
            e instanceof ProvisionedThroughputExceededException ||
            e instanceof ResourceNotFoundException
          ) {
            attempt++;
            if (attempt >= MAX_BATCH_WRITE_RETRY_ATTEMPTS) {
              throw new Error('Max batchWrite retry attempts exceeded');
            }
            await sleepBackoff(attempt);
            continue;
          }
          throw e;
        }
      }
    }
  }

  return {
    query,
    put,
    update,
    get,
    remove,
    batchWrite,
    close: async () => {},
  };
}
