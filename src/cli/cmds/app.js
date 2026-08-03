import { Command } from 'commander';

import { createSourceAppManifestCommand } from './app_cmds/manifest.js';
import { createPackageCommand } from './app_cmds/package.js';
import { createSourceAppRunCommand } from './app_cmds/run.js';

/**
 * Build one source application command group with exclusively owned leaves.
 * @returns {Command} - Fresh source application command tree.
 */
export function createSourceAppCommand() {
  return new Command('app')
    .description(
      'Local application manifest, execution, and packaging commands',
    )
    .addCommand(createSourceAppManifestCommand())
    .addCommand(createSourceAppRunCommand())
    .addCommand(createPackageCommand());
}
