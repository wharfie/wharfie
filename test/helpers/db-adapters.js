// @ts-nocheck -- intentionally loose in-memory AWS SDK test double.
import { jest } from '@jest/globals';

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createAwsProviderModule } from './aws-provider.js';

/**
 * @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient
 */

const VANILLA_ADAPTER_IMPORT = '../../src/core/lib/db/adapters/vanilla.js';
const LMDB_ADAPTER_IMPORT = '../../src/core/lib/db/adapters/lmdb.js';
const DYNAMO_ADAPTER_IMPORT = '../../src/core/lib/db/adapters/dynamodb.js';

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
  item?.[property] === value;

// DynamoDB String sort keys use UTF-8 byte order, never locale collation.
const compareDynamoStrings = (left, right) =>
  Buffer.compare(
    Buffer.from(String(left), 'utf8'),
    Buffer.from(String(right), 'utf8'),
  );

const evalExpressions = ({
  item,
  expression,
  expressionAttributeNames,
  expressionAttributeValues,
}) => {
  if (!expression) return true;
  const tokens = expression.split(' AND ');
  for (const token of tokens) {
    if (token.includes('attribute_not_exists')) {
      const [, nameToken] =
        token.match(/attribute_not_exists\(([^)]+)\)/) || [];
      const key = expressionAttributeNames[nameToken.trim()];
      if (item && Object.prototype.hasOwnProperty.call(item, key)) return false;
      continue;
    }

    if (token.includes('attribute_exists')) {
      const [, nameToken] = token.match(/attribute_exists\(([^)]+)\)/) || [];
      const key = expressionAttributeNames[nameToken.trim()];
      if (!item || !Object.prototype.hasOwnProperty.call(item, key))
        return false;
      continue;
    }

    if (token.includes('begins_with')) {
      const [, lhs, rhs] =
        token.match(/begins_with\(([^,]+),\s*([^)]+)\)/) || [];
      const key = expressionAttributeNames[lhs.trim()];
      const prefix = expressionAttributeValues[rhs.trim()];
      if (
        typeof item?.[key] !== 'string' ||
        typeof prefix !== 'string' ||
        !item[key].startsWith(prefix)
      )
        return false;
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

