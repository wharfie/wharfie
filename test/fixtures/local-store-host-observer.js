// A high-rate operator-style observer: every cycle opens the control store
// through the product's read path, reads the resident lifecycle, and closes
// it. Run with the LMDB open recorder preloaded. Prints one JSON summary.
import { createControlDBClient } from '../../src/core/lib/config/db.js';
import { createLedgerServiceLifecycle } from '../../src/core/lib/db/tables/ledger-service-lifecycle.js';

const [controlPath, tableName, serviceId, durationArg, intervalArg] =
  process.argv.slice(2);
const deadline = Date.now() + Number(durationArg);
const interval = Number(intervalArg);
let reads = 0;
/** @type {Record<string, number>} */
const statuses = {};
/** @type {string[]} */
const errors = [];

while (Date.now() < deadline) {
  try {
    const db = await createControlDBClient('lmdb', {
      path: controlPath,
      readOnly: true,
    });
    try {
      const lifecycle = await createLedgerServiceLifecycle({
        db,
        tableName,
      }).get({ serviceId });
      const status = String(lifecycle?.status);
      statuses[status] = (statuses[status] || 0) + 1;
      reads += 1;
    } finally {
      await db.close();
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  await new Promise((resolve) => setTimeout(resolve, interval));
}
process.stdout.write(`${JSON.stringify({ reads, statuses, errors })}\n`);
