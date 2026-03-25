import { createSchedulerTable } from '../../db/tables/scheduler.js';
import { getDB, resetDB } from './_shared.js';

/** @type {Map<string, ReturnType<typeof createSchedulerTable>>} */
const _tables = new Map();

/**
 * @param {string} [tableName] - tableName.
 * @returns {Promise<ReturnType<typeof createSchedulerTable>>} - Result.
 */
async function getTable(tableName) {
  const key = tableName || '__default__';
  const existing = _tables.get(key);
  if (existing) return existing;

  const db = await getDB();
  const table = createSchedulerTable({
    db,
    ...(tableName ? { tableName } : {}),
  });

  _tables.set(key, table);
  return table;
}

/**
 * @param {any} schedulerEvent - schedulerEvent.
 * @returns {Promise<any>} - Result.
 */
export async function schedule(schedulerEvent) {
  return (await getTable()).schedule(schedulerEvent);
}

/**
 * @param {any} schedulerEvent - schedulerEvent.
 * @param {any} status - status.
 * @returns {Promise<any>} - Result.
 */
export async function update(schedulerEvent, status) {
  return (await getTable()).update(schedulerEvent, status);
}

/**
 * @param {string} resource_id - resource_id.
 * @param {string} partition - partition.
 * @param {[number, number]} window - window.
 * @returns {Promise<any>} - Result.
 */
export async function query(resource_id, partition, window) {
  return (await getTable()).query(resource_id, partition, window);
}

/**
 * @param {string} resource_id - resource_id.
 * @returns {Promise<any>} - Result.
 */
export async function delete_records(resource_id) {
  return (await getTable()).delete_records(resource_id);
}

/**
 *
 * @returns {void} - Result.
 */
export function __setMockState() {
  _tables.clear();
  resetDB();
}
