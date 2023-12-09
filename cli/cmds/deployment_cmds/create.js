'use strict';
const child_process = require('child_process');
const inquirer = require('inquirer');
const { createId } = require('../../../lambdas/lib/id');
const ON_DEATH = require('death');
const CloudFormation = require('../../../lambdas/lib/cloudformation');
const STS = require('../../../lambdas/lib/sts');
const S3 = require('../../../lambdas/lib/s3');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const { version } = require('../../../package.json');

const sts = new STS();
const s3 = new S3();

const deployment_template = require('../../../cloudformation/deployment/wharfie.template.js');

const create = async (development) => {
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
  displayInfo(`Creating wharfie deployment...`);
  const { Account } = await sts.getCallerIdentity();

  const temporaryBucketName = `wharfie-temp-bootstrap-${createId()}`;
  await s3.createBucket({
    Bucket: temporaryBucketName,
  });
  const cleanupTemporaryBucket = async () => {
    await s3.deletePath({
      Bucket: temporaryBucketName,
    });
    await s3.deleteBucket({
      Bucket: temporaryBucketName,
    });
  };
  ON_DEATH(async function (_signal, _err) {
    await cleanupTemporaryBucket();
  });

  const cloudformation = new CloudFormation(
    {},
    {
      artifact_bucket: temporaryBucketName,
    }
  );
  try {
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
        ...defaultParams,
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
  } catch (err) {
    cleanupTemporaryBucket();
    throw err;
  }

  cleanupTemporaryBucket();
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
