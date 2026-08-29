import BaseAWS from '../../aws/base.js';
import {
  CONDITION_TYPE,
  DB_ADAPTER_NAMES,
  brandDBClient,
  transactionRequestKey,
  transactionRequestUpdates,
  validateTransactionWrite,
} from '../base.js';
import {
  assertPortablePageAscii,
  assertTightQuery,
  assertTightQueryPage,
  comparePortablePageKeys,
} from '../utils.js';

const MAX_TRANSACTION_CONFLICT_ATTEMPTS = 5;
const DYNAMODB_CLIENT_CAPABILITIES = new WeakMap();
const DYNAMODB_TABLE_ARN_PATTERN =
  /^arn:(aws(?:-[a-z0-9]+)*):dynamodb:([^:]+):([0-9]{12}):table\/([A-Za-z0-9_.-]{3,255})$/u;
const DYNAMODB_TABLE_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/u;

/**
 * Snapshot one exact enumerable own-data object without invoking accessors.
 * @param {unknown} input - Candidate input.
 * @param {Readonly<string[]>} keys - Complete accepted key surface.
 * @param {string} message - Fixed validation failure.
 * @returns {Readonly<Record<string, any>>} - Descriptor-snapshotted input.
 */
function snapshotExactDataInput(input, keys, message) {
  try {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
      throw new TypeError(message);
    }
    const ownKeys = Reflect.ownKeys(input);
    if (
      ownKeys.length !== keys.length ||
      ownKeys.some(
        (key) => typeof key !== 'string' || !keys.includes(String(key)),
      )
    ) {
      throw new TypeError(message);
    }
    /** @type {Record<string, any>} */
    const snapshot = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (
        descriptor === undefined ||
        descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, 'value')
      ) {
        throw new TypeError(message);
      }
      snapshot[key] = descriptor.value;
    }
    return Object.freeze(snapshot);
  } catch {
    throw new TypeError(message);
  }
}

/**
 * Require one exact DescribeTable request.
 * @param {unknown} input - Candidate request.
 * @returns {Readonly<{TableName: string}>} - Exact logical table request.
 */
function exactTableInput(input) {
  const message = 'DescribeTable requires one exact TableName.';
  const snapshot = snapshotExactDataInput(input, ['TableName'], message);
  if (
    typeof snapshot.TableName !== 'string' ||
    snapshot.TableName.length === 0
  ) {
    throw new TypeError(message);
  }
  return /** @type {Readonly<{TableName: string}>} */ (snapshot);
}

/**
 * Describe one table through the exact raw service client owned by a live
 * DynamoDB DB wrapper. The WeakMap capability cannot be recovered from the
 * public adapter brand or copied onto another object.
 * @param {import('../base.js').DBClient} db - Exact open DynamoDB wrapper.
 * @param {Readonly<{TableName: string}>} input - Exact DescribeTable request.
 * @returns {Promise<unknown>} - Raw provider response for topology validation.
 */
export async function describeDynamoDBTableForClient(db, input) {
  const capability =
    db && typeof db === 'object'
      ? DYNAMODB_CLIENT_CAPABILITIES.get(db)
      : undefined;
  if (!capability) {
    throw new TypeError(
      'DescribeTable requires the exact open DynamoDB DB client.',
    );
  }
  const request = exactTableInput(input);
  if (
    capability.failedTableNames.has(request.TableName) ||
    (!capability.pinnedTables.has(request.TableName) &&
      capability.usedTableNames.has(request.TableName))
  ) {
    capability.failedTableNames.add(request.TableName);
    throw new TypeError(
      'DynamoDB table topology cannot be certified after unpinned use or failed validation.',
    );
  }
  if (capability.validatingTableNames.has(request.TableName)) {
    throw new TypeError(
      'DynamoDB table topology validation is already in progress.',
    );
  }
  capability.validatingTableNames.add(request.TableName);
  let description;
  try {
    description = await capability.serviceClient.describeTable({
      TableName:
        capability.pinnedTables.get(request.TableName)?.tableArn ??
        request.TableName,
    });
  } catch (error) {
    // An unpinned validation failure leaves this logical table blocked. A
    // previously pinned resource remains safe and may be revalidated later.
    if (capability.pinnedTables.has(request.TableName)) {
      capability.validatingTableNames.delete(request.TableName);
    } else {
      capability.validatingTableNames.delete(request.TableName);
      capability.failedTableNames.add(request.TableName);
    }
    throw error;
  }
  const tableArn = description?.Table?.TableArn;
  const tableId = description?.Table?.TableId;
  capability.lastDescriptions.set(
    request.TableName,
    Object.freeze({
      description,
      tableArn: typeof tableArn === 'string' ? tableArn : undefined,
      tableId: typeof tableId === 'string' ? tableId : undefined,
    }),
  );
  return description;
}

