import * as logging from '../../lib/logging/index.js';
import * as resource_db from '../../lib/dynamo/operations.js';
import resubmit_running_operations from '../resubmit_running_operations.js';
/**
 * @param {import('../../lib/graph/index.js').Resource} _resource -
 * @param {import('../../typedefs.js').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
async function up(_resource, event, context) {
  const event_log = logging.getEventLogger(event, context);
  event_log.warn('running 0.0.0 up migration');
  const resource = await resource_db.getResource(_resource.id);
  if (!resource) throw new Error('resource does not exist');

  const version = resource.wharfie_version;

  if (version !== '0.0.0') return;

  resource.wharfie_version = '0.0.0';

  await resource_db.putResource(resource);

  event_log.info('0.0.0 migration: updated dynamo record');

  await resubmit_running_operations(resource.id);

  throw new Error('Resource Migrated, Retry started');
}

export default {
  up,
};
