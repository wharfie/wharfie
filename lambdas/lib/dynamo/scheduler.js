import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

import { CONDITION_TYPE, KEY_TYPE } from '../db/base.js';
import SchedulerEntry from '../../scheduler/scheduler-entry.js';

/**
 * @typedef {import('../db/base.js').DBClient} DBClient
 */

const TABLE_ENV_VAR = 'SCHEDULER_TABLE';

const KEY_NAME = 'resource_id';
const SORT_KEY_NAME = 'sort_key';

const THREE_DAYS_IN_SECONDS = 60 * 60 * 24 * 3;

/**
 * @param {string} propertyName -
 * @param {string} propertyValue -
 * @returns {import('../db/base.js').KeyCondition} -
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
 * @param {string} propertyName -
 * @param {string} propertyValue -
 * @returns {import('../db/base.js').KeyCondition} -
 */
function skBegins(propertyName, propertyValue) {
  return {
    keyType: KEY_TYPE.SORT,
    conditionType: CONDITION_TYPE.BEGINS_WITH,
    propertyName,
    propertyValue,
  };
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

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
 * @typedef {Object} schedulerClient
 * @property {(schedulerEvent: SchedulerEntry) => void} schedule -
 * @property {(schedulerEvent: SchedulerEntry, status: import('../../scheduler/scheduler-entry.js').SchedulerEntryStatusEnum) => void} update -
 * @property {(resource_id: string, partition: string, window: [number, number]) => void} query -
 * @property {(resource_id: string) => void} delete_records -
 */

/**
 * Factory: Scheduler table client.
 * @param {object} params -
 * @param {DBClient} params.db -
 * @param {string} [params.tableName] -
 * @returns {schedulerClient} -
 */
export function createSchedulerTable({
  db,
  tableName = process.env[TABLE_ENV_VAR] || '',
}) {
  /**
   * @param {SchedulerEntry} schedulerEvent -
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
   * @param {SchedulerEntry} schedulerEvent -
   * @param {import('../../scheduler/scheduler-entry.js').SchedulerEntryStatusEnum} status -
   */
  async function update(schedulerEvent, status) {
    schedulerEvent.status = status;
    schedulerEvent.ttl = nowSeconds() + THREE_DAYS_IN_SECONDS;

    const record =
      typeof schedulerEvent?.toRecord === 'function'
        ? schedulerEvent.toRecord()
        : schedulerEvent;

    await db.put({
      tableName,
      keyName: KEY_NAME,
      sortKeyName: SORT_KEY_NAME,
      record,
    });
  }

  /**
   * @param {string} resource_id -
   * @param {string} partition -
   * @param {[number, number]} window -
   * @returns {Promise<SchedulerEntry[]>} -
   */
  async function query(resource_id, partition, window) {
    const [start_by, end_by] = window;
    const startKey = `${partition}:${start_by}`;
    const endKey = `${partition}:${end_by}`;

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
      .filter((item) => item.sort_key >= startKey && item.sort_key <= endKey)
      .map((item) => SchedulerEntry.fromRecord(item));
  }

  /**
   * @param {string} resource_id -
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
    });
  }

  return { schedule, update, query, delete_records };
}
