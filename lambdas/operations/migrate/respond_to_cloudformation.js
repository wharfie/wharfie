'use strict';

const logging = require('../../lib/logging');
const response = require('../../lib/cloudformation/cfn-response');
const { getImmutableID } = require('../../lib/cloudformation/id');
const { Operation, Resource } = require('../../lib/graph/');

const resource_db = require('../../lib/dynamo/operations');
const semaphore_db = require('../../lib/dynamo/semaphore');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info('deleting migration temporary resources');

  const deletes = [];
  const StackName = `migrate-${resource.id}`;
  const migrationResource = Resource.fromRecord(
    operation.operation_inputs.migration_resource
  );
  deletes.push(resource_db.deleteResource(migrationResource));
  deletes.push(semaphore_db.deleteSemaphore(`wharfie:BACKFILL:${StackName}`));
  deletes.push(semaphore_db.deleteSemaphore(`wharfie:LOAD:${StackName}`));
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
