'use strict';
const ansiEscapes = require('ansi-escapes');

const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

const create = async () => {
  displayInfo(`Creating wharfie deployment...`);
  const deployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME,
  });
  const multibar = monitorDeploymentCreateReconcilables(deployment);
  await deployment.reconcile();
  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
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
