import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize/full');
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
 * Formats a JSON diff in a Terraform-style format.
 * @param {jdf.Delta} delta - The JSON diff delta.
 * @param {any} original - The original object.
 * @returns {string} The formatted diff.
 */
function printTerraformStyleDiff(delta, original) {
  return jdf.formatters.console.format(delta, original);
}

/**
 * Shows the changes required by the current project configuration.
 * @param {string} path - The path to the Wharfie project root.
 * @param {string} environmentName - The Wharfie project environment to use.
 */
const plan = async (path, environmentName) => {
  const project = await loadProject({ path });
  displayInfo(`Planning changes to ${project.name}...`);

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

  const diffs = projectResources.diffWharfieResources(resourceOptions);
  process.stdout.write(ansiEscapes.eraseLines(2));

  if (
    Object.keys(diffs.additions).length === 0 &&
    Object.keys(diffs.removals).length === 0 &&
    Object.keys(diffs.updates).length === 0
  ) {
    displaySuccess('No changes required.');
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

const planCommand = new Command('plan')
  .description('Show changes required by current project configuration')
  .argument('[path]', 'The path of the Wharfie project root')
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
      await plan(path, environment);
    } catch (err) {
      handleError(err);
    }
  });

module.exports = planCommand;
