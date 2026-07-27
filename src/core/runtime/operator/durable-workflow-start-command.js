import { Command } from 'commander';

import { resolveManifestActivityExecutionIdentity } from '../app-runs.js';
import { resolveManifestWorkflowStartBinding } from '../durable-workflow-host.js';
import { createWorkflowRunId } from '../../lib/ledger/workflow-execution-contract.js';
import { startLocalDurableManifestWorkflow } from '../services/resident-activity-worker.js';
import {
  createDurableWorkflowStartReceipt,
  formatDurableWorkflowStartHumanRow,
} from './durable-operation-receipt.js';

/**
 * @typedef DurableWorkflowStartCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write one redacted JSON receipt.
 * @property {(rows: Record<string, any>[]) => void} table - Write redacted table rows.
 * @property {(message: string) => void} success - Write accepted-run text.
 * @property {(error: unknown) => void} failure - Write a safe failure.
 */

/**
 * @typedef DurableWorkflowStartExecutionHandle
 * @property {import('../durable-activity-host.js').ManifestActivityExecution} execution - Prepared-source or embedded immutable execution descriptor.
 * @property {() => void | Promise<void>} [cleanup] - Release execution-scoped resources.
 */

/**
 * @typedef DurableWorkflowStartProcess
 * @property {() => string} [cwd] - Resolve the source CLI default directory.
 * @property {number | undefined} exitCode - Process exit status.
 */

/**
 * @typedef {(options: {execution: import('../durable-activity-host.js').ManifestActivityExecution, workflowId: string, idempotencyKey: string, input: any, callerMetadata: Record<string, any>, actor?: {kind: string, id: string}}) => Promise<Readonly<Record<string, any>>> | Readonly<Record<string, any>>} DurableWorkflowStarter
 */

/**
 * @param {Partial<DurableWorkflowStartCommandOutput> | undefined} provided - Optional host output hooks.
 * @returns {DurableWorkflowStartCommandOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  return {
    json:
      provided?.json ||
      ((value) => {
        console.log(JSON.stringify(value));
      }),
    table: provided?.table || ((rows) => console.table(rows)),
    success:
      provided?.success ||
      ((message) => {
        console.log('OK', message);
      }),
    failure:
      provided?.failure ||
      ((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error(message);
      }),
  };
}

/**
 * @param {string | undefined} input - JSON option value.
 * @param {string} label - Human-readable option label.
 * @param {any} defaultValue - Value used for an absent or empty option.
 * @returns {any} - Parsed JSON value.
 */
function parseJsonInput(input, label, defaultValue) {
  if (typeof input !== 'string') return defaultValue;
  const trimmed = input.trim();
  if (!trimmed) return defaultValue;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`Invalid ${label} JSON.`);
  }
}

/**
 * @param {unknown} value - Required public idempotency identity.
 * @returns {string} - Stable request identity.
 */
function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('--idempotency-key must be a nonempty string.');
  }
  return value;
}

/**
 * Create the shared source or packaged workflow-start command. The loader is
 * the only host-specific seam; all mutation and response validation is shared.
 * @param {{loadExecution: (options: Record<string, any>) => Promise<DurableWorkflowStartExecutionHandle> | DurableWorkflowStartExecutionHandle, includeDirOption?: boolean, output?: Partial<DurableWorkflowStartCommandOutput>, startWorkflow?: DurableWorkflowStarter, processRef?: DurableWorkflowStartProcess}} options - Host behavior.
 * @returns {Command} - Fresh workflow-start command.
 */
export function createDurableWorkflowStartCommand(options) {
  if (!options || typeof options.loadExecution !== 'function') {
    throw new TypeError(
      'createDurableWorkflowStartCommand requires loadExecution.',
    );
  }
  const includeDirOption = options.includeDirOption === true;
  const output = resolveOutput(options.output);
  const startWorkflow =
    options.startWorkflow || startLocalDurableManifestWorkflow;
  const processRef = options.processRef || process;
  const command = new Command('start').description(
    'Persist one durable app workflow for local resident execution',
  );
  if (includeDirOption) {
    const defaultDir =
      typeof processRef.cwd === 'function' ? processRef.cwd() : process.cwd();
    command.option(
      '--dir <dir>',
      'Directory containing wharfie.app.js',
      defaultDir,
    );
  }
  command
    .requiredOption(
      '--workflow <workflowName>',
      includeDirOption
        ? 'Workflow name declared in wharfie.app.js'
        : 'Workflow name declared by the packaged application',
    )
    .requiredOption(
      '--idempotency-key <idempotencyKey>',
      'Stable start identity; reuse it after a lost response',
    )
    .option('--input <json>', 'Workflow input JSON (default: {})')
    .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
    .option('--json', 'Write one stable redacted workflow-start receipt')
    .action(async (commandOptions) => {
      /** @type {DurableWorkflowStartExecutionHandle | undefined} */
      let loaded;
      /** @type {unknown} */
      let actionError;
      try {
        if (typeof startWorkflow !== 'function') {
          throw new TypeError(
            'The durable workflow start service is unavailable.',
          );
        }
        const workflowId = commandOptions.workflow;
        const idempotencyKey = requireIdempotencyKey(
          commandOptions.idempotencyKey,
        );
        const input = parseJsonInput(commandOptions.input, 'input', {});
        const callerMetadata = parseJsonInput(
          commandOptions.callerMetadata,
          'caller metadata',
          {},
        );
        if (
          !callerMetadata ||
          typeof callerMetadata !== 'object' ||
          Array.isArray(callerMetadata)
        ) {
          throw new Error('Caller metadata JSON must be an object.');
        }
        loaded = await options.loadExecution(commandOptions);
        if (
          !loaded ||
          typeof loaded !== 'object' ||
          Array.isArray(loaded) ||
          !loaded.execution
        ) {
          throw new TypeError(
            'Workflow start execution loader must return { execution, cleanup? }.',
          );
        }
        if (
          loaded.cleanup !== undefined &&
          typeof loaded.cleanup !== 'function'
        ) {
          throw new TypeError(
            'Workflow start execution cleanup must be a function when provided.',
          );
        }
        const identity = resolveManifestActivityExecutionIdentity(
          loaded.execution,
        );
        const workflow = resolveManifestWorkflowStartBinding({
          identity,
          workflowId,
        });
        const runId = createWorkflowRunId({
          appId: identity.appId,
          idempotencyKey,
        });
        const result = await startWorkflow({
          execution: loaded.execution,
          workflowId,
          idempotencyKey,
          input,
          callerMetadata,
          actor: {
            kind: 'workflow-operator',
            id: identity.revisionId,
          },
        });
        const receipt = createDurableWorkflowStartReceipt(result, {
          runId,
          appId: identity.appId,
          revisionId: identity.revisionId,
          workflowId,
          idempotencyKey,
          planId: workflow.planId,
          definition: workflow.planPayload.definition,
        });
        if (commandOptions.json === true) output.json(receipt);
        else {
          output.table([formatDurableWorkflowStartHumanRow(receipt)]);
          output.success(`Accepted durable workflow run ${runId}.`);
        }
      } catch (error) {
        actionError = error;
      } finally {
        if (typeof loaded?.cleanup === 'function') {
          try {
            await loaded.cleanup();
          } catch (cleanupError) {
            actionError = actionError
              ? new AggregateError(
                  [actionError, cleanupError],
                  'Durable workflow start and cleanup both failed.',
                )
              : cleanupError;
          }
        }
      }
      if (actionError) {
        output.failure(actionError);
        processRef.exitCode = 1;
      }
    });

  return command;
}

export default createDurableWorkflowStartCommand;
