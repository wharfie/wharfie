'use strict';

const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const SQS = require('../../../lambdas/lib/sqs');
const loadEnvironment = require('../../project/load-environment');
const { getResourceOptions } = require('../../project/template-actor');
const WharfieProject = require('../../../lambdas/lib/actor/resources/wharfie-project');

const { displayInfo, displaySuccess } = require('../../output/basic');
const ansiEscapes = require('../../output/escapes');
const { handleError } = require('../../output/error');

const sqs = new SQS({});

/**
 * @param {string} path -
 * @param {string} environmentName -
 */
const maintain = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  displayInfo(`dispatching maintain events for ${project.name}...`);
  const environment = loadEnvironment(project, environmentName);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });
  if (deployment instanceof WharfieProject)
    throw new Error('should not have loaded a project');
  const resourceOptions = getResourceOptions(environment, project);

  await Promise.all(
    resourceOptions.map((options) => {
      return sqs.enqueue(
        {
          operation_type: 'MAINTAIN',
          action_type: 'START',
          resource_id: `${project.name}.${options.name}`,
          operation_started_at: new Date().toISOString(),
        },
        deployment.getDaemonActor().getQueue().get('url')
      );
    })
  );

  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Maintain events dispatched`);
};

exports.command = 'maintain [path]';
exports.desc = 'Maintain wharfie project changes';
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
    await maintain(path, environment);
  } catch (err) {
    handleError(err);
  }
};
