import SQS from '../../lib/sqs.js';
import * as logging from '../../lib/logging/index.js';
import { Operation, Resource } from '../../lib/graph/index.js';
import WharfieOperationCompleted from '../../scheduler/events/wharfie-operation-completed.js';

const wharfie_db_log = logging.getWharfieDBLogger();
const sqs = new SQS({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.EVENTS_QUEUE_URL || '';
/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
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
    MessageBody: new WharfieOperationCompleted({
      resource_id: resource.id,
      operation_id: operation.id,
    }).serialize(),
    QueueUrl: QUEUE_URL,
  });
  return {
    status: 'COMPLETED',
  };
}

export default wharfie;
