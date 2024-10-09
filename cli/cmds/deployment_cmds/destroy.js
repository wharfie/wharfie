'use strict';

const inquirer = require('inquirer');

const ansiEscapes = require('../../output/escapes');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const monitorDeploymentDestroyReconcilables = require('../../output/deployment/destroy');

/**
 * @param {boolean} yes -
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
    )
      throw error;
    deployment = new WharfieDeployment({
      name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    });
  }
  const bucket = deployment.getBucket();
  if (!yes) {
    const answers = await new Promise((resolve, reject) => {
      inquirer
        .prompt([
          {
            type: 'confirm',
            name: 'confirmation',
            message: `This will destroy the deployment and all data stored in the ${bucket.name} S3 bucket. Are you sure?`,
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
  displayInfo(`Destroying wharfie deployment...`);

  const multibar = monitorDeploymentDestroyReconcilables(deployment);
  await deployment.destroy();
  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Destroyed wharfie deployment`);
};

exports.command = 'destroy';
exports.desc = 'destroy wharfie deployment';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = (yargs) => {
  yargs.option('yes', {
    alias: 'y',
    type: 'boolean',
    describe: 'approve destruction',
  });
};
/**
 * @typedef deploymentDestroyCLIParams
 * @property {boolean} yes -
 * @param {deploymentDestroyCLIParams} params -
 */
exports.handler = async function ({ yes }) {
  try {
    await destroy(yes);
  } catch (err) {
    if (err instanceof Error) displayFailure(err?.stack);
    else displayFailure(err);
  }
};
