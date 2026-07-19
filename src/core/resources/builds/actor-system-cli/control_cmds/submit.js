import { createDurableSubmitCommand } from '../../../../runtime/operator/durable-submit-command.js';
import { loadEmbeddedDurableExecution } from '../lib/durable-execution.js';

/**
 * Build a fresh submission command bound only to this artifact's embedded
 * application revision.
 * @param {{loadExecution?: () => Promise<import('../../../../runtime/operator/durable-submit-command.js').DurableSubmitExecutionHandle>, output?: Partial<import('../../../../runtime/operator/durable-submit-command.js').DurableSubmitCommandOutput>, submit?: import('../../../../runtime/operator/durable-submit-command.js').ResidentActivitySubmit, processRef?: import('../../../../runtime/operator/durable-submit-command.js').DurableSubmitProcess}} [options] - Test or packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged submit command.
 */
export function createPackagedDurableSubmitCommand(options = {}) {
  return createDurableSubmitCommand({
    loadExecution: options.loadExecution || loadEmbeddedDurableExecution,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.submit === undefined ? {} : { submit: options.submit }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
}

export default createPackagedDurableSubmitCommand;
