import { Command } from 'commander';

import { resolveManifestActivityExecutionIdentity } from '../app-runs.js';
import { createManualLedgerRunId } from '../manual-ledger-run.js';
import { submitLocalDurableManifestActivity } from '../services/resident-activity-worker.js';

/**
 * @typedef DurableSubmitCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write one redacted JSON row.
 * @property {(rows: Record<string, any>[]) => void} table - Write redacted table rows.
 * @property {(message: string) => void} success - Write accepted-run text.
 * @property {(error: unknown) => void} failure - Write a safe failure.
 */

/**
 * @typedef DurableSubmitExecutionHandle
 * @property {import('../durable-activity-host.js').ManifestActivityExecution} execution - Prepared-source or embedded immutable execution descriptor.
 * @property {() => void | Promise<void>} [cleanup] - Release execution-scoped resources.
 */

/**
 * @typedef DurableSubmitProcess
 * @property {() => string} [cwd] - Resolve the source CLI default directory.
 * @property {number | undefined} exitCode - Process exit status.
 */

/**
 * @typedef {(options: {execution: import('../durable-activity-host.js').ManifestActivityExecution, activityName: string, idempotencyKey: string, input: any, callerMetadata: Record<string, any>, actor?: {kind: string, id: string}}) => Promise<Record<string, any>> | Record<string, any>} ResidentActivitySubmit
 */

/**
 * @param {Partial<DurableSubmitCommandOutput> | undefined} provided - Optional host output hooks.
 * @returns {DurableSubmitCommandOutput} - Complete output adapter.
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${label} JSON: ${message}`);
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
 * Normalize the resident submission result without exposing request payloads,
 * caller metadata, physical fences, or terminal evidence. The resident API's
 * accepted snapshot may be named `outcome` or `accepted`; both carry the same
 * run/invocation projection contract.
 * @param {unknown} value - Resident submission result.
 * @param {{runId: string, appId: string, revisionId: string, activityName: string, idempotencyKey: string}} expected - Immutable request identity.
 * @returns {Record<string, any>} - Compact accepted-run row.
 */
function formatAcceptedRow(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Resident activity submission returned no result.');
  }
  const result = /** @type {Record<string, any>} */ (value);
  if (
    typeof result.runStatus === 'string' &&
    typeof result.invocationStatus === 'string'
  ) {
    if (
      result.runId !== expected.runId ||
      (result.appId !== undefined && result.appId !== expected.appId) ||
      result.revisionId !== expected.revisionId ||
      (result.activityId !== undefined &&
        result.activityId !== expected.activityName) ||
      (result.activityName !== undefined &&
        result.activityName !== expected.activityName) ||
      (result.idempotencyKey !== undefined &&
        result.idempotencyKey !== expected.idempotencyKey)
    ) {
      throw new Error(
        'Resident activity submission returned an unexpected immutable run identity.',
      );
    }
    return {
      idempotency_key: expected.idempotencyKey,
      run_id: expected.runId,
      revision: expected.revisionId,
      activity: expected.activityName,
      status: result.runStatus,
      invocation_status: result.invocationStatus,
      attempt_generation: 0,
      attempt_status: '',
      reused: result.reused === true,
    };
  }
  const accepted = result.outcome || result.accepted;
  if (
    !accepted ||
    typeof accepted !== 'object' ||
    Array.isArray(accepted) ||
    !accepted.run ||
    !accepted.invocation
  ) {
    throw new TypeError(
      'Resident activity submission must return an accepted run and invocation.',
    );
  }
  if (
    accepted.run.runId !== expected.runId ||
    (accepted.run.appId !== undefined &&
      accepted.run.appId !== expected.appId) ||
    accepted.run.revisionId !== expected.revisionId ||
    accepted.invocation.activityId !== expected.activityName ||
    (result.runId !== undefined && result.runId !== expected.runId) ||
    (result.appId !== undefined && result.appId !== expected.appId) ||
    (result.revisionId !== undefined &&
      result.revisionId !== expected.revisionId) ||
    (result.activityName !== undefined &&
      result.activityName !== expected.activityName) ||
    (result.idempotencyKey !== undefined &&
      result.idempotencyKey !== expected.idempotencyKey)
  ) {
    throw new Error(
      'Resident activity submission returned an unexpected immutable run identity.',
    );
  }

  return {
    idempotency_key: expected.idempotencyKey,
    run_id: expected.runId,
    revision: expected.revisionId,
    activity: expected.activityName,
    status: accepted.run.status,
    invocation_status: accepted.invocation.status,
    attempt_generation: accepted.attempt?.generation ?? 0,
    attempt_status: accepted.attempt?.status || '',
    reused: result.reused === true,
  };
}

