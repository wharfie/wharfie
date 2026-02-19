import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');

const opsCommand = new Command('ops')
  .description('Inspect and execute operation DAGs')
  .action(() => {
    // Display help if no subcommands are specified
    opsCommand.help();
  });

opsCommand.addCommand(require('./ops_cmds/list'));
opsCommand.addCommand(require('./ops_cmds/cancel'));
opsCommand.addCommand(require('./ops_cmds/run'));

opsCommand.addHelpText(
  'after',
  `

Examples:
  wharfie ops list <resourceId>
  wharfie ops list <resourceId> <operationId>
  wharfie ops cancel <resourceId> --operationId <operationId>
  wharfie ops cancel <resourceId> --type LOAD
  wharfie ops run <resourceId> <operationId>

DB configuration (provider-neutral):
  WHARFIE_DB_ADAPTER=vanilla|lmdb|dynamodb   (default: vanilla)
  WHARFIE_DB_PATH=/path/to/db               (vanilla/lmdb)
`,
);

module.exports = opsCommand;
