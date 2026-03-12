import dep from '../lib/dep.js';
// import sharp from 'sharp';
import duckdb from '@duckdb/node-api';
import { open } from 'lmdb';
// import { createRequire } from 'node:module';

// const require = createRequire(import.meta.url);

// /**
//  * @returns {any | null} - The optional usb package when available.
//  */
// function loadUsbPackage() {
//   try {
//     return require('usb');
//   } catch {
//     return null;
//   }
// }

// /**
//  * @returns {any | null} - The optional sodium-native package when available.
//  */
// function loadSodiumPackage() {
//   try {
//     return require('sodium-native');
//   } catch {
//     return null;
//   }
// }

/**
 * @param {unknown} error - Unknown error value.
 * @returns {string} - A printable error message.
 */
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const usb = null; // loadUsbPackage();
const sodium = null; // loadSodiumPackage();

/**
 * @param {Record<string, any> | undefined} event - Scratch invocation payload.
 * @param {unknown} context - Scratch invocation context.
 * @returns {Promise<void>} - Completes after the smoke test finishes.
 */
const start = async (event, context) => {
  const depLabel = `INTERNAL DEPENDENCY LOADING TIMER`;
  console.time(depLabel);
  console.timeEnd(depLabel);

  const label = `INTERNAL SMOKE TEST RUN TIMER`;
  console.time(label);
  console.log('params', [event, context]);
  dep();

  const ITER = (event && event.iterations) || 5000000;
  const ARRAY_SIZE = (event && event.arraySize) || 50000;

  console.log('CPU benchmark config:', { ITER, ARRAY_SIZE });

  // --- PURE JS CPU LOAD #1: numeric loop -------------------------
  {
    let acc = 0;
    for (let i = 0; i < ITER; i++) {
      // some reasonably expensive math
      const x = i * 0.000001;
      acc += Math.sin(x) * Math.cos(x * 1.7) + Math.log1p(x + 1);
    }
    // prevent V8 from dead-code eliminating the loop
    console.log('accumulator:', acc);
  }
  // --- LMDB (yours) ---
  const ROOT_DB = open({ path: 'test-db' });
  await ROOT_DB.put('greeting', { someText: 'Hello, World!' });
  console.log(ROOT_DB.get('greeting').someText);

  // --- sharp (yours) ---
  //   const redDotPng = await sharp({
  //     create: {
  //       width: 64,
  //       height: 64,
  //       channels: 3,
  //       background: { r: 255, g: 0, b: 0 },
  //     },
  //   })
  //     .png()
  //     .toBuffer();
  //   console.log('sharp png size', redDotPng.length);

  // // --- usb (libusb native binding) ---
  // try {
  //   if (!usb?.getDeviceList) {
  //     throw new Error('usb module unavailable');
  //   }
  //   const devices = usb.getDeviceList();
  //   console.log(
  //     'usb devices:',
  //     devices.map((/** @type {any} */ d) => {
  //       const vd = d.deviceDescriptor;
  //       return `${vd.idVendor.toString(16)}:${vd.idProduct.toString(16)}`;
  //     }),
  //   );
  // } catch (error) {
  //   console.warn('usb test skipped:', getErrorMessage(error));
  // }
  try {
    const { DuckDBInstance } = duckdb;

    /**
     * @param {unknown} v - DuckDB scalar value.
     * @returns {number} - Normalized numeric value.
     */
    const toSmallNumber = (v) => {
      if (v === null || v === undefined) return 0;
      if (typeof v === 'bigint') return Number(v);
      if (typeof v === 'number') return v;
      return Number(v);
    }; // safe for small smoke-test values
    console.log('DuckDB version:', duckdb.version());

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    // 1) trivial query sanity
    {
      const [row] = (
        await conn.runAndReadAll(
          "select 1 as one, 2+2 as two, 'ok'::varchar as status",
        )
      ).getRowObjects();
      if (row.one !== 1 || row.two !== 4 || row.status !== 'ok') {
        throw new Error('basic SELECT sanity check failed');
      }
    }

    // 2) DDL/DML + COUNT(*)
    {
      await conn.run('create table t(i int, s varchar)');
      await conn.run("insert into t values (1,'a'),(2,'b'),(3,'c')");
      const [row] = (
        await conn.runAndReadAll('select count(*) as cnt from t')
      ).getRowObjects();
      const cnt = toSmallNumber(row.cnt); // handles 3n vs 3
      if (cnt !== 3) throw new Error('table row count mismatch');
    }

    // 3) range() + SUM(...)
    {
      // Option A: cast in SQL so JS sees a number
      const [row] = (
        await conn.runAndReadAll(
          'from range(5) select cast(sum(range) as int) as s',
        )
      ).getRowObjects();
      if (row.s !== 10) throw new Error('range(5) sum mismatch');
    }

    conn.closeSync();
    instance.closeSync();
    console.log('✅ DuckDB smoke test passed');
  } catch (err) {
    console.error('❌ DuckDB smoke test failed:', err);
  }

  // --- OPTIONAL: sodium-native tight loop (CPU in C, not JS) -----
  // comment out if you want *pure* JS only
  // try {
  //   if (
  //     !sodium?.crypto_secretbox_KEYBYTES ||
  //     !sodium?.crypto_secretbox_NONCEBYTES ||
  //     !sodium?.crypto_secretbox_MACBYTES ||
  //     typeof sodium.randombytes_buf !== 'function' ||
  //     typeof sodium.crypto_secretbox_easy !== 'function' ||
  //     typeof sodium.crypto_secretbox_open_easy !== 'function'
  //   ) {
  //     throw new Error('sodium-native module unavailable');
  //   }

  //   const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
  //   const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
  //   sodium.randombytes_buf(key);
  //   sodium.randombytes_buf(nonce);

  //   const msg = Buffer.from('hello');
  //   const boxed = Buffer.alloc(msg.length + sodium.crypto_secretbox_MACBYTES);
  //   const opened = Buffer.alloc(msg.length);

  //   const N = (event && event.sodiumLoops) || 500_000;
  //   let okCount = 0;

  //   for (let i = 0; i < N; i++) {
  //     sodium.crypto_secretbox_easy(boxed, msg, nonce, key);
  //     const ok = sodium.crypto_secretbox_open_easy(opened, boxed, nonce, key);
  //     if (ok) okCount++;
  //   }
  //   console.log('sodium loops done, okCount:', okCount);
  // } catch (error) {
  //   console.warn('sodium test skipped:', getErrorMessage(error));
  // }

  console.timeEnd(label);
};

export { start };
