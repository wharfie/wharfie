/* eslint-disable jsdoc/require-jsdoc, no-process-exit */

import { loadPreparedDurableExecution } from '../../src/cli/app/load-durable-execution.js';
import {
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import { resolveManifestActivityExecutionIdentity } from '../../src/core/runtime/app-runs.js';
import { createDurableWorkflowStartCommand } from '../../src/core/runtime/operator/durable-workflow-start-command.js';
import { createExecutionLedgerOperatorCommands } from '../../src/core/runtime/operator/execution-ledger-operator.js';
import { withExecutionLedger } from '../../src/core/runtime/operator/execution-ledger-store.js';
import { runResidentActivityWorker } from '../../src/core/runtime/services/resident-activity-worker.js';
import { createLedgerService } from '../../src/core/runtime/services/ledger-service.js';

const WorkerBoundary = Object.freeze({
  CLAIM: 'claim-committed',
  START: 'start-committed',
  TERMINAL_READY: 'terminal-evidence-ready',
  TERMINAL: 'terminal-committed',
});
const CommandBoundary = Object.freeze({
  START_RESPONSE: 'start-response-ready',
  CANCELLATION_RESPONSE: 'cancellation-response-ready',
  RECOVERY_RESPONSE: 'recovery-response-ready',
  RECONCILIATION_RESPONSE: 'reconciliation-response-ready',
});
const VALID_MODES = new Set([
  'worker',
  'start-response',
  'cancel-response',
  'recover-response',
  'reconcile-response',
]);

/** @returns {Record<string, any>} - Strict child options. */
function parseOptions() {
  const options = JSON.parse(process.argv[2] || 'null');
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Workflow crash child options must be an object.');
  }
  if (!VALID_MODES.has(options.mode)) {
    throw new TypeError(
      `Unsupported workflow crash child mode: ${options.mode}`,
    );
  }
  for (const key of ['appDir', 'configuration']) {
    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw new TypeError(`Workflow crash child options.${key} is required.`);
    }
  }
  return options;
}

/** @param {Record<string, any>} message @returns {Promise<void>} */
async function send(message) {
  if (typeof process.send !== 'function') {
    throw new Error('Workflow crash child requires a Node IPC channel.');
  }
  const ipcSend = process.send.bind(process);
  await new Promise((resolve, reject) => {
    ipcSend(message, undefined, undefined, (error) => {
      if (error) reject(error);
      else resolve(undefined);
    });
  });
}

function waitForever() {
  const word = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(word, 0, 0);
}

/**
 * @param {string} boundary
 * @param {Record<string, any>} [detail]
 * @param {Record<string, any>} [ownership]
 */
async function reach(boundary, detail = {}, ownership) {
  await send({
    kind: 'boundary',
    boundary,
    detail,
    ...(ownership === undefined ? {} : { ownership }),
  });
  waitForever();
}

/** @param {Record<string, any>} result @returns {Record<string, any>} */
function transitionDetail(result) {
  return {
    runId: result.run?.runId,
    runVersion: result.run?.version,
    invocationId: result.invocation?.invocationId,
    attemptId: result.attempt?.attemptId,
    attemptStatus: result.attempt?.status,
    cursorDisposition: result.workflowCursor?.disposition,
    cursorVersion: result.workflowCursor?.version,
    stepId: result.workflowCursor?.stepId,
    stepIndex: result.workflowCursor?.stepIndex,
  };
}

