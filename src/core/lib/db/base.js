/**
 * @typedef {Record<string, any>} DBRecord
 */

/**
 * @typedef {(
 * 'EQUALS'|
 * 'BEGINS_WITH'|
 * 'EXISTS'|
 * 'NOT_EXISTS'
 * )} ConditionTypeEnum
 */
/**
 * @type {Object<ConditionTypeEnum,ConditionTypeEnum>}
 */
const CONDITION_TYPE = {
  EQUALS: 'EQUALS',
  BEGINS_WITH: 'BEGINS_WITH',
  EXISTS: 'EXISTS',
  NOT_EXISTS: 'NOT_EXISTS',
};

/**
 * @typedef {(
 * 'PRIMARY'|
 * 'SORT'
 * )} KeyTypeEnum
 */
/**
 * @type {Object<KeyTypeEnum,KeyTypeEnum>}
 */
const KEY_TYPE = {
  PRIMARY: 'PRIMARY',
  SORT: 'SORT',
};

const TRANSACTION_REQUEST_KEYS = [
  'conditionChecks',
  'putRequests',
  'updateRequests',
  'deleteRequests',
];

/**
 * Test one top-level record field against a portable condition.
 * @param {DBRecord | undefined} record - Pre-write record, if present.
 * @param {KeyCondition} condition - condition.
 * @returns {boolean} - Whether the condition matches.
 */
function recordMatchesCondition(record, condition) {
  const exists =
    record !== undefined &&
    Object.prototype.hasOwnProperty.call(record, condition.propertyName);

  if (condition.conditionType === CONDITION_TYPE.EXISTS) return exists;
  if (condition.conditionType === CONDITION_TYPE.NOT_EXISTS) return !exists;
  if (!exists) return false;

  const value = record?.[condition.propertyName];
  if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
    return (
      typeof value === 'string' &&
      value.startsWith(String(condition.propertyValue))
    );
  }
  if (condition.conditionType === CONDITION_TYPE.EQUALS) {
    return value === condition.propertyValue;
  }
  throw new Error(`invalid condition type: ${condition.conditionType}`);
}

/**
 * @param {unknown} conditions - conditions.
 * @param {string} label - Human-readable request label.
 * @param {boolean} required - Whether at least one condition is required.
 * @returns {void} - Resolves when the conditions are valid.
 */
function assertConditions(conditions, label, required = false) {
  if (!Array.isArray(conditions)) {
    throw new Error(`${label}.conditions must be an array`);
  }
  if (required && conditions.length === 0) {
    throw new Error(`${label}.conditions must not be empty`);
  }

  for (const [index, condition] of conditions.entries()) {
    if (!condition || typeof condition !== 'object') {
      throw new Error(`${label}.conditions[${index}] must be an object`);
    }
    if (
      typeof condition.propertyName !== 'string' ||
      condition.propertyName.length === 0
    ) {
      throw new Error(`${label}.conditions[${index}].propertyName is required`);
    }
    if (!Object.values(CONDITION_TYPE).includes(condition.conditionType)) {
      throw new Error(
        `${label}.conditions[${index}] has invalid condition type: ${condition.conditionType}`,
      );
    }
    if (
      condition.conditionType === CONDITION_TYPE.EXISTS ||
      condition.conditionType === CONDITION_TYPE.NOT_EXISTS
    ) {
      if (condition.propertyValue !== undefined) {
        throw new Error(
          `${label}.conditions[${index}] must not include propertyValue for ${condition.conditionType}`,
        );
      }
    } else if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
      if (typeof condition.propertyValue !== 'string') {
        throw new Error(
          `${label}.conditions[${index}].propertyValue must be a string for BEGINS_WITH`,
        );
      }
    } else if (
      condition.propertyValue === undefined ||
      (condition.propertyValue !== null &&
        !['string', 'number', 'boolean'].includes(
          typeof condition.propertyValue,
        )) ||
      (typeof condition.propertyValue === 'number' &&
        !Number.isFinite(condition.propertyValue))
    ) {
      throw new Error(
        `${label}.conditions[${index}].propertyValue must be a portable JSON primitive for EQUALS`,
      );
    }
  }
}

