import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import paths from '../paths.js';

/**
 * Centralized DB configuration for Wharfie core runtime.
 *
 * This module is intentionally the only place in `src/core/lib` that reads
 * Wharfie DB-related environment variables (adapter selection, local paths,
 * durable roots, and fixed runtime table names).
 */

/**
 * @typedef {'dynamodb' | 'lmdb' | 'vanilla'} DBAdapterName
 */

/**
 * @param {unknown} value - value.
 * @param {string} label - label.
 * @returns {DBAdapterName} - Result.
 */
function normalizeAdapterName(value, label) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  if (
    normalized === 'dynamodb' ||
    normalized === 'lmdb' ||
    normalized === 'vanilla'
  ) {
    return normalized;
  }
  throw new Error(`Unsupported ${label}: ${value}`);
}

/**
 * Resolve the *general* DB adapter (used by AWS dynamo helper modules).
 *
 * Semantics are preserved from the previous `aws/dynamo/_shared.js`:
 * - WHARFIE_DB_ADAPTER overrides everything
 * - In Jest (NODE_ENV=test), prefer local adapters (vanilla)
 * - Otherwise, auto-detect DynamoDB when AWS_REGION/AWS_EXECUTION_ENV are present
 * @returns {DBAdapterName} - Result.
 */
export function resolveDBAdapterName() {
  const explicit = process.env.WHARFIE_DB_ADAPTER;
  if (explicit) return normalizeAdapterName(explicit, 'WHARFIE_DB_ADAPTER');

  // Jest sets NODE_ENV=test automatically; prefer local adapters to avoid AWS usage.
  if (process.env.NODE_ENV === 'test') return 'vanilla';

  if (process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV)
    return 'dynamodb';

  return 'vanilla';
}

/**
 * Resolve the *state store* adapter (actor runtime state).
 *
 * Important: this intentionally does NOT infer cloud adapters from AWS env vars.
 * If you want DynamoDB/LMDB you must opt-in explicitly.
 * @returns {DBAdapterName} - Result.
 */
export function resolveStateAdapterName() {
  const explicit =
    process.env.WHARFIE_STATE_ADAPTER || process.env.WHARFIE_DB_ADAPTER;
  if (explicit) {
    return normalizeAdapterName(
      explicit,
      'WHARFIE_STATE_ADAPTER/WHARFIE_DB_ADAPTER',
    );
  }

  // Provider-neutral default: never infer cloud adapters from ambient environment variables.
  return 'vanilla';
}

/**
 * Resolve the durable control-store adapter independently from application and
 * actor-state resources.
 *
 * Tests default to isolated vanilla stores. Normal local execution defaults to
 * LMDB so acknowledged control-state transitions survive process termination.
 * `vanilla` remains an explicit test/diagnostic option, but it is not crash
 * durable because it flushes only when the client closes.
 * @returns {DBAdapterName} - Result.
 */
export function resolveControlAdapterName() {
  const explicit = process.env.WHARFIE_CONTROL_ADAPTER;
  if (explicit) {
    return normalizeAdapterName(explicit, 'WHARFIE_CONTROL_ADAPTER');
  }

  return process.env.NODE_ENV === 'test' ? 'vanilla' : 'lmdb';
}

/**
 * Resolve the application data-store adapter independently from execution
 * control state and the legacy actor-state store.
 *
 * Application state is a durable product surface, so normal local execution
 * defaults to LMDB. Tests receive isolated vanilla stores unless they opt in
 * to a production adapter explicitly. Ambient AWS variables and the general
 * DB adapter never redirect application data into a cloud account.
 * @returns {DBAdapterName} - Canonical adapter name.
 */
export function resolveApplicationStateAdapterName() {
  const explicit = process.env.WHARFIE_APPLICATION_STATE_ADAPTER;
  if (explicit) {
    return normalizeAdapterName(explicit, 'WHARFIE_APPLICATION_STATE_ADAPTER');
  }

  return process.env.NODE_ENV === 'test' ? 'vanilla' : 'lmdb';
}

