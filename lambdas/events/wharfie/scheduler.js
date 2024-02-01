'use strict';

const dependency_db = require('../../lib/dynamo/dependency');
const resource_db = require('../../lib/dynamo/resource');
const event_db = require('../../lib/dynamo/event');
const SQS = require('../../lib/sqs');

const logging = require('../../lib/logging');
const daemon_log = logging.getDaemonLogger();

const sqs = new SQS({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';

/**
 * @param {import('../../typedefs').DependencyRecord} dependency_record -
 * @param {number[]} window -
 */
async function schedule_event(dependency_record, window) {
  const partition_prefix = 'unpartitioned';

  const now = Date.now();
  const interval = parseInt(dependency_record.interval);
  const ms = 1000 * interval; // convert s to ms
  const nowInterval = Math.round(now / ms) * ms;
  const [after, before] = window;
  const events = await event_db.query(
    dependency_record.resource_id,
    partition_prefix,
    [after, before]
  );
  if (
    events.filter((event) => event.status.toString() === 'scheduled').length > 0
  ) {
    // interval event queued no need to do work
    return;
  }
  if (
    events.filter((event) => event.status.toString() === 'started').length > 0
  ) {
    // interval event already started move onto next interval
    await schedule_event(dependency_record, [
      before,
      nowInterval + 1000 * interval,
    ]);
    return;
  }
  const item = {
    resource_id: dependency_record.resource_id,
    sort_key: `${partition_prefix}:${before}`,
    started_at: now,
    updated_at: now,
    status: 'scheduled',
    partition: {},
  };
  try {
    await event_db.schedule(item);
  } catch (error) {
    // @ts-ignore
    if (error && error.name === 'ConditionalCheckFailedException') {
      // to avoid scheduling duplicate events for a given interval
      daemon_log.debug(`interval already scheduled`);
      return;
    }
    throw error;
  }

  await sqs.sendMessage({
    MessageBody: JSON.stringify(item),
    QueueUrl: QUEUE_URL,
  });
}

/**
 * @param {import('../../typedefs').WharfieEventRecord} wharfieEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function run(wharfieEvent, context) {
  if (!wharfieEvent) {
    daemon_log.warn(
      `invalid wharfie status event ${JSON.stringify(
        wharfieEvent
      )}, ${JSON.stringify(context)}`
    );
    return;
  } else {
    daemon_log.debug(
      `wharfie status event ${JSON.stringify(wharfieEvent)}, ${JSON.stringify(
        context
      )}`
    );
  }

  // Find downstream resources
  const dependencies = await dependency_db.findDependencies(
    `${wharfieEvent.database_name}.${wharfieEvent.table_name}`
  );
  if (!dependencies) {
    daemon_log.debug(
      `no dependencies found for ${wharfieEvent.database_name}.${wharfieEvent.table_name}`
    );
    return;
  }
  while (dependencies.length > 0) {
    const dependency = dependencies.pop();
    if (!dependency) continue;
    const now = Date.now();
    const interval = parseInt(dependency.interval);
    const ms = 1000 * interval; // convert s to ms
    const nowInterval = Math.round(now / ms) * ms;
    const before = nowInterval - 1000 * interval;

    const resource = await resource_db.getResource(dependency.resource_id);
    // For each resource schedule an update
    if (!resource) {
      daemon_log.debug(
        `no resource found for ${wharfieEvent.database_name}.${wharfieEvent.table_name}`
      );
      continue;
    }
    await schedule_event(dependency, [before, nowInterval]);
  }
}

module.exports = {
  run,
};
