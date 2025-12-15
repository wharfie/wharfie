import { Action, Operation, Resource } from '../../lib/graph/index.js';
import * as logging from '../../lib/logging/index.js';
import * as resource_db from '../../lib/dynamo/operations.js';
import * as semaphore_db from '../../lib/dynamo/semaphore.js';
import register_missing_partitions from '../actions/register_missing_partitions.js';
import find_compaction_partitions from '../actions/find_compaction_partitions.js';
import run_compaction from '../actions/run_compaction.js';
import update_symlinks from '../actions/update_symlinks.js';
import swap_resource from './swap_resource.js';
import create_migration_resource from './create_migration_resource.js';
import destroy_migration_resource from './destroy_migration_resource.js';
import reconcile_resource from './reconcile_resource.js';
import * as side_effects from '../side_effects/index.js';

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function start(event, context, resource) {
  const event_log = logging.getEventLogger(event, context);
  if (!event.operation_id || !event.action_id || !event.operation_started_at)
    throw new Error('Event missing fields');

  event_log.info('action graph generating');
  const operation = new Operation({
    resource_id: resource.id,
    resource_version: event.resource_version || resource.version + 1,
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
  const create_migration_resource = operation.createAction({
    type: Action.Type.CREATE_MIGRATION_RESOUCE,
    dependsOn: [start_action],
  });
  const register_missing_partitions_action = operation.createAction({
    type: Action.Type.REGISTER_MISSING_PARTITIONS,
    dependsOn: [create_migration_resource],
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
  const reconcile_resource = operation.createAction({
    type: Action.Type.RECONCILE_RESOURCE,
    dependsOn: [swap_resource_action],
  });
  const destroy_migration_resource = operation.createAction({
    type: Action.Type.DESTROY_MIGRATION_RESOURCE,
    dependsOn: [reconcile_resource],
  });
  const finish_action = operation.createAction({
    type: Action.Type.FINISH,
    dependsOn: [destroy_migration_resource],
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
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} migration_to_cleanup -
 */
async function cleanup(event, context, resource, migration_to_cleanup) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info(`marking MIGRATE as complete`);

  const deletes = [];
  const StackName = `migrate-${resource.id}`;
  const migrationResource = Resource.fromRecord(
    migration_to_cleanup.operation_inputs.migration_resource
  );
  deletes.push(resource_db.deleteResource(migrationResource));
  deletes.push(semaphore_db.deleteSemaphore(`wharfie:BACKFILL:${StackName}`));
  deletes.push(semaphore_db.deleteSemaphore(`wharfie:LOAD:${StackName}`));
  deletes.push(semaphore_db.deleteSemaphore(`wharfie:MIGRATE:${StackName}`));
  const results = await Promise.allSettled(deletes);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      throw new Error(`failed to delete resource: ${result.reason}`);
    }
  });
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
  event_log.info(`marking MIGRATE as complete`);

  const completed_at = Math.floor(Date.now() / 1000);
  operation.last_updated_at = completed_at;
  operation.status = Operation.Status.COMPLETED;

  await cleanup(event, context, resource, operation);

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
  switch (event.action_type) {
    case Action.Type.SIDE_EFFECT__CLOUDWATCH:
      return await side_effects.cloudwatch(event, context, resource, operation);
    case Action.Type.SIDE_EFFECT__WHARFIE:
      return await side_effects.wharfie(event, context, resource, operation);
    case Action.Type.SIDE_EFFECT__DAGSTER:
      return await side_effects.dagster(event, context, resource, operation);
    case Action.Type.SIDE_EFFECTS__FINISH:
      return await side_effects.finish(event, context, resource, operation);
    case Action.Type.RECONCILE_RESOURCE:
      return await reconcile_resource.run(event, context, resource, operation);
  }
  if (operation.resource_version <= resource.version) {
    const event_log = logging.getEventLogger(event, context);
    event_log.warn(
      `resource version${resource.version} is ahead of operation's version ${operation.resource_version}`
    );
    return {
      status: 'COMPLETED',
    };
  }
  switch (event.action_type) {
    case Action.Type.CREATE_MIGRATION_RESOUCE:
      return await create_migration_resource.run(
        event,
        context,
        resource,
        operation
      );
    case Action.Type.DESTROY_MIGRATION_RESOURCE:
      return await destroy_migration_resource.run(
        event,
        context,
        Resource.fromRecord(operation.operation_inputs.migration_resource),
        operation
      );
    case Action.Type.REGISTER_MISSING_PARTITIONS:
      return await register_missing_partitions.run(
        event,
        context,
        Resource.fromRecord(operation.operation_inputs.migration_resource)
      );
    case Action.Type.FIND_COMPACTION_PARTITIONS:
      return await find_compaction_partitions.run(
        event,
        context,
        Resource.fromRecord(operation.operation_inputs.migration_resource),
        operation
      );
    case Action.Type.RUN_COMPACTION:
      return await run_compaction.run(event, context, resource, operation);
    case Action.Type.UPDATE_SYMLINKS:
      return await update_symlinks.run(event, context, resource, operation);
    case Action.Type.SWAP_RESOURCE:
      return await swap_resource.run(event, context, resource, operation);
    default:
      throw new Error('Invalid Action, must be valid MIGRATE action');
  }
}

export default {
  start,
  finish,
  route,
};
