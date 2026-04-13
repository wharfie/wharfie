import { Command } from 'commander';

import { createDeployCommand } from './infrastructure_cmds/deploy.js';
import { createStatusCommand } from './infrastructure_cmds/status.js';
import { createLogsCommand } from './infrastructure_cmds/logs.js';
import { createRollbackCommand } from './infrastructure_cmds/rollback.js';

/**
 * @param {{ shell?: import('./infrastructure_cmds/shared.js').ShellLike, fsOps?: typeof import('node:fs/promises'), io?: import('./infrastructure_cmds/shared.js').CommandIO, assetProvider?: import('../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [deps] - deps.
 * @returns {Command} - Result.
 */
export function createInfrastructureCommand(deps = {}) {
  const infraCommand = new Command('infra')
    .description('Self-managing artifact infrastructure commands')
    .action(() => {
      infraCommand.help();
    });

  infraCommand.addCommand(createDeployCommand(deps));
  infraCommand.addCommand(createStatusCommand(deps));
  infraCommand.addCommand(createLogsCommand(deps));
  infraCommand.addCommand(createRollbackCommand(deps));

  return infraCommand;
}

const infraCommand = createInfrastructureCommand();

export default infraCommand;
