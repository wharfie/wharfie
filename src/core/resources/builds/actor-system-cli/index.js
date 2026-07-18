import { Command } from 'commander';

import { createExecutionLedgerOperatorCommands } from '../../../runtime/operator/execution-ledger-operator.js';
import { readEmbeddedRevisionRuntimePair } from '../lib/revision-runtime-assets.js';
import manifestCommand from './control_cmds/manifest.js';
import metadataCommand from './control_cmds/metadata.js';

/**
 * Build a fresh packaged operator program. Identity is read lazily so help and
 * immutable metadata commands do not open application control state.
 * @param {{resolveExpectedIdentity?: () => Promise<{appId: string, revisionId?: string}>}} [options] - Test or packaged identity provider.
 * @returns {Command} - Packaged operator program.
 */
export function createProgram(options = {}) {
  const resolveExpectedIdentity =
    options.resolveExpectedIdentity ||
    (async () => {
      const pair = await readEmbeddedRevisionRuntimePair();
      return {
        appId: pair.runtime.appId,
        revisionId: pair.runtime.revisionId,
      };
    });
  const { inspectCommand, recoverCommand, cancelCommand } =
    createExecutionLedgerOperatorCommands({
      resolveExpectedIdentity,
      requireLocalOwnership: true,
    });

  return new Command()
    .name('wharfie')
    .description('Wharfie operator commands for this packaged application')
    .addCommand(manifestCommand)
    .addCommand(metadataCommand)
    .addCommand(inspectCommand)
    .addCommand(recoverCommand)
    .addCommand(cancelCommand);
}

/**
 * Run the deliberately small public operator surface embedded in an app SEA.
 * Runtime service bootstrap is selected through hidden environment state and
 * does not share this public argv namespace.
 * @param {string[]} [argv] - Node-style argv.
 * @returns {Promise<void>} - Resolves when the command completes.
 */
async function entrypoint(argv = process.argv) {
  const program = createProgram();

  if (!argv.slice(2).length) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}

export default entrypoint;
