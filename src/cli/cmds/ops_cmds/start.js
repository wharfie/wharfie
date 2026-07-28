import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { createDurableWorkflowStartCommand } from '../../../core/runtime/operator/durable-workflow-start-command.js';

/**
 * Build one source durable workflow-start command.
 * @returns {import('commander').Command} - Fresh source workflow-start command.
 */
export function createSourceDurableWorkflowStartCommand() {
  return createDurableWorkflowStartCommand({
    includeDirOption: true,
    output: {
      success: displaySuccess,
      failure: displayFailure,
    },
    loadExecution: loadPreparedDurableExecution,
  });
}
