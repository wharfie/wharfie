'use strict';
const SQS = require('../lib/sqs');

const sqs = new SQS({ region: process.env.AWS_REGION });

const scheduler_db = require('../lib/dynamo/scheduler');
const resource_db = require('../lib/dynamo/operations');
const logging = require('../lib/logging');
const SchedulerEntry = require('./scheduler-entry');
const daemon_log = logging.getDaemonLogger();

const DAEMON_QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';
const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';

/**
 * @param {SchedulerEntry} ScheduledEvent -
 * @param {import('aws-lambda').Context} context -
 */
async function run(ScheduledEvent, context) {
  daemon_log.debug(
    `scheduled event record ${JSON.stringify(ScheduledEvent)}, ${JSON.stringify(
      context
    )}`
  );
  const start_time = Number(ScheduledEvent.sort_key.split(':')[1] || 0);
  if (Date.now() < start_time) {
    daemon_log.debug('event not ready to start');
    await sqs.sendMessage({
      MessageBody: ScheduledEvent.toEvent(),
      QueueUrl: QUEUE_URL,
      DelaySeconds: Math.floor(Math.random() * 30 + 1),
    });
    return;
  }
  const resource = await resource_db.getResource(ScheduledEvent.resource_id);
  if (!resource) {
    daemon_log.warn('resource unexpectedly missing, maybe it was deleted?');
    return;
  }

  const isView = resource.source_properties.tableType === 'VIRTUAL_VIEW';

  const isPartitioned =
    (resource.destination_properties?.partitionKeys || []).length > 0;
  let wharfieEvent;
  if (isView || !isPartitioned) {
    wharfieEvent = {
      source: 'wharfie:scheduler',
      operation_started_at: new Date(Date.now()),
      operation_type: 'BACKFILL',
      action_type: 'START',
      resource_id: resource.id,
    };
  } else {
    /** @type {import('../typedefs').PartitionValues} */
    const partitionValues = {};
    if (
      ScheduledEvent?.partition?.partitionValues.filter(
        (/** @type {string} */ value) => value.includes('=')
      ).length === ScheduledEvent?.partition?.partitionValues.length
    ) {
      (resource.destination_properties?.partitionKeys || [])
        .slice()
        .reverse()
        .forEach(
          (/** @type {any} */ partitionKey, /** @type {number} */ index) => {
            const partitionValue = ScheduledEvent?.partition?.partitionValues[
              (resource.destination_properties?.partitionKeys || []).length -
                1 -
                index
            ]
              .replace(`${partitionKey.name}=`, '')
              .replace(`${partitionKey.name}%3D`, '');

            if (
              [
                'bigint',
                'smallint',
                'float',
                'double',
                'integer',
                'int',
              ].includes(partitionKey.type)
            ) {
              partitionValues[partitionKey.name] = Number(partitionValue);
            } else if (partitionValue) {
              partitionValues[partitionKey.name] = partitionValue;
            } else {
              daemon_log.warn(`undefined partition value ${ScheduledEvent}`);
              partitionValues[partitionKey.name] = '';
            }
          }
        );
    } else {
      (resource.destination_properties?.partitionKeys || [])
        .slice()
        .reverse()
        .forEach(
          (/** @type {any} */ partitionKey, /** @type {number} */ index) => {
            const partitionValue =
              ScheduledEvent?.partition?.partitionValues[
                (resource.destination_properties?.partitionKeys || []).length -
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
              ].includes(partitionKey.type)
            ) {
              partitionValues[partitionKey.name] = Number(partitionValue);
            } else if (partitionValue) {
              partitionValues[partitionKey.name] = partitionValue;
            } else {
              daemon_log.warn(`undefined partition value ${ScheduledEvent}`);
              partitionValues[partitionKey.name] = '';
            }
          }
        );
    }

    const hasPartitions =
      (resource.destination_properties?.partitionKeys || []).length > 0;

    wharfieEvent = {
      source: 'wharfie:scheduler',
      operation_started_at: new Date(Date.now()),
      operation_type: 'LOAD',
      action_type: 'START',
      resource_id: ScheduledEvent.resource_id,
      operation_inputs: hasPartitions
        ? {
            partition: {
              ...ScheduledEvent.partition,
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

  await scheduler_db.update(ScheduledEvent, SchedulerEntry.Status.STARTED);
}

module.exports = {
  run,
};
