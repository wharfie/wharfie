import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');

const appCommand = new Command('app')
  .description('Wharfie v2 app commands')
  .action(() => {
    // Display help if no subcommands are specified
    appCommand.help();
  });

appCommand.addCommand(require('./app_cmds/manifest'));

module.exports = appCommand;
