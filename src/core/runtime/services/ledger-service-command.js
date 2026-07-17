import { Command } from 'commander';

import {
  createOperationsDBClient,
  resolveExecutionLedgerTableName,
  resolveLedgerServiceSessionPath,
  resolveOperationsAdapterName,
} from '../../lib/config/db.js';
import {
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
} from '../../lib/db/tables/ledger-service-lifecycle.js';
import { readEmbeddedRevisionRuntimePair } from '../../resources/builds/lib/revision-runtime-assets.js';
import { createLedgerService } from './ledger-service.js';

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
 * Run the hidden resident ledger-service bootstrap. It binds service identity
 * to immutable metadata embedded in the SEA, opens the durable control store,
 * and owns only the empty lifecycle/session vertical. Scheduling and activity
 * execution intentionally remain unavailable here.
 * @param {{readEmbeddedRevisionRuntimePair?: () => Promise<{runtime: {appId: string, revisionId: string}}>, createOperationsDBClient?: () => Promise<any>, resolveOperationsAdapterName?: () => string, createLedgerServiceLifecycle?: (...args: any[]) => any, createLedgerServiceOwnership?: (...args: any[]) => any, createLedgerService?: (...args: any[]) => {start: () => Promise<any>, stop: () => Promise<any>}, waitForShutdown?: (options?: {signal?: AbortSignal}) => Promise<unknown>, tableName?: string, sessionRoot?: string}} [options] - Injected runtime dependencies for tests.
 * @returns {Promise<any>} - Final durable STOPPED lifecycle snapshot.
 */
export async function runLedgerServiceRuntime(options = {}) {
  const readIdentity =
    options.readEmbeddedRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const openControlStore =
    options.createOperationsDBClient || createOperationsDBClient;
  const resolveControlAdapter =
    options.resolveOperationsAdapterName || resolveOperationsAdapterName;
  const createLifecycle =
    options.createLedgerServiceLifecycle || createLedgerServiceLifecycle;
  const createOwnership =
    options.createLedgerServiceOwnership || createLedgerServiceOwnership;
  const createService = options.createLedgerService || createLedgerService;
  const waitForShutdown =
    options.waitForShutdown || waitForLedgerServiceShutdown;
  const tableName = options.tableName || resolveExecutionLedgerTableName();
  const sessionRoot =
    options.sessionRoot === undefined
      ? resolveLedgerServiceSessionPath()
      : options.sessionRoot;
  const shutdownAbort = new AbortController();
  /** @type {Promise<unknown> | undefined} */
  let shutdownRequested;

  /** @type {any} */
  let db;
  /** @type {{start: () => Promise<any>, stop: () => Promise<any>} | undefined} */
  let service;
  let started = false;
  let stopAttempted = false;

  /** @returns {Promise<any>} - Graceful service stop result. */
  const stopStartedService = async () => {
    if (!started || stopAttempted || !service) return undefined;
    stopAttempted = true;
    return await service.stop();
  };

  try {
    // Register signal handlers before any await in startup. In particular,
    // the durable READY transition must never become externally visible
    // before a SIGTERM can be captured and converted into a fenced STOPPED
    // transition.
    shutdownRequested = waitForShutdown({ signal: shutdownAbort.signal });
    const embedded = await readIdentity();
    if (
      !options.createOperationsDBClient &&
      resolveControlAdapter() !== 'lmdb'
    ) {
      throw new Error(
        'The resident ledger-service requires WHARFIE_CONTROL_ADAPTER=lmdb. Distributed and vanilla control stores are not supported by its local ownership protocol.',
      );
    }
    db = await openControlStore();
    const lifecycle = createLifecycle({ db, tableName });
    const ownership = createOwnership({ db, tableName });
    service = createService({
      appId: embedded.runtime.appId,
      revisionId: embedded.runtime.revisionId,
      lifecycle,
      ownership,
      sessionRoot,
    });
    await service.start();
    started = true;
    await shutdownRequested;
    return await stopStartedService();
  } finally {
    try {
      await stopStartedService();
    } finally {
      try {
        shutdownAbort.abort();
      } finally {
        await db?.close?.();
      }
    }
  }
}

/**
 * This commander command is intentionally not added to the public embedded
 * operator CLI. Generated SEA bootstrap code maps it only when
 * `WHARFIE_BOOTSTRAP_MODE=runtime` and
 * `WHARFIE_RUNTIME_COMMAND=ledger-service` are set by trusted service wiring.
 */
const ledgerServiceCommand = new Command('ledger-service')
  .description('Internal resident execution-ledger lifecycle runtime')
  .action(async () => {
    await runLedgerServiceRuntime();
  });

export default ledgerServiceCommand;
