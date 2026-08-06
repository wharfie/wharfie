import { randomUUID } from 'node:crypto';

import { Command } from 'commander';

import { resolveManifestActivityExecutionIdentity } from '../app-runs.js';
import { resolveManifestWorkflowStartBinding } from '../durable-workflow-host.js';
import {
  WORKFLOW_START_PAYLOAD_MAX_BYTES,
  createWorkflowRunId,
} from '../../lib/ledger/workflow-execution-contract.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
} from '../json-value.js';
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
 * @typedef {(execution: import('../durable-activity-host.js').ManifestActivityExecution) => Promise<Record<string, any> | null> | Record<string, any> | null} DurableWorkflowCliModuleLoader
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
 * @param {unknown} value - User-supplied idempotency identity.
 * @returns {string} - Stable or freshly generated request identity.
 */
function resolveIdempotencyKey(value) {
  if (value === undefined) return `manual-${randomUUID()}`;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      '--idempotency-key must be a nonempty string when provided.',
    );
  }
  return value;
}

/**
 * @typedef {(chunk: string | Uint8Array, encoding?: NodeJS.BufferEncoding | (() => void), callback?: (() => void)) => boolean} StreamWrite
 */

/**
 * Reserve stdout for the single operator receipt while trusted application
 * modules load and project CLI arguments. Their diagnostics remain visible on
 * stderr, but cannot corrupt a JSON receipt.
 * @template T
 * @param {() => Promise<T>} operation - Admission and start operation.
 * @returns {Promise<T>} - Operation result.
 */
export async function withOperatorStdoutReserved(operation) {
  const originalStdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  /** @type {StreamWrite} */
  const redirectedWrite = function redirectedWrite(chunk, encoding, callback) {
    const resolvedEncoding =
      typeof encoding === 'string' ? encoding : undefined;
    let resolvedCallback = typeof encoding === 'function' ? encoding : callback;
    if (typeof resolvedCallback !== 'function') resolvedCallback = undefined;
    return /** @type {StreamWrite} */ (stderrWrite).call(
      process.stderr,
      chunk,
      resolvedEncoding,
      resolvedCallback,
    );
  };

  process.stdout.write = /** @type {typeof process.stdout.write} */ (
    redirectedWrite
  );
  try {
    return await operation();
  } finally {
    process.stdout.write = originalStdoutWrite;
  }
}

/**
 * Resolve the application-owned durable CLI projection without giving it
 * operator options, ambient argv, or mutable argument storage.
 * @param {{moduleLike: Record<string, any> | null, exportName: string, appArgs: string[]}} options - Adapter invocation.
 * @returns {Promise<any>} - Bounded JSON workflow input.
 */
async function projectDurableCliInput(options) {
  const mapper = options.moduleLike?.[options.exportName];
  if (typeof mapper !== 'function') {
    throw new TypeError(
      `cli.durable.export '${options.exportName}' is not a callable export of cli.entrypoint.path.`,
    );
  }
  const projected = await mapper(Object.freeze([...options.appArgs]));
  return cloneBoundedJsonValue(
    projected,
    WORKFLOW_START_PAYLOAD_MAX_BYTES,
    'cli.durable adapter output',
  );
}

/**
 * Recheck a prepared source runtime after async application code returns.
 * Packaged executions are already bound to embedded runtime bytes.
 * @param {import('../durable-activity-host.js').ManifestActivityExecution} execution - Bound execution.
 * @returns {Promise<void>} - Resolves when the source runtime remains stable.
 */
async function verifyPreparedSourceRuntime(execution) {
  if (execution.kind === 'prepared-source') {
    await execution.prepared.verifyRuntime();
  }
}

/**
 * Project application arguments and retain both an adapter failure and a
 * concurrent prepared-runtime drift failure when they happen together.
 * @param {{execution: import('../durable-activity-host.js').ManifestActivityExecution, moduleLike: Record<string, any> | null, exportName: string, appArgs: string[]}} options - Adapter invocation.
 * @returns {Promise<any>} - Bounded JSON workflow input.
 */
export async function projectVerifiedDurableCliInput(options) {
  let projected;
  let projectionFailed = false;
  /** @type {unknown} */
  let projectionError;
  try {
    projected = await projectDurableCliInput(options);
  } catch (error) {
    projectionFailed = true;
    projectionError = error;
  }

  try {
    await verifyPreparedSourceRuntime(options.execution);
  } catch (verificationError) {
    if (projectionFailed) {
      throw new AggregateError(
        [projectionError, verificationError],
        'The durable CLI adapter and prepared runtime verification both failed.',
      );
    }
    throw verificationError;
  }
  if (projectionFailed) throw projectionError;
  return projected;
}

