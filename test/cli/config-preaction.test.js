/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

const ENTRY_MODULE = '../../cli/entry.js';
const INQUIRER_MODULE = 'inquirer';
const ORIGINAL_ENV = process.env;

describe('CLI config preAction behavior', () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
    process.exitCode = undefined;
    jest.restoreAllMocks();
    jest.resetModules();
  });

  it('skips config validation for `wharfie config` so first-run setup can complete', async () => {
    const tempDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-config-preaction-'),
    );
    const configDir = path.join(tempDir, 'config');
    const configFilePath = path.join(configDir, 'wharfie.config');

    process.env = {
      ...ORIGINAL_ENV,
      WHARFIE_REGION: 'us-east-1',
      WHARFIE_DISABLE_UPDATE_CHECK: '1',
    };

    const promptSpy = jest.fn(async () => ({
      deployment_name: 'demo-deployment',
      region: 'us-east-1',
      service_bucket: 'demo-bucket',
    }));

    await jest.unstable_mockModule(INQUIRER_MODULE, () => ({
      default: {
        prompt: promptSpy,
      },
    }));

    const { createProgram } = await import(ENTRY_MODULE);

    const validateSpy = jest.fn(async () => {
      throw new Error('validate should not run for `wharfie config`');
    });
    const releaseChecker = jest.fn(async () => false);

    const program = createProgram({
      argv: ['node', 'wharfie', 'config'],
      pathsModule: {
        config: configDir,
        createWharfiePaths: async () => {},
      },
      configHelpers: {
        setConfig: () => {},
        setEnvironment: () => {},
        validate: validateSpy,
      },
      releaseChecker,
    });

    await program.parseAsync(['node', 'wharfie', 'config']);

    expect(validateSpy).not.toHaveBeenCalled();
    expect(releaseChecker).not.toHaveBeenCalled();
    expect(promptSpy).toHaveBeenCalledTimes(1);
    await expect(fsp.readFile(configFilePath, 'utf8')).resolves.toEqual(
      JSON.stringify(
        {
          deployment_name: 'demo-deployment',
          region: 'us-east-1',
          service_bucket: 'demo-bucket',
        },
        null,
        2,
      ),
    );
  });
});
