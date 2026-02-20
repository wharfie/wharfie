import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import paths from '../lambdas/lib/paths.js';
import { WHARFIE_VERSION } from '../lambdas/lib/version.js';

import * as config from './config.js';
import { checkForNewRelease } from './upgrade.js';
import { displayFailure } from './output/basic.js';

import configCommand from './cmds/config.js';
import listCommand from './cmds/list.js';
import opsCommand from './cmds/ops.js';
import appCommand from './cmds/app.js';
import buildSelfCommand from './cmds/build_self.js';

/**
 * Build the Wharfie CLI commander program.
 * @returns {import('commander').Command}
 */
export function createProgram() {
  const program = new Command();

  program
    .name('wharfie')
    .description('CLI tool for Wharfie')
    .version(WHARFIE_VERSION);

  program.addCommand(configCommand);
  program.addCommand(listCommand);
  program.addCommand(opsCommand);
  program.addCommand(appCommand);
  program.addCommand(buildSelfCommand);

  program.hook('preAction', async () => {
    await paths.createWharfiePaths();

    // Local-only commands should not require AWS credentials/config or network calls.
    // Example:
    //   wharfie app manifest
    //   wharfie ops list <resourceId>
    //   wharfie build-self
    const args = process.argv.slice(2);
    const isHelp = args.includes('--help') || args.includes('-h');

    const isLocalOnly =
      args[0] === 'app' ||
      args[0] === 'ops' ||
      args[0] === 'list' ||
      args[0] === 'build-self' ||
      (args[0] === 'self' && args[1] === 'build');

    if (isHelp || isLocalOnly) return;

    // Load config if present.
    process.env.CONFIG_DIR = paths.config;
    process.env.CONFIG_FILE_PATH = path.join(
      process.env.CONFIG_DIR,
      'wharfie.config',
    );

    if (fs.existsSync(process.env.CONFIG_FILE_PATH)) {
      try {
        config.setConfig(
          JSON.parse(fs.readFileSync(process.env.CONFIG_FILE_PATH, 'utf8')),
        );
        config.setEnvironment();
      } catch (err) {
        // Allow `wharfie config` to run even if the config file is malformed so
        // users can repair it.
        if (args[0] !== 'config') {
          displayFailure(
            'Failed to load config. Run "wharfie config" to resolve.',
          );
          // eslint-disable-next-line no-process-exit
          process.exit(1);
        }
      }
    }

    try {
      await config.validate();
    } catch (err) {
      displayFailure(err);
      // eslint-disable-next-line no-process-exit
      process.exit(1);
    }

    await checkForNewRelease();
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
  process.env.LOGGING_FORMAT = 'cli';
  process.env.LOGGING_LEVEL = 'warn';

  const program = createProgram();

  // Show help if no command is provided
  if (!argv.slice(2).length) {
    program.outputHelp();
    process.exitCode = 1;
    return;
  }

  if (!process.stdin.isTTY) {
    process.env.stdin = '';
    process.stdin.on('readable', function () {
      const chunk = this.read();
      if (chunk !== null) {
        process.env.stdin += chunk;
      }
    });
    await new Promise((resolve) => process.stdin.on('end', resolve));
  }

  program.parse(argv);
}
