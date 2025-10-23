'use strict';

const { Command } = require('commander');

const functionsCommand = new Command('func')
  .description('Wharfie function commands')
  .action(() => {
    // Display help if no subcommands are specified
    functionsCommand.help();
  });

functionsCommand.addCommand(require('./functions_cmds/run'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_temporary_database'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_s3'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_dynamo'));
// utilsCommand.addCommand(require('./utils_cmds/cancel'));

module.exports = functionsCommand;
