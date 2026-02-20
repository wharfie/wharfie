import { Command } from 'commander';

import createOperationsStore from '../../../lambdas/lib/graph/operations-store.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';

function resolveAdapterName() {
  const adapter = process.env.WHARFIE_DB_ADAPTER?.trim().toLowerCase();
  if (!adapter) return 'vanilla';

  if (adapter === 'dynamodb') return 'dynamodb';
  if (adapter === 'lmdb') return 'lmdb';
  if (adapter === 'vanilla') return 'vanilla';

  throw new Error(
    `Invalid WHARFIE_DB_ADAPTER: ${process.env.WHARFIE_DB_ADAPTER}`,
  );
}

async function createDBClient() {
  const adapterName = resolveAdapterName();
  const path = process.env.WHARFIE_DB_PATH;

  if (adapterName === 'dynamodb') {
    const { default: createDynamoDB } =
      await import('../../../lambdas/lib/db/adapters/dynamodb.js');
    return createDynamoDB({
      region: process.env.AWS_REGION,
    });
  }

  if (adapterName === 'lmdb') {
    const { default: createLMDB } =
      await import('../../../lambdas/lib/db/adapters/lmdb.js');
    return createLMDB({ path });
  }

  const { default: createVanillaDB } =
    await import('../../../lambdas/lib/db/adapters/vanilla.js');
  return createVanillaDB({ path });
}

const listCommand = new Command('list')
  .description('List operations for a resource')
  .argument('<resource_id>', 'Wharfie resource ID')
  .action(async (resource_id) => {
    const db = await createDBClient();
    const store = createOperationsStore({ db });

    try {
      const records = await store.getRecords(resource_id);
      const operations = records.operations || [];
      operations.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      displaySuccess(`${operations.length} operations found.`);
      console.table(
        operations.map((op) => ({
          id: op.id,
          type: op.type,
          status: op.status,
          createdAt: op.createdAt,
          updatedAt: op.updatedAt,
        })),
      );
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    } finally {
      try {
        await db.close();
      } catch {
        // ignore
      }
    }
  });

export default listCommand;
