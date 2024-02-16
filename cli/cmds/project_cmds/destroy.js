'use strict';

const CloudFormation = require('../../../lambdas/lib/cloudformation');
const { loadProject } = require('../../project/load');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const cloudformation = new CloudFormation();

const destroy = async ({ path, environmentName }) => {
  const project = await loadProject({
    path,
  });
  const stackName = `${project.name}-${environmentName}`;

  displayInfo(`destroying wharfie project ${stackName}...`);
  await cloudformation.deleteStack({
    StackName: stackName,
  });
  displaySuccess(`destroyed wharfie project ${stackName} successfully`);
};

exports.command = 'destroy [path]';
exports.desc = 'destroy wharfie project';
exports.builder = (yargs) => {
  yargs
    .positional('path', {
      type: 'string',
      describe: 'the path of the wharfie project root',
      optional: true,
    })
    .option('environment', {
      alias: 'e',
      type: 'string',
      describe: 'the wharfie project environment to use',
    });
};
exports.handler = async function () {
  try {
    await destroy();
  } catch (err) {
    displayFailure(err);
  }
};
