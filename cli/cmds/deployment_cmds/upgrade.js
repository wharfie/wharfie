'use strict';

const { Command } = require('commander');
const { displayInfo, displaySuccess } = require('../../output/basic');
const { handleError } = require('../../output/error');
const { load } = require('../../../lambdas/lib/actor/deserialize');
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const ansiEscapes = require('../../output/escapes');
const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

/**
 * Upgrades the Wharfie deployment.
 */
const upgrade = async () => {
  displayInfo('Upgrading Wharfie deployment...');
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
  displaySuccess('Upgraded Wharfie deployment.');
};

const upgradeCommand = new Command('upgrade')
  .description('Upgrade Wharfie deployment')
  .option('--development, --dev', 'Enable development mode', false)
  .action(async (options) => {
    try {
      await upgrade();
    } catch (err) {
      handleError(err);
    }
  });

module.exports = upgradeCommand;
