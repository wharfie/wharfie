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
 *
 * @param {any} newResourceProperties -
 * @param {any} oldResourceProperties -
 * @returns {boolean} -
 */
function needsMigration(newResourceProperties, oldResourceProperties) {
  if (
    JSON.stringify(newResourceProperties.TableInput) !==
    JSON.stringify(oldResourceProperties.TableInput)
  ) {
    return true;
  }
  return false;
}
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
  let respondToCloudformation = true;

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
  const migration = needsMigration(
    event.ResourceProperties,
    event.OldResourceProperties
  );
  if (migration) {
    const migrate_stackname = `migrate-${StackName}`;

    const migrationTemplate = templateGenerator.Wharfie(
      {
        ...event,
        ResourceProperties: {
          ...event.ResourceProperties,
          DatabaseName: `migrate_${event.ResourceProperties}`,
        },
      },
      true
    );
    const resource = {
      resource_id: migrate_stackname,
      resource_arn: StackId,
      athena_workgroup: migrate_stackname,
      daemon_config: event.ResourceProperties.DaemonConfig,
      source_properties: migrationTemplate.Resources.Source.Properties,
      destination_properties: migrationTemplate.Resources.Compacted.Properties,
      wharfie_version: version,
    };
    await resource_db.putResource(resource);
    await cloudformation.createStack({
      StackName: migrate_stackname,
      Tags,
      TemplateBody: JSON.stringify(migrationTemplate),
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
    respondToCloudformation = false;
  }

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

  await resource_db.putResource(resource);
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
    respond: respondToCloudformation,
  };
}

module.exports = update;
