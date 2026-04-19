import { Command } from 'commander';

import { runLocalApp, stringifyJson } from '../../app/local-app.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string} activityName - activityName.
 * @param {{ dir?: string, event?: string, context?: string, pretty?: boolean }} options - options.
 */
async function runActivity(activityName, options) {
  const { result } = await runLocalApp({
    dir: options.dir,
    allowEmbedded: typeof options.dir !== 'string' || !options.dir.trim(),
    activityName,
    eventInput: options.event,
    contextInput: options.context,
    stdinInput: process.env.stdin,
  });

  process.stdout.write(`${stringifyJson(result, options)}\n`);
}

const runCommand = new Command('run')
  .description('Invoke an activity from wharfie.app.js or this SEA artifact')
  .argument('<activityName>', 'Activity name to invoke')
  .option('--dir <dir>', 'Directory containing wharfie.app.js')
  .option('--event <json>', 'Event JSON (default: stdin JSON or {})')
  .option('--context <json>', 'Context JSON (default: {})')
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

export default runCommand;
