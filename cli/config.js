'use strict';
const STS = require('../lambdas/lib/sts');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

const configuration = {
  region: process.env.WHARFIE_REGION,
  deployment_name: process.env.WHARFIE_DEPLOYMENT_NAME,
  service_bucket: process.env.WHARFIE_SERVICE_BUCKET,
};
/**
 * @typedef CLIConfig
 * @property {string} [region] -
 * @property {string} [deployment_name] -
 * @property {string} [service_bucket] -
 */
/**
 * @param {CLIConfig} params -
 */
const check = ({ region, deployment_name, service_bucket }) => {
  if (!region) {
    throw new Error(
      'wharfie region not found. Please make sure you set up the cli config correctly (run `wharfie config`)'
    );
  }
  if (!deployment_name) {
    throw new Error(
      'wharfie service name not found. Please make sure you set up the cli config correctly (run `wharfie config`)'
    );
  }
  if (!service_bucket) {
    throw new Error(
      'wharfie service name not found. Please make sure you set up the cli config correctly (run `wharfie config`)'
    );
  }
};

/**
 *
 */
async function validateConfig() {
  let credentials;
  const sts = new STS();
  // Check credentials
  const credentialProvider = defaultProvider();
  try {
    credentials = await credentialProvider();
  } catch (err) {
    throw new Error(
      // @ts-ignore
      `AWS credentials are not configured for terminal, please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html \nfailed with this error:\n${err.message}`
    );
  }
  const keySet = credentials.accessKeyId && credentials.secretAccessKey;
  const sessionSet = credentials.sessionToken;

  if (!keySet || !sessionSet) {
    throw new Error(
      // @ts-ignore
      `AWS credentials are incomplete in terminal please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html \nfailed with this error:\n${err.message}`
    );
  }

  // // Check region configuration
  const region = await sts.sts.config.region();
  if (!region) {
    throw new Error(
      // @ts-ignore
      `AWS Region is not configured for terminal, please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html \nfailed with this error:\n${err.message}`
    );
  }
  check(configuration);
}

module.exports = {
  /**
   * @param {CLIConfig} params -
   */
  setConfig: ({ deployment_name, region, service_bucket }) => {
    check({ deployment_name, region, service_bucket });
    configuration.region = region;
    configuration.deployment_name = deployment_name;
    configuration.service_bucket = service_bucket;
  },
  clearConfig: () => {
    configuration.region = undefined;
    configuration.deployment_name = undefined;
    configuration.service_bucket = undefined;
  },
  getConfig: () => {
    check(configuration);
    return Object.assign({}, configuration);
  },
  setEnvironment: () => {
    process.env.WHARFIE_REGION = configuration.region;
    process.env.WHARFIE_DEPLOYMENT_NAME = configuration.deployment_name;
    process.env.AWS_REGION = configuration.region;
    process.env.OPERATIONS_TABLE = `${configuration.deployment_name}-operations`;
    process.env.WHARFIE_SERVICE_BUCKET = configuration.service_bucket;
    process.env.WHARFIE_ARTIFACT_BUCKET = configuration.service_bucket;
  },
  validate: validateConfig,
};
