import { defaultProvider } from '@aws-sdk/credential-provider-node';

import STS from '../core/lib/aws/sts.js';

const configuration = {
  region: process.env.WHARFIE_REGION,
  deployment_name: process.env.WHARFIE_DEPLOYMENT_NAME,
  service_bucket: process.env.WHARFIE_SERVICE_BUCKET,
};

const LEGACY_CONFIG_HINT =
  'Run `wharfie config` if you are using the legacy AWS deployment workflow.';

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
      `Legacy Wharfie AWS region not found. ${LEGACY_CONFIG_HINT}`,
    );
  }
  if (!deployment_name) {
    throw new Error(
      `Legacy Wharfie deployment name not found. ${LEGACY_CONFIG_HINT}`,
    );
  }
  if (!service_bucket) {
    throw new Error(
      `Legacy Wharfie service bucket not found. ${LEGACY_CONFIG_HINT}`,
    );
  }
};

/**
 * @param {unknown} err - Error value.
 * @returns {string} - Message.
 */
function getErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * @param {CLIConfig} params -
 * @returns {void}
 */
export function setConfig({ deployment_name, region, service_bucket }) {
  check({ deployment_name, region, service_bucket });
  configuration.region = region;
  configuration.deployment_name = deployment_name;
  configuration.service_bucket = service_bucket;
}

/**
 * @returns {void}
 */
export function clearConfig() {
  configuration.region = undefined;
  configuration.deployment_name = undefined;
  configuration.service_bucket = undefined;
}

/**
 * @returns {CLIConfig}
 */
export function getConfig() {
  check(configuration);
  return { ...configuration };
}

/**
 * @returns {void}
 */
export function setEnvironment() {
  process.env.WHARFIE_REGION = configuration.region;
  process.env.WHARFIE_DEPLOYMENT_NAME = configuration.deployment_name;
  process.env.AWS_REGION = configuration.region;
  process.env.OPERATIONS_TABLE = `${configuration.deployment_name}-operations`;
  process.env.WHARFIE_SERVICE_BUCKET = configuration.service_bucket;
  process.env.WHARFIE_ARTIFACT_BUCKET = configuration.service_bucket;
}

/**
 * @returns {Promise<void>}
 */
export async function validate() {
  let credentials;
  const sts = new STS();

  const credentialProvider = defaultProvider();
  try {
    credentials = await credentialProvider();
  } catch (err) {
    throw new Error(
      'AWS credentials are not configured for the legacy Wharfie deployment workflow. Please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html ' +
        `\nfailed with this error:\n${getErrorMessage(err)}`,
    );
  }

  const keySet = credentials.accessKeyId && credentials.secretAccessKey;
  const sessionSet = credentials.sessionToken;

  if (!keySet || !sessionSet) {
    throw new Error(
      'AWS credentials are incomplete for the legacy Wharfie deployment workflow. Please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html',
    );
  }

  const region = await sts.sts.config.region();
  if (!region) {
    throw new Error(
      'AWS Region is not configured for the legacy Wharfie deployment workflow. Please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html',
    );
  }

  check(configuration);
}

const cliConfig = {
  setConfig,
  clearConfig,
  getConfig,
  setEnvironment,
  validate,
};

export default cliConfig;
