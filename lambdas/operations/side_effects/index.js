const cloudwatch = require('./cloudwatch');
const wharfie = require('./wharfie');
const dagster = require('./dagster');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function finish(event, context, resource, operation) {
  return {
    status: 'COMPLETED',
  };
}

module.exports = {
  cloudwatch,
  wharfie,
  dagster,
  finish,
};
