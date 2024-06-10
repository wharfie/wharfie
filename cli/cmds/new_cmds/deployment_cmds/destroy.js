'use strict';

const inquirer = require('inquirer');

const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../../output');
const { load } = require('../../../../lambdas/lib/actor/deserialize');

const destroy = async () => {
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
  });
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
  await deployment.destroy();
  displaySuccess(`Destroyed wharfie deployment`);
};

exports.command = 'destroy';
exports.desc = 'destroy wharfie deployment';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await destroy();
  } catch (err) {
    displayFailure(err);
  }
};
