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
import { assertTightQuery } from '../utils.js';

/**
 * Factory options for creating a DynamoDB wrapper client.
 * @typedef CreateDynamoDBOptions
 * @property {string} [region] AWS region to use. Defaults to `process.env.AWS_REGION`.
 */

/**
 * Factory function that creates a DynamoDB wrapper client.
 *
 * Notes:
 * - Uses AWS SDK v3 + DynamoDBDocument for marshalling/unmarshalling.
 * - `marshallOptions.removeUndefinedValues` is enabled, so undefined properties are removed.
 * - SDK retry behavior is also enabled via `maxAttempts`, but this wrapper adds targeted retries
 *   for bursty throughput / eventual-consistency table creation races on a couple operations.
 * @param {CreateDynamoDBOptions} [options] -
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
   * @param {number} attempt 0-based attempt number
   * @param {number} maxSeconds max sleep per attempt
   * @returns {Promise<void>}
   */
  async function sleepBackoff(attempt, maxSeconds) {
    const seconds = Math.floor(
      Math.random() * Math.min(maxSeconds, 1 * Math.pow(2, attempt)),
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Build a DynamoDB Key object.
   *
   * Guarantees:
   * - Always includes the partition key
   * - Includes the sort key only when BOTH name and value are present
   * @param {{
   *   keyName: string,
   *   keyValue: any,
   *   sortKeyName?: string,
   *   sortKeyValue?: any,
   * }} params -
   * @returns {Record<string, any>} -
   */
  function buildKey(params) {
    /** @type {Record<string, any>} */
    const Key = { [params.keyName]: params.keyValue };

    const hasSortName = params.sortKeyName !== undefined;
    const hasSortValue = params.sortKeyValue !== undefined;
    if (hasSortName !== hasSortValue) {
      throw new Error('sortKeyName and sortKeyValue must be provided together');
    }
    if (params.sortKeyName !== undefined) {
      Key[params.sortKeyName] = params.sortKeyValue;
    }

    return Key;
  }

  /**
   * Build Query expressions:
   * - KeyConditionExpression from PRIMARY (+ optional SORT)
   * - FilterExpression from all non-key filters (conditions with no keyType)
   * @param {import('../base.js').KeyCondition[]} keyConditions -
   * @returns {{
   *   KeyConditionExpression: string,
   *   FilterExpression?: string,
   *   ExpressionAttributeNames: Record<string, string>,
   *   ExpressionAttributeValues: Record<string, any>,
   * }} -
   */
  function buildKeyConditionExpression(keyConditions) {
    const { pk, sk, filters } = assertTightQuery({ keyConditions });

    /** @type {import('../base.js').KeyCondition[]} */
    const keyParts = [];
    if (pk) {
      keyParts.push(pk);
    }
    if (sk) {
      keyParts.push(sk);
    }

    /** @type {Record<string, string>} */
    const ExpressionAttributeNames = {};
    /** @type {Record<string, any>} */
    const ExpressionAttributeValues = {};

    let i = 0;
    const compileOne = (
      /** @type {import('../base.js').KeyCondition} */ condition,
    ) => {
      const nameToken = `#k${i}`;
      const valueToken = `:k${i}`;
      i++;

      ExpressionAttributeNames[nameToken] = condition.propertyName;
      ExpressionAttributeValues[valueToken] = condition.propertyValue;

      if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
        return `begins_with(${nameToken}, ${valueToken})`;
      }
      if (condition.conditionType === CONDITION_TYPE.EQUALS) {
        return `${nameToken} = ${valueToken}`;
      }
      throw new Error(`invalid condition type: ${condition.conditionType}`);
    };

    const KeyConditionExpression = keyParts.map(compileOne).join(' AND ');

    let FilterExpression;
    if (filters.length > 0) {
      FilterExpression = filters.map(compileOne).join(' AND ');
    }

    return {
      KeyConditionExpression,
      ...(FilterExpression ? { FilterExpression } : {}),
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    };
  }

  /**
   * Query items by typed key conditions (PRIMARY required), with optional non-key filters.
   *
   * Contract:
   * - Exactly one PRIMARY EQUALS condition is required
   * - Optional SORT condition (EQUALS or BEGINS_WITH)
   * - Any additional conditions without keyType become FilterExpression
   * @param {import('../base.js').QueryParams} params -
   * @returns {import('../base.js').QueryReturn} -
   */
  async function query(params) {
    assertTightQuery(params);
    const built = buildKeyConditionExpression(params.keyConditions);

    const dynamoParams = {
      TableName: params.tableName,
      ConsistentRead: params.consistentRead ?? true,
      ...built,
    };

    /** @type {import('../base.js').DBRecord[]} */
    const results = [];

    let response = await docClient.query(dynamoParams);
    if (response.Items?.length) results.push(...response.Items);

    while (response.LastEvaluatedKey !== undefined) {
      response = await docClient.query({
        ...dynamoParams,
        ExclusiveStartKey: response.LastEvaluatedKey,
      });
      if (response.Items?.length) results.push(...response.Items);
    }

    return results;
  }

  const MAX_PUT_RETRY_TIMEOUT_SECONDS = 20;
  const MAX_PUT_RETRY_ATTEMPTS = 100;

  /**
   * Put (insert/overwrite) a record.
   *
   * Requirements:
   * - record must contain record[keyName]
   * - if sortKeyName is provided, record must contain record[sortKeyName]
   *
   * Retries:
   * - ProvisionedThroughputExceededException (bursty workloads)
   * - ResourceNotFoundException (table create eventual-consistency races)
   * @param {import('../base.js').PutParams} params -
   * @returns {import('../base.js').PutReturn} -
   */
  async function put(params) {
    if (!params.record || typeof params.record !== 'object')
      throw new Error('record is required');
    if (
      params.record[params.keyName] === undefined ||
      params.record[params.keyName] === null
    ) {
      throw new Error(`record.${params.keyName} is required`);
    }
    if (
      params.sortKeyName &&
      (params.record[params.sortKeyName] === undefined ||
        params.record[params.sortKeyName] === null)
    ) {
      throw new Error(`record.${params.sortKeyName} is required`);
    }

    const dynamoParams = {
      TableName: params.tableName,
      Item: params.record,
    };

    for (let attempt = 0; attempt < MAX_PUT_RETRY_ATTEMPTS; attempt++) {
      try {
        await docClient.put(dynamoParams);
        return;
      } catch (e) {
        if (
          e instanceof ProvisionedThroughputExceededException ||
          e instanceof ResourceNotFoundException
        ) {
          await sleepBackoff(attempt, MAX_PUT_RETRY_TIMEOUT_SECONDS);
          continue;
        }
        throw e;
      }
    }

    throw new Error('Max put retry attempts exceeded');
  }

  /**
   * Update attributes on an item.
   *
   * Behavior:
   * - Uses `params.updates` if provided.
   * - Otherwise derives updates from `params.record` (excluding key fields and undefined values).
   *
   * Conditions:
   * - `params.conditions` is interpreted as a **ConditionExpression** (not KeyConditionExpression).
   * - Supports `EQUALS` and `BEGINS_WITH` in ConditionExpression.
   * @param {import('../base.js').UpdateParams} params -
   * @returns {import('../base.js').UpdateReturn} -
   */
  async function update(params) {
    const Key = buildKey(params);

    /** @type {import('../base.js').UpdateDefinition[]} */
    const updates =
      params.updates && params.updates.length > 0
        ? params.updates
        : Object.entries(params.record || {})
            .filter(([, v]) => v !== undefined)
            .filter(([k]) => k !== params.keyName && k !== params.sortKeyName)
            .map(([k, v]) => ({ property: [k], propertyValue: v }));

    if (!updates.length) return;

    /** @type {Record<string, string>} */
    const ExpressionAttributeNames = {};
    /** @type {Record<string, any>} */
    const ExpressionAttributeValues = {};

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

    let ConditionExpression;
    if (params.conditions?.length) {
      ConditionExpression = params.conditions
        .map((condition, i) => {
          const nameToken = nameTokenFor(condition.propertyName);
          const valueToken = `:c${i}`;
          ExpressionAttributeValues[valueToken] = condition.propertyValue;

          if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
            return `begins_with(${nameToken}, ${valueToken})`;
          }
          if (condition.conditionType === CONDITION_TYPE.EQUALS) {
            return `${nameToken} = ${valueToken}`;
          }
          throw new Error(`invalid condition type: ${condition.conditionType}`);
        })
        .join(' AND ');
    }

    const dynamoParams = {
      TableName: params.tableName,
      Key,
      UpdateExpression: `SET ${setClauses.join(', ')}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ...(ConditionExpression ? { ConditionExpression } : {}),
      ReturnValues: ReturnValue.NONE,
    };

    await docClient.update(dynamoParams);
  }

  /**
   * Get an item by key.
   * @param {import('../base.js').GetParams} params -
   * @returns {import('../base.js').GetReturn} -
   */
  async function get(params) {
    const dynamoParams = {
      TableName: params.tableName,
      ConsistentRead: params.consistentRead ?? true, // preserve explicit false
      Key: buildKey(params),
    };
    const { Item } = await docClient.get(dynamoParams);
    return Item;
  }

  /**
   * Delete an item by key.
   * @param {import('../base.js').RemoveParams} params -
   * @returns {import('../base.js').RemoveReturn} -
   */
  async function remove(params) {
    const dynamoParams = {
      TableName: params.tableName,
      Key: buildKey(params),
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
   * Approximate request size; DynamoDB counts the marshalled payload, but JSON bytes is a solid guardrail.
   * @param {any} obj -
   * @returns {number} -
   */
  function approxBytes(obj) {
    return Buffer.byteLength(JSON.stringify(obj));
  }

  /**
   * Pull up to 25 ops without exceeding a safe payload size.
   * @param {WriteRequest[]} queue -
   * @returns {WriteRequest[]} -
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
          'Single write request is too large for BatchWriteItem (>16MB). Split the item or reduce attribute sizes.',
        );
      }

      if (batch.length > 0 && bytes + nextBytes > SAFE_BATCH_WRITE_BYTES) break;

      // @ts-ignore
      batch.push(queue.shift());
      bytes += nextBytes;
    }

    return batch;
  }

  /**
   * Batch write (PutRequest + DeleteRequest).
   *
   * Notes:
   * - DynamoDB can return UnprocessedItems under throttling; this drains them with backoff.
   * - Also retries a couple transient errors similarly to `put()`.
   *
   * PutRequests:
   * - each entry is { record, keyName, sortKeyName? }
   * - record must contain record[keyName] (+ record[sortKeyName] if provided)
   * @param {import('../base.js').BatchWriteParams} params -
   * @returns {import('../base.js').BatchWriteReturn} -
   */
  async function batchWrite(params) {
    const puts = params.putRequests.filter(
      (v) => v !== undefined && v !== null,
    );

    const deleteRequests = params.deleteRequests.map((del) => ({
      DeleteRequest: { Key: buildKey(del) },
    }));

    /** @type {WriteRequest[]} */
    const queue = [
      ...deleteRequests,
      ...puts.map((putReq) => {
        const record = putReq.record;
        if (!record || typeof record !== 'object')
          throw new Error('putRequests[].record is required');
        if (!putReq.keyName)
          throw new Error('putRequests[].keyName is required');
        if (
          record[putReq.keyName] === undefined ||
          record[putReq.keyName] === null
        ) {
          throw new Error(`putRequests[].record.${putReq.keyName} is required`);
        }
        if (
          putReq.sortKeyName &&
          (record[putReq.sortKeyName] === undefined ||
            record[putReq.sortKeyName] === null)
        ) {
          throw new Error(
            `putRequests[].record.${putReq.sortKeyName} is required`,
          );
        }
        return { PutRequest: { Item: record } };
      }),
    ];

    while (queue.length > 0) {
      const batch = takeBatch(queue);

      let attempt = 0;
      /** @type {WriteRequest[]} */
      let unprocessed = batch;

      while (unprocessed.length > 0) {
        const dynamoParams = {
          RequestItems: { [params.tableName]: unprocessed },
        };

        try {
          const { UnprocessedItems } = await docClient.batchWrite(dynamoParams);
          unprocessed = UnprocessedItems?.[params.tableName] ?? [];

          if (unprocessed.length > 0) {
            attempt++;
            if (attempt >= MAX_BATCH_WRITE_RETRY_ATTEMPTS) {
              throw new Error(
                'Max batchWrite retry attempts exceeded (UnprocessedItems never drained)',
              );
            }
            await sleepBackoff(attempt, MAX_BATCH_WRITE_RETRY_TIMEOUT_SECONDS);
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
            await sleepBackoff(attempt, MAX_BATCH_WRITE_RETRY_TIMEOUT_SECONDS);
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
    /**
     * Close underlying resources (best-effort).
     * DynamoDB v3 clients keep sockets; destroy() closes them.
     * @returns {import('../base.js').CloseReturn} -
     */
    close: async () => {
      if (typeof docClient.destroy === 'function') docClient.destroy();
    },
  };
}
