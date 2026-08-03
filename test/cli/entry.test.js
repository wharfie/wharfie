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

/**
 * Collect a Commander tree in stable depth-first order.
 * @param {Command} root - Program or command group root.
 * @returns {Command[]} - Root plus every descendant.
 */
function collectCommandTree(root) {
  return [
    root,
    ...root.commands.flatMap((command) => collectCommandTree(command)),
  ];
}

/**
 * Require every child in a Commander tree to name its actual owning parent.
 * @param {Command} root - Program or command group root.
 * @returns {void}
 */
function expectExactCommandParents(root) {
  for (const child of root.commands) {
    expect(child.parent).toBe(root);
    expectExactCommandParents(child);
  }
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
    expect(output).toMatch(/^\s+deployment\b/m);
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
      'deployment',
    ]);
  });

  test('builds fully isolated source command trees with exact parents', () => {
    const firstProgram = createProgram();
    const secondProgram = createProgram();
    const firstTree = collectCommandTree(firstProgram);
    const secondTree = collectCommandTree(secondProgram);
    const firstCommands = new Set(firstTree);
    const firstApp = firstProgram.commands.find(
      (command) => command.name() === 'app',
    );
    const secondApp = secondProgram.commands.find(
      (command) => command.name() === 'app',
    );
    const deployment = firstProgram.commands.find(
      (command) => command.name() === 'deployment',
    );
    const secondDeployment = secondProgram.commands.find(
      (command) => command.name() === 'deployment',
    );

    expect(secondTree.map((command) => command.name())).toEqual(
      firstTree.map((command) => command.name()),
    );
    expect(secondTree.every((command) => !firstCommands.has(command))).toBe(
      true,
    );
    expectExactCommandParents(firstProgram);
    expectExactCommandParents(secondProgram);
    expect(firstApp?.description()).toBe(
      'Local application manifest, execution, and packaging commands',
    );
    expect(secondApp).not.toBe(firstApp);
    expect(deployment).toBeDefined();
    expect(deployment?.commands.map((command) => command.name())).toEqual([
      'plan',
      'apply',
      'inspect',
      'reconcile',
      'destroy',
    ]);
    expect(secondDeployment).toBeDefined();
    expect(secondDeployment).not.toBe(deployment);
    expect(deployment?.parent).toBe(firstProgram);
    expect(secondDeployment?.parent).toBe(secondProgram);
  });

  test('keeps source hooks, config, mutation, and parsing bound to their owning root', async () => {
    /** @type {string[]} */
    const calls = [];
    const originalConfigDir = process.env.CONFIG_DIR;
    const firstConfig = path.join(process.cwd(), '.wharfie-first-config');
    const secondConfig = path.join(process.cwd(), '.wharfie-second-config');
    const firstProgram = createProgram({
      pathsModule: {
        config: firstConfig,
        createWharfiePaths: async () => {
          calls.push('first-paths');
        },
      },
    });
    const firstApp = firstProgram.commands.find(
      (command) => command.name() === 'app',
    );
    if (!firstApp) throw new Error('First source app command is missing.');
    firstApp.addCommand(
      new Command('ownership-probe').action(() => {
        calls.push(`first-action:${process.env.CONFIG_DIR}`);
      }),
    );

    const secondProgram = createProgram({
      pathsModule: {
        config: secondConfig,
        createWharfiePaths: async () => {
          calls.push('second-paths');
        },
      },
    });
    const secondApp = secondProgram.commands.find(
      (command) => command.name() === 'app',
    );

    try {
      expect(
        secondApp?.commands.some(
          (command) => command.name() === 'ownership-probe',
        ),
      ).toBe(false);
      await firstProgram.parseAsync([
        'node',
        'wharfie',
        'app',
        'ownership-probe',
      ]);

      expect(calls).toEqual(['first-paths', `first-action:${firstConfig}`]);
      expect(process.env.CONFIG_DIR).toBe(firstConfig);
      expect(firstApp.parent).toBe(firstProgram);
      expect(secondApp?.parent).toBe(secondProgram);
    } finally {
      if (originalConfigDir === undefined) {
        delete process.env.CONFIG_DIR;
      } else {
        process.env.CONFIG_DIR = originalConfigDir;
      }
    }
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
