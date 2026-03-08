import { jest } from '@jest/globals';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @typedef {import('../../lambdas/lib/db/base.js').DBClient} DBClient
 */

/**
 * @typedef {Record<string, any>} FakeRecord
 */

/**
 * @typedef {Record<string, FakeRecord>} FakeTable
 */

/**
 * @typedef {Record<string, FakeTable>} FakeTables
 */

/**
 * @typedef {Record<string, string>} ExpressionAttributeNames
 */

/**
 * @typedef {Record<string, any>} ExpressionAttributeValues
 */

/**
 * @typedef EvalExpressionsParams
 * @property {FakeRecord | undefined} item - item.
 * @property {string | undefined} expression - expression.
 * @property {ExpressionAttributeNames | undefined} expressionAttributeNames - expressionAttributeNames.
 * @property {ExpressionAttributeValues | undefined} expressionAttributeValues - expressionAttributeValues.
 */

/**
 * @typedef FakePutParams
 * @property {string} TableName - TableName.
 * @property {FakeRecord} Item - Item.
 */

/**
 * @typedef FakeKeyedParams
 * @property {string} TableName - TableName.
 * @property {Record<string, any>} Key - Key.
 */

/**
 * @typedef FakeQueryParams
 * @property {string} TableName - TableName.
 * @property {string} [KeyConditionExpression] - KeyConditionExpression.
 * @property {string} [FilterExpression] - FilterExpression.
 * @property {ExpressionAttributeNames} [ExpressionAttributeNames] - ExpressionAttributeNames.
 * @property {ExpressionAttributeValues} [ExpressionAttributeValues] - ExpressionAttributeValues.
 */

/**
 * @typedef FakeUpdateParams
 * @property {string} TableName - TableName.
 * @property {Record<string, any>} Key - Key.
 * @property {string} [ConditionExpression] - ConditionExpression.
 * @property {ExpressionAttributeNames} [ExpressionAttributeNames] - ExpressionAttributeNames.
 * @property {ExpressionAttributeValues} [ExpressionAttributeValues] - ExpressionAttributeValues.
 * @property {string} UpdateExpression - UpdateExpression.
 */

/**
 * @typedef FakeBatchWriteAction
 * @property {{ Item: FakeRecord }} [PutRequest] - PutRequest.
 * @property {{ Key: Record<string, any> }} [DeleteRequest] - DeleteRequest.
 */

/**
 * @typedef FakeBatchWriteParams
 * @property {Record<string, FakeBatchWriteAction[]>} RequestItems - RequestItems.
 */

/**
 * @typedef FakeDocClient
 * @property {{ tables: FakeTables }} __state - __state.
 * @property {(params: FakePutParams) => Promise<Record<string, never>>} put - put.
 * @property {(params: FakeKeyedParams) => Promise<{ Item?: FakeRecord }>} get - get.
 * @property {(params: FakeKeyedParams) => Promise<Record<string, never>>} delete - delete.
 * @property {(params: FakeQueryParams) => Promise<{ Items: FakeRecord[] }>} query - query.
 * @property {(params: FakeUpdateParams) => Promise<Record<string, never>>} update - update.
 * @property {(params: FakeBatchWriteParams) => Promise<Record<string, never>>} batchWrite - batchWrite.
 * @property {() => void} destroy - destroy.
 */

const PATHS_IMPORT = '../../lambdas/lib/paths.js';
const VANILLA_ADAPTER_IMPORT = '../../lambdas/lib/db/adapters/vanilla.js';
const LMDB_ADAPTER_IMPORT = '../../lambdas/lib/db/adapters/lmdb.js';
const DYNAMO_ADAPTER_IMPORT = '../../lambdas/lib/db/adapters/dynamodb.js';

const makeTmpDir = () => mkdtempSync(join(tmpdir(), 'wharfie-db-contract-'));

/**
 * @param {string} dir - dir.
 */
const rmTmpDir = (dir) => rmSync(dir, { recursive: true, force: true });

/**
 * @param {any} obj - obj.
 * @returns {string} - Result.
 */
