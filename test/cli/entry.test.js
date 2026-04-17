/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { createProgram } from '../../src/cli/entry.js';

const binPath = fileURLToPath(new URL('../../bin/wharfie', import.meta.url));

/**
 * @param {string[]} args - CLI args.
 * @param {NodeJS.ProcessEnv} [env] - Extra environment variables.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} - Spawn result.
 */
function runCli(args, env = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      WHARFIE_DISABLE_UPDATE_CHECK: '1',
      ...env,
    },
  });
}

/**
 * @param {import('node:child_process').SpawnSyncReturns<string>} result - Spawn result.
 * @returns {string} - Combined stdout/stderr.
 */
function collectOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

describe('CLI entrypoint', () => {
  test('prints top-level help and only lists the supported command surface', () => {
    const result = runCli(['--help']);
    const output = collectOutput(result);

    expect(result.status).toBe(0);
    expect(output).toMatch(/Usage: wharfie/i);
    expect(output).toMatch(/config/);
    expect(output).toMatch(/init/);
    expect(output).toMatch(/app/);
    expect(output).toMatch(/ops/);
    expect(output).toMatch(/list/);
    expect(output).toMatch(/build-self/);
    expect(output).not.toMatch(/^\s+deployment\b/m);
    expect(output).not.toMatch(/^\s+project\b/m);
    expect(output).not.toMatch(/^\s+utils\b/m);
  });

  test('prints help and exits non-zero when no command is provided', () => {
    const result = runCli([]);
    const output = collectOutput(result);

    expect(result.status).toBe(1);
    expect(output).toMatch(/Usage: wharfie/i);
  });

  test('prints help for config without crashing the ESM boot path', () => {
    const result = runCli(['config', '--help']);
    const output = collectOutput(result);

    expect(result.status).toBe(0);
    expect(output).toMatch(/Configure legacy AWS deployment settings/i);
  });

  test('reports build-self as disabled under jest', () => {
    const result = runCli(['build-self']);
    const output = collectOutput(result);

    expect(result.status).toBe(1);
    expect(output).toMatch(/build-self is disabled under jest/i);
  });

  test('lets config run without pre-validating an existing Wharfie config', async () => {
    const originalConfigDir = process.env.CONFIG_DIR;
    const originalConfigFilePath = process.env.CONFIG_FILE_PATH;
    const validate = jest.fn(async () => {});
    const releaseChecker = jest.fn(async () => false);
    const failureReporter = jest.fn();
    let configActionRan = false;

    try {
      const program = createProgram({
        argv: ['node', 'wharfie', 'config'],
        fsModule: {
          existsSync: () => false,
          readFileSync: () => {
            throw new Error('readFileSync should not be called for config');
          },
        },
        pathsModule: {
          config: '/tmp/wharfie-config',
          createWharfiePaths: async () => {},
        },
        configHelpers: {
          setConfig: jest.fn(),
          setEnvironment: jest.fn(),
          validate,
        },
        releaseChecker,
        failureReporter,
      });

      const configCommand = program.commands.find(
        (command) => command.name() === 'config',
      );

      if (!configCommand) {
        throw new Error('Expected config command to be registered');
      }

      configCommand.action(async () => {
        configActionRan = true;
        expect(process.env.CONFIG_DIR).toBe('/tmp/wharfie-config');
        expect(process.env.CONFIG_FILE_PATH).toBe(
          '/tmp/wharfie-config/wharfie.config',
        );
      });

      await program.parseAsync(['node', 'wharfie', 'config']);
    } finally {
      if (originalConfigDir === undefined) delete process.env.CONFIG_DIR;
      else process.env.CONFIG_DIR = originalConfigDir;

      if (originalConfigFilePath === undefined) {
        delete process.env.CONFIG_FILE_PATH;
      } else {
        process.env.CONFIG_FILE_PATH = originalConfigFilePath;
      }
    }

    expect(configActionRan).toBe(true);
    expect(validate).not.toHaveBeenCalled();
    expect(releaseChecker).not.toHaveBeenCalled();
    expect(failureReporter).not.toHaveBeenCalled();
  });

  test('registers only the supported top-level commands on the program', () => {
    const program = createProgram({
      argv: ['node', 'wharfie', '--help'],
      pathsModule: {
        config: path.join(process.cwd(), '.tmp-wharfie-config'),
        createWharfiePaths: async () => {},
      },
      releaseChecker: async () => false,
      failureReporter: () => {},
      configHelpers: {
        setConfig: () => {},
        setEnvironment: () => {},
        validate: async () => {},
      },
    });

    const commandNames = program.commands
      .map((command) => command.name())
      .sort((left, right) => left.localeCompare(right));

    expect(commandNames).toEqual([
      'app',
      'build-self',
      'config',
      'init',
      'list',
      'ops',
    ]);
  });
});
