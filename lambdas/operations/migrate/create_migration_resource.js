const { Operation, Resource } = require('../../lib/graph/');
const WharfieResource = require('../../lib/actor/resources/wharfie-resource');
const resource_db = require('../../lib/dynamo/operations');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const migration_db = process.env.TEMPORARY_GLUE_DATABASE || '';
  const migration_table = `migrate_${resource.resource_properties.resourceName}`;
  const migrationResource = new WharfieResource({
    name: migration_table,
    properties: {
      ...resource.resource_properties,
      ...operation.operation_inputs.migration_resource_properties,
      resourceName: migration_table,
      resourceId: `${migration_db}.${migration_table}`,
      outputLocation: `s3://${resource.resource_properties.projectBucket}/${migration_table}/`,
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

module.exports = {
  run,
};
