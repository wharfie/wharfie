import * as scheduler_db from '../lib/dynamo/scheduler.js';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import SQS from '../lib/sqs.js';
import SchedulerEntry, { Status } from './scheduler-entry.js';

import * as logging from '../lib/logging/index.js';

const sqs = new SQS({ region: process.env.AWS_REGION });
const daemon_log = logging.getDaemonLogger();

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';

/**
 * @typedef Partition
 * @property {string[]} parts -
 * @property {string} prefix -
 */

/**
 * @typedef ScheduleOptions
 * @property {string} resource_id -
 * @property {number} interval -
 * @property {number[]} window -
 * @property {Partition} [partition] -
 */
/**
 * @param {ScheduleOptions} options --
 */
async function schedule({ resource_id, interval, window, partition }) {
  const partition_prefix = partition?.parts.join('/') || 'unpartitioned';

  const now = Date.now();
  const ms = 1000 * interval; // convert s to ms
  const nowInterval = Math.round(now / ms) * ms;
  const [after, before] = window;
  /** @type {import('./scheduler-entry.js').default[]} */
  const events = await scheduler_db.query(resource_id, partition_prefix, [
    after,
    before,
  ]);
  if (events.filter((event) => event.status === Status.SCHEDULED).length > 0) {
    // interval event queued no need to do work
    return;
  }
  if (events.filter((event) => event.status === Status.STARTED).length > 0) {
    // interval event already started move onto next interval
    await schedule({
      resource_id,
      interval,
      window: [before, nowInterval + 1000 * interval],
      partition,
    });
    return;
  }
  const schedulerEntry = new SchedulerEntry({
    resource_id,
    sort_key: `${partition_prefix}:${before}`,
    partition:
      partition_prefix !== 'unpartitioned' && partition
        ? {
            location: `${partition.prefix}${partition_prefix}/`,
            partitionValues: partition.parts,
          }
        : undefined,
  });
  try {
    await scheduler_db.schedule(schedulerEntry);
  } catch (error) {
    if (error instanceof ConditionalCheckFailedException) {
      // to avoid scheduling duplicate events for a given interval
      daemon_log.debug(`interval already scheduled`);
      return;
    }
    throw error;
  }
  await sqs.sendMessage({
    MessageBody: JSON.stringify(schedulerEntry.toEvent()),
    QueueUrl: QUEUE_URL,
  });
}

export { schedule };
