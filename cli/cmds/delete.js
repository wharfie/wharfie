'use strict';

const CloudFormation = require('../../lambdas/lib/cloudformation');
const { displayFailure, displayInfo, displaySuccess } = require('../output');

const cloudformation = new CloudFormation();

const _delete = async (projectName) => {
  displayInfo(`Deleting wharfie project: ${projectName}...`);
  await cloudformation.deleteStack({
    StackName: projectName,
  });
  displaySuccess(`Deleted wharfie project: ${projectName}`);
};

exports.command = 'delete [project_name]';
exports.desc = 'delete wharfie resources';
exports.builder = (yargs) => {
  yargs
    .positional('project_name', {
      type: 'string',
      describe: 'the wharfie project name',
      demand: 'Please provide a wharfie project name',
    })
    .example('wharfie delete test-project');
};
exports.handler = async function ({ project_name }) {
  try {
    await _delete(project_name);
  } catch (err) {
    displayFailure(err);
  }
};
