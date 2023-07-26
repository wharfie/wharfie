'use strict';

const child_process = require('child_process');
const inquirer = require('inquirer');
const CloudFormation = require('../../../lambdas/lib/cloudformation');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const cloudformation = new CloudFormation();

const examples_template = require('../../../cloudformation/examples/wharfie-examples.template.js');

const create = async () => {
  const template = examples_template;
  const stackName = `${process.env.WHARFIE_DEPLOYMENT_NAME}-examples`;

  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt(
        Object.keys(template.Parameters).reduce((acc, key) => {
          if (['Version', 'Deployment', 'ArtifactBucket'].includes(key)) {
            return acc;
          }
          const p = template.Parameters[key];
          let type = 'input';
          if (p.Type === 'Number') {
            type = 'number';
          } else if (p.AllowedValues) {
            type = 'list';
          }
          if (key === 'GitSha') {
            p.Default = child_process
              .execSync('git rev-parse HEAD')
              .toString()
              .trim();
          }
          return acc.concat({
            name: key,
            message: p.Description,
            default: p.Default,
            type,
            choices: p.AllowedValues,
          });
        }, [])
      )
      .then(resolve)
      .catch(reject);
  });
  displayInfo(`Creating wharfie examples...`);
  await cloudformation.createStack({
    StackName: stackName,
    Tags: [],
    Parameters: [
      ...Object.keys(answers).map((key) => {
        return {
          ParameterKey: key,
          ParameterValue: String(answers[key]),
        };
      }),
      // {
      //   ParameterKey: 'Version',
      //   ParameterValue: version,
      // },
      {
        ParameterKey: 'Deployment',
        ParameterValue: process.env.WHARFIE_DEPLOYMENT_NAME,
      },
      {
        ParameterKey: 'ArtifactBucket',
        ParameterValue: process.env.WHARFIE_ARTIFACT_BUCKET,
      },
    ],
    Capabilities: ['CAPABILITY_IAM'],
    TemplateBody: JSON.stringify(template),
  });
  displaySuccess(`Created wharfie examples`);
};

exports.command = 'create';
exports.desc = 'create wharfie examples';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await create();
  } catch (err) {
    console.error(err);
    displayFailure(err);
  }
};
