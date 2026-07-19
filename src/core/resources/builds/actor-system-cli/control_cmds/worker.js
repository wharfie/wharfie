import { createDurableWorkerCommand } from '../../../../runtime/operator/durable-worker-command.js';
import { loadEmbeddedDurableExecution } from '../lib/durable-execution.js';

/**
 * Build a fresh resident-worker command bound only to this artifact's embedded
 * application revision.
 * @param {{loadExecution?: () => Promise<import('../../../../runtime/operator/durable-worker-command.js').DurableWorkerExecutionHandle>, output?: Partial<import('../../../../runtime/operator/durable-worker-command.js').DurableWorkerCommandOutput>, runWorker?: import('../../../../runtime/operator/durable-worker-command.js').ResidentActivityWorkerRunner, processRef?: import('../../../../runtime/operator/durable-worker-command.js').DurableWorkerProcess}} [options] - Test or packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged worker command.
 */
export function createPackagedDurableWorkerCommand(options = {}) {
  return createDurableWorkerCommand({
    loadExecution: options.loadExecution || loadEmbeddedDurableExecution,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.runWorker === undefined
      ? {}
      : { runWorker: options.runWorker }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
}

export default createPackagedDurableWorkerCommand;
