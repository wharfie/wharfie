import { randomUUID } from 'node:crypto';

import { Command } from 'commander';

import { prepareApplicationRevision } from '../../app/compile-application-revision.js';
import { loadApp } from '../../app/load-app.js';
import { parseJsonInput } from '../../app/local-app.js';
import { withExecutionLedger } from '../execution-ledger-store.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';
import {
  getAppResourceId,
  getManifestActivityNames,
  invokeManifestActivityAttemptWithStart,
} from '../../../core/runtime/app-runs.js';
import {
  createManualLedgerRunId,
  runManualLedgerActivity,
} from '../../../core/runtime/manual-ledger-run.js';

/**
 * @param {unknown} value - User-supplied operation ID.
 * @returns {string} - Stable manual operation ID.
 */
function resolveOperationId(value) {
  if (value === undefined) return `manual-${randomUUID()}`;
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(
      '--operation-id must be a nonempty string when provided.',
    );
  }
  return value;
}

/**
 * @param {Record<string, any>} result - Ledger-run result.
 * @param {string} operationId - User-visible operation identity.
 * @returns {Record<string, any>} - Compact operator row.
 */
function formatRunRow(result, operationId) {
  return {
    operation_id: operationId,
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
 * @param {string} resourceId - User-visible app resource ID.
 * @param {string} operationId - User-visible operation identity.
 * @returns {Error} - Human-readable non-completed outcome.
 */
function outcomeError(result, resourceId, operationId) {
  const terminal = result.terminal;
  if (result.disposition === 'failed' && terminal?.error?.message) {
    return new Error(
      `Run ${resourceId}#${operationId} finished ${result.run.status}: ${terminal.error.message}`,
    );
  }
  if (result.disposition === 'blocked') {
    return new Error(
      `Run ${resourceId}#${operationId} is BLOCKED because attempt ${result.attempt?.attemptId || '(unknown)'} crossed STARTED without a durably confirmed terminal. Reconcile the outcome before any retry.`,
    );
  }
  return new Error(
    `Run ${resourceId}#${operationId} is already in progress (attempt ${result.attempt?.attemptId || '(unknown)'}). Inspect it with \`wharfie ops inspect --run-id ${result.run.runId}\`; after confirming every runner stopped, use \`wharfie ops recover --run-id ${result.run.runId} --confirm-runner-stopped\`.`,
  );
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
  .option('--operation-id <operationId>', 'Stable manual operation identity')
  .action(async (options) => {
    try {
      const appDir = options.dir || process.cwd();
      const loadedApp = await loadApp({ dir: appDir });
      const { manifest } = loadedApp;
      const appId = manifest.app.id;
      const resourceId = getAppResourceId(appId);
      const operationId = resolveOperationId(options.operationId);
      const runId = createManualLedgerRunId({ appId, operationId });

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
      if (Object.prototype.hasOwnProperty.call(callerMetadata, 'resources')) {
        throw new Error(
          'Caller metadata cannot supply resources; managed capabilities are not available yet.',
        );
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
          `Running activity: ${resourceId}#${operationId}@${revisionId} (${activityName})`,
        );

        const result = await withExecutionLedger(
          async (ledger) =>
            await runManualLedgerActivity({
              ledger,
              runId,
              appId,
              revisionId,
              activityId: activityName,
              input,
              callerMetadata,
              executeAttempt: async (startFrame) =>
                await invokeManifestActivityAttemptWithStart({
                  activityName,
                  startFrame,
                  execution: {
                    kind: 'prepared-source',
                    prepared: preparedRevision,
                  },
                }),
            }),
        );

        console.table([formatRunRow(result, operationId)]);
        if (result.disposition !== 'completed') {
          throw outcomeError(result, resourceId, operationId);
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
