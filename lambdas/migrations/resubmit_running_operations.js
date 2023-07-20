'use strict';

const {
  getRecords,
  deleteOperation,
} = require('../../lambdas/lib/dynamo/resource');
const SQS = require('../../lambdas/lib/sqs');
const sqs = new SQS({ region: process.env.AWS_REGION });
const DAEMON_QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';

/**
 * @param {string} resource_id -
 */
async function resubmit_running_operations(resource_id) {
  const records = await getRecords(resource_id);
  const operations_to_remove = records.operations;
  while (operations_to_remove.length > 0) {
    const operationChunk = operations_to_remove.splice(0, 10);
    await Promise.all(
      operationChunk.map(
        (/** @type {import('../typedefs').OperationRecord} */ operation) =>
          Promise.all([
            deleteOperation(operation.resource_id, operation.operation_id),
            sqs.sendMessage({
              MessageBody: JSON.stringify({
                operation_type: operation.operation_type,
                action_type: 'START',
                resource_id,
                operation_started_at: new Date(
                  operation.started_at * 1000
                ).toISOString(),
                action_inputs: operation.operation_config,
              }),
              QueueUrl: DAEMON_QUEUE_URL,
            }),
          ])
      )
    );
  }
}
module.exports = {
  resubmit_running_operations,
};
