import { Command } from 'commander';

import { runLocalApp, stringifyJson } from '../../app/local-app.js';
import { displayFailure } from '../../output/basic.js';

/**
 * @param {string} functionName - functionName.
 * @param {{ dir?: string, event?: string, context?: string, pretty?: boolean }} options - options.
 */
async function runFunction(functionName, options) {
  const { result } = await runLocalApp({
    dir: options.dir || process.cwd(),
    functionName,
    eventInput: options.event,
    contextInput: options.context,
    stdinInput: process.env.stdin,
  });

  process.stdout.write(`${stringifyJson(result, options)}\n`);
}

const runCommand = new Command('run')
  .description('Invoke a function from wharfie.app.js locally')
  .argument('<functionName>', 'Function name to invoke')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option('--event <json>', 'Event JSON (default: stdin JSON or {})')
  .option('--context <json>', 'Context JSON (default: {})')
  .option('--json', 'Output JSON (default)')
  .option('--no-pretty', 'Disable pretty JSON output')
  .action(async (functionName, options) => {
    try {
      await runFunction(functionName, options);
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default runCommand;
