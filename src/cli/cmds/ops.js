import { Command } from 'commander';

import inspectCommand from './ops_cmds/inspect.js';
import recoverCommand from './ops_cmds/recover.js';
import runCommand from './ops_cmds/run.js';

const opsCommand = new Command('ops')
  .description('Durable execution-ledger operator commands')
  .addCommand(inspectCommand)
  .addCommand(recoverCommand)
  .addCommand(runCommand);

export default opsCommand;
