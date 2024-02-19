'use strict';

const createProject = require('../../project/create');
const updateProject = require('../../project/update');
const loadProject = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const { getStackName } = require('../../project/template');

const CloudFormation = require('../../../lambdas/lib/cloudformation');
const cloudformation = new CloudFormation();

const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const create = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  const environment = loadEnvironment(project, environmentName);
  const stackName = getStackName(project, environment);
  displayInfo(`applying changes to ${stackName}...`);
  let stack;
  let stackExists = true;
  try {
    const { Stacks } = await cloudformation.describeStacks({
      StackName: stackName,
    });
    stack = Stacks?.[0];
  } catch (err) {
    if (
      // @ts-ignore
      err.message.includes('does not exist') ||
      stack?.StackStatus === 'DELETE_COMPLETE'
    ) {
      stackExists = false;
    } else {
      throw err;
    }
  }

  if (stackExists) {
    await updateProject({
      project,
      environment,
    });
  } else {
    await createProject({
      project,
      environment,
    });
  }
  displaySuccess(`apply for ${stackName} completed successfully`);
};

exports.command = 'apply [path]';
exports.desc = 'apply wharfie project changes';
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
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await create(path, environment);
  } catch (err) {
    console.error(err);
    displayFailure(err);
  }
};
