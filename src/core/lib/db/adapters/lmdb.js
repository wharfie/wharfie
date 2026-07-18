import { lstatSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import paths from '../../paths.js';
import { getLmdbModule } from '../../lmdb-module.js';
import {
  CONDITION_TYPE,
  recordMatchesCondition,
  transactionRequestKey,
  transactionRequestUpdates,
  validateTransactionWrite,
} from '../base.js';
import {
  assertPortablePageAscii,
  assertTightQuery,
  assertTightQueryPage,
} from '../utils.js';

const NO_SORT = '__no_sort__';
const SEP = '\u001f';

/**
 * @typedef CreateLMDBDBOptions
 * @property {string} [path] - Path to the database file. Defaults to `./data/database.json`. [db_path]
 * @property {boolean} [readOnly] - Open an existing control volume without creating tables or accepting writes.
 */

/**
 * LMDB-backed local DB adapter implementing DBClient.
 *
 * Key goals for the contract tests:
 * - Immutability: callers can never mutate stored state via returned objects
 * - No hanging Jest runs: avoid async/batched LMDB writes that keep timers/handles alive
 *
 * Implementation choices:
 * - Use synchronous mutations (putSync/removeSync) and avoid queued async puts/removes
 * - Avoid transactionSync for reads (no readOnly flag exists); reads are synchronous already
 * - close() awaits DB/env close to release native resources
 * @param {CreateLMDBDBOptions} [options] - options.
 * @returns {import('../base.js').DBClient} - Result.
 */
export default function createLMDB(options = {}) {
  const dbRoot = options.path
    ? join(options.path, 'lmdb')
    : join(paths.data, 'lmdb');
  const readOnly = options.readOnly === true;
  if (readOnly) {
    let stats;
    try {
      stats = lstatSync(dbRoot);
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      throw new Error(
        `LMDB read-only control volume does not exist at '${dbRoot}'.${detail}`,
      );
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(
        `LMDB read-only control volume must be a non-symbolic-link directory: '${dbRoot}'.`,
      );
    }
  } else {
    mkdirSync(dbRoot, { recursive: true });
  }

  // Disable event-turn batching to reduce the chance of background commit scheduling
  // keeping Jest alive (especially if someone accidentally uses async put/remove).
  const env = getLmdbModule().open({
    path: dbRoot,
    readOnly,
    eventTurnBatching: false,
    commitDelay: 0,
    // encoding defaults to msgpack; we store plain JSON-ish objects.
  });

  /** @type {Map<string, any>} */
  const tables = new Map();

  /**
   * @param {string} tableName - tableName.
   * @returns {any} - Result.
   */
  function ensureTable(tableName) {
    let t = tables.get(tableName);
    if (!t) {
      const opened = env.openDB({ name: tableName, create: !readOnly });
      if (!opened) {
        if (readOnly) {
          throw new Error(
            `LMDB read-only table '${tableName}' is not ready in the existing control volume.`,
          );
        }
        throw new Error(`LMDB could not open table '${tableName}'.`);
      }
      t = opened;
      tables.set(tableName, t);
    }
    return t;
  }

  /**
   * @param {import("../base.js").DBRecord} v - v.
   * @returns {import("../base.js").DBRecord} - Result.
   */
  function deepClone(v) {
    // if (v === undefined || v === null) return v;

    // Prefer structuredClone when available, with a safe fallback for plain objects.
    if (typeof structuredClone === 'function') {
      try {
        return structuredClone(v);
      } catch {
        // fall through
      }
    }

    return JSON.parse(JSON.stringify(v));
  }

  /**
   * @param {null | undefined} v - v.
   * @param {string} label - label.
   * @returns {string} - Result.
   */
  function requireValue(v, label) {
    if (v === undefined || v === null) throw new Error(`${label} is required`);
    return String(v);
  }

  /**
   * @param {import("../base.js").DeleteRequest | import("../base.js").GetParams} params - params.
   */
  function assertSortPair(params) {
    const hasName = params.sortKeyName !== undefined;
    const hasValue = params.sortKeyValue !== undefined;
    if (hasName !== hasValue) {
      throw new Error('sortKeyName and sortKeyValue must be provided together');
    }
  }

  /**
   * @param {string} keyName - keyName.
   * @param {import("../base.js").DBRecord} record - record.
   * @returns {string} - Result.
   */
  function pkTokenFromRecord(keyName, record) {
    return `${keyName}=${requireValue(record?.[keyName], `record.${keyName}`)}`;
  }

  /**
   * @param {string | number | undefined} sortKeyName - sortKeyName.
   * @param {import("../base.js").DBRecord} record - record.
   * @returns {string} - Result.
   */
  function skTokenFromRecord(sortKeyName, record) {
    if (!sortKeyName) return NO_SORT;
    return `${sortKeyName}=${requireValue(record?.[sortKeyName], `record.${sortKeyName}`)}`;
  }

  /**
   * @param {import('../base.js').KeyCondition} pk - condition.
   * @returns {string} - Result.
   */
  function pkTokenFromCondition(pk) {
    return `${pk.propertyName}=${String(pk.propertyValue)}`;
  }

  /**
   * @param {import('../base.js').KeyCondition} sk - condition.
   * @returns {string} - Result.
   */
  function skPrefixFromCondition(sk) {
    return `${sk.propertyName}=${String(sk.propertyValue)}`;
  }

  /**
   * @param {string} pkTok - pkTok.
   * @param {string} skTok - skTok.
   * @returns {string} - Result.
   */
  function makeKey(pkTok, skTok) {
    return `${pkTok}${SEP}${skTok}`;
  }

  /**
   * @param {string} pkTok - pkTok.
   * @returns {string} - Result.
   */
  function makePrefix(pkTok) {
    return `${pkTok}${SEP}`;
  }

  /**
   * @param {string | any[]} path - path.
   */
  function assertNonEmptyPath(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('UpdateDefinition.property must be a non-empty string[]');
    }
  }

  /**
   * @param {import('../base.js').DBRecord} record - record.
   * @param {string[]} path - path.
   * @param {any} value - value.
   * @returns {void} - Result.
   */
  function setPath(record, path, value) {
    /** @type {any} */
    let cur = record;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      if (
        !Object.prototype.hasOwnProperty.call(cur, seg) ||
        cur[seg] === null ||
        typeof cur[seg] !== 'object' ||
        Array.isArray(cur[seg])
      ) {
        throw new Error(`Invalid update path: ${path.join('.')}`);
      }
      cur = cur[seg];
    }
    Object.defineProperty(cur, path[path.length - 1], {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  /**
   * Query records by PRIMARY (+ optional SORT), with optional non-key filters.
   * @param {import('../base.js').QueryParams} params - params.
   * @returns {Promise<import('../base.js').DBRecord[]>} - Result.
   */
  async function query(params) {
    const { pk, sk, filters } = assertTightQuery(params);
    const table = ensureTable(params.tableName);
    const pkTok = pkTokenFromCondition(pk);

    // SK EQUALS -> direct get (fast)
    if (sk && sk.conditionType === CONDITION_TYPE.EQUALS) {
      const skTok = skPrefixFromCondition(sk);
      const row = table.get(makeKey(pkTok, skTok));
      if (!row) return [];
      if (
        filters.length &&
        !filters.every((c) => recordMatchesCondition(row, c))
      )
        return [];
      return row ? [deepClone(row)] : [];
    }

    /** @type {import('../base.js').DBRecord[]} */
    const out = [];

    const basePrefix = makePrefix(pkTok);
    const scanPrefix =
      sk && sk.conditionType === CONDITION_TYPE.BEGINS_WITH
        ? `${basePrefix}${skPrefixFromCondition(sk)}`
        : basePrefix;

    // Bound the iterator so we don't rely on early-break to release cursors.
    // Any key starting with scanPrefix will be < scanPrefix + "\uffff" in lexicographic order.
    const end = `${scanPrefix}\uffff`;

    for (const { value } of table.getRange({ start: scanPrefix, end })) {
      if (filters.length === 0) {
        out.push(deepClone(value));
      } else {
        if (filters.every((c) => recordMatchesCondition(value, c)))
          out.push(deepClone(value));
      }
    }

    return out;
  }

  /**
   * Read one bounded, lexically ordered page under a sort-key prefix. This is
   * intentionally separate from query(): callers that need history cannot
   * accidentally materialize an unbounded partition first.
   * @param {import('../base.js').QueryPageParams} params - Page request.
   * @returns {import('../base.js').QueryPageReturn} - Bounded page.
   */
  async function queryPage(params) {
    const { pk, sk, limit, startAfter } = assertTightQueryPage(params);
    const table = ensureTable(params.tableName);
    const pkTok = pkTokenFromCondition(pk);
    const basePrefix = makePrefix(pkTok);
    const scanPrefix = `${basePrefix}${skPrefixFromCondition(sk)}`;
    const startKey =
      startAfter === undefined
        ? scanPrefix
        : makeKey(pkTok, `${sk.propertyName}=${startAfter}`);
    /** @type {import('../base.js').DBRecord[]} */
    const items = [];
    let hasNext = false;
    let lastSortKey;

    // Do not invent an end sentinel: a generic Unicode suffix can sort after
    // U+FFFF. The portable page contract constrains its keys to ASCII, and a
    // prefix break keeps this iterator exact even if older rows are wider.
    for (const { key, value } of table.getRange({ start: startKey })) {
      if (!key.startsWith(scanPrefix)) break;
      if (startAfter !== undefined && key === startKey) continue;
      if (items.length === limit) {
        hasNext = true;
        break;
      }
      const tokenPrefix = `${sk.propertyName}=`;
      const physicalSortToken = key.slice(basePrefix.length);
      const sortKey = assertPortablePageAscii(
        physicalSortToken.slice(tokenPrefix.length),
        'queryPage stored sort key',
      );
      if (!value || value[sk.propertyName] !== sortKey) {
        throw new Error(
          'queryPage stored record sort key does not match its physical key',
        );
      }
      items.push(deepClone(value));
      lastSortKey = sortKey;
    }

    return {
      items,
      ...(hasNext && items.length > 0 ? { nextStartAfter: lastSortKey } : {}),
    };
  }

  /**
   * Put (insert/overwrite) an item.
   * @param {import('../base.js').PutParams} params - params.
   */
  async function put(params) {
    const table = ensureTable(params.tableName);
    const record = params.record;
    if (!record || typeof record !== 'object')
      throw new Error('record is required');

    const pkTok = pkTokenFromRecord(params.keyName, record);
    const skTok = skTokenFromRecord(params.sortKeyName, record);

    // Store a copy to guarantee callers can't mutate what gets stored after put().
    const stored = deepClone(record);

    table.putSync(makeKey(pkTok, skTok), stored);
  }

  /**
   * Get an item by key (immutable return).
   * @param {import('../base.js').GetParams} params - params.
   * @returns {Promise<import('../base.js').DBRecord | undefined>} - Result.
   */
  async function get(params) {
    assertSortPair(params);
    const table = ensureTable(params.tableName);

    const pkTok = `${params.keyName}=${String(params.keyValue)}`;
    const skTok = params.sortKeyName
      ? `${params.sortKeyName}=${String(params.sortKeyValue)}`
      : NO_SORT;
    const k = makeKey(pkTok, skTok);

    const row = table.get(k);
    return row ? deepClone(row) : undefined;
  }

  /**
   * Update fields on an item by key.
   * @param {import('../base.js').UpdateParams} params - params.
   */
  async function update(params) {
    assertSortPair(params);
    const table = ensureTable(params.tableName);

    const pkTok = `${params.keyName}=${String(params.keyValue)}`;
    const skTok = params.sortKeyName
      ? `${params.sortKeyName}=${String(params.sortKeyValue)}`
      : NO_SORT;
    const k = makeKey(pkTok, skTok);

    // Use a write transaction for read+check+write consistency.
    table.transactionSync(() => {
      const existing = table.get(k);
      if (!existing) return;

      if (params.conditions?.length) {
        for (const c of params.conditions) {
          if (!recordMatchesCondition(existing, c)) {
            const err = new Error('ConditionalCheckFailedException');
            err.name = 'ConditionalCheckFailedException';
            throw err;
          }
        }
      }

      /** @type {import('../base.js').UpdateDefinition[]} */
      const updates =
        params.updates && params.updates.length > 0
          ? params.updates
          : Object.entries(params.record || {})
              .filter(([, v]) => v !== undefined)
              .filter(
                ([kk]) => kk !== params.keyName && kk !== params.sortKeyName,
              )
              .map(([kk, v]) => ({ property: [kk], propertyValue: v }));

      if (!updates.length) return;

      // Immutability: clone before patch (copy-on-write).
      const next = deepClone(existing);

      for (const u of updates) {
        assertNonEmptyPath(u.property);
        setPath(next, u.property, u.propertyValue);
      }

      table.putSync(k, next);
    });
  }

  /**
   * Remove (delete) an item by key.
   * @param {import('../base.js').RemoveParams} params - params.
   */
  async function remove(params) {
    assertSortPair(params);
    const table = ensureTable(params.tableName);

    const pkTok = `${params.keyName}=${String(params.keyValue)}`;
    const skTok = params.sortKeyName
      ? `${params.sortKeyName}=${String(params.sortKeyValue)}`
      : NO_SORT;

    table.removeSync(makeKey(pkTok, skTok));
  }

  /**
   * BatchWrite of deletes and puts (single write transaction).
   * @param {import('../base.js').BatchWriteParams} params - params.
   */
  async function batchWrite(params) {
    const table = ensureTable(params.tableName);

    const deleteRequests = Array.isArray(params.deleteRequests)
      ? params.deleteRequests
      : [];
    const putRequests = Array.isArray(params.putRequests)
      ? params.putRequests
      : [];

    table.transactionSync(() => {
      for (const del of deleteRequests) {
        assertSortPair(del);
        const pkTok = `${del.keyName}=${String(del.keyValue)}`;
        const skTok = del.sortKeyName
          ? `${del.sortKeyName}=${String(del.sortKeyValue)}`
          : NO_SORT;
        table.removeSync(makeKey(pkTok, skTok));
      }

      for (const putReq of putRequests.filter(
        (v) => v !== undefined && v !== null,
      )) {
        const record = putReq.record;
        if (!record || typeof record !== 'object')
          throw new Error('putRequests[].record is required');
        if (typeof putReq.keyName !== 'string' || putReq.keyName.length === 0) {
          throw new Error('putRequests[].keyName is required');
        }

        const pkTok = pkTokenFromRecord(putReq.keyName, record);
        const skTok = skTokenFromRecord(putReq.sortKeyName, record);

        table.putSync(makeKey(pkTok, skTok), deepClone(record));
      }
    });
  }

  /**
   * Atomically condition-check and mutate distinct items in one table.
   * @param {import('../base.js').TransactionWriteParams} params - params.
   */
  async function transactionWrite(params) {
    const requests = validateTransactionWrite(params);
    const table = ensureTable(params.tableName);

    /**
     * @param {ReturnType<typeof transactionRequestKey>} key - Exact item key.
     * @returns {string} - LMDB key.
     */
    const dbKey = (key) =>
      makeKey(
        `${key.keyName}=${key.keyValue}`,
        key.sortKeyName ? `${key.sortKeyName}=${key.sortKeyValue}` : NO_SORT,
      );

    table.transactionSync(() => {
      const groups = /** @type {Array<[any[], boolean]>} */ ([
        [requests.conditionChecks, false],
        [requests.putRequests, true],
        [requests.updateRequests, false],
        [requests.deleteRequests, false],
      ]);

      // Read and check all conditions before applying any mutation.
      for (const [group, putRequest] of groups) {
        for (const request of group) {
          const key = transactionRequestKey(request, '', putRequest);
          const existing = table.get(dbKey(key));
          if (
            !(request.conditions || []).every(
              (/** @type {import('../base.js').KeyCondition} */ condition) =>
                recordMatchesCondition(existing, condition),
            )
          ) {
            const error = new Error('ConditionalCheckFailedException');
            error.name = 'ConditionalCheckFailedException';
            throw error;
          }
        }
      }

      for (const request of requests.deleteRequests) {
        const key = transactionRequestKey(request, '', false);
        table.removeSync(dbKey(key));
      }

      for (const request of requests.putRequests) {
        const key = transactionRequestKey(request, '', true);
        table.putSync(dbKey(key), deepClone(request.record));
      }

      for (const request of requests.updateRequests) {
        const key = transactionRequestKey(request, '', false);
        const existing = table.get(dbKey(key));
        const next = existing
          ? deepClone(existing)
          : {
              [key.keyName]: key.keyValue,
              ...(key.sortKeyName
                ? { [key.sortKeyName]: key.sortKeyValue }
                : {}),
            };
        const updates = transactionRequestUpdates(request);
        for (const update of updates) {
          assertNonEmptyPath(update.property);
          setPath(next, update.property, update.propertyValue);
        }
        table.putSync(dbKey(key), next);
      }
    });
  }

  /**
   * Close underlying resources.
   */
  async function close() {
    // If anything in the future uses async writes, make sure they're fully committed/flushed.
    if (env?.committed) await env.committed;
    if (env?.flushed) await env.flushed;

    for (const db of tables.values()) {
      if (db && typeof db.close === 'function') await db.close();
    }
    tables.clear();

    if (typeof env.close === 'function') await env.close();
  }

  return {
    query,
    queryPage,
    batchWrite,
    transactionWrite,
    update,
    put,
    get,
    remove,
    close,
  };
}
