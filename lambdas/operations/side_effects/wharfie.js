'use strict';

const SQS = require('../../lib/sqs');
const logging = require('../../lib/logging');
const { version } = require('../../../package.json');

const wharfie_db_log = logging.getWharfieDBLogger();
const sqs = new SQS({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';
/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
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
    MessageBody: JSON.stringify({
      type: 'WHARFIE:OPERATION:COMPLETED',
      resource_id: resource.resource_id,
      database_name: resource.destination_properties.DatabaseName,
      table_name: resource.destination_properties.TableInput.Name,
      version,
    }),
    QueueUrl: QUEUE_URL,
  });
  return {
    status: 'COMPLETED',
  };
}

module.exports = wharfie;
