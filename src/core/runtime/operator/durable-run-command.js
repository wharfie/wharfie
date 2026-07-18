import { randomUUID } from 'node:crypto';

import { Command } from 'commander';

import { resolveManifestActivityExecutionIdentity } from '../app-runs.js';
import { runLocalDurableManifestActivity } from '../durable-activity-host.js';
import { createManualLedgerRunId } from '../manual-ledger-run.js';

/**
 * @typedef DurableRunCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write one redacted JSON row.
 * @property {(rows: Record<string, any>[]) => void} table - Write redacted table rows.
 * @property {(message: string) => void} info - Write pre-dispatch identity text.
 * @property {(message: string) => void} success - Write terminal success text.
 * @property {(error: unknown) => void} failure - Write terminal failure text.
 */

/**
 * @typedef DurableRunExecutionHandle
 * @property {import('../durable-activity-host.js').ManifestActivityExecution} execution - Prepared-source or embedded immutable execution descriptor.
 * @property {() => void | Promise<void>} [cleanup] - Release execution-scoped resources.
 */

/**
 * @typedef DurableRunProcess
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => unknown} once - Register a one-shot signal listener.
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => unknown} removeListener - Remove a signal listener.
 * @property {() => string} [cwd] - Resolve the source CLI default directory.
 * @property {number | undefined} exitCode - Process exit status.
 */

/**
 * @param {Partial<DurableRunCommandOutput> | undefined} provided - Optional host output hooks.
 * @returns {DurableRunCommandOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  return {
    json:
      provided?.json ||
      ((value) => {
        console.log(JSON.stringify(value));
      }),
    table: provided?.table || ((rows) => console.table(rows)),
    info: provided?.info || ((message) => console.log(message)),
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} JSON: ${message}`);
  }
}

/**
 * @param {unknown} value - User-supplied idempotency key.
 * @returns {string} - Stable manual idempotency key.
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
 * @param {Record<string, any>} result - Ledger-run result.
 * @param {string} idempotencyKey - User-visible idempotency identity.
 * @returns {Record<string, any>} - Compact redacted operator row.
 */
function formatRunRow(result, idempotencyKey) {
  return {
    idempotency_key: idempotencyKey,
    run_id: result.run.runId,
    revision: result.run.revisionId,
    activity: result.invocation.activityId,
    status: result.run.status,
    invocation_status: result.invocation.status,
    attempt_generation: result.attempt?.generation ?? 0,
    attempt_status: result.attempt?.status || '',
  };
}

/**
 * @param {Record<string, any>} result - Ledger-run result.
 * @param {string} appId - Application identity.
 * @param {string} runId - Durable run identity.
 * @param {string} operatorPrefix - Public command prefix for this host.
 * @returns {Error} - Human-readable non-completed outcome.
 */
function outcomeError(result, appId, runId, operatorPrefix) {
  if (result.disposition === 'failed') {
    return new Error(
      `Run ${runId} for app ${appId} finished ${result.run.status}. Terminal details are retained as immutable evidence and are not exposed by this command.`,
    );
  }
  if (result.disposition === 'blocked') {
    return new Error(
      `Run ${runId} for app ${appId} is BLOCKED because attempt ${result.attempt?.attemptId || '(unknown)'} crossed STARTED without a durably confirmed terminal. Reconcile the outcome before any retry.`,
    );
  }
  return new Error(
    `Run ${runId} for app ${appId} is already in progress (attempt ${result.attempt?.attemptId || '(unknown)'}). Inspect it with \`${operatorPrefix} inspect --run-id ${runId}\`; after confirming every runner stopped, use \`${operatorPrefix} recover --run-id ${runId} --confirm-runner-stopped\`.`,
  );
}

/**
 * Convert the first foreground process-manager signal into a host cancellation
 * request. The runner persists that request before forwarding the signal to
 * the physical attempt; removing the one-shot listener restores ordinary
 * process behavior for any later signal.
 * @param {Pick<DurableRunProcess, 'once' | 'removeListener'>} [processRef] - Injectable process signal source.
 * @returns {{signal: AbortSignal, close: () => void}} - Host cancellation handle.
 */
