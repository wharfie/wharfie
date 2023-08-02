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
 * @param {import('../../typedefs').CloudformationUpdateEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function update(event) {
  const {
    StackId,
    ResourceProperties: {
      Tags,
      Backfill,
      TableInput: {
        StorageDescriptor: { Location },
      },
    },
    OldResourceProperties: { Backfill: oldBackfill, TableInput: oldTableInput },
  } = event;
  const { region } = parse(StackId);
  const cloudformation = new CloudFormation({ region });
  const sqs = new SQS({ region });
  const StackName = `Wharfie-${getImmutableID(event)}`;

  event = validation.update(event);
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
  const migration = false;
  if (migration) {
    const migrate_stackname = `migrate-${StackName}`;
    await cloudformation.createStack({
      StackName: migrate_stackname,
      Tags,
      Parameters: [
        {
          ParameterKey: 'MigrationResource',
          ParameterValue: 'true',
        },
      ],
      TemplateBody: JSON.stringify(template),
    });
    await sqs.enqueue(
      {
        operation_type: 'MIGRATE',
        action_type: 'START',
        resource_id: StackName,
        operation_inputs: {
          cloudformation_event: event,
          migration_resource: {
            resource_id: migrate_stackname,
            resource_arn: StackId,
            athena_workgroup: migrate_stackname,
            daemon_config: event.ResourceProperties.DaemonConfig,
            source_properties: template.Resources.Source.Properties,
            destination_properties: template.Resources.Compacted.Properties,
            wharfie_version: version,
          },
        },
        operation_started_at: new Date().toISOString(),
      },
      DAEMON_QUEUE_URL
    );
    return {
      respond: false,
    };
  }

  await resource_db.putResource(resource);
  const oldLocation =
    oldTableInput &&
    oldTableInput.StorageDescriptor &&
    oldTableInput.StorageDescriptor.Location;
  if (Location !== oldLocation) {
    if (Location) {
      await location_db.putLocation({
        location: Location,
        resource_id: StackName,
        interval: event.ResourceProperties.DaemonConfig.Interval || '300',
      });
    } else {
      await location_db.deleteLocation({
        location: oldLocation,
        resource_id: StackName,
        interval: event.ResourceProperties.DaemonConfig.Interval || '300',
      });
    }
  }
  await cloudformation.updateStack({
    StackName,
    Tags,
    TemplateBody: JSON.stringify(template),
  });

  await sqs.enqueue(
    {
      operation_type: 'MAINTAIN',
      action_type: 'START',
      resource_id: StackName,
      operation_started_at: new Date().toISOString(),
    },
    DAEMON_QUEUE_URL
  );
  const oldBackfillVersion = (oldBackfill || {}).Version || 0;
  if (Backfill && Backfill.Version > oldBackfillVersion) {
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

module.exports = update;
