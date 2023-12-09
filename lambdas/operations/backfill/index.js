'use strict';

const { Graph, alg } = require('graphlib');

const { createId } = require('../../lib/id');
const CloudWatch = require('../../lib/cloudwatch');
const cloudwatch = new CloudWatch({
  region: process.env.AWS_REGION,
});
const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/resource');
const register_missing_partitions = require('../actions/register_missing_partitions');
const find_compaction_partitions = require('../actions/find_compaction_partitions');
const run_compaction = require('../actions/run_compaction');
const update_symlinks = require('../actions/update_symlinks');

const STACK_NAME = process.env.STACK_NAME || '';

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

  action_graph.setNode('FINISH', createId());
  action_graph.setEdge('UPDATE_SYMLINKS', 'FINISH');

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
    actions,
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

  cloudwatch.putMetricData({
    MetricData: [
      {
        MetricName: `operations`,
        Dimensions: [
          {
            Name: 'stack',
            Value: STACK_NAME,
          },
          {
            Name: 'resource',
            Value: resource.resource_id,
          },
          {
            Name: 'operation_type',
            Value: operation.operation_type,
          },
        ],
        Unit: 'Seconds',
        Value: completed_at - operation.started_at,
      },
      // summable metrics
      {
        MetricName: 'operations',
        Dimensions: [
          {
            Name: 'stack',
            Value: STACK_NAME,
          },
          {
            Name: 'operation_type',
            Value: operation.operation_type,
          },
        ],
        Unit: 'Count',
        Value: 1,
      },
      {
        MetricName: 'operations',
        Dimensions: [
          {
            Name: 'stack',
            Value: STACK_NAME,
          },
        ],
        Unit: 'Count',
        Value: 1,
      },
    ],
    Namespace: 'Wharfie',
  });
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
    // no-op
    case 'CLEANUP':
      return {
        status: 'COMPLETED',
      };
    default:
      throw new Error('Invalid Action, must be valid MAINTAIN action');
  }
}

module.exports = {
  start,
  finish,
  route,
};
