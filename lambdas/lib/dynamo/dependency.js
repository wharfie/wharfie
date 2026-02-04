import { createDependencyTable } from '../db/tables/dependency.js';
import { getDB, resetDB } from './_shared.js';

/** @type {Map<string, ReturnType<typeof createDependencyTable>>} */
const _tables = new Map();

/**
 * @param {string} [tableName] - tableName.
 * @returns {Promise<ReturnType<typeof createDependencyTable>>} - Result.
 */
async function getTable(tableName) {
  const key = tableName || '__default__';
  const existing = _tables.get(key);
  if (existing) return existing;

  const db = await getDB();
  const table = createDependencyTable({
    db,
    ...(tableName ? { tableName } : {}),
  });

  _tables.set(key, table);
  return table;
}

/**
 * @param {import('../../typedefs.js').DependencyRecord} dependency - dependency.
 * @param {string} [tableName] - tableName.
 * @returns {Promise<any>} - Result.
 */
export async function putDependency(dependency, tableName) {
  return (await getTable(tableName)).putDependency(dependency);
}

/**
 * @param {import('../../typedefs.js').DependencyRecord | string} dependency - dependency.
 * @param {string} [tableName] - tableName.
 * @returns {Promise<any>} - Result.
 */
export async function findDependencies(dependency, tableName) {
  const record =
    typeof dependency === 'string' ? { dependency } : dependency || {};
  return (await getTable(tableName)).findDependencies(
    /** @type {import('../../typedefs.js').DependencyRecord} */ (record),
  );
}

/**
 * @param {import('../../typedefs.js').DependencyRecord} dependency - dependency.
 * @param {string} [tableName] - tableName.
 * @returns {Promise<any>} - Result.
 */
export async function deleteDependency(dependency, tableName) {
  return (await getTable(tableName)).deleteDependency(dependency);
}

/**
 *
 * @returns {void} - Result.
 */
export function __setMockState() {
  _tables.clear();
  resetDB();
}
