import { Command } from 'commander';
import stateCmd from './control_cmds/state.js';
import manifestCmd from './control_cmds/manifest.js';

const ctlCommand = new Command('ctl')
  .description('Wharfie control commands')
  .action(() => {
    // Display help if no subcommands are specified
    ctlCommand.help();
  });

ctlCommand.addCommand(stateCmd);
ctlCommand.addCommand(manifestCmd);

export default ctlCommand;