/**
 * Create the shared source or packaged workflow-start command. The loader is
 * the only host-specific seam; all mutation and response validation is shared.
 * @param {{loadExecution: (options: Record<string, any>) => Promise<DurableWorkflowStartExecutionHandle> | DurableWorkflowStartExecutionHandle, loadCliModule?: DurableWorkflowCliModuleLoader, includeDirOption?: boolean, output?: Partial<DurableWorkflowStartCommandOutput>, startWorkflow?: DurableWorkflowStarter, processRef?: DurableWorkflowStartProcess}} options - Host behavior.
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
  command.argument(
    '[appArgs...]',
    'Application arguments for the declared durable CLI adapter',
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
    .option(
      '--workflow <workflowName>',
      'Expert override: workflow name (cannot be combined with app arguments)',
    )
    .option(
      '--idempotency-key <idempotencyKey>',
      'Stable retry identity; omit to create a new request',
    )
    .option(
      '--input <json>',
      'Expert override: workflow input JSON (cannot be combined with app arguments)',
    )
    .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
    .option('--json', 'Write one stable redacted workflow-start receipt')
    .action(async (appArgs, commandOptions) => {
      /** @type {DurableWorkflowStartExecutionHandle | undefined} */
      let loaded;
      let actionFailed = false;
      /** @type {unknown} */
      let actionError;
      /** @type {Record<string, any> | undefined} */
      let receipt;
      /** @type {string | undefined} */
      let runId;
      try {
        const hasAppArgs = appArgs.length > 0;
        const hasWorkflowOverride = typeof commandOptions.workflow === 'string';
        const hasInputOverride = typeof commandOptions.input === 'string';
        if (hasAppArgs && (hasWorkflowOverride || hasInputOverride)) {
          throw new TypeError(
            'Application arguments cannot be combined with --workflow or --input.',
          );
        }
        const explicitInput = hasInputOverride
          ? cloneBoundedJsonValue(
              parseJsonInput(commandOptions.input, 'input', {}),
              WORKFLOW_START_PAYLOAD_MAX_BYTES,
              'Workflow start input',
            )
          : undefined;
        const idempotencyKey = resolveIdempotencyKey(
          commandOptions.idempotencyKey,
        );
        const parsedCallerMetadata = parseJsonInput(
          commandOptions.callerMetadata,
          'caller metadata',
          {},
        );
        if (
          !parsedCallerMetadata ||
          typeof parsedCallerMetadata !== 'object' ||
          Array.isArray(parsedCallerMetadata)
        ) {
          throw new Error('Caller metadata JSON must be an object.');
        }
        const callerMetadata = cloneBoundedJsonObject(
          parsedCallerMetadata,
          WORKFLOW_START_PAYLOAD_MAX_BYTES,
          'Workflow start caller metadata',
        );

        await withOperatorStdoutReserved(async () => {
          if (typeof startWorkflow !== 'function') {
            throw new TypeError(
              'The durable workflow start service is unavailable.',
            );
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
          const durableCli = identity.manifest.cli?.durable;

          let workflowId = commandOptions.workflow;
          let input;
          if (!hasWorkflowOverride && !hasInputOverride) {
            if (!durableCli) {
              throw new TypeError(
                'This application does not declare cli.durable; use --workflow with an optional --input JSON override.',
              );
            }
            if (typeof options.loadCliModule !== 'function') {
              throw new TypeError(
                'The durable CLI adapter module loader is unavailable.',
              );
            }
            workflowId = durableCli.workflow;
            input = await projectVerifiedDurableCliInput({
              execution: loaded.execution,
              moduleLike: await options.loadCliModule(loaded.execution),
              exportName: durableCli.export,
              appArgs,
            });
          } else {
            workflowId = workflowId || durableCli?.workflow;
            if (!workflowId) {
              throw new TypeError(
                '--workflow is required when the application does not declare cli.durable.',
              );
            }
            input = hasInputOverride ? explicitInput : {};
          }

          const workflow = resolveManifestWorkflowStartBinding({
            identity,
            workflowId,
          });
          runId = createWorkflowRunId({
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
          receipt = createDurableWorkflowStartReceipt(result, {
            runId,
            appId: identity.appId,
            revisionId: identity.revisionId,
            workflowId,
            idempotencyKey,
            planId: workflow.planId,
            definition: workflow.planPayload.definition,
          });
        });
      } catch (error) {
        actionFailed = true;
        actionError = error;
      } finally {
        const cleanup = loaded?.cleanup;
        if (typeof cleanup === 'function') {
          try {
            await withOperatorStdoutReserved(async () => {
              await cleanup();
            });
          } catch (cleanupError) {
            if (actionFailed) {
              actionError = new AggregateError(
                [actionError, cleanupError],
                'Durable workflow start and cleanup both failed.',
              );
            } else {
              actionFailed = true;
              actionError = cleanupError;
            }
          }
        }
      }
      if (receipt && runId) {
        if (commandOptions.json === true) output.json(receipt);
        else {
          output.table([formatDurableWorkflowStartHumanRow(receipt)]);
          output.success(`Accepted durable workflow run ${runId}.`);
        }
      } else if (!actionFailed) {
        output.failure(
          new Error('Durable workflow start completed without a receipt.'),
        );
        processRef.exitCode = 1;
        return;
      }
      if (actionFailed) {
        output.failure(actionError);
        processRef.exitCode = 1;
      }
    });

  return command;
}

export default createDurableWorkflowStartCommand;
