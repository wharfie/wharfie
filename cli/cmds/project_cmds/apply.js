'use strict';

const { Command } = require('commander');
const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const loadEnvironment = require('../../project/load-environment');
const { getResourceOptions } = require('../../project/template-actor');
const { displayInfo, displaySuccess } = require('../../output/basic');
const monitorProjectApplyReconcilables = require('../../output/project/apply');
const ansiEscapes = require('../../output/escapes');
const { handleError } = require('../../output/error');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');

/**
 * Applies changes to a Wharfie project.
 * @param {string} path - The path to the project root.
 * @param {string} environmentName - The environment to use.
 */
const apply = async (path, environmentName) => {
  const project = await loadProject({ path });
  displayInfo(`Applying changes to ${project.name}...`);

  const environment = loadEnvironment(project, environmentName);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });

  if (deployment instanceof WharfieProject) {
    throw new Error('Should not have loaded a project');
  }

  let projectResources;
  try {
    projectResources = await load({
      deploymentName: deployment.name,
      resourceKey: project.name,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    ) {
      throw error;
    }
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
  }

  const resourceOptions = getResourceOptions(environment, project);

  if (projectResources instanceof WharfieDeployment) {
    throw new Error('Should not have loaded a project');
  }

  projectResources.registerWharfieResources(resourceOptions);

  const multibar = monitorProjectApplyReconcilables(projectResources);

  await projectResources.reconcile();

  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Apply for ${project.name} completed successfully.`);
};

const applyCommand = new Command('apply')
  .description('Create or update Wharfie project resources')
  .argument('[path]', 'The path to the Wharfie project root')
  .option(
    '-e, --environment <environment>',
    'The Wharfie project environment to use'
  )
  .action(async (path, options) => {
    const { environment } = options;
    if (!path) {
      path = process.cwd();
    }
    try {
      await apply(path, environment);
    } catch (err) {
      handleError(err);
    }
  });

module.exports = applyCommand;