/**
 * @param {Record<string, any>} request - request.
 * @param {string} label - Human-readable request label.
 * @param {boolean} put - Whether keys must be read from a put record.
 * @returns {{ keyName: string, keyValue: string, sortKeyName?: string, sortKeyValue?: string }} - Exact item key.
 */
function transactionRequestKey(request, label, put) {
  if (typeof request.keyName !== 'string' || request.keyName.length === 0) {
    throw new Error(`${label}.keyName is required`);
  }

  const keyValue = put ? request.record?.[request.keyName] : request.keyValue;
  if (typeof keyValue !== 'string') {
    throw new Error(
      `${label}.${put ? `record.${request.keyName}` : 'keyValue'} must be a string`,
    );
  }

  const hasSortName = request.sortKeyName !== undefined;
  const sortKeyValue = put
    ? hasSortName
      ? request.record?.[request.sortKeyName]
      : undefined
    : request.sortKeyValue;
  const hasSortValue = sortKeyValue !== undefined;
  if (hasSortName !== hasSortValue) {
    throw new Error(
      `${label}.sortKeyName and ${put ? `record.${request.sortKeyName}` : 'sortKeyValue'} must be provided together`,
    );
  }
  if (hasSortName) {
    if (
      typeof request.sortKeyName !== 'string' ||
      request.sortKeyName.length === 0
    ) {
      throw new Error(`${label}.sortKeyName must be a non-empty string`);
    }
    if (typeof sortKeyValue !== 'string') {
      throw new Error(
        `${label}.${put ? `record.${request.sortKeyName}` : 'sortKeyValue'} must be a string`,
      );
    }
  }

  return {
    keyName: request.keyName,
    keyValue,
    ...(hasSortName ? { sortKeyName: request.sortKeyName, sortKeyValue } : {}),
  };
}

/**
 * Return and validate the exact update definitions shared by all adapters.
 * @param {TransactionUpdateRequest} request - Update request.
 * @param {string} [label] - Human-readable request label.
 * @returns {UpdateDefinition[]} - Validated updates.
 */
function transactionRequestUpdates(request, label = 'updateRequest') {
  if (request.updates !== undefined && !Array.isArray(request.updates)) {
    throw new Error(`${label}.updates must be an array`);
  }
  const updates =
    request.updates && request.updates.length > 0
      ? request.updates
      : Object.entries(request.record || {})
          .filter(([, value]) => value !== undefined)
          .filter(
            ([property]) =>
              property !== request.keyName && property !== request.sortKeyName,
          )
          .map(([property, propertyValue]) => ({
            property: [property],
            propertyValue,
          }));
  if (updates.length === 0) {
    throw new Error(`${label} requires at least one update`);
  }

  /** @type {string[][]} */
  const paths = [];
  for (const [index, update] of updates.entries()) {
    if (!update || typeof update !== 'object') {
      throw new Error(`${label}.updates[${index}] must be an object`);
    }
    if (
      !Array.isArray(update.property) ||
      update.property.length === 0 ||
      update.property.some(
        (segment) => typeof segment !== 'string' || segment.length === 0,
      )
    ) {
      throw new Error(
        `${label}.updates[${index}].property must be a nonempty string path`,
      );
    }
    if (
      update.property[0] === request.keyName ||
      update.property[0] === request.sortKeyName
    ) {
      throw new Error(`${label}.updates[${index}] cannot modify a key field`);
    }
    if (update.propertyValue === undefined) {
      throw new Error(
        `${label}.updates[${index}].propertyValue must not be undefined`,
      );
    }

    for (const existing of paths) {
      const sharedLength = Math.min(existing.length, update.property.length);
      const sharesPrefix = existing
        .slice(0, sharedLength)
        .every((segment, pathIndex) => segment === update.property[pathIndex]);
      if (sharesPrefix) {
        throw new Error(
          `${label}.updates contains duplicate or overlapping paths`,
        );
      }
    }
    paths.push(update.property);
  }
  return updates;
}

