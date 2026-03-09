import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const cliProgress = require('cli-progress');
const {
  displaySuccess,
  displayFailure,
  displayInfo,
} = require('../../output/basic');
const {
  getAllOperations,
  deleteOperation,
} = require('../../../lambdas/lib/aws/dynamo/operations.js');

const cleanupDynamo = async () => {
  displayInfo('Fetching operations...');
  const operations = await getAllOperations();

  const operationsToRemove = operations.filter(
    /** @param {{ started_at: number }} x */
    (x) => x.started_at * 1000 < Date.now() - 1000 * 60 * 60 * 24,
  );

  const operationsToRemoveCount = operationsToRemove.length;
  if (operationsToRemoveCount === 0) {
    displayInfo('No stale operations to delete.');
    return;
  }

  displayInfo('Deleting stale operations...');
  const progressBar = new cliProgress.Bar(
    {},
    cliProgress.Presets.shades_classic,
  );
  progressBar.start(operationsToRemoveCount, 0);

  let deletedOperations = 0;
  while (operationsToRemove.length > 0) {
    const operationChunk = operationsToRemove.splice(0, 10);
    await Promise.all(
      operationChunk.map(
        /** @param {any} operation */
        (operation) => deleteOperation(operation),
      ),
    );
    deletedOperations += operationChunk.length;
    progressBar.update(deletedOperations);
  }

  progressBar.stop();
  displaySuccess(`${operationsToRemoveCount} expired operations removed.`);
};

const cleanupDynamoCommand = new Command('cleanup-dynamo')
  .description('Remove stale operation/action/query records')
  .action(async () => {
    try {
      await cleanupDynamo();
    } catch (err) {
      displayFailure(err);
    }
  });

module.exports = cleanupDynamoCommand;
