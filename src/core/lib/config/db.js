import { createHash, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import paths from '../paths.js';
import { assertDomainSeparatedSha256Id } from '../../runtime/content-id.js';
import { getLocalAppStorageLayout } from './local-app-storage-context.js';

export const DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE = 'dynamodb-rvn-v1';
export const COORDINATOR_AUTHORITY_MAX_TIMER_MS = 2_147_483_647;

const AWS_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-[0-9]+$/u;
const COORDINATOR_AUTHORITY_PROFILE_ENV =
  'WHARFIE_COORDINATOR_AUTHORITY_PROFILE';
const COORDINATOR_RENEWAL_INTERVAL_ENV =
  'WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS';
const COORDINATOR_OBSERVATION_WINDOW_ENV =
  'WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS';
const COORDINATOR_TABLE_RESOURCE_ID_ENV =
  'WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID';
const DYNAMODB_TABLE_RESOURCE_ID_PREFIX = 'wdtr1';

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
 * Resolve one explicit AWS Region for a DynamoDB control client. The resolved
 * value is copied into command-local configuration so later ambient changes
 * cannot split the data client from its topology proof.
 * @param {DBAdapterName} [adapterName] - Already-resolved control adapter.
 * @returns {string | undefined} - Explicit region when configured, otherwise absent.
 */
export function resolveControlStoreRegion(
  adapterName = resolveControlAdapterName(),
) {
  const normalizedAdapter = normalizeAdapterName(
    adapterName,
    'control-store adapter',
  );
  if (normalizedAdapter !== 'dynamodb') return undefined;
  const region = process.env.AWS_REGION;
  if (region === undefined || region.trim() === '') return undefined;
  if (typeof region !== 'string' || !AWS_REGION_PATTERN.test(region.trim())) {
    throw new Error(
      'AWS_REGION must be a valid AWS Region when explicitly configured.',
    );
  }
  return region.trim();
}

/**
 * @param {string} name - Exact environment variable.
 * @returns {number} - Explicit positive bounded timer value.
 */
function resolveCoordinatorTimer(name) {
  const raw = process.env[name];
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/u.test(raw.trim())) {
    throw new Error(`${name} must be an explicit positive integer.`);
  }
  const value = Number(raw.trim());
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > COORDINATOR_AUTHORITY_MAX_TIMER_MS
  ) {
    throw new Error(
      `${name} must be no greater than ${COORDINATOR_AUTHORITY_MAX_TIMER_MS}.`,
    );
  }
  return value;
}

/**
 * Resolve the deliberately opt-in resident automatic-replacement profile.
 * Merely selecting DynamoDB does not enable automatic takeover. The caller
 * must also prove the exact table topology before starting a supervisor.
 * @param {{adapterName?: DBAdapterName, tableName?: string, region?: string}} [options] - Already-resolved command-local routing.
 * @returns {Readonly<{profile: 'dynamodb-rvn-v1', adapterName: 'dynamodb', region: string, tableName: string, tableResourceId: string, renewalIntervalMs: number, observationWindowMs: number}> | undefined} - Frozen policy or no automatic profile.
 */
