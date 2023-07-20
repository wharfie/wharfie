'use strict';

const location_db = require('../../lib/dynamo/location');
const resource_db = require('../../lib/dynamo/resource');
const event_db = require('../../lib/dynamo/event');
const SQS = require('../../lib/sqs');

const sqs = new SQS({ region: process.env.AWS_REGION });

const logging = require('../../lib/logging');
const daemon_log = logging.getDaemonLogger();

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';

/**
 * @param {import('../../typedefs').LocationRecord} location_record -
 * @param {string[]} partition_parts -
 * @param {number[]} window -
 */
async function schedule_event(location_record, partition_parts, window) {
  const partition_prefix = partition_parts.join('/');

  const now = Date.now();
  const interval = parseInt(location_record.interval);
  const ms = 1000 * interval; // convert s to ms
  const nowInterval = Math.round(now / ms) * ms;
  const [after, before] = window;

  const events = await event_db.query(
    location_record.resource_id,
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
    await schedule_event(location_record, partition_parts, [
      before,
      nowInterval + 1000 * interval,
    ]);
    return;
  }
  const item = {
    resource_id: location_record.resource_id,
    sort_key: `${partition_prefix}:${before}`,
    started_at: now,
    updated_at: now,
    status: 'scheduled',
    partition:
      partition_prefix !== 'unpartitioned'
        ? {
            location: `${location_record.location}${partition_prefix}/`,
            partitionValues: partition_parts,
          }
        : {},
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
 * @param {import('../../typedefs').S3EventRecord} s3Event -
 * @param {import('aws-lambda').Context} context -
 */
async function run(s3Event, context) {
  if (
    !s3Event.s3 ||
    !s3Event.s3.bucket ||
    !s3Event.s3.bucket.name ||
    !s3Event.s3.object ||
    !s3Event.s3.object.key
  ) {
    daemon_log.info(
      `invalid s3 event ${JSON.stringify(s3Event)}, ${JSON.stringify(context)}`
    );
    return;
  } else {
    daemon_log.debug(
      `s3 event ${JSON.stringify(s3Event)}, ${JSON.stringify(context)}`
    );
  }

  // ignores kinesis firehose's failure prefix
  if (s3Event.s3.object.key.includes('processing_failed/')) return;

  // fix for manual partition values
  s3Event.s3.object.key = s3Event.s3.object.key.replace('%3D', '=');

  const location_records = await location_db.findLocations(
    `s3://${s3Event.s3.bucket.name}/${s3Event.s3.object.key}`
  );

  if (!location_records || location_records.length === 0) {
    daemon_log.info(
      `MISSING LOCATION RECORD: ${`s3://${s3Event.s3.bucket.name}/${s3Event.s3.object.key}`}`
    );
    return;
  }

  while (location_records.length > 0) {
    const location_record = location_records.splice(0, 1)[0];
    const partitionFile =
      `s3://${s3Event.s3.bucket.name}/${s3Event.s3.object.key}`
        .replace(location_record.location, '')
        .split('/');

    const now = Date.now();
    const interval = parseInt(location_record.interval);
    const ms = 1000 * interval; // convert s to ms
    const nowInterval = Math.round(now / ms) * ms;
    const before = nowInterval - 1000 * interval;

    const resource = await resource_db.getResource(location_record.resource_id);
    if (!resource) {
      daemon_log.warn('resource unexpectedly missing, maybe it was deleted?');
      return;
    }
    const isView =
      resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW';
    const partitionKeys =
      resource.destination_properties?.TableInput?.PartitionKeys || [];
    const isPartitioned = partitionKeys.length > 0;
    let partition_parts = ['unpartitioned'];
    if (isPartitioned && !isView) {
      partition_parts = partitionFile.splice(0, partitionFile.length - 1);
      const partition_parts_filtered = partition_parts.filter(
        (/** @type {string} */ value) => value.includes('=')
      );
      if (partition_parts_filtered.length > 0)
        partition_parts = partition_parts_filtered;
      if (partitionKeys.length !== partition_parts.length) {
        // invalid location
        return;
      }
    }

    await schedule_event(location_record, partition_parts, [
      before,
      nowInterval,
    ]);
  }
}

module.exports = {
  run,
};
