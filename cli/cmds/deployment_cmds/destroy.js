'use strict';

const inquirer = require('inquirer');
const ansiEscapes = require('ansi-escapes');

const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const monitorDeploymentDestroyReconcilables = require('../../output/deployment/destroy');

const destroy = async () => {
  let deployment;
  try {
    deployment = await load({
      deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
    });
  } catch (error) {
    if (
      !['No resource found', 'Resource was not stored'].includes(error.message)
    )
      throw error;
    deployment = new WharfieDeployment({
      name: process.env.WHARFIE_DEPLOYMENT_NAME,
    });
    await deployment;
  }
  const bucket = deployment.getBucket();
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
  displayInfo(`Destroying wharfie deployment...`);

  const multibar = monitorDeploymentDestroyReconcilables(deployment);
  await deployment.destroy();
  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  // process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Destroyed wharfie deployment`);
};

exports.command = 'destroy';
exports.desc = 'destroy wharfie deployment';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await destroy();
  } catch (err) {
    displayFailure(err.stack);
  }
};