/**
 * Pin the exact raw DescribeTable result only after provider-free topology
 * validation succeeds. First pin wins; later validation may confirm the same
 * ARN but can never redirect this wrapper to another account or resource.
 * @param {import('../base.js').DBClient} db - Exact open DynamoDB wrapper.
 * @param {Readonly<{TableName: string}>} input - Exact described logical table.
 * @param {unknown} description - Exact response object returned above.
 * @returns {void}
 */
export function pinDescribedDynamoDBTableForClient(db, input, description) {
  const capability =
    db && typeof db === 'object'
      ? DYNAMODB_CLIENT_CAPABILITIES.get(db)
      : undefined;
  if (!capability) {
    throw new TypeError(
      'Table pinning requires the exact open DynamoDB DB client.',
    );
  }
  const request = exactTableInput(input);
  const retained = capability.lastDescriptions.get(request.TableName);
  const pinned = capability.pinnedTables.get(request.TableName);
  const tableArn = retained?.tableArn;
  const tableId = retained?.tableId;
  const describedTable =
    description !== null &&
    typeof description === 'object' &&
    !Array.isArray(description)
      ? /** @type {Record<string, any>} */ (description).Table
      : undefined;
  const match =
    typeof tableArn === 'string'
      ? DYNAMODB_TABLE_ARN_PATTERN.exec(tableArn)
      : null;
  if (
    !retained ||
    !capability.validatingTableNames.has(request.TableName) ||
    retained.description !== description ||
    describedTable?.TableArn !== tableArn ||
    describedTable?.TableId !== tableId ||
    describedTable?.TableName !== request.TableName ||
    !match ||
    match[4] !== request.TableName ||
    typeof tableId !== 'string' ||
    !DYNAMODB_TABLE_ID_PATTERN.test(tableId)
  ) {
    capability.validatingTableNames.delete(request.TableName);
    capability.failedTableNames.add(request.TableName);
    throw new TypeError(
      'Table pinning requires the exact retained DynamoDB table description.',
    );
  }
  if (
    pinned !== undefined &&
    (pinned.tableArn !== tableArn || pinned.tableId !== tableId)
  ) {
    capability.validatingTableNames.delete(request.TableName);
    capability.failedTableNames.add(request.TableName);
    throw new TypeError(
      'The DynamoDB DB client is already pinned to a different table resource.',
    );
  }
  capability.pinnedTables.set(
    request.TableName,
    Object.freeze({ tableArn, tableId }),
  );
  capability.validatingTableNames.delete(request.TableName);
}

/**
 * Assert one exact wrapper is pinned to an expected private table ARN without
 * returning or embedding that ARN in an error. The live proof uses this to
 * join both data clients to its exact proof-owned resource before mutation.
 * @param {import('../base.js').DBClient} db - Exact open DynamoDB wrapper.
 * @param {Readonly<{TableName: string, TableArn: string, TableId: string}>} input - Expected private resource identity.
 * @returns {void}
 */
export function assertDynamoDBTablePinnedForClient(db, input) {
  const capability =
    db && typeof db === 'object'
      ? DYNAMODB_CLIENT_CAPABILITIES.get(db)
      : undefined;
  let expected;
  try {
    expected = snapshotExactDataInput(
      input,
      ['TableName', 'TableArn', 'TableId'],
      'The DynamoDB DB client is not pinned to the expected table resource.',
    );
  } catch {
    expected = undefined;
  }
  if (
    !capability ||
    !expected ||
    typeof expected.TableName !== 'string' ||
    typeof expected.TableArn !== 'string' ||
    typeof expected.TableId !== 'string' ||
    capability.failedTableNames.has(expected.TableName) ||
    !DYNAMODB_TABLE_ARN_PATTERN.test(expected.TableArn) ||
    !DYNAMODB_TABLE_ID_PATTERN.test(expected.TableId) ||
    capability.pinnedTables.get(expected.TableName)?.tableArn !==
      expected.TableArn ||
    capability.pinnedTables.get(expected.TableName)?.tableId !==
      expected.TableId
  ) {
    throw new TypeError(
      'The DynamoDB DB client is not pinned to the expected table resource.',
    );
  }
}

