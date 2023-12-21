'use strict';

const { Graph, alg } = require('graphlib');

const { createId } = require('../../lib/id');
const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/resource');
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

  const action_graph = new Graph();
  action_graph.setNode('START', event.action_id);
  action_graph.setNode('REGISTER_MISSING_PARTITIONS', createId());
  action_graph.setEdge('START', 'REGISTER_MISSING_PARTITIONS');

  action_graph.setNode('FIND_COMPACTION_PARTITIONS', createId());
  action_graph.setEdge(
    'REGISTER_MISSING_PARTITIONS',
    'FIND_COMPACTION_PARTITIONS'
  );

  action_graph.setNode('RUN_COMPACTION', createId());
  action_graph.setEdge('FIND_COMPACTION_PARTITIONS', 'RUN_COMPACTION');

  action_graph.setNode('UPDATE_SYMLINKS', createId());
  action_graph.setEdge('RUN_COMPACTION', 'UPDATE_SYMLINKS');

  action_graph.setNode('SWAP_RESOURCE', createId());
  action_graph.setEdge('UPDATE_SYMLINKS', 'SWAP_RESOURCE');

  action_graph.setNode('RESPOND_TO_CLOUDFORMATION', createId());
  action_graph.setEdge('SWAP_RESOURCE', 'RESPOND_TO_CLOUDFORMATION');

  action_graph.setNode('FINISH', createId());
  action_graph.setEdge('RESPOND_TO_CLOUDFORMATION', 'FINISH');

  if (!action_graph.isDirected() || !alg.isAcyclic(action_graph))
    throw Error('Invalid action_graph');

  event_log.info('action graph generating');

  const actions = action_graph.nodes().map((action_type) => {
    const action_id = action_graph.node(action_type);
    const action_status = 'WAITING';
    return {
      action_id,
      action_type,
      action_status,
      queries: [],
    };
  });

  event_log.info('creating MIGRATE operation and actions...');
  /** @type {import('../../typedefs').OperationRecord} */
  const operation = {
    resource_id: resource.resource_id,
    operation_id: event.operation_id,
    operation_type: event.operation_type,
    operation_status: 'RUNNING',
    started_at: Date.parse(event.operation_started_at) / 1000,
    last_updated_at: Date.parse(event.operation_started_at) / 1000,
    operation_inputs: event.operation_inputs,
    action_graph,
    actions,
  };
  await resource_db.createOperation(operation);
  event_log.info('MIGRATE started.');

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
  event_log.info(`marking MIGRATE as complete`);
  const completed_at = Math.floor(Date.now() / 1000);
  await resource_db.createOperation({
    ...operation,
    last_updated_at: completed_at,
    operation_status: 'COMPLETED',
  });

  await Promise.all([
    side_effects.cloudwatch(resource, operation, completed_at),
    side_effects.wharfie(resource, operation, completed_at),
    side_effects.dagster(resource, operation, completed_at),
  ]);

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
async function route(event, context, resource, operation) {
  const migration_resource = operation.operation_inputs.migration_resource;
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
    default:
      throw new Error('Invalid Action, must be valid MAINTAIN action');
  }
}

module.exports = {
  start,
  finish,
  route,
};
