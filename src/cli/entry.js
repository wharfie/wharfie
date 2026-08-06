import { Command } from 'commander';

import paths from '../core/lib/paths.js';
import { WHARFIE_VERSION } from '../core/lib/version.js';
import { requireAwsProvider } from '../core/runtime/aws-provider-module.js';

import { createSourceOpsCommand } from './cmds/ops.js';
import { createSourceAppCommand } from './cmds/app.js';
import { createSourceDeploymentCommand } from './cmds/deployment.js';

/**
 * @typedef {object} CreateProgramOptions
 * @property {{ config: string, createWharfiePaths: () => Promise<void> }} [pathsModule] - Wharfie path helpers.
 * @property {() => Promise<unknown>} [requireProvider] - Ensure the fixed AWS deployment provider is installed.
 */

/**
 * Determine whether a command belongs to the deployment command family.
 * @param {import('commander').Command} command - Command selected by Commander.
 * @returns {boolean} - True for deployment and each deployment subcommand.
 */
function isDeploymentCommand(command) {
  /** @type {import('commander').Command | null} */
  let current = command;
  while (current) {
    if (current.name() === 'deployment') return true;
    current = current.parent;
  }
  return false;
}

/**
 * Build the Wharfie CLI commander program.
 * @param {CreateProgramOptions} [options] - Test hooks.
 * @returns {import('commander').Command} - Configured Wharfie command.
 */
export function createProgram(options = {}) {
  const { pathsModule = paths, requireProvider = requireAwsProvider } = options;

  const program = new Command();

  program
    .name('wharfie')
    .description('CLI tool for Wharfie')
    .version(WHARFIE_VERSION);

  program.addCommand(createSourceAppCommand());
  program.addCommand(createSourceOpsCommand());
  program.addCommand(createSourceDeploymentCommand());

  program.hook('preAction', async (_thisCommand, actionCommand) => {
    if (isDeploymentCommand(actionCommand)) {
      await requireProvider();
    }
    await pathsModule.createWharfiePaths();
    process.env.CONFIG_DIR = pathsModule.config;
  });

  return program;
}

/**
 * CLI entrypoint used by both `bin/wharfie` and the SEA self-build.
 *
 * NOTE: When running under a SeaBuild-produced binary, this function is bundled
 * and does not rely on repo-relative paths at runtime.
 * @param {string[]} argv - process.argv
 * @returns {Promise<void>} - Resolves after command handling completes.
 */
export async function main(argv = process.argv) {
  const program = createProgram();

  if (!argv.slice(2).length) {
    program.outputHelp();
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    process.env.stdin = '';
    process.stdin.on('readable', () => {
      const chunk = process.stdin.read();
      if (chunk !== null) {
        process.env.stdin += chunk;
      }
    });
    await new Promise((resolve) => process.stdin.on('end', resolve));
  }

  await program.parseAsync(argv);
}
