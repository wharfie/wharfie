/**
 * @typedef {Record<string, any>} DBRecord
 */

/**
 * @typedef {(
 * 'EQUALS'|
 * 'BEGINS_WITH'
 * )} ConditionTypeEnum
 */
/**
 * @type {Object<ConditionTypeEnum,ConditionTypeEnum>}
 */
const CONDITION_TYPE = {
  EQUALS: 'EQUALS',
  BEGINS_WITH: 'BEGINS_WITH',
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

/**
 * @typedef KeyCondition
 * @property {ConditionTypeEnum} conditionType - conditionType.
 * @property {string} propertyName - propertyName.
 * @property {any} propertyValue - propertyValue.
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
 * @property {(params: PutParams) => PutReturn} put - put.
 * @property {(params: UpdateParams) => UpdateReturn} update - update.
 * @property {(params: GetParams) => GetReturn} get - get.
 * @property {(params: RemoveParams) => RemoveReturn} remove - remove.
 * @property {(params: BatchWriteParams) => BatchWriteReturn} batchWrite - batchWrite.
 * @property {() => CloseReturn} close - close.
 */

/**
 * Factory function that creates a DynamoDB wrapper client.
 * @returns {DBClient} - Result.
 */
export default function createDB() {
  return {
    query,
    batchWrite,
    update,
    put,
    get,
    remove,
    close,
  };
}

export { CONDITION_TYPE, KEY_TYPE };
