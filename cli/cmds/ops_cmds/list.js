import { createRequire } from 'node:module';
import createOperationsStore from '../../../lambdas/lib/graph/operations-store.js';

const require = createRequire(import.meta.url);

const { Command } = require('commander');
const { displayFailure, displaySuccess } = require('../../output/basic');

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

/**
 * @param {import('../../../lambdas/lib/db/tables/operations.js').OperationsTableClient} store
 * @param {string} resource_id -
 * @param {string} [operation_id] -
 */
const list = async (store, resource_id, operation_id) => {
  if (!operation_id) {
    const records = await store.getRecords(resource_id);
    records.operations.sort((a, b) => b.started_at - a.started_at);
    console.table(
      records.operations.map(
        ({ operation_config, resource_id: _rid, ...x }) => ({
          ...x,
          started_at: new Date(Number(x.started_at || 0) * 1000).toISOString(),
          last_updated_at: new Date(
            Number(x.last_updated_at || 0) * 1000,
          ).toISOString(),
        }),
      ),
    );
    return;
  }

  const records = await store.getRecords(resource_id, operation_id);
  if (records.operations.length === 0) {
    displaySuccess('No operation found');
    return;
  }

  const actions = records.operations[0].getSequentialActionOrder();
  records.queries.sort((a, b) => {
    if (a.status < b.status) return -1;
    if (a.status > b.status) return 1;
    return 0;
  });

  console.table(
    actions.map((action) => ({
      action_id: action.id,
      action_type: action.type,
      action_status: action.status,
    })),
  );

  console.table(
    records.queries.map((query) => ({
      query_id: query.id,
      query_status: query.status,
      query_execution_id: query.execution_id,
    })),
  );
};

const listCommand = new Command('list')
  .aliases(['ls'])
  .description('List operations and DAG records')
  .argument('<resource_id>', 'The wharfie resource ID')
  .argument('[operation_id]', 'The wharfie operation ID', null)
  .action(async (resource_id, operation_id) => {
    const db = await createDBClient();
    const store = createOperationsStore({ db });

    try {
      await list(store, resource_id, operation_id || undefined);
    } catch (err) {
      displayFailure(err);
    } finally {
      try {
        await db.close();
      } catch {
        // ignore
      }
    }
  });

module.exports = listCommand;
