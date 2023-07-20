'use strict';

const { displayFailure, displayInstruction } = require('../output');
const config = require('../config');
const CloudFormation = require('../../lambdas/lib/cloudformation');

const open = require('open');

const monitor = async (resource_id) => {
  const { region } = config.getConfig();
  const cloudformation = new CloudFormation({
    region,
  });
  const { StackResources } = await cloudformation.describeStackResources({
    StackName: resource_id,
  });
  const name = StackResources.find(
    (resource) => resource.ResourceType === 'AWS::CloudWatch::Dashboard'
  ).PhysicalResourceId;
  await open(
    `https://console.aws.amazon.com/cloudwatch/home?region=${region}#dashboards:name=${name}`
  );
};

exports.command = 'dashboard [resource_id]';
exports.desc = 'goto resource dashboard';
exports.builder = (yargs) => {
  yargs.positional('resource_id', {
    type: 'string',
    describe: 'the wharfie resource id',
    demand: 'Please provide a resource id',
  });
};
exports.handler = async function ({ resource_id }) {
  if (!resource_id) {
    displayInstruction("Param 'resource_id' Missing 🙁");
    return;
  }
  try {
    await monitor(resource_id);
  } catch (err) {
    displayFailure(err);
  }
};
