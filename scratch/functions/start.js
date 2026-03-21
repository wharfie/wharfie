import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { buffer } from 'node:stream/consumers';

import duckdb from '@duckdb/node-api';
import lmdb from 'lmdb';

import dep from '../lib/dep.js';

/**
 * @param {unknown} value - value.
 * @param {number} fallback - fallback.
 * @returns {number} - Result.
 */
function toPositiveInteger(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return fallback;
  }
  return Math.trunc(numeric);
}

/**
 * @param {string} value - value.
 * @returns {string} - Result.
 */
function sanitizeName(value) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
}

/**
 * @param {string | { Body?: unknown } | undefined} objectResult - objectResult.
 * @returns {Promise<string>} - Result.
 */
async function readObjectBody(objectResult) {
  if (typeof objectResult === 'string') {
    return objectResult;
  }
  if (objectResult?.Body) {
    return (await buffer(objectResult.Body)).toString('utf8');
  }
  return '';
}

/**
 * @param {unknown} value - value.
 * @returns {number} - Result.
 */
function toSmallNumber(value) {
  return typeof value === 'bigint' ? Number(value) : Number(value);
}

/**
 * Supported kitchen-sink function entrypoint.
 *
 * This intentionally exercises:
 * - injected Wharfie runtime resources
 * - an internal local dependency
 * - installed native dependencies already present in the repo test/dev tree
 *
 * The enclosing Function metadata also declares additional heavyweight native
 * externals (`sharp`, `sodium-native`, `usb`) so packaging coverage can target
 * them without forcing every local/test invocation to load optional modules.
 *
 * @param {{ who?: string, iterations?: number, runId?: string }} [event] - Event payload.
 * @param {{ resources?: any }} [context] - Invocation context.
 * @returns {Promise<{
 *   ok: boolean,
 *   who: string,
 *   runId: string,
 *   resourceKinds: string[],
 *   resources: {
 *     dbRecord: { id: string, who: string, message: string, runId: string },
 *     queueBody: string | undefined,
 *     objectBody: string,
 *   },
 *   native: {
 *     lmdbRecord: { who: string, message: string, runId: string },
 *     duckdb: { version: string | null, rangeSum: number },
 *   },
 *   benchmark: {
 *     iterations: number,
 *     accumulator: number,
 *   },
 * }>} - Result.
 */
export async function start(event = {}, context = {}) {
  const who = event.who || 'kitchen-sink';
  const runId = event.runId || randomUUID();
  const iterations = toPositiveInteger(event.iterations, 1000);
  const message = `hello ${who}`;
  const { db, queue, objectStorage } = context.resources || {};

  if (!db || !queue || !objectStorage) {
    throw new Error('expected context.resources.{db, queue, objectStorage}');
  }

  dep();

  let accumulator = 0;
  for (let i = 0; i < iterations; i++) {
    const x = i * 0.000001;
    accumulator += Math.sin(x) * Math.cos(x * 1.7) + Math.log1p(x + 1);
  }

  const tableName = 'kitchen_sink_runs';
  const dbRecordId = `greeting-${runId}`;
  await db.put({
    tableName,
    keyName: 'id',
    record: { id: dbRecordId, who, message, runId },
  });
  const dbRecord = await db.get({
    tableName,
    keyName: 'id',
    keyValue: dbRecordId,
  });

  const queueName = `kitchen-sink-${sanitizeName(runId)}`;
  const queueMessage = JSON.stringify({ hello: who, runId });
  await queue.createQueue({ QueueName: queueName });
  await queue.sendMessage({
    QueueUrl: queueName,
    MessageBody: queueMessage,
  });
  const received = await queue.receiveMessage({
    QueueUrl: queueName,
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 0,
    VisibilityTimeout: 1,
  });

  const bucketName = `kitchen-sink-${sanitizeName(runId)}`;
  const objectKey = 'hello.txt';
  await objectStorage.createBucket({ Bucket: bucketName });
  await objectStorage.putObject({
    Bucket: bucketName,
    Key: objectKey,
    Body: Buffer.from(message),
  });
  const objectResult = await objectStorage.getObject({
    Bucket: bucketName,
    Key: objectKey,
  });
  const objectBody = await readObjectBody(objectResult);

  const nativeDbPath = path.join(
    os.tmpdir(),
    'wharfie-examples',
    'kitchen-sink-native',
    sanitizeName(runId),
  );
  const nativeDb = lmdb.open({ path: nativeDbPath });
  /** @type {{ who: string, message: string, runId: string }} */
  let lmdbRecord;
  try {
    await nativeDb.put('greeting', { who, message, runId });
    lmdbRecord = nativeDb.get('greeting');
  } finally {
    if (typeof nativeDb.close === 'function') {
      nativeDb.close();
    }
  }

  const duckdbVersion =
    typeof duckdb.version === 'function' ? duckdb.version() : null;
  const { DuckDBInstance } = duckdb;
  const duckdbInstance = await DuckDBInstance.create(':memory:');
  const duckdbConnection = await duckdbInstance.connect();
  /** @type {number} */
  let rangeSum;
  try {
    const [row] = (
      await duckdbConnection.runAndReadAll(
        'from range(5) select cast(sum(range) as int) as sum',
      )
    ).getRowObjects();
    rangeSum = toSmallNumber(row.sum);
  } finally {
    duckdbConnection.closeSync();
    duckdbInstance.closeSync();
  }

  return {
    ok: true,
    who,
    runId,
    resourceKinds: Object.keys(context.resources || {}).sort(),
    resources: {
      dbRecord,
      queueBody: received?.Messages?.[0]?.Body,
      objectBody,
    },
    native: {
      lmdbRecord,
      duckdb: {
        version: duckdbVersion,
        rangeSum,
      },
    },
    benchmark: {
      iterations,
      accumulator,
    },
  };
}
