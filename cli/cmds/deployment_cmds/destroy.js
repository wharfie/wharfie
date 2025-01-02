'use strict';

const { Command } = require('commander');
const inquirer = require('inquirer');
const ansiEscapes = require('../../output/escapes');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const { load } = require('../../../lambdas/lib/actor/deserialize/full');
const monitorDeploymentDestroyReconcilables = require('../../output/deployment/destroy');

/**
 * Destroys the Wharfie deployment and associated resources.
 * @param {boolean} yes - Flag to skip confirmation prompt.
 */
const destroy = async (yes) => {
  let deployment;

  try {
    deployment = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    ) {
      throw error;
    }
    deployment = new WharfieDeployment({
      name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
  }

  let bucketName;
  try {
    const bucket = deployment.getBucket();
    bucketName = bucket.name;
  } catch (err) {
    // partial deletes can remove this without completing
    bucketName = 'deployment';
  }

  if (!yes) {
    const answers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirmation',
        message: `This will destroy the deployment and all data stored in the ${bucketName} S3 bucket. Are you sure?`,
        default: false,
      },
    ]);

    if (!answers.confirmation) {
      displayFailure('Destroy cancelled');
      return;
    }

    process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  }

  displayInfo('Destroying Wharfie deployment...');

  const multibar = monitorDeploymentDestroyReconcilables(deployment);
  await deployment.destroy();
  multibar.stop();

  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess('Destroyed Wharfie deployment.');
};

const destroyCommand = new Command('destroy')
  .description('Destroy Wharfie deployment')
  .option('-y, --yes', 'Approve destruction without confirmation prompt')
  .action(async (options) => {
    const { yes } = options;
    try {
      await destroy(yes);
    } catch (err) {
      if (err instanceof Error)
        displayFailure(err.stack || 'An error occurred.');
      else displayFailure(err);
    }
  });

module.exports = destroyCommand;
