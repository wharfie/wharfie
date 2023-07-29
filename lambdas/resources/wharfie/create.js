'use strict';

const { parse } = require('@sandfox/arn');
const { version } = require('../../../package.json');

const templateGenerator = require('./lib/template-generator');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');
const SQS = require('../../lib/sqs');
const validation = require('./lib/validation');
const resource_db = require('../../lib/dynamo/resource');
const location_db = require('../../lib/dynamo/location');

const DAEMON_QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';

/**
 * @param {import('../../typedefs').CloudformationEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function create(event) {
  const {
    StackId,
    ResourceProperties: { Tags, Backfill },
  } = event;
  const { region } = parse(StackId);
  const cloudformation = new CloudFormation({ region });
  const sqs = new SQS({ region });
  const StackName = `Wharfie-${getImmutableID(event)}`;

  event = validation.create(event);
  const template = templateGenerator.Wharfie(event);

  // defining the resouce object that is being created
  const resource = {
    resource_id: StackName,
    resource_arn: StackId,
    athena_workgroup: StackName,
    daemon_config: event.ResourceProperties.DaemonConfig,
    source_properties: template.Resources.Source.Properties,
    destination_properties: template.Resources.Compacted.Properties,
    wharfie_version: version,
  };

  await resource_db.putResource(resource);

  if (event.ResourceProperties.TableInput.StorageDescriptor.Location)
    await location_db.putLocation({
      location: event.ResourceProperties.TableInput.StorageDescriptor.Location,
      resource_id: StackName,
      interval: event.ResourceProperties.DaemonConfig.Interval || '300',
    });
  await cloudformation.createStack({
    StackName,
    Tags,
    TemplateBody: JSON.stringify(template),
  });

  /*
  Creating a stack mappings file in S3 for Cloud Formation stack created by wharfie
  */
  // await stack_mappings.createStackMap(resource, event['LogicalResourceId']);

  await sqs.enqueue(
    {
      operation_type: 'MAINTAIN',
      action_type: 'START',
      resource_id: StackName,
      operation_started_at: new Date().toISOString(),
    },
    DAEMON_QUEUE_URL
  );
  if (Backfill) {
    await sqs.enqueue(
      {
        operation_type: 'BACKFILL',
        action_type: 'START',
        resource_id: StackName,
        action_inputs: Backfill,
        operation_started_at: new Date().toISOString(),
      },
      DAEMON_QUEUE_URL
    );
  }
  return {
    respond: true,
  };
}

module.exports = create;
