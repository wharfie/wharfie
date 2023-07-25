'use strict';
const child_process = require('child_process');
const inquirer = require('inquirer');
const CloudFormation = require('../../../lambdas/lib/cloudformation');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const { version } = require('../../../package.json');

const cloudformation = new CloudFormation();

const deployment_template = require('../../../cloudformation/deployment/wharfie.template.js');

const create = async (development) => {
  const template = deployment_template;
  const stackName = process.env.WHARFIE_DEPLOYMENT_NAME;

  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt(
        Object.keys(template.Parameters).reduce((acc, key) => {
          if (['Version', 'IsDevelopment', 'ArtifactBucket'].includes(key)) {
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
            if (development) {
              p.Default = child_process
                .execSync('git rev-parse HEAD')
                .toString()
                .trim();
            } else {
              return acc;
            }
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
  displayInfo(`Creating wharfie deployment...`);
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
      {
        ParameterKey: 'Version',
        ParameterValue: version,
      },
      {
        ParameterKey: 'ArtifactBucket',
        ParameterValue: process.env.WHARFIE_ARTIFACT_BUCKET,
      },
      {
        ParameterKey: 'IsDevelopment',
        ParameterValue: String(development),
      },
      ...(development
        ? []
        : [{ ParameterKey: 'GitSha', ParameterValue: version }]),
    ],
    Capabilities: ['CAPABILITY_IAM'],
    TemplateBody: JSON.stringify(template),
  });
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
    displayFailure(err);
  }
};
