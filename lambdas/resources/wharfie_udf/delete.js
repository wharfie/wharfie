'use strict';

const { parse } = require('@sandfox/arn');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');

/**
 * @param {import('../../typedefs').CloudformationEvent} event -
 */
async function _delete(event) {
  const { StackId } = event;
  const { region } = parse(StackId);
  const cloudformation = new CloudFormation({ region });
  const StackName = `WharfieUDF-${getImmutableID(event)}`;
  const deletes = [];
  deletes.push(
    cloudformation.deleteStack({
      StackName,
    })
  );

  // its possible to have some of these operations fail, in that case we want to allow as many to succeed as possible
  const results = await Promise.allSettled(deletes);
  results.forEach((result) => {
    if (result.status === 'rejected') {
      throw new Error(`failed to delete resource: ${result.reason}`);
    }
  });
}

module.exports = _delete;
