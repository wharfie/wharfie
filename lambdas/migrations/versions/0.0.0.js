'use strict';

const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/operations');
const {
  resubmit_running_operations,
} = require('../resubmit_running_operations');
/**
 * @param {import('../../lib/graph/').Resource} _resource -
 * @param {import('../../typedefs').WharfieEvent} event -
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

module.exports = {
  up,
};
