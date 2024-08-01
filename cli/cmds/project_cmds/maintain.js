'use strict';

const { loadProject } = require('../../project/load');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const SQS = require('../../../lambdas/lib/sqs');
const loadEnvironment = require('../../project/load-environment');
const { getResourceOptions } = require('../../project/template-actor');

const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const sqs = new SQS();

const maintain = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  displayInfo(`dispatching maintain events for ${project.name}...`);
  const environment = loadEnvironment(project, environmentName);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
  });
  const resourceOptions = getResourceOptions(environment, project);

  await Promise.all(
    resourceOptions.map((options) => {
      return sqs.enqueue(
        {
          operation_type: 'MAINTAIN',
          action_type: 'START',
          resource_id: options.name,
          operation_started_at: new Date().toISOString(),
        },
        deployment.getDaemonActor().getQueue().get('url')
      );
    })
  );

  displaySuccess(`maintain events dispatched`);
};

exports.command = 'maintain [path]';
exports.desc = 'maintain wharfie project changes';
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
    await maintain(path, environment);
  } catch (err) {
    displayFailure(err);
  }
};
