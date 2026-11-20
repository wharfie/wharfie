// A minimal local store host in its own process: opens one store writable,
// seeds records, and serves other processes' reads until told to stop.
// argv: <storePath> <serveDelayMs>. stdin "stop\n" shuts it down in order.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import { createControlDBClient } from '../../src/core/lib/config/db.js';
import { acquireLocalStoreHost } from '../../src/core/runtime/local-store-host.js';

const [storePath, serveDelayArg] = process.argv.slice(2);
const host = await acquireLocalStoreHost({ storePath });
if (!host) throw new Error('Local store hosting is unsupported here.');
const db = await createControlDBClient('lmdb', { path: storePath });
await db.put({
  tableName: 'records',
  keyName: 'pk',
  sortKeyName: 'sk',
  record: { pk: 'item', sk: 's-a', n: 1, bytes: Buffer.from('xyz') },
});
for (const sk of ['s-b', 's-c', 's-d']) {
  await db.put({
    tableName: 'records',
    keyName: 'pk',
    sortKeyName: 'sk',
    record: { pk: 'item', sk, n: sk.charCodeAt(2) },
  });
}
const serve = () =>
  host.serve(
    async () =>
      await createControlDBClient('lmdb', { path: storePath, readOnly: true }),
  );
const serveDelayMs = Number(serveDelayArg || 0);
if (serveDelayMs > 0) setTimeout(serve, serveDelayMs);
else serve();
process.stdout.write(
  `${JSON.stringify({ ready: true, endpoint: host.endpoint, pid: process.pid })}\n`,
);

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() === 'child-read') {
    // A resident's own child (an activity, say) that reads the control
    // store while the resident waits for it. The wait is asynchronous, so
    // the resident can still answer the child's read through its host.
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const { createControlDBClient } = await import(${JSON.stringify(
          new URL('../../src/core/lib/config/db.js', import.meta.url).href,
        )});
        const { isLocalStoreHostClient } = await import(${JSON.stringify(
          new URL('../../src/core/runtime/local-store-host.js', import.meta.url)
            .href,
        )});
        const db = await createControlDBClient('lmdb', { path: ${JSON.stringify(storePath)}, readOnly: true });
        const record = await db.get({ tableName: 'records', keyName: 'pk', keyValue: 'item', sortKeyName: 'sk', sortKeyValue: 's-b' });
        process.stdout.write(JSON.stringify({ hosted: isLocalStoreHostClient(db), record }));
        await db.close();`,
      ],
      {
        cwd: fileURLToPath(new URL('../..', import.meta.url)),
        stdio: ['ignore', 'pipe', 'inherit'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    const [code] = await once(child, 'close');
    process.stdout.write(
      `${JSON.stringify({ childExit: code, childOutput: output })}\n`,
    );
    continue;
  }
  if (line.trim() !== 'stop') continue;
  await host.stopServing();
  await db.close();
  await host.release();
  process.stdout.write(`${JSON.stringify({ stopped: true })}\n`);
  break;
}
