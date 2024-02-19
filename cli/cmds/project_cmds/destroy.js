'use strict';

const inquirer = require('inquirer');

const CloudFormation = require('../../../lambdas/lib/cloudformation');
const S3 = require('../../../lambdas/lib/s3');
const STS = require('../../../lambdas/lib/sts');
const loadProject = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const { getStackName } = require('../../project/template');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const cloudformation = new CloudFormation();
const s3 = new S3();
const sts = new STS();

const destroy = async (path, environmentName) => {
  const project = await loadProject({
    path,
  });
  const environment = loadEnvironment(project, environmentName);
  const stackName = getStackName(project, environment);
  const { Account } = await sts.getCallerIdentity();

  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'confirm',
          name: 'confirmation',
          message: `This will destroy the project including all processed data in the ${stackName}-${Account}-${process.env.WHARFIE_REGION} S3 bucket. Are you sure?`,
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
  displayInfo(`destroying wharfie project ${stackName}...`);
  await s3.deletePath({
    Bucket: `${stackName}-${Account}-${process.env.WHARFIE_REGION}`,
  });
  await cloudformation.deleteStack({
    StackName: stackName,
  });
  displaySuccess(`destroyed wharfie project ${stackName} successfully`);
};

exports.command = 'destroy [path]';
exports.desc = 'destroy wharfie project';
exports.builder = (yargs) => {
  yargs
    .positional('path', {
      type: 'string',
      describe: 'the path of the wharfie project root',
      optional: true,
    })
    .option('environment', {
      alias: 'e',
      type: 'string',
      describe: 'the wharfie project environment to use',
    });
};
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await destroy(path, environment);
  } catch (err) {
    displayFailure(err);
  }
};
