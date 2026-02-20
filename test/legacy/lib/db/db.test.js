import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const VANILLA_ADAPTER_IMPORT = '../../../lambdas/lib/db/adapters/vanilla.js';
const DYNAMO_ADAPTER_IMPORT = '../../../lambdas/lib/db/adapters/dynamodb.js';
const LMDB_ADAPTER_IMPORT = '../../../lambdas/lib/db/adapters/lmdb.js';
const PATHS_IMPORT = '../../../lambdas/lib/paths.js';

/**
 * Condition constructors (typed + untyped filters)
 */
const C = {
  pkEq: (propertyName, propertyValue) => ({
    keyType: 'PRIMARY',
    conditionType: 'EQUALS',
    propertyName,
    propertyValue,
  }),
  skEq: (propertyName, propertyValue) => ({
    keyType: 'SORT',
    conditionType: 'EQUALS',
    propertyName,
    propertyValue,
  }),
  skBegins: (propertyName, propertyValue) => ({
    keyType: 'SORT',
    conditionType: 'BEGINS_WITH',
    propertyName,
    propertyValue,
  }),
  eq: (propertyName, propertyValue) => ({
    conditionType: 'EQUALS',
    propertyName,
    propertyValue,
  }),
  begins: (propertyName, propertyValue) => ({
    conditionType: 'BEGINS_WITH',
    propertyName,
    propertyValue,
  }),
};

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'db-contract-'));
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function stableKeyString(keyObj) {
  const entries = Object.entries(keyObj).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(Object.fromEntries(entries));
}

/**
 * Evaluate Dynamo-like (KeyConditionExpression / FilterExpression) against an item.
 * Supports:
 * - "#a = :v"
 * - "begins_with(#a, :v)"
 */
