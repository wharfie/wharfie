/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_COMMAND_IMPORT = '../../../src/cli/cmds/config.js';
const OUTPUT_IMPORT = '../../../src/cli/output/basic.js';
const STS_IMPORT = '../../../src/core/lib/aws/sts.js';
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_EXIT_CODE = process.exitCode;

/**
 * @param {{
 *   promptImpl?: (...args: any[]) => Promise<Record<string, any>>,
 *   region?: string,
 * }} [options] - options.
 * @returns {Promise<{
 *   configCommand: import('commander').Command,
 *   prompt: any,
 *   displayFailure: any,
 *   displaySuccess: any,
 *   STSConstructor: any,
 * }>} - Result.
 */
async function loadConfigCommand(options = {}) {
  jest.resetModules();

  const prompt = jest.fn(
    options.promptImpl ||
      (async () => ({
        deployment_name: 'demo-deployment',
        region: options.region || 'us-east-1',
        service_bucket: 'service-bucket',
      })),
  );
  const displayFailure = jest.fn();
  const displaySuccess = jest.fn();
  const STSConstructor = jest.fn().mockImplementation(() => ({
    sts: {
      config: {
        region: async () => options.region || 'us-east-1',
      },
    },
  }));

  await jest.unstable_mockModule('inquirer', () => ({
    default: { prompt },
  }));
  await jest.unstable_mockModule(STS_IMPORT, () => ({
    default: STSConstructor,
  }));
  await jest.unstable_mockModule(OUTPUT_IMPORT, () => ({
    displayFailure,
    displaySuccess,
  }));

  const mod = await import(CONFIG_COMMAND_IMPORT);

  return {
    configCommand: mod.default,
    prompt,
    displayFailure,
    displaySuccess,
    STSConstructor,
  };
}

describe('wharfie config command', () => {
  /** @type {string} */
  let tmpRoot;
  /** @type {string} */
  let configDir;
  /** @type {string} */
  let configFilePath;

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-config-command-'),
    );
    configDir = path.join(tmpRoot, '.wharfie');
    configFilePath = path.join(configDir, 'wharfie.config');
    process.env = {
      ...ORIGINAL_ENV,
      CONFIG_DIR: configDir,
      CONFIG_FILE_PATH: configFilePath,
    };
    delete process.env.WHARFIE_REGION;
    delete process.env.WHARFIE_DEPLOYMENT_NAME;
    delete process.env.WHARFIE_SERVICE_BUCKET;
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.env = { ...ORIGINAL_ENV };
    process.exitCode = ORIGINAL_EXIT_CODE;
    jest.restoreAllMocks();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('resolves the default region from STS and writes the config file', async () => {
    /** @type {any} */
    let capturedQuestions = null;

    const { configCommand, displaySuccess, STSConstructor } =
      await loadConfigCommand({
        region: 'us-west-2',
        promptImpl: async (questions) => {
          capturedQuestions = questions;
          return {
            deployment_name: 'demo-deployment',
            region: questions[1].default,
            service_bucket: 'service-bucket',
          };
        },
      });

    await configCommand.parseAsync([], { from: 'user' });

    expect(STSConstructor).toHaveBeenCalledWith({});
    expect(capturedQuestions).not.toBeNull();
    expect(capturedQuestions?.[1]?.default).toBe('us-west-2');
    expect(JSON.parse(await fsp.readFile(configFilePath, 'utf8'))).toEqual({
      deployment_name: 'demo-deployment',
      region: 'us-west-2',
      service_bucket: 'service-bucket',
    });
    expect(displaySuccess).toHaveBeenCalledWith(
      `Config written to ${configFilePath}`,
    );
    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [
      'deployment_name',
      {
        deployment_name: '',
        region: 'us-east-1',
        service_bucket: 'service-bucket',
      },
    ],
    [
      'region',
      {
        deployment_name: 'demo-deployment',
        region: '',
        service_bucket: 'service-bucket',
      },
    ],
    [
      'service_bucket',
      {
        deployment_name: 'demo-deployment',
        region: 'us-east-1',
        service_bucket: '',
      },
    ],
  ])('fails validation when %s is missing', async (_field, answers) => {
    const { configCommand, displayFailure } = await loadConfigCommand({
      promptImpl: async () => answers,
    });

    await configCommand.parseAsync([], { from: 'user' });

    expect(displayFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: `${_field} is required`,
      }),
    );
    expect(existsSync(configFilePath)).toBe(false);
    expect(process.exitCode).toBe(1);
  });
});
