import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import {
  APPLICATION_STATE_TABLE_NAME,
  createApplicationStateDBClient,
  resolveApplicationStateAdapterName,
  resolveApplicationStateStorePath,
  resolveApplicationStateTableName,
} from '../lib/config/db.js';

const CONFIGURATION_KEYS = new Set(['adapterName', 'storePath', 'tableName']);
const ACCESS_OPTION_KEYS = new Set(['configuration', 'readOnly']);
const PORTABLE_PATH_COLLATOR = new Intl.Collator('und', {
  usage: 'search',
  sensitivity: 'base',
  ignorePunctuation: false,
  numeric: false,
});

/**
 * Resolve symlinks through the nearest existing ancestor without creating a
 * missing store path. `realpath` alone cannot follow a dangling link, so this
 * walks upward with `lstat` and resolves the link target before restoring the
 * prospective missing suffix.
 * @param {string} value - Local store root.
 * @param {Set<string>} [visitedLinks] - Absolute links already followed.
 * @returns {string} - Canonical prospective path.
 */
function canonicalProspectivePath(value, visitedLinks = new Set()) {
  let cursor = resolve(value);
  /** @type {string[]} */
  const missing = [];
  while (true) {
    let stats;
    try {
      stats = lstatSync(cursor);
    } catch (error) {
      if (
        !error ||
        typeof error !== 'object' ||
        /** @type {{code?: unknown}} */ (error).code !== 'ENOENT'
      ) {
        throw error;
      }
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(value);
      missing.push(basename(cursor));
      cursor = parent;
      continue;
    }

    if (stats.isSymbolicLink()) {
      if (visitedLinks.has(cursor)) {
        throw new Error(
          `Application-state store path contains a symbolic-link cycle at '${cursor}'.`,
        );
      }
      visitedLinks.add(cursor);
      const target = resolve(dirname(cursor), readlinkSync(cursor));
      return canonicalProspectivePath(
        join(target, ...missing.reverse()),
        visitedLinks,
      );
    }

    return join(realpathSync.native(cursor), ...missing.reverse());
  }
}

/**
 * Conservatively compare prospective roots using fixed-locale Unicode search
 * collation. It intentionally rejects some names that a case-sensitive host
 * could keep distinct so the same configuration cannot collapse on APFS or
 * another case-insensitive deployment.
 * @param {string} left - First local store root.
 * @param {string} right - Second local store root.
 * @returns {boolean} - Whether the roots may alias on a supported filesystem.
 */
function localStorePathsMayAlias(left, right) {
  const canonicalLeft = canonicalProspectivePath(left).normalize('NFC');
  const canonicalRight = canonicalProspectivePath(right).normalize('NFC');
  return PORTABLE_PATH_COLLATOR.compare(canonicalLeft, canonicalRight) === 0;
}

/**
 * Validate and snapshot one host-owned application-state routing decision.
 * Store identity is deliberately absent: the finite effect/table contract
 * owns logical destination identity and its persistence rules.
 * @param {unknown} value - Candidate configuration.
 * @returns {Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v2'}>} - Canonical immutable configuration.
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
 * @returns {Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v2'}>} - Immutable routing configuration.
 */
export function resolveApplicationStateStoreConfiguration() {
  return validateApplicationStateStoreConfiguration({
    adapterName: resolveApplicationStateAdapterName(),
    storePath: resolveApplicationStateStorePath(),
    tableName: resolveApplicationStateTableName(),
  });
}

/**
 * Refuse to collapse durable control and application data into one local DB
 * environment. Distinct table names are not sufficient isolation: one native
 * root still shares lifecycle, failure, backup, and corruption domains.
 * @param {ReturnType<typeof resolveApplicationStateStoreConfiguration>} application - Resolved application-state route.
 * @param {{adapterName: import('../lib/config/db.js').DBAdapterName, controlPath: string}} control - Resolved execution-control route.
 * @returns {void}
 */
export function assertApplicationStateStoreIsolation(application, control) {
  const localAdapters = new Set(['lmdb', 'vanilla']);
  if (
    !localAdapters.has(application.adapterName) ||
    !localAdapters.has(control.adapterName)
  ) {
    return;
  }
  if (typeof control.controlPath !== 'string' || !control.controlPath.trim()) {
    throw new TypeError(
      'Application-state isolation requires the resolved controlPath.',
    );
  }
  if (localStorePathsMayAlias(application.storePath, control.controlPath)) {
    throw new Error(
      'Application-state and execution-control stores must use distinct local roots.',
    );
  }
}

/**
 * Validate and resolve one exact store access request without opening it.
 * @param {{configuration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, readOnly?: boolean}} options - Candidate access options.
 * @returns {{configuration: ReturnType<typeof resolveApplicationStateStoreConfiguration>, readOnly: boolean}} - Snapshotted access decision.
 */
function resolveApplicationStateAccess(options) {
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
  return { configuration, readOnly: options.readOnly === true };
}

/**
 * Open one host-owned application-state scope. The caller must await `close`;
 * this lower-level form exists for durable runners that acquire resources
 * before STARTED and retain them through terminal/uncertain settlement.
 * @param {{configuration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, readOnly?: boolean}} [options] - Exact access options.
 * @returns {Promise<Readonly<{db: import('../lib/db/base.js').DBClient, context: Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v2', readOnly: boolean}>, close: () => Promise<void>}>>} - Owned store scope.
 */
export async function openApplicationStateDB(options = {}) {
  const { configuration, readOnly } = resolveApplicationStateAccess(options);
  const db = await createApplicationStateDBClient(configuration.adapterName, {
    path: configuration.storePath,
    readOnly,
  });
  const context = Object.freeze({ ...configuration, readOnly });
  /** @type {Promise<void> | undefined} */
  let closePromise;
  const close = () => {
    closePromise ??= Promise.resolve()
      .then(async () => await db.close?.())
      .then(() => undefined);
    return closePromise;
  };
  return Object.freeze({ db, context, close });
}

/**
 * Open the application data store for one host operation and always release
 * its client. The callback receives the fixed table separately from the DB
 * facade so catalog adapters cannot drift into the execution-ledger table.
 * @template T
 * @param {(db: import('../lib/db/base.js').DBClient, context: Readonly<{adapterName: import('../lib/config/db.js').DBAdapterName, storePath: string, tableName: 'wharfie-application-state-v2', readOnly: boolean}>) => Promise<T>|T} handler - Store operation.
 * @param {{configuration?: ReturnType<typeof resolveApplicationStateStoreConfiguration>, readOnly?: boolean}} [options] - Exact access options.
 * @returns {Promise<T>} - Handler result.
 */
export async function withApplicationStateDB(handler, options = {}) {
  if (typeof handler !== 'function') {
    throw new TypeError('Application-state store handler must be a function.');
  }
  const access = await openApplicationStateDB(options);
  try {
    return await handler(access.db, access.context);
  } finally {
    await access.close();
  }
}

export default withApplicationStateDB;
