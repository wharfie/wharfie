import { Command } from 'commander';

import { runLocalApp, stringifyJson } from '../../app/local-app.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string} activityName - activityName.
 * @param {{ dir?: string, input?: string, callerMetadata?: string, pretty?: boolean }} options - options.
 */
async function runActivity(activityName, options) {
  const { result } = await runLocalApp({
    dir: options.dir,
    allowEmbedded: typeof options.dir !== 'string' || !options.dir.trim(),
    activityName,
    inputInput: options.input,
    callerMetadataInput: options.callerMetadata,
    stdinInput: process.env.stdin,
  });

  process.stdout.write(`${stringifyJson(result, options)}\n`);
}

/**
 * Build one source application activity command. The returned Commander leaf
 * is never shared between parent programs.
 * @returns {Command} - Fresh local activity command.
 */
export function createSourceAppRunCommand() {
  return new Command('run')
    .description('Invoke an activity from wharfie.app.js or this SEA artifact')
    .argument('<activityName>', 'Activity name to invoke')
    .option('--dir <dir>', 'Directory containing wharfie.app.js')
    .option('--input <json>', 'Activity input JSON (default: stdin JSON or {})')
    .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
    .option('--json', 'Output JSON (default)')
    .option('--no-pretty', 'Disable pretty JSON output')
    .action(async (activityName, options) => {
      try {
        await runActivity(activityName, options);
      } catch (err) {
        displayFailure(err);
        process.exitCode = 1;
      }
    });
}
