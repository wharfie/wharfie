import { Command } from 'commander';

import manifestCommand from './control_cmds/manifest.js';

/**
 * Run the deliberately small public operator surface embedded in an app SEA.
 * Runtime service bootstrap is selected through hidden environment state and
 * does not share this public argv namespace.
 * @param {string[]} [argv] - Node-style argv.
 * @returns {Promise<void>} - Resolves when the command completes.
 */
async function entrypoint(argv = process.argv) {
  const program = new Command()
    .name('wharfie')
    .description('Wharfie operator commands for this packaged application')
    .addCommand(manifestCommand);

  if (!argv.slice(2).length) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}

export default entrypoint;
