import { createDurableWorkflowSignalCommand } from '../../../../runtime/operator/durable-workflow-signal-command.js';

/**
 * Build a fresh signal command scoped to this artifact's embedded application.
 * @param {{resolveExpectedIdentity: () => Promise<{appId: string, revisionId?: string}> | {appId: string, revisionId?: string}, output?: Partial<import('../../../../runtime/operator/durable-workflow-signal-command.js').DurableWorkflowSignalCommandOutput>, deliverSignal?: typeof import('../../../../runtime/operator/durable-workflow-signal-command.js').deliverLocalDurableWorkflowSignal, processRef?: {exitCode: number | undefined}}} options - Packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged signal command.
 */
export function createPackagedDurableWorkflowSignalCommand(options) {
  if (!options || typeof options.resolveExpectedIdentity !== 'function') {
    throw new TypeError(
      'createPackagedDurableWorkflowSignalCommand requires resolveExpectedIdentity.',
    );
  }
  return createDurableWorkflowSignalCommand({
    resolveExpectedIdentity: options.resolveExpectedIdentity,
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.deliverSignal === undefined
      ? {}
      : { deliverSignal: options.deliverSignal }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
}

export default createPackagedDurableWorkflowSignalCommand;
