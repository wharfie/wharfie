import { createExecutionLedger } from '../../lib/db/tables/execution-ledger.js';
import {
  CoordinatorAuthorityStaleError,
  createCoordinatorAuthority,
} from '../../lib/db/tables/coordinator-authority.js';
import { createLedgerServiceOwnership } from '../../lib/db/tables/ledger-service-lifecycle.js';
import { createLocalExecutionPayloadStore } from '../../lib/payload-store/local.js';
import {
  createControlDBClient,
  resolveControlAdapterName,
  resolveControlStorePath,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveExecutionPayloadStoreId,
  resolveLedgerServiceSessionPath,
} from '../../lib/config/db.js';
import { APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS } from '../effects/application-state.js';
import { acquireLocalLedgerServiceSession } from '../services/ledger-service.js';

/**
 * @typedef {import('../../lib/db/tables/execution-ledger.js').ExecutionLedgerStore} ExecutionLedgerStore
 */

/**
 * Resolve every ambient storage input once so one command cannot drift between
 * adapters, payload roots, or ownership namespaces while it is running.
 * @returns {Readonly<{adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, payloadPath: string, payloadStoreId: string, sessionPath: string}>} - One immutable command-local store configuration.
 */
export function resolveExecutionLedgerStoreConfiguration() {
  const adapterName = resolveControlAdapterName();
  const controlPath = resolveControlStorePath();
  const tableName = resolveExecutionLedgerTableName();
  const payloadPath = resolveExecutionPayloadPath(controlPath);
  return Object.freeze({
    adapterName,
    controlPath,
    tableName,
    payloadPath,
    payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
    sessionPath: resolveLedgerServiceSessionPath(controlPath),
  });
}

/**
 * Open the durable control store for one operation and always close it.
 * Read-only mode is used by inspection and recovery preflight so exact missing
 * lookups cannot materialize a local control store.
 * @template T
 * @param {(ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, sessionPath: string, readOnly: boolean}) => Promise<T>} handler - Work to run against the ledger.
 * @param {{readOnly?: boolean, configuration?: ReturnType<typeof resolveExecutionLedgerStoreConfiguration>}} [options] - Store access options.
 * @returns {Promise<T>} - Handler result.
 */
export async function withExecutionLedger(handler, options = {}) {
  const configuration =
    options.configuration || resolveExecutionLedgerStoreConfiguration();
  const readOnly = options.readOnly === true;
  /** @type {import('../../lib/db/base.js').DBClient | undefined} */
  let db;
  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let handlerError;
  let handlerFailed = false;

  try {
    db = await createControlDBClient(configuration.adapterName, {
      path: configuration.controlPath,
      readOnly,
    });
    const payloadStore = createLocalExecutionPayloadStore({
      path: configuration.payloadPath,
      storeId: configuration.payloadStoreId,
    });
    const ledger = createExecutionLedger({
      db,
      tableName: configuration.tableName,
      payloadStore: readOnly
        ? {
            ...payloadStore,
            putJson: async () => {
              throw new Error(
                'A read-only execution payload store cannot publish payloads.',
              );
            },
          }
        : payloadStore,
      effectEvidenceVerifiers: [...APPLICATION_STATE_EFFECT_EVIDENCE_VERIFIERS],
    });
    result = await handler(ledger, {
      db,
      adapterName: configuration.adapterName,
      controlPath: configuration.controlPath,
      tableName: configuration.tableName,
      sessionPath: configuration.sessionPath,
      readOnly,
    });
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }

  /** @type {unknown} */
  let closeError;
  let closeFailed = false;
  try {
    await db?.close?.();
  } catch (error) {
    closeFailed = true;
    closeError = error;
  }
  if (handlerFailed && closeFailed) {
    throw new AggregateError(
      [handlerError, closeError],
      'Execution-ledger operation and control-store close both failed.',
    );
  }
  if (handlerFailed) throw handlerError;
  if (closeFailed) throw closeError;
  return /** @type {T} */ (result);
}

/**
 * Hold one explicit app-scoped coordinator authority while a caller uses an
 * authority-bound view of an already-open execution ledger. A stale release
 * after deliberate takeover is successful relinquishment from this process's
 * perspective; every earlier or concurrent mutation was still fenced in the
 * same durable transaction.
 * @template T
 * @param {{appId: string, coordinatorId: string, ledger: ExecutionLedgerStore, context: {db: import('../../lib/db/base.js').DBClient, tableName: string, readOnly: boolean}, handler: (ledger: ExecutionLedgerStore, authority: import('../../lib/db/tables/coordinator-authority.js').CoordinatorAuthoritySnapshot) => Promise<T>}} options - Authority-scoped operation.
 * @returns {Promise<T>} - Handler result after graceful authority release.
 */
