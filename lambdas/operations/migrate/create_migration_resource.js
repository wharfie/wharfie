const { Operation, Resource } = require('../../lib/graph/');
// const { load } = require('../../lib/actor/deserialize');
// const WharfieProject = require('../../lib/actor/resources/wharfie-project');

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {Resource} resource -
 * @param {Operation} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function run(event, context, resource, operation) {
  // let projectResources;
  // try {
  // projectResources = await load({
  //     deploymentName: deployment.name,
  //     resourceKey: resource.,
  // });
  // } catch (error) {
  // if (!(error instanceof Error)) throw error;
  // if (
  //     !['No resource found', 'Resource was not stored'].includes(error.message)
  // )
  //     throw error;
  // projectResources = new WharfieProject({
  //     deployment,
  //     name: project.name,
  // });
  // }

  return {
    status: 'COMPLETED',
  };
}

module.exports = {
  run,
};
