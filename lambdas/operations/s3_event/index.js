'use strict';

const { Action, OperationActionGraph } = require('../../lib/graph/');
const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/operations');
const register_partition = require('../actions/register_partition');
const run_single_compaction = require('../actions/run_single_compaction');
const update_symlinks = require('../actions/update_symlinks');
const side_effects = require('../side_effects');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function start(event, context, resource) {
  const event_log = logging.getEventLogger(event, context);
  if (!event.operation_id || !event.action_id || !event.operation_started_at)
    throw new Error('Event missing fields');

  const action_graph = new OperationActionGraph();
  const start_action = new Action({
    type: Action.Type.START,
    id: event.action_id,
  });
  const register_partition_action = new Action({
    type: Action.Type.REGISTER_PARTITION,
  });
  const find_single_compaction_action = new Action({
    type: Action.Type.RUN_SINGLE_COMPACTION,
  });
  const update_symlinks_action = new Action({
    type: Action.Type.UPDATE_SYMLINKS,
  });
  const finish_action = new Action({
    type: Action.Type.FINISH,
  });
  const side_effect__cloudwatch = new Action({
    type: Action.Type.SIDE_EFFECT__CLOUDWATCH,
  });
  const side_effect__dagster = new Action({
    type: Action.Type.SIDE_EFFECT__DAGSTER,
  });
  const side_effect__wharfie = new Action({
    type: Action.Type.SIDE_EFFECT__WHARFIE,
  });
  const side_effects_finish_action = new Action({
    type: Action.Type.SIDE_EFFECTS__FINISH,
  });
  action_graph.addActions([
    start_action,
    register_partition_action,
    find_single_compaction_action,
    update_symlinks_action,
    finish_action,
    side_effect__cloudwatch,
    side_effect__dagster,
    side_effect__wharfie,
    side_effects_finish_action,
  ]);
  action_graph.addDependency(start_action, register_partition_action);
  action_graph.addDependency(
    register_partition_action,
    find_single_compaction_action
  );
  action_graph.addDependency(
    find_single_compaction_action,
    update_symlinks_action
  );
  action_graph.addDependency(update_symlinks_action, finish_action);
  action_graph.addDependency(finish_action, side_effect__cloudwatch);
  action_graph.addDependency(finish_action, side_effect__dagster);
  action_graph.addDependency(finish_action, side_effect__wharfie);
  action_graph.addDependency(
    side_effect__cloudwatch,
    side_effects_finish_action
  );
  action_graph.addDependency(side_effect__dagster, side_effects_finish_action);
  action_graph.addDependency(side_effect__wharfie, side_effects_finish_action);

  event_log.info('action graph generating');

  const action_records = action_graph.getActions().map((action) => ({
    action_id: action.id,
    action_type: action.type,
    action_status: 'PENDING',
  }));

  /** @type {import('../../typedefs').OperationRecord} */
  const operation = {
    resource_id: resource.resource_id,
    operation_id: event.operation_id,
    operation_type: event.operation_type,
    operation_inputs: event.operation_inputs,
    operation_status: 'RUNNING',
    started_at: Date.parse(event.operation_started_at) / 1000,
    last_updated_at: Date.parse(event.operation_started_at) / 1000,
    action_graph,
    actions: action_records,
  };
  event_log.info('creating S3_EVENT operation and actions...');
  await resource_db.createOperation(operation);

  event_log.info('operation records created');
  return {
    status: 'COMPLETED',
  };
}

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function finish(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info(`marking as complete`);

  const completed_at = Math.floor(Date.now() / 1000);
  await resource_db.createOperation({
    ...operation,
    last_updated_at: completed_at,
    operation_status: 'COMPLETED',
  });

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
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function route(event, context, resource, operation) {
  switch (event.action_type) {
    case 'REGISTER_PARTITION':
      return await register_partition.run(event, context, resource, operation);
    case 'RUN_SINGLE_COMPACTION':
      return await run_single_compaction.run(
        event,
        context,
        resource,
        operation
      );
    case 'UPDATE_SYMLINKS':
      return await update_symlinks.run(event, context, resource, operation);
    case 'SIDE_EFFECT__CLOUDWATCH':
      return await side_effects.cloudwatch(event, context, resource, operation);
    case 'SIDE_EFFECT__WHARFIE':
      return await side_effects.wharfie(event, context, resource, operation);
    case 'SIDE_EFFECT__DAGSTER':
      return await side_effects.dagster(event, context, resource, operation);
    case 'SIDE_EFFECTS__FINISH':
      return await side_effects.finish(event, context, resource, operation);
    default:
      throw new Error('Invalid Action, must be valid S3_EVENT action');
  }
}

module.exports = {
  start,
  finish,
  route,
};
