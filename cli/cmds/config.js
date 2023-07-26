'use strict';

const fs = require('fs');
const inquirer = require('inquirer');
const S3 = require('../../lambdas/lib/s3');

const { displaySuccess, displayFailure } = require('../output');
exports.command = 'config';
exports.desc = 'configure the cli';
exports.builder = {};
exports.handler = async function () {
  const config = {};
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'input',
          name: 'region',
          message: 'Enter your aws region:',
          default: 'us-west-2',
        },
        {
          type: 'input',
          name: 'deployment_name',
          message: 'Enter your wharfie deployment name:',
        },
      ])
      .then(resolve)
      .catch((err) => {
        displayFailure(err);
        reject(err);
      });
  });

  config.region = answers.region;
  config.deployment_name = answers.deployment_name;

  const s3 = new S3({
    region: config.region,
  });
  const bucketAnswer = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'list',
          choices: ['create new', 'use existing'],
          name: 'artifact_bucket',
          message: 'Enter the s3 bucket to use for deploy artifacts:',
        },
      ])
      .then(resolve)
      .catch((err) => {
        displayFailure(err);
        reject(err);
      });
  });
  if (bucketAnswer.artifact_bucket === 'create new') {
    const bucketAnswer = await new Promise((resolve, reject) => {
      inquirer
        .prompt([
          {
            type: 'input',
            name: 'bucket_name',
            message: 'Enter a name for the s3 bucket to create:',
          },
        ])
        .then(resolve)
        .catch((err) => {
          displayFailure(err);
          reject(err);
        });
    });

    await s3.createBucket({
      Bucket: bucketAnswer.bucket_name,
    });
    config.artifact_bucket = bucketAnswer.bucket_name;
    displaySuccess('Bucket created.');
  } else {
    const { Buckets } = await s3.listBuckets({});
    const bucketAnswer = await new Promise((resolve, reject) => {
      inquirer
        .prompt([
          {
            type: 'list',
            choices: Buckets.map((b) => b.Name),
            name: 'artifact_bucket',
            message: 'Select the s3 bucket to use for deploy artifacts:',
          },
        ])
        .then(resolve)
        .catch((err) => {
          displayFailure(err);
          reject(err);
        });
    });
    config.artifact_bucket = bucketAnswer.artifact_bucket;
  }

  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(config));
  displaySuccess('Configuration Saved 🎉');
};
