import fs from 'node:fs';

import { Command } from 'commander';
import inquirer from 'inquirer';

import STS from '../../lambdas/lib/aws/sts.js';
import { displayFailure, displaySuccess } from '../output/basic.js';

// eslint-disable-next-line import/no-named-as-default-member
const prompt = inquirer.prompt.bind(inquirer);

/**
 * @typedef ConfigAnswers
 * @property {string} deployment_name - Wharfie deployment name.
 * @property {string} region - Wharfie AWS region.
 * @property {string} service_bucket - Wharfie service bucket.
 */

/**
 * @typedef ConfigCommandDependencies
 * @property {{ existsSync: typeof fs.existsSync, mkdirSync: typeof fs.mkdirSync, writeFileSync: typeof fs.writeFileSync }} [fsModule] - fs helpers.
 * @property {(questions: import('inquirer').QuestionCollection) => Promise<ConfigAnswers>} [promptFn] - Prompt implementation.
 * @property {() => { sts: { config: { region: () => Promise<string | undefined> } } }} [createSTS] - STS factory.
 * @property {() => Record<string, string | undefined>} [envGetter] - Environment getter.
 * @property {(message: unknown) => void} [failureReporter] - Failure reporter.
 * @property {(message: unknown) => void} [successReporter] - Success reporter.
 */

/**
 * @param {{ env?: Record<string, string | undefined>, stsClient?: { sts: { config: { region: () => Promise<string | undefined> } } } }} [options] - Region resolution options.
 * @returns {Promise<string | undefined>} - The default region to prefill in the prompt.
 */
export async function resolveRegionDefault(options = {}) {
  const { env = process.env, stsClient } = options;

  const envRegion =
    env.WHARFIE_REGION || env.AWS_REGION || env.AWS_DEFAULT_REGION;
  if (envRegion) return envRegion;
  if (!stsClient) return undefined;

  try {
    return await stsClient.sts.config.region();
  } catch {
    return undefined;
  }
}

/**
 * @param {Partial<ConfigAnswers>} answers - Prompt answers.
 * @returns {ConfigAnswers} - Normalized config answers.
 */
export function validateConfigAnswers(answers) {
  const deployment_name = String(answers.deployment_name || '').trim();
  const region = String(answers.region || '').trim();
  const service_bucket = String(answers.service_bucket || '').trim();

  if (!deployment_name) {
    throw new Error('deployment_name is required');
  }
  if (!region) {
    throw new Error('region is required');
  }
  if (!service_bucket) {
    throw new Error('service_bucket is required');
  }

  return {
    deployment_name,
    region,
    service_bucket,
  };
}

/**
 * @param {ConfigCommandDependencies} [dependencies] - Command test hooks.
 * @returns {import('commander').Command} - Config command.
 */
export function createConfigCommand(dependencies = {}) {
  const {
    fsModule = fs,
    promptFn = prompt,
    createSTS = () => new STS({}),
    envGetter = () => process.env,
    failureReporter = displayFailure,
    successReporter = displaySuccess,
  } = dependencies;

  return new Command('config')
    .description('Set up Wharfie configuration')
    .action(async () => {
      const env = envGetter();
      const stsClient = createSTS();
      const regionDefault = await resolveRegionDefault({ env, stsClient });

      /** @type {import('inquirer').QuestionCollection} */
      const questions = [
        {
          type: 'input',
          name: 'deployment_name',
          message: 'wharfie deployment name (also used in wharfie.yaml):',
          default: env.WHARFIE_DEPLOYMENT_NAME,
        },
        {
          type: 'input',
          name: 'region',
          message: 'wharfie AWS region:',
          default: regionDefault,
        },
        {
          type: 'input',
          name: 'service_bucket',
          message: 'wharfie service bucket:',
          default: env.WHARFIE_SERVICE_BUCKET,
        },
      ];

      /** @type {ConfigAnswers} */
      let answers;
      try {
        answers = validateConfigAnswers(await promptFn(questions));
      } catch (err) {
        failureReporter(err);
        process.exitCode = 1;
        return;
      }

      const configDir = env.CONFIG_DIR;
      const configFilePath = env.CONFIG_FILE_PATH;

      if (!configDir || !configFilePath) {
        failureReporter(
          'CONFIG_DIR/CONFIG_FILE_PATH not set. Run via `wharfie` CLI.',
        );
        process.exitCode = 1;
        return;
      }

      if (!fsModule.existsSync(configDir)) {
        fsModule.mkdirSync(configDir, { recursive: true });
      }
      fsModule.writeFileSync(configFilePath, JSON.stringify(answers, null, 2));

      successReporter(`Config written to ${configFilePath}`);
    });
}

const configCommand = createConfigCommand();

export default configCommand;
