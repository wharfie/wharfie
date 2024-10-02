'use strict';

const { Action, Operation, Resource } = require('../../lib/graph/');
const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/operations');
const register_missing_partitions = require('../actions/register_missing_partitions');
const find_compaction_partitions = require('../actions/find_compaction_partitions');
const run_compaction = require('../actions/run_compaction');
const update_symlinks = require('../actions/update_symlinks');
const swap_resource = require('./swap_resource');
const respond_to_cloudformation = require('./respond_to_cloudformation');
const side_effects = require('../side_effects');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function start(event, context, resource) {
  const event_log = logging.getEventLogger(event, context);
  if (!event.operation_id || !event.action_id || !event.operation_started_at)
    throw new Error('Event missing fields');

  event_log.info('action graph generating');
  const operation = new Operation({
    resource_id: resource.id,
    id: event.operation_id,
    type: event.operation_type,
    status: Operation.Status.RUNNING,
    started_at: Date.parse(event.operation_started_at) / 1000,
    operation_inputs: event.operation_inputs,
  });
  const start_action = operation.createAction({
    type: Action.Type.START,
    id: event.action_id,
  });
  const register_missing_partitions_action = operation.createAction({
    type: Action.Type.REGISTER_MISSING_PARTITIONS,
    dependsOn: [start_action],
  });
  const find_compaction_partitions_action = operation.createAction({
    type: Action.Type.FIND_COMPACTION_PARTITIONS,
    dependsOn: [register_missing_partitions_action],
  });
  const run_compaction_action = operation.createAction({
    type: Action.Type.RUN_COMPACTION,
    dependsOn: [find_compaction_partitions_action],
  });
  const update_symlinks_action = operation.createAction({
    type: Action.Type.UPDATE_SYMLINKS,
    dependsOn: [run_compaction_action],
  });
  const swap_resource_action = operation.createAction({
    type: Action.Type.SWAP_RESOURCE,
    dependsOn: [update_symlinks_action],
  });
  const respond_to_cloudformation_action = operation.createAction({
    type: Action.Type.RESPOND_TO_CLOUDFORMATION,
    dependsOn: [swap_resource_action],
  });
  const finish_action = operation.createAction({
    type: Action.Type.FINISH,
    dependsOn: [respond_to_cloudformation_action],
  });
  const side_effect__cloudwatch = operation.createAction({
    type: Action.Type.SIDE_EFFECT__CLOUDWATCH,
    dependsOn: [finish_action],
  });
  const side_effect__dagster = operation.createAction({
    type: Action.Type.SIDE_EFFECT__DAGSTER,
    dependsOn: [finish_action],
  });
  const side_effect__wharfie = operation.createAction({
    type: Action.Type.SIDE_EFFECT__WHARFIE,
    dependsOn: [finish_action],
  });
  operation.createAction({
    type: Action.Type.SIDE_EFFECTS__FINISH,
    dependsOn: [
      side_effect__cloudwatch,
      side_effect__dagster,
      side_effect__wharfie,
    ],
  });

  event_log.info('creating MIGRATE operation and actions...');
  await resource_db.putOperation(operation);

  event_log.info('MIGRATE started.');

  return {
    status: 'COMPLETED',
  };
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function finish(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info(`marking MIGRATE as complete`);

  const completed_at = Math.floor(Date.now() / 1000);
  operation.last_updated_at = completed_at;
  operation.status = Operation.Status.COMPLETED;

  await resource_db.putOperation(operation);

  return {
    status: 'COMPLETED',
    nextActionInputs: {
      completed_at,
    },
  };
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function route(event, context, resource, operation) {
  const migration_resource = Resource.fromRecord(
    operation.operation_inputs.migration_resource
  );
  switch (event.action_type) {
    case 'REGISTER_MISSING_PARTITIONS':
      return await register_missing_partitions.run(
        event,
        context,
        migration_resource
      );
    case 'FIND_COMPACTION_PARTITIONS':
      return await find_compaction_partitions.run(
        event,
        context,
        migration_resource,
        operation
      );
    case 'RUN_COMPACTION':
      return await run_compaction.run(
        event,
        context,
        migration_resource,
        operation
      );
    case 'UPDATE_SYMLINKS':
      return await update_symlinks.run(
        event,
        context,
        migration_resource,
        operation
      );
    case 'SWAP_RESOURCE':
      return await swap_resource.run(
        event,
        context,
        migration_resource,
        operation
      );
    case 'RESPOND_TO_CLOUDFORMATION':
      return await respond_to_cloudformation.run(
        event,
        context,
        resource,
        operation
      );
    case 'SIDE_EFFECT__CLOUDWATCH':
      return await side_effects.cloudwatch(event, context, resource, operation);
    case 'SIDE_EFFECT__WHARFIE':
      return await side_effects.wharfie(event, context, resource, operation);
    case 'SIDE_EFFECT__DAGSTER':
      return await side_effects.dagster(event, context, resource, operation);
    case 'SIDE_EFFECTS__FINISH':
      return await side_effects.finish(event, context, resource, operation);
    default:
      throw new Error('Invalid Action, must be valid MIGRATE action');
  }
}

module.exports = {
  start,
  finish,
  route,
};