function evalConditionExpression(expr, names, values, item) {
  if (!expr) return true;
  const parts = expr.split(/\s+AND\s+/);

  for (const part of parts) {
    const begins = part.match(/^begins_with\((#[^,]+),\s*(:[^)]+)\)$/);
    if (begins) {
      const nameTok = begins[1];
      const valTok = begins[2];
      const attr = names[nameTok];
      const prefix = values[valTok];
      const v = item?.[attr];
      if (typeof v !== 'string' || !v.startsWith(String(prefix))) return false;
      continue;
    }

    const eq = part.match(/^(#[^\s]+)\s*=\s*(:[^\s]+)$/);
    if (eq) {
      const nameTok = eq[1];
      const valTok = eq[2];
      const attr = names[nameTok];
      const expected = values[valTok];
      if (item?.[attr] !== expected) return false;
      continue;
    }

    throw new Error(`Unsupported condition expression part: ${part}`);
  }

  return true;
}

/**
 * Apply Dynamo-like UpdateExpression of the form:
 * "SET #a.#b = :v0, #c = :v1"
 */
function applyUpdateExpression(updateExpr, names, values, item) {
  const m = updateExpr.match(/^SET\s+(.+)$/);
  if (!m) throw new Error(`Unsupported UpdateExpression: ${updateExpr}`);
  const assignments = m[1].split(/\s*,\s*/);

  for (const a of assignments) {
    const mm = a.match(/^(.+?)\s*=\s*(:[^\s]+)$/);
    if (!mm) throw new Error(`Unsupported assignment: ${a}`);

    const pathExpr = mm[1].trim();
    const valTok = mm[2];
    const newValue = values[valTok];

    const segTokens = pathExpr.split('.');
    const segs = segTokens.map((t) => names[t] ?? t);

    let cur = item;
    for (let i = 0; i < segs.length - 1; i++) {
      const s = segs[i];
      if (cur[s] == null || typeof cur[s] !== 'object') cur[s] = {};
      cur = cur[s];
    }
    cur[segs[segs.length - 1]] = newValue;
  }
}

function createIdLike() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

/**
 * In-memory fake docClient for the Dynamo adapter (so tests run without AWS).
 * Implements: put, get, delete, update, query, batchWrite, destroy.
 *
 * Important: honors BOTH KeyConditionExpression and FilterExpression.
 */
function createFakeDocClient() {
  /** @type {Map<string, Map<string, any>>} */
  const tables = new Map();

  function tableMap(tableName) {
    if (!tables.has(tableName)) tables.set(tableName, new Map());
    return tables.get(tableName);
  }

  return {
    destroy: () => {},

    put: async ({ TableName, Item }) => {
      const t = tableMap(TableName);
      t.set(`__put__:${stableKeyString(Item)}`, clone(Item));
      t.set(`__item__:${createIdLike()}`, clone(Item));
    },

    get: async ({ TableName, Key }) => {
      const t = tableMap(TableName);
      for (const [k, v] of t.entries()) {
        if (!k.startsWith('__item__:')) continue;
        let ok = true;
        for (const [kk, kv] of Object.entries(Key)) {
          if (v?.[kk] !== kv) {
            ok = false;
            break;
          }
        }
        if (ok) return { Item: clone(v) };
      }
      return { Item: undefined };
    },

    delete: async ({ TableName, Key }) => {
      const t = tableMap(TableName);
      for (const [k, v] of t.entries()) {
        if (!k.startsWith('__item__:')) continue;
        let ok = true;
        for (const [kk, kv] of Object.entries(Key)) {
          if (v?.[kk] !== kv) {
            ok = false;
            break;
          }
        }
        if (ok) {
          t.delete(k);
          return {};
        }
      }
      return {};
    },

    update: async ({
      TableName,
      Key,
      UpdateExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ConditionExpression,
    }) => {
      const t = tableMap(TableName);

      let foundKey = null;
      let item = null;
      for (const [k, v] of t.entries()) {
        if (!k.startsWith('__item__:')) continue;
        let ok = true;
        for (const [kk, kv] of Object.entries(Key)) {
          if (v?.[kk] !== kv) {
            ok = false;
            break;
          }
        }
        if (ok) {
          foundKey = k;
          item = v;
          break;
        }
      }
      if (!item) return {};

      if (ConditionExpression) {
        const ok = evalConditionExpression(
          ConditionExpression,
          ExpressionAttributeNames || {},
          ExpressionAttributeValues || {},
          item,
        );
        if (!ok) {
          const err = new Error('ConditionalCheckFailedException');
          err.name = 'ConditionalCheckFailedException';
          throw err;
        }
      }

      // Copy-on-write: never mutate the stored object identity in-place.
      // This mirrors DynamoDB’s behavior (SDK returns unmarshalled copies) and
      // makes immutability tests meaningful.
      const next = clone(item);

      applyUpdateExpression(
        UpdateExpression,
        ExpressionAttributeNames || {},
        ExpressionAttributeValues || {},
        next,
      );
      t.set(foundKey, next);
      return {};
    },

    query: async ({
      TableName,
      KeyConditionExpression,
      FilterExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ExclusiveStartKey,
    }) => {
      if (ExclusiveStartKey) return { Items: [], LastEvaluatedKey: undefined };

      const t = tableMap(TableName);
      const items = [];
      for (const [k, v] of t.entries()) {
        if (!k.startsWith('__item__:')) continue;

        const okKey = evalConditionExpression(
          KeyConditionExpression,
          ExpressionAttributeNames || {},
          ExpressionAttributeValues || {},
          v,
        );
        if (!okKey) continue;

        const okFilter = evalConditionExpression(
          FilterExpression,
          ExpressionAttributeNames || {},
          ExpressionAttributeValues || {},
          v,
        );
        if (!okFilter) continue;

        items.push(clone(v));
      }

      return { Items: items, LastEvaluatedKey: undefined };
    },

    batchWrite: async ({ RequestItems }) => {
      for (const [tableName, reqs] of Object.entries(RequestItems)) {
        const t = tableMap(tableName);
        for (const r of reqs) {
          if (r.PutRequest) {
            t.set(`__item__:${createIdLike()}`, clone(r.PutRequest.Item));
          } else if (r.DeleteRequest) {
            const Key = r.DeleteRequest.Key;
            for (const [k, v] of t.entries()) {
              if (!k.startsWith('__item__:')) continue;
              let ok = true;
              for (const [kk, kv] of Object.entries(Key)) {
                if (v?.[kk] !== kv) {
                  ok = false;
                  break;
                }
              }
              if (ok) {
                t.delete(k);
                break;
              }
            }
          }
        }
      }
      return { UnprocessedItems: {} };
    },
  };
}

/**
 * Local test-side query validation that matches the new contract:
 * - PRIMARY required and must be EQUALS
 * - at most one SORT, may be EQUALS or BEGINS_WITH
 * - any number of filters (no keyType) allowed
 */
function assertTightQuery(params) {
  const typed = params.keyConditions.filter(
    (c) => c.keyType === 'PRIMARY' || c.keyType === 'SORT',
  );
  const filters = params.keyConditions.filter((c) => c.keyType === undefined);

  const pk = typed.filter((c) => c.keyType === 'PRIMARY');
  const sk = typed.filter((c) => c.keyType === 'SORT');

  if (pk.length !== 1)
    throw new Error('query requires exactly one PRIMARY key condition');
  if (pk[0].conditionType !== 'EQUALS')
    throw new Error('PRIMARY key condition must use EQUALS');
  if (sk.length > 1)
    throw new Error('query supports at most one SORT key condition');
  if (
    sk.length === 1 &&
    sk[0].conditionType !== 'EQUALS' &&
    sk[0].conditionType !== 'BEGINS_WITH'
  ) {
    throw new Error('SORT key condition must use EQUALS or BEGINS_WITH');
  }

  // sanity on filters
  for (const f of filters) {
    if (f.conditionType !== 'EQUALS' && f.conditionType !== 'BEGINS_WITH') {
      throw new Error(`invalid condition type: ${f.conditionType}`);
    }
  }
}

/**
 * Shared “contract tests” runner.
 * @param {{ name: string, create: () => Promise<any> | any, cleanup?: () => Promise<void> | void }} adapter
 */
function runContract(adapter) {
  describe(`${adapter.name} adapter contract`, () => {
    /** @type {any} */
    let db;

    beforeEach(async () => {
      db = await adapter.create();
    });

    afterEach(async () => {
      if (db?.close) await db.close();
      if (adapter.cleanup) await adapter.cleanup();
    });

    test('put/get roundtrip (pk+sk)', async () => {
      const tableName = 't1';
      const keyName = 'pk';
      const sortKeyName = 'sk';
      const record = { pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } };

      await db.put({ tableName, keyName, sortKeyName, record });

      const got = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
        consistentRead: true,
      });

      expect(got).toEqual(record);
    });

    test('immutability: put stores a clone (mutating input after put does not affect stored record)', async () => {
      const tableName = 'immut-put';
      const keyName = 'pk';
      const sortKeyName = 'sk';

      const record = { pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } };
      await db.put({ tableName, keyName, sortKeyName, record });

      // mutate the original object after put
      record.foo = 'MUTATED';
      record.nested.x = 999;

      const got = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(got).toEqual({ pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } });
    });

    test('immutability: get returns a clone (mutating returned object does not affect stored record)', async () => {
      const tableName = 'immut-get';
      const keyName = 'pk';
      const sortKeyName = 'sk';

      await db.put({
        tableName,
        keyName,
        sortKeyName,
        record: { pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } },
      });

      const got1 = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(got1).toEqual({ pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } });

      // mutate the returned value
      got1.foo = 'MUTATED';
      got1.nested.x = 999;

      const got2 = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(got2).toEqual({ pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } });
    });

    test('immutability: query returns clones (mutating results does not affect stored records)', async () => {
      const tableName = 'immut-query';
      const keyName = 'pk';
      const sortKeyName = 'sk';

      await db.put({
        tableName,
        keyName,
        sortKeyName,
        record: { pk: 'A', sk: '1', foo: 'bar', nested: { x: 1 } },
      });
      await db.put({
        tableName,
        keyName,
        sortKeyName,
        record: { pk: 'A', sk: '2', foo: 'baz', nested: { x: 2 } },
      });

      const rows1 = await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          {
            conditionType: 'EQUALS',
            keyType: 'PRIMARY',
            propertyName: 'pk',
            propertyValue: 'A',
          },
        ],
      });

      // sanity
      expect(rows1.map((r) => r.sk).sort()).toEqual(['1', '2']);

      // mutate returned objects
      rows1[0].foo = 'MUTATED';
      rows1[0].nested.x = 999;

      const rows2 = await db.query({
        tableName,
        consistentRead: true,
        keyConditions: [
          {
            conditionType: 'EQUALS',
            keyType: 'PRIMARY',
            propertyName: 'pk',
            propertyValue: 'A',
          },
        ],
      });

      // verify stored values unaffected
      const bySk = new Map(rows2.map((r) => [r.sk, r]));
      expect(bySk.get('1')).toEqual({
        pk: 'A',
        sk: '1',
        foo: 'bar',
        nested: { x: 1 },
      });
      expect(bySk.get('2')).toEqual({
        pk: 'A',
        sk: '2',
        foo: 'baz',
        nested: { x: 2 },
      });
    });

    test('put throws when record is missing partition key attribute', async () => {
      await expect(
        db.put({ tableName: 't', keyName: 'pk', record: { sk: '1' } }),
      ).rejects.toThrow(/record\.pk/i);
    });

    test('put throws when sortKeyName is provided but record is missing sort key attribute', async () => {
      await expect(
        db.put({
          tableName: 't',
          keyName: 'pk',
          sortKeyName: 'sk',
          record: { pk: 'A' },
        }),
      ).rejects.toThrow(/record\.sk/i);
    });

    test('get throws when sortKeyName and sortKeyValue are not provided together', async () => {
      await expect(
        db.get({
          tableName: 't',
          keyName: 'pk',
          keyValue: 'A',
          sortKeyName: 'sk',
        }),
      ).rejects.toThrow(/sortKeyName and sortKeyValue/i);
    });

    test('remove is idempotent', async () => {
      const tableName = 't';
      const keyName = 'pk';
      const sortKeyName = 'sk';
      const record = { pk: 'A', sk: '1', foo: 'bar' };

      await db.put({ tableName, keyName, sortKeyName, record });
      await db.remove({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      await db.remove({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });

      const got = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(got).toBeUndefined();
    });

    test('update applies explicit nested updates', async () => {
      const tableName = 't';
      const keyName = 'pk';
      const sortKeyName = 'sk';
      const record = { pk: 'A', sk: '1', nested: { x: 1 } };

      await db.put({ tableName, keyName, sortKeyName, record });

      await db.update({
        tableName,
        record: {},
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
        updates: [{ property: ['nested', 'x'], propertyValue: 2 }],
      });

      const got = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(got.nested.x).toBe(2);
    });

    test('update derives updates from params.record (excluding key fields)', async () => {
      const tableName = 't';
      const keyName = 'pk';
      const sortKeyName = 'sk';

      await db.put({
        tableName,
        keyName,
        sortKeyName,
        record: { pk: 'A', sk: '1', foo: 'old' },
      });

      await db.update({
        tableName,
        record: { pk: 'A', sk: '1', foo: 'new' },
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });

      const got = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(got.foo).toBe('new');
    });

    test('update with failing conditions throws ConditionalCheckFailedException and does not change the item', async () => {
      const tableName = 't';
      const keyName = 'pk';
      const sortKeyName = 'sk';

      await db.put({
        tableName,
        keyName,
        sortKeyName,
        record: { pk: 'A', sk: '1', foo: 'ok' },
      });

      const before = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      const beforeClone = clone(before);

      await expect(
        db.update({
          tableName,
          record: {},
          keyName,
          keyValue: 'A',
          sortKeyName,
          sortKeyValue: '1',
          conditions: [C.eq('foo', 'nope')],
          updates: [{ property: ['foo'], propertyValue: 'changed' }],
        }),
      ).rejects.toThrow(/ConditionalCheckFailedException/i);

      const after = await db.get({
        tableName,
        keyName,
        keyValue: 'A',
        sortKeyName,
        sortKeyValue: '1',
      });
      expect(after).toEqual(beforeClone);
    });

    test('batchWrite supports puts and deletes', async () => {
      const tableName = 't';
      await db.batchWrite({
        tableName,
        deleteRequests: [],
        putRequests: [
          {
            keyName: 'pk',
            sortKeyName: 'sk',
            record: { pk: 'A', sk: '1', v: 1 },
          },
          {
            keyName: 'pk',
            sortKeyName: 'sk',
            record: { pk: 'A', sk: '2', v: 2 },
          },
          { keyName: 'pk', record: { pk: 'B', v: 3 } },
        ],
      });

      expect(
        await db.get({
          tableName,
          keyName: 'pk',
          keyValue: 'A',
          sortKeyName: 'sk',
          sortKeyValue: '1',
        }),
      ).toEqual({ pk: 'A', sk: '1', v: 1 });
      expect(
        await db.get({
          tableName,
          keyName: 'pk',
          keyValue: 'A',
          sortKeyName: 'sk',
          sortKeyValue: '2',
        }),
      ).toEqual({ pk: 'A', sk: '2', v: 2 });
      expect(await db.get({ tableName, keyName: 'pk', keyValue: 'B' })).toEqual(
        { pk: 'B', v: 3 },
      );

      await db.batchWrite({
        tableName,
        deleteRequests: [
          {
            keyName: 'pk',
            keyValue: 'A',
            sortKeyName: 'sk',
            sortKeyValue: '1',
          },
        ],
        putRequests: [],
      });

      expect(
        await db.get({
          tableName,
          keyName: 'pk',
          keyValue: 'A',
          sortKeyName: 'sk',
          sortKeyValue: '1',
        }),
      ).toBeUndefined();
    });

    test('batchWrite putRequests validates key fields exist on record', async () => {
      await expect(
        db.batchWrite({
          tableName: 't',
          deleteRequests: [],
          putRequests: [
            { keyName: 'pk', sortKeyName: 'sk', record: { pk: 'A' } },
          ],
        }),
      ).rejects.toThrow(/record\.sk/i);
    });

    test('query returns items (PRIMARY pk equals)', async () => {
      const tableName = 'tq';
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: '1', v: 1, status: 'ok' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: '2', v: 2, status: 'ok' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'B', sk: '1', v: 3, status: 'ok' },
      });

      const params = {
        tableName,
        consistentRead: true,
        keyConditions: [C.pkEq('pk', 'A')],
      };
      assertTightQuery(params);

      const rows = await db.query(params);
      expect(rows.map((r) => r.v).sort()).toEqual([1, 2]);
    });

    test('query supports PRIMARY pk equals + SORT sk begins_with', async () => {
      const tableName = 'tq2';
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: 'ab1', v: 1, status: 'ok' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: 'ab2', v: 2, status: 'ok' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: 'zz1', v: 3, status: 'ok' },
      });

      const params = {
        tableName,
        consistentRead: true,
        keyConditions: [C.pkEq('pk', 'A'), C.skBegins('sk', 'ab')],
      };
      assertTightQuery(params);

      const rows = await db.query(params);
      expect(rows.map((r) => r.v).sort()).toEqual([1, 2]);
    });

    test('query supports non-key filters (no keyType): pk + filter equals', async () => {
      const tableName = 'tq3';
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: '1', v: 1, status: 'ok' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: '2', v: 2, status: 'nope' },
      });

      const params = {
        tableName,
        consistentRead: true,
        keyConditions: [C.pkEq('pk', 'A'), C.eq('status', 'ok')],
      };
      assertTightQuery(params);

      const rows = await db.query(params);
      expect(rows.map((r) => r.v)).toEqual([1]);
    });

    test('query supports non-key filters: pk + sk begins_with + filter begins_with', async () => {
      const tableName = 'tq4';
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: 'ab1', v: 1, name: 'foo-1' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: 'ab2', v: 2, name: 'bar-2' },
      });
      await db.put({
        tableName,
        keyName: 'pk',
        sortKeyName: 'sk',
        record: { pk: 'A', sk: 'ab3', v: 3, name: 'foo-3' },
      });

      const params = {
        tableName,
        consistentRead: true,
        keyConditions: [
          C.pkEq('pk', 'A'),
          C.skBegins('sk', 'ab'),
          C.begins('name', 'foo'),
        ],
      };
      assertTightQuery(params);

      const rows = await db.query(params);
      expect(rows.map((r) => r.v).sort()).toEqual([1, 3]);
    });

    test('query rejects missing PRIMARY', async () => {
      const params = {
        tableName: 't',
        consistentRead: true,
        keyConditions: [C.eq('status', 'ok')], // filter-only, but contract requires PRIMARY
      };
      expect(() => assertTightQuery(params)).toThrow(/PRIMARY/i);
      await expect(db.query(params)).rejects.toThrow(/PRIMARY/i);
    });

    test('query rejects SORT without PRIMARY', async () => {
      const params = {
        tableName: 't',
        consistentRead: true,
        keyConditions: [C.skBegins('sk', 'a')],
      };
      await expect(db.query(params)).rejects.toThrow(/PRIMARY/i);
    });

    test('query rejects PRIMARY with BEGINS_WITH', async () => {
      const params = {
        tableName: 't',
        consistentRead: true,
        keyConditions: [
          {
            keyType: 'PRIMARY',
            conditionType: 'BEGINS_WITH',
            propertyName: 'pk',
            propertyValue: 'A',
          },
        ],
      };
      await expect(db.query(params)).rejects.toThrow(/PRIMARY.*EQUALS/i);
    });

    test('close does not throw', async () => {
      await expect(db.close()).resolves.toBeUndefined();
    });
  });
}

