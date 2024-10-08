'use strict';

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
 * @param {string} path -
 * @param {string} environmentName -
 */
const apply = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  displayInfo(`applying changes to ${project.name}...`);
  const environment = loadEnvironment(project, environmentName);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });
  if (deployment instanceof WharfieProject)
    throw new Error('should not have loaded a project');
  let projectResources;
  try {
    projectResources = await load({
      deploymentName: deployment.name,
      resourceKey: project.name,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      !['No resources found', 'Resource was not stored'].includes(error.message)
    )
      throw error;
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
  }
  const resourceOptions = getResourceOptions(environment, project);

  if (projectResources instanceof WharfieDeployment)
    throw new Error('should not have loaded a project');

  projectResources.registerWharfieResources(resourceOptions);

  const multibar = monitorProjectApplyReconcilables(projectResources);

  await projectResources.reconcile();

  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Apply for ${project.name} completed successfully`);
};

exports.command = 'apply [path]';
exports.desc = 'Create or update wharfie project resources';
/**
 * @param {import('yargs').Argv} yargs -
 */
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
/**
 * @typedef projectApplyCLIParams
 * @property {string} path -
 * @property {string} environment -
 * @param {projectApplyCLIParams} params -
 */
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await apply(path, environment);
  } catch (err) {
    handleError(err);
  }
};