/**
 * Create the shared source or packaged resident-activity submission command.
 * The injected/default submit boundary is expected to return
 * `{appId, revisionId, activityName, idempotencyKey, runId, outcome}` where
 * `outcome` contains the accepted run and invocation projections. `accepted`
 * is tolerated as an equivalent projection property during integration.
 * @param {{loadExecution: (options: Record<string, any>) => Promise<DurableSubmitExecutionHandle> | DurableSubmitExecutionHandle, includeDirOption?: boolean, output?: Partial<DurableSubmitCommandOutput>, submit?: ResidentActivitySubmit, processRef?: DurableSubmitProcess}} options - Host behavior.
 * @returns {Command} - Fresh submit command.
 */
export function createDurableSubmitCommand(options) {
  if (!options || typeof options.loadExecution !== 'function') {
    throw new TypeError('createDurableSubmitCommand requires loadExecution.');
  }
  const includeDirOption = options.includeDirOption === true;
  const output = resolveOutput(options.output);
  const submit = options.submit || submitLocalDurableManifestActivity;
  const processRef = options.processRef || process;

  const command = new Command('submit').description(
    'Persist one durable app activity for local resident execution',
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
      '--activity <activityName>',
      includeDirOption
        ? 'Activity name declared in wharfie.app.js'
        : 'Activity name declared by the packaged application',
    )
    .requiredOption(
      '--idempotency-key <idempotencyKey>',
      'Stable submission identity; reuse it after a lost response',
    )
    .option('--input <json>', 'Activity input JSON (default: {})')
    .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
    .option('--json', 'Write one redacted machine-readable accepted-run row')
    .action(async (commandOptions) => {
      /** @type {DurableSubmitExecutionHandle | undefined} */
      let loaded;
      /** @type {unknown} */
      let actionError;
      try {
        if (typeof submit !== 'function') {
          throw new TypeError(
            'The resident activity submission service is unavailable.',
          );
        }
        const activityName = commandOptions.activity;
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
            'Durable submit execution loader must return { execution, cleanup? }.',
          );
        }
        if (
          loaded.cleanup !== undefined &&
          typeof loaded.cleanup !== 'function'
        ) {
          throw new TypeError(
            'Durable submit execution cleanup must be a function when provided.',
          );
        }

        const identity = resolveManifestActivityExecutionIdentity(
          loaded.execution,
        );
        const runId = createManualLedgerRunId({
          appId: identity.appId,
          idempotencyKey,
        });
        const result = await submit({
          execution: loaded.execution,
          activityName,
          idempotencyKey,
          input,
          callerMetadata,
          ...(loaded.execution.kind === 'embedded'
            ? {
                actor: {
                  kind: 'packaged-operator',
                  id: identity.revisionId,
                },
              }
            : {}),
        });
        const row = formatAcceptedRow(result, {
          runId,
          appId: identity.appId,
          revisionId: identity.revisionId,
          activityName,
          idempotencyKey,
        });
        if (commandOptions.json === true) output.json(row);
        else {
          output.table([row]);
          output.success(`Accepted durable activity run ${runId}.`);
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
                  'Durable activity submission and cleanup both failed.',
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

export default createDurableSubmitCommand;
