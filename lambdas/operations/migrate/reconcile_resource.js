const { Operation, Resource } = require('../../lib/graph/');
const { load } = require('../../lib/actor/deserialize/non-circular');
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
  event_log.info('RECONCILING RESOURCE');
  const migrationResource = await load({
    deploymentName: resource.resource_properties.deployment.name,
    resourceKey: resource.resource_properties.resourceKey,
  });
  await migrationResource.reconcile();
  return {
    status: 'COMPLETED',
  };
}

module.exports = {
  run,
};
