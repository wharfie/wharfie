'use strict';

const CloudFormation = require('../../../lambdas/lib/cloudformation');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const cloudformation = new CloudFormation();

const _delete = async () => {
  const stackName = process.env.WHARFIE_DEPLOYMENT_NAME;

  displayInfo(`Deleteing wharfie deployment...`);
  await cloudformation.deleteStack({
    StackName: stackName,
  });
  displaySuccess(`Deleted wharfie deployment`);
};

exports.command = 'delete';
exports.desc = 'delete wharfie deployment';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await _delete();
  } catch (err) {
    displayFailure(err);
  }
};
