const { Operation, Resource } = require('../../lib/graph/');
const { load } = require('../../lib/actor/deserialize');
const logging = require('../../lib/logging');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info({
    deploymentName: resource.resource_properties.deployment.name,
    resourceKey: resource.resource_properties.resourceName,
  });
  let migrationResource;
  try {
    migrationResource = await load({
      deploymentName: resource.resource_properties.deployment.name,
      resourceKey: resource.resource_properties.resourceName,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    )
      throw error;
    event_log.warn('No migration resource found to destroy');
    return {
      status: 'COMPLETED',
    };
  }
  await migrationResource.destroy();

  return {
    status: 'COMPLETED',
  };
}

module.exports = {
  run,
};
