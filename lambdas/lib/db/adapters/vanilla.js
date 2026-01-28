import { promises as fsp, existsSync, readFileSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createId } from '../../id.js';
import paths from '../../paths.js';
import { CONDITION_TYPE } from '../base.js';
import { assertTightQuery } from '../utils.js';

const NO_SORT = '__no_sort__';

/**
 * @typedef CreateVanillaDBOptions
 * @property {string} [path] - Path to the database file. Defaults to `./data/database.json`. [db_path]
 */

/**
 * Vanilla in-memory + persisted JSON "DB" that implements the same DBClient interface.
 *
 * Immutability contract:
 * - put/batchWrite store deep clones (caller mutations after write do not affect DB)
 * - get/query return deep clones (caller mutations after read do not affect DB)
 * - update performs copy-on-write (updates do not mutate stored object identity in-place)
 *
 * Storage layout:
 *   tableName -> pkToken -> skToken -> record
 *
 * Tokens embed the attribute name to avoid collisions across different key attribute names:
 *   pkToken = `${keyName}=${String(pkValue)}`
 *   skToken = `${sortKeyName}=${String(skValue)}` or NO_SORT
 * @param {CreateVanillaDBOptions} [options] -
 * @returns {import('../base.js').DBClient} -
 */
export default function createVanillaDB(options = {}) {
  /**
   * @type {Record<string, Record<string, Record<string, import('../base.js').DBRecord>>>}
   */
  let database = {};
  const dbFilePath = options.path
    ? join(options.path, 'database.json')
    : join(paths.data, 'database.json');
  const dbDir = dirname(dbFilePath);

  if (existsSync(dbFilePath)) {
    try {
      const data = readFileSync(dbFilePath, 'utf8');
      database = JSON.parse(data) || {};
    } catch {
      // TODO log warning
      database = {};
    }
  }

  /**
   * Fast-ish deep clone for JSON-safe records.
   * Assumption: records are JSON-serializable (matches persistence format).
   * @template T
   * @param {T} v -
   * @returns {T} -
   */
  function deepClone(v) {
    if (v === undefined) return /** @type {any} */ (undefined);
    return JSON.parse(JSON.stringify(v));
  }

  /**
   * @param {string} tableName -
   * @returns {Record<string, Record<string, import('../base.js').DBRecord>>} -
   */
  function ensureTable(tableName) {
    if (!database[tableName]) database[tableName] = {};
    return database[tableName];
  }

  /**
   * @param {any} v -
   * @param {string} label -
   * @returns {string} -
   */
  function requireValue(v, label) {
    if (v === undefined || v === null) throw new Error(`${label} is required`);
    return String(v);
  }

  /**
   * Validate "both-or-neither" sort key params.
   * @param {{ sortKeyName?: string, sortKeyValue?: any }} params -
   */
  function assertSortPair(params) {
    const hasName = params.sortKeyName !== undefined;
    const hasValue = params.sortKeyValue !== undefined;
    if (hasName !== hasValue) {
      throw new Error('sortKeyName and sortKeyValue must be provided together');
    }
  }

  /**
   * @param {string} keyName -
   * @param {import('../base.js').DBRecord} record -
   * @returns {string} -
   */
  function pkTokenFromRecord(keyName, record) {
    return `${keyName}=${requireValue(record?.[keyName], `record.${keyName}`)}`;
  }

  /**
   * @param {string | undefined} sortKeyName -
   * @param {import('../base.js').DBRecord} record -
   * @returns {string} -
   */
  function skTokenFromRecord(sortKeyName, record) {
    if (!sortKeyName) return NO_SORT;
    return `${sortKeyName}=${requireValue(record?.[sortKeyName], `record.${sortKeyName}`)}`;
  }

  /**
   * @param {import('../base.js').UpdateDefinition['property']} path -
   * @returns {void} -
   */
  function assertNonEmptyPath(path) {
    if (!Array.isArray(path) || path.length === 0) {
      throw new Error('UpdateDefinition.property must be a non-empty string[]');
    }
  }

  /**
   * @param {import('../base.js').DBRecord} record -
   * @param {string[]} path -
   * @param {any} value -
   * @returns {void} -
   */
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

  /**
   * @param {import('../base.js').DBRecord} record -
   * @param {import('../base.js').KeyCondition} condition -
   * @returns {boolean} -
   */
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
   *
   * Rules:
   * - Exactly one PRIMARY EQUALS condition is required (selects pk bucket)
   * - Optional SORT condition:
   * - EQUALS => at most one item
   * - BEGINS_WITH => prefix scan within the pk bucket
   * - Any conditions without keyType are treated as filters over the candidate set
   *
   * Immutability:
   * - returns deep clones of stored records
   * @param {import('../base.js').QueryParams} params -
   * @returns {import('../base.js').QueryReturn} -
   */
  async function query(params) {
    const { pk, sk, filters } = assertTightQuery(params);

    const table = database[params.tableName];
    if (!table) return [];

    const pkTok = `${pk.propertyName}=${String(pk.propertyValue)}`;
    const skMap = table[pkTok];
    if (!skMap) return [];

    /** @type {import('../base.js').DBRecord[]} */
    let candidates = [];

    if (!sk) {
      candidates = Object.values(skMap);
    } else {
      const skPrefix = `${sk.propertyName}=${String(sk.propertyValue)}`;

      if (sk.conditionType === CONDITION_TYPE.EQUALS) {
        const r = skMap[skPrefix];
        if (r) candidates = [r];
      } else if (sk.conditionType === CONDITION_TYPE.BEGINS_WITH) {
        for (const [k, v] of Object.entries(skMap)) {
          if (k.startsWith(skPrefix)) candidates.push(v);
        }
      } else {
        throw new Error(`invalid condition type: ${sk.conditionType}`);
      }
    }

    let out = candidates;
    if (filters.length) {
      out = out.filter((r) => filters.every((c) => matchesCondition(r, c)));
    }

    // immutability: return clones
    return out.map((r) => deepClone(r));
  }

  /**
   * Put (insert/overwrite) an item.
   *
   * Requirements:
   * - record[keyName] must exist
   * - if sortKeyName is provided, record[sortKeyName] must exist
   *
   * Immutability:
   * - stores a deep clone
   * @param {import('../base.js').PutParams} params -
   * @returns {import('../base.js').PutReturn} -
   */
  async function put(params) {
    const table = ensureTable(params.tableName);

    const record = params.record;
    if (!record || typeof record !== 'object')
      throw new Error('record is required');

    const pkTok = pkTokenFromRecord(params.keyName, record);
    const skTok = skTokenFromRecord(params.sortKeyName, record);

    if (!table[pkTok]) table[pkTok] = {};
    table[pkTok][skTok] = deepClone(record);
  }

  /**
   * Get an item by key.
   *
   * Immutability:
   * - returns a deep clone
   * @param {import('../base.js').GetParams} params -
   * @returns {import('../base.js').GetReturn} -
   */
  async function get(params) {
    assertSortPair(params);

    const table = database[params.tableName];
    if (!table) return undefined;

    const pkTok = `${params.keyName}=${String(params.keyValue)}`;
    const skTok = params.sortKeyName
      ? `${params.sortKeyName}=${String(params.sortKeyValue)}`
      : NO_SORT;

    const found = table[pkTok]?.[skTok];
    if (found === undefined) return undefined;
    return deepClone(found);
  }

  /**
   * Update fields on an item by key.
   *
   * Behavior:
   * - If item doesn't exist: no-op
   * - If conditions are present and any fail: throws ConditionalCheckFailedException
   * - If updates not provided, derive updates from params.record excluding key fields and undefined values
   *
   * Immutability:
   * - copy-on-write: does not mutate the stored object reference in-place
   * @param {import('../base.js').UpdateParams} params -
   * @returns {import('../base.js').UpdateReturn} -
   */
  async function update(params) {
    assertSortPair(params);

    const table = database[params.tableName];
    if (!table) return;

    const pkTok = `${params.keyName}=${String(params.keyValue)}`;
    const skTok = params.sortKeyName
      ? `${params.sortKeyName}=${String(params.sortKeyValue)}`
      : NO_SORT;

    const existing = table[pkTok]?.[skTok];
    if (!existing) return;

    if (params.conditions?.length) {
      for (const c of params.conditions) {
        if (!matchesCondition(existing, c)) {
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
            .filter(([k]) => k !== params.keyName && k !== params.sortKeyName)
            .map(([k, v]) => ({ property: [k], propertyValue: v }));

    if (!updates.length) return;

    // immutability: copy-on-write
    const next = deepClone(existing);

    for (const u of updates) {
      assertNonEmptyPath(u.property);
      setPath(next, u.property, u.propertyValue);
    }

    table[pkTok][skTok] = next;
  }

  /**
   * Remove (delete) an item by key.
   * @param {import('../base.js').RemoveParams} params -
   * @returns {import('../base.js').RemoveReturn} -
   */
  async function remove(params) {
    assertSortPair(params);

    const table = database[params.tableName];
    if (!table) return;

    const pkTok = `${params.keyName}=${String(params.keyValue)}`;
    const skTok = params.sortKeyName
      ? `${params.sortKeyName}=${String(params.sortKeyValue)}`
      : NO_SORT;

    if (!table[pkTok]) return;
    delete table[pkTok][skTok];
    if (Object.keys(table[pkTok]).length === 0) delete table[pkTok];
  }

  /**
   * BatchWrite of deletes and puts.
   *
   * DeleteRequests:
   * - supply keyName/keyValue (+ optional sortKeyName/sortKeyValue) directly
   *
   * PutRequests:
   * - each entry supplies { record, keyName, sortKeyName? }
   * - record must contain record[keyName] (+ record[sortKeyName] if provided)
   *
   * Immutability:
   * - stores deep clones for puts
   * @param {import('../base.js').BatchWriteParams} params -
   * @returns {import('../base.js').BatchWriteReturn} -
   */
  async function batchWrite(params) {
    const table = ensureTable(params.tableName);

    const deleteRequests = Array.isArray(params.deleteRequests)
      ? params.deleteRequests
      : [];
    const putRequests = Array.isArray(params.putRequests)
      ? params.putRequests
      : [];

    // deletes
    deleteRequests.forEach((del) => {
      assertSortPair(del);

      const pkTok = `${del.keyName}=${String(del.keyValue)}`;
      const skTok = del.sortKeyName
        ? `${del.sortKeyName}=${String(del.sortKeyValue)}`
        : NO_SORT;

      if (!table[pkTok]) return;
      delete table[pkTok][skTok];
      if (Object.keys(table[pkTok]).length === 0) delete table[pkTok];
    });

    // puts
    putRequests
      .filter((v) => v !== undefined && v !== null)
      .forEach((putReq) => {
        const record = putReq.record;
        if (!record || typeof record !== 'object')
          throw new Error('putRequests[].record is required');
        if (typeof putReq.keyName !== 'string' || putReq.keyName.length === 0) {
          throw new Error('putRequests[].keyName is required');
        }

        const pkTok = pkTokenFromRecord(putReq.keyName, record);
        const skTok = skTokenFromRecord(putReq.sortKeyName, record);

        if (!table[pkTok]) table[pkTok] = {};
        table[pkTok][skTok] = deepClone(record);
      });
  }

  /**
   * Persist the in-memory DB to disk (atomic replace).
   * @returns {import('../base.js').CloseReturn} -
   */
  async function close() {
    const data = JSON.stringify(database);
    await fsp.mkdir(dbDir, { recursive: true });

    const tmp = join(
      dbDir,
      `.tmp-${basename(dbFilePath)}-${process.pid}-${Date.now()}-${createId()}`,
    );

    const handle = await fsp.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fsp.rename(tmp, dbFilePath);

    try {
      const dh = await fsp.open(dbDir, 'r');
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
    } catch {
      /* ignore */
    }
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
