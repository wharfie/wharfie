'use strict';

const SQS = require('../../lib/sqs');
const logging = require('../../lib/logging');
const { Operation, Resource } = require('../../lib/graph/');
const WharfieEvent = require('../../events/wharfie');

const wharfie_db_log = logging.getWharfieDBLogger();
const sqs = new SQS({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';
/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function wharfie(event, context, resource, operation) {
  const { completed_at } = event.action_inputs;
  if (!completed_at)
    throw new Error('missing required action inputs for wharfie side effect');
  wharfie_db_log.info('wharfie', {
    resource,
    operation,
    completed_at,
  });
  await sqs.sendMessage({
    MessageBody: new WharfieEvent({
      type: WharfieEvent.Type['WHARFIE:OPERATION:COMPLETED'],
      resource_id: resource.id,
      data: {
        database_name: resource.destination_properties.databaseName,
        table_name: resource.destination_properties.name,
        operation_type: operation.type,
      },
    }).serialize(),
    QueueUrl: QUEUE_URL,
  });
  return {
    status: 'COMPLETED',
  };
}

module.exports = wharfie;
