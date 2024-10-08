'use strict';

const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const loadEnvironment = require('../../project/load-environment');
const { getResourceOptions } = require('../../project/template-actor');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');

const { displayInfo, displaySuccess } = require('../../output/basic');
const ansiEscapes = require('../../output/escapes');
const { handleError } = require('../../output/error');

const constants = require('../../project/constants');

const chalk = require('chalk');
const jdf = require('jsondiffpatch');

/**
 *
 * @param {jdf.Delta} delta -
 * @param {any} original -
 * @returns {string} -
 */
function printTerraformStyleDiff(delta, original) {
  return jdf.formatters.console.format(delta, original);
}

/**
 * @param {string} path -
 * @param {string} environmentName -
 */
const plan = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  displayInfo(`planning changes to ${project.name}...`);
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
      !['No resource found', 'Resource was not stored'].includes(error.message)
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

  const diffs = projectResources.diffWharfieResources(resourceOptions);
  process.stdout.write(ansiEscapes.eraseLines(2));
  // output git style patches to console
  if (
    Object.keys(diffs.additions).length === 0 &&
    Object.keys(diffs.removals).length === 0 &&
    Object.keys(diffs.updates).length === 0
  ) {
    displaySuccess('no changes required');
    return;
  }

  let changePatches =
    environment.name === constants.WHARFIE_DEFAULT_ENVIRONMENT
      ? `Wharfie will perform the following actions for ${project.name}:`
      : `Wharfie will perform the following actions for ${project.name} in ${environment.name}:`;

  Object.values(diffs.additions).forEach((resource) => {
    changePatches += `\n\n ${chalk.bold(resource.name)} will be created \n `;
    const diff = jdf.diff({}, resource);
    if (diff) changePatches += printTerraformStyleDiff(diff, {});
  });

  Object.keys(diffs.updates).forEach((resourceName) => {
    changePatches += `\n\n ${chalk.bold(resourceName)} will be changed \n `;
    changePatches += printTerraformStyleDiff(
      diffs.updates[resourceName].delta,
      diffs.updates[resourceName].old
    );
  });

  Object.values(diffs.removals).forEach((resource) => {
    changePatches += `\n\n ${chalk.bold(resource.name)} will be destroyed \n `;
    const diff = jdf.diff(resource, {});
    if (diff) changePatches += printTerraformStyleDiff(diff, resource);
  });

  console.log(changePatches);

  let changeSummary = `\n${chalk.bold('Plan:')}`;
  changeSummary += ` ${Object.keys(diffs.additions).length} to add,`;
  changeSummary += ` ${Object.keys(diffs.updates).length} to change,`;
  changeSummary += ` ${Object.keys(diffs.removals).length} to destroy.`;
  console.log(changeSummary);
};

exports.command = 'plan [path]';
exports.desc = 'Show changes required by current project configuration';
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
 * @typedef projectMaintainCLIParams
 * @property {string} path -
 * @property {string} environment -
 * @param {projectMaintainCLIParams} params -
 */
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await plan(path, environment);
  } catch (err) {
    handleError(err);
  }
};