/** @param {Record<string, any>} options */
async function runWorker(options) {
  if (!Object.values(WorkerBoundary).includes(options.boundary)) {
    throw new TypeError(
      `Unsupported workflow worker crash boundary: ${options.boundary}`,
    );
  }
  const loaded = await loadPreparedDurableExecution({ dir: options.appDir });
  const identity = resolveManifestActivityExecutionIdentity(loaded.execution);
  try {
    await withExecutionLedger(
      async (ledger, controlContext) => {
        const service = createLedgerService({
          appId: identity.appId,
          revisionId: identity.revisionId,
          lifecycle: createLedgerServiceLifecycle({
            db: controlContext.db,
            tableName: controlContext.tableName,
          }),
          ownership: createLedgerServiceOwnership({
            db: controlContext.db,
            tableName: controlContext.tableName,
          }),
          sessionRoot: controlContext.sessionPath,
        });
        await service.start({ deferReady: true });
        const owner = service.getLocalOwner();
        if (!owner) throw new Error('Workflow crash worker acquired no owner.');

        const controlledLedger = {
          ...ledger,
          async claimWorkflowActivity(
            /** @type {Parameters<typeof ledger.claimWorkflowActivity>[0]} */ input,
          ) {
            const result = await ledger.claimWorkflowActivity(input);
            if (options.boundary === WorkerBoundary.CLAIM) {
              await reach(
                WorkerBoundary.CLAIM,
                transitionDetail(result),
                owner.ownership,
              );
            }
            return result;
          },
          async markWorkflowActivityStarted(
            /** @type {Parameters<typeof ledger.markWorkflowActivityStarted>[0]} */ input,
          ) {
            const result = await ledger.markWorkflowActivityStarted(input);
            if (options.boundary === WorkerBoundary.START) {
              await reach(
                WorkerBoundary.START,
                transitionDetail(result),
                owner.ownership,
              );
            }
            return result;
          },
          async commitVerifiedWorkflowActivityTerminal(
            /** @type {Parameters<typeof ledger.commitVerifiedWorkflowActivityTerminal>[0]} */ input,
          ) {
            if (
              options.boundary === WorkerBoundary.TERMINAL_READY &&
              input.cursor?.stepIndex === 0
            ) {
              await reach(
                WorkerBoundary.TERMINAL_READY,
                {
                  runId: input.runId,
                  invocationId: input.invocationId,
                  attemptId: input.attemptId,
                  stepIndex: input.cursor.stepIndex,
                  evidence: input.evidence,
                },
                owner.ownership,
              );
            }
            const result =
              await ledger.commitVerifiedWorkflowActivityTerminal(input);
            if (
              options.boundary === WorkerBoundary.TERMINAL &&
              input.cursor?.stepIndex === 0
            ) {
              await reach(
                WorkerBoundary.TERMINAL,
                transitionDetail(result),
                owner.ownership,
              );
            }
            return result;
          },
        };

        await runResidentActivityWorker({
          ledger: controlledLedger,
          execution: loaded.execution,
          controlContext,
          owner,
          pollIntervalMs: 10,
          onReady: async () => {
            await service.markReady();
          },
        });
      },
      { configuration: options.configuration },
    );
  } finally {
    await loaded.cleanup?.();
  }
}

/** @param {string} boundary */
function createCommandBoundary(boundary) {
  /** @type {Promise<void> | undefined} */
  let pending;
  return {
    output: {
      json(/** @type {Record<string, any>} */ value) {
        pending = reach(boundary, { response: value });
      },
      success() {},
      failure(/** @type {unknown} */ error) {
        throw error;
      },
    },
    async parse(
      /** @type {import('commander').Command} */ command,
      /** @type {string[]} */ args,
    ) {
      await command.parseAsync(args, { from: 'user' });
      if (!pending) {
        throw new Error(
          `Workflow command completed without reaching ${boundary}.`,
        );
      }
      await pending;
    },
  };
}

/** @param {Record<string, any>} options */
async function runStartResponse(options) {
  const boundary = createCommandBoundary(CommandBoundary.START_RESPONSE);
  const command = createDurableWorkflowStartCommand({
    includeDirOption: true,
    loadExecution: loadPreparedDurableExecution,
    output: boundary.output,
  });
  // This is the same command factory as the source CLI, with only its output
  // sink replaced by the deterministic IPC response boundary.
  await boundary.parse(command, [
    '--workflow',
    options.workflowId,
    '--idempotency-key',
    options.idempotencyKey,
    '--dir',
    options.appDir,
    '--input',
    JSON.stringify(options.input),
    '--json',
  ]);
}

/** @param {Record<string, any>} options */
async function runCancellationResponse(options) {
  const boundary = createCommandBoundary(CommandBoundary.CANCELLATION_RESPONSE);
  const commands = createExecutionLedgerOperatorCommands({
    output: boundary.output,
  });
  await boundary.parse(commands.cancelCommand, [
    '--run-id',
    options.runId,
    '--request-id',
    options.requestId,
    '--json',
  ]);
}

/**
 * @param {Record<string, any>} options
 * @param {'recover'|'reconcile'} kind
 */
async function runOperatorResponse(options, kind) {
  const isRecovery = kind === 'recover';
  const boundary = createCommandBoundary(
    isRecovery
      ? CommandBoundary.RECOVERY_RESPONSE
      : CommandBoundary.RECONCILIATION_RESPONSE,
  );
  const commands = createExecutionLedgerOperatorCommands({
    output: boundary.output,
  });
  const command = isRecovery
    ? commands.recoverCommand
    : commands.reconcileCommand;
  const args = isRecovery
    ? ['--run-id', options.runId, '--confirm-runner-stopped', '--json']
    : [
        '--run-id',
        options.runId,
        '--reconciliation-id',
        options.reconciliationId,
        '--evidence-file',
        options.evidenceFile,
        '--confirm-runner-stopped',
        '--json',
      ];
  await boundary.parse(command, args);
}

async function main() {
  const options = parseOptions();
  if (options.mode === 'worker') return await runWorker(options);
  if (options.mode === 'start-response') return await runStartResponse(options);
  if (options.mode === 'cancel-response') {
    return await runCancellationResponse(options);
  }
  if (options.mode === 'recover-response') {
    return await runOperatorResponse(options, 'recover');
  }
  return await runOperatorResponse(options, 'reconcile');
}

main().catch(async (error) => {
  await send({
    kind: 'fatal',
    error:
      error instanceof Error ? error.stack || error.message : String(error),
  }).catch(() => {});
  process.exit(1);
});
