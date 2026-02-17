import { Command } from 'commander';
import stateCmd from './control_cmds/state.js';

const ctlCommand = new Command('ctl')
  .description('Wharfie control commands')
  .action(() => {
    // Display help if no subcommands are specified
    ctlCommand.help();
  });

ctlCommand.hook('preAction', async () => {
  console.log('commands pre action');
});

ctlCommand.addCommand(stateCmd);

export default ctlCommand;
