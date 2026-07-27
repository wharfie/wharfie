import { Command } from 'commander';

import { createExecutionLedgerOperatorCommands } from '../../core/runtime/operator/execution-ledger-operator.js';
import listCommand from './ops_cmds/list.js';
import runCommand from './ops_cmds/run.js';
import signalCommand from './ops_cmds/signal.js';
import startCommand from './ops_cmds/start.js';
import submitCommand from './ops_cmds/submit.js';
import workerCommand from './ops_cmds/worker.js';

const {
  inspectCommand,
  recoverCommand,
  reconcileCommand,
  reconcileEffectCommand,
  retryEffectCommand,
  cancelCommand,
} = createExecutionLedgerOperatorCommands();

const opsCommand = new Command('ops')
  .description('Durable execution-ledger operator commands')
  .addCommand(listCommand)
  .addCommand(inspectCommand)
  .addCommand(recoverCommand)
  .addCommand(reconcileCommand)
  .addCommand(reconcileEffectCommand)
  .addCommand(retryEffectCommand)
  .addCommand(cancelCommand)
  .addCommand(signalCommand)
  .addCommand(runCommand)
  .addCommand(startCommand)
  .addCommand(submitCommand)
  .addCommand(workerCommand);

export default opsCommand;
