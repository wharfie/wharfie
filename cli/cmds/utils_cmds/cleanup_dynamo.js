'use strict';

const cliProgress = require('cli-progress');
const progressBar = new cliProgress.Bar({});

const {
  displaySuccess,
  displayFailure,
  displayInfo,
} = require('../../output/basic');
const {
  getAllOperations,
  deleteOperation,
} = require('../../../lambdas/lib/dynamo/operations');

const list = async () => {
  displayInfo(`fetching operations...`);
  const operations = await getAllOperations();

  const operations_to_remove = operations.filter(
    (x) => x.started_at * 1000 < new Date().getTime() - 1000 * 60 * 60 * 24
  );
  const operations_to_remove_count = operations_to_remove.length;
  displayInfo(`deleting stale operations...`);
  progressBar.start(operations_to_remove_count, 0);
  let deletedOperations = 0;
  while (operations_to_remove.length > 0) {
    const operationChunk = operations_to_remove.splice(0, 10);
    await Promise.all(
      operationChunk.map((operation) =>
        deleteOperation(operation.resource_id, operation.operation_id)
      )
    );
    deletedOperations = deletedOperations + operationChunk.length;
    progressBar.update(deletedOperations);
  }
  progressBar.stop();
  displaySuccess(`${operations_to_remove_count} expired operations removed`);
};

exports.command = 'cleanup-dynamo';
exports.desc = 'remove stale operation/action/query records';
exports.handler = async function () {
  try {
    await list();
  } catch (err) {
    displayFailure(err);
  }
};
