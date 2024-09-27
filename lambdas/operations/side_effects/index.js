const cloudwatch = require('./cloudwatch');
const wharfie = require('./wharfie');
const dagster = require('./dagster');
const { Operation, Resource } = require('../../lib/graph/');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
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
