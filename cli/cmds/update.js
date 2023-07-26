'use strict';

const child_process = require('child_process');
const inquirer = require('inquirer');
const CloudFormation = require('../../lambdas/lib/cloudformation');
const { displayFailure, displayInfo, displaySuccess } = require('../output');

const cloudformation = new CloudFormation();

const update = async (projectPath, projectName) => {
  const template = require(projectPath);
  const stackName = projectName;
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
          if (key === 'Deployment') {
            p.Default = `${process.env.WHARFIE_DEPLOYMENT_NAME}`;
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
  displayInfo(`Updating wharfie project: ${projectName}...`);
  await cloudformation.updateStack({
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
  displaySuccess(`Updated wharfie project: ${projectName}`);
};

exports.command = 'update [project_directory] [project_name]';
exports.desc = 'update wharfie project';
exports.builder = (yargs) => {
  yargs
    .positional('project_directory', {
      type: 'string',
      describe: 'the wharfie project directory path',
      demand: 'Please provide a wharfie project directory filepath',
    })
    .positional('project_name', {
      type: 'string',
      describe: 'the wharfie project name',
      demand: 'Please provide a wharfie project name',
    })
    .example('wharfie update ./project_dir test-project');
};
exports.handler = async function ({ project_directory }) {
  try {
    await update(project_directory);
  } catch (err) {
    displayFailure(err);
  }
};
