import { createLocationTable } from '../db/tables/location.js';
import { getDB, resetDB } from './_shared.js';

/** @type {Map<string, ReturnType<typeof createLocationTable>>} */
const _tables = new Map();

/**
 * @param {string} [tableName] -
 * @returns {Promise<ReturnType<typeof createLocationTable>>} -
 */
async function getTable(tableName) {
  const key = tableName || '__default__';
  const existing = _tables.get(key);
  if (existing) return existing;

  const db = await getDB();
  const table = createLocationTable({
    db,
    ...(tableName ? { tableName } : {}),
  });

  _tables.set(key, table);
  return table;
}

/**
 * @param {import('../../typedefs.js').LocationRecord} locationRecord -
 * @param {string} [tableName] -
 */
export async function putLocation(locationRecord, tableName) {
  return (await getTable(tableName)).putLocation(locationRecord);
}

/**
 * @param {string} location -
 * @param {string} [tableName] -
 */
export async function findLocations(location, tableName) {
  return (await getTable(tableName)).findLocations(location);
}

/**
 * @param {import('../../typedefs.js').LocationRecord} locationRecord -
 * @param {string} [tableName] -
 */
export async function deleteLocation(locationRecord, tableName) {
  return (await getTable(tableName)).deleteLocation(locationRecord);
}

export function __setMockState() {
  _tables.clear();
  resetDB();
}
