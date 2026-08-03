import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';
import { createDurableWorkerCommand } from '../../../core/runtime/operator/durable-worker-command.js';

/**
 * Build one source resident-worker command.
 * @returns {import('commander').Command} - Fresh source worker command.
 */
export function createSourceDurableWorkerCommand() {
  return createDurableWorkerCommand({
    includeDirOption: true,
    output: {
      info: displayInfo,
      success: displaySuccess,
      failure: displayFailure,
    },
    loadExecution: loadPreparedDurableExecution,
  });
}
