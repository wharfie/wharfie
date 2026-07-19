import { Command } from 'commander';

import { readEmbeddedAppManifest } from '../../resources/builds/lib/app-manifest-asset.js';
import { readEmbeddedRevisionRuntimePair } from '../../resources/builds/lib/revision-runtime-assets.js';
import { runLocalResidentActivityService } from './resident-activity-worker.js';

/**
 * Wait for the ordinary process-manager signals that request a graceful
 * resident-service shutdown. The internal runtime owns these handlers rather
 * than exposing a public CLI signal contract.
 * @param {{processRef?: {on: Function, removeListener: Function}, signal?: AbortSignal}} [options] - Injected signal emitter and optional listener cleanup signal for tests.
 * @returns {Promise<'SIGINT'|'SIGTERM'|undefined>} - First requested graceful shutdown, or undefined when startup cleanup cancels the wait.
 */
export function waitForLedgerServiceShutdown(options = {}) {
  const processRef = options.processRef || process;
  return new Promise((resolve) => {
    /** @type {boolean} */
    let settled = false;
    const cleanup = () => {
      processRef.removeListener('SIGINT', onSigint);
      processRef.removeListener('SIGTERM', onSigterm);
      options.signal?.removeEventListener('abort', onAbort);
    };
    /** @param {'SIGINT'|'SIGTERM'} signal - Requested shutdown signal. */
    const onSignal = (signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(signal);
    };
    const onSigint = () => onSignal('SIGINT');
    const onSigterm = () => onSignal('SIGTERM');
    const onAbort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(undefined);
    };
    processRef.on('SIGINT', onSigint);
    processRef.on('SIGTERM', onSigterm);
    if (options.signal?.aborted) {
      onAbort();
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Run the hidden resident bootstrap from immutable assets embedded in the SEA.
 * The shared local resident service owns the control DB, lifecycle generation,
 * authenticated command endpoint, restart recovery, serial activity dispatch,
 * and graceful drain. This wrapper only translates process-manager signals
 * into that service's abort contract.
 * @param {{readEmbeddedAppManifest?: () => Promise<Record<string, any>>, readEmbeddedRevisionRuntimePair?: () => Promise<import('../../resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair>, runResidentActivityService?: typeof runLocalResidentActivityService, waitForShutdown?: (options?: {signal?: AbortSignal}) => Promise<unknown>}} [options] - Injected runtime dependencies for tests.
 * @returns {Promise<Readonly<{processed: number}>>} - Graceful resident drain summary.
 */
export async function runLedgerServiceRuntime(options = {}) {
  const readManifest =
    options.readEmbeddedAppManifest || readEmbeddedAppManifest;
  const readIdentity =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const runResident =
    options.runResidentActivityService || runLocalResidentActivityService;
  const waitForShutdown =
    options.waitForShutdown || waitForLedgerServiceShutdown;
  const waitAbort = new AbortController();
  const residentAbort = new AbortController();
  /** @type {Promise<{kind: 'shutdown', signal: unknown}>} */
  let shutdownOutcome;
  /** @type {Promise<{kind: 'resident', value: Readonly<{processed: number}>} | {kind: 'resident-error', error: unknown}> | undefined} */
  let residentOutcome;

  try {
    // Register signal handlers before any await in startup. In particular,
    // the durable READY transition must never become externally visible
    // before a SIGTERM can be captured and converted into a fenced STOPPED
    // transition.
    shutdownOutcome = Promise.resolve(
      waitForShutdown({ signal: waitAbort.signal }),
    ).then((signal) => ({ kind: 'shutdown', signal }));
    const [manifest, embeddedRevision] = await Promise.all([
      readManifest(),
      readIdentity(),
    ]);
    residentOutcome = Promise.resolve().then(async () => {
      try {
        return {
          kind: /** @type {'resident'} */ ('resident'),
          value: await runResident({
            execution: {
              kind: 'embedded',
              manifest,
              embeddedRevision,
            },
            signal: residentAbort.signal,
          }),
        };
      } catch (error) {
        return {
          kind: /** @type {'resident-error'} */ ('resident-error'),
          error,
        };
      }
    });

    const first = await Promise.race([shutdownOutcome, residentOutcome]);
    if (first.kind === 'resident-error') throw first.error;
    if (first.kind === 'resident') {
      throw new Error(
        'Resident activity service stopped without a shutdown request.',
      );
    }

    residentAbort.abort(
      Object.assign(
        new Error('The resident ledger service was asked to drain.'),
        {
          name: 'ResidentWorkerShutdownRequested',
          code: 'resident-worker-shutdown-requested',
          details: { signal: first.signal },
        },
      ),
    );
    const stopped = await residentOutcome;
    if (stopped.kind === 'resident-error') throw stopped.error;
    return stopped.value;
  } finally {
    waitAbort.abort();
    residentAbort.abort();
    if (residentOutcome) {
      await residentOutcome;
    }
  }
}

/**
 * This commander command is intentionally not added to the public embedded
 * operator CLI. Generated SEA bootstrap code maps it only when
 * `WHARFIE_RUNTIME_COMMAND=ledger-service` is set by trusted service wiring.
 */
const ledgerServiceCommand = new Command('ledger-service')
  .description('Internal resident execution-ledger lifecycle runtime')
  .action(async () => {
    await runLedgerServiceRuntime();
  });

export default ledgerServiceCommand;
