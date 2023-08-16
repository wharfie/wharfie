'use strict';

const logging = require('../../lib/logging');
const CloudFormation = require('../../lib/cloudformation');
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
  const cloudformation = new CloudFormation({ region: process.env.AWS_REGION });

  const t = await cloudformation.describeStacks({
    StackName: resource.resource_id,
  });
  if (!t || !t.Stacks)
    throw new Error('resource cloudformation stack doesnt exist');
  if (!t.Stacks[0].Tags) throw new Error('tags are missing from stack');

  const resp = await cloudformation.getTemplate({
    StackName: resource.resource_id,
  });
  if (!resp || !resp.TemplateBody)
    throw new Error('template does not exist for resource');

  const template = JSON.parse(resp.TemplateBody);

  const version = template.Metadata.WharfieVersion;
  if (version !== '0.0.0') return;

  template.Metadata.WharfieVersion = '0.0.0';

  await resource_db.putResource({
    resource_id: resource.resource_id,
    resource_arn: resource.resource_arn,
    athena_workgroup: resource.resource_id,
    daemon_config: resource.daemon_config,
    source_properties: template.Resources.Source.Properties,
    destination_properties: template.Resources.Compacted.Properties,
    wharfie_version: '0.0.0',
  });

  event_log.info('0.0.0 migration: updated dynamo record');

  await cloudformation.updateStack({
    StackName: resource.resource_id,
    Tags: t.Stacks[0].Tags,
    TemplateBody: JSON.stringify(template),
  });

  event_log.info('0.0.0 migration: updated cloudformation stack');

  await resubmit_running_operations(resource.resource_id);

  throw new Error('Resource Migrated, Retry started');
}

module.exports = {
  up,
};