export function createForegroundCancellation(processRef = process) {
  const controller = new AbortController();

  /** Remove only the foreground cancellation listeners installed here. */
  function close() {
    processRef.removeListener('SIGINT', onSigint);
    processRef.removeListener('SIGTERM', onSigterm);
  }

  /** @param {'SIGINT'|'SIGTERM'} signal - Received shutdown signal. */
  function request(signal) {
    close();
    const reason = new Error(
      `The foreground operator requested cancellation with ${signal}.`,
    );
    reason.name = 'CancellationRequested';
    Object.assign(reason, {
      code: 'operator-cancel-requested',
      details: { signal },
    });
    controller.abort(reason);
  }

  /** Receive the cooperative interrupt signal. */
  function onSigint() {
    request('SIGINT');
  }

  /** Receive the cooperative termination signal. */
  function onSigterm() {
    request('SIGTERM');
  }

  processRef.once('SIGINT', onSigint);
  processRef.once('SIGTERM', onSigterm);
  return { signal: controller.signal, close };
}

/**
 * Create a fresh source or packaged durable activity leaf command. The loader
 * is the only host-specific seam: source prepares sealed files while a SEA
 * supplies its already-validated embedded manifest and revision/runtime pair.
 * @param {{loadExecution: (options: Record<string, any>) => Promise<DurableRunExecutionHandle> | DurableRunExecutionHandle, includeDirOption?: boolean, output?: Partial<DurableRunCommandOutput>, runActivity?: typeof runLocalDurableManifestActivity, processRef?: DurableRunProcess}} options - Host behavior.
 * @returns {Command} - Fresh durable run command.
 */
export function createDurableRunCommand(options) {
  if (!options || typeof options.loadExecution !== 'function') {
    throw new TypeError('createDurableRunCommand requires loadExecution.');
  }
  const includeDirOption = options.includeDirOption === true;
  const output = resolveOutput(options.output);
  const runActivity = options.runActivity || runLocalDurableManifestActivity;
  const processRef = options.processRef || process;
  const operatorPrefix = includeDirOption ? 'wharfie ops' : 'wharfie';

  const command = new Command('run').description(
    'Execute one durable app activity locally',
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
      '--activity <activityName>',
      includeDirOption
        ? 'Activity name declared in wharfie.app.js'
        : 'Activity name declared by the packaged application',
    )
    .option('--input <json>', 'Activity input JSON (default: {})')
    .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
    .option(
      '--idempotency-key <idempotencyKey>',
      'Stable manual idempotency key',
    )
    .option('--json', 'Write one redacted machine-readable durable run row')
    .action(async (commandOptions) => {
      /** @type {DurableRunExecutionHandle | undefined} */
      let loaded;
      /** @type {unknown} */
      let actionError;
      try {
        const activityName =
          typeof commandOptions.activity === 'string'
            ? commandOptions.activity
            : '';
        if (!activityName) {
          throw new Error(
            `${includeDirOption ? 'ops run' : 'run'} requires --activity <activityName>.`,
          );
        }
        const idempotencyKey = resolveIdempotencyKey(
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
            'Durable run execution loader must return { execution, cleanup? }.',
          );
        }
        if (
          loaded.cleanup !== undefined &&
          typeof loaded.cleanup !== 'function'
        ) {
          throw new TypeError(
            'Durable run execution cleanup must be a function when provided.',
          );
        }

        const identity = resolveManifestActivityExecutionIdentity(
          loaded.execution,
        );
        const runId = createManualLedgerRunId({
          appId: identity.appId,
          idempotencyKey,
        });
        if (commandOptions.json !== true) {
          output.info(
            `Running activity: app ${identity.appId}, run ${runId}@${identity.revisionId} (${activityName})`,
          );
        }

        const cancellation = createForegroundCancellation(processRef);
        /** @type {Record<string, any>} */
        let result;
        try {
          result = await runActivity({
            execution: loaded.execution,
            activityName,
            idempotencyKey,
            input,
            callerMetadata,
            signal: cancellation.signal,
            ...(loaded.execution.kind === 'embedded'
              ? {
                  actor: {
                    kind: 'packaged-operator',
                    id: identity.revisionId,
                  },
                }
              : {}),
          });
        } finally {
          cancellation.close();
        }

        const row = formatRunRow(result.outcome, result.idempotencyKey);
        if (commandOptions.json === true) output.json(row);
        else output.table([row]);
        if (result.outcome.disposition !== 'completed') {
          throw outcomeError(
            result.outcome,
            result.appId,
            result.runId,
            operatorPrefix,
          );
        }
        if (commandOptions.json !== true) {
          output.success(
            `Executed durable activity through attempt ${result.outcome.attempt?.generation || 0}.`,
          );
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
                  'Durable activity execution and cleanup both failed.',
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

export default createDurableRunCommand;
