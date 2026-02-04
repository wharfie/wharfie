import { CONDITION_TYPE } from '../../db/base.js';

/**
 * @typedef {import('../../db/base.js').DBClient} DBClient
 */

const TABLE_ENV_VAR = 'SEMAPHORE_TABLE';
const KEY_NAME = 'semaphore';

/**
 * @param {unknown} error - error.
 * @returns {boolean} - Result.
 */
const isConditionalCheckFailed = (error) => {
  if (!(error instanceof Error)) return false;
  return (
    error.name === 'ConditionalCheckFailedException' ||
    error.message === 'ConditionalCheckFailedException'
  );
};

/**
 * @param {string} propertyName - propertyName.
 * @param {any} propertyValue - propertyValue.
 * @returns {import('../../db/base.js').KeyCondition} - Result.
 */
function eq(propertyName, propertyValue) {
  return {
    conditionType: CONDITION_TYPE.EQUALS,
    propertyName,
    propertyValue,
  };
}

/**
 * @param {any} value - value.
 * @param {number} [fallback] - fallback.
 * @returns {number} - Result.
 */
const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * @typedef {Object} semaphoreClient
 * @property {(semaphore: string, threshold?: number) => Promise<boolean>} increase - increase.
 * @property {(semaphore: string) => Promise<void>} release - release.
 * @property {(semaphore: string) => Promise<void>} deleteSemaphore - deleteSemaphore.
 */

/**
 * Factory: Semaphore table client.
 * @param {object} params - params.
 * @param {DBClient} params.db - params.db.
 * @param {string} [params.tableName] - params.tableName.
 * @returns {semaphoreClient} - Result.
 */
export function createSemaphoreTable({
  db,
  tableName = process.env[TABLE_ENV_VAR] || '',
}) {
  if (!db) throw new Error('createSemaphoreTable requires a db client');

  /**
   * @param {string} semaphore - semaphore.
   * @returns {Promise<import('../../db/base.js').DBRecord | void>} - Result.
   */
  const getRecord = async (semaphore) =>
    db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: semaphore,
      consistentRead: true,
    });

  /**
   * @param {string} semaphore - semaphore.
   * @param {number} [threshold] - threshold.
   * @returns {Promise<boolean>} - Result.
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
          conditions: [eq('value', currentValue)],
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
   * @param {string} semaphore - semaphore.
   * @returns {Promise<void>} - Result.
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
          conditions: [eq('value', currentValue)],
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
   * @param {string} semaphore - semaphore.
   * @returns {Promise<void>} - Result.
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
