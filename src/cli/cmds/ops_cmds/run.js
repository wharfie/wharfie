import { randomUUID } from 'node:crypto';

import { Command } from 'commander';

import { prepareApplicationRevision } from '../../app/compile-application-revision.js';
import { loadApp } from '../../app/load-app.js';
import { parseJsonInput } from '../../app/local-app.js';
import {
  withExecutionLedger,
  withLocalLedgerServiceMutationOwnership,
} from '../../../core/runtime/operator/execution-ledger-store.js';
import { createLedgerServiceOwnership } from '../../../core/lib/db/tables/ledger-service-lifecycle.js';
import { EXECUTION_LEDGER_CANCEL_OWNER_COMMAND } from '../../../core/runtime/operator/execution-ledger-operator.js';
import { createLocalOwnerCommandServer } from '../../../core/runtime/operator/local-owner-command.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';
import {
  getManifestActivityNames,
  invokeManifestActivityAttemptWithStart,
} from '../../../core/runtime/app-runs.js';
import {
  createManualLedgerRunId,
  runManualLedgerActivity,
} from '../../../core/runtime/manual-ledger-run.js';

/**
 * @param {Readonly<Record<string, any>> | null} observed - Fresh durable owner record.
 * @param {Readonly<Record<string, any>>} held - Owner record held by this runner.
 * @returns {boolean} - Whether the durable record still names this exact owner generation.
 */
function isCurrentManualOwner(observed, held) {
  return Boolean(
    observed &&
    observed.serviceId === held.serviceId &&
    observed.appId === held.appId &&
    observed.scopeId === held.scopeId &&
    observed.principalId === held.principalId &&
    observed.sessionId === held.sessionId &&
    observed.ownerKind === held.ownerKind &&
    observed.generation === held.generation,
  );
}

/**
 * @param {unknown} value - Authenticated but still command-specific request payload.
 * @param {string} runId - Exact active durable run.
 * @returns {boolean} - Whether this command names only the runner's exact run.
 */
function isExactOwnerCancelRequest(value, runId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(request).length === 1 && request.runId === runId;
}

/**
 * @param {Record<string, any>} result - Active-port cancellation result.
 * @returns {{outcome: string, delivery: 'started'|'not-delivered'|'not-required', runStatus: string, invocationStatus: string}} - Redacted owner response.
 */
function formatOwnerCancellationResponse(result) {
  return {
    outcome: result.outcome,
    delivery:
      result.outcome === 'cancellation-requested'
        ? result.signalDelivered
          ? 'started'
          : 'not-delivered'
        : 'not-required',
    runStatus: result.run.status,
    invocationStatus: result.invocation.status,
  };
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
 * @returns {Record<string, any>} - Compact operator row.
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
 * @returns {Error} - Human-readable non-completed outcome.
 */
function outcomeError(result, appId, runId) {
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
    `Run ${runId} for app ${appId} is already in progress (attempt ${result.attempt?.attemptId || '(unknown)'}). Inspect it with \`wharfie ops inspect --run-id ${runId}\`; after confirming every runner stopped, use \`wharfie ops recover --run-id ${runId} --confirm-runner-stopped\`.`,
  );
}

