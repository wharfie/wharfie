'use strict';

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

const apply = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  displayInfo(`applying changes to ${project.name}...`);
  const environment = loadEnvironment(project, environmentName);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
  });
  let projectResources;
  try {
    projectResources = await load({
      deploymentName: deployment.name,
      resourceName: project.name,
    });
  } catch (error) {
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    )
      throw error;
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
  }
  const resourceOptions = getResourceOptions(environment, project);

  projectResources.registerWharfieResources(resourceOptions);

  await projectResources.reconcile();

  displaySuccess(`apply for ${project.name} completed successfully`);
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
    await apply(path, environment);
  } catch (err) {
    displayFailure(err);
  }
};
