import { Operation, Resource } from '../../lib/graph/index.js';
import { load } from '../../lib/actor/deserialize/non-circular.js';
import * as logging from '../../lib/logging/index.js';

/**
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs.js').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  event_log.info({
    deploymentName: resource.resource_properties?.deployment?.name,
    resourceKey: resource.resource_properties.resourceName,
  });
  let migrationResource;
  try {
    if (!resource.resource_properties?.deployment?.name)
      throw new Error('no deployment found for operation');
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

export default {
  run,
};