const stableKeyString = (obj) => {
  if (obj === null || obj === undefined) return String(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableKeyString).join(',')}]`;
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${k}:${stableKeyString(obj[k])}`).join(',')}}`;
  }
  return String(obj);
};

/**
 * @template T
 * @param {T} obj - obj.
 * @returns {T} - Result.
 */
const clone = (obj) => JSON.parse(JSON.stringify(obj));

/**
 * @param {FakeRecord | undefined} item - item.
 * @param {string} property - property.
 * @param {any} value - value.
 * @returns {boolean} - Result.
 */
const matchesDynamoCondition = (item, property, value) =>
  stableKeyString(item?.[property]) === stableKeyString(value);

/**
 * @param {EvalExpressionsParams} params - params.
 * @returns {boolean} - Result.
 */
const evalExpressions = ({
  item,
  expression,
  expressionAttributeNames,
  expressionAttributeValues,
}) => {
  if (!expression) return true;
  const names =
    expressionAttributeNames || /** @type {ExpressionAttributeNames} */ ({});
  const values =
    expressionAttributeValues || /** @type {ExpressionAttributeValues} */ ({});
  const tokens = expression.split(' AND ');
  for (const token of tokens) {
    if (token.includes('begins_with')) {
      const [, lhs, rhs] =
        token.match(/begins_with\(([^,]+),\s*([^)]+)\)/) || [];
      if (!lhs || !rhs) return false;
      const key = names[lhs.trim()];
      const prefix = values[rhs.trim()];
      if (!String(item?.[key] || '').startsWith(String(prefix))) return false;
      continue;
    }

    if (token.includes(' BETWEEN ')) {
      const [left, rest] = token.split(' BETWEEN ');
      if (!left || !rest) return false;
      const [start, end] = rest.split(' AND ');
      if (!start || !end) return false;
      const leftName = names[left.trim()];
      const startVal = values[start.trim()];
      const endVal = values[end.trim()];
      const v = item?.[leftName];
      if (!(v >= startVal && v <= endVal)) return false;
      continue;
    }

    if (token.includes('=')) {
      const [lhs, rhs] = token.split('=').map((s) => s.trim());
      const key = names[lhs];
      const val = values[rhs];
      if (!matchesDynamoCondition(item, key, val)) return false;
      continue;
    }
  }
  return true;
};

/**
 * @returns {FakeDocClient} - Result.
 */
export const createFakeDocClient = () => {
  /** @type {{ tables: FakeTables }} */
  const state = { tables: {} };

  /**
   * @param {string} name - name.
   * @returns {FakeTable} - Result.
   */
  const ensureTable = (name) => {
    if (!state.tables[name]) state.tables[name] = {};
    return state.tables[name];
  };

  /**
   * @param {FakeTable} table - table.
   * @param {Record<string, any>} Key - Key.
   * @returns {FakeRecord | undefined} - Result.
   */
  const findItem = (table, Key) =>
    Object.values(table).find((v) =>
      Object.keys(Key).every((k) => matchesDynamoCondition(v, k, Key[k])),
    );

  /**
   * @param {FakePutParams} params - params.
   * @returns {Promise<Record<string, never>>} - Result.
   */
  const put = async ({ TableName, Item }) => {
    const table = ensureTable(TableName);
    const id = `${Math.random()}-${Date.now()}`;
    table[id] = { ...clone(Item), __put__: stableKeyString(Item) };
    return {};
  };

  /**
   * @param {FakeKeyedParams} params - params.
   * @returns {Promise<{ Item?: FakeRecord }>} - Result.
   */
  const get = async ({ TableName, Key }) => {
    const table = ensureTable(TableName);
    const item = findItem(table, Key);
    return item ? { Item: clone(item) } : {};
  };

  /**
   * @param {FakeKeyedParams} params - params.
   * @returns {Promise<Record<string, never>>} - Result.
   */
  const deleteItem = async ({ TableName, Key }) => {
    const table = ensureTable(TableName);
    for (const [k, v] of Object.entries(table)) {
      if (Object.keys(Key).every((p) => matchesDynamoCondition(v, p, Key[p]))) {
        delete table[k];
      }
    }
    return {};
  };

  /**
   * @param {FakeQueryParams} params - params.
   * @returns {Promise<{ Items: FakeRecord[] }>} - Result.
   */
  const query = async ({
    TableName,
    KeyConditionExpression,
    FilterExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  }) => {
    const table = ensureTable(TableName);
    const items = Object.values(table)
      .filter((item) =>
        evalExpressions({
          item,
          expression: KeyConditionExpression,
          expressionAttributeNames: ExpressionAttributeNames,
          expressionAttributeValues: ExpressionAttributeValues,
        }),
      )
      .filter((item) =>
        evalExpressions({
          item,
          expression: FilterExpression,
          expressionAttributeNames: ExpressionAttributeNames,
          expressionAttributeValues: ExpressionAttributeValues,
        }),
      );

    return { Items: clone(items) };
  };

  /**
   * @param {FakeUpdateParams} params - params.
   * @returns {Promise<Record<string, never>>} - Result.
   */
  const update = async ({
    TableName,
    Key,
    ConditionExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    UpdateExpression,
  }) => {
    const table = ensureTable(TableName);
    const item = findItem(table, Key);
    if (!item) return {};

    const ok = evalExpressions({
      item,
      expression: ConditionExpression,
      expressionAttributeNames: ExpressionAttributeNames,
      expressionAttributeValues: ExpressionAttributeValues,
    });

    if (!ok) {
      const err = new Error('ConditionalCheckFailedException');
      err.name = 'ConditionalCheckFailedException';
      throw err;
    }

    const [, setPart = ''] = UpdateExpression.split('SET ');
    const assigns = setPart.split(',').map((s) => s.trim());
    const names =
      ExpressionAttributeNames || /** @type {ExpressionAttributeNames} */ ({});
    const values =
      ExpressionAttributeValues ||
      /** @type {ExpressionAttributeValues} */ ({});

    for (const assign of assigns) {
      const [lhs, rhs] = assign.split('=').map((s) => s.trim());
      if (!lhs || !rhs) continue;

      const path = lhs
        .split('.')
        .map((p) => names[p])
        .filter(Boolean);

      const value = values[rhs];

      let cur = item;
      for (let i = 0; i < path.length - 1; i += 1) {
        const k = path[i];
        if (!cur[k]) cur[k] = {};
        cur = cur[k];
      }
      cur[path[path.length - 1]] = clone(value);
    }

    return {};
  };

  /**
   * @param {FakeBatchWriteParams} params - params.
   * @returns {Promise<Record<string, never>>} - Result.
   */
  const batchWrite = async ({ RequestItems }) => {
    for (const [TableName, actions] of Object.entries(RequestItems)) {
      for (const action of actions) {
        if (action.PutRequest) {
          await put({ TableName, Item: action.PutRequest.Item });
        } else if (action.DeleteRequest) {
          await deleteItem({ TableName, Key: action.DeleteRequest.Key });
        }
      }
    }
    return {};
  };

  return {
    __state: state,
    put,
    get,
    delete: deleteItem,
    query,
    update,
    batchWrite,

    destroy() {},
  };
};

/**
 * @param {string} tmpDataDir - tmpDataDir.
 * @returns {Promise<DBClient>} - Result.
 */
export async function createVanillaDB(tmpDataDir) {
  jest.resetModules();
  const { default: createVanilla } = await import(VANILLA_ADAPTER_IMPORT);
  return createVanilla({ path: tmpDataDir });
}

/**
 * @param {string} tmpDataDir - tmpDataDir.
 * @returns {Promise<DBClient>} - Result.
 */
export async function createLMDBDB(tmpDataDir) {
  jest.resetModules();
  const { default: createLMDB } = await import(LMDB_ADAPTER_IMPORT);
  return createLMDB({ path: tmpDataDir });
}

/**
 * @returns {Promise<{ db: DBClient, fakeDocClient: FakeDocClient }>} - Result.
 */
export async function createMockedDynamoDB() {
  jest.resetModules();
  const fakeDocClient = createFakeDocClient();

  jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocument: { from: () => fakeDocClient },
  }));

  const { default: createDynamoDB } = await import(DYNAMO_ADAPTER_IMPORT);
  const db = createDynamoDB({ region: 'us-east-1' });
  return { db, fakeDocClient };
}

/**
 * Adapter contract matrix.
 *
 * @returns {Array<{name: string, create: () => Promise<{db: DBClient, cleanup: () => Promise<void>}>}>}
 */
export function getAdapterMatrix() {
  return [
    {
      name: 'dynamodb',
      async create() {
        const { db } = await createMockedDynamoDB();
        return { db, cleanup: async () => db.close() };
      },
    },
    {
      name: 'vanilla',
      async create() {
        const dir = makeTmpDir();
        const db = await createVanillaDB(dir);
        return {
          db,
          cleanup: async () => {
            await db.close();
            rmTmpDir(dir);
          },
        };
      },
    },
    {
      name: 'lmdb',
      async create() {
        const dir = makeTmpDir();
        const db = await createLMDBDB(dir);
        return {
          db,
          cleanup: async () => {
            await db.close();
            rmTmpDir(dir);
          },
        };
      },
    },
  ];
}