/**
 * Factory options for creating a DynamoDB wrapper client.
 * @typedef CreateDynamoDBOptions
 * @property {string} [region] AWS region to use. Defaults to `process.env.AWS_REGION`.
 * @property {boolean} [readOnly] Reject every mutation before contacting DynamoDB.
 * @property {import('@aws-sdk/client-dynamodb').DynamoDBClientConfig['credentials']} [credentials] Explicit credentials or credential provider. Defaults to the ordinary Node provider chain.
 */

/**
 * Factory function that creates a DynamoDB wrapper client.
 *
 * Notes:
 * - Uses AWS SDK v3 + DynamoDBDocument for marshalling/unmarshalling.
 * - `marshallOptions.removeUndefinedValues` is enabled, so undefined properties are removed.
 * - SDK retry behavior is also enabled via `maxAttempts`, but this wrapper adds targeted retries
 *   for bursty throughput / eventual-consistency table creation races on a couple operations.
 * @param {CreateDynamoDBOptions} options - options.
 * @param {import('../../../runtime/aws-provider-module.js').AwsSdkBindings} bindings - Fixed provider bindings.
 * @returns {import('../base.js').DBClient} - Result.
 */
export default function createDynamoDB(
  { region = process.env.AWS_REGION, readOnly = false, credentials } = {},
  bindings,
) {
  const { DynamoDBDocument } = bindings.libDynamoDB;
  const {
    DynamoDB,
    ProvisionedThroughputExceededException,
    ResourceNotFoundException,
    ReturnValue,
  } = bindings.clientDynamoDB;
  const { fromNodeProviderChain } = bindings.credentialProviders;
  const resolvedCredentials = credentials ?? fromNodeProviderChain();
  const pinnedTables = new Map();
  const lastDescriptions = new Map();
  const validatingTableNames = new Set();
  const usedTableNames = new Set();
  const failedTableNames = new Set();
  const serviceClient = new DynamoDB({
    ...BaseAWS.config(
      {
        maxAttempts: Number(process.env?.DYNAMO_MAX_RETRIES || 30),
      },
      bindings,
    ),
    region,
    credentials: resolvedCredentials,
  });
  const docClient = DynamoDBDocument.from(serviceClient, {
    marshallOptions: { removeUndefinedValues: true },
  });

  /**
   * Resolve one logical table exactly once at operation entry. An unfinished
   * topology validation blocks traffic; once pinned, every operation uses the
   * full ARN unless a later revalidation is pending or fails closed.
   * @param {string} tableName - Logical table name.
   * @returns {string} - Logical name or exact pinned ARN.
   */
  function resolveTableName(tableName) {
    if (failedTableNames.has(tableName)) {
      throw new Error('DynamoDB table topology validation failed.');
    }
    if (validatingTableNames.has(tableName)) {
      throw new Error('DynamoDB table topology validation has not completed.');
    }
    const pinned = pinnedTables.get(tableName);
    if (pinned !== undefined) return pinned.tableArn;
    usedTableNames.add(tableName);
    return tableName;
  }

  /** @returns {void} - Throws when this client cannot mutate state. */
  function assertWritable() {
    if (readOnly) {
      throw new Error('DynamoDB client is read-only.');
    }
  }

  /**
   * @param {number} attempt 0-based attempt number
   * @param {number} maxSeconds max sleep per attempt
   * @returns {Promise<void>} - Result.
   */
  async function sleepBackoff(attempt, maxSeconds) {
    const seconds = Math.floor(
      Math.random() * Math.min(maxSeconds, 1 * Math.pow(2, attempt)),
    );
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  }

  /**
   * Apply bounded millisecond jitter before retrying an in-flight transaction.
   * @param {number} attempt 0-based attempt number
   * @returns {Promise<void>} - Result.
   */
  async function sleepTransactionConflictBackoff(attempt) {
    const maxMilliseconds = Math.min(250, 25 * Math.pow(2, attempt));
    const milliseconds = 1 + Math.floor(Math.random() * maxMilliseconds);
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
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
   * }} params - params.
   * @returns {Record<string, any>} - Result.
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
   * Compile portable top-level write conditions for a DynamoDB expression.
   * @param {import('../base.js').KeyCondition[]} [conditions] - conditions.
   * @param {string} [tokenPrefix] - Token namespace.
   * @returns {{ ConditionExpression?: string, ExpressionAttributeNames?: Record<string, string>, ExpressionAttributeValues?: Record<string, any> }} - Expression fields.
   */
  function compileWriteConditions(conditions = [], tokenPrefix = 'c') {
    if (conditions.length === 0) return {};

    /** @type {Record<string, string>} */
    const ExpressionAttributeNames = {};
    /** @type {Record<string, any>} */
    const ExpressionAttributeValues = {};
    const clauses = conditions.map((condition, index) => {
      const nameToken = `#${tokenPrefix}n${index}`;
      const valueToken = `:${tokenPrefix}v${index}`;
      ExpressionAttributeNames[nameToken] = condition.propertyName;

      if (condition.conditionType === CONDITION_TYPE.EXISTS) {
        return `attribute_exists(${nameToken})`;
      }
      if (condition.conditionType === CONDITION_TYPE.NOT_EXISTS) {
        return `attribute_not_exists(${nameToken})`;
      }

      ExpressionAttributeValues[valueToken] = condition.propertyValue;
      if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
        return `begins_with(${nameToken}, ${valueToken})`;
      }
      if (condition.conditionType === CONDITION_TYPE.EQUALS) {
        return `${nameToken} = ${valueToken}`;
      }
      throw new Error(`invalid condition type: ${condition.conditionType}`);
    });

    return {
      ConditionExpression: clauses.join(' AND '),
      ExpressionAttributeNames,
      ...(Object.keys(ExpressionAttributeValues).length > 0
        ? { ExpressionAttributeValues }
        : {}),
    };
  }

  /**
   * Build Query expressions:
   * - KeyConditionExpression from PRIMARY (+ optional SORT)
   * - FilterExpression from all non-key filters (conditions with no keyType)
   * @param {import('../base.js').KeyCondition[]} keyConditions - keyConditions.
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
   * @param {import('../base.js').QueryParams} params - params.
   * @returns {import('../base.js').QueryReturn} - Result.
   */
  async function query(params) {
    assertTightQuery(params);
    const built = buildKeyConditionExpression(params.keyConditions);

    const dynamoParams = {
      TableName: resolveTableName(params.tableName),
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

  /**
   * Validate one DynamoDB page before exposing its records to the portable
   * cursor layer. DynamoDB orders String keys by UTF-8 bytes; queryPage
   * deliberately narrows keys to printable ASCII so every adapter can make
   * that exact ordering promise.
   * @param {unknown} rawItems - Provider response items.
   * @param {string} sortKeyName - Requested sort-key field.
   * @param {string} sortPrefix - Requested sort-key prefix.
   * @returns {string[]} - Exact ordered sort keys for the returned items.
   */
  function validateDynamoPageItems(rawItems, sortKeyName, sortPrefix) {
    if (!Array.isArray(rawItems)) {
      throw new Error('DynamoDB queryPage returned non-array items');
    }
    /** @type {string[]} */
    const sortKeys = [];
    for (const item of rawItems) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw new Error('DynamoDB queryPage returned an invalid item');
      }
      const sortKey = assertPortablePageAscii(
        item[sortKeyName],
        'DynamoDB queryPage item sort key',
      );
      if (!sortKey.startsWith(sortPrefix)) {
        throw new Error(
          'DynamoDB queryPage returned an item outside its requested sort prefix',
        );
      }
      if (
        sortKeys.length > 0 &&
        comparePortablePageKeys(sortKeys[sortKeys.length - 1], sortKey) >= 0
      ) {
        throw new Error('DynamoDB queryPage returned unordered sort keys');
      }
      sortKeys.push(sortKey);
    }
    return sortKeys;
  }

  /**
   * Validate that a DynamoDB continuation is usable for this exact portable
   * request. A LastEvaluatedKey is provider state, not a public cursor, and
   * must never be silently treated as an end-of-history signal when malformed.
   * @param {unknown} rawKey - Candidate LastEvaluatedKey.
   * @param {import('../base.js').KeyCondition} pk - Primary-key condition.
   * @param {import('../base.js').KeyCondition} sk - Sort-key condition.
   * @param {string} sortPrefix - Requested sort-key prefix.
   * @param {string[]} itemSortKeys - Sort keys from the response page.
   * @returns {Record<string, any> | undefined} - Validated provider continuation.
   */
  function validateDynamoContinuation(
    rawKey,
    pk,
    sk,
    sortPrefix,
    itemSortKeys,
  ) {
    if (
      rawKey === undefined ||
      rawKey === null ||
      (typeof rawKey === 'object' &&
        !Array.isArray(rawKey) &&
        Object.keys(rawKey).length === 0)
    ) {
      return undefined;
    }
    if (!rawKey || typeof rawKey !== 'object' || Array.isArray(rawKey)) {
      throw new Error('DynamoDB queryPage returned an invalid continuation');
    }
    const continuation = /** @type {Record<string, any>} */ (rawKey);
    if (continuation[pk.propertyName] !== pk.propertyValue) {
      throw new Error(
        'DynamoDB queryPage continuation does not match its primary key',
      );
    }
    const sortKey = assertPortablePageAscii(
      continuation[sk.propertyName],
      'DynamoDB queryPage continuation sort key',
    );
    if (!sortKey.startsWith(sortPrefix) || itemSortKeys.length === 0) {
      throw new Error('DynamoDB queryPage returned an invalid continuation');
    }
    if (
      comparePortablePageKeys(
        itemSortKeys[itemSortKeys.length - 1],
        sortKey,
      ) !== 0
    ) {
      throw new Error(
        'DynamoDB queryPage continuation does not match its last returned item',
      );
    }
    return continuation;
  }

  /**
   * Read exactly one provider page under a sort-key prefix. The public cursor
   * remains the preceding sort-key value rather than DynamoDB's schema-shaped
   * LastEvaluatedKey, keeping the DB adapter contract portable.
   * @param {import('../base.js').QueryPageParams} params - Page request.
   * @returns {import('../base.js').QueryPageReturn} - Bounded page.
   */
  async function queryPage(params) {
    const { pk, sk, limit, startAfter } = assertTightQueryPage(params);
    const built = buildKeyConditionExpression([pk, sk]);
    const queryBase = {
      TableName: resolveTableName(params.tableName),
      ConsistentRead: params.consistentRead ?? true,
      ScanIndexForward: true,
      ...built,
    };
    const response = await docClient.query({
      ...queryBase,
      // Request one extra item so the normal case can prove that a public
      // cursor has another record without exposing a provider continuation.
      Limit: limit + 1,
      ...(startAfter === undefined
        ? {}
        : {
            ExclusiveStartKey: {
              [pk.propertyName]: pk.propertyValue,
              [sk.propertyName]: startAfter,
            },
          }),
    });
    const sortPrefix = /** @type {string} */ (sk.propertyValue);
    const responseItems = response.Items || [];
    const responseSortKeys = validateDynamoPageItems(
      responseItems,
      sk.propertyName,
      sortPrefix,
    );
    const continuation = validateDynamoContinuation(
      response.LastEvaluatedKey,
      pk,
      sk,
      sortPrefix,
      responseSortKeys,
    );

    let hasNext = responseItems.length > limit;
    if (!hasNext && continuation) {
      // DynamoDB documents that a nonempty LastEvaluatedKey is not itself a
      // proof that another matching item exists. Confirm the rare byte-limit
      // edge with one bounded provider probe before emitting a public cursor.
      const probe = await docClient.query({
        ...queryBase,
        Limit: 1,
        ExclusiveStartKey: continuation,
      });
      const probeItems = probe.Items || [];
      const probeSortKeys = validateDynamoPageItems(
        probeItems,
        sk.propertyName,
        sortPrefix,
      );
      validateDynamoContinuation(
        probe.LastEvaluatedKey,
        pk,
        sk,
        sortPrefix,
        probeSortKeys,
      );
      hasNext = probeItems.length > 0;
    }
    const items = responseItems.slice(0, limit);
    const nextStartAfter = hasNext
      ? responseSortKeys[items.length - 1]
      : undefined;
    return {
      items,
      ...(nextStartAfter === undefined ? {} : { nextStartAfter }),
    };
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
   * @param {import('../base.js').PutParams} params - params.
   * @returns {import('../base.js').PutReturn} - Result.
   */
  async function put(params) {
    assertWritable();
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
      TableName: resolveTableName(params.tableName),
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
   * @param {import('../base.js').UpdateParams} params - params.
   * @returns {import('../base.js').UpdateReturn} - Result.
   */
  async function update(params) {
    assertWritable();
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

          if (condition.conditionType === CONDITION_TYPE.EXISTS) {
            return `attribute_exists(${nameToken})`;
          }
          if (condition.conditionType === CONDITION_TYPE.NOT_EXISTS) {
            return `attribute_not_exists(${nameToken})`;
          }

          if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
            ExpressionAttributeValues[valueToken] = condition.propertyValue;
            return `begins_with(${nameToken}, ${valueToken})`;
          }
          if (condition.conditionType === CONDITION_TYPE.EQUALS) {
            ExpressionAttributeValues[valueToken] = condition.propertyValue;
            return `${nameToken} = ${valueToken}`;
          }
          throw new Error(`invalid condition type: ${condition.conditionType}`);
        })
        .join(' AND ');
    }

    const dynamoParams = {
      TableName: resolveTableName(params.tableName),
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
   * @param {import('../base.js').GetParams} params - params.
   * @returns {import('../base.js').GetReturn} - Result.
   */
  async function get(params) {
    const dynamoParams = {
      TableName: resolveTableName(params.tableName),
      ConsistentRead: params.consistentRead ?? true, // preserve explicit false
      Key: buildKey(params),
    };
    const { Item } = await docClient.get(dynamoParams);
    return Item;
  }

  /**
   * Delete an item by key.
   * @param {import('../base.js').RemoveParams} params - params.
   * @returns {import('../base.js').RemoveReturn} - Result.
   */
  async function remove(params) {
    assertWritable();
    const dynamoParams = {
      TableName: resolveTableName(params.tableName),
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
   * @param {any} obj - obj.
   * @returns {number} - Result.
   */
  function approxBytes(obj) {
    return Buffer.byteLength(JSON.stringify(obj));
  }

  /**
   * Pull up to 25 ops without exceeding a safe payload size.
   * @param {WriteRequest[]} queue - queue.
   * @returns {WriteRequest[]} - Result.
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
   * @param {import('../base.js').BatchWriteParams} params - params.
   * @returns {import('../base.js').BatchWriteReturn} - Result.
   */
  async function batchWrite(params) {
    assertWritable();
    const tableName = resolveTableName(params.tableName);
    const puts = (
      Array.isArray(params.putRequests) ? params.putRequests : []
    ).filter((v) => v !== undefined && v !== null);

    const deleteRequests = (
      Array.isArray(params.deleteRequests) ? params.deleteRequests : []
    ).map((del) => ({
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
          RequestItems: { [tableName]: unprocessed },
        };

        try {
          const { UnprocessedItems } = await docClient.batchWrite(dynamoParams);
          if (
            UnprocessedItems !== undefined &&
            (UnprocessedItems === null ||
              typeof UnprocessedItems !== 'object' ||
              Array.isArray(UnprocessedItems) ||
              Object.keys(UnprocessedItems).some((key) => key !== tableName))
          ) {
            throw new Error(
              'DynamoDB batchWrite returned unexpected table routing.',
            );
          }
          const retained = UnprocessedItems?.[tableName] ?? [];
          if (!Array.isArray(retained)) {
            throw new Error(
              'DynamoDB batchWrite returned invalid unprocessed items.',
            );
          }
          unprocessed = retained;

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

  /**
   * Atomically condition-check and mutate distinct items in one table using
   * DynamoDB TransactWriteItems.
   * @param {import('../base.js').TransactionWriteParams} params - params.
   * @returns {import('../base.js').TransactionWriteReturn} - Result.
   */
  async function transactionWrite(params) {
    assertWritable();
    const requests = validateTransactionWrite(params);
    const tableName = resolveTableName(params.tableName);
    /** @type {any[]} */
    const TransactItems = [];

    for (const [index, request] of requests.conditionChecks.entries()) {
      TransactItems.push({
        ConditionCheck: {
          TableName: tableName,
          Key: buildKey(transactionRequestKey(request, '', false)),
          ...compileWriteConditions(request.conditions, `cc${index}`),
        },
      });
    }

    for (const [index, request] of requests.putRequests.entries()) {
      TransactItems.push({
        Put: {
          TableName: tableName,
          Item: request.record,
          ...compileWriteConditions(request.conditions, `p${index}`),
        },
      });
    }

    for (const [index, request] of requests.updateRequests.entries()) {
      const updates = transactionRequestUpdates(
        request,
        `updateRequests[${index}]`,
      );
      /** @type {Record<string, string>} */
      const updateNames = {};
      /** @type {Record<string, any>} */
      const updateValues = {};
      let nameIndex = 0;
      const nameTokens = new Map();
      const nameTokenFor = (/** @type {string} */ segment) => {
        if (nameTokens.has(segment)) return nameTokens.get(segment);
        const token = `#u${index}n${nameIndex++}`;
        nameTokens.set(segment, token);
        updateNames[token] = segment;
        return token;
      };
      const clauses = updates.map((definition, updateIndex) => {
        const path = definition.property.map(nameTokenFor).join('.');
        const valueToken = `:u${index}v${updateIndex}`;
        updateValues[valueToken] = definition.propertyValue;
        return `${path} = ${valueToken}`;
      });
      const condition = compileWriteConditions(
        request.conditions,
        `u${index}c`,
      );

      TransactItems.push({
        Update: {
          TableName: tableName,
          Key: buildKey(transactionRequestKey(request, '', false)),
          UpdateExpression: `SET ${clauses.join(', ')}`,
          ...(condition.ConditionExpression
            ? { ConditionExpression: condition.ConditionExpression }
            : {}),
          ExpressionAttributeNames: {
            ...updateNames,
            ...(condition.ExpressionAttributeNames || {}),
          },
          ExpressionAttributeValues: {
            ...updateValues,
            ...(condition.ExpressionAttributeValues || {}),
          },
        },
      });
    }

    for (const [index, request] of requests.deleteRequests.entries()) {
      TransactItems.push({
        Delete: {
          TableName: tableName,
          Key: buildKey(transactionRequestKey(request, '', false)),
          ...compileWriteConditions(request.conditions, `d${index}`),
        },
      });
    }

    for (
      let attempt = 0;
      attempt < MAX_TRANSACTION_CONFLICT_ATTEMPTS;
      attempt += 1
    ) {
      try {
        await docClient.transactWrite({ TransactItems });
        return;
      } catch (error) {
        const cancellationReasons =
          error && typeof error === 'object' && 'CancellationReasons' in error
            ? /** @type {{ CancellationReasons?: Array<{Code?: string}> }} */ (
                error
              ).CancellationReasons
            : undefined;
        const reasonCodes = (cancellationReasons || [])
          .map((reason) => reason.Code)
          .filter((code) => code && code !== 'None');
        const onlyTransactionConflicts =
          reasonCodes.length > 0 &&
          reasonCodes.every((code) => code === 'TransactionConflict');
        if (
          error instanceof Error &&
          error.name === 'TransactionCanceledException' &&
          onlyTransactionConflicts &&
          attempt + 1 < MAX_TRANSACTION_CONFLICT_ATTEMPTS
        ) {
          // eslint-disable-next-line no-await-in-loop
          await sleepTransactionConflictBackoff(attempt);
          continue;
        }
        if (
          error instanceof Error &&
          error.name === 'TransactionCanceledException' &&
          reasonCodes.length > 0 &&
          reasonCodes.every((code) => code === 'ConditionalCheckFailed')
        ) {
          const conditionalError = new Error(error.message);
          conditionalError.name = 'ConditionalCheckFailedException';
          throw conditionalError;
        }
        throw error;
      }
    }

    throw new Error('DynamoDB transaction conflict retry limit exceeded');
  }

  const db = brandDBClient(
    {
      query,
      queryPage,
      put,
      update,
      get,
      remove,
      batchWrite,
      transactionWrite,
      /**
       * Close underlying resources (best-effort).
       * DynamoDB v3 clients keep sockets; destroy() closes them.
       * @returns {import('../base.js').CloseReturn} - Result.
       */
      close: async () => {
        DYNAMODB_CLIENT_CAPABILITIES.delete(db);
        if (typeof serviceClient.destroy === 'function')
          serviceClient.destroy();
      },
    },
    DB_ADAPTER_NAMES.DYNAMODB,
  );
  // Topology proof is attached to this exact wrapper. Keep its operation
  // surface immutable so later callers cannot redirect authority or ledger
  // traffic away from the raw client whose Region and table were validated.
  Object.freeze(db);
  DYNAMODB_CLIENT_CAPABILITIES.set(
    db,
    Object.freeze({
      serviceClient,
      pinnedTables,
      lastDescriptions,
      validatingTableNames,
      usedTableNames,
      failedTableNames,
    }),
  );
  return db;
}
