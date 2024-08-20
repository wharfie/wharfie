'use strict';

const fs = require('fs');
const inquirer = require('inquirer');
const STS = require('../../lambdas/lib/sts');
const sts = new STS();

const { displaySuccess, displayFailure } = require('../output');
exports.command = 'config';
exports.desc = 'configure the cli';
exports.builder = {};
exports.handler = async function () {
  const config = {};
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'input',
          name: 'region',
          message: 'Enter your aws region:',
          default: 'us-west-2',
        },
        {
          type: 'input',
          name: 'deployment_name',
          message: 'Enter your wharfie deployment name:',
        },
      ])
      .then(resolve)
      .catch((err) => {
        displayFailure(err);
        reject(err);
      });
  });
  const { Account } = await sts.getCallerIdentity();

  config.region = answers.region;
  config.deployment_name = answers.deployment_name;
  config.service_bucket = `${config.deployment_name}-${Account}-${config.region}`;
  if (!process.env.CONFIG_PATH) throw new Error('CONFIG_PATH not set');

  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(config));
  displaySuccess('Configuration Saved 🎉');
};