export async function withExecutionLedgerCoordinatorAuthority(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'withExecutionLedgerCoordinatorAuthority requires options.',
    );
  }
  if (options.context?.readOnly) {
    throw new Error(
      'A read-only execution ledger cannot acquire coordinator authority.',
    );
  }
  if (typeof options.ledger?.bindCoordinatorAuthority !== 'function') {
    throw new TypeError(
      'withExecutionLedgerCoordinatorAuthority requires a bindable execution ledger.',
    );
  }
  if (typeof options.handler !== 'function') {
    throw new TypeError(
      'withExecutionLedgerCoordinatorAuthority.handler must be a function.',
    );
  }

  const authorityStore = createCoordinatorAuthority({
    db: options.context.db,
    tableName: options.context.tableName,
  });
  const acquisition = await authorityStore.acquire({
    appId: options.appId,
    coordinatorId: options.coordinatorId,
    requestId: `coordinator-authority:acquire:${options.coordinatorId}`,
  });
  const authority = acquisition.authority;

  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let handlerError;
  let handlerFailed = false;
  try {
    const boundLedger = options.ledger.bindCoordinatorAuthority(authority);
    result = await options.handler(boundLedger, authority);
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }

  /** @type {unknown} */
  let releaseError;
  try {
    await authorityStore.release({
      authority,
      requestId: `coordinator-authority:release:${options.coordinatorId}`,
    });
  } catch (error) {
    if (!(error instanceof CoordinatorAuthorityStaleError)) {
      releaseError = error;
    }
  }
  if (handlerFailed && releaseError !== undefined) {
    throw new AggregateError(
      [handlerError, releaseError],
      'Coordinator-authoritative execution-ledger operation and authority release both failed.',
    );
  }
  if (handlerFailed) throw handlerError;
  if (releaseError !== undefined) throw releaseError;
  return /** @type {T} */ (result);
}

/**
 * Hold the resident-service ownership fence while a local manual mutation
 * uses an LMDB-backed control volume. Other adapters have no local exclusion
 * here: callers must separately bind coordinator authority for transactional
 * fencing and retain any required operator confirmations. That authority is
 * not a provider lease or proof that physical work has stopped.
 * @template T
 * @param {{appId: string, context: {db: import('../../lib/db/base.js').DBClient, adapterName: import('../../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string, sessionPath: string, readOnly: boolean}, handler: (localOwner?: Record<string, any>) => Promise<T>}} options - Ownership-scoped mutation.
 * @returns {Promise<T>} - Handler result.
 */
export async function withLocalLedgerServiceMutationOwnership(options) {
  if (options.context.readOnly) {
    throw new Error(
      'A read-only execution ledger cannot acquire mutation ownership.',
    );
  }
  if (options.context.adapterName !== 'lmdb') {
    return await options.handler();
  }

  const ownership = createLedgerServiceOwnership({
    db: options.context.db,
    tableName: options.context.tableName,
  });
  const localSession = await acquireLocalLedgerServiceSession({
    appId: options.appId,
    ownership,
    sessionRoot: options.context.sessionPath,
  });

  /** @type {T | undefined} */
  let result;
  /** @type {unknown} */
  let handlerError;
  let handlerFailed = false;
  try {
    // The held owner session is deliberately passed only to the mutation that
    // acquired it. This lets a foreground runner host authenticated local
    // commands on a distinct endpoint without teaching unrelated operators
    // how to acquire or mutate another owner's control volume.
    result = await options.handler(localSession);
  } catch (error) {
    handlerFailed = true;
    handlerError = error;
  }

  /** @type {unknown} */
  let releaseError;
  let releaseFailed = false;
  try {
    await localSession.release();
  } catch (error) {
    releaseFailed = true;
    releaseError = error;
  }
  if (handlerFailed && releaseFailed) {
    throw new AggregateError(
      [handlerError, releaseError],
      'Local ledger-service mutation and ownership release both failed.',
    );
  }
  if (handlerFailed) throw handlerError;
  if (releaseFailed) throw releaseError;
  return /** @type {T} */ (result);
}

export default withExecutionLedger;