/**
 * Convert the first foreground process-manager signal into a host cancellation
 * request. The runner persists that request before it forwards this signal to
 * the physical attempt; removing the one-shot listener restores the ordinary
 * process behavior for any later signal.
 * @param {{once: Function, removeListener: Function}} [processRef] - Injectable process signal source.
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
    // The first signal is a cooperative cancellation request. Restore the
    // process's ordinary handling before abort listeners run so any later
    // signal can force termination, including the other signal kind.
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

  function onSigint() {
    request('SIGINT');
  }

  function onSigterm() {
    request('SIGTERM');
  }

  processRef.once('SIGINT', onSigint);
  processRef.once('SIGTERM', onSigterm);
  return {
    signal: controller.signal,
    close,
  };
}

const runCommand = new Command('run')
  .description('Execute one durable app activity locally')
  .option('--dir <dir>', 'Directory containing wharfie.app.js', process.cwd())
  .option(
    '--activity <activityName>',
    'Activity name declared in wharfie.app.js',
  )
  .option('--input <json>', 'Activity input JSON (default: {})')
  .option('--caller-metadata <json>', 'Caller metadata JSON (default: {})')
  .option('--idempotency-key <idempotencyKey>', 'Stable manual idempotency key')
  .action(async (options) => {
    try {
      const appDir = options.dir || process.cwd();
      const loadedApp = await loadApp({ dir: appDir });
      const { manifest } = loadedApp;
      const appId = manifest.app.id;
      const idempotencyKey = resolveIdempotencyKey(options.idempotencyKey);
      const runId = createManualLedgerRunId({ appId, idempotencyKey });

      const activityName =
        typeof options.activity === 'string' ? options.activity : '';
      if (!activityName) {
        throw new Error('ops run requires --activity <activityName>.');
      }

      const input = parseJsonInput(options.input, 'input', {});
      const callerMetadata = parseJsonInput(
        options.callerMetadata,
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

      const availableActivities = getManifestActivityNames(manifest);
      if (!availableActivities.includes(activityName)) {
        throw new Error(
          `Activity '${activityName}' was not found in ${appDir}. Available activities: ${
            availableActivities.join(', ') || '(none)'
          }`,
        );
      }

      const preparedRevision = await prepareApplicationRevision({
        appDir: loadedApp.appDir,
        manifest,
      });
      try {
        // Fail sealed-source drift before creating a durable claim where
        // possible. The runtime repeats this check around the attempt because
        // the source can still change after this preflight.
        await preparedRevision.verifyRuntime();
        const revisionId = preparedRevision.revision.revisionId;
        displayInfo(
          `Running activity: app ${appId}, run ${runId}@${revisionId} (${activityName})`,
        );

        const cancellation = createForegroundCancellation();
        let result;
        try {
          result = await withExecutionLedger(
            async (ledger, context) =>
              await withLocalLedgerServiceMutationOwnership({
                appId,
                context,
                handler: async (localOwner) => {
                  /**
                   * The manual runner is still usable with adapters that do
                   * not implement local ownership. Only an LMDB-held owner
                   * exposes a companion command server; there is never a
                   * direct external mutation fallback.
                   */
                  if (!localOwner) {
                    return await runManualLedgerActivity({
                      ledger,
                      runId,
                      appId,
                      revisionId,
                      activityId: activityName,
                      input,
                      callerMetadata,
                      signal: cancellation.signal,
                      executeAttempt: async (startFrame, { signal }) =>
                        await invokeManifestActivityAttemptWithStart({
                          activityName,
                          startFrame,
                          signal,
                          execution: {
                            kind: 'prepared-source',
                            prepared: preparedRevision,
                          },
                        }),
                    });
                  }

                  const ownership = createLedgerServiceOwnership({
                    db: context.db,
                    tableName: context.tableName,
                  });
                  /** @type {{requestCancellation: (request: {requestId: string}) => Promise<Record<string, any>>} | undefined} */
                  let activeCancellationPort;
                  const commandServer = await createLocalOwnerCommandServer({
                    session: localOwner.commandSession,
                    isCurrentOwner: async () =>
                      isCurrentManualOwner(
                        await ownership.getOwnership({
                          serviceId: localOwner.ownership.serviceId,
                        }),
                        localOwner.ownership,
                      ),
                    handleCommand: async (command) => {
                      if (
                        command.command !==
                          EXECUTION_LEDGER_CANCEL_OWNER_COMMAND ||
                        !isExactOwnerCancelRequest(command.request, runId)
                      ) {
                        return {
                          outcome: 'request-unavailable',
                          delivery: 'not-delivered',
                        };
                      }
                      if (!activeCancellationPort) {
                        return {
                          outcome: 'owner-not-ready',
                          delivery: 'not-delivered',
                        };
                      }
                      return formatOwnerCancellationResponse(
                        await activeCancellationPort.requestCancellation({
                          requestId: command.requestId,
                        }),
                      );
                    },
                  });
                  try {
                    return await runManualLedgerActivity({
                      ledger,
                      runId,
                      appId,
                      revisionId,
                      activityId: activityName,
                      input,
                      callerMetadata,
                      signal: cancellation.signal,
                      ownerCancellation: {
                        actor: {
                          kind: 'local-owner-command',
                          id: appId,
                        },
                      },
                      registerActiveAttemptCancellationPort: (port) => {
                        activeCancellationPort = port;
                        return () => {
                          if (activeCancellationPort === port) {
                            activeCancellationPort = undefined;
                          }
                        };
                      },
                      executeAttempt: async (startFrame, { signal }) =>
                        await invokeManifestActivityAttemptWithStart({
                          activityName,
                          startFrame,
                          signal,
                          execution: {
                            kind: 'prepared-source',
                            prepared: preparedRevision,
                          },
                        }),
                    });
                  } finally {
                    // The command endpoint must disappear before the durable
                    // owner release can make a successor eligible. A request
                    // can therefore never reach an old server after its
                    // generation ceased to be current.
                    await commandServer.close();
                  }
                },
              }),
          );
        } finally {
          cancellation.close();
        }

        console.table([formatRunRow(result, idempotencyKey)]);
        if (result.disposition !== 'completed') {
          throw outcomeError(result, appId, runId);
        }
        displaySuccess(
          `Executed durable activity through attempt ${result.attempt?.generation || 0}.`,
        );
      } finally {
        await preparedRevision.cleanup();
      }
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default runCommand;
