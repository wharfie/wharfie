import { createExecutionLedgerRunOutputCommand } from '../../../core/runtime/operator/execution-ledger-run-output-command.js';

/**
 * Build the source sensitive run-output command. Historical reads accept an
 * exact app ID and never load or execute current authored source.
 * @returns {import('commander').Command} - Fresh source output command.
 */
export function createSourceExecutionLedgerRunOutputCommand() {
  return createExecutionLedgerRunOutputCommand({ allowAppId: true });
}

export default createSourceExecutionLedgerRunOutputCommand;
