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
  event_log.info('RECONCILING RESOURCE');
  if (!resource.resource_properties?.deployment?.name)
    throw new Error('no deployment found for operation');
  const migrationResource = await load({
    deploymentName: resource.resource_properties.deployment.name,
    resourceKey: resource.resource_properties.resourceKey,
  });
  await migrationResource.reconcile();
  return {
    status: 'COMPLETED',
  };
}

export default {
  run,
};
