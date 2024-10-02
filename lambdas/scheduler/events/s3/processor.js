'use strict';

const location_db = require('../../../lib/dynamo/location');
const resource_db = require('../../../lib/dynamo/operations');
const { schedule } = require('../../schedule');

const logging = require('../../../lib/logging');
const daemon_log = logging.getDaemonLogger();

/**
 * @typedef ScheduleRunParams
 * @property {string} bucket -
 * @property {string} key -
 */

/**
 * @param {ScheduleRunParams} params -
 * @param {import('aws-lambda').Context} context -
 */
async function run({ bucket, key }, context) {
  if (!bucket || !key) {
    throw new Error('missing required params');
  } else {
    daemon_log.debug(
      `s3 event for location ${key} in bucket ${bucket}, ${JSON.stringify(
        context
      )}`
    );
  }

  // ignores kinesis firehose's failure prefix
  if (key.includes('processing_failed/')) return;

  // fix for manual partition values
  key = decodeURIComponent(key);
  bucket = decodeURIComponent(bucket);

  const location_records = await location_db.findLocations(
    `s3://${bucket}/${key}`
  );

  if (!location_records || location_records.length === 0) {
    daemon_log.info(`MISSING LOCATION RECORD: ${`s3://${bucket}/${key}`}`);
    return;
  }

  while (location_records.length > 0) {
    const location_record = location_records.splice(0, 1)[0];
    const partitionFile = `s3://${bucket}/${key}`
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
    const isView = resource.source_properties.tableType === 'VIRTUAL_VIEW';
    const partitionKeys = resource.destination_properties?.partitionKeys || [];
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
        daemon_log.debug(`invalid location ${partitionFile}`);
        return;
      }
    }

    await schedule({
      resource_id: location_record.resource_id,
      interval: parseInt(location_record.interval),
      window: [before, nowInterval],
      partition: {
        prefix: location_record.location,
        parts: partition_parts,
      },
    });
  }
}

module.exports = {
  run,
};
