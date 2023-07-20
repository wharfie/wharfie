'use strict';

const { parse } = require('@sandfox/arn');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');
const resource_db = require('../../lib/dynamo/resource');
const counter_db = require('../../lib/dynamo/counter');
const sempahore_db = require('../../lib/dynamo/semaphore');
const location_db = require('../../lib/dynamo/location');
const event_db = require('../../lib/dynamo/event');

const STACK_NAME = process.env.STACK_NAME || '';

/**
 * @param {import('../../typedefs').CloudformationEvent} event -
 */
async function _delete(event) {
  const { StackId } = event;
  const { region } = parse(StackId);
  const cloudformation = new CloudFormation({ region });
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
  deletes.push(counter_db.deleteCountersByPrefix(`${STACK_NAME}:${StackName}`));
  if (event.ResourceProperties.TableInput.StorageDescriptor.Location)
    deletes.push(
      location_db.deleteLocation({
        location:
          event.ResourceProperties.TableInput.StorageDescriptor.Location,
        resource_id: StackName,
        interval: event.ResourceProperties.DaemonConfig.Interval || '300',
      })
    );

  // deleting s3 event data
  deletes.push(event_db.delete_records(StackName));

  // its possible to have some of these operations fail, in that case we want to allow as many to succeed as possible
  const results = await Promise.allSettled(deletes);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      throw new Error(`failed to delete resource: ${result.reason}`);
    }
  });
}

module.exports = _delete;
