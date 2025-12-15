import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');

const deploymentCommand = new Command('deployment')
  .description('Wharfie deployment commands')
  .action(() => {
    // Display help if no subcommands are specified
    deploymentCommand.help();
  });

deploymentCommand.addCommand(require('./deployment_cmds/config'));
deploymentCommand.addCommand(require('./deployment_cmds/create'));
deploymentCommand.addCommand(require('./deployment_cmds/destroy'));
deploymentCommand.addCommand(require('./deployment_cmds/upgrade'));

module.exports = deploymentCommand;
