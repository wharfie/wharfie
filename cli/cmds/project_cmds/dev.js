'use strict';
const chokidar = require('chokidar');

const loadProject = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const { getResourceOptions } = require('../../project/template-actor');

/**
 * @param {function} func -
 * @param {number} wait -
 * @returns {function} -
 */
function debounceAsync(func, wait) {
  let timeout;
  return function (...args) {
    const context = this;
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

const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const dev = async (projectPath, environmentName) => {
  const project = await loadProject({
    path: projectPath,
  });
  displayInfo(`Starting dev server for ${project.name}...`);

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
    if (error.message !== 'No resource found') throw error;
    projectResources = new WharfieProject({
      deployment,
      name: project.name,
    });
  }

  let pendingChanges = [];
  const handleBatchChanges = debounceAsync(async () => {
    const project = await loadProject({
      path: projectPath,
    });
    const resourceOptions = getResourceOptions(environment, project);
    projectResources.registerWharfieResources(resourceOptions);
    await projectResources.reconcile();
    displaySuccess('Changes applied');
    pendingChanges = [];
  }, 200);

  const watcher = chokidar.watch('.');
  // Add event listeners.
  watcher
    .on('add', (path) => {
      pendingChanges.push(path);
      handleBatchChanges();
    })
    .on('change', (path) => {
      pendingChanges.push(path);
      handleBatchChanges();
    })
    .on('unlink', (path) => {
      pendingChanges.push(path);
      handleBatchChanges();
    })
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
    await dev(path, environment);
  } catch (err) {
    displayFailure(err);
  }
};
