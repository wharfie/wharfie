'use strict';

const { Graph, alg } = require('graphlib');
const uuid = require('uuid');

const CloudWatch = require('../../lib/cloudwatch');
const cloudwatch = new CloudWatch({
  region: process.env.AWS_REGION,
});

const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/resource');
const register_partition = require('../actions/register_partition');
const run_single_compaction = require('../actions/run_single_compaction');
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
  if (!event.operation_id || !event.action_id || !event.operation_started_at)
    throw new Error('Event missing fields');

  const action_graph = new Graph();
  action_graph.setNode('START', event.action_id);
  action_graph.setNode('REGISTER_PARTITION', uuid.v4());
  action_graph.setEdge('START', 'REGISTER_PARTITION');

  action_graph.setNode('RUN_SINGLE_COMPACTION', uuid.v4());
  action_graph.setEdge('REGISTER_PARTITION', 'RUN_SINGLE_COMPACTION');

  action_graph.setNode('UPDATE_SYMLINKS', uuid.v4());
  action_graph.setEdge('RUN_SINGLE_COMPACTION', 'UPDATE_SYMLINKS');

  action_graph.setNode('FINISH', uuid.v4());
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
    actions,
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
    default:
      throw new Error('Invalid Action, must be valid S3_EVENT action');
  }
}

module.exports = {
  start,
  finish,
  route,
};