/**
 * Validate the provider-neutral transaction envelope before any adapter reads or
 * writes state.
 * @param {TransactionWriteParams} params - params.
 * @returns {{ conditionChecks: TransactionConditionCheck[], putRequests: TransactionPutRequest[], updateRequests: TransactionUpdateRequest[], deleteRequests: TransactionDeleteRequest[] }} - Normalized request arrays.
 */
function validateTransactionWrite(params) {
  if (!params || typeof params !== 'object') {
    throw new Error('transactionWrite requires params');
  }
  if (typeof params.tableName !== 'string' || !params.tableName.trim()) {
    throw new Error('transactionWrite requires a tableName');
  }

  const unsafeParams = /** @type {Record<string, any>} */ (params);
  for (const key of TRANSACTION_REQUEST_KEYS) {
    if (unsafeParams[key] !== undefined && !Array.isArray(unsafeParams[key])) {
      throw new Error(`transactionWrite ${key} must be an array`);
    }
  }

  const normalized = /** @type {any} */ ({
    conditionChecks: params.conditionChecks || [],
    putRequests: params.putRequests || [],
    updateRequests: params.updateRequests || [],
    deleteRequests: params.deleteRequests || [],
  });
  const itemCount = TRANSACTION_REQUEST_KEYS.reduce(
    (count, key) => count + normalized[key].length,
    0,
  );
  if (itemCount < 1 || itemCount > 100) {
    throw new Error('transactionWrite requires between 1 and 100 items');
  }

  /** @type {{ keyName: string, sortKeyName?: string } | undefined} */
  let schema;
  const targets = new Set();
  for (const [groupName, requests] of /** @type {Array<[string, any[]]>} */ (
    Object.entries(normalized)
  )) {
    for (const [index, request] of requests.entries()) {
      const label = `${groupName}[${index}]`;
      if (!request || typeof request !== 'object') {
        throw new Error(`${label} must be an object`);
      }
      const put = groupName === 'putRequests';
      if (put && (!request.record || typeof request.record !== 'object')) {
        throw new Error(`${label}.record is required`);
      }
      const key = transactionRequestKey(request, label, put);
      const requestSchema = {
        keyName: key.keyName,
        ...(key.sortKeyName ? { sortKeyName: key.sortKeyName } : {}),
      };
      if (!schema) schema = requestSchema;
      if (
        schema.keyName !== requestSchema.keyName ||
        schema.sortKeyName !== requestSchema.sortKeyName
      ) {
        throw new Error('transactionWrite requires one consistent key schema');
      }

      const target = JSON.stringify([
        key.keyName,
        key.keyValue,
        key.sortKeyName ?? null,
        key.sortKeyValue ?? null,
      ]);
      if (targets.has(target)) {
        throw new Error(
          'transactionWrite cannot target an item more than once',
        );
      }
      targets.add(target);

      const conditions = request.conditions ?? [];
      assertConditions(conditions, label, groupName === 'conditionChecks');

      if (groupName === 'updateRequests') {
        transactionRequestUpdates(request, label);
      }
    }
  }

  return /** @type {{ conditionChecks: TransactionConditionCheck[], putRequests: TransactionPutRequest[], updateRequests: TransactionUpdateRequest[], deleteRequests: TransactionDeleteRequest[] }} */ (
    normalized
  );
}

/**
 * @typedef KeyCondition
 * @property {ConditionTypeEnum} conditionType - conditionType.
 * @property {string} propertyName - propertyName.
 * @property {any} [propertyValue] - propertyValue.
 * @property {KeyTypeEnum} [keyType] - keyType.
 */
/**
 * @typedef QueryParams
 * @property {string} tableName - tableName.
 * @property {boolean} consistentRead - consistentRead.
 * @property {KeyCondition[]} keyConditions - keyConditions.
 */

