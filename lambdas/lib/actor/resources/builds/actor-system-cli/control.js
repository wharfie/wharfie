'use strict';

const { Command } = require('commander');

const ctlCommand = new Command('ctl')
  .description('Wharfie control commands')
  .action(() => {
    // Display help if no subcommands are specified
    ctlCommand.help();
  });

ctlCommand.hook('preAction', async () => {
  console.log('commands pre action');
});

ctlCommand.addCommand(require('./control_cmds/state'));

module.exports = ctlCommand;
