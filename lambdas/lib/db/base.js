/**
 * @typedef {Record<string, any>} DBRecord
 */

/**
 * @typedef {(
 * 'EQUALS'|
 * 'BEGINS_WITH'
 * )} ConditionTypeEnum
 */
const CONDITION_TYPE = {
  EQUALS: 'EQUALS',
  BEGINS_WITH: 'BEGINS_WITH',
};

/**
 * @typedef KeyCondition
 * @property {ConditionTypeEnum} conditionType -
 * @property {string} propertyName -
 * @property {any} propertyValue -
 */
/**
 * @typedef QueryParams
 * @property {string} tableName -
 * @property {boolean} consistentRead -
 * @property {KeyCondition[]} keyConditions -
 */

/**
 * @typedef {Promise<DBRecord[]>} QueryReturn
 */

/**
 * @param {QueryParams} params -
 * @returns {QueryReturn} -
 */
async function query(params) {
  return [];
}

/**
 * Delete request where either:
 *  - no sort key fields exist, OR
 *  - both sortKeyName and sortKeyValue exist
 *
 * @typedef {(
 *   { keyName: string, keyValue: string } &
 *   (
 *     { sortKeyName?: undefined, sortKeyValue?: undefined } |
 *     { sortKeyName: string, sortKeyValue: string }
 *   )
 * )} DeleteRequest
 */

/**
 * @typedef {DBRecord} PutRequest
 */

/**
 * @typedef BatchWriteParams
 * @property {string} tableName -
 * @property {DeleteRequest[]} deleteRequests -
 * @property {PutRequest[]} putRequests -
 */

/**
 * @typedef {Promise<void>} BatchWriteReturn
 */

/**
 * @param {BatchWriteParams} params -
 * @returns {BatchWriteReturn} -
 */
async function batchWrite(params) {}

/**
 * @typedef UpdateDefinition
 * @property {string[]} property -
 * @property {any} propertyValue -
 */

/**
 * @typedef UpdateParams
 * @property {string} tableName -
 * @property {DBRecord} record -
 * @property {string} keyName -
 * @property {string} keyValue -
 * @property {string} [sortKeyName] -
 * @property {string} [sortKeyValue] -
 * @property {KeyCondition[]} [conditions] -
 * @property {UpdateDefinition[]} [updates] -
 */

/**
 * @typedef {Promise<void>} UpdateReturn
 */

/**
 * @param {UpdateParams} params -
 * @returns {UpdateReturn} -
 */
async function update(params) {}

/**
 * @typedef PutParams
 * @property {string} tableName -
 * @property {DBRecord} record -
 */

/**
 * @typedef {Promise<void>} PutReturn
 */

/**
 * @param {PutParams} params -
 * @returns {PutReturn} -
 */
async function put(params) {}

/**
 * @typedef GetParams
 * @property {string} tableName -
 * @property {boolean} [consistentRead] -
 * @property {string} keyName -
 * @property {string} keyValue -
 * @property {string} [sortKeyName] -
 * @property {string} [sortKeyValue] -
 */

/**
 * @typedef {Promise<DBRecord | void>} GetReturn
 */

/**
 * @param {GetParams} params -
 * @returns {GetReturn} -
 */
async function get(params) {}

/**
 * @typedef RemoveParams
 * @property {string} tableName -
 * @property {string} keyName -
 * @property {string} keyValue -
 * @property {string} [sortKeyName] -
 * @property {string} [sortKeyValue] -
 */

/**
 * @typedef {Promise<void>} RemoveReturn
 */

/**
 * @param {RemoveParams} params -
 * @returns {RemoveReturn} -
 */
async function remove(params) {}

/**
 * @typedef {Promise<void>} CloseReturn
 */

/**
 * @returns {CloseReturn} -
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
 * @property {(params: QueryParams) => QueryReturn} query -
 * @property {(params: PutParams) => PutReturn} put -
 * @property {(params: UpdateParams) => UpdateReturn} update -
 * @property {(params: GetParams) => GetReturn} get -
 * @property {(params: RemoveParams) => RemoveReturn} remove -
 * @property {(params: BatchWriteParams) => BatchWriteReturn} batchWrite -
 * @property {() => CloseReturn} close -
 */

/**
 * Factory function that creates a DynamoDB wrapper client.
 * @returns {DBClient} -
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

export { CONDITION_TYPE };
