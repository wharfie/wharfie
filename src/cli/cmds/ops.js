import { Command } from 'commander';

import { createExecutionLedgerOperatorCommands } from '../../core/runtime/operator/execution-ledger-operator.js';
import runCommand from './ops_cmds/run.js';

const { inspectCommand, recoverCommand, cancelCommand } =
  createExecutionLedgerOperatorCommands();

const opsCommand = new Command('ops')
  .description('Durable execution-ledger operator commands')
  .addCommand(inspectCommand)
  .addCommand(recoverCommand)
  .addCommand(cancelCommand)
  .addCommand(runCommand);

export default opsCommand;
