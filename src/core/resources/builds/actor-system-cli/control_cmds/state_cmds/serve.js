import { Command } from 'commander';

import serveDbCmd from './serve_cmds/db.js';
import serveQueueCmd from './serve_cmds/queue.js';
import serveLambdaCmd from './serve_cmds/lambda.js';

const serveCmd = new Command('serve')
  .description('Run a single node service (db | queue | lambda)')
  .action(() => {
    serveCmd.help();
  });

serveCmd.addCommand(serveDbCmd);
serveCmd.addCommand(serveQueueCmd);
serveCmd.addCommand(serveLambdaCmd);

export default serveCmd;
