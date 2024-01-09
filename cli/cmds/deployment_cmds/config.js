'use strict';

const child_process = require('child_process');
const inquirer = require('inquirer');
const CloudFormation = require('../../../lambdas/lib/cloudformation');
const STS = require('../../../lambdas/lib/sts');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

const deployment_template = require('../../../cloudformation/deployment/wharfie.template.js');

const cloudformation = new CloudFormation();
const sts = new STS();

const config = async (development) => {
  const template = deployment_template;
  const stackName = process.env.WHARFIE_DEPLOYMENT_NAME;
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt(
        Object.keys(template.Parameters).reduce((acc, key) => {
          if (['Version', 'IsDevelopment'].includes(key)) {
            return acc;
          }
          if (key.startsWith('SideEffect')) {
            return acc;
          }
          const p = template.Parameters[key];
          let type = 'input';
          if (p.Type === 'Number') {
            type = 'number';
          } else if (p.AllowedValues) {
            type = 'list';
          }
          if (key === 'ArtifactBucket' && development) {
            delete p.Default;
          } else if (key === 'ArtifactBucket' && !development) {
            return acc;
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
  const { Stacks } = await cloudformation.describeStacks({
    StackName: stackName,
  });
  const version = Stacks[0].Parameters.find(
    (p) => p.ParameterKey === 'Version'
  ).ParameterValue;
  displayInfo(`updating wharfie deployment configuration...`);
  const { Account } = await sts.getCallerIdentity();
  await cloudformation.updateStack({
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
      ...(development
        ? [
            {
              ParameterKey: 'ArtifactBucket',
              ParameterValue: `wharfie-artifacts-${process.env.WHARFIE_REGION}`,
            },
          ]
        : [
            { ParameterKey: 'GitSha', ParameterValue: version },
            {
              ParameterKey: 'ArtifactBucket',
              ParameterValue: `${process.env.WHARFIE_DEPLOYMENT_NAME}-${Account}-${process.env.WHARFIE_REGION}`,
            },
            {
              ParameterKey: 'IsDevelopment',
              ParameterValue: String(development),
            },
          ]),
    ],
    Capabilities: ['CAPABILITY_IAM'],
    TemplateBody: JSON.stringify(template),
  });
  displaySuccess(`Wharfie deployment configuration successfully updated`);
};

exports.command = 'config';
exports.desc = 'modify wharfie deployment settings';
exports.builder = (yargs) => {
  yargs.option('development', {
    type: 'boolean',
    alias: 'dev',
    default: false,
  });
};
exports.handler = async function ({ development }) {
  try {
    await config(development);
  } catch (err) {
    console.trace(err);
    displayFailure(err);
  }
};
