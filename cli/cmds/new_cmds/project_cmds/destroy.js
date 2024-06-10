'use strict';

const inquirer = require('inquirer');

const loadProject = require('../../../project/load');
const { load } = require('../../../../lambdas/lib/actor/deserialize');
const WharfieProject = require('../../../../lambdas/lib/actor/resources/wharfie-project');
const loadEnvironment = require('../../../project/load-environment');
const { getResourceOptions } = require('../../../project/template-actor');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../../output');

const destroy = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  let projectResources;
  try {
    projectResources = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
      resourceName: project.name,
    });
  } catch (error) {
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    )
      throw error;
    const deployment = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
    });
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
    const environment = loadEnvironment(project, environmentName);
    const resourceOptions = getResourceOptions(environment, project);

    projectResources.registerWharfieResources(resourceOptions);
  }

  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'confirm',
          name: 'confirmation',
          message: `This will destroy the project including all data in the ${
            projectResources.getBucket().name
          } S3 bucket. Are you sure?`,
          default: false,
        },
      ])
      .then(resolve)
      .catch(reject);
  });
  if (!answers.confirmation) {
    displayFailure('destroy cancelled');
    return;
  }
  displayInfo(`destroying wharfie project ${project.name}...`);

  await projectResources.destroy();
  displaySuccess(`destroyed wharfie project ${project.name} successfully`);
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
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await destroy(path, environment);
  } catch (err) {
    console.trace(err);
    displayFailure(err);
  }
};
