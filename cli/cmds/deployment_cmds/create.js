'use strict';
const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const create = async () => {
  displayInfo(`Creating wharfie deployment...`);
  const deployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME,
  });
  await deployment.reconcile();
  displaySuccess(`Created wharfie deployment`);
};

exports.command = 'create';
exports.desc = 'create wharfie deployment';
exports.builder = (yargs) => {
  yargs.option('development', {
    type: 'boolean',
    alias: 'dev',
    default: false,
  });
};
exports.handler = async function ({ development }) {
  try {
    await create(development);
  } catch (err) {
    console.trace(err);
    displayFailure(err);
  }
};
