'use strict';

const inquirer = require('inquirer');
const { displayInfo, displaySuccess } = require('../../output/basic');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { handleError } = require('../../output/error');
const ansiEscapes = require('../../output/escapes');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

/**
 * @param {string} development -
 */
const config = async (development) => {
  const existingDeployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'number',
          name: 'globalQueryConcurrency',
          message:
            'enter the maximum number of concurrent queries this deployment can run',
          default: existingDeployment.get('globalQueryConcurrency', 10),
        },
        {
          type: 'number',
          name: 'resourceQueryConcurrency',
          message:
            'enter the maximum number of concurrent queries any resource in this deployment can run',
          default: existingDeployment.get('resourceQueryConcurrency', 10),
        },
        {
          type: 'number',
          name: 'maxQueriesPerAction',
          message:
            'enter the maximum number of total queries any action can request',
          default: existingDeployment.get('maxQueriesPerAction', 10000),
        },
        {
          type: 'list',
          name: 'loggingLevel',
          message: 'enter the logging level for the deployment',
          choices: ['debug', 'info', 'warn', 'error'],
          default: existingDeployment.get('loggingLevel', 'info'),
        },
      ])
      .then(resolve)
      .catch(reject);
  });
  process.stdout.write(ansiEscapes.eraseLines(4));
  displayInfo(`updating wharfie deployment configuration...`);
  const updatedDeployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    properties: answers,
  });
  const multibar = monitorDeploymentCreateReconcilables(updatedDeployment);
  await updatedDeployment.reconcile();
  multibar.stop();
  process.stdout.write(ansiEscapes.eraseLines(5));
  displaySuccess(`Wharfie deployment configuration successfully updated`);
};

exports.command = 'config';
exports.desc = 'modify wharfie deployment settings';

/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = (yargs) => {
  yargs.option('development', {
    type: 'boolean',
    alias: 'dev',
    default: false,
  });
};
/**
 * @typedef deploymentConfigCLIParams
 * @property {string} development -
 * @param {deploymentConfigCLIParams} params -
 */
exports.handler = async function ({ development }) {
  try {
    await config(development);
  } catch (err) {
    handleError(err);
  }
};
