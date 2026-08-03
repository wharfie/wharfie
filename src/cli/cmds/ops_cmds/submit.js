import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { createDurableSubmitCommand } from '../../../core/runtime/operator/durable-submit-command.js';

/**
 * Build one source resident-activity submission command.
 * @returns {import('commander').Command} - Fresh source submit command.
 */
export function createSourceDurableSubmitCommand() {
  return createDurableSubmitCommand({
    includeDirOption: true,
    output: {
      success: displaySuccess,
      failure: displayFailure,
    },
    loadExecution: loadPreparedDurableExecution,
  });
}
