'use strict';

const { Command } = require('commander');
const fs = require('fs');
const inquirer = require('inquirer');
const STS = require('../../lambdas/lib/sts');
const { displaySuccess, displayFailure } = require('../output/basic');

const sts = new STS();

const configCommand = new Command('config')
  .description('Configure the CLI')
  .action(async () => {
    try {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'region',
          message: 'Enter your AWS region:',
          default: 'us-west-2',
        },
        {
          type: 'input',
          name: 'deployment_name',
          message: 'Enter your wharfie deployment name:',
        },
      ]);

      const { Account } = await sts.getCallerIdentity();

      const config = {
        region: answers.region,
        deployment_name: answers.deployment_name,
        service_bucket: `${answers.deployment_name}-${Account}-${answers.region}`,
      };

      if (!process.env.CONFIG_FILE_PATH) {
        throw new Error('CONFIG_FILE_PATH not set');
      }

      fs.writeFileSync(process.env.CONFIG_FILE_PATH, JSON.stringify(config));
      displaySuccess('Configuration Saved 🎉');
    } catch (err) {
      displayFailure(err);
    }
  });

module.exports = configCommand;
