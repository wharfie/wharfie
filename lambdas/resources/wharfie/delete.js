'use strict';

const { parse } = require('@sandfox/arn');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');
const Athena = require('../../lib/athena/index.js');
const resource_db = require('../../lib/dynamo/resource');
const sempahore_db = require('../../lib/dynamo/semaphore');
const location_db = require('../../lib/dynamo/location');
const event_db = require('../../lib/dynamo/event');
const dependency_db = require('../../lib/dynamo/dependency');

/**
 * @param {import('../../typedefs').CloudformationEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function _delete(event) {
  const { StackId } = event;
  const { region } = parse(StackId);
  const cloudformation = new CloudFormation({ region });
  const athena = new Athena({ region });
  const StackName = `Wharfie-${getImmutableID(event)}`;
  const deletes = [];
  deletes.push(resource_db.deleteResource(StackName));
  deletes.push(
    cloudformation.deleteStack({
      StackName,
    })
  );
  deletes.push(sempahore_db.deleteSemaphore(`wharfie:MAINTAIN:${StackName}`));
  deletes.push(sempahore_db.deleteSemaphore(`wharfie:BACKFILL:${StackName}`));
  if (event.ResourceProperties.TableInput.StorageDescriptor.Location)
    deletes.push(
      location_db.deleteLocation({
        location:
          event.ResourceProperties.TableInput.StorageDescriptor.Location,
        resource_id: StackName,
        interval: event.ResourceProperties.DaemonConfig.Interval || '300',
      })
    );
  const isView =
    event.ResourceProperties.source_properties?.TableInput?.TableType ===
    'VIRTUAL_VIEW';
  if (isView) {
    const viewOriginalText =
      event.ResourceProperties.source_properties.TableInput.ViewOriginalText;
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
      await dependency_db.deleteDependency({
        resource_id: StackName,
        dependency: `${source.DatabaseName}.${source.TableName}`,
        interval: event.ResourceProperties.DaemonConfig.Interval || '300',
      });
    }
  }

  // deleting s3 event data
  deletes.push(event_db.delete_records(StackName));

  // its possible to have some of these operations fail, in that case we want to allow as many to succeed as possible
  const results = await Promise.allSettled(deletes);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      throw new Error(`failed to delete resource: ${result.reason}`);
    }
  });
  return {
    respond: true,
  };
}

module.exports = _delete;