/**
 * Resolve one local control-store root. Test defaults are unique but are not
 * created until a writable adapter opens them, so read-only missing lookups do
 * not leave filesystem state behind.
 * @returns {string} - Local control-store root.
 */
export function resolveControlStorePath() {
  const configured = process.env.WHARFIE_CONTROL_PATH;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  if (process.env.NODE_ENV === 'test') {
    return join(tmpdir(), `wharfie-control-${randomUUID()}`);
  }
  return join(paths.data, 'control');
}

/**
 * Resolve the dedicated application-state root. Merely resolving the path
 * never creates it, which lets read-only probes fail without materializing a
 * missing local store.
 * @returns {string} - Local application-state root.
 */
export function resolveApplicationStateStorePath() {
  const configured = process.env.WHARFIE_APPLICATION_STATE_PATH;
  if (typeof configured === 'string' && configured.trim()) {
    return configured.trim();
  }
  if (process.env.NODE_ENV === 'test') {
    return join(tmpdir(), `wharfie-application-state-${randomUUID()}`);
  }
  return join(paths.data, 'application-state');
}

/** The sole physical table owned by the v2 application-state contract. */
export const APPLICATION_STATE_TABLE_NAME = 'wharfie-application-state-v2';

/**
 * Resolve the fixed application-state table. It intentionally has no
 * environment override: destination routing belongs to Wharfie's finite
 * host-owned catalog, not component input or ambient process configuration.
 * @returns {'wharfie-application-state-v2'} - Fixed table name.
 */
export function resolveApplicationStateTableName() {
  return APPLICATION_STATE_TABLE_NAME;
}

/**
 * Resolve the append-only execution-ledger table name. DynamoDB needs its
 * distinct `run_id`/`sort_key` physical schema, while local adapters can
 * safely share the control-store path under this explicit table name.
 * @returns {string} - Result.
 */
export function resolveExecutionLedgerTableName() {
  const name = process.env.WHARFIE_EXECUTION_LEDGER_TABLE;
  if (name && String(name).trim()) return String(name).trim();
  return 'wharfie-execution-ledger-v10';
}

/**
 * Resolve the immutable local execution-payload root. The v10 ledger writes
 * content before it appends a reference to the control store, so the default
 * lives beside that local control store when one is configured.  A future
 * shared payload provider can keep the same reference contract without
 * changing the ledger records.
 * @param {string} [resolvedControlPath] - Already-resolved command-local control root.
 * @returns {string} - Local payload-store root.
 */
export function resolveExecutionPayloadPath(resolvedControlPath) {
  const configured = process.env.WHARFIE_EXECUTION_PAYLOAD_PATH;
  if (configured && String(configured).trim()) {
    return String(configured).trim();
  }

  const controlPath =
    resolvedControlPath ||
    (typeof process.env.WHARFIE_CONTROL_PATH === 'string' &&
    process.env.WHARFIE_CONTROL_PATH.trim()
      ? process.env.WHARFIE_CONTROL_PATH.trim()
      : undefined);
  if (controlPath) return join(controlPath, 'execution-payloads');

  if (process.env.NODE_ENV === 'test') {
    return join(mkTempDir('wharfie-execution-payload-'), 'payloads');
  }

  return join(paths.data, 'control', 'execution-payloads');
}

/**
 * Resolve a stable logical identity for the configured local payload store.
 * The full filesystem path is never placed in durable references; a
 * path-derived digest gives local stores distinct identities while preserving
 * a compact portable descriptor. Operators moving a store intact can pin an
 * explicit identity with WHARFIE_EXECUTION_PAYLOAD_STORE_ID.
 * @param {string} [payloadPath] - Resolved payload-store root.
 * @returns {string} - Canonical local store identity.
 */
export function resolveExecutionPayloadStoreId(
  payloadPath = resolveExecutionPayloadPath(),
) {
  const configured = process.env.WHARFIE_EXECUTION_PAYLOAD_STORE_ID;
  if (configured && String(configured).trim()) {
    return String(configured).trim();
  }
  const digest = createHash('sha256')
    .update(resolve(payloadPath), 'utf8')
    .digest('hex');
  // `payload-` plus 55 hex characters is the 63-character logical-ID limit.
  return `payload-${digest.slice(0, 55)}`;
}

