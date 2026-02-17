import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');

const utilsCommand = new Command('utils')
  .description('Wharfie utility commands')
  .action(() => {
    // Display help if no subcommands are specified
    utilsCommand.help();
  });

utilsCommand.addCommand(require('./utils_cmds/dependency_list'));
utilsCommand.addCommand(require('./utils_cmds/cleanup_temporary_database'));
utilsCommand.addCommand(require('./utils_cmds/cleanup_s3'));
utilsCommand.addCommand(require('./utils_cmds/cleanup_dynamo'));
utilsCommand.addCommand(require('./utils_cmds/cancel'));

module.exports = utilsCommand;
