import { createDurableWorkflowSignalCommand } from '../../../core/runtime/operator/durable-workflow-signal-command.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';

/**
 * Build one source workflow-signal command.
 * @returns {import('commander').Command} - Fresh source signal command.
 */
export function createSourceDurableWorkflowSignalCommand() {
  return createDurableWorkflowSignalCommand({
    output: {
      success: displaySuccess,
      failure: displayFailure,
    },
  });
}