/**
 * Resolve the logical local namespace used for process-held ledger-service
 * sessions.
 *
 * A session socket is not durable control state and is deliberately separate
 * from the ledger's immutable payload root. Keeping its default beside the
 * configured control path makes a locally restarted artifact use the same
 * ownership namespace without putting a filesystem path into durable records.
 * The session implementation hashes this value into a short ephemeral socket
 * location so long macOS control paths cannot exceed Unix-domain socket path
 * limits. The session itself is only a same-local-OS-principal exclusion
 * primitive; it is never a distributed coordinator lease.
 * @param {string} [resolvedControlPath] - Already-resolved command-local control root.
 * @returns {string} - Logical ledger-service session namespace.
 */
export function resolveLedgerServiceSessionPath(resolvedControlPath) {
  const configured = process.env.WHARFIE_LEDGER_SERVICE_SESSION_PATH;
  if (configured && String(configured).trim()) {
    return String(configured).trim();
  }

  const controlPath =
    resolvedControlPath ||
    (typeof process.env.WHARFIE_CONTROL_PATH === 'string' &&
    process.env.WHARFIE_CONTROL_PATH.trim()
      ? process.env.WHARFIE_CONTROL_PATH.trim()
      : undefined);
  if (controlPath) return join(controlPath, 'ledger-service-sessions');

  if (process.env.NODE_ENV === 'test') {
    return join(mkTempDir('wharfie-ledger-service-session-'), 'sessions');
  }

  return join(paths.data, 'control', 'ledger-service-sessions');
}

/**
 * @param {string} prefix - prefix.
 * @returns {string} - Result.
 */
function mkTempDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Create a new DB client based on the resolved general adapter.
 * @param {DBAdapterName} [adapterName] - adapterName.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createDBClient(adapterName = resolveDBAdapterName()) {
  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../db/adapters/dynamodb.js');
    return createDynamoDB({ region: process.env.AWS_REGION });
  }

  if (adapterName === 'lmdb') {
    const { default: createLMDB } = await import('../db/adapters/lmdb.js');
    return createLMDB({ path: process.env.WHARFIE_DB_PATH });
  }

  const { default: createVanillaDB } =
    await import('../db/adapters/vanilla.js');

  if (process.env.NODE_ENV === 'test') {
    // Isolate tests from developer machines by default.
    const dir = mkTempDir('wharfie-dynamo-');
    return createVanillaDB({ path: dir });
  }

  return createVanillaDB({ path: process.env.WHARFIE_DB_PATH });
}

/**
 * Create the dedicated durable control-store DB client.
 * @param {DBAdapterName} [adapterName] - Explicit adapter override.
 * @param {{readOnly?: boolean, path?: string}} [options] - Access mode and already-resolved local root.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createControlDBClient(
  adapterName = resolveControlAdapterName(),
  options = {},
) {
  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../db/adapters/dynamodb.js');
    return createDynamoDB({
      region: process.env.AWS_REGION,
      readOnly: options.readOnly === true,
    });
  }

  const controlPath = options.path || resolveControlStorePath();

  if (adapterName === 'lmdb') {
    const { default: createLMDB } = await import('../db/adapters/lmdb.js');
    return createLMDB({
      path: controlPath,
      readOnly: options.readOnly === true,
    });
  }

  // Explicit vanilla is useful for tests and diagnostics, but is not crash
  // durable: its disk snapshot is written only from close().
  const { default: createVanillaDB } =
    await import('../db/adapters/vanilla.js');
  return createVanillaDB({
    path: controlPath,
    readOnly: options.readOnly === true,
  });
}

/**
 * Create a client for the dedicated application data store.
 *
 * This uses the same provider-neutral DB contract as control state, but a
 * separate root and fixed table ensure application mutations can never share
 * the execution-ledger namespace accidentally. In a SEA, the LMDB adapter
 * resolves from Wharfie's single verified core-runtime dependency closure.
 * @param {DBAdapterName} [adapterName] - Explicit adapter override.
 * @param {{readOnly?: boolean, path?: string}} [options] - Access mode and already-resolved local root.
 * @returns {Promise<import('../db/base.js').DBClient>} - Dedicated client.
 */
