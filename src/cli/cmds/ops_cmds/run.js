import { prepareApplicationRevision } from '../../app/compile-application-revision.js';
import { loadApp } from '../../app/load-app.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';
import { getManifestActivityNames } from '../../../core/runtime/app-runs.js';
import {
  createDurableRunCommand,
  createForegroundCancellation,
} from '../../../core/runtime/operator/durable-run-command.js';

export { createForegroundCancellation };

const runCommand = createDurableRunCommand({
  includeDirOption: true,
  output: {
    info: displayInfo,
    success: displaySuccess,
    failure: displayFailure,
  },
  loadExecution: async (options) => {
    const appDir = options.dir || process.cwd();
    const loadedApp = await loadApp({ dir: appDir });
    const availableActivities = getManifestActivityNames(loadedApp.manifest);
    if (!availableActivities.includes(options.activity)) {
      throw new Error(
        `Activity '${options.activity}' was not found in ${appDir}. Available activities: ${
          availableActivities.join(', ') || '(none)'
        }`,
      );
    }

    const prepared = await prepareApplicationRevision({
      appDir: loadedApp.appDir,
      manifest: loadedApp.manifest,
    });
    try {
      // Fail sealed-source drift before the shared host opens durable state.
      // The physical source executor repeats this check around dispatch.
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
  },
});

export default runCommand;
