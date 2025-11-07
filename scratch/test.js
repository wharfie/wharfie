const BaseResource = require('../lambdas/lib/actor/resources/base-resource');
const Function = require('../lambdas/lib/actor/resources/builds/function');
const ActorSystem = require('../lambdas/lib/actor/resources/builds/actor-system');
const Reconcilable = require('../lambdas/lib/actor/resources/reconcilable');
const dep = require('./lib/dep');

const {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
} = require('../lambdas/lib/db/state/local');
BaseResource.stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};

const lock = require('../package-lock.json');

/**
 * @param pkgName
 */
function getInstalledVersion(pkgName) {
  const entry = lock.packages?.[`node_modules/${pkgName}`];
  return entry?.version || null;
}

async function unawaitedAsync() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('test draining');
}
/**
 *
 */
async function main() {
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_ERROR, (event) => {
    // console.error(event)
  });
  const start = new Function(
    async (event, context) => {
      if (
        // @ts-ignore
        // typeof __SEA_BUILD__ === 'undefined' &&
        true
      ) {
        console.log('params', [event, context]);
        console.log('started');
        dep();
        console.log('done');

        // --- LMDB (yours) ---
        const lmdb = require('lmdb');
        const ROOT_DB = lmdb.open({ path: 'test-db' });
        await ROOT_DB.put('greeting', { someText: 'Hello, World!' });
        console.log(ROOT_DB.get('greeting').someText);

        // --- sharp (yours) ---
        const sharp = require('sharp');
        const redDotPng = await sharp({
          create: {
            width: 64,
            height: 64,
            channels: 3,
            background: { r: 255, g: 0, b: 0 },
          },
        })
          .png()
          .toBuffer();
        console.log('sharp png size', redDotPng.length);

        // --- bcrypt (native, N-API) ---
        // try {
        //   const bcrypt = require('bcrypt'); // v5.0.0 pinned in externals
        //   const hash = await bcrypt.hash('swordfish', 10);
        //   const bcrypt_ok = await bcrypt.compare('swordfish', hash);
        //   console.log({ bcrypt_ok });
        // } catch (e) {
        //   console.warn('bcrypt test skipped:', e && e.message);
        // }

        // --- SerialPort (native C++) ---
        // try {
        //   const { SerialPortStream } = require('@serialport/stream'); // v12.0.0
        //   const { autoDetect } = require('@serialport/bindings-cpp'); // v12.0.0

        //   const Binding = autoDetect();
        //   const port = new SerialPortStream(
        //     { path: process.env.SERIAL_PATH || '/dev/ttyUSB0', baudRate: 9600 },
        //     { binding: Binding }
        //   );

        //   port.on('open', () => {
        //     console.log('serialport open');
        //     port.write('AT\r');
        //   });
        //   port.on('data', d => console.log('serial rx:', d.toString()));
        //   port.on('error', err => console.warn('serial error:', err && err.message));

        //   // Close after a short demo window so we don’t hang.
        //   setTimeout(() => { try { port.close(); } catch {} }, 1500);
        // } catch (e) {
        //   console.warn('serialport test skipped:', e && e.message);
        // }

        // --- ffi-napi / ref-napi (call into libc) ---
        // try {
        //   const ffi = require('ffi-napi');   // v4.0.3
        //   const ref = require('ref-napi');   // v3.0.3
        //   const int = ref.types.int;
        //   const libc = ffi.Library(null, { puts: [int, ['string']] });
        //   console.log('ffi puts rc =', libc.puts('hello from ffi node 24'));
        // } catch (e) {
        //   console.warn('ffi-napi test skipped:', e && e.message);
        // }

        // --- node-canvas (Cairo-backed) ---
        // try {
        //   const { createCanvas } = require('canvas'); // v2.11.2
        //   const canvas = createCanvas(200, 80);
        //   const ctx = canvas.getContext('2d');
        //   ctx.fillStyle = '#222';
        //   ctx.fillRect(0, 0, 200, 80);
        //   ctx.fillStyle = '#fff';
        //   ctx.font = 'bold 24px sans-serif';
        //   ctx.fillText('node-canvas ✅', 20, 50);
        //   console.log('canvas png size', canvas.toBuffer('image/png').length);
        // } catch (e) {
        //   console.warn('canvas test skipped:', e && e.message);
        // }

        // --- usb (libusb native binding) ---
        try {
          const usb = require('usb'); // v2.13.0
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
          const duckdb = require('@duckdb/node-api');
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

        // --- node-pty (native pty) ---
        // try {
        //   const { spawn } = require('node-pty'); // v1.0.0
        //   const shell = process.platform === 'win32'
        //     ? process.env.ComSpec || 'cmd.exe'
        //     : process.env.SHELL || 'bash';
        //   const pty = spawn(shell, [], { name: 'xterm-color', cols: 80, rows: 24 });
        //   pty.onData(data => process.stdout.write(data));
        //   pty.write('echo PTY works on Node 24\n');
        //   setTimeout(() => { try { pty.kill(); } catch {} }, 1000);
        // } catch (e) {
        //   console.warn('node-pty test skipped:', e && e.message);
        // }

        // --- sodium-native (yours; N-API libsodium) ---
        const sodium = require('sodium-native');
        const key = Buffer.alloc(sodium.crypto_secretbox_KEYBYTES);
        sodium.randombytes_buf(key);

        const nonce = Buffer.alloc(sodium.crypto_secretbox_NONCEBYTES);
        sodium.randombytes_buf(nonce);

        const msg = Buffer.from('hello');
        const boxed = Buffer.alloc(
          msg.length + sodium.crypto_secretbox_MACBYTES
        );
        sodium.crypto_secretbox_easy(boxed, msg, nonce, key);

        const opened = Buffer.alloc(msg.length);
        const sod_ok = sodium.crypto_secretbox_open_easy(
          opened,
          boxed,
          nonce,
          key
        );
        console.log(sod_ok, opened.toString());

        // You had these commented; leaving your async tail-call intact.
        unawaitedAsync();
      }
    },
    {
      name: 'start',
      properties: {
        external: [
          // --- existing ---
          { name: 'lmdb', version: getInstalledVersion('lmdb') },
          { name: 'sharp', version: '0.34.4' },
          { name: 'sodium-native', version: '5.0.9' },
          { name: '@duckdb/node-api', version: '1.4.1-r.4' },

          // --- added from my first list (pinned) ---
          // { name: 'bcrypt', version: '5.0.0' },
          // { name: '@serialport/stream', version: '12.0.0' },
          // { name: '@serialport/bindings-cpp', version: '12.0.0' },
          // { name: 'ffi-napi', version: '4.0.3' },
          // { name: 'ref-napi', version: '3.0.3' },
          // { name: 'canvas', version: '2.11.2' },
          { name: 'usb', version: '2.13.0' },
          // { name: 'node-pty', version: '1.0.0' },
        ],
      },
    }
  );

  const main = new ActorSystem({
    name: 'main',
    functions: [start],
    properties: {
      targets: [
        {
          nodeVersion: '24',
          platform: 'darwin',
          architecture: 'arm64',
        },
        // {
        //   nodeVersion: '23',
        //   platform: 'darwin',
        //   architecture: 'arm64',
        // },
        // {
        //   nodeVersion: '24',
        //   platform: 'linux',
        //   architecture: 'x64',
        //   libc: 'glibc'
        // },
        // {
        //   nodeVersion: '22',
        //   platform: 'darwin',
        //   architecture: 'x64',
        // },
        // {
        //   nodeVersion: '24',
        //   platform: 'win32',
        //   architecture: 'x64',
        // },
        // {
        //   nodeVersion: '22',
        //   platform: 'win32',
        //   architecture: 'x86',
        // },
      ],
    },
  });

  await main.reconcile();
}

main();