export async function createApplicationStateDBClient(
  adapterName = resolveApplicationStateAdapterName(),
  options = {},
) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Application-state DB options must be an object.');
  }
  const allowedOptionKeys = new Set(['path', 'readOnly']);
  for (const key of Object.keys(options)) {
    if (!allowedOptionKeys.has(key)) {
      throw new TypeError(
        `Application-state DB option '${key}' is not supported.`,
      );
    }
  }
  if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') {
    throw new TypeError('Application-state DB readOnly must be a boolean.');
  }
  if (
    options.path !== undefined &&
    (typeof options.path !== 'string' || !options.path.trim())
  ) {
    throw new TypeError(
      'Application-state DB path must be a non-empty string.',
    );
  }

  const normalizedAdapter = normalizeAdapterName(
    adapterName,
    'application-state adapter',
  );
  const storePath =
    typeof options.path === 'string'
      ? options.path.trim()
      : resolveApplicationStateStorePath();
  const readOnly = options.readOnly === true;

  if (normalizedAdapter === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../db/adapters/dynamodb.js');
    return createDynamoDB({
      region: process.env.AWS_REGION,
      readOnly,
    });
  }

  if (normalizedAdapter === 'lmdb') {
    const { default: createLMDB } = await import('../db/adapters/lmdb.js');
    return createLMDB({ path: storePath, readOnly });
  }

  // Vanilla is an explicit test/diagnostic implementation. A read-only open
  // never writes its in-memory view or creates the resolved root on close.
  const { default: createVanillaDB } =
    await import('../db/adapters/vanilla.js');
  return createVanillaDB({ path: storePath, readOnly });
}

/**
 * Create a new DB client for the actor runtime state store.
 * @param {DBAdapterName} [adapterName] - adapterName.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createStateDBClient(
  adapterName = resolveStateAdapterName(),
) {
  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../db/adapters/dynamodb.js');
    return createDynamoDB({ region: process.env.AWS_REGION });
  }

  if (adapterName === 'lmdb') {
    const { default: createLMDB } = await import('../db/adapters/lmdb.js');
    return createLMDB({ path: process.env.WHARFIE_STATE_DB_PATH });
  }

  const { default: createVanillaDB } =
    await import('../db/adapters/vanilla.js');

  if (process.env.NODE_ENV === 'test') {
    // Isolate tests from developer machines by default.
    const dir = mkTempDir('wharfie-state-');
    return createVanillaDB({ path: dir });
  }

  return createVanillaDB({ path: process.env.WHARFIE_STATE_DB_PATH });
}

/** @type {import('../db/base.js').DBClient | undefined} */
let _db;
/** @type {Promise<import('../db/base.js').DBClient> | null} */
let _initPromise = null;

/**
 * Get the shared singleton DB client (general DB, not the actor state store).
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function getDB() {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _db = await createDBClient();
    return _db;
  })();

  return _initPromise;
}

/**
 * Reset cached singleton DB client (used by tests).
 */
export function resetDB() {
  _db = undefined;
  _initPromise = null;
}

/**
 * Close the cached singleton DB client (if any) and clear caches.
 * @returns {Promise<void>} - Result.
 */
export async function closeDB() {
  // Wait for any in-flight init so we can close reliably.
  if (_initPromise) {
    try {
      await _initPromise;
    } catch {
      // ignore init errors; still clear caches
    }
  }

  const db = _db;
  _db = undefined;
  _initPromise = null;

  if (db?.close) {
    await db.close();
  }
}

export default {
  APPLICATION_STATE_TABLE_NAME,
  resolveDBAdapterName,
  resolveStateAdapterName,
  resolveControlAdapterName,
  resolveApplicationStateAdapterName,
  resolveControlStorePath,
  resolveApplicationStateStorePath,
  resolveApplicationStateTableName,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveExecutionPayloadStoreId,
  resolveLedgerServiceSessionPath,
  createDBClient,
  createControlDBClient,
  createApplicationStateDBClient,
  createStateDBClient,
  getDB,
  resetDB,
  closeDB,
};
