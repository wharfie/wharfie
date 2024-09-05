'use strict';

const logging = require('../../lib/logging');
const response = require('../../lib/cloudformation/cfn-response');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');

const resource_db = require('../../lib/dynamo/operations');
const sempahore_db = require('../../lib/dynamo/semaphore');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const region = resource.region;
  const cloudformation = new CloudFormation({ region });
  const event_log = logging.getEventLogger(event, context);
  event_log.info('deleting migration temporary resources');

  const deletes = [];
  const StackName = `migrate-${resource.resource_id}`;
  deletes.push(resource_db.deleteResource(StackName));
  deletes.push(
    cloudformation.deleteStack({
      StackName,
    })
  );
  deletes.push(sempahore_db.deleteSemaphore(`wharfie:MAINTAIN:${StackName}`));
  deletes.push(sempahore_db.deleteSemaphore(`wharfie:BACKFILL:${StackName}`));
  const results = await Promise.allSettled(deletes);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      throw new Error(`failed to delete resource: ${result.reason}`);
    }
  });

  event_log.info('replying to cloudformation');

  await response(null, operation.operation_inputs.cloudformation_event, {
    id: getImmutableID(operation.operation_inputs.cloudformation_event),
  });

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
