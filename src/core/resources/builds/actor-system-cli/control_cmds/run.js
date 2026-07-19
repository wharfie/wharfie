import { createDurableRunCommand } from '../../../../runtime/operator/durable-run-command.js';
import { loadEmbeddedDurableExecution } from '../lib/durable-execution.js';

/**
 * Build a fresh durable run command bound only to the artifact's immutable
 * embedded app identity. A packaged caller cannot redirect execution to host
 * source with a directory option.
 * @param {{loadExecution?: () => Promise<import('../../../../runtime/operator/durable-run-command.js').DurableRunExecutionHandle>, output?: Partial<import('../../../../runtime/operator/durable-run-command.js').DurableRunCommandOutput>, runActivity?: typeof import('../../../../runtime/durable-activity-host.js').runLocalDurableManifestActivity, processRef?: import('../../../../runtime/operator/durable-run-command.js').DurableRunProcess}} [options] - Test or packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged durable run command.
 */
export function createPackagedDurableRunCommand(options = {}) {
  return createDurableRunCommand({
    loadExecution: options.loadExecution || loadEmbeddedDurableExecution,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.runActivity === undefined
      ? {}
      : { runActivity: options.runActivity }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
}

export default createPackagedDurableRunCommand;
