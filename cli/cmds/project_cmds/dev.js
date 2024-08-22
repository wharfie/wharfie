'use strict';
const chokidar = require('chokidar');

const { loadProject } = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { getResourceOptions } = require('../../project/template-actor');
const ansiEscapes = require('../../output/escapes');

/**
 * @param {function} func -
 * @param {number} wait -
 * @returns {function} -
 */
function debounceAsync(func, wait) {
  // @ts-ignore
  let timeout;
  // @ts-ignore
  return function (...args) {
    // @ts-ignore
    const context = this;
    // @ts-ignore
    clearTimeout(timeout);
    return new Promise((resolve, reject) => {
      timeout = setTimeout(async () => {
        try {
          const result = await func.apply(context, args);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      }, wait);
    });
  };
}

const {
  displayFailure,
  displayInfo,
  displaySuccess,
  monitorProjectApplyReconcilables,
} = require('../../output/');

const { handleError } = require('../../output/error');

/**
 * @param {string} projectPath -
 * @param {string} environmentName -
 */
const dev = async (projectPath, environmentName) => {
  console.clear();
  displayInfo(`Starting dev server...`);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });
  if (deployment instanceof WharfieProject)
    throw new Error('should not have loaded a project');

  const handleBatchChanges = debounceAsync(async () => {
    console.clear();
    let project, environment;
    try {
      project = await loadProject({
        path: projectPath,
      });
      environment = loadEnvironment(project, environmentName);
    } catch (error) {
      handleError(error);
      return;
    }
    displayInfo(`applying changes to ${project.name}...`);
    let projectResources;
    try {
      projectResources = await load({
        deploymentName: deployment.name,
        resourceName: project.name,
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (
        !['No resource found', 'Resource was not stored'].includes(
          error.message
        )
      ) {
        displayFailure(error);
        return;
      }
      projectResources = new WharfieProject({
        deployment,
        name: project.name,
      });
    }
    try {
      const resourceOptions = getResourceOptions(environment, project);
      if (projectResources instanceof WharfieDeployment)
        throw new Error('should not have loaded a project');
      projectResources.registerWharfieResources(resourceOptions);
      const multibar = monitorProjectApplyReconcilables(projectResources);
      await projectResources.reconcile();
      multibar.stop();
      process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
      process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
      displaySuccess(`project ${project.name} is up to date`);
    } catch (error) {
      handleError(error);
    }
  }, 200);

  /**
   *
   * @param {string} path -
   */
  function handleWatch(path) {
    handleBatchChanges();
  }

  const watcher = chokidar.watch('.');
  // Add event listeners.
  watcher
    .on('add', handleWatch)
    .on('change', handleWatch)
    .on('unlink', handleWatch)
    .on('error', (error) => {
      displayFailure(`Watcher error: ${error}`);
    });

  process.on('SIGINT', () => {
    displayInfo('Shutting down gracefully...');
    // eslint-disable-next-line no-process-exit
    watcher.close().then(() => process.exit(0));
  });

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

exports.command = 'dev [path]';
exports.desc = 'dev server for wharfie project';
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
 * @typedef projectDevCLIParams
 * @property {string} path -
 * @property {string} environment -
 * @param {projectDevCLIParams} params -
 */
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await dev(path, environment);
  } catch (err) {
    handleError(err);
  }
};
