import { Command } from 'commander';

import { createExecutionLedgerActivityLogCommand } from '../../../runtime/operator/execution-ledger-activity-log-command.js';
import { createExecutionLedgerHistoryCommand } from '../../../runtime/operator/execution-ledger-history-command.js';
import { createExecutionLedgerOperatorCommands } from '../../../runtime/operator/execution-ledger-operator.js';
import { createExecutionLedgerRunOutputCommand } from '../../../runtime/operator/execution-ledger-run-output-command.js';
import { readEmbeddedRevisionRuntimePair } from '../lib/revision-runtime-assets.js';
import { createPackagedManifestCommand } from './control_cmds/manifest.js';
import { createPackagedMetadataCommand } from './control_cmds/metadata.js';
import { createPackagedDeploymentCommand } from './control_cmds/deployment.js';
import { createPackagedDurableRunCommand } from './control_cmds/run.js';
import { createPackagedSystemdUserServiceCommand } from './control_cmds/service.js';
import { createPackagedDurableWorkflowSignalCommand } from './control_cmds/signal.js';
import { createPackagedDurableWorkflowStartCommand } from './control_cmds/start.js';
import { createPackagedDurableSubmitCommand } from './control_cmds/submit.js';
import { createPackagedDurableWorkerCommand } from './control_cmds/worker.js';

/**
 * Build a fresh packaged operator program. Identity is read lazily so help and
 * immutable metadata commands do not open application control state.
 * @param {{resolveExpectedIdentity?: () => Promise<{appId: string, revisionId?: string}>, readRunOutput?: (request: {appId: string, runId: string}) => unknown | Promise<unknown>, runOutputOutput?: Partial<import('../../../runtime/operator/execution-ledger-run-output-command.js').ExecutionLedgerRunOutputPort>, loadDurableRunExecution?: () => Promise<import('../../../runtime/operator/durable-run-command.js').DurableRunExecutionHandle>, durableRunOutput?: Partial<import('../../../runtime/operator/durable-run-command.js').DurableRunCommandOutput>, runActivity?: typeof import('../../../runtime/durable-activity-host.js').runLocalDurableManifestActivity, loadDurableWorkflowStartExecution?: () => Promise<import('../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStartExecutionHandle>, durableWorkflowStartOutput?: Partial<import('../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStartCommandOutput>, startWorkflow?: import('../../../runtime/operator/durable-workflow-start-command.js').DurableWorkflowStarter, durableWorkflowSignalOutput?: Partial<import('../../../runtime/operator/durable-workflow-signal-command.js').DurableWorkflowSignalCommandOutput>, deliverWorkflowSignal?: typeof import('../../../runtime/operator/durable-workflow-signal-command.js').deliverLocalDurableWorkflowSignal, loadDurableSubmitExecution?: () => Promise<import('../../../runtime/operator/durable-submit-command.js').DurableSubmitExecutionHandle>, durableSubmitOutput?: Partial<import('../../../runtime/operator/durable-submit-command.js').DurableSubmitCommandOutput>, submitActivity?: import('../../../runtime/operator/durable-submit-command.js').ResidentActivitySubmit, loadDurableWorkerExecution?: () => Promise<import('../../../runtime/operator/durable-worker-command.js').DurableWorkerExecutionHandle>, durableWorkerOutput?: Partial<import('../../../runtime/operator/durable-worker-command.js').DurableWorkerCommandOutput>, runResidentWorker?: import('../../../runtime/operator/durable-worker-command.js').ResidentActivityWorkerRunner, loadSystemdUserServiceOperator?: () => any | Promise<any>, systemdUserServiceOutput?: Partial<import('../../../runtime/operator/systemd-user-service-command.js').SystemdUserServiceCommandOutput>, processRef?: import('../../../runtime/operator/durable-run-command.js').DurableRunProcess}} [options] - Test or packaged identity and durable command providers.
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
  const listCommand = createExecutionLedgerHistoryCommand({
    async resolveIdentity() {
      const identity = await resolveExpectedIdentity();
      return { appId: identity.appId };
    },
  });
  const logsCommand = createExecutionLedgerActivityLogCommand({
    async resolveAppId() {
      return (await resolveExpectedIdentity()).appId;
    },
  });
  const outputCommand = createExecutionLedgerRunOutputCommand({
    async resolveAppId() {
      return (await resolveExpectedIdentity()).appId;
    },
    ...(options.readRunOutput === undefined
      ? {}
      : { readOutput: options.readRunOutput }),
    ...(options.runOutputOutput === undefined
      ? {}
      : { output: options.runOutputOutput }),
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
  const startCommand = createPackagedDurableWorkflowStartCommand({
    ...(options.loadDurableWorkflowStartExecution === undefined
      ? {}
      : { loadExecution: options.loadDurableWorkflowStartExecution }),
    ...(options.durableWorkflowStartOutput === undefined
      ? {}
      : { output: options.durableWorkflowStartOutput }),
    ...(options.startWorkflow === undefined
      ? {}
      : { startWorkflow: options.startWorkflow }),
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
  const signalCommand = createPackagedDurableWorkflowSignalCommand({
    resolveExpectedIdentity,
    ...(options.durableWorkflowSignalOutput === undefined
      ? {}
      : { output: options.durableWorkflowSignalOutput }),
    ...(options.deliverWorkflowSignal === undefined
      ? {}
      : { deliverSignal: options.deliverWorkflowSignal }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
  const serviceCommand = createPackagedSystemdUserServiceCommand({
    ...(options.loadSystemdUserServiceOperator === undefined
      ? {}
      : { loadOperator: options.loadSystemdUserServiceOperator }),
    ...(options.systemdUserServiceOutput === undefined
      ? {}
      : { output: options.systemdUserServiceOutput }),
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });
  const deploymentCommand = createPackagedDeploymentCommand({
    ...(options.processRef === undefined
      ? {}
      : { processRef: options.processRef }),
  });

  const program = new Command()
    .name('wharfie')
    .description('Wharfie operator commands for this packaged application')
    .addCommand(createPackagedManifestCommand())
    .addCommand(createPackagedMetadataCommand())
    .addCommand(runCommand)
    .addCommand(startCommand)
    .addCommand(submitCommand)
    .addCommand(workerCommand)
    .addCommand(listCommand)
    .addCommand(logsCommand)
    .addCommand(outputCommand)
    .addCommand(inspectCommand)
    .addCommand(recoverCommand)
    .addCommand(reconcileCommand)
    .addCommand(reconcileEffectCommand)
    .addCommand(retryEffectCommand)
    .addCommand(cancelCommand)
    .addCommand(signalCommand)
    .addCommand(serviceCommand)
    .addCommand(deploymentCommand);

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
