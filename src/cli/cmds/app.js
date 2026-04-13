import { Command } from 'commander';

import manifestCommand from './app_cmds/manifest.js';
import packageCommand from './app_cmds/package.js';
import runCommand from './app_cmds/run.js';

const appCommand = new Command('app')
  .description('Local-only v2 app commands')
  .addCommand(manifestCommand)
  .addCommand(runCommand)
  .addCommand(packageCommand);

export default appCommand;
