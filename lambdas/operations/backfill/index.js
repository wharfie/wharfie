import { Action, Operation, Resource } from '../../lib/graph/index.js';
import * as logging from '../../lib/logging/index.js';
import * as resource_db from '../../lib/dynamo/operations.js';
import register_missing_partitions from '../actions/register_missing_partitions.js';
import find_compaction_partitions from '../actions/find_compaction_partitions.js';
import run_compaction from '../actions/run_compaction.js';
import update_symlinks from '../actions/update_symlinks.js';
import * as side_effects from '../side_effects/index.js';

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
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

  event_log.info('action graph generating');
  const operation = new Operation({
    resource_id: resource.id,
    resource_version: resource.version,
    id: event.operation_id,
    type: event.operation_type,
    status: Operation.Status.RUNNING,
    started_at: Date.parse(event.operation_started_at) / 1000,
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
  const finish_action = operation.createAction({
    type: Action.Type.FINISH,
    dependsOn: [update_symlinks_action],
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

  event_log.info('creating BACKFILL operation and actions...');
  await resource_db.putOperation(operation);

  event_log.info('BACKFILL started.');

  return {
    status: 'COMPLETED',
  };
}

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function finish(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info(`marking as complete`);

  const completed_at = Math.floor(Date.now() / 1000);
  operation.last_updated_at = completed_at;
  operation.status = Operation.Status.COMPLETED;

  await resource_db.putOperation(operation);

  return {
    status: 'COMPLETED',
    outputs: {
      completed_at,
    },
  };
}

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function route(event, context, resource, operation) {
  if (operation.resource_version !== resource.version) {
    const event_log = logging.getEventLogger(event, context);
    event_log.warn(
      `resource version (${resource.version}) does not match operation's version (${operation.resource_version})`
    );
    return {
      status: 'COMPLETED',
    };
  }
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
    case 'SIDE_EFFECTS__FINISH':
      return await side_effects.finish(event, context, resource, operation);
    default:
      throw new Error('Invalid Action, must be valid BACKFILL action');
  }
}

export default {
  start,
  finish,
  route,
};
