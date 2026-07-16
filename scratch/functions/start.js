import { promises as fsp } from 'node:fs';

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
 * @param {string} packageName - packageName.
 * @param {{ status: 'ok', [key: string]: any } | { status: 'skipped', reason: string }} probe - probe.
 * @returns {{ packageName: string, status: 'OK', [key: string]: any } | { packageName: string, status: 'SKIPPED', reason: string }} - Result.
 */
function toNativeOptionalProbe(packageName, probe) {
  if (probe.status === 'ok') {
    return {
      ...probe,
      packageName,
      status: 'OK',
    };
  }

  return {
    packageName,
    status: 'SKIPPED',
    reason: probe.reason,
  };
}

/**
 * @param {{ lmdbPath?: string, who?: string } | undefined} event - event.
 * @param {{ requestId?: string | null } | undefined} context - context.
 * @returns {Promise<{
 *   ok: true,
 *   dependency: string,
 *   requestId: string | null,
 *   runId: string,
 *   who: string,
 *   lmdb: { ok: true, value: string, path: string, record: { who: string, message: string, runId: string } },
 *   sharp: { status: 'ok', bytes: number } | { status: 'skipped', reason: string },
 *   sodiumNative: { status: 'ok', opened: string } | { status: 'skipped', reason: string },
 *   usb: { status: 'ok', deviceCount: number } | { status: 'skipped', reason: string },
 *   native: {
 *     lmdbRecord: { who: string, message: string, runId: string },
 *     optional: {
 *       sharp: { packageName: string, status: 'OK', bytes: number } | { packageName: string, status: 'SKIPPED', reason: string },
 *       sodiumNative: { packageName: string, status: 'OK', opened: string } | { packageName: string, status: 'SKIPPED', reason: string },
 *       usb: { packageName: string, status: 'OK', deviceCount: number } | { packageName: string, status: 'SKIPPED', reason: string },
 *     },
 *   },
 * }>} - Result.
 */
const start = async (event, context) => {
  const lmdbPath = event?.lmdbPath ?? 'test-db';
  const who =
    typeof event?.who === 'string' && event.who.trim()
      ? event.who.trim()
      : 'world';
  const runId = context?.requestId ?? `run-${process.pid}`;
  const nativeRecord = {
    who,
    message: `hello ${who}`,
    runId,
  };

  const lmdb = await smokeLmdb(lmdbPath, nativeRecord);
  const sharp = await smokeSharp();
  const sodiumNative = await smokeSodiumNative();
  const usb = await smokeUsb();

  return {
    ok: true,
    dependency: dep(),
    requestId: context?.requestId ?? null,
    runId,
    who,
    lmdb,
    sharp,
    sodiumNative,
    usb,
    native: {
      lmdbRecord: lmdb.record,
      optional: {
        sharp: toNativeOptionalProbe('sharp', sharp),
        sodiumNative: toNativeOptionalProbe('sodium-native', sodiumNative),
        usb: toNativeOptionalProbe('usb', usb),
      },
    },
  };
};

export { start };
