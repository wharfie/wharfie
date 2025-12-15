import { Command } from 'commander';

const infraCommand = new Command('infra')
  .description('Wharfie infra commands')
  .action(() => {
    // Display help if no subcommands are specified
    infraCommand.help();
  });

infraCommand.hook('preAction', async () => {
  console.log('infra pre action');
});
// utilsCommand.addCommand(require('./utils_cmds/dependency_list'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_temporary_database'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_s3'));
// utilsCommand.addCommand(require('./utils_cmds/cleanup_dynamo'));
// utilsCommand.addCommand(require('./utils_cmds/cancel'));

export default infraCommand;