export function resolveResidentCoordinatorAuthorityConfiguration(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Resident coordinator authority configuration options must be an object.',
    );
  }
  const allowed = new Set(['adapterName', 'tableName', 'region']);
  if (Object.keys(options).some((key) => !allowed.has(key))) {
    throw new TypeError(
      'Resident coordinator authority configuration options contain unsupported fields.',
    );
  }
  const adapterName = normalizeAdapterName(
    options.adapterName ?? resolveControlAdapterName(),
    'resident coordinator control adapter',
  );
  const configuredProfile = process.env[COORDINATOR_AUTHORITY_PROFILE_ENV];
  const configuredRenewal = process.env[COORDINATOR_RENEWAL_INTERVAL_ENV];
  const configuredObservation = process.env[COORDINATOR_OBSERVATION_WINDOW_ENV];
  const configuredTableResourceId =
    process.env[COORDINATOR_TABLE_RESOURCE_ID_ENV];
  if (
    configuredProfile === undefined &&
    configuredRenewal === undefined &&
    configuredObservation === undefined &&
    configuredTableResourceId === undefined
  ) {
    return undefined;
  }
  if (
    typeof configuredProfile !== 'string' ||
    configuredProfile.trim() !== DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE
  ) {
    throw new Error(
      `${COORDINATOR_AUTHORITY_PROFILE_ENV} must be '${DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE}'.`,
    );
  }
  if (adapterName !== 'dynamodb') {
    throw new Error(
      `${DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE} requires the DynamoDB control adapter.`,
    );
  }
  const tableName = options.tableName ?? resolveExecutionLedgerTableName();
  if (typeof tableName !== 'string' || !tableName.trim()) {
    throw new Error(
      `${DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE} requires an execution-ledger table.`,
    );
  }
  const region = options.region ?? resolveControlStoreRegion(adapterName);
  if (typeof region !== 'string' || !AWS_REGION_PATTERN.test(region)) {
    throw new Error(
      `${DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE} requires one resolved AWS Region.`,
    );
  }
  try {
    assertDomainSeparatedSha256Id(
      configuredTableResourceId,
      DYNAMODB_TABLE_RESOURCE_ID_PREFIX,
      COORDINATOR_TABLE_RESOURCE_ID_ENV,
    );
  } catch {
    throw new Error(
      `${COORDINATOR_TABLE_RESOURCE_ID_ENV} must be an explicit canonical DynamoDB table resource identity.`,
    );
  }
  const tableResourceId = /** @type {string} */ (configuredTableResourceId);
  const renewalIntervalMs = resolveCoordinatorTimer(
    COORDINATOR_RENEWAL_INTERVAL_ENV,
  );
  const observationWindowMs = resolveCoordinatorTimer(
    COORDINATOR_OBSERVATION_WINDOW_ENV,
  );
  if (observationWindowMs <= renewalIntervalMs) {
    throw new Error(
      `${COORDINATOR_OBSERVATION_WINDOW_ENV} must be greater than ${COORDINATOR_RENEWAL_INTERVAL_ENV}.`,
    );
  }
  return Object.freeze({
    profile: DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
    adapterName: /** @type {const} */ ('dynamodb'),
    region,
    tableName: tableName.trim(),
    tableResourceId,
    renewalIntervalMs,
    observationWindowMs,
  });
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

  if (getLocalAppStorageLayout()) return 'lmdb';
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

  if (getLocalAppStorageLayout()) return 'lmdb';
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
  const localAppStorage = getLocalAppStorageLayout();
  if (localAppStorage) return localAppStorage.controlPath;
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
  const localAppStorage = getLocalAppStorageLayout();
  if (localAppStorage) return localAppStorage.applicationStatePath;
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
  const localAppStorage = getLocalAppStorageLayout();
  if (localAppStorage) return localAppStorage.executionLedgerTable;
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

  const localAppStorage = getLocalAppStorageLayout();
  if (localAppStorage) return localAppStorage.payloadPath;

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

  const localAppStorage = getLocalAppStorageLayout();
  if (localAppStorage) return localAppStorage.sessionPath;

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
 * Create the fixed provider-backed DynamoDB adapter only after the explicit
 * companion package has loaded.
 * @param {Record<string, any>} options - DynamoDB adapter options.
 * @returns {Promise<import('../db/base.js').DBClient>} - Provider-backed client.
 */
async function createDynamoDBClient(options) {
  const [{ default: createDynamoDB }, { loadAwsProviderBindings }] =
    await Promise.all([
      import('../db/adapters/dynamodb.js'),
      import('../../runtime/aws-provider-module.js'),
    ]);
  const bindings = await loadAwsProviderBindings();
  return createDynamoDB(options, bindings);
}

/**
 * Create a new DB client based on the resolved general adapter.
 * @param {DBAdapterName} [adapterName] - adapterName.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createDBClient(adapterName = resolveDBAdapterName()) {
  if (adapterName === 'dynamodb') {
    return createDynamoDBClient({ region: process.env.AWS_REGION });
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
 * @param {{readOnly?: boolean, path?: string, region?: string}} [options] - Access mode and already-resolved routing.
 * @returns {Promise<import('../db/base.js').DBClient>} - Result.
 */
export async function createControlDBClient(
  adapterName = resolveControlAdapterName(),
  options = {},
) {
  if (adapterName === 'dynamodb') {
    return createDynamoDBClient({
      region: options.region ?? process.env.AWS_REGION,
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
    return createDynamoDBClient({
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
    return createDynamoDBClient({ region: process.env.AWS_REGION });
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
  DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
  COORDINATOR_AUTHORITY_MAX_TIMER_MS,
  resolveDBAdapterName,
  resolveStateAdapterName,
  resolveControlAdapterName,
  resolveControlStoreRegion,
  resolveResidentCoordinatorAuthorityConfiguration,
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
