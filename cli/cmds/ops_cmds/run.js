import { Command } from 'commander';

import createOperationsStore from '../../../lambdas/lib/graph/operations-store.js';
import { resolveOperationsTableName } from '../../../lambdas/lib/config/db.js';
import { runOperation } from '../../../lambdas/lib/graph/runner.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';

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

const runCommand = new Command('run')
  .description(
    'Execute an operation DAG in-process (placeholder executor: marks actions completed)',
  )
  .argument('<resource_id>', 'Wharfie resource ID')
  .argument('<operation_id>', 'Operation ID')
  .action(async (resource_id, operation_id) => {
    const db = await createDBClient();
    const store = createOperationsStore({
      db,
      tableName: resolveOperationsTableName(),
    });

    try {
      displayInfo(`Running operation: ${resource_id}#${operation_id}`);

      const executeAction = async (action) => {
        // Placeholder executor used for DAG inspection/testing.
        // The runner will handle status transitions; we just return success.
        displayInfo(`- ${action.id} (${action.type})`);
        return true;
      };

      const result = await runOperation({
        store,
        resourceId: resource_id,
        operationId: operation_id,
        executeAction,
      });

      displaySuccess(`Executed ${result.executedActionIds.length} actions.`);
      console.table(
        Object.entries(result.finalStatusByActionId).map(
          ([action_id, status]) => ({
            action_id,
            status,
          }),
        ),
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

export default runCommand;