/**
 * @typedef {Promise<DBRecord[]>} QueryReturn
 */

/**
 * @param {QueryParams} params - params.
 * @returns {QueryReturn} - Result.
 */
async function query(params) {
  return [];
}

/**
 * A deliberately narrow byte-sorted query page. The primary key, sort-key
 * field, sort prefix, and cursor are nonempty printable ASCII, so JavaScript,
 * LMDB, and DynamoDB agree on their UTF-8 lexical order. `startAfter` is the
 * exact prior sort-key value returned by the same request, never a
 * provider-native cursor.
 * @typedef QueryPageParams
 * @property {string} tableName - tableName.
 * @property {boolean} consistentRead - consistentRead.
 * @property {KeyCondition[]} keyConditions - One PRIMARY EQUALS and one SORT BEGINS_WITH condition.
 * @property {number} limit - Maximum number of records, from 1 through 100.
 * @property {string} [startAfter] - Exclusive prior sort-key value.
 */

/**
 * @typedef QueryPageResult
 * @property {DBRecord[]} items - One UTF-8-byte-ordered page.
 * @property {string} [nextStartAfter] - Exact last sort key when another page exists.
 */

/** @typedef {Promise<QueryPageResult>} QueryPageReturn */

/**
 * @param {QueryPageParams} params - params.
 * @returns {QueryPageReturn} - Result.
 */
async function queryPage(params) {
  return { items: [] };
}

/**
 * Delete request where either:
 * - no sort key fields exist, OR
 * - both sortKeyName and sortKeyValue exist
 * @typedef {(
 *   { keyName: string, keyValue: string } &
 *   (
 *     { sortKeyName?: undefined, sortKeyValue?: undefined } |
 *     { sortKeyName: string, sortKeyValue: string }
 *   )
 * )} DeleteRequest
 */

/**
 * @typedef PutRequest
 * @property {DBRecord} record - record.
 * @property {string} keyName - keyName.
 * @property {string} [sortKeyName] - sortKeyName.
 */

/**
 * @typedef BatchWriteParams
 * @property {string} tableName - tableName.
 * @property {DeleteRequest[]} [deleteRequests] - deleteRequests.
 * @property {PutRequest[]} [putRequests] - putRequests.
 */

/**
 * @typedef {Promise<void>} BatchWriteReturn
 */

/**
 * @param {BatchWriteParams} params - params.
 * @returns {BatchWriteReturn} - Result.
 */
async function batchWrite(params) {}

/**
 * @typedef TransactionConditionCheck
 * @property {string} keyName - keyName.
 * @property {string} keyValue - keyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 * @property {KeyCondition[]} conditions - Conditions evaluated against the pre-transaction record.
 */

/**
 * @typedef TransactionPutRequest
 * @property {DBRecord} record - record.
 * @property {string} keyName - keyName.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {KeyCondition[]} [conditions] - Conditions evaluated against the pre-transaction record.
 */

/**
 * @typedef TransactionUpdateRequest
 * @property {DBRecord} [record] - record.
 * @property {string} keyName - keyName.
 * @property {string} keyValue - keyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 * @property {KeyCondition[]} [conditions] - Conditions evaluated against the pre-transaction record.
 * @property {UpdateDefinition[]} [updates] - updates.
 */

/**
 * @typedef TransactionDeleteRequest
 * @property {string} keyName - keyName.
 * @property {string} keyValue - keyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 * @property {KeyCondition[]} [conditions] - Conditions evaluated against the pre-transaction record.
 */

/**
 * @typedef TransactionWriteParams
 * @property {string} tableName - Exactly one table is mutated.
 * @property {TransactionConditionCheck[]} [conditionChecks] - Read-only preconditions.
 * @property {TransactionPutRequest[]} [putRequests] - Atomic puts.
 * @property {TransactionUpdateRequest[]} [updateRequests] - Atomic updates. A missing item is created from its key fields.
 * @property {TransactionDeleteRequest[]} [deleteRequests] - Atomic deletes.
 */

