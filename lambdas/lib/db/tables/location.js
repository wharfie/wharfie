import { CONDITION_TYPE, KEY_TYPE } from '../../db/base.js';

/**
 * @typedef {import('../../db/base.js').DBClient} DBClient
 * @typedef {import('../../../typedefs.js').LocationRecord} LocationRecord
 */

const DEFAULT_INTERVAL = '300';
const TABLE_ENV_VAR = 'LOCATION_TABLE';

const KEY_NAME = 'location';
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

const isTerminalLocation = (/** @type {string} */ location) =>
  !location || location === 's3://';

const parentLocation = (/** @type {string} */ location) => {
  if (isTerminalLocation(location)) return '';

  if (!location.endsWith('/')) {
    const idx = location.lastIndexOf('/');
    if (idx <= 0) return '';
    return location.slice(0, idx + 1);
  }

  const trimmed = location.slice(0, -1);
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '';
  return trimmed.slice(0, idx + 1);
};

/**
 * @typedef {Object} locationClient
 * @property {(locationRecord: LocationRecord) => void} putLocation - putLocation.
 * @property {(location: string) => Promise<LocationRecord[]>} findLocations - findLocations.
 * @property {(locationRecord: LocationRecord) => void} deleteLocation - deleteLocation.
 */

/**
 * Factory: Location table client.
 * @param {object} params - params.
 * @param {DBClient} params.db - params.db.
 * @param {string} [params.tableName] - params.tableName.
 * @returns {locationClient} - Result.
 */
export function createLocationTable({
  db,
  tableName = process.env[TABLE_ENV_VAR] || '',
}) {
  /**
   * @param {LocationRecord} locationRecord - locationRecord.
   */
  async function putLocation(locationRecord) {
    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record: {
        ...locationRecord,
        interval: locationRecord.interval || DEFAULT_INTERVAL,
      },
    });
  }

  /**
   * Walks up the location tree until it finds matches.
   * @param {string} location - location.
   * @returns {Promise<LocationRecord[]>} - Result.
   */
  async function findLocations(location) {
    if (isTerminalLocation(location)) return [];

    const items =
      (await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [pkEq(KEY_NAME, location)],
      })) || [];

    const records = items
      .map((item) => ({
        location: item.location || location,
        resource_id: item.resource_id,
        interval: item.interval || DEFAULT_INTERVAL,
      }))
      .filter((item) => item.resource_id);

    if (records.length) return records;

    const parent = parentLocation(location);
    if (!parent || parent === location) return [];
    return findLocations(parent);
  }

  /**
   * @param {LocationRecord} locationRecord - locationRecord.
   */
  async function deleteLocation(locationRecord) {
    await db.remove({
      tableName,
      keyName: KEY_NAME,
      keyValue: locationRecord.location,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: locationRecord.resource_id,
    });
  }

  return { putLocation, findLocations, deleteLocation };
}
