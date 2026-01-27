import { open } from 'lmdb';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import paths from '../../paths.js';
import { CONDITION_TYPE } from '../base.js';
import { assertTightQuery } from '../utils.js';

const NO_SORT = '__no_sort__';
const SEP = '\u001f';

/**
 * @typedef CreateLMDBDBOptions
 * @property {string} [path] - Path to the database file. Defaults to `./data/database.json`. [db_path]
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
 * @param {CreateLMDBDBOptions} [options] -
 * @returns {import('../base.js').DBClient} -
 */
export default function createLMDB(options = {}) {
  const dbRoot = options.path
    ? join(options.path, 'lmdb')
    : join(paths.data, 'lmdb');
  mkdirSync(dbRoot, { recursive: true });

  // Disable event-turn batching to reduce the chance of background commit scheduling
  // keeping Jest alive (especially if someone accidentally uses async put/remove).
  const env = open({
    path: dbRoot,
    eventTurnBatching: false,
    commitDelay: 0,
    // encoding defaults to msgpack; we store plain JSON-ish objects.
  });

  /** @type {Map<string, any>} */
  const tables = new Map();

  /**
   * @param {string} tableName -
   * @returns {any} -
   */
  function ensureTable(tableName) {
    let t = tables.get(tableName);
    if (!t) {
      t = env.openDB({ name: tableName });
      tables.set(tableName, t);
    }
    return t;
  }

  function deepClone(v) {
    if (v === undefined || v === null) return v;

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

  function requireValue(v, label) {
    if (v === undefined || v === null) throw new Error(`${label} is required`);
    return String(v);
  }

  function assertSortPair(params) {
    const hasName = params.sortKeyName !== undefined;
    const hasValue = params.sortKeyValue !== undefined;
    if (hasName !== hasValue) {
      throw new Error('sortKeyName and sortKeyValue must be provided together');
    }
  }

  function pkTokenFromRecord(keyName, record) {
    return `${keyName}=${requireValue(record?.[keyName], `record.${keyName}`)}`;
  }

  function skTokenFromRecord(sortKeyName, record) {
    if (!sortKeyName) return NO_SORT;
    return `${sortKeyName}=${requireValue(record?.[sortKeyName], `record.${sortKeyName}`)}`;
  }

  function pkTokenFromCondition(pk) {
    return `${pk.propertyName}=${String(pk.propertyValue)}`;
  }

  function skPrefixFromCondition(sk) {
    return `${sk.propertyName}=${String(sk.propertyValue)}`;
  }

  function makeKey(pkTok, skTok) {
    return `${pkTok}${SEP}${skTok}`;
  }

  function makePrefix(pkTok) {
    return `${pkTok}${SEP}`;
  }

  function assertNonEmptyPath(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('UpdateDefinition.property must be a non-empty string[]');
    }
  }

  function setPath(record, path, value) {
    /** @type {any} */
    let cur = record;
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i];
      if (cur[seg] == null || typeof cur[seg] !== 'object') cur[seg] = {};
      cur = cur[seg];
    }
    cur[path[path.length - 1]] = value;
  }

  function matchesCondition(record, condition) {
    const value = record?.[condition.propertyName];

    if (condition.conditionType === CONDITION_TYPE.BEGINS_WITH) {
      return (
        typeof value === 'string' &&
        value.startsWith(String(condition.propertyValue))
      );
    }
    if (condition.conditionType === CONDITION_TYPE.EQUALS) {
      return value === condition.propertyValue;
    }
    throw new Error(`invalid condition type: ${condition.conditionType}`);
  }

  /**
   * Query records by PRIMARY (+ optional SORT), with optional non-key filters.
   * @param {import('../base.js').QueryParams} params
   * @returns {Promise<import('../base.js').DBRecord[]>}
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
      if (filters.length && !filters.every((c) => matchesCondition(row, c)))
        return [];
      return [deepClone(row)];
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
        if (filters.every((c) => matchesCondition(value, c)))
          out.push(deepClone(value));
      }
    }

    return out;
  }

  /**
   * Put (insert/overwrite) an item.
   * @param {import('../base.js').PutParams} params
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
   * @param {import('../base.js').GetParams} params
   * @returns {Promise<import('../base.js').DBRecord | undefined>}
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
   * @param {import('../base.js').UpdateParams} params
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
          if (!matchesCondition(existing, c))
            throw new Error('ConditionalCheckFailedException');
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
   * @param {import('../base.js').RemoveParams} params
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
   * @param {import('../base.js').BatchWriteParams} params
   */
  async function batchWrite(params) {
    const table = ensureTable(params.tableName);

    table.transactionSync(() => {
      for (const del of params.deleteRequests) {
        assertSortPair(del);
        const pkTok = `${del.keyName}=${String(del.keyValue)}`;
        const skTok = del.sortKeyName
          ? `${del.sortKeyName}=${String(del.sortKeyValue)}`
          : NO_SORT;
        table.removeSync(makeKey(pkTok, skTok));
      }

      for (const putReq of params.putRequests.filter(
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
   * Close underlying resources.
   */
  async function close() {
    // If anything in the future uses async writes, make sure they're fully committed/flushed.
    if (env?.committed) await env.committed;
    if (env?.flushed) await env.flushed;

    for (const db of tables.values()) {
      if (typeof db.close === 'function') await db.close();
    }
    tables.clear();

    if (typeof env.close === 'function') await env.close();
  }

  return {
    query,
    batchWrite,
    update,
    put,
    get,
    remove,
    close,
  };
}
