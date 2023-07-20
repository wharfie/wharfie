'use strict';

const child_process = require('child_process');
const inquirer = require('inquirer');
const CloudFormation = require('../../../lambdas/lib/cloudformation');
const STS = require('../../../lambdas/lib/sts');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const config = require('../../config');

const { region, deployment_name, artifact_bucket } = config.getConfig();
process.env.AWS_REGION = region;
process.env.RESOURCE_TABLE = deployment_name;
process.env.TEMPLATE_BUCKET = artifact_bucket;

const cloudformation = new CloudFormation({ region });
const sts = new STS({ region });

const deployment_template = require('../../../cloudformation/wharfie.template.js');
const examples_template = require('../../../cloudformation/wharfie-examples.template.js');
const example_bucket_template = require('../../../cloudformation/wharfie-examples-bucket.template.js');

const create = async (resourceType) => {
  let template, stackName;
  if (resourceType === 'deployment') {
    template = deployment_template;
    stackName = deployment_name;
  } else if (resourceType === 'examples') {
    template = examples_template;
    stackName = `${deployment_name}-examples`;
  } else if (resourceType === 'examples-bucket') {
    template = example_bucket_template;
    stackName = `${deployment_name}-examples-bucket`;
  } else {
    throw new Error(`Unknown resource type: ${resourceType}`);
  }
  const { Account: accountId } = await sts.getCallerIdentity();
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt(
        Object.keys(template.Parameters).map((key) => {
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
          if (key === 'ExamplesBucket') {
            p.Default = `${deployment_name}-examples-bucket-${accountId}-${region}`;
          }
          if (key === 'Deployment') {
            p.Default = `${deployment_name}`;
          }
          return {
            name: key,
            message: p.Description,
            default: p.Default,
            type,
            choices: p.AllowedValues,
          };
        })
      )
      .then(resolve)
      .catch(reject);
  });
  displayInfo(`Creating wharfie ${resourceType}...`);
  await cloudformation.createStack({
    StackName: stackName,
    Tags: [],
    Parameters: Object.keys(answers).map((key) => {
      return {
        ParameterKey: key,
        ParameterValue: String(answers[key]),
      };
    }),
    Capabilities: ['CAPABILITY_IAM'],
    TemplateBody: JSON.stringify(template),
  });
  displaySuccess(`Created wharfie ${resourceType}`);
};

exports.command = 'create [resourceType]';
exports.desc = 'create wharfie resources';
exports.builder = (yargs) => {
  yargs.choices('resourceType', ['deployment', 'examples', 'examples-bucket']);
};
exports.handler = async function ({ resourceType, deploymentName }) {
  try {
    await create(resourceType, deploymentName);
  } catch (err) {
    console.error(err);
    displayFailure(err);
  }
};
