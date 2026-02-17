import { Command } from 'commander';

import startCmd from './state_cmds/start.js';
import serveCmd from './state_cmds/serve.js';

const stateCommand = new Command('state')
  .description(
    'Actor runtime: start services (lambda/db/queue) and control plane',
  )
  .action(() => {
    stateCommand.help();
  });

stateCommand.addCommand(startCmd);
stateCommand.addCommand(serveCmd);

export default stateCommand;
