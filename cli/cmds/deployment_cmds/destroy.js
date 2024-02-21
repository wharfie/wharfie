'use strict';

const inquirer = require('inquirer');

const CloudFormation = require('../../../lambdas/lib/cloudformation');
const S3 = require('../../../lambdas/lib/s3');
const STS = require('../../../lambdas/lib/sts');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const cloudformation = new CloudFormation();
const s3 = new S3();
const sts = new STS();

const destroy = async () => {
  const stackName = process.env.WHARFIE_DEPLOYMENT_NAME;
  const { Account } = await sts.getCallerIdentity();
  const bucketName = `${stackName}-${Account}-${process.env.WHARFIE_REGION}`;

  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'confirm',
          name: 'confirmation',
          message: `This will destroy the deployment and all data stored in the ${bucketName} S3 bucket. Are you sure?`,
          default: false,
        },
      ])
      .then(resolve)
      .catch(reject);
  });
  if (!answers.confirmation) {
    displayFailure('destroy cancelled');
    return;
  }

  displayInfo(`Destroying wharfie deployment...`);
  await s3.deletePath({
    Bucket: bucketName,
  });
  await cloudformation.deleteStack({
    StackName: stackName,
  });
  displaySuccess(`Destroyed wharfie deployment`);
};

exports.command = 'destroy';
exports.desc = 'destroy wharfie deployment';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await destroy();
  } catch (err) {
    displayFailure(err);
  }
};
