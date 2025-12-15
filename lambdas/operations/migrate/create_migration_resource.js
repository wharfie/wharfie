import { Operation, Resource } from '../../lib/graph/index.js';
import WharfieResource from '../../lib/actor/resources/wharfie-resource.js';
import * as resource_db from '../../lib/dynamo/operations.js';

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const migration_db = process.env.TEMPORARY_GLUE_DATABASE || '';
  const migration_table = `${resource.resource_properties.resourceName}_migrate`;
  const migrationResource = new WharfieResource({
    name: migration_table,
    properties: {
      ...resource.resource_properties,
      ...operation.operation_inputs.migration_resource_properties,
      resourceName: migration_table,
      resourceId: `${migration_db}.${migration_table}`,
      databaseName: migration_db,
      migrationResource: true,
    },
  });
  await migrationResource.reconcile();
  const def = await migrationResource.getResourceDef();
  operation.operation_inputs = {
    ...operation.operation_inputs,
    migration_resource: def.toRecord(),
  };
  await resource_db.putOperation(operation);
  return {
    status: 'COMPLETED',
  };
}

export default {
  run,
};
