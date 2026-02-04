import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

import { CONDITION_TYPE, KEY_TYPE } from '../../db/base.js';
import SchedulerEntry from '../../../scheduler/scheduler-entry.js';

/**
 * @typedef {import('../../db/base.js').DBClient} DBClient
 */

const TABLE_ENV_VAR = 'SCHEDULER_TABLE';

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';

const THREE_DAYS_IN_SECONDS = 60 * 60 * 24 * 3;

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
 * @param {string} propertyName - propertyName.
 * @param {string} propertyValue - propertyValue.
 * @returns {import('../../db/base.js').KeyCondition} - Result.
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
 * @returns {number} - Result.
 */
const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * @returns {Error} - Result.
 */
const conditionalFailed = () => {
  try {
    return new ConditionalCheckFailedException({
      message: 'ConditionalCheckFailedException',
      $metadata: {},
    });
  } catch {
    const err = new Error('ConditionalCheckFailedException');
    err.name = 'ConditionalCheckFailedException';
    return err;
  }
};

/**
 * @param {string} sortKey - sortKey.
 * @returns {number | null} - Result.
 */
const sortKeyToNumber = (sortKey) => {
  const idx = sortKey.indexOf(':');
  if (idx === -1) return null;
  const n = Number(sortKey.slice(idx + 1));
  return Number.isFinite(n) ? n : null;
};

/**
 * @typedef {Object} schedulerClient
 * @property {(schedulerEvent: SchedulerEntry) => Promise<void>} schedule - schedule.
 * @property {(schedulerEvent: SchedulerEntry, status: import('../../../scheduler/scheduler-entry.js').SchedulerEntryStatusEnum) => Promise<void>} update - update.
 * @property {(resource_id: string, partition: string, window: [number, number]) => Promise<SchedulerEntry[]>} query - query.
 * @property {(resource_id: string) => Promise<void>} delete_records - delete_records.
 */

/**
 * Factory: Scheduler table client.
 * @param {object} params - params.
 * @param {DBClient} params.db - params.db.
 * @param {string} [params.tableName] - params.tableName.
 * @returns {schedulerClient} - Result.
 */
export function createSchedulerTable({
  db,
  tableName = process.env[TABLE_ENV_VAR] || '',
}) {
  if (!db) throw new Error('createSchedulerTable requires a db client');

  /**
   * @param {SchedulerEntry} schedulerEvent - schedulerEvent.
   * @returns {Promise<void>} - Result.
   */
  async function schedule(schedulerEvent) {
    schedulerEvent.ttl = nowSeconds() + THREE_DAYS_IN_SECONDS;
    const record =
      typeof schedulerEvent?.toRecord === 'function'
        ? schedulerEvent.toRecord()
        : schedulerEvent;

    const existing = await db.get({
      tableName,
      keyName: KEY_NAME,
      keyValue: record.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: record.sort_key,
      consistentRead: true,
    });

    if (existing) throw conditionalFailed();

    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record,
    });
  }

  /**
   * @param {SchedulerEntry} schedulerEvent - schedulerEvent.
   * @param {import('../../../scheduler/scheduler-entry.js').SchedulerEntryStatusEnum} status - status.
   * @returns {Promise<void>} - Result.
   */
  async function update(schedulerEvent, status) {
    schedulerEvent.status = status;
    schedulerEvent.ttl = nowSeconds() + THREE_DAYS_IN_SECONDS;

    const record =
      typeof schedulerEvent?.toRecord === 'function'
        ? schedulerEvent.toRecord()
        : schedulerEvent;

    // Use update to preserve "overwrite" semantics across all DB adapters in tests.
    await db.update({
      tableName,
      keyName: KEY_NAME,
      keyValue: record.resource_id,
      sortKeyName: SORT_KEY_NAME,
      sortKeyValue: record.sort_key,
      updates: [
        { property: ['status'], propertyValue: record.status },
        { property: ['ttl'], propertyValue: record.ttl },
      ],
    });
  }

  /**
   * @param {string} resource_id - resource_id.
   * @param {string} partition - partition.
   * @param {[number, number]} window - window.
   * @returns {Promise<SchedulerEntry[]>} - Result.
   */
  async function query(resource_id, partition, window) {
    const [startBy, endBy] = window;

    const items =
      (await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          pkEq(KEY_NAME, resource_id),
          skBegins(SORT_KEY_NAME, `${partition}:`),
        ],
      })) || [];

    return items
      .filter((item) => {
        const n = sortKeyToNumber(item.sort_key);
        return n !== null && n >= startBy && n <= endBy;
      })
      .map((item) => SchedulerEntry.fromRecord(item));
  }

  /**
   * @param {string} resource_id - resource_id.
   * @returns {Promise<void>} - Result.
   */
  async function delete_records(resource_id) {
    const items =
      (await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [pkEq(KEY_NAME, resource_id)],
      })) || [];

    if (!items.length) return;

    await db.batchWrite({
      tableName,
      deleteRequests: items.map((item) => ({
        keyName: KEY_NAME,
        keyValue: item.resource_id,
        sortKeyName: SORT_KEY_NAME,
        sortKeyValue: item.sort_key,
      })),
      putRequests: [],
    });
  }

  return { schedule, update, query, delete_records };
}
