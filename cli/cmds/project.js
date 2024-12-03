'use strict';

const { Command } = require('commander');

const projectCommand = new Command('project')
  .description('Wharfie project commands')
  .action(() => {
    // Display help if no subcommands are specified
    projectCommand.help();
  });

projectCommand.addCommand(require('./project_cmds/apply'));
projectCommand.addCommand(require('./project_cmds/cost'));
projectCommand.addCommand(require('./project_cmds/destroy'));
projectCommand.addCommand(require('./project_cmds/dev'));
projectCommand.addCommand(require('./project_cmds/init'));
projectCommand.addCommand(require('./project_cmds/plan'));

module.exports = projectCommand;
