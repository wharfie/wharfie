'use strict';

const CloudFormation = require('../../../lambdas/lib/cloudformation');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const config = require('../../config');

const { region, deployment_name, artifact_bucket } = config.getConfig();
process.env.AWS_REGION = region;
process.env.RESOURCE_TABLE = deployment_name;
process.env.TEMPLATE_BUCKET = artifact_bucket;

const cloudformation = new CloudFormation({ region });

const _delete = async (resourceType) => {
  let stackName;
  if (resourceType === 'deployment') {
    stackName = deployment_name;
  } else if (resourceType === 'examples') {
    stackName = `${deployment_name}-examples`;
  } else if (resourceType === 'examples-bucket') {
    stackName = `${deployment_name}-examples-bucket`;
  } else {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }
  displayInfo(`Deleteing wharfie ${resourceType}...`);
  await cloudformation.deleteStack({
    StackName: stackName,
  });
  displaySuccess(`Deleted wharfie ${resourceType}`);
};

exports.command = 'delete [resourceType]';
exports.desc = 'delete wharfie resources';
exports.builder = (yargs) => {
  yargs.choices('resourceType', ['deployment', 'examples', 'examples-bucket']);
};
exports.handler = async function ({ resourceType, deploymentName }) {
  try {
    await _delete(resourceType, deploymentName);
  } catch (err) {
    displayFailure(err);
  }
};
