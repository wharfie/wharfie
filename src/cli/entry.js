import { Command } from 'commander';

import paths from '../core/lib/paths.js';
import { WHARFIE_VERSION } from '../core/lib/version.js';

import opsCommand from './cmds/ops.js';
import appCommand from './cmds/app.js';

/**
 * @typedef {object} CreateProgramOptions
 * @property {{ config: string, createWharfiePaths: () => Promise<void> }} [pathsModule] - Wharfie path helpers.
 */

/**
 * Build the Wharfie CLI commander program.
 * @param {CreateProgramOptions} [options] - Test hooks.
 * @returns {import('commander').Command}
 */
export function createProgram(options = {}) {
  const { pathsModule = paths } = options;

  const program = new Command();

  program
    .name('wharfie')
    .description('CLI tool for Wharfie')
    .version(WHARFIE_VERSION);

  program.addCommand(appCommand);
  program.addCommand(opsCommand);

  program.hook('preAction', async () => {
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
 *
 * @param {string[]} argv - process.argv
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
