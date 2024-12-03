'use strict';

const { Command } = require('commander');
const ansiEscapes = require('../../output/escapes');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

/**
 * Creates a new Wharfie deployment or updates an existing one.
 * @returns {Promise<void>}
 */
const create = async () => {
  displayInfo('Creating Wharfie deployment...');
  let deployment;

  try {
    deployment = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
  } catch (error) {
    deployment = new WharfieDeployment({
      name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
  }

  const multibar = monitorDeploymentCreateReconcilables(deployment);
  await deployment.reconcile();
  multibar.stop();

  process.stdout.write(ansiEscapes.eraseLines(2));
  displaySuccess('Created Wharfie deployment.');
};

const createCommand = new Command('create')
  .description('Create a Wharfie deployment')
  .action(async () => {
    try {
      await create();
    } catch (err) {
      if (err instanceof Error)
        displayFailure(err.stack || 'An error occurred.');
      else displayFailure(err);
    }
  });

module.exports = createCommand;
