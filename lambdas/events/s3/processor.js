'use strict';
const SQS = require('../../lib/sqs');

const sqs = new SQS({ region: process.env.AWS_REGION });

const event_db = require('../../lib/dynamo/event');
const resource_db = require('../../lib/dynamo/resource');
const logging = require('../../lib/logging/');
const daemon_log = logging.getDaemonLogger();

const DAEMON_QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';
const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';

/**
 * @param {import('../../typedefs').ScheduledEventRecord} ScheduledEventRecord -
 * @param {import('aws-lambda').Context} context -
 */
async function run(ScheduledEventRecord, context) {
  daemon_log.debug(
    `scheduled event record ${JSON.stringify(
      ScheduledEventRecord
    )}, ${JSON.stringify(context)}`
  );
  const start_time = Number(ScheduledEventRecord.sort_key.split(':')[1] || 0);
  if (Date.now() < start_time) {
    daemon_log.debug('event not ready to start');
    await sqs.sendMessage({
      MessageBody: JSON.stringify(ScheduledEventRecord),
      QueueUrl: QUEUE_URL,
      DelaySeconds: Math.floor(Math.random() * 30 + 1),
    });
    return;
  }
  const resource = await resource_db.getResource(
    ScheduledEventRecord.resource_id
  );
  if (!resource) {
    daemon_log.warn('resource unexpectedly missing, maybe it was deleted?');
    return;
  }

  const isView =
    resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW';

  const isPartitioned =
    (resource.destination_properties?.TableInput?.PartitionKeys || []).length >
    0;
  let wharfieEvent;
  if (isView || !isPartitioned) {
    wharfieEvent = {
      source: 'wharfie:s3-event-processor',
      operation_started_at: new Date(Date.now()),
      operation_type: 'MAINTAIN',
      action_type: 'START',
      resource_id: resource.resource_id,
    };
  } else {
    /** @type {import('../../typedefs').PartitionValues} */
    const partitionValues = {};
    if (
      ScheduledEventRecord.partition.partitionValues.filter(
        (/** @type {string} */ value) => value.includes('=')
      ).length === ScheduledEventRecord.partition.partitionValues.length
    ) {
      (resource.destination_properties?.TableInput?.PartitionKeys || [])
        .slice()
        .reverse()
        .forEach(
          (/** @type {any} */ partitionKey, /** @type {number} */ index) => {
            const partitionValue =
              ScheduledEventRecord.partition.partitionValues[
                resource.destination_properties.TableInput.PartitionKeys
                  .length -
                  1 -
                  index
              ]
                .replace(`${partitionKey.Name}=`, '')
                .replace(`${partitionKey.Name}%3D`, '');

            if (
              [
                'bigint',
                'smallint',
                'float',
                'double',
                'integer',
                'int',
              ].includes(partitionKey.Type)
            ) {
              partitionValues[partitionKey.Name] = Number(partitionValue);
            } else {
              partitionValues[partitionKey.Name] = partitionValue;
            }
          }
        );
    } else {
      (resource.destination_properties?.TableInput?.PartitionKeys || [])
        .slice()
        .reverse()
        .forEach(
          (/** @type {any} */ partitionKey, /** @type {number} */ index) => {
            const partitionValue =
              ScheduledEventRecord.partition.partitionValues[
                resource.destination_properties.TableInput.PartitionKeys
                  .length -
                  1 -
                  index
              ];

            if (
              [
                'bigint',
                'smallint',
                'float',
                'double',
                'integer',
                'int',
              ].includes(partitionKey.Type)
            ) {
              partitionValues[partitionKey.Name] = Number(partitionValue);
            } else {
              partitionValues[partitionKey.Name] = partitionValue;
            }
          }
        );
    }

    const hasPartitions =
      resource.destination_properties?.TableInput?.PartitionKeys?.length > 0;

    wharfieEvent = {
      source: 'wharfie:s3-event-processor',
      operation_started_at: new Date(Date.now()),
      operation_type: 'S3_EVENT',
      action_type: 'START',
      resource_id: ScheduledEventRecord.resource_id,
      operation_inputs: hasPartitions
        ? {
            partition: {
              ...ScheduledEventRecord.partition,
              partitionValues,
            },
          }
        : {},
    };
  }

  await sqs.sendMessage({
    MessageBody: JSON.stringify(wharfieEvent),
    QueueUrl: DAEMON_QUEUE_URL,
  });

  await event_db.update(ScheduledEventRecord, 'started');
}

module.exports = {
  run,
};
