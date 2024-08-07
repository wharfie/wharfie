'use strict';

const { parse } = require('@sandfox/arn');
const { version } = require('../../../package.json');

const templateGenerator = require('./lib/template-generator');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');
const Athena = require('../../lib/athena/index.js');
const SQS = require('../../lib/sqs');
const validation = require('./lib/validation');
const resource_db = require('../../lib/dynamo/resource');
const location_db = require('../../lib/dynamo/location');
const dependency_db = require('../../lib/dynamo/dependency');

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
  const athena = new Athena({ region });
  const StackName = `Wharfie-${getImmutableID(event)}`;

  event = validation.create(event);
  const template = templateGenerator.Wharfie(event);

  // defining the resouce object that is being created
  const resource = {
    resource_id: StackName,
    resource_arn: StackId,
    resource_status: 'CREATING',
    athena_workgroup: StackName,
    daemon_config: event.ResourceProperties.DaemonConfig,
    source_properties: template.Resources.Source.Properties,
    destination_properties: template.Resources.Compacted.Properties,
    wharfie_version: version,
  };
  // @ts-ignore
  await resource_db.putResource(resource);

  if (event.ResourceProperties.TableInput.StorageDescriptor.Location)
    await location_db.putLocation({
      location: event.ResourceProperties.TableInput.StorageDescriptor.Location,
      resource_id: StackName,
      interval: event.ResourceProperties.DaemonConfig.Interval || '300',
    });

  const isView =
    resource.source_properties?.TableInput?.TableType === 'VIRTUAL_VIEW';
  if (isView) {
    const viewOriginalText = resource.source_properties.viewOriginalText;
    const view_sql = JSON.parse(
      Buffer.from(
        viewOriginalText.substring(16, viewOriginalText.length - 3),
        'base64'
      ).toString()
    ).originalSql;
    const { sources } = athena.extractSources(view_sql);
    while (sources.length > 0) {
      const source = sources.pop();
      if (!source || !source.DatabaseName || !source.TableName) continue;
      await dependency_db.putDependency({
        resource_id: StackName,
        dependency: `${source.DatabaseName}.${source.TableName}`,
        interval: event.ResourceProperties.DaemonConfig.Interval || '300',
      });
    }
  }
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
