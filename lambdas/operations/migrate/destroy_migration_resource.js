const { Operation, Resource } = require('../../lib/graph/');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  return {
    status: 'COMPLETED',
  };
}

module.exports = {
  run,
};
