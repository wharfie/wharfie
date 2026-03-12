import fs from 'node:fs';
import path from 'node:path';

import { Command } from 'commander';

import paths from '../lambdas/lib/paths.js';
import { WHARFIE_VERSION } from '../lambdas/lib/version.js';

import configModule, { setConfig, setEnvironment, validate } from './config.js';
import { checkForNewRelease } from './upgrade.js';
import { displayFailure } from './output/basic.js';

import configCommand from './cmds/config.js';
import listCommand from './cmds/list.js';
import opsCommand from './cmds/ops.js';
import appCommand from './cmds/app.js';
import buildSelfCommand from './cmds/build_self.js';
import initCommand from './cmds/init.js';

const REPORTED_CLI_ERROR_CODE = 'WHARFIE_CLI_ALREADY_REPORTED';

/**
 * @typedef {object} CreateProgramOptions
 * @property {string[]} [argv] - argv to parse.
 * @property {{ existsSync: typeof fs.existsSync, readFileSync: typeof fs.readFileSync }} [fsModule] - fs helpers.
 * @property {{ join: typeof path.join }} [pathModule] - path helpers.
 * @property {{ config: string, createWharfiePaths: () => Promise<void> }} [pathsModule] - Wharfie path helpers.
 * @property {{ setConfig: typeof setConfig, setEnvironment: typeof setEnvironment, validate: typeof validate }} [configHelpers] - Config helpers.
 * @property {typeof checkForNewRelease} [releaseChecker] - Release check function.
 * @property {(error: unknown) => void} [failureReporter] - Failure reporter.
 */

/**
 * @returns {Error & { code: string }} - Marker error for already-reported CLI failures.
 */
function createReportedCliError() {
  const error = new Error('Wharfie CLI command failed.');
  error.name = 'WharfieCliReportedError';
  return /** @type {Error & { code: string }} */ (
    Object.assign(error, { code: REPORTED_CLI_ERROR_CODE })
  );
}

/**
 * @param {unknown} err - Unknown error value.
 * @returns {boolean} - Whether the error has already been reported to the user.
 */
function isReportedCliError(err) {
  return (
    err instanceof Error &&
    'code' in err &&
    err.code === REPORTED_CLI_ERROR_CODE
  );
}

/**
 * Build the Wharfie CLI commander program.
 * @param {CreateProgramOptions} [options] - Test hooks.
 * @returns {import('commander').Command} - Configured program.
 */
export function createProgram(options = {}) {
  const {
    argv = process.argv,
    fsModule = fs,
    pathModule = path,
    pathsModule = paths,
    configHelpers = configModule,
    releaseChecker = checkForNewRelease,
    failureReporter = displayFailure,
  } = options;

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
  program.addCommand(initCommand);

  program.hook('preAction', async () => {
    await pathsModule.createWharfiePaths();

    const args = argv.slice(2);
    const isHelp = args.includes('--help') || args.includes('-h');
    const isConfigCommand = args[0] === 'config';
    const isLocalOnly =
      args[0] === 'app' ||
      args[0] === 'ops' ||
      args[0] === 'list' ||
      args[0] === 'build-self' ||
      args[0] === 'init' ||
      (args[0] === 'self' && args[1] === 'build');

    process.env.CONFIG_DIR = pathsModule.config;
    process.env.CONFIG_FILE_PATH = pathModule.join(
      process.env.CONFIG_DIR,
      'wharfie.config',
    );

    if (fsModule.existsSync(process.env.CONFIG_FILE_PATH)) {
      try {
        configHelpers.setConfig(
          JSON.parse(
            fsModule.readFileSync(process.env.CONFIG_FILE_PATH, 'utf8'),
          ),
        );
        configHelpers.setEnvironment();
      } catch (_err) {
        if (!isConfigCommand) {
          failureReporter(
            'Failed to load config. Run "wharfie config" to resolve.',
          );
          process.exitCode = 1;
          throw createReportedCliError();
        }
      }
    }

    if (isHelp || isConfigCommand || isLocalOnly) return;

    try {
      await configHelpers.validate();
    } catch (err) {
      failureReporter(err);
      process.exitCode = 1;
      throw createReportedCliError();
    }

    await releaseChecker();
  });

  return program;
}

/**
 * CLI entrypoint used by both `bin/wharfie` and the SEA self-build.
 *
 * NOTE: When running under a SeaBuild-produced binary, this function is bundled
 * and does not rely on repo-relative paths at runtime.
 * @param {string[]} argv - process.argv.
 * @returns {Promise<void>} - Resolves when CLI parsing finishes.
 */
export async function main(argv = process.argv) {
  process.env.LOGGING_FORMAT = 'cli';
  process.env.LOGGING_LEVEL = 'warn';

  const program = createProgram({ argv });

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

  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (isReportedCliError(err)) {
      process.exitCode = process.exitCode || 1;
      return;
    }
    throw err;
  }
}
