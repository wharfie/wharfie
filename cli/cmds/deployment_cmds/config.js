'use strict';

const { Command } = require('commander');
const inquirer = require('inquirer');
const { displayInfo, displaySuccess } = require('../../output/basic');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { handleError } = require('../../output/error');
const ansiEscapes = require('../../output/escapes');
const { load } = require('../../../lambdas/lib/actor/deserialize/full');
const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

/**
 * Configures the Wharfie deployment settings.
 * @param {boolean} development - Flag indicating if development mode is enabled.
 */
const config = async (development) => {
  const existingDeployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });

  const answers = await inquirer.prompt([
    {
      type: 'number',
      name: 'globalQueryConcurrency',
      message:
        'Enter the maximum number of concurrent queries this deployment can run',
      default: existingDeployment.get('globalQueryConcurrency', 10),
    },
    {
      type: 'number',
      name: 'resourceQueryConcurrency',
      message:
        'Enter the maximum number of concurrent queries any resource in this deployment can run',
      default: existingDeployment.get('resourceQueryConcurrency', 10),
    },
    {
      type: 'number',
      name: 'maxQueriesPerAction',
      message:
        'Enter the maximum number of total queries any action can request',
      default: existingDeployment.get('maxQueriesPerAction', 10000),
    },
    {
      type: 'list',
      name: 'loggingLevel',
      message: 'Enter the logging level for the deployment',
      choices: ['debug', 'info', 'warn', 'error'],
      default: existingDeployment.get('loggingLevel', 'info'),
    },
  ]);

  process.stdout.write(ansiEscapes.eraseLines(4));
  displayInfo('Updating Wharfie deployment configuration...');

  const updatedDeployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    properties: answers,
  });

  const multibar = monitorDeploymentCreateReconcilables(updatedDeployment);
  await updatedDeployment.reconcile();
  multibar.stop();

  process.stdout.write(ansiEscapes.eraseLines(1));
  displaySuccess('Wharfie deployment configuration successfully updated.');
};

const configCommand = new Command('config')
  .description('Modify Wharfie deployment settings')
  .option('--development, --dev', 'Enable development mode', false)
  .action(async (options) => {
    const { development } = options;
    try {
      await config(development);
    } catch (err) {
      handleError(err);
    }
  });

module.exports = configCommand;
