import { CONDITION_TYPE, KEY_TYPE } from '../../db/base.js';

/**
 * @typedef {import('../../db/base.js').DBClient} DBClient
 * @typedef {import('../../../typedefs.js').DependencyRecord} DependencyRecord
 */

const DEFAULT_INTERVAL = '300';
const TABLE_ENV_VAR = 'DEPENDENCY_TABLE';

const KEY_NAME = 'dependency';
const SORT_KEY_NAME = 'resource_id';

/**
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../db/base.js').KeyCondition} - Result.
 */
function pkEq(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.PRIMARY,
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * A DynamoDB wrapper client exposing the base DB methods.
 * @typedef {Object} dependencyClient
 * @property {(dependency: DependencyRecord) => void} putDependency - putDependency.
 * @property {(dependency: DependencyRecord) => Promise<DependencyRecord[]>} findDependencies - findDependencies.
 * @property {(dependency: DependencyRecord) => void} deleteDependency - deleteDependency.
 */

/**
 * Factory: Dependency table client.
 * @param {object} params - params.
 * @param {DBClient} params.db - params.db.
 * @param {string} [params.tableName] - params.tableName.
 * @returns {dependencyClient} - Result.
 */
export function createDependencyTable({
  db,
  tableName = process.env[TABLE_ENV_VAR] || '',
}) {
  /**
   * @param {DependencyRecord} dependency - dependency.
   */
  async function putDependency(dependency) {
    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: {
        ...dependency,
        interval: dependency.interval || DEFAULT_INTERVAL,
      },
    });
  }

  /**
   * @param {DependencyRecord} dependency - dependency.
   * @returns {Promise<DependencyRecord[]>} - Result.
   */
  async function findDependencies(dependency) {
    const items =
      (await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [pkEq(KEY_NAME, dependency.dependency)],
      })) || [];

    return items
      .map((item) => ({
        dependency: dependency.dependency,
        resource_id: item.resource_id,
        interval: item.interval || DEFAULT_INTERVAL,
      }))
      .filter((item) => item.resource_id);
  }

  /**
   * @param {DependencyRecord} dependency - dependency.
   */
  async function deleteDependency(dependency) {
    await db.remove({
      tableName,
      keyName: KEY_NAME,
      keyValue: dependency.dependency,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: dependency.resource_id,
    });
  }

  return { putDependency, findDependencies, deleteDependency };
}
