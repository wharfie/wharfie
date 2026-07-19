import { prepareApplicationRevision } from './compile-application-revision.js';
import { loadApp } from './load-app.js';
import { getManifestActivityNames } from '../../core/runtime/app-runs.js';

/**
 * Load and seal one source application for a durable source command. When an
 * activity option is present, fail before compilation unless the exact named
 * activity belongs to the manifest.
 * @param {{dir?: string, activity?: string}} [options] - Source command options.
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

export default loadPreparedDurableExecution;
