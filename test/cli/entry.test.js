/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';

import { createProgram } from '../../cli/entry.js';

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

  test('prints command help for config without crashing the ESM boot path', () => {
    const result = runCli(['config', '--help']);
    const output = collectOutput(result);

    expect(result.status).toBe(0);
    expect(output).toMatch(/Set up Wharfie configuration/i);
  });

  test('reports build-self as disabled under jest', () => {
    const result = runCli(['build-self']);
    const output = collectOutput(result);

    expect(result.status).toBe(1);
    expect(output).toMatch(/build-self is disabled under jest/i);
  });

  test('registers the supported top-level commands', () => {
    const program = createProgram();

    expect(program.commands.map((command) => command.name())).toEqual([
      'config',
      'list',
      'ops',
      'app',
      'build-self',
      'init',
    ]);
  });

  test('awaits async preAction work before parseAsync resolves', async () => {
    /** @type {string[]} */
    const order = [];

    const program = createProgram({
      argv: ['node', 'wharfie', 'probe'],
      pathsModule: {
        config: path.join(process.cwd(), '.wharfie-test-config'),
        createWharfiePaths: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('paths');
        },
      },
      configHelpers: {
        setConfig: jest.fn(),
        setEnvironment: jest.fn(),
        validate: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('validate');
        },
      },
      releaseChecker: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('release');
        return false;
      },
      failureReporter: jest.fn(),
    });

    program.addCommand(
      new Command('probe').action(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('action');
      }),
    );

    await program.parseAsync(['node', 'wharfie', 'probe']);
    order.push('after-parse');

    expect(order).toEqual([
      'paths',
      'validate',
      'release',
      'action',
      'after-parse',
    ]);
  });
});
