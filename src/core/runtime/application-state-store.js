import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  resolveApplicationStateAdapterName,
  resolveApplicationStateStorePath,
  resolveApplicationStateTableName,
} from '../lib/config/db.js';

const CONFIGURATION_KEYS = new Set(['adapterName', 'storePath', 'tableName']);
const ACCESS_OPTION_KEYS = new Set(['configuration', 'readOnly']);

/**
 * Validate and snapshot one host-owned application-state routing decision.
 * Store identity is deliberately absent: the finite effect/table contract
 * owns logical destination identity and its persistence rules.
 * @param {unknown} value - Candidate configuration.
 * @returns {Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v1'}>} - Canonical immutable configuration.
 */
export function validateApplicationStateStoreConfiguration(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(
      'Application-state store configuration must be an object.',
    );
  }
  for (const key of Object.keys(value)) {
    if (!CONFIGURATION_KEYS.has(key)) {
      throw new TypeError(
        `Application-state store configuration.${key} is not supported.`,
      );
    }
  }
  for (const key of CONFIGURATION_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw new TypeError(
        `Application-state store configuration.${key} is required.`,
      );
    }
  }

  const configuration = /** @type {Record<string, unknown>} */ (value);
  if (
    configuration.adapterName !== 'dynamodb' &&
    configuration.adapterName !== 'lmdb' &&
    configuration.adapterName !== 'vanilla'
  ) {
    throw new TypeError(
      'Application-state store configuration.adapterName must be dynamodb, lmdb, or vanilla.',
    );
  }
  if (
    typeof configuration.storePath !== 'string' ||
    !configuration.storePath.trim() ||
    configuration.storePath !== configuration.storePath.trim()
  ) {
    throw new TypeError(
      'Application-state store configuration.storePath must be a trimmed non-empty string.',
    );
  }
  if (configuration.tableName !== APPLICATION_STATE_TABLE_NAME) {
    throw new TypeError(
      `Application-state store configuration.tableName must be '${APPLICATION_STATE_TABLE_NAME}'.`,
    );
  }

  return Object.freeze({
    adapterName: configuration.adapterName,
    storePath: configuration.storePath,
    tableName: APPLICATION_STATE_TABLE_NAME,
  });
}

/**
 * Resolve every ambient application-state input once for one host operation.
 * @returns {Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v1'}>} - Immutable routing configuration.
 */
export function resolveApplicationStateStoreConfiguration() {
  return validateApplicationStateStoreConfiguration({
    adapterName: resolveApplicationStateAdapterName(),
    storePath: resolveApplicationStateStorePath(),
    tableName: resolveApplicationStateTableName(),
  });
}

/**
 * Open the application data store for one host operation and always release
 * its client. The callback receives the fixed table separately from the DB
 * facade so catalog adapters cannot drift into the execution-ledger table.
 * @template T
 * @param {(db: import('../lib/db/base.js').DBClient, context: Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v1', readOnly: boolean}>) => Promise<T>|T} handler - Store operation.
 * @param {{configuration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, readOnly?: boolean}} [options] - Exact access options.
 * @returns {Promise<T>} - Handler result.
 */
export async function withApplicationStateDB(handler, options = {}) {
  if (typeof handler !== 'function') {
    throw new TypeError('Application-state store handler must be a function.');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Application-state store options must be an object.');
  }
  for (const key of Object.keys(options)) {
    if (!ACCESS_OPTION_KEYS.has(key)) {
      throw new TypeError(
        `Application-state store option '${key}' is not supported.`,
      );
    }
  }
  if (options.readOnly !== undefined && typeof options.readOnly !== 'boolean') {
    throw new TypeError('Application-state store readOnly must be a boolean.');
  }

  const configuration = Object.prototype.hasOwnProperty.call(
    options,
    'configuration',
  )
    ? validateApplicationStateStoreConfiguration(options.configuration)
    : resolveApplicationStateStoreConfiguration();
  const readOnly = options.readOnly === true;
  /** @type {import('../lib/db/base.js').DBClient | undefined} */
  let db;
  try {
    db = await createApplicationStateDBClient(configuration.adapterName, {
      path: configuration.storePath,
      readOnly,
    });
    return await handler(db, Object.freeze({ ...configuration, readOnly }));
  } finally {
    await db?.close?.();
  }
}

export default withApplicationStateDB;