export const createFakeDocClient = ({ tableSchemas = {} } = {}) => {
  const state = {
    tables: {},
    schemas: Object.fromEntries(
      Object.entries(tableSchemas).map(([tableName, keyNames]) => [
        tableName,
        [...keyNames],
      ]),
    ),
  };
  const calls = { batchWrite: 0, transactWrite: 0 };
  const queryCalls = [];
  const scriptedQueryResponses = [];
  let nextTransactionError;

  const ensureTable = (name) => {
    if (!state.tables[name]) state.tables[name] = {};
    return state.tables[name];
  };

  const findItem = (table, Key) =>
    Object.values(table).find((v) =>
      Object.keys(Key).every((k) => matchesDynamoCondition(v, k, Key[k])),
    );

  const learnSchema = (tableName, Key) => {
    const names = Object.keys(Key);
    if (names.length > 0) state.schemas[tableName] = names;
    return names;
  };

  const inferSchema = (tableName, Item) => {
    if (state.schemas[tableName]) return state.schemas[tableName];
    const knownSchemas = [
      ['pk', 'sk'],
      ['resource_id', 'sort_key'],
      ['run_id', 'sort_key'],
      ['deployment', 'resource_key'],
      ['id'],
    ];
    const names = knownSchemas.find((candidate) =>
      candidate.every((name) => Item[name] !== undefined),
    ) || [Object.keys(Item)[0]];
    state.schemas[tableName] = names;
    return names;
  };

  const learnSchemaFromQuery = (
    tableName,
    KeyConditionExpression,
    ExpressionAttributeNames,
  ) => {
    if (state.schemas[tableName]) return state.schemas[tableName];
    const tokens = Object.keys(ExpressionAttributeNames || {})
      .filter((token) => /^#k\d+$/.test(token))
      .sort((left, right) => Number(left.slice(2)) - Number(right.slice(2)));
    const names = tokens
      .filter((token) => String(KeyConditionExpression).includes(token))
      .map((token) => ExpressionAttributeNames[token]);
    if (names.length > 0) state.schemas[tableName] = names;
    return state.schemas[tableName] || [];
  };

  const keyForItem = (tableName, Item) => {
    const names = inferSchema(tableName, Item);
    return Object.fromEntries(names.map((name) => [name, Item[name]]));
  };

  const putInto = (tables, TableName, Item) => {
    if (!tables[TableName]) tables[TableName] = {};
    const Key = keyForItem(TableName, Item);
    tables[TableName][stableKeyString(Key)] = clone(Item);
  };

  const deleteFrom = (tables, TableName, Key) => {
    if (!tables[TableName]) tables[TableName] = {};
    learnSchema(TableName, Key);
    for (const [k, value] of Object.entries(tables[TableName])) {
      if (
        Object.keys(Key).every((property) =>
          matchesDynamoCondition(value, property, Key[property]),
        )
      ) {
        delete tables[TableName][k];
      }
    }
  };

  const applyUpdateExpression = ({
    item,
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
  }) => {
    const [, setPart] = UpdateExpression.split('SET ');
    const assigns = setPart.split(',').map((s) => s.trim());

    for (const assign of assigns) {
      const [lhs, rhs] = assign.split('=').map((s) => s.trim());
      const path = lhs
        .split('.')
        .map((part) => ExpressionAttributeNames[part])
        .filter(Boolean);
      const value = ExpressionAttributeValues[rhs];

      let cur = item;
      for (let index = 0; index < path.length - 1; index += 1) {
        const key = path[index];
        if (
          !Object.prototype.hasOwnProperty.call(cur, key) ||
          cur[key] === null ||
          typeof cur[key] !== 'object' ||
          Array.isArray(cur[key])
        ) {
          throw new Error(`Invalid update path: ${path.join('.')}`);
        }
        cur = cur[key];
      }
      Object.defineProperty(cur, path[path.length - 1], {
        configurable: true,
        enumerable: true,
        value: clone(value),
        writable: true,
      });
    }
  };

  return {
    __state: state,
    __calls: calls,
    __queryCalls: queryCalls,
    __failNextTransaction(error) {
      nextTransactionError = error;
    },
    __queueQueryResponses(responses) {
      if (!Array.isArray(responses)) {
        throw new TypeError('scripted query responses must be an array');
      }
      scriptedQueryResponses.push(...responses.map(clone));
    },

    async put({ TableName, Item }) {
      ensureTable(TableName);
      putInto(state.tables, TableName, Item);
      return {};
    },

    async get({ TableName, Key }) {
      const table = ensureTable(TableName);
      learnSchema(TableName, Key);
      const item = findItem(table, Key);
      return item ? { Item: clone(item) } : {};
    },

    async delete({ TableName, Key }) {
      ensureTable(TableName);
      deleteFrom(state.tables, TableName, Key);
      return {};
    },

    async query(request) {
      queryCalls.push(clone(request));
      if (scriptedQueryResponses.length > 0) {
        return scriptedQueryResponses.shift();
      }
      const {
        TableName,
        KeyConditionExpression,
        FilterExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
        ExclusiveStartKey,
        Limit,
        ScanIndexForward = true,
      } = request;
      const table = ensureTable(TableName);
      const keyNames =
        state.schemas[TableName] ||
        learnSchemaFromQuery(
          TableName,
          KeyConditionExpression,
          ExpressionAttributeNames,
        );
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
        )
        .sort((left, right) => {
          for (const key of keyNames) {
            const comparison = compareDynamoStrings(left[key], right[key]);
            if (comparison !== 0) return comparison;
          }
          return compareDynamoStrings(
            stableKeyString(left),
            stableKeyString(right),
          );
        });

      if (ScanIndexForward === false) items.reverse();

      let start = 0;
      if (ExclusiveStartKey) {
        if (
          Object.keys(ExclusiveStartKey).length !== keyNames.length ||
          !keyNames.every((key) =>
            Object.prototype.hasOwnProperty.call(ExclusiveStartKey, key),
          )
        ) {
          throw new Error(
            'ExclusiveStartKey must contain the complete table key schema',
          );
        }
        const index = items.findIndex((item) =>
          Object.keys(ExclusiveStartKey).every((key) =>
            matchesDynamoCondition(item, key, ExclusiveStartKey[key]),
          ),
        );
        if (index < 0) {
          throw new Error('ExclusiveStartKey does not identify a query item');
        }
        start = index + 1;
      }
      const paged =
        Number.isSafeInteger(Limit) && Limit > 0
          ? items.slice(start, start + Limit)
          : items.slice(start);
      const hasMore = start + paged.length < items.length;

      return {
        Items: clone(paged),
        ...(hasMore && paged.length > 0
          ? { LastEvaluatedKey: keyForItem(TableName, paged[paged.length - 1]) }
          : {}),
      };
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
      learnSchema(TableName, Key);
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

      applyUpdateExpression({
        item,
        UpdateExpression,
        ExpressionAttributeNames,
        ExpressionAttributeValues,
      });

      return {};
    },

    async batchWrite({ RequestItems }) {
      calls.batchWrite += 1;
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

    async transactWrite({ TransactItems }) {
      calls.transactWrite += 1;
      if (nextTransactionError) {
        const error = nextTransactionError;
        nextTransactionError = undefined;
        throw error;
      }
      const before = clone(state.tables);

      // DynamoDB evaluates transaction conditions against the state before any
      // transaction item is applied.
      for (const [
        transactionIndex,
        transactionItem,
      ] of TransactItems.entries()) {
        const request =
          transactionItem.ConditionCheck ||
          transactionItem.Put ||
          transactionItem.Update ||
          transactionItem.Delete;
        const TableName = request.TableName;
        const table = before[TableName] || {};
        const Key = request.Item
          ? keyForItem(TableName, request.Item)
          : request.Key;
        if (Key) learnSchema(TableName, Key);
        const item = Key ? findItem(table, Key) : undefined;
        const ok = evalExpressions({
          item,
          expression: request.ConditionExpression,
          expressionAttributeNames: request.ExpressionAttributeNames || {},
          expressionAttributeValues: request.ExpressionAttributeValues || {},
        });
        if (!ok) {
          const error = new Error(
            'TransactionCanceledException: ConditionalCheckFailed',
          );
          error.name = 'TransactionCanceledException';
          error.CancellationReasons = TransactItems.map((_, index) => ({
            Code:
              index === transactionIndex ? 'ConditionalCheckFailed' : 'None',
          }));
          throw error;
        }
      }

      const next = clone(before);
      for (const transactionItem of TransactItems) {
        if (transactionItem.ConditionCheck) continue;
        if (transactionItem.Put) {
          const { TableName, Item } = transactionItem.Put;
          putInto(next, TableName, Item);
          continue;
        }
        if (transactionItem.Delete) {
          const { TableName, Key } = transactionItem.Delete;
          deleteFrom(next, TableName, Key);
          continue;
        }
        if (transactionItem.Update) {
          const {
            TableName,
            Key,
            UpdateExpression,
            ExpressionAttributeNames,
            ExpressionAttributeValues,
          } = transactionItem.Update;
          if (!next[TableName]) next[TableName] = {};
          learnSchema(TableName, Key);
          let item = findItem(next[TableName], Key);
          if (!item) {
            item = clone(Key);
            next[TableName][stableKeyString(Key)] = item;
          }
          applyUpdateExpression({
            item,
            UpdateExpression,
            ExpressionAttributeNames,
            ExpressionAttributeValues,
          });
        }
      }

      state.tables = next;
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

export async function createMockedDynamoDB(options = {}) {
  jest.resetModules();
  const fakeDocClient = createFakeDocClient(options);

  const DynamoDBDocument = Object.assign(jest.fn(), {
    from: () => fakeDocClient,
  });
  jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocument,
  }));

  const [
    { default: createDynamoDB },
    { loadAwsProviderBindings, registerAwsProviderModule },
  ] = await Promise.all([
    import(DYNAMO_ADAPTER_IMPORT),
    import('../../src/core/runtime/aws-provider-module.js'),
  ]);
  registerAwsProviderModule(
    createAwsProviderModule({ libDynamoDB: { DynamoDBDocument } }),
  );
  const db = createDynamoDB(
    { region: 'us-east-1' },
    await loadAwsProviderBindings(),
  );
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
