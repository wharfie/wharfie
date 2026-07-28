import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';
import {
  createDurableRunCommand,
  createForegroundCancellation,
} from '../../../core/runtime/operator/durable-run-command.js';

export { createForegroundCancellation };

/**
 * Build one source durable-run command with source preparation and CLI output.
 * @returns {import('commander').Command} - Fresh source durable-run command.
 */
export function createSourceDurableRunCommand() {
  return createDurableRunCommand({
    includeDirOption: true,
    output: {
      info: displayInfo,
      success: displaySuccess,
      failure: displayFailure,
    },
    loadExecution: loadPreparedDurableExecution,
  });
}
