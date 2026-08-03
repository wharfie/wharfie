import { createExecutionLedgerActivityLogCommand } from '../../../core/runtime/operator/execution-ledger-activity-log-command.js';

/**
 * Build the source sensitive-log command. Historical inspection accepts an
 * exact application ID and never loads or executes current authored source.
 * @returns {import('commander').Command} - Fresh source log command.
 */
export function createSourceExecutionLedgerActivityLogCommand() {
  return createExecutionLedgerActivityLogCommand({ allowAppId: true });
}
