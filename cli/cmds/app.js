import { Command } from 'commander';

import manifestCommand from './app_cmds/manifest.js';

const appCommand = new Command('app')
  .description('Local-only v2 app commands')
  .addCommand(manifestCommand);

export default appCommand;
