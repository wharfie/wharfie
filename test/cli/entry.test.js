/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

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
    expect(output).toMatch(/app/);
    expect(output).toMatch(/ops/);
    expect(output).not.toMatch(/build-self/);
    expect(output).not.toMatch(/^\s+config\b/m);
    expect(output).not.toMatch(/^\s+init\b/m);
    expect(output).not.toMatch(/^\s+list\b/m);
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

  test('registers the supported top-level commands', () => {
    const program = createProgram();

    expect(program.commands.map((command) => command.name())).toEqual([
      'app',
      'ops',
    ]);
  });

  test('awaits async preAction work before parseAsync resolves', async () => {
    /** @type {string[]} */
    const order = [];
    const originalConfigDir = process.env.CONFIG_DIR;

    const program = createProgram({
      pathsModule: {
        config: path.join(process.cwd(), '.wharfie-test-config'),
        createWharfiePaths: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('paths');
        },
      },
    });

    program.addCommand(
      new Command('probe').action(async () => {
        expect(process.env.CONFIG_DIR).toBe(
          path.join(process.cwd(), '.wharfie-test-config'),
        );
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('action');
      }),
    );

    try {
      await program.parseAsync(['node', 'wharfie', 'probe']);
      order.push('after-parse');

      expect(order).toEqual(['paths', 'action', 'after-parse']);
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.CONFIG_DIR;
      } else {
        process.env.CONFIG_DIR = originalConfigDir;
      }
    }
  });
});
