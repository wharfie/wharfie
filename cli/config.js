import { defaultProvider } from '@aws-sdk/credential-provider-node';

import STS from '../lambdas/lib/aws/sts.js';

const configuration = {
  region: process.env.WHARFIE_REGION,
  deployment_name: process.env.WHARFIE_DEPLOYMENT_NAME,
  service_bucket: process.env.WHARFIE_SERVICE_BUCKET,
};

/**
 * @typedef CLIConfig
 * @property {string} [region] - Wharfie AWS region.
 * @property {string} [deployment_name] - Wharfie deployment name.
 * @property {string} [service_bucket] - Wharfie service bucket.
 */

/**
 * @typedef CLIConfigValidationDependencies
 * @property {(() => Promise<{ accessKeyId?: string, secretAccessKey?: string, sessionToken?: string }>)} [credentialProvider] - AWS credential provider.
 * @property {{ sts: { config: { region: () => Promise<string | undefined> } } }} [stsClient] - STS client wrapper.
 */

/**
 * @param {CLIConfig} params - Config values to validate.
 * @returns {void} - Ensures required Wharfie config is present.
 */
const check = ({ region, deployment_name, service_bucket }) => {
  if (!region) {
    throw new Error(
      'wharfie region not found. Please make sure you set up the cli config correctly (run `wharfie config`)',
    );
  }
  if (!deployment_name) {
    throw new Error(
      'wharfie deployment name not found. Please make sure you set up the cli config correctly (run `wharfie config`)',
    );
  }
  if (!service_bucket) {
    throw new Error(
      'wharfie service bucket not found. Please make sure you set up the cli config correctly (run `wharfie config`)',
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
 * @param {CLIConfig} params - Config values.
 * @returns {void} - Persists CLI config in memory.
 */
export function setConfig({ deployment_name, region, service_bucket }) {
  check({ deployment_name, region, service_bucket });
  configuration.region = region;
  configuration.deployment_name = deployment_name;
  configuration.service_bucket = service_bucket;
}

/**
 * @returns {void} - Clears the in-memory config.
 */
export function clearConfig() {
  configuration.region = undefined;
  configuration.deployment_name = undefined;
  configuration.service_bucket = undefined;
}

/**
 * @returns {CLIConfig} - The active CLI config.
 */
export function getConfig() {
  check(configuration);
  return { ...configuration };
}

/**
 * @returns {void} - Mirrors the active config into environment variables.
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
 * @param {CLIConfigValidationDependencies} [dependencies] - Validation test hooks.
 * @returns {Promise<void>} - Resolves when terminal AWS credentials, region, and Wharfie config are valid.
 */
export async function validate(dependencies = {}) {
  const { credentialProvider = defaultProvider(), stsClient = new STS() } =
    dependencies;

  /** @type {{ accessKeyId?: string, secretAccessKey?: string, sessionToken?: string }} */
  let credentials;

  try {
    credentials = await credentialProvider();
  } catch (err) {
    throw new Error(
      'AWS credentials are not configured for terminal, please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html ' +
        `\nfailed with this error:\n${getErrorMessage(err)}`,
    );
  }

  const keySet = credentials.accessKeyId && credentials.secretAccessKey;

  if (!keySet) {
    throw new Error(
      'AWS credentials are incomplete in terminal please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html',
    );
  }

  /** @type {string | undefined} */
  let region;
  try {
    region = await stsClient.sts.config.region();
  } catch {
    region = undefined;
  }

  if (!region) {
    throw new Error(
      'AWS Region is not configured for terminal, please follow instructions at https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html',
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
