import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const inquirer = require('inquirer');
const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize/full');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const loadEnvironment = require('../../project/load-environment');
const { getResourceOptions } = require('../../project/template-actor');
const ansiEscapes = require('../../output/escapes');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const monitorProjectDestroyReconcilables = require('../../output/project/destroy');
const { handleError } = require('../../output/error');

/**
 * Destroys a Wharfie project, including its resources and data.
 * @param {string} path - The path to the Wharfie project root.
 * @param {string} environmentName - The Wharfie project environment to use.
 * @param {boolean} yes - Skip confirmation prompt and approve destruction.
 */
const destroy = async (path, environmentName, yes) => {
  const project = await loadProject({ path });

  let projectResources;
  try {
    projectResources = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
      resourceKey: project.name,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    ) {
      throw error;
    }
    const deployment = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
    if (deployment instanceof WharfieProject) {
      throw new Error('Should not have loaded a project');
    }
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
    const environment = loadEnvironment(project, environmentName);
    const resourceOptions = getResourceOptions(environment, project);

    projectResources.registerWharfieResources(resourceOptions);
  }

  if (!yes) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmation',
        message: `This will destroy the project including all data in the ${projectResources
          .getBucket()
          .get('bucketName')} S3 bucket. Are you sure?`,
        default: false,
      },
    ]);

    if (!answers.confirmation) {
      displayFailure('Destroy cancelled');
      return;
    }
    process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  }

  displayInfo(`Destroying Wharfie project ${project.name}...`);

  const multibar = monitorProjectDestroyReconcilables(projectResources);

  await projectResources.destroy();

  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Destroyed Wharfie project ${project.name} successfully.`);
};

const destroyCommand = new Command('destroy')
  .description('Destroy previously-created Wharfie project')
  .argument('[path]', 'The path to the Wharfie project root')
  .option(
    '-e, --environment <environment>',
    'The Wharfie project environment to use'
  )
  .option('-y, --yes', 'Approve destruction without confirmation prompt')
  .action(async (path, options) => {
    const { environment, yes } = options;
    if (!path) {
      path = process.cwd();
    }
    try {
      await destroy(path, environment, yes);
    } catch (err) {
      handleError(err);
    }
  });

module.exports = destroyCommand;
