import { jest } from '@jest/globals';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * @typedef {import('../../lambdas/lib/db/base.js').DBClient} DBClient
 */

const PATHS_IMPORT = '../../lambdas/lib/paths.js';
const VANILLA_ADAPTER_IMPORT = '../../lambdas/lib/db/adapters/vanilla.js';
const LMDB_ADAPTER_IMPORT = '../../lambdas/lib/db/adapters/lmdb.js';
const DYNAMO_ADAPTER_IMPORT = '../../lambdas/lib/db/adapters/dynamodb.js';

const makeTmpDir = () => mkdtempSync(join(tmpdir(), 'wharfie-db-contract-'));
const rmTmpDir = (dir) => rmSync(dir, { recursive: true, force: true });

const stableKeyString = (obj) => {
  if (obj === null || obj === undefined) return String(obj);
  if (Array.isArray(obj)) return `[${obj.map(stableKeyString).join(',')}]`;
  if (typeof obj === 'object') {
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${k}:${stableKeyString(obj[k])}`).join(',')}}`;
  }
  return String(obj);
};

const clone = (obj) => JSON.parse(JSON.stringify(obj));

const matchesDynamoCondition = (item, property, value) =>
  stableKeyString(item?.[property]) === stableKeyString(value);

const evalExpressions = ({
  item,
  expression,
  expressionAttributeNames,
  expressionAttributeValues,
}) => {
  if (!expression) return true;
  const tokens = expression.split(' AND ');
  for (const token of tokens) {
    if (token.includes('begins_with')) {
      const [, lhs, rhs] =
        token.match(/begins_with\(([^,]+),\s*([^)]+)\)/) || [];
      const key = expressionAttributeNames[lhs.trim()];
      const prefix = expressionAttributeValues[rhs.trim()];
      if (!String(item?.[key] || '').startsWith(String(prefix))) return false;
      continue;
    }

    if (token.includes(' BETWEEN ')) {
      const [left, rest] = token.split(' BETWEEN ');
      const [start, end] = rest.split(' AND ');
      const leftName = expressionAttributeNames[left.trim()];
      const startVal = expressionAttributeValues[start.trim()];
      const endVal = expressionAttributeValues[end.trim()];
      const v = item?.[leftName];
      if (!(v >= startVal && v <= endVal)) return false;
      continue;
    }

    if (token.includes('=')) {
      const [lhs, rhs] = token.split('=').map((s) => s.trim());
      const key = expressionAttributeNames[lhs];
      const val = expressionAttributeValues[rhs];
      if (!matchesDynamoCondition(item, key, val)) return false;
      continue;
    }
  }
  return true;
};

export const createFakeDocClient = () => {
  const state = { tables: {} };

  const ensureTable = (name) => {
    if (!state.tables[name]) state.tables[name] = {};
    return state.tables[name];
  };

  const findItem = (table, Key) =>
    Object.values(table).find((v) =>
      Object.keys(Key).every((k) => matchesDynamoCondition(v, k, Key[k])),
    );

  return {
    __state: state,

    async put({ TableName, Item }) {
      const table = ensureTable(TableName);
      const id = `${Math.random()}-${Date.now()}`;
      table[id] = { ...clone(Item), __put__: stableKeyString(Item) };
      return {};
    },

    async get({ TableName, Key }) {
      const table = ensureTable(TableName);
      const item = findItem(table, Key);
      return item ? { Item: clone(item) } : {};
    },

    async delete({ TableName, Key }) {
      const table = ensureTable(TableName);
      for (const [k, v] of Object.entries(table)) {
        if (
          Object.keys(Key).every((p) => matchesDynamoCondition(v, p, Key[p]))
        ) {
          delete table[k];
        }
      }
      return {};
    },

    async query({
      TableName,
      KeyConditionExpression,
      FilterExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    }) {
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
    },

    async update({
      TableName,
      Key,
      ConditionExpression,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      UpdateExpression,
    }) {
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

      const [, setPart] = UpdateExpression.split('SET ');
      const assigns = setPart.split(',').map((s) => s.trim());

      for (const assign of assigns) {
        const [lhs, rhs] = assign.split('=').map((s) => s.trim());
        const path = lhs
          .split('.')
          .map((p) => ExpressionAttributeNames[p])
          .filter(Boolean);

        const value = ExpressionAttributeValues[rhs];

        let cur = item;
        for (let i = 0; i < path.length - 1; i += 1) {
          const k = path[i];
          if (!cur[k]) cur[k] = {};
          cur = cur[k];
        }
        cur[path[path.length - 1]] = clone(value);
      }

      return {};
    },

    async batchWrite({ RequestItems }) {
      for (const [TableName, actions] of Object.entries(RequestItems)) {
        for (const action of actions) {
          if (action.PutRequest) {
            await this.put({ TableName, Item: action.PutRequest.Item });
          } else if (action.DeleteRequest) {
            await this.delete({ TableName, Key: action.DeleteRequest.Key });
          }
        }
      }
      return {};
    },

    destroy() {},
  };
};

export async function createVanillaDB(tmpDataDir) {
  jest.resetModules();
  const { default: createVanilla } = await import(VANILLA_ADAPTER_IMPORT);
  return createVanilla({ path: tmpDataDir });
}

export async function createLMDBDB(tmpDataDir) {
  jest.resetModules();
  const { default: createLMDB } = await import(LMDB_ADAPTER_IMPORT);
  return createLMDB({ path: tmpDataDir });
}

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
