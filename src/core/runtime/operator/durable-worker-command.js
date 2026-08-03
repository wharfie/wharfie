import { Command } from 'commander';

import { resolveManifestActivityExecutionIdentity } from '../app-runs.js';
import { runLocalResidentActivityService } from '../services/resident-activity-worker.js';

/**
 * @typedef DurableWorkerCommandOutput
 * @property {(message: string) => void} info - Write resident startup text.
 * @property {(message: string) => void} success - Write graceful-stop text.
 * @property {(error: unknown) => void} failure - Write a safe failure.
 */

/**
 * @typedef DurableWorkerExecutionHandle
 * @property {import('../durable-activity-host.js').ManifestActivityExecution} execution - Prepared-source or embedded immutable execution descriptor.
 * @property {() => void | Promise<void>} [cleanup] - Release execution-scoped resources.
 */

/**
 * @typedef DurableWorkerProcess
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => unknown} once - Register a one-shot signal listener.
 * @property {(event: string | symbol, listener: (...args: any[]) => void) => unknown} removeListener - Remove a signal listener.
 * @property {() => string} [cwd] - Resolve the source CLI default directory.
 * @property {number | undefined} exitCode - Process exit status.
 */

/**
 * @typedef {(options: {execution: import('../durable-activity-host.js').ManifestActivityExecution, signal: AbortSignal}) => Promise<unknown> | unknown} ResidentActivityWorkerRunner
 */

/**
 * @param {Partial<DurableWorkerCommandOutput> | undefined} provided - Optional host output hooks.
 * @returns {DurableWorkerCommandOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  return {
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
 * Convert the first process-manager signal into a resident drain request. The
 * worker service, rather than this CLI adapter, owns the meaning of a drained
 * shutdown and resolves only after its active work and durable ownership are
 * closed.
 * @param {Pick<DurableWorkerProcess, 'once' | 'removeListener'>} processRef - Signal source.
 * @returns {{signal: AbortSignal, close: () => void}} - Drain request handle.
 */
function createWorkerShutdown(processRef) {
  const controller = new AbortController();

  /** Remove the listeners installed by this command. */
  function close() {
    processRef.removeListener('SIGINT', onSigint);
    processRef.removeListener('SIGTERM', onSigterm);
  }

  /** @param {'SIGINT'|'SIGTERM'} signal - Requested process shutdown. */
  function request(signal) {
    close();
    const reason = new Error(
      `The resident activity worker was asked to drain with ${signal}.`,
    );
    reason.name = 'ResidentWorkerShutdownRequested';
    Object.assign(reason, {
      code: 'resident-worker-shutdown-requested',
      details: { signal },
    });
    controller.abort(reason);
  }

  /** Request a graceful drain after SIGINT. */
  function onSigint() {
    request('SIGINT');
  }

  /** Request a graceful drain after SIGTERM. */
  function onSigterm() {
    request('SIGTERM');
  }

  processRef.once('SIGINT', onSigint);
  processRef.once('SIGTERM', onSigterm);
  return { signal: controller.signal, close };
}

/**
 * Create the shared source or packaged resident activity-worker command. The
 * injected/default worker boundary receives `{execution, signal}` and must
 * resolve only after an abort request has stopped new claims, drained active
 * work, and released its durable resident ownership.
 * @param {{loadExecution: (options: Record<string, any>) => Promise<DurableWorkerExecutionHandle> | DurableWorkerExecutionHandle, includeDirOption?: boolean, output?: Partial<DurableWorkerCommandOutput>, runWorker?: ResidentActivityWorkerRunner, processRef?: DurableWorkerProcess}} options - Host behavior.
 * @returns {Command} - Fresh worker command.
 */
export function createDurableWorkerCommand(options) {
  if (!options || typeof options.loadExecution !== 'function') {
    throw new TypeError('createDurableWorkerCommand requires loadExecution.');
  }
  const includeDirOption = options.includeDirOption === true;
  const output = resolveOutput(options.output);
  const runWorker = options.runWorker || runLocalResidentActivityService;
  const processRef = options.processRef || process;

  const command = new Command('worker').description(
    'Run the local resident durable activity worker until shutdown',
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
  command.action(async (commandOptions) => {
    /** @type {DurableWorkerExecutionHandle | undefined} */
    let loaded;
    /** @type {unknown} */
    let actionError;
    let drained = false;
    const shutdown = createWorkerShutdown(processRef);
    try {
      if (typeof runWorker !== 'function') {
        throw new TypeError(
          'The resident activity worker service is unavailable.',
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
          'Durable worker execution loader must return { execution, cleanup? }.',
        );
      }
      if (
        loaded.cleanup !== undefined &&
        typeof loaded.cleanup !== 'function'
      ) {
        throw new TypeError(
          'Durable worker execution cleanup must be a function when provided.',
        );
      }

      const identity = resolveManifestActivityExecutionIdentity(
        loaded.execution,
      );
      output.info(
        `Starting resident activity worker for app ${identity.appId}@${identity.revisionId}.`,
      );
      await runWorker({ execution: loaded.execution, signal: shutdown.signal });
      drained = true;
    } catch (error) {
      actionError = error;
    } finally {
      shutdown.close();
      if (typeof loaded?.cleanup === 'function') {
        try {
          await loaded.cleanup();
        } catch (cleanupError) {
          actionError = actionError
            ? new AggregateError(
                [actionError, cleanupError],
                'Resident activity worker and execution cleanup both failed.',
              )
            : cleanupError;
        }
      }
    }

    if (actionError) {
      output.failure(actionError);
      processRef.exitCode = 1;
    } else if (drained) {
      output.success('Resident activity worker drained and stopped.');
    }
  });

  return command;
}

export default createDurableWorkerCommand;
