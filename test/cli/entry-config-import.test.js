/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { jest } from '@jest/globals';
import { Command } from 'commander';

const ORIGINAL_ARGV = [...process.argv];
const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_EXIT = process.exit;

/**
 * @param {string} relativePath - Repo-relative module path.
 * @returns {string} - Absolute module path.
 */
function toModulePath(relativePath) {
  return path.join(process.cwd(), relativePath);
}

const PATHS_MODULE = toModulePath('lambdas/lib/paths.js');
const VERSION_MODULE = toModulePath('lambdas/lib/version.js');
const CONFIG_MODULE = toModulePath('cli/config.js');
const UPGRADE_MODULE = toModulePath('cli/upgrade.js');
const OUTPUT_MODULE = toModulePath('cli/output/basic.js');
const ENTRY_MODULE = toModulePath('cli/entry.js');

const CONFIG_COMMAND_MODULE = toModulePath('cli/cmds/config.js');
const LIST_COMMAND_MODULE = toModulePath('cli/cmds/list.js');
const OPS_COMMAND_MODULE = toModulePath('cli/cmds/ops.js');
const APP_COMMAND_MODULE = toModulePath('cli/cmds/app.js');
const BUILD_SELF_COMMAND_MODULE = toModulePath('cli/cmds/build_self.js');
const INIT_COMMAND_MODULE = toModulePath('cli/cmds/init.js');

/**
 * @param {string} name - Command name.
 * @returns {import('commander').Command} - Command.
 */
function createNoopCommand(name) {
  return new Command(name).action(async () => {});
}

describe('cli entry config boot path', () => {
  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
    process.argv = [...ORIGINAL_ARGV];
    process.env = { ...ORIGINAL_ENV };
    process.exit = ORIGINAL_EXIT;
    process.exitCode = undefined;
  });

  it('uses the default-exported config helper during preAction bootstrapping', async () => {
    const tempDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-cli-entry-config-'),
    );
    const expectedConfig = {
      deployment_name: 'demo-deployment',
      region: 'us-east-1',
      service_bucket: 'demo-bucket',
    };

    await fsp.writeFile(
      path.join(tempDir, 'wharfie.config'),
      JSON.stringify(expectedConfig),
    );

    const setConfig = jest.fn();
    const setEnvironment = jest.fn();
    const validate = jest.fn(async () => undefined);
    const createWharfiePaths = jest.fn(async () => undefined);
    const checkForNewRelease = jest.fn(async () => undefined);
    const displayFailure = jest.fn();

    jest.unstable_mockModule(PATHS_MODULE, () => ({
      default: {
        config: tempDir,
        createWharfiePaths,
      },
    }));
    jest.unstable_mockModule(VERSION_MODULE, () => ({
      WHARFIE_VERSION: '0.0.14',
    }));
    jest.unstable_mockModule(CONFIG_MODULE, () => ({
      default: {
        setConfig,
        setEnvironment,
        validate,
      },
    }));
    jest.unstable_mockModule(UPGRADE_MODULE, () => ({
      checkForNewRelease,
    }));
    jest.unstable_mockModule(OUTPUT_MODULE, () => ({
      displayFailure,
    }));
    jest.unstable_mockModule(CONFIG_COMMAND_MODULE, () => ({
      default: createNoopCommand('config'),
    }));
    jest.unstable_mockModule(LIST_COMMAND_MODULE, () => ({
      default: createNoopCommand('list'),
    }));
    jest.unstable_mockModule(OPS_COMMAND_MODULE, () => ({
      default: createNoopCommand('ops'),
    }));
    jest.unstable_mockModule(APP_COMMAND_MODULE, () => ({
      default: createNoopCommand('app'),
    }));
    jest.unstable_mockModule(BUILD_SELF_COMMAND_MODULE, () => ({
      default: createNoopCommand('build-self'),
    }));
    jest.unstable_mockModule(INIT_COMMAND_MODULE, () => ({
      default: createNoopCommand('init'),
    }));

    process.argv = ['node', 'wharfie', 'config'];
    process.env = { ...ORIGINAL_ENV };
    process.exit = jest.fn((code) => {
      throw new Error(`unexpected process.exit(${String(code)})`);
    });

    const { createProgram } = await import(ENTRY_MODULE);
    const program = createProgram();

    await program.parseAsync(process.argv, { from: 'node' });

    expect(createWharfiePaths).toHaveBeenCalledTimes(1);
    expect(setConfig).toHaveBeenCalledWith(expectedConfig);
    expect(setEnvironment).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(checkForNewRelease).toHaveBeenCalledTimes(1);
    expect(displayFailure).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();
  });
});
