'use strict';

const logging = require('../../lib/logging');
const resource_db = require('../../lib/dynamo/resource');
const {
  resubmit_running_operations,
} = require('../resubmit_running_operations');
/**
 * @param {import('../../typedefs').ResourceRecord} _resource -
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
async function up(_resource, event, context) {
  const event_log = logging.getEventLogger(event, context);
  event_log.warn('running 0.0.0 up migration');
  const resource = await resource_db.getResource(_resource.resource_id);
  if (!resource) throw new Error('resource does not exist');

  const version = resource.wharfie_version;

  if (version !== '0.0.0') return;

  await resource_db.putResource({
    ...resource,
    wharfie_version: '0.0.0',
  });

  event_log.info('0.0.0 migration: updated dynamo record');

  await resubmit_running_operations(resource.resource_id);

  throw new Error('Resource Migrated, Retry started');
}

module.exports = {
  up,
};
