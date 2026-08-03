import { promises as fsp } from 'node:fs';

import lmdb from 'lmdb';

import dep from './dep.js';

/**
 * @param {string} lmdbPath - lmdbPath.
 * @param {{ who: string, message: string, runId: string }} record - record.
 * @returns {Promise<{ ok: true, value: string, path: string, record: { who: string, message: string, runId: string } }>} - Result.
 */
async function smokeLmdb(lmdbPath, record) {
  await fsp.mkdir(lmdbPath, { recursive: true });
  const db = lmdb.open({ path: lmdbPath });

  try {
    await db.put('greeting', { someText: 'Hello, World!' });
    await db.put('native-record', record);
    return {
      ok: true,
      value: db.get('greeting').someText,
      path: lmdbPath,
      record: db.get('native-record'),
    };
  } finally {
    const closeResult = db.close?.();
    if (closeResult && typeof closeResult.then === 'function') {
      await closeResult;
    }
  }
}

/**
 * @param {{ lmdbPath?: string, who?: string } | undefined} input - Activity input.
 * @param {{ caller?: { metadata?: { requestId?: string | null } }, invocation?: { invocationId?: string } } | undefined} runtime - Activity runtime.
 * @returns {Promise<{
 *   ok: true,
 *   dependency: string,
 *   requestId: string | null,
 *   runId: string,
 *   who: string,
 *   lmdb: { ok: true, value: string, path: string, record: { who: string, message: string, runId: string } },
 *   native: {
 *     lmdbRecord: { who: string, message: string, runId: string },
 *   },
 * }>} - Result.
 */
const start = async (input, runtime) => {
  const lmdbPath = input?.lmdbPath ?? 'test-db';
  const who =
    typeof input?.who === 'string' && input.who.trim()
      ? input.who.trim()
      : 'world';
  const requestId = runtime?.caller?.metadata?.requestId ?? null;
  const runId = runtime?.invocation?.invocationId ?? `run-${process.pid}`;
  const nativeRecord = {
    who,
    message: `hello ${who}`,
    runId,
  };

  const lmdb = await smokeLmdb(lmdbPath, nativeRecord);

  return {
    ok: true,
    dependency: dep(),
    requestId,
    runId,
    who,
    lmdb,
    native: {
      lmdbRecord: lmdb.record,
    },
  };
};

export { start };
