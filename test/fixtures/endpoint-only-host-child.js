// Binds a store host endpoint and never opens the store, so another would-be
// host sees a live holder while the holder lock itself stays free.
// argv: <storePath>. stdin "release\n" unbinds it.
import { createInterface } from 'node:readline';

import { acquireLocalStoreHost } from '../../src/core/runtime/local-store-host.js';

const [storePath] = process.argv.slice(2);
const host = await acquireLocalStoreHost({ storePath });
process.stdout.write(
  `${JSON.stringify({ bound: true, endpoint: host?.endpoint, at: Date.now() })}\n`,
);
for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() !== 'release') continue;
  await host?.release();
  process.stdout.write(
    `${JSON.stringify({ released: true, at: Date.now() })}\n`,
  );
  break;
}
