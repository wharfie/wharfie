'use strict';
const { displayInfo, displaySuccess } = require('../../output/basic');
const { handleError } = require('../../output/error');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const ansiEscapes = require('../../output/escapes');
const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

const upgrade = async () => {
  displayInfo(`Upgrading wharfie deployment...`);
  const existingDeployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });

  const updatedDeployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
    properties: {
      globalQueryConcurrency: existingDeployment.get(
        'globalQueryConcurrency',
        10
      ),
      resourceQueryConcurrency: existingDeployment.get(
        'resourceQueryConcurrency',
        10
      ),
      maxQueriesPerAction: existingDeployment.get('maxQueriesPerAction', 10000),
      loggingLevel: existingDeployment.get('loggingLevel', 'info'),
    },
  });
  const multibar = monitorDeploymentCreateReconcilables(updatedDeployment);
  await updatedDeployment.reconcile();
  multibar.stop();
  process.stdout.write(ansiEscapes.eraseLines(5));
  displaySuccess(`Upgraded wharfie deployment`);
};

exports.command = 'upgrade';
exports.desc = 'upgrade wharfie deployment';

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
 * @typedef deploymentUpgradeCLIParams
 * @property {string} development -
 * @param {deploymentUpgradeCLIParams} params -
 */
exports.handler = async function ({ development }) {
  try {
    await upgrade();
  } catch (err) {
    handleError(err);
  }
};
