'use strict';

const logging = require('../../lib/logging');
const response = require('../../lib/cloudformation/cfn-response');
const { getImmutableID } = require('../../lib/cloudformation/id');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);

  event_log.info('replying to cloudformation');

  await response(null, operation.operation_inputs.cloudformation_event, {
    id: getImmutableID(operation.operation_inputs.cloudformation_event),
  });

  return {
    status: 'COMPLETED',
  };
}

module.exports = { run };
