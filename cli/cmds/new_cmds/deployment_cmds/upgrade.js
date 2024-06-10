'use strict';
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../../output');
const { load } = require('../../../../lambdas/lib/actor/deserialize');

const upgrade = async () => {
  displayInfo(`Upgrading wharfie deployment...`);
  const deployment = await load({
    deploymentName: process.env.WHARFIE_DEPLOYMENT_NAME,
  });
  await deployment.reconcile();
  displaySuccess(`Upgraded wharfie deployment`);
};

exports.command = 'upgrade';
exports.desc = 'upgrade wharfie deployment';
exports.builder = (yargs) => {
  yargs.option('development', {
    type: 'boolean',
    alias: 'dev',
    default: false,
  });
};
exports.handler = async function ({ development }) {
  try {
    await upgrade(development);
  } catch (err) {
    displayFailure(err);
  }
};
