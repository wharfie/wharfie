// A short-lived reader of a hosted store, like an operator command. It reads
// once, then on "read" reads again or on "close" only closes, and must then
// exit by itself: nothing it opened may keep its event loop alive.
// argv: <storePath> <callTimeoutMs>. Prints one JSON line per step.
import { once } from 'node:events';
import { createInterface } from 'node:readline';

import { connectLocalStoreHost } from '../../src/core/runtime/local-store-host.js';

const [storePath, callTimeoutArg] = process.argv.slice(2);
const client = await connectLocalStoreHost({
  storePath,
  callTimeoutMs: Number(callTimeoutArg),
});
if (!client) throw new Error('No host serves the store.');
const read = async () =>
  await client.get({
    tableName: 'records',
    keyName: 'pk',
    keyValue: 'item',
    sortKeyName: 'sk',
    sortKeyValue: 's-a',
  });
process.stdout.write(`${JSON.stringify({ ready: Boolean(await read()) })}\n`);

const lines = createInterface({ input: process.stdin });
const [step] = await once(lines, 'line');
if (step === 'read') {
  const outcome = await read().then(
    () => ({ read: 'ok' }),
    (/** @type {any} */ error) => ({
      read: error.name,
      timedOut: error.timedOut,
    }),
  );
  process.stdout.write(`${JSON.stringify(outcome)}\n`);
}
await client.close();
lines.close();
process.stdin.destroy();
