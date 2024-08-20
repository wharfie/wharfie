'use strict';
const inquirer = require('inquirer');
const ansiEscapes = require('ansi-escapes');

const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const loadEnvironment = require('../../project/load-environment');
const { getResourceOptions } = require('../../project/template-actor');

const {
  displayFailure,
  displayInfo,
  displaySuccess,
  monitorProjectDestroyReconcilables,
} = require('../../output/');

const { handleError } = require('../../output/error');
/**
 * @param {string} path -
 * @param {string} environmentName -
 * @param {boolean} yes -
 */
const destroy = async (path, environmentName, yes) => {
  const project = await loadProject({
    path,
  });

  let projectResources;
  try {
    projectResources = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
      resourceName: project.name,
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    )
      throw error;
    const deployment = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
    if (deployment instanceof WharfieProject)
      throw new Error('should not have loaded a project');
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
    const environment = loadEnvironment(project, environmentName);
    const resourceOptions = getResourceOptions(environment, project);

    projectResources.registerWharfieResources(resourceOptions);
  }
  if (!yes) {
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
    process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  }
  displayInfo(`destroying wharfie project ${project.name}...`);

  const multibar = monitorProjectDestroyReconcilables(projectResources);

  await projectResources.destroy();

  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Destroyed wharfie project ${project.name} successfully`);
};

exports.command = 'destroy [path]';
exports.desc = 'destroy wharfie project';
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
    })
    .option('yes', {
      alias: 'y',
      type: 'boolean',
      describe: 'approve destruction',
    });
};
/**
 * @typedef projectDestroyCLIParams
 * @property {string} path -
 * @property {string} environment -
 * @property {boolean} yes -
 * @param {projectDestroyCLIParams} params -
 */
exports.handler = async function ({ path, environment, yes }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await destroy(path, environment, yes);
  } catch (err) {
    handleError(err);
  }
};
