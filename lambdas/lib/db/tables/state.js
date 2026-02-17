import { CONDITION_TYPE, KEY_TYPE } from '../../db/base.js';
import envPaths from '../../env-paths.js';

/**
 * State table schema:
 * - Partition key: deployment
 * - Sort key: resource_key
 *
 * Records:
 * - deployment: string (deployment name)
 * - resource_key: string (resource name, with parent prefix: "parent#child")
 * - status: import('../../actor/resources/reconcilable.js').StatusEnum
 * - serialized: import('../../actor/typedefs.js').SerializedBaseResource
 * - version: string (deployment version)
 */

/**
 * @typedef {import('../base.js').DBClient} DBClient
 */

/**
 * @typedef CreateStateTableOptions
 * @property {DBClient} db - db.
 * @property {(deploymentName: string) => string} [tableNameResolver] - tableNameResolver.
 */

const KEY_NAME = 'deployment';
const SORT_KEY_NAME = 'resource_key';

/**
 * @param {string} propertyName - propertyName.
 * @param {any} propertyValue - propertyValue.
 * @returns {import('../base.js').KeyCondition} - Result.
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
 * @param {string} propertyName - propertyName.
 * @param {any} propertyValue - propertyValue.
 * @returns {import('../base.js').KeyCondition} - Result.
 */
