import { Command } from 'commander';

import { createExecutionLedgerOperatorCommands } from '../../core/runtime/operator/execution-ledger-operator.js';
import { createSourceExecutionLedgerHistoryCommand } from './ops_cmds/list.js';
import { createSourceExecutionLedgerActivityLogCommand } from './ops_cmds/logs.js';
import { createSourceExecutionLedgerRunOutputCommand } from './ops_cmds/output.js';
import { createSourceDurableRunCommand } from './ops_cmds/run.js';
import { createSourceDurableWorkflowSignalCommand } from './ops_cmds/signal.js';
import { createSourceDurableWorkflowStartCommand } from './ops_cmds/start.js';
import { createSourceDurableSubmitCommand } from './ops_cmds/submit.js';
import { createSourceDurableWorkerCommand } from './ops_cmds/worker.js';

/**
 * Build one source durable-operations command group. Every invocation creates
 * new leaves because Commander reparents mutable command instances.
 * @returns {Command} - Fresh source operations command tree.
 */
export function createSourceOpsCommand() {
  const {
    inspectCommand,
    recoverCommand,
    reconcileCommand,
    reconcileEffectCommand,
    retryEffectCommand,
    cancelCommand,
  } = createExecutionLedgerOperatorCommands();

  return new Command('ops')
    .description('Durable execution-ledger operator commands')
    .addCommand(createSourceExecutionLedgerHistoryCommand())
    .addCommand(createSourceExecutionLedgerActivityLogCommand())
    .addCommand(createSourceExecutionLedgerRunOutputCommand())
    .addCommand(inspectCommand)
    .addCommand(recoverCommand)
    .addCommand(reconcileCommand)
    .addCommand(reconcileEffectCommand)
    .addCommand(retryEffectCommand)
    .addCommand(cancelCommand)
    .addCommand(createSourceDurableWorkflowSignalCommand())
    .addCommand(createSourceDurableRunCommand())
    .addCommand(createSourceDurableWorkflowStartCommand())
    .addCommand(createSourceDurableSubmitCommand())
    .addCommand(createSourceDurableWorkerCommand());
}
