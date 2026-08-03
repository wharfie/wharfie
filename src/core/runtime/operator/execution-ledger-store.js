import { createExecutionLedger } from '../../lib/db/tables/execution-ledger.js';
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
 * Hold the resident-service ownership fence while a local manual mutation
 * uses an LMDB-backed control volume. Other adapters retain the explicit
 * operator-confirmation contract until provider-backed coordinator ownership
 * exists; callers must not claim local exclusion for those adapters.
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
