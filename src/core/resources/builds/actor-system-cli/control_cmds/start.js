import { createDurableWorkflowStartCommand } from '../../../../runtime/operator/durable-workflow-start-command.js';
import { loadEmbeddedDurableExecution } from '../lib/durable-execution.js';

/**
 * Build a fresh workflow-start command bound only to this artifact's embedded
 * application revision.
 * @param {{loadExecution?: () => Promise<import('../../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStartExecutionHandle>, output?: Partial<import('../../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStartCommandOutput>, startWorkflow?: import('../../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStarter, processRef?: import('../../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStartProcess}} [options] - Test or packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged workflow-start command.
 */
export function createPackagedDurableWorkflowStartCommand(options = {}) {
  return createDurableWorkflowStartCommand({
    loadExecution: options.loadExecution || loadEmbeddedDurableExecution,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.startWorkflow === undefined
      ? {}
      : { startWorkflow: options.startWorkflow }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
}

export default createPackagedDurableWorkflowStartCommand;
