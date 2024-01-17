const logging = require('../../lib/logging');
const wharfie_db_log = logging.getWharfieDBLogger();
/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function wharfie(event, context, resource, operation) {
  const { completed_at } = event.action_inputs;
  if (!completed_at) throw new Error('missing required action inputs');
  wharfie_db_log.info('wharfie', {
    resource,
    operation,
    completed_at,
  });
  return {
    status: 'COMPLETED',
  };
}

module.exports = wharfie;
