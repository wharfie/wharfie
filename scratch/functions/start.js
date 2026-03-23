import { promises as fsp } from 'node:fs';

import duckdb from '@duckdb/node-api';
import lmdb from 'lmdb';

import dep from '../lib/dep.js';

/**
 * @param {unknown} error - error.
 * @returns {string} - Result.
 */
function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * @param {string} packageName - packageName.
 * @returns {Promise<{ status: 'ok', module: any } | { status: 'skipped', reason: string }>} - Result.
 */
async function loadOptionalModule(packageName) {
  try {
    return {
      status: 'ok',
      module: await import(packageName),
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: formatError(error),
    };
  }
}

/**
 * @param {string} lmdbPath - lmdbPath.
 * @returns {Promise<{ ok: true, value: string, path: string }>} - Result.
 */
async function smokeLmdb(lmdbPath) {
  await fsp.mkdir(lmdbPath, { recursive: true });
  const db = lmdb.open({ path: lmdbPath });

  try {
    await db.put('greeting', { someText: 'Hello, World!' });
    return {
      ok: true,
      value: db.get('greeting').someText,
      path: lmdbPath,
    };
  } finally {
    const closeResult = db.close?.();
    if (closeResult && typeof closeResult.then === 'function') {
      await closeResult;
    }
  }
}

/**
 * @returns {Promise<{ ok: true, version: string, count: number, sum: number }>} - Result.
 */
async function smokeDuckDb() {
  const { DuckDBInstance } = duckdb;
  const instance = await DuckDBInstance.create(':memory:');
  const conn = await instance.connect();

  try {
    await conn.run('create table t(i int, s varchar)');
    await conn.run("insert into t values (1,'a'),(2,'b'),(3,'c')");

    const [countRow] = (
      await conn.runAndReadAll('select cast(count(*) as int) as cnt from t')
    ).getRowObjects();
    const [sumRow] = (
      await conn.runAndReadAll(
        'from range(5) select cast(sum(range) as int) as total',
      )
    ).getRowObjects();

    return {
      ok: true,
      version: duckdb.version(),
      count: countRow.cnt,
      sum: sumRow.total,
    };
  } finally {
    conn.closeSync();
    instance.closeSync();
  }
}

/**
 * @returns {Promise<{ status: 'ok', bytes: number } | { status: 'skipped', reason: string }>} - Result.
 */
async function smokeSharp() {
  const sharpModule = await loadOptionalModule('sharp');
  if (sharpModule.status === 'skipped') {
    return sharpModule;
  }

  try {
    const sharp = sharpModule.module.default ?? sharpModule.module;
    const buffer = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    return {
      status: 'ok',
      bytes: buffer.length,
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: formatError(error),
    };
  }
}

/**
 * @returns {Promise<{ status: 'ok', opened: string } | { status: 'skipped', reason: string }>} - Result.
 */
async function smokeSodiumNative() {
  const sodiumModule = await loadOptionalModule('sodium-native');
  if (sodiumModule.status === 'skipped') {
    return sodiumModule;
  }

  try {
    const sodium = sodiumModule.module.default ?? sodiumModule.module;
    const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
    const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
    const message = Buffer.from('hello');
    const boxed = Buffer.alloc(
      message.length + sodium.crypto_secretbox_MACBYTES,
    );
    const opened = Buffer.alloc(message.length);

    sodium.randombytes_buf(key);
    sodium.randombytes_buf(nonce);
    sodium.crypto_secretbox_easy(boxed, message, nonce, key);
    const ok = sodium.crypto_secretbox_open_easy(opened, boxed, nonce, key);
    if (!ok) {
      throw new Error('crypto_secretbox_open_easy returned false');
    }

    return {
      status: 'ok',
      opened: opened.toString('utf8'),
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: formatError(error),
    };
  }
}

/**
 * @returns {Promise<{ status: 'ok', deviceCount: number } | { status: 'skipped', reason: string }>} - Result.
 */
async function smokeUsb() {
  const usbModule = await loadOptionalModule('usb');
  if (usbModule.status === 'skipped') {
    return usbModule;
  }

  try {
    const usbApi =
      usbModule.module.usb ?? usbModule.module.default ?? usbModule.module;
    if (typeof usbApi.getDeviceList !== 'function') {
      throw new Error('usb.getDeviceList is unavailable');
    }

    return {
      status: 'ok',
      deviceCount: usbApi.getDeviceList().length,
    };
  } catch (error) {
    return {
      status: 'skipped',
      reason: formatError(error),
    };
  }
}

/**
 * @param {{ lmdbPath?: string } | undefined} event - event.
 * @param {{ requestId?: string | null } | undefined} context - context.
 * @returns {Promise<{
 *   dependency: string,
 *   requestId: string | null,
 *   lmdb: { ok: true, value: string, path: string },
 *   duckdb: { ok: true, version: string, count: number, sum: number },
 *   sharp: { status: 'ok', bytes: number } | { status: 'skipped', reason: string },
 *   sodiumNative: { status: 'ok', opened: string } | { status: 'skipped', reason: string },
 *   usb: { status: 'ok', deviceCount: number } | { status: 'skipped', reason: string },
 * }>} - Result.
 */
const start = async (event, context) => {
  const lmdbPath = event?.lmdbPath ?? 'test-db';

  return {
    dependency: dep(),
    requestId: context?.requestId ?? null,
    lmdb: await smokeLmdb(lmdbPath),
    duckdb: await smokeDuckDb(),
    sharp: await smokeSharp(),
    sodiumNative: await smokeSodiumNative(),
    usb: await smokeUsb(),
  };
};

export { start };
