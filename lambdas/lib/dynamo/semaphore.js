import { createSemaphoreTable } from '../db/tables/semaphore.js';
import { getDB, resetDB } from './_shared.js';

/** @type {Map<string, ReturnType<typeof createSemaphoreTable>>} */
const _tables = new Map();

/**
 * @param {string} [tableName] -
 * @returns {Promise<ReturnType<typeof createSemaphoreTable>>} -
 */
async function getTable(tableName) {
  const key = tableName || '__default__';
  const existing = _tables.get(key);
  if (existing) return existing;

  const db = await getDB();
  const table = createSemaphoreTable({
    db,
    ...(tableName ? { tableName } : {}),
  });

  _tables.set(key, table);
  return table;
}

/**
 * @param {string} semaphore -
 * @param {number} [threshold] -
 */
export async function increase(semaphore, threshold) {
  return (await getTable()).increase(semaphore, threshold);
}

/**
 * @param {string} semaphore -
 */
export async function release(semaphore) {
  return (await getTable()).release(semaphore);
}

/**
 * @param {string} semaphore -
 */
export async function deleteSemaphore(semaphore) {
  return (await getTable()).deleteSemaphore(semaphore);
}

/**
 *
 */
export function __setMockState() {
  _tables.clear();
  resetDB();
}
