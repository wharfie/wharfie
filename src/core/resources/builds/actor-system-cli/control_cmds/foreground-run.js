import { createDurableWorkflowRunCommand } from '../../../../runtime/operator/durable-workflow-run-command.js';
import { loadEmbeddedDurableExecution } from '../lib/durable-execution.js';

/**
 * Build the packaged app's foreground durable workflow command. The command is
 * bound to immutable embedded identity and has no source-directory override.
 * @param {{loadExecution?: () => Promise<import('../../../../runtime/operator/durable-workflow-run-command.js').DurableWorkflowRunExecutionHandle>, loadCliModule?: import('../../../../runtime/operator/durable-workflow-run-command.js').DurableWorkflowRunCliModuleLoader, output?: Partial<import('../../../../runtime/operator/durable-workflow-run-command.js').DurableWorkflowRunOutput>, startWorkflow?: import('../../../../runtime/operator/durable-workflow-run-command.js').DurableWorkflowRunStarter, runWorker?: import('../../../../runtime/operator/durable-workflow-run-command.js').DurableWorkflowForegroundWorker, readRunOutput?: (request: {appId: string, runId: string}) => unknown | Promise<unknown>, inspectRun?: (request: {runId: string, expectedAppId: string}) => Record<string, any> | null | Promise<Record<string, any> | null>, processRef?: import('../../../../runtime/operator/durable-workflow-run-command.js').DurableWorkflowRunProcess, pollIntervalMs?: number, ownerRetryIntervalMs?: number, now?: () => number}} [options] - Test or packaged host seams.
 * @returns {import('commander').Command} - Fresh packaged foreground command.
 */
export function createPackagedDurableWorkflowRunCommand(options = {}) {
  return createDurableWorkflowRunCommand({
    loadExecution: options.loadExecution || loadEmbeddedDurableExecution,
    ...(options.loadCliModule === undefined
      ? {}
      : { loadCliModule: options.loadCliModule }),
    ...(options.output === undefined ? {} : { output: options.output }),
    ...(options.startWorkflow === undefined
      ? {}
      : { startWorkflow: options.startWorkflow }),
    ...(options.runWorker === undefined
      ? {}
      : { runWorker: options.runWorker }),
    ...(options.readRunOutput === undefined
      ? {}
      : { readRunOutput: options.readRunOutput }),
    ...(options.inspectRun === undefined
      ? {}
      : { inspectRun: options.inspectRun }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
    ...(options.pollIntervalMs === undefined
      ? {}
      : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.ownerRetryIntervalMs === undefined
      ? {}
      : { ownerRetryIntervalMs: options.ownerRetryIntervalMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

export default createPackagedDurableWorkflowRunCommand;
