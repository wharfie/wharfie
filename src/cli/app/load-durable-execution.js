import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { prepareApplicationRevision } from './compile-application-revision.js';
import { loadApp } from './load-app.js';
import {
  assertSourceRuntimeResolution,
  getManifestActivityNames,
  getManifestWorkflowNames,
} from '../../core/runtime/app-runs.js';

/**
 * Load and seal one source application for a durable source command. When an
 * activity or workflow option is present, fail before compilation unless the
 * exact name belongs to the manifest.
 * @param {{dir?: string, activity?: string, workflow?: string}} [options] - Source command options.
 * @returns {Promise<import('../../core/runtime/operator/durable-run-command.js').DurableRunExecutionHandle>} - Prepared immutable source execution.
 */
export async function loadPreparedDurableExecution(options = {}) {
  const appDir = options.dir || process.cwd();
  const loadedApp = await loadApp({ dir: appDir });
  if (typeof options.activity === 'string') {
    const availableActivities = getManifestActivityNames(loadedApp.manifest);
    if (!availableActivities.includes(options.activity)) {
      throw new Error(
        `Activity '${options.activity}' was not found in ${appDir}. Available activities: ${
          availableActivities.join(', ') || '(none)'
        }`,
      );
    }
  }
  if (typeof options.workflow === 'string') {
    const availableWorkflows = getManifestWorkflowNames(loadedApp.manifest);
    if (!availableWorkflows.includes(options.workflow)) {
      throw new Error(
        `Workflow '${options.workflow}' was not found in ${appDir}. Available workflows: ${
          availableWorkflows.join(', ') || '(none)'
        }`,
      );
    }
  }

  const prepared = await prepareApplicationRevision({
    appDir: loadedApp.appDir,
    manifest: loadedApp.manifest,
  });
  try {
    // Fail sealed-source drift before a durable command opens control state.
    // Physical source executors repeat this check around activity dispatch.
    await prepared.verifyRuntime();
    return {
      execution: { kind: 'prepared-source', prepared },
      cleanup: prepared.cleanup,
    };
  } catch (error) {
    try {
      await prepared.cleanup();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Preparing the source execution and cleanup both failed.',
      );
    }
    throw error;
  }
}

/**
 * Import the developer CLI module from the sealed prepared-source snapshot.
 * The runtime lock is checked around the import so the adapter and eventual
 * durable work are both bound to the same immutable revision.
 * @param {import('../../core/runtime/durable-activity-host.js').ManifestActivityExecution} execution - Prepared source execution.
 * @returns {Promise<Record<string, any>>} - Developer CLI module namespace.
 */
export async function loadPreparedDurableCliModule(execution) {
  if (
    !execution ||
    execution.kind !== 'prepared-source' ||
    !execution.prepared
  ) {
    throw new TypeError(
      'Source durable CLI mapping requires a prepared-source execution.',
    );
  }
  const prepared = execution.prepared;
  const cliEntrypoint = prepared.manifest?.cli?.entrypoint;
  if (
    !cliEntrypoint ||
    typeof cliEntrypoint.path !== 'string' ||
    !cliEntrypoint.path
  ) {
    throw new TypeError(
      'Source durable CLI mapping requires cli.entrypoint.path.',
    );
  }

  await prepared.verifyRuntime();
  const entrypointPath = path.resolve(prepared.appDir, cliEntrypoint.path);
  assertSourceRuntimeResolution(entrypointPath, 'Source CLI entrypoint');
  /** @type {Record<string, any> | undefined} */
  let moduleLike;
  let importFailed = false;
  /** @type {unknown} */
  let importError;
  try {
    moduleLike = await import(pathToFileURL(entrypointPath).href);
  } catch (error) {
    importFailed = true;
    importError = error;
  }
  try {
    await prepared.verifyRuntime();
  } catch (verificationError) {
    if (importFailed) {
      throw new AggregateError(
        [importError, verificationError],
        'The sealed CLI module import and runtime verification both failed.',
      );
    }
    throw verificationError;
  }
  if (importFailed) throw importError;
  return /** @type {Record<string, any>} */ (moduleLike);
}

export default loadPreparedDurableExecution;
