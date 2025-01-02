'use strict';

const { Command } = require('commander');
const fs = require('fs');
const path = require('path');
const { loadProject } = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const { load } = require('../../../lambdas/lib/actor/deserialize/full');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { getResourceOptions } = require('../../project/template-actor');
const ansiEscapes = require('../../output/escapes');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const monitorProjectApplyReconcilables = require('../../output/project/apply');
const { handleError } = require('../../output/error');

/**
 * Creates a debounced function with a queue to handle async calls.
 * @param {function} func - The function to debounce.
 * @param {number} delay - The debounce delay in milliseconds.
 * @returns {function} The debounced function.
 */
function debounceWithQueue(func, delay) {
  // @ts-ignore
  let timeoutId;
  let inFlight = false;
  let queuedCall = false;

  // @ts-ignore
  return async function (...args) {
    if (inFlight) {
      queuedCall = true;
      return;
    }

    // @ts-ignore
    clearTimeout(timeoutId);

    timeoutId = setTimeout(async () => {
      inFlight = true;
      try {
        await func(...args);
      } finally {
        inFlight = false;
        if (queuedCall) {
          queuedCall = false;
          await func(...args);
        }
      }
    }, delay);
  };
}

/**
 * Starts the development server for a Wharfie project.
 * @param {string} projectPath - The path to the Wharfie project root.
 * @param {string} environmentName - The Wharfie project environment to use.
 */
const dev = async (projectPath, environmentName) => {
  console.clear();
  displayInfo('Starting dev server...');
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });

  if (deployment instanceof WharfieProject) {
    throw new Error('Should not have loaded a project');
  }

  const handleBatchChanges = debounceWithQueue(async () => {
    console.clear();
    let project, environment;
    try {
      project = await loadProject({ path: projectPath });
      environment = loadEnvironment(project, environmentName);
    } catch (error) {
      handleError(error);
      return;
    }

    displayInfo(`Applying changes to ${project.name}...`);
    let projectResources;
    try {
      projectResources = await load({
        deploymentName: deployment.name,
        resourceKey: project.name,
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (
        !['No resource found', 'Resource was not stored'].includes(
          error.message
        )
      ) {
        displayFailure(error.message);
        return;
      }
      projectResources = new WharfieProject({
        deployment,
        name: project.name,
      });
    }

    try {
      const resourceOptions = getResourceOptions(environment, project);
      if (projectResources instanceof WharfieDeployment) {
        throw new Error('Should not have loaded a project');
      }

      projectResources.registerWharfieResources(resourceOptions);
      const multibar = monitorProjectApplyReconcilables(projectResources);
      await projectResources.reconcile();
      multibar.stop();
      process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
      process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
      displaySuccess(`Project ${project.name} is up to date.`);
    } catch (error) {
      handleError(error);
    }
  }, 200);

  // File watcher using fs.watch
  const watcher = fs.watch(
    projectPath,
    { recursive: true },
    (eventType, filename) => {
      if (filename) {
        displayInfo(`File ${eventType}: ${path.join(projectPath, filename)}`);
        handleBatchChanges();
      }
    }
  );

  watcher.on('error', (error) => {
    displayFailure(`Watcher error: ${error}`);
  });

  process.on('SIGINT', () => {
    displayInfo('Shutting down gracefully...');
    watcher.close();
    // eslint-disable-next-line no-process-exit
    process.exit(0);
  });

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

const devCommand = new Command('dev')
  .description('Development server file watcher for Wharfie project')
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
      await dev(path, environment);
    } catch (err) {
      handleError(err);
    }
  });

module.exports = devCommand;
