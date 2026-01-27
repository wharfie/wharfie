import { CONDITION_TYPE } from '../db/base.js';

/**
 * @typedef {import('../db/base.js').DBClient} DBClient
 */

const TABLE_ENV_VAR = 'SEMAPHORE_TABLE';
const KEY_NAME = 'semaphore';

const isConditionalCheckFailed = (/** @type {unknown} */ error) => {
  if (error instanceof Error) {
    return error?.name === 'ConditionalCheckFailedException';
  }
  return false;
};

/**
 * @param {string} propertyName -
 * @param {string} propertyValue -
 * @returns {import('../db/base.js').KeyCondition} -
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

const toNumber = (/** @type {any} */ value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * @typedef {Object} semaphoreClient
 * @property {(semaphore: string, threshold: number | undefined) => void} increase -
 * @property {(semaphore: string) => void} release -
 * @property {(semaphore: string) => void} deleteSemaphore -
 */

/**
 * Factory: Semaphore table client.
 * @param {object} params -
 * @param {DBClient} params.db -
 * @param {string} [params.tableName] -
 * @returns {semaphoreClient} -
 */
export function createSemaphoreTable({
  db,
  tableName = process.env[TABLE_ENV_VAR] || '',
}) {
  const getRecord = (/** @type {string} */ semaphore) =>
    db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: semaphore,
      consistentRead: true,
    });

  /**
   * @param {string} semaphore -
   * @param {number} [threshold] -
   * @returns {Promise<boolean>} -
   */
  async function increase(semaphore, threshold = 1) {
    const maxAttempts = 25;

    for (let i = 0; i < maxAttempts; i += 1) {
      const record = await getRecord(semaphore);
      const currentValue = toNumber(record?.value, 0);
      const limit =
        record?.limit === undefined ? undefined : toNumber(record?.limit, 0);

      const ceiling = typeof limit === 'number' ? limit : threshold;

      if (currentValue < 0) return false;
      if (currentValue >= ceiling) return false;

      const nextValue = currentValue + 1;

      if (!record) {
        await db.put({
          tableName,
          keyName: KEY_NAME,
          record: { semaphore, value: nextValue },
        });

        const afterPut = await getRecord(semaphore);
        return toNumber(afterPut?.value, 0) >= 1;
      }

      try {
        await db.update({
          tableName,
          keyName: KEY_NAME,
          keyValue: semaphore,
          updates: [{ property: ['value'], propertyValue: nextValue }],
          conditions: [eq('value', currentValue.toString())],
        });
      } catch (error) {
        if (isConditionalCheckFailed(error)) continue;
        throw error;
      }

      const after = await getRecord(semaphore);
      if (toNumber(after?.value, 0) === nextValue) return true;
    }

    return false;
  }

  /**
   * @param {string} semaphore -
   */
  async function release(semaphore) {
    const maxAttempts = 25;

    for (let i = 0; i < maxAttempts; i += 1) {
      const record = await getRecord(semaphore);
      const currentValue = toNumber(record?.value, 0);

      if (!record) return;
      if (currentValue <= 0) return;

      const nextValue = currentValue - 1;

      try {
        await db.update({
          tableName,
          keyName: KEY_NAME,
          keyValue: semaphore,
          updates: [{ property: ['value'], propertyValue: nextValue }],
          conditions: [eq('value', currentValue.toString())],
        });
      } catch (error) {
        if (isConditionalCheckFailed(error)) continue;
        throw error;
      }

      const after = await getRecord(semaphore);
      if (toNumber(after?.value, 0) === nextValue) return;
    }
  }

  /**
   * @param {string} semaphore -
   */
  async function deleteSemaphore(semaphore) {
    const record = await getRecord(semaphore);
    let value = toNumber(record?.value, 0);

    while (value > 0) {
      await release('wharfie');
      value -= 1;
    }

    await db.remove({
      tableName,
      keyName: KEY_NAME,
      keyValue: semaphore,
    });
  }

  return { increase, release, deleteSemaphore };
}
