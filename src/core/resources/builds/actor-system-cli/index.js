import { Command } from 'commander';

import { createExecutionLedgerOperatorCommands } from '../../../runtime/operator/execution-ledger-operator.js';
import { readEmbeddedRevisionRuntimePair } from '../lib/revision-runtime-assets.js';
import manifestCommand from './control_cmds/manifest.js';
import metadataCommand from './control_cmds/metadata.js';
import { createPackagedDurableRunCommand } from './control_cmds/run.js';
import { createPackagedDurableSubmitCommand } from './control_cmds/submit.js';
import { createPackagedDurableWorkerCommand } from './control_cmds/worker.js';

/**
 * Build a fresh packaged operator program. Identity is read lazily so help and
 * immutable metadata commands do not open application control state.
 * @param {{resolveExpectedIdentity?: () => Promise<{appId: string, revisionId?: string}>, loadDurableRunExecution?: () => Promise<import('../../../runtime/operator/durable-run-command.js').DurableRunExecutionHandle>, durableRunOutput?: Partial<import('../../../runtime/operator/durable-run-command.js').DurableRunCommandOutput>, runActivity?: typeof import('../../../runtime/durable-activity-host.js').runLocalDurableManifestActivity, loadDurableSubmitExecution?: () => Promise<import('../../../runtime/operator/durable-submit-command.js').DurableSubmitExecutionHandle>, durableSubmitOutput?: Partial<import('../../../runtime/operator/durable-submit-command.js').DurableSubmitCommandOutput>, submitActivity?: import('../../../runtime/operator/durable-submit-command.js').ResidentActivitySubmit, loadDurableWorkerExecution?: () => Promise<import('../../../runtime/operator/durable-worker-command.js').DurableWorkerExecutionHandle>, durableWorkerOutput?: Partial<import('../../../runtime/operator/durable-worker-command.js').DurableWorkerCommandOutput>, runResidentWorker?: import('../../../runtime/operator/durable-worker-command.js').ResidentActivityWorkerRunner, processRef?: import('../../../runtime/operator/durable-run-command.js').DurableRunProcess}} [options] - Test or packaged identity and durable command providers.
 * @returns {Command} - Packaged operator program.
 */
export function createProgram(options = {}) {
  const resolveExpectedIdentity =
    options.resolveExpectedIdentity ||
    (async () => {
      const pair = await readEmbeddedRevisionRuntimePair();
      return {
        appId: pair.runtime.appId,
        revisionId: pair.runtime.revisionId,
      };
    });
  const {
    inspectCommand,
    recoverCommand,
    reconcileCommand,
    reconcileEffectCommand,
    retryEffectCommand,
    cancelCommand,
  } = createExecutionLedgerOperatorCommands({
    resolveExpectedIdentity,
    requireLocalOwnership: true,
  });
  const runCommand = createPackagedDurableRunCommand({
    ...(options.loadDurableRunExecution === undefined
      ? {}
      : { loadExecution: options.loadDurableRunExecution }),
    ...(options.durableRunOutput === undefined
      ? {}
      : { output: options.durableRunOutput }),
    ...(options.runActivity === undefined
      ? {}
      : { runActivity: options.runActivity }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
  const submitCommand = createPackagedDurableSubmitCommand({
    ...(options.loadDurableSubmitExecution === undefined
      ? {}
      : { loadExecution: options.loadDurableSubmitExecution }),
    ...(options.durableSubmitOutput === undefined
      ? {}
      : { output: options.durableSubmitOutput }),
    ...(options.submitActivity === undefined
      ? {}
      : { submit: options.submitActivity }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
  const workerCommand = createPackagedDurableWorkerCommand({
    ...(options.loadDurableWorkerExecution === undefined
      ? {}
      : { loadExecution: options.loadDurableWorkerExecution }),
    ...(options.durableWorkerOutput === undefined
      ? {}
      : { output: options.durableWorkerOutput }),
    ...(options.runResidentWorker === undefined
      ? {}
      : { runWorker: options.runResidentWorker }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });

  const program = new Command()
    .name('wharfie')
    .description('Wharfie operator commands for this packaged application')
    .addCommand(manifestCommand)
    .addCommand(metadataCommand)
    .addCommand(runCommand)
    .addCommand(submitCommand)
    .addCommand(workerCommand)
    .addCommand(inspectCommand)
    .addCommand(recoverCommand)
    .addCommand(reconcileCommand)
    .addCommand(reconcileEffectCommand)
    .addCommand(retryEffectCommand)
    .addCommand(cancelCommand);

  return program;
}

/**
 * Run the deliberately small public operator surface embedded in an app SEA.
 * Runtime service bootstrap is selected through hidden environment state and
 * does not share this public argv namespace.
 * @param {string[]} [argv] - Node-style argv.
 * @returns {Promise<void>} - Resolves when the command completes.
 */
async function entrypoint(argv = process.argv) {
  const program = createProgram();

  if (!argv.slice(2).length) {
    program.outputHelp();
    return;
  }

  await program.parseAsync(argv);
}

export default entrypoint;
