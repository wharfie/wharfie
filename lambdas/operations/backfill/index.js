'use strict';

const { Action, OperationActionGraph } = require('../../lib/graph/');
const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/resource');
const register_missing_partitions = require('../actions/register_missing_partitions');
const find_compaction_partitions = require('../actions/find_compaction_partitions');
const run_compaction = require('../actions/run_compaction');
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
  if (
    !event.operation_id ||
    !event.action_id ||
    !event.action_inputs ||
    !event.operation_started_at
  )
    throw new Error('Event missing fields');

  const action_graph = new OperationActionGraph();
  const start_action = new Action({
    type: 'START',
    id: event.action_id,
  });
  const register_missing_partitions_action = new Action({
    type: 'REGISTER_MISSING_PARTITIONS',
  });
  const find_compaction_partitions_action = new Action({
    type: 'FIND_COMPACTION_PARTITIONS',
  });
  const run_compaction_action = new Action({
    type: 'RUN_COMPACTION',
  });
  const update_symlinks_action = new Action({
    type: 'UPDATE_SYMLINKS',
  });
  const finish_action = new Action({
    type: 'FINISH',
  });
  action_graph.addActions([
    start_action,
    register_missing_partitions_action,
    find_compaction_partitions_action,
    run_compaction_action,
    update_symlinks_action,
    finish_action,
  ]);
  action_graph.addDependency(start_action, register_missing_partitions_action);
  action_graph.addDependency(
    register_missing_partitions_action,
    find_compaction_partitions_action
  );
  action_graph.addDependency(
    find_compaction_partitions_action,
    run_compaction_action
  );
  action_graph.addDependency(run_compaction_action, update_symlinks_action);
  action_graph.addDependency(update_symlinks_action, finish_action);

  event_log.info('action graph generating');

  const action_records = action_graph.getActions().map((action) => ({
    action_id: action.id,
    action_type: action.type,
    action_status: 'PENDING',
  }));

  event_log.info('creating BACKFILL operation and actions...');
  /** @type {import('../../typedefs').OperationRecord} */
  const operation = {
    resource_id: resource.resource_id,
    operation_id: event.operation_id,
    operation_type: event.operation_type,
    operation_status: 'RUNNING',
    started_at: Date.parse(event.operation_started_at) / 1000,
    last_updated_at: Date.parse(event.operation_started_at) / 1000,
    operation_config: event.action_inputs,
    action_graph,
    actions: action_records,
  };
  await resource_db.createOperation(operation);
  event_log.info('BACKFILL started.');

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
    case 'REGISTER_MISSING_PARTITIONS':
      return await register_missing_partitions.run(event, context, resource);
    case 'FIND_COMPACTION_PARTITIONS':
      return await find_compaction_partitions.run(
        event,
        context,
        resource,
        operation
      );
    case 'RUN_COMPACTION':
      return await run_compaction.run(event, context, resource, operation);
    case 'UPDATE_SYMLINKS':
      return await update_symlinks.run(event, context, resource, operation);
    case 'SIDE_EFFECT__CLOUDWATCH':
      return await side_effects.cloudwatch(event, context, resource, operation);
    case 'SIDE_EFFECT__WHARFIE':
      return await side_effects.wharfie(event, context, resource, operation);
    case 'SIDE_EFFECT__DAGSTER':
      return await side_effects.dagster(event, context, resource, operation);
    default:
      throw new Error('Invalid Action, must be valid MAINTAIN action');
  }
}

module.exports = {
  start,
  finish,
  route,
};
