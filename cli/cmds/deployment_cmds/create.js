'use strict';
const ansiEscapes = require('../../output/escapes');

const WharfieDeployment = require('../../../lambdas/lib/actor/wharfie-deployment');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const monitorDeploymentCreateReconcilables = require('../../output/deployment/create');

const create = async () => {
  displayInfo(`Creating wharfie deployment...`);
  const deployment = new WharfieDeployment({
    name: process.env.WHARFIE_DEPLOYMENT_NAME || '',
  });
  const multibar = monitorDeploymentCreateReconcilables(deployment);
  await deployment.reconcile();
  multibar.stop();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);
  displaySuccess(`Created wharfie deployment`);
};

exports.command = 'create';
exports.desc = 'create wharfie deployment';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = (yargs) => {};
/**
 * @typedef deploymentCreateCLIParams
 * @property {string} development -
 * @param {deploymentCreateCLIParams} params -
 */
exports.handler = async function ({ development }) {
  try {
    await create();
  } catch (err) {
    if (err instanceof Error) displayFailure(err?.stack);
    else displayFailure(err);
  }
};
