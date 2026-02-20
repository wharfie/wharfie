import { Command } from 'commander';

import cancelCommand from './ops_cmds/cancel.js';
import listCommand from './ops_cmds/list.js';
import runCommand from './ops_cmds/run.js';

const opsCommand = new Command('ops')
  .description('Local-only v2 operations commands')
  .addCommand(listCommand)
  .addCommand(cancelCommand)
  .addCommand(runCommand);

export default opsCommand;