async function createLMDBDB(tmpDataDir) {
  jest.resetModules();
  await jest.unstable_mockModule(PATHS_IMPORT, () => ({
    default: { data: tmpDataDir },
  }));
  const mod = await import(LMDB_ADAPTER_IMPORT);
  return mod.default();
}

async function createVanillaDB(tmpDataDir) {
  jest.resetModules();
  await jest.unstable_mockModule(PATHS_IMPORT, () => ({
    default: { data: tmpDataDir },
  }));
  const mod = await import(VANILLA_ADAPTER_IMPORT);
  return mod.default();
}

async function createDynamoDBMocked() {
  jest.resetModules();
  await jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocument: { from: () => createFakeDocClient() },
  }));
  const mod = await import(DYNAMO_ADAPTER_IMPORT);
  return mod.default({ region: 'us-east-1' });
}

describe('DBClient contract suite', () => {
  let tmpDataDir;

  beforeEach(() => {
    tmpDataDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDataDir, { recursive: true, force: true });
  });

  test('smoke: vanilla persistence path is isolated', async () => {
    expect(existsSync(tmpDataDir)).toBe(true);
  });

  test('load adapters', async () => {
    const vanilla = await createVanillaDB(tmpDataDir);
    await vanilla.close();

    const dynamo = await createDynamoDBMocked();
    await dynamo.close();

    const lmdb = await createLMDBDB(tmpDataDir);
    await lmdb.close();
  });

  runContract({ name: 'vanilla', create: () => createVanillaDB(tmpDataDir) });
  runContract({ name: 'lmdb', create: () => createLMDBDB(tmpDataDir) });
  runContract({
    name: 'dynamo (mocked)',
    create: () => createDynamoDBMocked(),
  });
});
