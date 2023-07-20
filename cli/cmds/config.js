'use strict';

const fs = require('fs');
const inquirer = require('inquirer');

const { displaySuccess, displayFailure } = require('../output');
exports.command = 'config';
exports.desc = 'configure the cli';
exports.builder = {};
exports.handler = async function () {
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
        {
          type: 'input',
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
  fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(answers));
  displaySuccess();
};