/**
 * @typedef {Promise<void>} TransactionWriteReturn
 */

/**
 * Atomically condition-check and mutate up to 100 distinct items in one table.
 * Every condition is evaluated against state from before the transaction.
 * @param {TransactionWriteParams} params - params.
 * @returns {TransactionWriteReturn} - Result.
 */
async function transactionWrite(params) {}

/**
 * @typedef UpdateDefinition
 * @property {string[]} property - property.
 * @property {any} propertyValue - propertyValue.
 */

/**
 * @typedef UpdateParams
 * @property {string} tableName - tableName.
 * @property {DBRecord} [record] - record.
 * @property {string} keyName - keyName.
 * @property {string} keyValue - keyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 * @property {KeyCondition[]} [conditions] - conditions.
 * @property {UpdateDefinition[]} [updates] - updates.
 */

/**
 * @typedef {Promise<void>} UpdateReturn
 */

/**
 * @param {UpdateParams} params - params.
 * @returns {UpdateReturn} - Result.
 */
async function update(params) {}

/**
 * @typedef PutParams
 * @property {string} tableName - tableName.
 * @property {string} keyName - keyName.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {DBRecord} record - record.
 */

/**
 * @typedef {Promise<void>} PutReturn
 */

/**
 * @param {PutParams} params - params.
 * @returns {PutReturn} - Result.
 */
async function put(params) {}

/**
 * @typedef GetParams
 * @property {string} tableName - tableName.
 * @property {boolean} [consistentRead] - consistentRead.
 * @property {string} keyName - keyName.
 * @property {string} keyValue - keyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 */

/**
 * @typedef {Promise<DBRecord | void>} GetReturn
 */

/**
 * @param {GetParams} params - params.
 * @returns {GetReturn} - Result.
 */
async function get(params) {}

/**
 * @typedef RemoveParams
 * @property {string} tableName - tableName.
 * @property {string} keyName - keyName.
 * @property {string} keyValue - keyValue.
 * @property {string} [sortKeyName] - sortKeyName.
 * @property {string} [sortKeyValue] - sortKeyValue.
 */

/**
 * @typedef {Promise<void>} RemoveReturn
 */

/**
 * @param {RemoveParams} params - params.
 * @returns {RemoveReturn} - Result.
 */
async function remove(params) {}

/**
 * @typedef {Promise<void>} CloseReturn
 */

/**
 * @returns {CloseReturn} - Result.
 */
async function close() {}

/**
 * Factory options for creating a DynamoDB wrapper client.
 * @typedef CreateDynamoDBOptions
 * @property {string} [region] AWS region to use. Defaults to `process.env.AWS_REGION`.
 */

/**
 * A DynamoDB wrapper client exposing the base DB methods.
 * @typedef {Object} DBClient
 * @property {(params: QueryParams) => QueryReturn} query - query.
 * @property {(params: QueryPageParams) => QueryPageReturn} queryPage - queryPage.
 * @property {(params: PutParams) => PutReturn} put - put.
 * @property {(params: UpdateParams) => UpdateReturn} update - update.
 * @property {(params: GetParams) => GetReturn} get - get.
 * @property {(params: RemoveParams) => RemoveReturn} remove - remove.
 * @property {(params: BatchWriteParams) => BatchWriteReturn} batchWrite - batchWrite.
 * @property {(params: TransactionWriteParams) => TransactionWriteReturn} transactionWrite - transactionWrite.
 * @property {() => CloseReturn} close - close.
 */

/**
 * Factory function that creates a DynamoDB wrapper client.
 * @returns {DBClient} - Result.
 */
export default function createDB() {
  return {
    query,
    queryPage,
    batchWrite,
    transactionWrite,
    update,
    put,
    get,
    remove,
    close,
  };
}

export {
  CONDITION_TYPE,
  KEY_TYPE,
  recordMatchesCondition,
  transactionRequestKey,
  transactionRequestUpdates,
  validateTransactionWrite,
};
