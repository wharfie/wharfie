import dep from '../lib/dep.js';
// import sharp from 'sharp';
import duckdb from '@duckdb/node-api';
import lmdb from 'lmdb';
// import usb from 'usb';
// import sodium from 'sodium-native';

async function unawaitedAsync() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('test draining');
}

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
  const ROOT_DB = lmdb.open({ path: 'test-db' });
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
  try {
    const devices = usb.getDeviceList();
    console.log(
      'usb devices:',
      devices.map((d) => {
        const vd = d.deviceDescriptor;
        return `${vd.idVendor.toString(16)}:${vd.idProduct.toString(16)}`;
      })
    );
  } catch (e) {
    console.warn('usb test skipped:', e && e.message);
  }
  try {
    const { DuckDBInstance } = duckdb;

    const toSmallNumber = (v) => (typeof v === 'bigint' ? Number(v) : v); // safe for small smoke-test values
    console.log('DuckDB version:', duckdb.version());

    const instance = await DuckDBInstance.create(':memory:');
    const conn = await instance.connect();

    // 1) trivial query sanity
    {
      const [row] = (
        await conn.runAndReadAll(
          "select 1 as one, 2+2 as two, 'ok'::varchar as status"
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
          'from range(5) select cast(sum(range) as int) as s'
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
  try {
    const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
    const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
    sodium.randombytes_buf(key);
    sodium.randombytes_buf(nonce);

    const msg = Buffer.from('hello');
    const boxed = Buffer.alloc(msg.length + sodium.crypto_secretbox_MACBYTES);
    const opened = Buffer.alloc(msg.length);

    const N = (event && event.sodiumLoops) || 500_000;
    let okCount = 0;

    for (let i = 0; i < N; i++) {
      sodium.crypto_secretbox_easy(boxed, msg, nonce, key);
      const ok = sodium.crypto_secretbox_open_easy(opened, boxed, nonce, key);
      if (ok) okCount++;
    }
    console.log('sodium loops done, okCount:', okCount);
  } catch (e) {
    console.warn('sodium test skipped:', e && e.message);
  }

  // You had these commented; leaving your async tail-call intact.
  // unawaitedAsync();
  console.timeEnd(label);
};

export { start };
