// Starts the way the service manager's resident does (hosting the control
// store, waiting for another holder) and reports how it ended.
// argv: <root> [heldWaitMs]. stdin "abort\n" sends the resident its stop
// signal.
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { resolveExecutionPayloadStoreId } from '../../src/core/lib/config/db.js';
import { withExecutionLedger } from '../../src/core/runtime/operator/execution-ledger-store.js';

const [root, heldWaitArg] = process.argv.slice(2);
const payloadPath = join(root, 'payloads');
const controller = new AbortController();
const report = (/** @type {Record<string, unknown>} */ message) =>
  process.stdout.write(`${JSON.stringify({ at: Date.now(), ...message })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  if (line.trim() === 'abort') {
    report({ abortRequested: true });
    controller.abort(new Error('stop requested'));
  }
});
report({ waiting: true });
try {
  await withExecutionLedger(
    async () => {
      report({ opened: true });
    },
    {
      configuration: {
        adapterName: 'lmdb',
        controlPath: join(root, 'control'),
        tableName: 'waiting-resident',
        payloadPath,
        payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
        sessionPath: join(root, 'sessions'),
      },
      hostReads: true,
      onHostHeld: 'wait',
      ...(heldWaitArg ? { heldWaitMs: Number(heldWaitArg) } : {}),
      signal: controller.signal,
    },
  );
} catch (error) {
  report({
    ended: true,
    code: /** @type {any} */ (error)?.code,
    message: /** @type {Error} */ (error)?.message,
  });
}
process.exit(0);