function skBegins(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.SORT,
    conditionType: CONDITION_TYPE.BEGINS_WITH,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {any} resource - resource.
 * @returns {string} - Result.
 */
function resourceKeyOf(resource) {
  const parent = resource?.parent || '';
  const name = resource?.name || '';
  return parent ? `${parent}#${name}` : name;
}

/**
 * @param {any} resource - resource.
 * @returns {import('../../actor/typedefs.js').DeploymentEnvironmentProperties} - Result.
 */
function requireDeployment(resource) {
  let has_deployment = false;
  if (resource?.has?.('deployment')) {
    has_deployment = true;
  } else if (resource?.properties?.deployment) {
    has_deployment = true;
  }
  if (!has_deployment) {
    return {
      envPaths: envPaths('default'),
      version: '0.0.0',
      stateTable: 'default-state',
      name: 'default',
    };
  }
  const deployment = resource.get('deployment');
  if (!deployment?.name) {
    throw new Error('Deployment not found in resource properties');
  }
  return deployment;
}

/**
 * @param {import('../../actor/typedefs.js').DeploymentEnvironmentProperties} deployment - deployment.
 * @param {(deploymentName: string) => string} tableNameResolver - tableNameResolver.
 * @returns {string} - Result.
 */
function tableNameOf(deployment, tableNameResolver) {
  return deployment.stateTable || tableNameResolver(deployment.name);
}

/**
 * Factory that returns a State table client.
 *
 * The client is intentionally "resource-aware" because the state table name is
 * derived from the deployment embedded in the resource properties.
 * @param {CreateStateTableOptions} options - options.
 * @returns {any} - Result.
 */
export function createStateTable({
  db,
  tableNameResolver = (deploymentName) => `${deploymentName}-state`,
}) {
  if (!db) throw new Error('createStateTable requires a db adapter');

  /**
   * Persist (upsert) the full serialized resource + status.
   * @param {any} resource - resource.
   * @returns {Promise<void>} - Result.
   */
  async function putResource(resource) {
    const deployment = requireDeployment(resource);
    const tableName = tableNameOf(deployment, tableNameResolver);

    const record = {
      [KEY_NAME]: deployment.name,
      [SORT_KEY_NAME]: resourceKeyOf(resource),
      status: resource.status,
      serialized: resource.serialize(),
      version: deployment.version,
    };

    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record,
    });
  }

  /**
   * Persist just the status fields (status + serialized.status).
   *
   * Important behavior: this is an **upsert**.
   * - If the record exists: it updates status fields in-place.
   * - If it does not exist: it creates a minimal record (keys + status).
   * @param {any} resource - resource.
   * @returns {Promise<void>} - Result.
   */
  async function putResourceStatus(resource) {
    const deployment = requireDeployment(resource);
    const tableName = tableNameOf(deployment, tableNameResolver);

    const deploymentName = deployment.name;
    const resource_key = resourceKeyOf(resource);
    const nextStatus = resource.status;

    // Portable upsert semantics across adapters:
    // - DynamoDB update will upsert, but vanilla/lmdb update is a no-op if missing.
    const existing = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: deploymentName,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: resource_key,
      consistentRead: true,
    });

    if (!existing) {
      await db.put({
        tableName,
        keyName: KEY_NAME,
        sortKeyName: SORT_KEY_NAME,
        record: {
          [KEY_NAME]: deploymentName,
          [SORT_KEY_NAME]: resource_key,
          status: nextStatus,
          serialized: { status: nextStatus },
          version: deployment.version,
        },
      });
      return;
    }

    await db.update({
      tableName,
      keyName: KEY_NAME,
      keyValue: deploymentName,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: resource_key,
      updates: [
        { property: ['status'], propertyValue: nextStatus },
        { property: ['serialized', 'status'], propertyValue: nextStatus },
        ...(deployment.version !== undefined
          ? [{ property: ['version'], propertyValue: deployment.version }]
          : []),
      ],
    });
  }

  /**
   * Fetch stored status for a resource.
   * @param {any} resource - resource.
   * @returns {Promise<any | undefined>} - Result.
   */
  async function getResourceStatus(resource) {
    const deployment = requireDeployment(resource);
    const tableName = tableNameOf(deployment, tableNameResolver);

    const item = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: deployment.name,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: resourceKeyOf(resource),
      consistentRead: true,
    });

    return item?.status;
  }

  /**
   * Fetch stored serialized resource.
   * @param {any} resource - resource.
   * @returns {Promise<any | undefined>} - Result.
   */
  async function getResource(resource) {
    const deployment = requireDeployment(resource);
    const tableName = tableNameOf(deployment, tableNameResolver);

    const item = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: deployment.name,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: resourceKeyOf(resource),
      consistentRead: true,
    });

    return item?.serialized;
  }

  /**
   * Fetch a resource subtree by prefix.
   *
   * Behavior matches the legacy implementation:
   * - Queries `resource_key begins_with <prefix>`
   * - Sorts by resource_key
   * - If the exact root record (<prefix>) does not exist, returns []
   * @param {string} deploymentName - deploymentName.
   * @param {string} resourceKey - resourceKey.
   * @returns {Promise<any[]>} - Result.
   */
  async function getResources(deploymentName, resourceKey) {
    const tableName = tableNameResolver(deploymentName);

    const items = await db.query({
      tableName,
      consistentRead: true,
      keyConditions: [
        pkEq(KEY_NAME, deploymentName),
        skBegins(SORT_KEY_NAME, resourceKey),
      ],
    });

    const sorted = (items || [])
      .slice()
      .sort((a, b) =>
        String(a?.[SORT_KEY_NAME] || '').localeCompare(
          String(b?.[SORT_KEY_NAME] || ''),
        ),
      );

    if (!sorted.length) return [];

    // Root must exist. If we only have children, return empty.
    if (sorted[0]?.[SORT_KEY_NAME] !== resourceKey) return [];

    return sorted.map((item) => item.serialized).filter(Boolean);
  }

  /**
   * Delete resource state record.
   * @param {any} resource - resource.
   * @returns {Promise<void>} - Result.
   */
  async function deleteResource(resource) {
    const deployment = requireDeployment(resource);
    const tableName = tableNameOf(deployment, tableNameResolver);

    await db.remove({
      tableName,
      keyName: KEY_NAME,
      keyValue: deployment.name,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: resourceKeyOf(resource),
    });
  }

  return {
    putResource,
    putResourceStatus,
    getResource,
    getResources,
    getResourceStatus,
    deleteResource,
  };
}

export default createStateTable;
