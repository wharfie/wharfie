'use strict';

const inquirer = require('inquirer');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../../output');
const WharfieDeployment = require('../../../../lambdas/lib/actor/wharfie-deployment');

const config = async (development) => {
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'number',
          name: 'globalQueryConcurrency',
          message:
            'enter the maximum number of concurrent queries this deployment can run',
          default: 10,
        },
        {
          type: 'number',
          name: 'resourceQueryConcurrency',
          message:
            'enter the maximum number of concurrent queries any resource in this deployment can run',
          default: 10,
        },
        {
          type: 'number',
          name: 'maxQueriesPerAction',
          message:
            'enter the maximum number of total queries any action can request',
          default: 10000,
        },
        {
          type: 'list',
          name: 'loggingLevel',
          message: 'enter the logging level for the deployment',
          choices: ['debug', 'info', 'warn', 'error'],
          default: 'info',
        },
      ])
      .then(resolve)
      .catch(reject);
  });
  displayInfo(`updating wharfie deployment configuration...`);
  const deployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME,
    properties: answers,
  });
  await deployment.reconcile();
  displaySuccess(`Wharfie deployment configuration successfully updated`);
};

exports.command = 'config';
exports.desc = 'modify wharfie deployment settings';
exports.builder = (yargs) => {
  yargs.option('development', {
    type: 'boolean',
    alias: 'dev',
    default: false,
  });
};
exports.handler = async function ({ development }) {
  try {
    await config(development);
  } catch (err) {
    displayFailure(err);
  }
};
