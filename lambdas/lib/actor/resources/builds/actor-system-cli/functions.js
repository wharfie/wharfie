import { Command } from 'commander';
import RunCmd from './functions_cmds/run.js';

const functionsCommand = new Command('func')
  .description('Wharfie function commands')
  .action(() => {
    // Display help if no subcommands are specified
    functionsCommand.help();
  });

functionsCommand.addCommand(RunCmd);
// utilsCommand.addCommand(require('./utils_cmds/cleanup_temporary_database'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_s3'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_dynamo'));
// utilsCommand.addCommand(require('./utils_cmds/cancel'));

export default functionsCommand;
