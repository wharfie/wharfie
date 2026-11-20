// Opens one local control store natively through the product choke point and
// holds it until told to close, reporting each step on stdout as JSON lines.
// argv: <storePath> <read|write> <lockWaitMs>. stdin "close\n" closes it.
import { createInterface } from 'node:readline';

import { createControlDBClient } from '../../src/core/lib/config/db.js';

const [storePath, mode, lockWaitArg] = process.argv.slice(2);
const report = (/** @type {Record<string, unknown>} */ message) =>
  process.stdout.write(`${JSON.stringify({ pid: process.pid, ...message })}\n`);

let db;
try {
  db = await createControlDBClient('lmdb', {
    path: storePath,
    readOnly: mode === 'read',
    lockWaitMs: Number(lockWaitArg),
  });
} catch (error) {
  report({
    refused: true,
    at: Date.now(),
    code: /** @type {any} */ (error)?.code,
    message: /** @type {Error} */ (error)?.message,
  });
  process.exit(3);
}
if (mode === 'write') {
  await db.put({
    tableName: 'records',
    keyName: 'pk',
    record: { pk: 'writer', pid: process.pid },
  });
}
report({ opened: true, at: Date.now() });

for await (const line of createInterface({ input: process.stdin })) {
  if (line.trim() !== 'close') continue;
  const at = Date.now();
  await db.close();
  report({ closed: true, at, after: Date.now() });
  break;
}
