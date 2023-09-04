'use strict';

const child_process = require('child_process');
const inquirer = require('inquirer');
const CloudFormation = require('../../../lambdas/lib/cloudformation');
const STS = require('../../../lambdas/lib/sts');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const { version } = require('../../../package.json');

const deployment_template = require('../../../cloudformation/deployment/wharfie.template.js');

const cloudformation = new CloudFormation();
const sts = new STS();

const upgrade = async (development) => {
  const template = deployment_template;
  const stackName = process.env.WHARFIE_DEPLOYMENT_NAME;
  const defaultParams = [];
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt(
        Object.keys(template.Parameters).reduce((acc, key) => {
          if (['Version', 'IsDevelopment'].includes(key)) {
            return acc;
          }
          const p = template.Parameters[key];
          if (p.Default) {
            defaultParams.push({
              ParameterKey: key,
              ParameterValue: String(p.Default),
            });
            return acc;
          }
          let type = 'input';
          if (p.Type === 'Number') {
            type = 'number';
          } else if (p.AllowedValues) {
            type = 'list';
          }
          if (key === 'ArtifactBucket' && development) {
            delete p.Default;
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
            type,
            choices: p.AllowedValues,
          });
        }, [])
      )
      .then(resolve)
      .catch(reject);
  });
  displayInfo(`Upgrading wharfie deployment to ${version}...`);
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
  displaySuccess(`Wharfie deployment successfully upgraded to ${version}`);
};

exports.command = 'upgrade';
exports.desc = 'upgrade wharfie deployment';
exports.builder = (yargs) => {
  yargs.option('development', {
    type: 'boolean',
    alias: 'dev',
    default: false,
  });
};
exports.handler = async function ({ development }) {
  try {
    await upgrade(development);
  } catch (err) {
    console.trace(err);
    displayFailure(err);
  }
};
